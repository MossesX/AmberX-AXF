#!/usr/bin/env node
/**
 * Builds plugin CLI: the Builds page's reads and writes on the one builds store (builds@1, framework/cli/builds-store.mjs).
 * The console server part calls it with --json; any session can too.
 *
 *   node apps/console-web/plugins/builds-page/builds.mjs state [profile]          builds + steps + progress + draft (+ preview)
 *   … ops '<json {profile, ops:[…]}>'                                          apply ops now (Builds view: rename, reorder)
 *   … draft '<json {profile, op}>'                                            add one op to the profile's draft (Steps view)
 *   … apply [profile] · discard [profile]                                     the draft
 *   … propose '<json {profile, uids:[…], n}>'                                 harvest proposal: N builds with default names
 *   … divide '<json {profile, build, uid}>'                                   a proposed division of one step
 *   … rename-profile '<json {id, name}>'                                      rename a build profile (id never changes)
 *   … progress [profile]                                                      the banner number
 *   … view <pending|queue|plan|tracker|orchestrator|steps> ['<json {profile, filter, q, build}>']   one view's rows
 *   … tick '<json {profile, build, step|uid, done}>'                          tick a step (or undo with done: false)
 *   … status '<json {profile, ids, status}>' · hide|unhide|archive|delete '<json {profile, ids}>' · note '<json {profile, id, text}>'
 * The same views and commands as the page, so the console's control@1 plugins domain (REST /api/control/builds-page/…,
 * MCP builds-page_<command>, `axf builds-page <command>`) reaches every view.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../../../../framework/plan/builds-store-core.mjs';
import { phaseApproved, switchKind } from '../../../../framework/core/model-switch.mjs';
import { applyDraftNow, loadStore, withStore } from '../../../../framework/cli/builds-store.mjs';
import { activeProfile, dataPath, readProfiles, REPO_ROOT } from '../../../../framework/cli/persist.mjs';

const ACTOR = process.env.AXF_ACTOR || 'builds-page';
const pickProfile = (p) => { const reg = readProfiles(); return reg.profiles.some((x) => x.id === p) ? p : activeProfile().id; };

const readJson = (f) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; } catch { return null; } };
/** One profile's plan features by id (plan.json of that profile), for the Plan and Tracker views' nested info. */
function planOf(profile) {
  const prev = process.env.AXF_BUILD_PROFILE;
  process.env.AXF_BUILD_PROFILE = profile;
  try { return new Map((readJson(dataPath('framework/plan/plan.json'))?.features ?? []).map((f) => [f.id, f])); }
  catch { return new Map(); }
  finally { if (prev === undefined) delete process.env.AXF_BUILD_PROFILE; else process.env.AXF_BUILD_PROFILE = prev; }
}
/** USD per working minute per model (framework/schemas/model-pricing.json heuristic). */
const PRICE = (() => {
  const m = readJson(join(REPO_ROOT, 'framework/schemas/model-pricing.json'));
  const t = m?.heuristic?.tokensPerMinute ?? {};
  const per = (p) => ((t.input ?? 0) * p.input + (t.output ?? 0) * p.output + (t.cacheRead ?? 0) * p.cacheRead + (t.cacheWrite ?? 0) * p.cacheWrite) / 1e6;
  return Object.fromEntries(Object.entries(m?.models ?? {}).map(([k, p]) => [k, per(p)]));
})();
const costOf = (steps) => Math.round(steps.reduce((t, s) => t + (estimateMin(s.estimate) ?? 0) * (PRICE[String(s.model).toLowerCase()] ?? 0), 0) * 100) / 100;
/** The build's phases, cut exactly like the orchestrator does (a run of one model, split again where the phase name
 * changes), so approvals line up: each with its model, the model it switches from, and whether that switch is approved. */
function phasesOf(b) {
  const out = [];
  for (const st of b.steps) {
    const last = out[out.length - 1];
    if (last && last.model === st.model && (!st.phase || st.phase === last.label)) { last.list.push(st); continue; }
    const gate = !!last && last.model !== st.model;
    out.push({ index: out.length, model: st.model, label: st.phase || '', list: [st], gate, from: last?.model ?? '', kind: gate ? switchKind(last.model, st.model) : '' });
  }
  return out.map((p) => ({
    index: p.index, name: p.label || `Phase ${p.index + 1}`, model: p.model, from: p.from, gate: p.gate, kind: p.kind, upgrade: p.gate && p.kind === 'upgrade', uids: p.list.map((x) => x.uid),
    steps: p.list.length, done: p.list.filter((x) => x.done).length, minutes: p.list.reduce((t, x) => t + (estimateMin(x.estimate) ?? 0), 0),
    approved: phaseApproved(b.approvals, p), // downgrades pass by themselves; an upgrade only with Brett's approval
    requested: (b.upgradeRequests ?? []).some((r) => r.phase === p.index && (r.state ?? 'open') === 'open'),
  }));
}
const planInfo = (f) => (f ? {
  id: f.id, title: f.title, area: f.area ?? '', status: f.status ?? '', priority: f.priority ?? '', wave: f.wave ?? null, effort: f.effort ?? '', summary: f.summary ?? '',
  acceptance: (f.acceptance ?? []).map((a) => ({ text: String(a.text ?? a), done: a.done === true })),
  dependsOn: f.dependsOn ?? [], ports: Object.fromEntries(Object.entries(f.ports ?? {}).map(([k, v]) => [k, v?.status ?? ''])),
} : null);

/** A step as the page shows it: kind and target read from its text when it doesn't say. */
function stepView(s, b, i) {
  const t = `${s.title} ${s.text}`.toLowerCase();
  const kind = /\b(fix|bug|broken|repair|red ci|regression)\b/.test(t) ? 'fix' : /\b(remove|delete|retire|drop|uninstall)\b/.test(t) ? 'removal' : /\b(add|new|create|build|introduce|first)\b/.test(t) ? 'creation' : 'edit';
  return { ...s, index: i, build: b.id, buildTitle: b.title, kind, target: s.files[0] || s.group || s.phase || '', next: false };
}
function buildView(b, profile, plan = new Map()) {
  const p = core.buildProgress(b);
  const steps = b.steps.map((s, i) => stepView(s, b, i));
  const next = steps.find((s) => !s.done && !s.skip); if (next) next.next = true;
  const minutesLeft = b.steps.filter((s) => !s.done && !s.skip).reduce((t, s) => t + (estimateMin(s.estimate) ?? 0), 0);
  const minutes = b.steps.filter((s) => !s.skip).reduce((t, s) => t + (estimateMin(s.estimate) ?? 0), 0) || (estimateMin(b.pending?.estimate ?? b.queue?.estimate) ?? 0);
  const models = [...new Set(b.steps.map((s) => s.model))];
  const feature = plan.get(b.planRef) ?? (b.kind === 'epic' ? plan.get(b.id) : undefined);
  return {
    id: b.id, title: b.title, category: b.category, detail: b.detail, status: b.status, kind: b.kind, planRef: b.planRef, branch: b.branch, pr: b.pr,
    profiles: b.profiles, order: b.order[profile] ?? 0, rev: b.rev, createdAt: b.createdAt, updatedAt: b.updatedAt, builtAt: b.builtAt,
    hidden: b.hidden, rearranged: b.rearranged, hasDefault: b.defaultSteps.length > 0, notes: b.notes.slice(-5), pendingStatus: core.pendingStatusOf(b),
    progress: p, minutesLeft, minutes, cost: costOf(b.steps.filter((s) => !s.skip)), model: b.pending?.model || (models.length === 1 ? models[0] : models.join(' + ')) || '',
    summary: oneLine(b.detail) || oneLine(b.title), deleted: b.deleted, approvals: b.approvals, phases: phasesOf(b),
    pending: b.pending ? { model: b.pending.model ?? '', estimate: b.pending.estimate ?? '', source: b.pending.source ?? '', planId: b.pending.planId ?? '' } : null,
    queue: b.queue ? { estimate: b.queue.estimate ?? '', completedAt: b.queue.completedAt ?? '', rework: b.queue.rework ?? null } : null,
    plan: planInfo(feature), steps,
  };
}
const oneLine = (t) => String(t ?? '').split(/\n|(?<=[.!?])\s/)[0].trim().slice(0, 200);
const estimateMin = (e) => { const m = /^\s*~?\s*(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)?\s*$/i.exec(String(e ?? '')); if (!m) return null; const n = Number(m[1]); const u = (m[2] || 'min').toLowerCase(); return Math.round(u.startsWith('h') ? n * 60 : u.startsWith('d') ? n * 480 : n); };

export function state(profileArg) {
  const profile = pickProfile(profileArg);
  const s = loadStore();
  const d = core.draftOf(s, profile);
  const shown = d.ops.length ? core.previewDraft(s, profile) : null;
  const view = shown?.store ?? s;
  const reg = readProfiles();
  return {
    ok: true, rev: s.rev, profile, active: activeProfile().id,
    profiles: reg.profiles.map((p) => ({ id: p.id, name: shown?.profileName?.id === p.id ? shown.profileName.name : p.name, base: !!p.base, progress: core.profileProgress(s, p.id), builds: core.buildsOf(s, p.id).length })),
    progress: core.profileProgress(view, profile),
    builds: (() => { const plan = planOf(profile); return core.buildsOf(view, profile).map((b) => buildView(b, profile, plan)); })(),
    draft: { ops: d.ops, count: d.ops.length, updatedAt: d.updatedAt, by: d.by, log: shown?.log ?? [] },
  };
}

/** The page's views (ui.tsx VIEWS), each a filter + sort over the same rows; the default sort is newest first. */
export const VIEWS = ['pending', 'queue', 'plan', 'tracker', 'orchestrator', 'steps'];
export const FILTERS = ['open', 'complete', 'archived', 'hidden', 'all'];
const keep = (f) => (b) => f === 'hidden' ? b.hidden : f === 'all' ? true : b.hidden ? false : f === 'complete' ? (b.status === 'complete' || b.status === 'built') : f === 'archived' ? b.status === 'archived' : !['complete', 'archived'].includes(b.status); // same as the page (ui.tsx keep)
const newest = (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt));
const row = (b) => ({ id: b.id, title: b.title, status: b.status, model: b.model, category: b.category, progress: `${b.progress.done}/${b.progress.total}`, pct: b.progress.pct, minutesLeft: b.minutesLeft, branch: b.branch, pr: b.pr, hidden: b.hidden, createdAt: b.createdAt, updatedAt: b.updatedAt });

/** One view's rows, as the page shows them (filter, find, focus on one build). */
export function viewRows(view, { profile, filter = 'open', q = '', build = '' } = {}) {
  if (!VIEWS.includes(view)) throw new Error(`unknown view ${view} (one of ${VIEWS.join(', ')})`);
  if (!FILTERS.includes(filter)) throw new Error(`unknown filter ${filter} (one of ${FILTERS.join(', ')})`);
  const s = state(profile); const needle = String(q).trim().toLowerCase();
  const builds = s.builds.filter((b) => (build ? b.id === build : keep(filter)(b)) && (!needle || `${b.title} ${b.id} ${b.category} ${b.detail} ${b.model} ${b.plan?.area ?? ''}`.toLowerCase().includes(needle)));
  const base = { ok: true, view, profile: s.profile, filter: build ? 'all' : filter, rev: s.rev, progress: s.progress };
  if (view === 'steps') return { ...base, rows: builds.sort(newest).flatMap((b) => b.steps.map((x) => ({ build: b.id, uid: x.uid, id: x.id, title: x.title || x.text.split('\n')[0], model: x.model, estimate: x.estimate, done: x.done, skip: x.skip, next: x.next }))) };
  if (view === 'queue') return { ...base, rows: builds.sort((a, b) => a.order - b.order).map((b) => ({ order: b.order + 1, ...row(b), dependsOn: b.plan?.dependsOn ?? [], rework: b.queue?.rework ?? null })) };
  if (view === 'plan') return { ...base, rows: builds.sort(newest).map((b) => ({ ...row(b), plan: b.plan ? { id: b.plan.id, area: b.plan.area, status: b.plan.status, acceptance: b.plan.acceptance, ports: b.plan.ports, dependsOn: b.plan.dependsOn } : null })) };
  if (view === 'tracker') {
    const groups = new Map();
    for (const b of builds.sort(newest)) { const k = b.category || 'Other'; const g = groups.get(k) ?? { category: k, builds: 0, complete: 0, steps: 0, done: 0, rows: [] }; g.builds += 1; if (['complete', 'built'].includes(b.status)) g.complete += 1; g.steps += b.progress.total; g.done += b.progress.done; g.rows.push(row(b)); groups.set(k, g); }
    return { ...base, rows: [...groups.values()] };
  }
  if (view === 'orchestrator') return { ...base, rows: builds.sort(newest).map((b) => ({ ...row(b), phases: b.phases.map((ph) => ({ index: ph.index, name: ph.name, model: ph.model, from: ph.from, switch: ph.gate ? ph.kind : '', approved: ph.approved, requested: ph.requested, steps: `${ph.done}/${ph.steps}` })) })) };
  return { ...base, rows: builds.sort(newest).map((b) => ({ ...row(b), pending: b.pending, notes: b.notes.slice(-2) })) };
}

/** The page's immediate commands (tick, status, hide, unhide, archive, delete, note) as ops on the store. */
export function opsFor(cmd, body, builds) {
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : body.id ? [String(body.id)] : [];
  if (cmd === 'tick') {
    const b = builds.find((x) => x.id === body.build); const st = b?.steps.find((x) => x.uid === body.uid || x.id === body.step);
    if (!st) throw new Error(`no step ${body.step ?? body.uid} in ${body.build}`);
    return [{ op: 'step-done', build: b.id, uid: st.uid, done: body.done !== false }];
  }
  if (cmd === 'status') return [{ op: 'set-status', ids, status: String(body.status ?? '') }];
  if (cmd === 'note') return [{ op: 'note', id: ids[0] ?? '', text: String(body.text ?? '') }];
  return [{ op: cmd, ids }]; // hide · unhide · archive · delete
}
export const NAMED_OPS = ['tick', 'status', 'hide', 'unhide', 'archive', 'delete', 'note'];

function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text ?? JSON.stringify(o, null, 1));
  const [cmd = 'state', arg] = args;
  const body = arg?.startsWith('{') ? JSON.parse(arg) : {};
  if (cmd === 'state') { const r = state(arg && !arg.startsWith('{') ? arg : body.profile); return out(r, `${r.profile}: ${r.progress.pct}% · ${r.builds.length} builds · draft ${r.draft.count}`); }
  if (cmd === 'progress') { const p = pickProfile(arg); const s = loadStore(); const builds = core.buildsOf(s, p).map((b) => ({ id: b.id, ...core.buildProgress(b) })); return out({ ok: true, profile: p, progress: core.profileProgress(s, p), active: builds.filter((b) => b.active).map((b) => b.id) }); }
  if (cmd === 'view') { const r = viewRows(arg, { ...(args[2]?.startsWith('{') ? JSON.parse(args[2]) : {}) }); return out(r, `${r.profile} · ${r.view} (${r.filter}): ${r.rows.length} row(s)`); }
  if (NAMED_OPS.includes(cmd)) {
    const p = pickProfile(body.profile); let log = [];
    withStore((s) => { const r = core.applyNow(s, p, opsFor(cmd, body, core.buildsOf(s, p)), { by: ACTOR }); log = r.log; return r.store; }, { by: ACTOR, action: `builds:${cmd}`, note: [body.build, ...(body.ids ?? []), body.id].filter(Boolean).join(',') });
    return out({ ok: true, profile: p, log }, log.join('\n'));
  }
  if (cmd === 'ops') {
    const p = pickProfile(body.profile); let log = [];
    withStore((s) => { const r = core.applyNow(s, p, body.ops ?? [], { by: ACTOR }); log = r.log; return r.store; }, { by: ACTOR, action: 'builds:ops', note: (body.ops ?? []).map((o) => o.op).join(',') });
    return out({ ...state(p), log });
  }
  if (cmd === 'draft') {
    const p = pickProfile(body.profile);
    withStore((s) => core.addDraftOp(s, p, body.op, { by: ACTOR }), { by: ACTOR, action: 'draft', note: body.op?.op ?? '' });
    return out(state(p));
  }
  if (cmd === 'apply') {
    const p = pickProfile(arg?.startsWith('{') ? body.profile : arg);
    const done = (r) => out({ ...state(p), log: r.log ?? [] });
    const r = applyDraftNow(p, ACTOR);
    return r && typeof r.then === 'function' ? r.then(done) : done(r);
  }
  if (cmd === 'discard') { const p = pickProfile(arg?.startsWith('{') ? body.profile : arg); withStore((s) => core.discardDraft(s, p), { by: ACTOR, action: 'discard' }); return out(state(p)); }
  if (cmd === 'propose') {
    const p = pickProfile(body.profile); const s = loadStore();
    const all = core.buildsOf(s, p).flatMap((b) => b.steps);
    const picked = (body.uids ?? []).map((u) => all.find((x) => x.uid === u)).filter(Boolean);
    const n = Math.max(1, Number(body.n) || 1);
    const groups = n === 1 ? [{ title: core.suggestName(picked), uids: picked.map((x) => x.uid), steps: picked }] : core.proposeSplit(picked, n);
    return out({ ok: true, builds: groups.map((g) => ({ title: g.title, uids: g.uids, steps: g.steps.map((x) => ({ uid: x.uid, id: x.id, title: x.title, text: x.text, estimate: x.estimate, model: x.model })) })) });
  }
  if (cmd === 'divide') {
    const p = pickProfile(body.profile); const b = core.buildsOf(loadStore(), p).find((x) => x.id === body.build);
    const st = b?.steps.find((x) => x.uid === body.uid);
    if (!st) return out({ ok: false, error: 'no such step' });
    const parts = st.text.split(/\n+|;\s+|\.\s+(?=[A-Z])|\s+\+\s+/).map((x) => x.trim().replace(/\.$/, '')).filter((x) => x.length > 2);
    const can = parts.length >= 2;
    return out({ ok: true, can, why: can ? '' : 'This step is one change to one element: it has no separate parts to split off (the granularity rule keeps a whole-element change as one step).', parts: can ? parts : [st.text] });
  }
  if (cmd === 'rename-profile') {
    const name = String(body.name ?? '').trim(); if (!name) return out({ ok: false, error: 'a profile needs a name' });
    return import('../../../../framework/cli/profiles.mjs').then((m) => { m.act({ action: 'update', id: body.id, name }); return out(state(body.id)); });
  }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => main(process.argv.slice(2))).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}

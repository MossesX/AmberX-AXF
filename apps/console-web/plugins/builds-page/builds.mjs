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
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../../../../framework/plan/builds-store-core.mjs';
import { applyDraftNow, loadStore, withStore } from '../../../../framework/cli/builds-store.mjs';
import { activeProfile, readProfiles } from '../../../../framework/cli/persist.mjs';

const ACTOR = process.env.AXF_ACTOR || 'builds-page';
const pickProfile = (p) => { const reg = readProfiles(); return reg.profiles.some((x) => x.id === p) ? p : activeProfile().id; };

/** A step as the page shows it: kind and target read from its text when it doesn't say. */
function stepView(s, b, i) {
  const t = `${s.title} ${s.text}`.toLowerCase();
  const kind = /\b(fix|bug|broken|repair|red ci|regression)\b/.test(t) ? 'fix' : /\b(remove|delete|retire|drop|uninstall)\b/.test(t) ? 'removal' : /\b(add|new|create|build|introduce|first)\b/.test(t) ? 'creation' : 'edit';
  return { ...s, index: i, build: b.id, buildTitle: b.title, kind, target: s.files[0] || s.group || s.phase || '', next: false };
}
function buildView(b, profile) {
  const p = core.buildProgress(b);
  const steps = b.steps.map((s, i) => stepView(s, b, i));
  const next = steps.find((s) => !s.done && !s.skip); if (next) next.next = true;
  const minutesLeft = b.steps.filter((s) => !s.done && !s.skip).reduce((t, s) => t + (estimateMin(s.estimate) ?? 0), 0);
  return {
    id: b.id, title: b.title, category: b.category, detail: b.detail, status: b.status, kind: b.kind, planRef: b.planRef, branch: b.branch, pr: b.pr,
    profiles: b.profiles, order: b.order[profile] ?? 0, rev: b.rev, createdAt: b.createdAt, updatedAt: b.updatedAt, builtAt: b.builtAt,
    hidden: b.hidden, rearranged: b.rearranged, hasDefault: b.defaultSteps.length > 0, notes: b.notes.slice(-5), pendingStatus: core.pendingStatusOf(b),
    progress: p, minutesLeft, steps,
  };
}
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
    builds: core.buildsOf(view, profile).map((b) => buildView(b, profile)),
    draft: { ops: d.ops, count: d.ops.length, updatedAt: d.updatedAt, by: d.by, log: shown?.log ?? [] },
  };
}

function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text ?? JSON.stringify(o, null, 1));
  const [cmd = 'state', arg] = args;
  const body = arg?.startsWith('{') ? JSON.parse(arg) : {};
  if (cmd === 'state') { const r = state(arg && !arg.startsWith('{') ? arg : body.profile); return out(r, `${r.profile}: ${r.progress.pct}% · ${r.builds.length} builds · draft ${r.draft.count}`); }
  if (cmd === 'progress') { const p = pickProfile(arg); const s = loadStore(); const builds = core.buildsOf(s, p).map((b) => ({ id: b.id, ...core.buildProgress(b) })); return out({ ok: true, profile: p, progress: core.profileProgress(s, p), active: builds.filter((b) => b.active).map((b) => b.id) }); }
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

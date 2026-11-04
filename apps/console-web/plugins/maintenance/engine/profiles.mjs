#!/usr/bin/env node
/**
 * Clean up build profiles (profile-cleanup@1): the Maintenance plugin's audit of every build profile.
 *
 * Every open build in the builds store (builds@1), every profile's copied tracker checklist and copied plan gets a
 * verdict with a one-line reason and a proof link:
 *
 *   keep       still to do (or running: running and waiting builds are never touched)
 *   done       already done: its PR or branch merged into main, all its steps ticked, or the catalog says built
 *   not-needed belongs to something retired (Patches, Build Pilot)
 *   duplicate  same build as one already finished, or a profile's copy of the one framework tracker / plan
 *   merge      same build as an older open one: its open steps fold into that one
 *
 * This file is Basic mode: exact matches only, no AI. Deep mode (the console server, with an AI model) starts from
 * this audit and only re-judges the `keep` items it is allowed to (see server/profiles.py).
 *
 * Apply writes ONE builds store write (journalled, live to main like every store write): done → complete (date +
 * proof in a note), not-needed / duplicate → archived (never deleted), merge → open steps folded into the target, then
 * archived. Copied trackers and plans are moved into the run's archive folder. Every run keeps an undo record with the
 * builds as they were; one undo per run puts them back (a build changed since is left alone and reported). Afterwards
 * the orchestrator is re-planned (framework/cli/builds-reconcile.mjs --apply), best effort.
 *
 *   node apps/console-web/plugins/maintenance/engine/profiles.mjs audit [--save] [--details] [--json]
 *   … apply <run> [--skip key,key] [--by who] [--json]    apply a saved preview (keys from the preview)
 *   … undo <run> [--json]                                 put a run back (once)
 *   … runs [--json]                                       previews and runs, newest first
 *
 * Data: AXF_MAINT_DATA_DIR (default <repo>/.axf-console/plugins/maintenance)/profile-cleanup/{plans,runs,archive}/.
 * AXF_MAINT_MERGED_PRS=1,2,3 adds merged PR numbers (tests; the console passes GitHub's list when it has one).
 * AXF_MAINT_NO_REPLAN=1 skips the re-plan (tests).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_PROFILE, REPO_ROOT, TRACKER_REL, emptyProfileFile, persistRoot, profileRel, readProfiles } from '../../../../../framework/cli/persist.mjs';
import { loadStore, readStoreNow, withStore } from '../../../../../framework/cli/builds-store.mjs';
import { compactBuild, normBuild, normStep } from '../../../../../framework/plan/builds-store-core.mjs';

export const SCHEMA = 'profile-cleanup@1';
export const VERDICTS = ['keep', 'done', 'not-needed', 'duplicate', 'merge'];
const OPEN = ['pending', 'blocked', 'failed', 'built', 'waiting', 'running'];
const LOCKED = ['running', 'waiting'];
const PLAN_REL = 'framework/plan/plan.json';
const STATUS_REL = 'framework/catalog/status.json';
const RETIRED = [
  { re: /\bbuild[ -]?pilot\b/i, what: 'Build Pilot' },
  { re: /^patches\b|\bpatches(?:-web| web| app| android)\b|\bin patches\b|\bpatches tabs?\b/i, what: 'Patches' },
];
const RETIRED_REPORT = '_claude/builds/reports/kill-patches-pilot.md';
export const RUN_ID = /^pc-\d{8}-\d{6}-[a-z0-9]{4}$/;

const now = () => new Date().toISOString();
const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, j) => { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(j, null, 1)}\n`); renameSync(t, f); };
export const dataDir = () => join(process.env.AXF_MAINT_DATA_DIR || join(REPO_ROOT, '.axf-console', 'plugins', 'maintenance'), 'profile-cleanup');
const plansDir = () => join(dataDir(), 'plans');
const runsDir = () => join(dataDir(), 'runs');
const archiveDir = (run) => join(dataDir(), 'archive', run);
/** Where profile `id` keeps `rel` on this machine (the hub's projects tree when mounted, else the checkout). */
const profileFile = (id, rel) => join(persistRoot() ?? REPO_ROOT, profileRel(id, rel));
/** A deep copy of a build as the store keeps it (later edits to the live record never reach it). */
const snap = (b) => JSON.parse(JSON.stringify(compactBuild(b)));
const norm = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function newRunId(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `pc-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
}

// ------------------------------------------------------------------ evidence

function git(args) {
  const r = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? r.stdout : '';
}
function repoUrl() {
  const url = git(['remote', 'get-url', 'origin']).trim();
  const m = /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(url);
  return m ? `https://github.com/${m[1]}` : '';
}
/** What main says was merged: PR numbers (squash "(#N)" or "Merge pull request #N") and merged branch names. */
export function mainEvidence() {
  const ref = ['origin/main', 'main'].find((r) => git(['rev-parse', '--verify', '-q', r]).trim()) ?? 'HEAD';
  const prs = new Map(); const branches = new Map();
  for (const line of git(['log', ref, '--format=%H%x09%s', '-n', '5000']).split('\n')) {
    const [sha, subject = ''] = line.split('\t'); if (!sha) continue;
    const m = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)/.exec(subject);
    if (m) { if (!prs.has(+m[1])) prs.set(+m[1], sha); if (!branches.has(m[2])) branches.set(m[2], { sha, pr: +m[1] }); continue; }
    const sq = /\(#(\d+)\)\s*$/.exec(subject);
    if (sq && !prs.has(+sq[1])) prs.set(+sq[1], sha);
  }
  for (const n of String(process.env.AXF_MAINT_MERGED_PRS ?? '').split(',').map((x) => parseInt(x, 10)).filter((x) => x > 0)) if (!prs.has(n)) prs.set(n, '');
  return { ref, prs, branches, repo: repoUrl() };
}
const prNumber = (pr) => { const m = /(?:#|\/pull\/)(\d+)\s*$/.exec(String(pr ?? '').trim()) ?? /^(\d+)$/.exec(String(pr ?? '').trim()); return m ? +m[1] : 0; };

function reportOf(id) {
  for (const p of [`_claude/builds/reports/${id}.md`, `_claude/builds/reports/${id}/README.md`]) if (existsSync(join(REPO_ROOT, p))) return p;
  return '';
}

// ------------------------------------------------------------------ audit

/** One verdict for one open build (exact matches only). */
function judge(b, ev, ctx) {
  const base = { key: `build:${b.id}`, kind: 'build', id: b.id, title: b.title, status: b.status, profiles: b.profiles, rev: b.rev, steps: b.steps.length, stepsDone: b.steps.filter((s) => s.done).length, by: 'basic' };
  const report = reportOf(b.id);
  if (LOCKED.includes(b.status)) return { ...base, verdict: 'keep', locked: true, reason: `${b.status === 'running' ? 'Running' : 'Waiting'} now: never touched by a clean-up`, proof: null };
  const n = prNumber(b.pr);
  if (n && ev.prs.has(n)) return { ...base, verdict: 'done', reason: `Its PR #${n} is merged into main`, proof: { label: `PR #${n}`, url: ev.repo ? `${ev.repo}/pull/${n}` : '' } };
  if (b.mergedAt) return { ...base, verdict: 'done', reason: `Its PR merged on ${b.mergedAt.slice(0, 10)}`, proof: n ? { label: `PR #${n}`, url: ev.repo ? `${ev.repo}/pull/${n}` : '' } : { label: 'mergedAt on the build', url: '' } };
  if (b.branch && ev.branches.has(b.branch)) {
    const m = ev.branches.get(b.branch);
    return { ...base, verdict: 'done', reason: `Its branch ${b.branch} was merged into main (PR #${m.pr})`, proof: { label: `PR #${m.pr}`, url: ev.repo ? `${ev.repo}/pull/${m.pr}` : '' } };
  }
  const todo = b.steps.filter((s) => !s.skip);
  if (b.status === 'built') return { ...base, verdict: 'keep', reason: n ? `Built, waiting for PR #${n} to merge` : 'Built, waiting for its PR', proof: n ? { label: `PR #${n}`, url: ev.repo ? `${ev.repo}/pull/${n}` : '' } : null };
  if (todo.length && todo.every((s) => s.done)) return { ...base, verdict: 'done', reason: `All ${todo.length} of its steps are ticked`, proof: { label: 'steps in the builds store', path: '_claude/builds/store.json' } };
  const cat = ctx.status[b.planRef] ?? ctx.status[b.id];
  if (cat?.status === 'built') return { ...base, verdict: 'done', reason: `The framework catalog marks "${b.planRef || b.id}" built`, proof: { label: 'catalog status', path: STATUS_REL } };
  const retired = RETIRED.find((r) => r.re.test(b.title));
  if (retired) return { ...base, verdict: 'not-needed', reason: `It belongs to ${retired.what}, which was retired on Nov 3 2026`, proof: { label: 'retirement report', path: RETIRED_REPORT } };
  const twin = ctx.twinOf.get(b.id);
  if (twin) {
    const t = ctx.byId.get(twin);
    if (['complete', 'built'].includes(t.status)) return { ...base, verdict: 'duplicate', into: t.id, reason: `Same build as "${t.title}" (${t.id}), already ${t.status}`, proof: { label: t.id, path: '_claude/builds/store.json' } };
    if (LOCKED.includes(t.status)) return { ...base, verdict: 'keep', reason: `Same build as ${t.id}, which is running: merge it once that finishes`, proof: { label: t.id, path: '_claude/builds/store.json' } };
    return { ...base, verdict: 'merge', into: t.id, reason: `Same build as the older "${t.title}" (${t.id}): its open steps fold into that one`, proof: { label: t.id, path: '_claude/builds/store.json' } };
  }
  return { ...base, verdict: 'keep', reason: report ? 'Still open; a report exists, so check it' : 'Still open, nothing on main says it is done', proof: report ? { label: 'report', path: report } : null };
}

/** For each open build that repeats another (same title or same pending id), the build it repeats. */
function twins(builds) {
  const groups = new Map();
  for (const b of builds) {
    if (b.deleted || b.status === 'archived') continue;
    for (const k of [`t:${norm(b.title)}`, b.pendingId ? `p:${b.pendingId}` : '']) if (k && k !== 't:') { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); }
  }
  const out = new Map();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const finished = g.filter((b) => ['complete', 'built'].includes(b.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const open = g.filter((b) => !['complete', 'built'].includes(b.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const keeper = finished[0] ?? open.find((b) => LOCKED.includes(b.status)) ?? open[0];
    for (const b of open) if (b !== keeper && !LOCKED.includes(b.status) && !out.has(b.id)) out.set(b.id, keeper.id);
  }
  return out;
}

/** A profile's own copy of the one framework file `rel` (tracker, plan), when it holds one. */
function copyItem(p, rel, base) {
  const f = profileFile(p.id, rel);
  const j = readJson(f);
  if (!j) return null;
  const list = rel === TRACKER_REL ? j.items : j.features;
  if (!Array.isArray(list) || !list.length) return null;
  const baseIds = new Set(((rel === TRACKER_REL ? base.tracker?.items : base.plan?.features) ?? []).map((x) => x?.id));
  const copied = list.filter((x) => baseIds.has(x?.id)).length;
  if (rel !== TRACKER_REL && copied < list.length) return null; // a profile's own plan entries are its work: kept
  const what = rel === TRACKER_REL ? 'tracker checklist' : 'plan';
  return {
    key: `${rel === TRACKER_REL ? 'tracker' : 'plan'}:${p.id}`, kind: rel === TRACKER_REL ? 'tracker' : 'plan', id: `${p.id}/${rel}`, title: `Copied ${what} (${list.length} items)`,
    status: 'copy', profiles: [p.id], verdict: 'duplicate', by: 'basic', items: list.length,
    reason: `A copy of the one framework ${what}${copied === list.length ? '' : ` (${copied} of ${list.length} items match it)`}: the profile references the framework's own`,
    proof: { label: rel, path: rel }, file: profileRel(p.id, rel),
  };
}

/** The whole audit (Basic mode). */
export function audit({ store = readStoreNow(), ev = mainEvidence(), at = now(), details = false } = {}) {
  const reg = readProfiles();
  const builds = store.builds.filter((b) => !b.deleted);
  const ctx = { status: readJson(join(persistRoot() ?? REPO_ROOT, STATUS_REL)) ?? readJson(join(REPO_ROOT, STATUS_REL), {}) ?? {}, byId: new Map(builds.map((b) => [b.id, b])), twinOf: twins(builds) };
  const baseData = { tracker: readJson(join(persistRoot() ?? REPO_ROOT, TRACKER_REL)) ?? readJson(join(REPO_ROOT, TRACKER_REL)), plan: readJson(join(persistRoot() ?? REPO_ROOT, PLAN_REL)) ?? readJson(join(REPO_ROOT, PLAN_REL)) };
  const known = new Set(reg.profiles.map((p) => p.id));
  const profiles = reg.profiles.map((p) => ({ id: p.id, name: p.name || p.id, base: !!p.base, items: [], finished: 0, archived: 0 }));
  const prof = new Map(profiles.map((p) => [p.id, p]));
  for (const b of builds) {
    const home = prof.get(b.profiles.find((x) => known.has(x)) ?? BASE_PROFILE) ?? prof.get(BASE_PROFILE);
    if (b.status === 'complete') { home.finished += 1; continue; }
    if (b.status === 'archived') { home.archived += 1; continue; }
    if (!OPEN.includes(b.status)) continue;
    const it = judge(b, ev, ctx);
    // Deep mode reads what each open build is about (the console server strips this before the preview is saved)
    if (details && it.verdict === 'keep' && !it.locked) it.about = { detail: b.detail.slice(0, 600), branch: b.branch, pr: b.pr, category: b.category, createdAt: b.createdAt, steps: b.steps.slice(0, 15).map((x) => `${x.done ? '[x]' : '[ ]'} ${x.title || x.text}`.slice(0, 160)), notes: b.notes.slice(-3).map((x) => x.text.slice(0, 200)) };
    home.items.push(it);
  }
  for (const p of reg.profiles) {
    if (p.base) continue;
    for (const rel of [TRACKER_REL, PLAN_REL]) { const it = copyItem(p, rel, baseData); if (it) prof.get(p.id).items.push(it); }
  }
  for (const p of profiles) {
    p.items.sort((a, b) => VERDICTS.indexOf(b.verdict) - VERDICTS.indexOf(a.verdict) || a.title.localeCompare(b.title));
    p.totals = Object.fromEntries(VERDICTS.map((v) => [v, p.items.filter((i) => i.verdict === v).length]));
    p.open = p.items.filter((i) => i.kind === 'build').length;
    // nothing left to build once the clean-up is applied: flagged for Brett, never removed
    p.emptyAfter = !p.base && p.items.every((i) => i.kind !== 'build' || i.verdict !== 'keep');
  }
  const all = profiles.flatMap((p) => p.items);
  return {
    $axf: SCHEMA, at, mode: 'basic', storeRev: store.rev, mainRef: ev.ref,
    totals: { items: all.length, ...Object.fromEntries(VERDICTS.map((v) => [v, all.filter((i) => i.verdict === v).length])) },
    profiles,
    empty: profiles.filter((p) => p.emptyAfter).map((p) => p.id),
  };
}

// ------------------------------------------------------------------ previews and runs

export function savePlan(plan, run = newRunId()) {
  if (!RUN_ID.test(run)) throw new Error('bad run id');
  const out = { ...plan, run };
  writeJson(join(plansDir(), `${run}.json`), out);
  return out;
}
export const readPlan = (run) => (RUN_ID.test(run) ? readJson(join(plansDir(), `${run}.json`)) : null);
export const readRun = (run) => (RUN_ID.test(run) ? readJson(join(runsDir(), `${run}.json`)) : null);

export function listRuns(limit = 20) {
  const ids = new Set();
  for (const d of [plansDir(), runsDir()]) { try { for (const f of readdirSync(d)) if (f.endsWith('.json')) ids.add(f.slice(0, -5)); } catch { /* none yet */ } }
  return [...ids].filter((r) => RUN_ID.test(r)).sort().reverse().slice(0, limit).map((run) => {
    const p = readPlan(run); const r = readRun(run);
    return { run, at: p?.at ?? r?.at ?? '', mode: p?.mode ?? r?.mode ?? '', by: r?.by ?? '', totals: p?.totals ?? null,
      state: r ? (r.undoneAt ? 'undone' : 'applied') : 'preview', applied: r?.applied?.length ?? 0, skipped: r?.skipped?.length ?? 0, appliedAt: r?.at ?? '', undoneAt: r?.undoneAt ?? '' };
  });
}

const note = (text, at) => ({ text: text.slice(0, 2000), at });
const proofText = (p) => (!p ? '' : p.url ? ` (${p.label}: ${p.url})` : p.path ? ` (${p.label}: ${p.path})` : ` (${p.label})`);

/** Remove `from` only once its archive copy at `to` reads back the same. */
function unlinkAfterCopy(from, to) {
  if (readFileSync(from).equals(readFileSync(to))) rmSync(from);
  else throw new Error(`archive copy of ${from} does not match; nothing removed`);
}

function replan() {
  if (process.env.AXF_MAINT_NO_REPLAN === '1') return { ran: false, why: 'off (AXF_MAINT_NO_REPLAN)' };
  const r = spawnSync(process.execPath, [join(REPO_ROOT, 'framework/cli/builds-reconcile.mjs'), '--apply', '--brief'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120000 });
  return { ran: r.status === 0, why: r.status === 0 ? '' : `reconcile exited ${r.status ?? 'on timeout'}`, out: String(r.stdout ?? '').trim().split('\n').slice(-5).join('\n') };
}

/** Apply a saved preview. `skip` = keys Brett unticked. Builds changed since the preview, or running now, are skipped. */
export function apply(run, { skip = [], by = 'console', at = now() } = {}) {
  const plan = readPlan(run);
  if (!plan) throw new Error(`no preview ${run}`);
  if (readRun(run)) throw new Error(`run ${run} was already applied`);
  const skipSet = new Set(skip);
  const items = plan.profiles.flatMap((p) => p.items).filter((i) => i.verdict !== 'keep' && !i.locked);
  const picked = items.filter((i) => !skipSet.has(i.key));
  const record = { $axf: SCHEMA, run, at, by, mode: plan.mode, applied: [], skipped: items.filter((i) => skipSet.has(i.key)).map((i) => ({ key: i.key, why: 'unticked' })), files: [], empty: plan.empty ?? [] };
  const date = at.slice(0, 10);
  const builds = picked.filter((i) => i.kind === 'build');
  if (builds.length) {
    withStore((s) => {
      const byId = new Map(s.builds.map((b) => [b.id, b]));
      for (const it of builds) {
        const b = byId.get(it.id);
        if (!b || b.deleted) { record.skipped.push({ key: it.key, why: 'gone from the store' }); continue; }
        if (b.rev !== it.rev || b.status !== it.status) { record.skipped.push({ key: it.key, why: 'changed since the preview' }); continue; }
        if (LOCKED.includes(b.status)) { record.skipped.push({ key: it.key, why: `${b.status} now` }); continue; }
        const before = snap(b);
        const entry = { key: it.key, id: b.id, verdict: it.verdict, before };
        if (it.verdict === 'done') {
          b.status = 'complete'; b.builtAt = b.builtAt || at;
          b.notes.push(note(`Maintenance clean-up ${date}: done already. ${it.reason}${proofText(it.proof)}. Run ${run}.`, at));
        } else if (it.verdict === 'merge') {
          const t = byId.get(it.into);
          if (!t || t.deleted || LOCKED.includes(t.status) || ['complete', 'archived'].includes(t.status)) { record.skipped.push({ key: it.key, why: `merge target ${it.into} not open` }); continue; }
          entry.into = t.id; entry.intoBefore = snap(t);
          const ids = new Set(t.steps.map((x) => x.id));
          const moved = b.steps.filter((x) => !x.done && !x.skip);
          moved.forEach((x, i) => {
            let sid = `${b.id}-${x.id}`.slice(0, 40); while (ids.has(sid)) sid = `${sid.slice(0, 36)}-${i}`; ids.add(sid);
            t.steps.push(normStep({ ...x, id: sid, uid: '', rev: 1, origin: { build: b.id, step: x.id, how: 'merge' }, note: `Folded in from ${b.id} by the clean-up on ${date}.` }, t.steps.length, { now: at }));
          });
          t.notes.push(note(`Maintenance clean-up ${date}: folded in ${moved.length} open step(s) from ${b.id}. Run ${run}.`, at));
          b.status = 'archived';
          b.notes.push(note(`Maintenance clean-up ${date}: merged into ${t.id}. ${it.reason}. Run ${run}.`, at));
        } else {
          b.status = 'archived';
          b.notes.push(note(`Maintenance clean-up ${date}: archived as ${it.verdict === 'duplicate' ? 'a duplicate' : 'not needed'}. ${it.reason}${proofText(it.proof)}. Run ${run}.`, at));
        }
        record.applied.push(entry);
      }
      return s;
    }, { by: `maintenance:${by}`, action: 'profile-cleanup', note: `profile clean-up ${run}` });
    // the revisions the clean-up wrote: undo only puts back builds still at these
    const after = new Map(readStoreNow().builds.map((b) => [b.id, b.rev]));
    for (const e of record.applied) { e.afterRev = after.get(e.id); if (e.into) e.intoAfterRev = after.get(e.into); }
  }
  for (const it of picked.filter((i) => i.kind !== 'build')) {
    const pid = it.profiles[0];
    const rel = it.kind === 'tracker' ? TRACKER_REL : PLAN_REL;
    const from = profileFile(pid, rel);
    if (!existsSync(from)) { record.skipped.push({ key: it.key, why: 'file gone' }); continue; }
    const to = join(archiveDir(run), pid, rel);
    mkdirSync(dirname(to), { recursive: true });
    // archived, never deleted: a copied tracker moves into the run's archive; a copied plan is kept there and the
    // profile gets an empty plan (the profiled file stays in place)
    const empty = rel === PLAN_REL ? emptyProfileFile(rel, at) : null;
    writeFileSync(to, readFileSync(from));
    if (empty) writeJson(from, empty); else unlinkAfterCopy(from, to);
    record.files.push({ key: it.key, file: profileRel(pid, rel), archived: to, replaced: !!empty });
    record.applied.push({ key: it.key, id: it.id, verdict: it.verdict });
  }
  record.replan = replan();
  writeJson(join(runsDir(), `${run}.json`), record);
  return record;
}

/** Put a run back, once. Builds changed after the run are left as they are and listed. */
export function undo(run, { by = 'console', at = now() } = {}) {
  const r = readRun(run);
  if (!r) throw new Error(`no run ${run}`);
  if (r.undoneAt) throw new Error(`run ${run} was already undone`);
  const result = { restored: [], left: [], files: [] };
  const builds = r.applied.filter((e) => e.before);
  if (builds.length) {
    withStore((s) => {
      const idx = new Map(s.builds.map((b, i) => [b.id, i]));
      const put = (id, snap, rev) => {
        const i = idx.get(id);
        if (i === undefined) { result.left.push({ id, why: 'gone from the store' }); return false; }
        if (s.builds[i].rev !== rev) { result.left.push({ id, why: 'changed after the clean-up' }); return false; }
        s.builds[i] = normBuild(snap); return true;
      };
      for (const e of builds) {
        if (put(e.id, e.before, e.afterRev)) result.restored.push(e.id);
        if (e.into && e.intoBefore) { if (put(e.into, e.intoBefore, e.intoAfterRev)) result.restored.push(e.into); }
      }
      return s;
    }, { by: `maintenance:${by}`, action: 'profile-cleanup-undo', note: `undo profile clean-up ${run}` });
  }
  for (const f of r.files ?? []) {
    const dest = join(persistRoot() ?? REPO_ROOT, f.file);
    const src = f.archived;
    if (!existsSync(src)) { result.files.push({ file: f.file, put: false, why: 'archive copy missing' }); continue; }
    if (!f.replaced && existsSync(dest)) { result.files.push({ file: f.file, put: false, why: 'a new file is there now' }); continue; }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(src));
    result.files.push({ file: f.file, put: true });
  }
  r.undoneAt = at; r.undoneBy = by; r.undo = result;
  r.undo.replan = replan();
  writeJson(join(runsDir(), `${run}.json`), r);
  return r;
}

// ------------------------------------------------------------------ CLI

function arg(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const cmd = args[0] ?? 'audit';
  const out = (j, text) => console.log(json ? JSON.stringify(j) : text(j));
  try {
    if (cmd === 'audit') {
      let plan = audit({ details: args.includes('--details') });
      if (args.includes('--save')) plan = savePlan(plan);
      out(plan, (p) => [
        `Profile clean-up preview${p.run ? ` ${p.run}` : ''} (Basic, exact matches only): ${p.totals.items} items`,
        ...p.profiles.filter((x) => x.items.length).map((x) => `  ${x.name}: ${VERDICTS.map((v) => `${x.totals[v]} ${v}`).join(', ')}${x.emptyAfter ? '  (empty after the clean-up)' : ''}`),
        ...(p.run ? [`Apply: node ${'apps/console-web/plugins/maintenance/engine/profiles.mjs'} apply ${p.run}`] : ['Add --save to keep it as a preview you can apply.']),
      ].join('\n'));
    } else if (cmd === 'apply') {
      const r = apply(args[1], { skip: String(arg(args, '--skip') ?? '').split(',').filter(Boolean), by: arg(args, '--by') ?? 'cli' });
      out(r, (x) => `Applied ${x.applied.length}, skipped ${x.skipped.length}. Undo: … undo ${x.run}`);
    } else if (cmd === 'undo') {
      const r = undo(args[1], { by: arg(args, '--by') ?? 'cli' });
      out(r, (x) => `Put back ${x.undo.restored.length} build(s); left ${x.undo.left.length}; files ${x.undo.files.filter((f) => f.put).length}`);
    } else if (cmd === 'runs') {
      out(listRuns(), (l) => l.map((x) => `${x.run}  ${x.state.padEnd(7)} ${x.mode.padEnd(5)} ${x.totals?.items ?? 0} items, ${x.applied} applied`).join('\n') || 'No runs yet.');
    } else if (cmd === 'plan') {
      out(readPlan(args[1]) ?? { error: 'not found' }, (p) => JSON.stringify(p, null, 1));
    } else if (cmd === 'save') {
      // the console server's Deep mode hands its finished preview here (stdin) so every preview is saved one way
      const plan = JSON.parse(readFileSync(0, 'utf8'));
      out(savePlan(plan, plan.run && RUN_ID.test(plan.run) ? plan.run : newRunId()), (p) => p.run);
    } else {
      console.error('usage: profiles.mjs audit [--save] | apply <run> [--skip k,k] | undo <run> | runs | plan <run> [--json]');
      process.exit(2);
    }
  } catch (e) {
    if (json) console.log(JSON.stringify({ error: String(e.message ?? e) })); else console.error(String(e.message ?? e));
    process.exit(1);
  }
}


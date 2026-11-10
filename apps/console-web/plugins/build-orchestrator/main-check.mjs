/**
 * main-check.mjs — the orchestrator's one-build check against main (IO side of main-check-core.mjs).
 *
 * Replaces the bulk pending audit (Brett, Nov 10 2026: "just have the orchestrator check each one at a time before it puts
 * it in the queue"). pipeline.mjs calls check() right before queue() moves a build into the Queue and again when the
 * tick is about to dispatch it. Evidence comes from git on main (the build's branch, its PR, the paths its steps name),
 * the Shipped features ledger (shipped-manifest@1 sidecars) and the builds store; nothing here launches anything.
 *
 * Env: AXF_MAIN_CHECK=code|ai|off (wins over settings.mainCheck), AXF_MAIN_CHECK_GIT_DIR (the repo whose main is read;
 * default the repo this file is in), AXF_MAIN_CHECK_AI (tests: a command that reads the AI prompt on stdin).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as MC from './main-check-core.mjs';
import * as storeCore from '../../../../framework/plan/builds-store-core.mjs';
import { loadStore, withStore } from '../../../../framework/cli/builds-store.mjs';
import { branchHead, branchWork, landedCommitOf } from '../../../../framework/cli/shipped.mjs';
import { listManifests, readManifest, REPO_ROOT } from '../../../../framework/cli/shipped-files.mjs';

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const list = (v) => (Array.isArray(v) ? v : []);
const nowIso = () => new Date().toISOString();
const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };

export const gitDir = (env = process.env) => env.AXF_MAIN_CHECK_GIT_DIR || REPO_ROOT;
export function modeOf(settings = {}, env = process.env) { return MC.MODES.includes(env.AXF_MAIN_CHECK) ? env.AXF_MAIN_CHECK : MC.MODES.includes(settings.mainCheck) ? settings.mainCheck : 'code'; }

function git(args, env) {
  const r = spawnSync('git', args, { cwd: gitDir(env), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60e3 });
  return r.status === 0 ? r.stdout.trim() : null;
}
const mainOf = (env) => (git(['rev-parse', '--verify', '-q', 'origin/main'], env) ? 'origin/main' : 'main');
const prNumber = (v) => Number((/\/pull\/(\d+)/.exec(str(v, 300)) || /^#?(\d+)$/.exec(str(v, 300).trim()) || [])[1]) || 0;

/** Everything main says about one build (main-check-core.mjs "Evidence"); { unavailable, error } when git can't answer. */
export function gather(b, { env = process.env, store = null, withCommits = false } = {}) {
  const main = mainOf(env); const sha = git(['rev-parse', '--verify', '-q', main], env);
  if (!sha) return { unavailable: true, error: `git can't read main in ${gitDir(env)}` };
  const genv = { ...env, AXF_SHIPPED_GIT_DIR: gitDir(env) };
  const ev = { main: sha, mainRef: main, manifest: null, mergedPr: null, landed: null, paths: {}, ledger: [], commits: [] };
  // the build's own shipped manifest
  const m = readManifest(b.id, env);
  if (m) ev.manifest = { id: str(m.id, 120), pr: Number(m.pr?.number) || 0, landedCommit: str(m.landedCommit, 40), doneSteps: list(m.steps).filter((s) => s?.done).map((s) => str(s.text, 2000)) };
  // its PR, merged on main
  const pr = prNumber(b.pr);
  if (pr) {
    const hit = git(['log', main, '--first-parent', '-n3000', '-E', `--grep=(\\(#${pr}\\)|pull request #${pr})([^0-9]|$)`, '--format=%H'], env);
    if (hit) ev.mergedPr = { number: pr, commit: hit.split('\n')[0] };
  }
  if (!ev.mergedPr && b.mergedAt) ev.mergedPr = { number: pr, commit: '' };
  // its branch, landed on main (a branch with no commits of its own is just main: not landed)
  const head = branchHead(b.branch || `claude/${b.id}`, genv);
  if (head && head !== sha) {
    const landed = landedCommitOf(head, genv);
    if (landed) { const w = branchWork(head, landed, genv); if (w.commits.length) ev.landed = { commit: landed, head, files: w.files }; }
  }
  // every path an open step names, and the report
  const paths = new Set([MC.reportPathOf(b)]);
  for (const s of list(b.steps)) if (!s.done && !s.skip) for (const p of MC.pathsOf(s.text)) paths.add(p);
  for (const p of [...paths].slice(0, 40)) {
    const onMain = git(['cat-file', '-e', `${main}:${p}`], env) !== null;
    ev.paths[p] = { onMain, addedAt: onMain ? (git(['log', main, '--diff-filter=A', '--format=%cI', '-1', '--', p], env) || '') : '' };
  }
  // the Shipped features ledger, and landed builds in the store
  for (const x of listManifests(env)) ev.ledger.push({ build: str(x.build?.id, 120), title: str(x.build?.title, 300), landedAt: str(x.landedAt || x.shippedAt, 40), landedCommit: str(x.landedCommit, 40), pr: Number(x.pr?.number) || 0, source: 'shipped' });
  const s = store ?? loadStore();
  for (const o of s.builds) {
    if (o.deleted || o.id === b.id || o.kind === 'epic' || !['complete', 'built'].includes(o.status) || ev.ledger.some((e) => e.build === o.id)) continue;
    ev.ledger.push({ build: o.id, title: str(o.title, 300), landedAt: str(o.mergedAt || o.builtAt, 40), landedCommit: '', pr: prNumber(o.pr), source: 'store' });
  }
  if (withCommits) {
    const w = MC.words(b.title).slice(0, 6);
    if (w.length) ev.commits = (git(['log', main, '-n400', '--no-merges', '--format=%h %s', '-i', '-E', `--grep=${w.join('|')}`], env) || '').split('\n').filter((l) => l && !/Builds live:/.test(l)).slice(0, 15);
  }
  return ev;
}

/** The AI pass (settings.mainCheck = 'ai'), asked only when code found nothing. `ask(prompt)` → { text, error }. */
export function aiPass(b, ev, ask, env = process.env) {
  let text = '';
  if (env.AXF_MAIN_CHECK_AI) { const r = spawnSync('bash', ['-c', env.AXF_MAIN_CHECK_AI], { input: MC.aiPrompt(b, ev), encoding: 'utf8', timeout: 180e3, env }); text = r.status === 0 ? r.stdout : ''; }
  else if (typeof ask === 'function') { const r = ask(MC.aiPrompt(b, ev)); text = r?.error ? '' : str(r?.text, 20000); }
  const ai = MC.parseAi(text); if (!ai) return { ai: null, onMain: false };
  const onMain = !!ai.commit && /^[0-9a-f]{7,40}$/i.test(ai.commit) && spawnSync('git', ['merge-base', '--is-ancestor', ai.commit, ev.mainRef], { cwd: gitDir(env), timeout: 30e3 }).status === 0;
  return { ai, onMain };
}

/** Write the verdict to the store: tick the steps with evidence; done / superseded = closed and archived. */
export function applyVerdict(id, r, { by = 'orchestrator', stage = 'queue' } = {}) {
  let out = null;
  withStore((s) => {
    const b = storeCore.findBuild(s, id); if (!b) return s;
    const now = nowIso(); const ticks = new Map(list(r.ticks).map((t) => [t.id, t.why]));
    for (const st of b.steps) if (!st.done && ticks.has(st.id)) { st.done = true; st.doneAt = now; st.note = str(`on main: ${ticks.get(st.id)}`, 300); }
    const link = [r.pr ? `PR #${r.pr}` : '', r.commit ? `commit ${r.commit.slice(0, 12)}` : ''].filter(Boolean).join(', ');
    if (r.verdict === 'done' || r.verdict === 'superseded') {
      if (r.pr && !b.pr) b.pr = String(r.pr);
      b.status = 'archived'; b.builtAt = b.builtAt || now;
      if (b.pipeline) b.pipeline = { ...b.pipeline, queuedAt: '', queuedBy: '', note: str(`closed by the main check: ${r.verdict}`, 400) };
      b.notes.push({ text: str(`Main check (${stage}): ${r.verdict === 'done' ? 'already done on main' : 'superseded'}: ${r.why}${link ? ` (${link})` : ''}. Closed and archived instead of queued.`, 2000), at: now });
    } else if (r.verdict === 'partial') {
      b.notes.push({ text: str(`Main check (${stage}): ${r.why}. Ticked ${list(r.ticks).map((t) => `${t.id} (${t.why})`).join('; ')}. Only what is left is queued.`, 2000), at: now });
    }
    b.updatedAt = now; out = b; return s;
  }, { by, action: `pipeline:main-check:${r.verdict}`, note: id });
  return out;
}

// ------------------------------------------------------------------ the record (state readable without the UI)

export const checksFile = (dir) => join(dir, 'main-checks.json');
export function loadChecks(dir) { const j = readJson(checksFile(dir), {}); return j && typeof j === 'object' && j.builds && typeof j.builds === 'object' ? j : { $axf: 'pipeline-main-checks@1', builds: {} }; }

/**
 * Check one build against main. apply=false = dry (what it would do). Returns
 * { id, verdict, why, ticks, pr, commit, mode, stage, at, main, applied, queue: may it go on to the Queue / dispatch }.
 * `cache` = skip the git work when the last check saw the same main and the same open steps (the dispatch re-check).
 */
export function check(id, { apply = true, stage = 'queue', by = 'orchestrator', settings = {}, env = process.env, dir = '', ask = null, cache = false, writeRecord = null } = {}) {
  const store = loadStore(); const b = storeCore.findBuild(store, id);
  if (!b) throw Object.assign(new Error(`no build "${id}"`), { code: 2 });
  const mode = modeOf(settings, env);
  const base = { id: b.id, mode, stage, at: nowIso(), applied: false };
  if (mode === 'off') return { ...base, verdict: 'unknown', why: 'main check is off', ticks: [], pr: 0, commit: '', main: '', queue: true };
  const openKey = list(b.steps).filter((s) => !s.done && !s.skip).map((s) => s.id).join(',');
  if (cache && dir) {
    const last = loadChecks(dir).builds[b.id];
    const sha = git(['rev-parse', '--verify', '-q', mainOf(env)], env);
    if (last && sha && last.main === sha && last.open === openKey && ['open', 'unknown'].includes(last.verdict)) return { ...base, ...last, stage, cached: true, applied: false, queue: true };
  }
  const ev = gather(b, { env, store, withCommits: mode === 'ai' });
  let r = MC.decide(b, ev);
  if (mode === 'ai' && r.verdict === 'open') { const a = aiPass(b, ev, ask, env); if (a.ai) r = MC.decide(b, { ...ev, aiCommitOnMain: a.onMain }, { ai: a.ai }); }
  const res = { ...base, ...r, main: ev.main || '', open: openKey, queue: !['done', 'superseded'].includes(r.verdict) };
  if (apply && ['done', 'superseded', 'partial'].includes(r.verdict)) { applyVerdict(b.id, r, { by, stage }); res.applied = true; }
  if (apply && dir && typeof writeRecord === 'function') {
    const all = loadChecks(dir); all.builds[b.id] = { verdict: res.verdict, why: res.why, ticks: res.ticks, pr: res.pr, commit: res.commit, by: res.by || '', mode, stage, at: res.at, main: res.main, open: res.applied ? list(storeCore.findBuild(loadStore(), b.id)?.steps).filter((s) => !s.done && !s.skip).map((s) => s.id).join(',') : openKey };
    const keep = Object.entries(all.builds).sort((x, y) => str(y[1].at).localeCompare(str(x[1].at))).slice(0, 300);
    writeRecord(checksFile(dir), { $axf: 'pipeline-main-checks@1', builds: Object.fromEntries(keep) });
  }
  return res;
}

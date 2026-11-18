#!/usr/bin/env node
/**
 * combine — the split run's combine step (split-plan@1, framework/spec/BUILD-SPLIT.md → Combine).
 *
 * When every part of a split run is done (the run rolled up to `combining`), the part branches are merged, in part
 * order, into ONE combine branch (claude/<build>) made fresh from the sha main was locked on. All or nothing: a part
 * that is not done, a part without a pushed head, or a merge clash marks the run failed; nothing is pushed, nothing
 * lands, and main is unlocked so the next build may start. A clean combine is pushed and its head recorded; the
 * landing hand-off (landing.mjs) takes it from there.
 *
 *   node combine.mjs run <build> [--json]        combine now (the dispatcher calls it every tick for a combining run)
 *   node combine.mjs fail <build> --why "…"       fail the run by hand: nothing lands, main unlocked
 *
 * Environment: AXF_COMBINE_GIT (the clone to combine in; default the repo), AXF_COMBINE_REMOTE (origin),
 * AXF_COMBINE_PUSH=off (no push: tests), AXF_PIPELINE_WORKTREES (where the combine worktree goes).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../../../../framework/core/build-split.mjs';
import * as storeCore from '../../../../framework/plan/builds-store-core.mjs';
import { loadStore, withStore } from '../../../../framework/cli/builds-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '../../../..');
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const nowIso = () => new Date().toISOString();
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8', timeout: 180e3 });

/**
 * Merge part heads into one branch (git only, no store): a worktree at `dir` on `branch` reset to `base`, each part's
 * head merged with --no-ff in order. → { ok, head, merged: [part id…], clash: { part, files[] } | null, why }
 * On a clash the merge is aborted and the worktree left on the last good commit (never pushed).
 */
export function combineBranches({ repo = REPO_ROOT, dir, base, branch, parts, remote = 'origin', fetch = true, push = true }) {
  const fail = (why, extra = {}) => ({ ok: false, head: '', merged: [], clash: null, why, ...extra });
  if (!S.SHA_RE.test(base || '')) return fail('no base sha');
  if (fetch) git(repo, 'fetch', '-q', remote, ...parts.map((p) => `+refs/heads/${p.branch}:refs/remotes/${remote}/${p.branch}`));
  for (const p of parts) if (git(repo, 'cat-file', '-e', `${p.head}^{commit}`).status !== 0) return fail(`${p.id}: head ${p.head.slice(0, 12)} is not in ${repo} (not pushed?)`, { clash: { part: p.id, files: [] } });
  if (existsSync(dir)) { git(repo, 'worktree', 'remove', '--force', dir); rmSync(dir, { recursive: true, force: true }); }
  mkdirSync(dirname(dir), { recursive: true });
  const wt = git(repo, 'worktree', 'add', '--force', '-B', branch, dir, base);
  if (wt.status !== 0) return fail(`combine worktree: ${(wt.stderr || wt.stdout).trim().slice(0, 300)}`);
  const merged = [];
  for (const p of parts) {
    const m = git(dir, '-c', 'user.name=AXF combine', '-c', 'user.email=combine@axf.local', 'merge', '--no-ff', '--no-edit', '-m', `combine ${p.id} (${p.branch})`, p.head);
    if (m.status !== 0) {
      const files = git(dir, 'diff', '--name-only', '--diff-filter=U').stdout.split('\n').map((x) => x.trim()).filter(Boolean);
      git(dir, 'merge', '--abort');
      return { ok: false, head: '', merged, clash: { part: p.id, files }, why: `${p.id} (${p.branch}) clashes with ${merged.length ? merged.join(', ') : 'the base'}${files.length ? ` in ${files.slice(0, 8).join(', ')}` : ''}` };
    }
    merged.push(p.id);
  }
  const head = git(dir, 'rev-parse', 'HEAD').stdout.trim();
  if (push) {
    const r = git(dir, 'push', '--force-with-lease', remote, `HEAD:refs/heads/${branch}`);
    if (r.status !== 0) return fail(`push ${branch}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`, { merged });
  }
  return { ok: true, head, merged, clash: null, why: '' };
}

/** Stop a part session that still runs (best effort; tmux off in tests). */
function stopSession(session, env = process.env) {
  if (!session || env.AXF_SLOTS_TMUX === 'off' || !/^axf-[A-Za-z0-9._-]+$/.test(session)) return false;
  return spawnSync('tmux', ['kill-session', '-t', `=${session}`], { encoding: 'utf8' }).status === 0;
}

/**
 * Fail a split run (all or nothing): the run goes failed with why (every waiting part abandoned), every part session
 * still running is stopped, the build goes to the status its failed run maps onto (fixing: done-means-merged@1's
 * retry ladder takes it from there), and main is unlocked. Journalled. → { id, splitId, why, stopped: [session…] }
 */
export function failRun(id, why, { part = '', by = 'combine', env = process.env, at = nowIso() } = {}) {
  const out = { id, splitId: '', why: str(why, 300), stopped: [] };
  withStore((s) => {
    const b = storeCore.findBuild(s, id); if (!b?.split) throw Object.assign(new Error(`${id} has no split plan`), { code: 2 });
    let plan = b.split; out.splitId = plan.id;
    if (!S.RUN_TERMINAL.includes(plan.run)) { const r = S.runNext(plan, 'failed', { at, part, why: out.why }); if (r.ok) plan = r.plan; }
    for (const p of plan.parts) if (['building', 'testing'].includes(p.status) && p.session) { if (stopSession(p.session, env)) out.stopped.push(p.session); }
    b.split = S.normSplit(plan, { build: b.id });
    b.status = S.buildStatusOf('failed') || 'fixing';
    b.notes.push({ text: `Split run ${plan.id} failed: ${out.why}. Nothing landed; main is unlocked.`, at });
    if (b.pipeline) b.pipeline = { ...b.pipeline, session: '', note: `split run failed: ${out.why}` };
    b.updatedAt = at;
    const u = S.unlockMain(s.meta, { build: b.id, force: true }); if (u.ok) s.meta = u.meta;
    return s;
  }, { by, action: 'split:run-failed', note: `${id}: ${out.why}` });
  return out;
}

/**
 * The combine step for one build: its run must be `combining` with every part done (combineReady). Merges the part
 * heads into claude/<build> from the plan's base; a clash fails the run (failRun). A clean combine records the head
 * on the plan (combine.head) and stays `combining` for the landing hand-off. → { id, ok, head, why, clash }
 */
export function combineRun(id, { env = process.env, by = 'combine' } = {}) {
  const b = storeCore.findBuild(loadStore(), id); if (!b?.split) throw Object.assign(new Error(`${id} has no split plan`), { code: 2 });
  const plan = b.split;
  if (plan.run === 'failed') return { id, ok: false, head: '', why: plan.failure?.why || 'the run failed', clash: null };
  if (plan.run !== 'combining') return { id, ok: false, head: '', why: `the run is ${plan.run}, not combining`, clash: null, skipped: true };
  if (S.SHA_RE.test(plan.combine.head)) return { id, ok: true, head: plan.combine.head, why: 'combined already', clash: null, skipped: true };
  const ready = S.combineReady(plan);
  if (!ready.ok) { failRun(id, `not every part is done: ${ready.why}`, { by, env }); return { id, ok: false, head: '', why: ready.why, clash: null }; }
  const repo = env.AXF_COMBINE_GIT || REPO_ROOT;
  const dir = join(env.AXF_PIPELINE_WORKTREES || '/root/axf-builds', `${id}--combine`);
  const r = combineBranches({ repo, dir, base: plan.base, branch: plan.combine.branch, parts: plan.parts.map((p) => ({ id: p.id, branch: p.branch, head: p.head })), remote: env.AXF_COMBINE_REMOTE || 'origin', fetch: env.AXF_COMBINE_PUSH !== 'off', push: env.AXF_COMBINE_PUSH !== 'off' });
  if (!r.ok) { failRun(id, r.clash ? `combine clash: ${r.why}` : `combine failed: ${r.why}`, { part: r.clash?.part ?? '', by, env }); return { id, ok: false, head: '', why: r.why, clash: r.clash }; }
  withStore((s) => {
    const rec = storeCore.findBuild(s, id);
    rec.split = S.normSplit({ ...rec.split, combine: { ...rec.split.combine, head: r.head, note: `combined ${r.merged.join(', ')} onto ${plan.base.slice(0, 12)}` } }, { build: rec.id });
    rec.branch = plan.combine.branch;
    rec.notes.push({ text: `Split run ${plan.id}: combined ${r.merged.length} part${r.merged.length === 1 ? '' : 's'} into ${plan.combine.branch} @ ${r.head.slice(0, 12)}.`, at: nowIso() });
    if (rec.status !== 'landing') rec.status = S.buildStatusOf('combining');
    rec.updatedAt = nowIso();
    return s;
  }, { by, action: 'split:combined', note: `${id} @ ${r.head.slice(0, 12)}` });
  return { id, ok: true, head: r.head, why: '', clash: null, merged: r.merged };
}

/**
 * Every split run the dispatcher looks after this tick: a run that rolled up to failed (a part out of rebuilds) is
 * failed whole (sessions stopped, main unlocked); a combining run with no combine head is combined.
 * → { combined: [id…], failed: [{ id, why }] }
 */
export function combineTick({ env = process.env, by = 'dispatcher' } = {}) {
  const out = { combined: [], failed: [] };
  for (const b of loadStore().builds.filter((x) => !x.deleted && x.split)) {
    const run = b.split.run;
    if (run === 'failed' && ['running', 'landing'].includes(b.status)) { const f = failRun(b.id, b.split.failure?.why || 'a part failed for good', { part: b.split.failure?.part ?? '', by, env }); out.failed.push({ id: b.id, why: f.why }); continue; }
    if (run === 'combining' && !S.SHA_RE.test(b.split.combine.head) && b.split.parts.length > 1) {
      try { const r = combineRun(b.id, { env, by }); if (r.ok) out.combined.push(b.id); else if (!r.skipped) out.failed.push({ id: b.id, why: r.why }); }
      catch (e) { out.failed.push({ id: b.id, why: str(e.message, 300) }); }
    }
  }
  return out;
}

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] ?? '' : ''; };
  const [cmd, id] = args;
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  if (cmd === 'run' && id) { const r = combineRun(id); process.exitCode = r.ok ? 0 : 1; return out(r, r.ok ? `${id}: combined @ ${r.head.slice(0, 12)}` : `${id}: ${r.why}`); }
  if (cmd === 'fail' && id) { const r = failRun(id, opt('why') || 'failed by hand', { by: process.env.AXF_ACTOR || 'cli' }); return out({ ok: true, ...r }, `${id}: run ${r.splitId} failed (${r.why}); main unlocked`); }
  if (cmd === 'tick') { const r = combineTick(); return out({ ok: true, ...r }, `combined ${r.combined.join(', ') || 'none'} · failed ${r.failed.map((f) => f.id).join(', ') || 'none'}`); }
  console.error('usage: combine.mjs run <build> | fail <build> --why "…" | tick'); process.exitCode = 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = e.code === 2 ? 2 : 1; });

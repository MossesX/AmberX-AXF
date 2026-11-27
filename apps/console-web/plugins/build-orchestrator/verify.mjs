#!/usr/bin/env node
/**
 * Feature verify after merge (done-means-merged@1, framework/spec/DONE-MEANS-MERGED.md; build
 * server-rule-done-means-merged-working). A build is `complete` only once it is landed (merged, CI green on the merge
 * commit) AND its feature verify passed. This runs the build's verify against main at its merge commit:
 *
 *   - the commands: the build's `verify` (a command or a list), else its steps' `checks` that are commands, else the
 *     check / test commands its steps name (`node framework/spec/check-….mjs`, `python apps/…/test.py`), at most 8;
 *   - where: a detached worktree of the merge commit (landed.sha), never the build's own worktree;
 *   - pass → landed.verifiedAt / verifyHow / verifyLog, status complete (the store guard checks the evidence);
 *   - fail → a ci-red failure on the build (status fixing, head = the merge commit): the dispatcher's ladder answers it;
 *   - no command at all → verifyHow `deploy`: CI green on the merge commit is the verify, said so in verifyLog.
 *
 *   node apps/console-web/plugins/build-orchestrator/verify.mjs list [--json]              landed builds waiting for their verify
 *   node apps/console-web/plugins/build-orchestrator/verify.mjs plan <build> [--json]      what would run
 *   node apps/console-web/plugins/build-orchestrator/verify.mjs run [<build>] [--dry-run] [--json]
 *
 * The dispatcher's tick starts `run` in the background when a landed build waits (kickVerify, one at a time).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as storeCore from '../../../../framework/plan/builds-store-core.mjs';
import * as BP from '../../../../framework/core/build-pipeline.mjs';
import { loadStore, withStore } from '../../../../framework/cli/builds-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '../../../..');
export const SCHEMA = 'build-verify@1';
const MAX_COMMANDS = 8;
const CMD_TIMEOUT_MS = 5 * 60e3;
const str = (v, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const isCommand = (c) => /^(node|npx|python3?|bash) \S/.test(str(c));
const CMD_IN_TEXT = /`?((?:node|python3?) (?:framework|apps)\/[\w./-]+?(?:check|test)[\w.-]*\.(?:mjs|js|py)(?: [\w.=/-]+)*)`?/g;

// ------------------------------------------------------------------ pure

/** What verifies a build → { $axf, how: 'check' | 'deploy', commands, from: 'verify' | 'checks' | 'steps' | '' }. */
export function verifyPlan(b) {
  const x = b && typeof b === 'object' ? b : {};
  const uniq = (l) => [...new Set(l.map((c) => str(c, 300)).filter(isCommand))].slice(0, MAX_COMMANDS);
  const own = uniq(Array.isArray(x.verify) ? x.verify : [x.verify]);
  if (own.length) return { $axf: SCHEMA, how: 'check', commands: own, from: 'verify' };
  const steps = Array.isArray(x.steps) ? x.steps.filter((s) => !s?.skip) : [];
  const checks = uniq(steps.flatMap((s) => (Array.isArray(s?.checks) ? s.checks : [])));
  if (checks.length) return { $axf: SCHEMA, how: 'check', commands: checks, from: 'checks' };
  const named = uniq(steps.flatMap((s) => [...String(s?.text || '').matchAll(CMD_IN_TEXT)].map((m) => m[1])));
  if (named.length) return { $axf: SCHEMA, how: 'check', commands: named, from: 'steps' };
  return { $axf: SCHEMA, how: 'deploy', commands: [], from: '' };
}

/** Landed builds whose verify has not passed: merged, CI green on the merge commit recorded, no verifiedAt, not fixing. */
export function waiting(builds) {
  return (Array.isArray(builds) ? builds : []).filter((b) => b && !b.deleted && ['landed', 'built'].includes(b.status) && b.landed?.sha && b.landed?.ci === 'success' && !b.landed?.verifiedAt);
}

// ------------------------------------------------------------------ IO

function git(args, cwd = REPO_ROOT, timeout = 180e3) { const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout }); return { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }; }

/** Run the plan in a detached worktree of `sha` → { ok, how, log, results: [{ cmd, code, tail }] }. */
export function runPlan(plan, sha, { env = process.env, dry = false } = {}) {
  if (!plan.commands.length) return { ok: true, how: 'deploy', log: 'No verify command: CI green on the merge commit is the verify.', results: [] };
  if (dry) return { ok: true, how: plan.how, log: `dry run: ${plan.commands.join(' ; ')}`, results: [], dry: true };
  git(['fetch', '-q', 'origin', 'main']);
  const dir = mkdtempSync(join(tmpdir(), 'axf-verify-')); const wt = join(dir, 'wt');
  const results = [];
  try {
    const a = git(['worktree', 'add', '-q', '--detach', wt, sha]);
    if (a.code) return { ok: false, how: plan.how, log: `could not check out ${sha.slice(0, 10)}: ${a.err.slice(-200)}`, results };
    for (const cmd of plan.commands) {
      const r = spawnSync('bash', ['-lc', cmd], { cwd: wt, encoding: 'utf8', timeout: CMD_TIMEOUT_MS, env: { ...env, AXF_BUILDS_LIVE: '0', AXF_DATA_DIR: 'off' } });
      const tail = `${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n').slice(-3).join(' | ').slice(-240);
      results.push({ cmd, code: r.status ?? 1, tail });
      if (r.status !== 0) break;
    }
  } finally { git(['worktree', 'remove', '--force', wt]); rmSync(dir, { recursive: true, force: true }); }
  const bad = results.find((x) => x.code !== 0);
  return { ok: !bad, how: plan.how, log: bad ? `${bad.cmd} failed (exit ${bad.code}): ${bad.tail}` : `${results.length} check${results.length === 1 ? '' : 's'} passed on ${sha.slice(0, 10)}: ${results.map((x) => x.cmd).join(' ; ')}`.slice(0, 300), results };
}

/** Write the verdict: pass → evidence + complete (through the guard); fail → a ci-red failure (fixing). */
export function record(id, verdict, { by = 'verify', at = new Date().toISOString() } = {}) {
  let status = '';
  withStore((s) => {
    const b = storeCore.findBuild(s, id); if (!b) throw new Error(`no build "${id}"`);
    const sha = b.landed?.sha || '';
    if (verdict.ok) {
      b.landed = { ...(b.landed ?? {}), verifiedAt: at, verifyHow: verdict.how, verifyLog: str(verdict.log, 300) };
      const g = storeCore.guardedStatus(b, 'complete', { at, by });
      Object.assign(b, g.build);
      if (g.ok) b.notes.push({ text: `Verified on main (${verdict.how}): ${str(verdict.log, 400)}. Complete: merged, CI green, verified.`, at });
    } else {
      b.failure = BP.normFailure({ kind: 'ci-red', at, why: `the feature verify failed on main: ${str(verdict.log, 400)}`, head: sha, step: '' });
      b.status = 'fixing'; b.builtAt = '';
      b.notes.push({ text: `Fixing: the feature verify failed on main at ${sha.slice(0, 10)} (${str(verdict.log, 400)}). The server retries on its ladder.`, at });
    }
    b.updatedAt = at; status = b.status;
    return s;
  }, { by, action: verdict.ok ? 'verify:pass' : 'verify:fail', note: id });
  return status;
}

/** One verify run at a time on the VPS: the lock file (stale after 30 min). */
export const lockFile = (env = process.env) => env.AXF_VERIFY_LOCK || join(tmpdir(), 'axf-build-verify.lock');
export function locked(env = process.env, now = Date.now()) { try { return now - statSync(lockFile(env)).mtimeMs < 30 * 60e3; } catch { return false; } }

/** Verify one build or every waiting one → [{ id, ok, status, how, log }]. */
export function run({ id = '', dry = false, env = process.env } = {}) {
  if (!dry && !id) {
    if (locked(env)) return [];
    writeFileSync(lockFile(env), String(process.pid));
    try { return runAll({ dry, env }); } finally { rmSync(lockFile(env), { force: true }); }
  }
  return runAll({ id, dry, env });
}
function runAll({ id = '', dry = false, env = process.env } = {}) {
  const store = loadStore();
  const list = id ? [storeCore.findBuild(store, id)].filter(Boolean) : waiting(store.builds);
  if (id && !list.length) throw Object.assign(new Error(`no build "${id}"`), { code: 2 });
  const out = [];
  for (const b of list) {
    if (!b.landed?.sha || b.landed?.ci !== 'success') { out.push({ id: b.id, ok: false, status: b.status, how: '', log: 'not landed yet: no merge commit with green CI on record' }); continue; }
    const v = runPlan(verifyPlan(b), b.landed.sha, { env, dry });
    const status = dry ? b.status : record(b.id, v);
    out.push({ id: b.id, ok: v.ok, status, how: v.how, log: v.log });
  }
  return out;
}

// ------------------------------------------------------------------ CLI

async function main(argv) {
  const json = argv.includes('--json'); const dry = argv.includes('--dry-run');
  const [cmd = 'list', id = ''] = argv.filter((a) => !a.startsWith('--'));
  const say = (o, text) => console.log(json ? JSON.stringify(o) : text);
  if (cmd === 'list') { const w = waiting(loadStore().builds); return say({ ok: true, waiting: w.map((b) => ({ id: b.id, sha: b.landed.sha, plan: verifyPlan(b) })) }, w.map((b) => `${b.id} @ ${b.landed.sha.slice(0, 10)}: ${verifyPlan(b).commands.join(' ; ') || '(CI is the verify)'}`).join('\n') || 'nothing waits for its verify'); }
  if (cmd === 'plan' && id) { const b = storeCore.findBuild(loadStore(), id); if (!b) { process.exitCode = 2; return say({ ok: false, error: `no build "${id}"` }, `no build "${id}"`); } const p = verifyPlan(b); return say({ ok: true, plan: p }, `${id}: ${p.how}${p.from ? ` (from ${p.from})` : ''}\n${p.commands.join('\n')}`); }
  if (cmd === 'run') { const r = run({ id, dry }); if (r.some((x) => !x.ok)) process.exitCode = 1; return say({ ok: r.every((x) => x.ok), results: r }, r.map((x) => `${x.ok ? 'pass' : 'FAIL'} ${x.id} → ${x.status}: ${x.log}`).join('\n') || 'nothing to verify'); }
  process.exitCode = 2; say({ ok: false, error: 'usage: verify.mjs list | plan <build> | run [<build>] [--dry-run]' }, 'usage: verify.mjs list | plan <build> | run [<build>] [--dry-run]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((e) => { console.error(e?.message ?? e); process.exitCode = e?.code === 2 ? 2 : 1; });

// node --test deploy/lander/test/run.test.mjs — the lander end to end: real git (a bare origin), a fake GitHub, an
// in-memory builds store. No network, no model, no console.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AXF_CREW_SAY = 'off';
const { tick, status } = await import('../run.mjs');
const { makeGit } = await import('../git.mjs');
const { memoryStore } = await import('../store.mjs');
const L = await import('../lander-core.mjs');

const sh = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };

/** A bare origin with main and one branch per step; a working clone the lander runs in. */
function repo(steps) {
  const dir = mkdtempSync(join(tmpdir(), 'lander-run-'));
  const origin = join(dir, 'origin.git'); const work = join(dir, 'work');
  sh(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(dir, 'clone', '-q', origin, work);
  for (const [k, v] of [['user.name', 't'], ['user.email', 't@t'], ['commit.gpgsign', 'false']]) sh(work, 'config', k, v);
  writeFileSync(join(work, 'base.txt'), 'base\n'); writeFileSync(join(work, 'shared.txt'), 'one\ntwo\nthree\n');
  sh(work, 'add', '-A'); sh(work, 'commit', '-q', '-m', 'base'); sh(work, 'push', '-q', 'origin', 'HEAD:main');
  for (const [branch, files] of Object.entries(steps)) {
    sh(work, 'checkout', '-q', '-B', branch, 'origin/main');
    for (const [f, t] of Object.entries(files)) { mkdirSync(dirname(join(work, f)), { recursive: true }); writeFileSync(join(work, f), t); }
    sh(work, 'add', '-A'); sh(work, 'commit', '-q', '-m', `${branch} work`); sh(work, 'push', '-q', 'origin', `HEAD:${branch}`);
  }
  sh(work, 'checkout', '-q', '--detach', 'origin/main');
  sh(work, 'fetch', '-q', 'origin');
  return { dir, origin, work, s: { repo: work, slug: 'o/r', dataDir: join(dir, 'data'), api: '', remote: 'origin', base: 'main' } };
}

/** A fake GitHub: PRs, check runs per head (ci(head) → 'success' | 'failure' | 'running' | 'none'), merges done in git. */
function github(r, ci = () => 'success') {
  const prs = new Map(); let next = 1; const calls = [];
  const gh = async (method, path, body) => {
    calls.push(`${method} ${path.replace(/^\/repos\/o\/r/, '')}`);
    let m;
    if (method === 'GET' && (m = path.match(/\/pulls\?state=open&head=[^:]+%3A(.+)$/))) { const h = decodeURIComponent(m[1]); return [...prs.values()].filter((p) => p.head.ref === h && p.state === 'open'); }
    if (method === 'POST' && path.endsWith('/pulls')) { const p = { number: next++, state: 'open', head: { ref: body.head }, title: body.title, body: body.body, mergeable: true }; prs.set(p.number, p); return p; }
    if (method === 'GET' && (m = path.match(/\/pulls\/(\d+)$/))) return prs.get(Number(m[1])) || null;
    if (method === 'PATCH' && (m = path.match(/\/pulls\/(\d+)$/))) { const p = prs.get(Number(m[1])); Object.assign(p, body); return p; }
    if (method === 'GET' && (m = path.match(/\/commits\/([0-9a-f]+)\/check-runs/))) {
      const c = ci(m[1]);
      if (c === 'none') return { check_runs: [] };
      if (c === 'running') return { check_runs: [{ status: 'in_progress', name: 'tests' }] };
      return { check_runs: [{ status: 'completed', conclusion: c, name: 'tests', details_url: 'https://github.com/o/r/actions/runs/42/job/1' }] };
    }
    if (method === 'PUT' && (m = path.match(/\/pulls\/(\d+)\/merge$/))) {
      const p = prs.get(Number(m[1]));
      sh(r.work, 'fetch', '-q', 'origin');
      assert.equal(sh(r.work, 'rev-parse', `origin/${p.head.ref}`), body.sha, 'the merge is pinned to the tested head');
      sh(r.work, 'checkout', '-q', '--detach', 'origin/main');
      sh(r.work, 'merge', '-q', '--no-ff', '-m', `Merge #${p.number}`, `origin/${p.head.ref}`);
      sh(r.work, 'push', '-q', 'origin', 'HEAD:main'); sh(r.work, 'fetch', '-q', 'origin');
      p.state = 'closed'; p.merged = true; p.merged_at = '2026-11-19T12:00:00Z';
      return { merged: true };
    }
    if (method === 'POST' && /rerun-failed-jobs|dispatches/.test(path)) return null;
    throw new Error(`fake GitHub: ${method} ${path}`);
  };
  gh.prs = prs; gh.calls = calls;
  return gh;
}

const build = (steps, extra = {}) => ({ id: 'b', title: 'Build B', status: 'build-complete', steps: steps.map(([id, branch]) => ({ id, status: 'completed', branch, title: id })), ...extra });
const clock = (start = Date.parse('2026-11-19T12:00:00Z')) => { let t = start; const f = () => new Date(t).toISOString(); f.add = (min) => { t += min * 60000; }; return f; };
const onMain = (r, f) => { sh(r.work, 'fetch', '-q', 'origin'); return spawnSync('git', ['cat-file', '-e', `origin/main:${f}`], { cwd: r.work }).status === 0; };
const statuses = (b) => (b.statusLog || []).map((x) => x.status);
const base = (r, gh, store, now, more = {}) => ({ s: r.s, git: makeGit(r.work), gh, store, now, cfg: L.normConfig({}), buildRules: () => ({ ok: true, failing: [], fixed: [] }), agentJob: () => ({ exit: 0, session: 'fixer' }), say: () => {}, ...more });

test('every step lands in ONE PR: merging-pr → pr-pulling-main → running-ci → merging-main → landed', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' }, 'claude/b-s2': { 'b.txt': 'b\n' }, 'claude/b-s3': { 'c.txt': 'c\n' } });
  const gh = github(r); const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1'], ['s2', 'claude/b-s2'], ['s3', 'claude/b-s3']])], { now });
  const out = await tick(base(r, gh, store, now));
  assert.equal(out.error, '');
  const b = store.list[0];
  assert.equal(b.status, 'landed');
  assert.deepEqual(statuses(b), ['merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main', 'landed']);
  assert.equal(gh.prs.size, 1, 'one PR for the whole build');
  assert.deepEqual(b.steps.map((s) => [s.status, s.prNumber]), [['in-pr', 1], ['in-pr', 1], ['in-pr', 1]]);
  assert.ok(b.statusLog.every((x) => x.at && x.by === 'lander'), 'every change records at and by');
  for (const f of ['a.txt', 'b.txt', 'c.txt']) assert.ok(onMain(r, f), `${f} on main`);
  assert.equal(gh.calls.filter((c) => c.startsWith('PUT')).length, 1, 'one merge');
});

test('over the size cap: steps grouped in order into 2 PRs that land one at a time', async () => {
  const big = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n') + '\n';
  const r = repo({ 'claude/b-s1': { 'a.txt': big(60) }, 'claude/b-s2': { 'b.txt': big(60) }, 'claude/b-s3': { 'c.txt': big(60) } });
  const gh = github(r); const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1'], ['s2', 'claude/b-s2'], ['s3', 'claude/b-s3']])], { now });
  await tick(base(r, gh, store, now, { cfg: L.normConfig({ sizeCapLines: 130 }) }));
  const b = store.list[0];
  assert.equal(b.status, 'landed');
  assert.equal(gh.prs.size, 2);
  assert.deepEqual(b.steps.map((s) => s.prNumber), [1, 1, 2]);
  assert.match(gh.prs.get(1).title, /part 1 of 2/);
  assert.deepEqual(b.landing.merged, [1, 2]);
  assert.deepEqual(statuses(b), ['merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main', 'merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main', 'landed']);
});

test('CI red: failed attempt 1 → flaky re-run; red again: attempt 2 → split, steps land one PR each', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' }, 'claude/b-s2': { 'b.txt': 'b\n' } });
  let red = true; const gh = github(r, () => (red ? 'failure' : 'success'));
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1'], ['s2', 'claude/b-s2']])], { now });
  const opts = base(r, gh, store, now);
  await tick(opts);
  let b = store.list[0];
  assert.equal(b.status, 'failed'); assert.equal(b.attempt, 1); assert.equal(b.failure.kind, 'ci-red'); assert.equal(b.failure.retry, 'rerun');
  assert.deepEqual(b.failure.runIds, [42]);
  await tick(opts); // the re-run goes at once
  b = store.list[0];
  assert.equal(b.status, 'running-ci');
  assert.ok(gh.calls.includes('POST /actions/runs/42/rerun-failed-jobs'));
  await tick(opts); // still red on the same head
  b = store.list[0];
  assert.equal(b.attempt, 2); assert.equal(b.failure.retry, 'split');
  const wait = await tick(opts);
  assert.match(wait.waiting, /split at/, 'the split waits its backoff');
  red = false; now.add(L.backoffMinutes(2) + 1);
  await tick(opts);
  b = store.list[0];
  assert.equal(b.status, 'landed');
  assert.equal(gh.prs.get(1).state, 'closed'); assert.ok(!gh.prs.get(1).merged);
  assert.deepEqual(b.steps.map((s) => s.prNumber), [2, 3], 'one PR per step after the split');
  assert.deepEqual(b.landing.closed, [1]); assert.deepEqual(b.landing.merged, [2, 3]);
  assert.ok(onMain(r, 'a.txt') && onMain(r, 'b.txt'));
});

test('two steps clash in code: split; then main clashes with the second: a fix session, CI on its push, landed', async () => {
  const r = repo({ 'claude/b-s1': { 'shared.txt': 'one\nTWO by s1\nthree\n' }, 'claude/b-s2': { 'shared.txt': 'one\nTWO by s2\nthree\n' } });
  const gh = github(r); const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1'], ['s2', 'claude/b-s2']])], { now });
  let fixes = 0;
  const agentJob = (job) => {
    fixes++;
    assert.equal(job.type, 'land-build'); assert.equal(job.input.branch, 'lander/b-2');
    // the fixer: merge main, take both lines, push
    sh(r.work, 'fetch', '-q', 'origin'); sh(r.work, 'checkout', '-q', '--detach', 'origin/lander/b-2');
    spawnSync('git', ['merge', 'origin/main'], { cwd: r.work });
    writeFileSync(join(r.work, 'shared.txt'), 'one\nTWO by s1\nTWO by s2\nthree\n');
    sh(r.work, 'add', '-A'); sh(r.work, 'commit', '-q', '--no-edit'); sh(r.work, 'push', '-q', 'origin', 'HEAD:lander/b-2');
    sh(r.work, 'checkout', '-q', '--detach', 'origin/main');
    return { exit: 0, session: 'fixer-1' };
  };
  const opts = base(r, gh, store, now, { agentJob });
  await tick(opts);
  let b = store.list[0];
  assert.equal(b.status, 'failed'); assert.equal(b.failure.kind, 'clash-steps'); assert.equal(b.failure.retry, 'split');
  now.add(L.backoffMinutes(1) + 1);
  await tick(opts); // split: s1 lands as its own PR, s2's PR clashes with the new main
  b = store.list[0];
  assert.ok(onMain(r, 'shared.txt'));
  assert.equal(b.failure.kind, 'clash-main'); assert.equal(b.failure.retry, 'fix'); assert.equal(b.attempt, 2);
  now.add(L.backoffMinutes(2) + 1);
  await tick(opts); // the fix session starts (and pushes, in the fake)
  assert.equal(fixes, 1);
  b = store.list[0]; assert.equal(b.failure.fix.session, 'fixer-1');
  await tick(opts); // its push is a new head: CI, then merged
  b = store.list[0];
  assert.equal(b.status, 'landed');
  sh(r.work, 'fetch', '-q', 'origin');
  assert.equal(sh(r.work, 'show', 'origin/main:shared.txt'), 'one\nTWO by s1\nTWO by s2\nthree');
});

test('data files never need a person: THREADS.md lines from two steps are unioned', async () => {
  const r = repo({ 'claude/b-s1': { '_claude/THREADS.md': 'row s1\n' }, 'claude/b-s2': { '_claude/THREADS.md': 'row s2\n' } });
  const gh = github(r); const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1'], ['s2', 'claude/b-s2']])], { now });
  await tick(base(r, gh, store, now));
  assert.equal(store.list[0].status, 'landed');
  const t = sh(r.work, 'show', 'origin/main:_claude/THREADS.md');
  assert.match(t, /row s1/); assert.match(t, /row s2/);
});

test('CI running or not started: the build waits in running-ci, CI is started once per head', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  let state = 'none'; const gh = github(r, () => state);
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  const opts = base(r, gh, store, now);
  let out = await tick(opts);
  assert.equal(store.list[0].status, 'running-ci'); assert.match(out.waiting, /not started/);
  now.add(11); await tick(opts); now.add(1); await tick(opts);
  assert.equal(gh.calls.filter((c) => c.includes('/dispatches')).length, 1, 'dispatched once per head');
  state = 'running'; out = await tick(opts); assert.equal(out.waiting, 'CI is running');
  state = 'success'; await tick(opts);
  assert.equal(store.list[0].status, 'landed');
});

test('gate build rules run in running-ci on the green head; a failing rule is a failure with a fix session', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const gh = github(r); const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  let ruleRuns = 0; let jobs = 0;
  const opts = base(r, gh, store, now, { buildRules: ({ root }) => { ruleRuns++; assert.ok(existsSync(join(root, 'a.txt')), 'rules run in a worktree of the PR branch'); return { ok: false, failing: ['home-card'], fixed: [] }; }, agentJob: () => { jobs++; return { exit: 0, session: 'f' }; } });
  await tick(opts);
  const b = store.list[0];
  assert.equal(b.status, 'failed'); assert.equal(b.failure.kind, 'rules'); assert.deepEqual(b.failure.failing, ['home-card']);
  await tick(opts);
  assert.equal(ruleRuns, 1, 'once per head, never per tick');
  now.add(3); await tick(opts);
  assert.equal(jobs, 1);
});

test('one build at a time; a store that drops the write is reported, never silent', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const gh = github(r); const now = clock();
  const refusing = { read: () => [build([['s1', 'claude/b-s1']]), { ...build([['s1', 'claude/b-s1']]), id: 'b2' }], write: () => ({ ok: false, why: 'the builds store did not keep: status merging-pr' }) };
  const out = await tick(base(r, gh, refusing, now));
  assert.deepEqual(out.others, ['b2']);
  assert.match(out.error, /did not keep/);
  assert.equal(gh.prs.size, 0, 'nothing happens past a refused write');
});

test('status: the merge queue rows are the store rows (read-only)', async () => {
  const r = repo({});
  const store = memoryStore([build([['s1', 'x']], { status: 'running-ci' }), { id: 'q', status: 'building', steps: [] }]);
  const st = await status(r.s, { store });
  assert.deepEqual(st.queue, ['b', 'q']); assert.equal(st.current, 'b'); assert.deepEqual(st.escalations, []);
  assert.ok(!readFileSync(new URL('../run.mjs', import.meta.url), 'utf8').match(/anthropic|openai|claude-agent-sdk/i), 'no model client in the lander');
});

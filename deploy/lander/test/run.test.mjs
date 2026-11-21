// node --test deploy/lander/test/run.test.mjs — the lander end to end: real git (a bare origin), a fake GitHub, an
// in-memory builds store. No network, no model, no console.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sh, repo, github, build, clock, onMain, statuses, base, one, byId, holds, pushMain } from './helpers.mjs';

const { tick, status } = await import('../run.mjs');
const { memoryStore } = await import('../store.mjs');
const L = await import('../lander-core.mjs');

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

test('CI red: attempt 1 → flaky re-run; red again: attempt 2 → a fix session on the PR as it is; its push lands the ONE PR', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' }, 'claude/b-s2': { 'b.txt': 'b\n' } });
  let red = true; const gh = github(r, () => (red ? 'failure' : 'success'));
  gh.logs[7] = 'FAIL tests: expected 1, got 2';
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1'], ['s2', 'claude/b-s2']], { attempt: 7 })], { now });
  const fixes = [];
  const fixSession = (job) => {
    fixes.push(job);
    sh(r.work, 'fetch', '-q', 'origin'); sh(r.work, 'checkout', '-q', '--detach', `origin/${job.branch}`);
    writeFileSync(join(r.work, 'fix.txt'), 'fixed\n'); sh(r.work, 'add', '-A'); sh(r.work, 'commit', '-q', '-m', 'fix'); sh(r.work, 'push', '-q', 'origin', `HEAD:${job.branch}`);
    sh(r.work, 'checkout', '-q', '--detach', 'origin/main'); red = false;
    return { exit: 0, session: 'axf-lander-fix-pr1-1' };
  };
  const opts = base(r, gh, store, now, { fixSession });
  await tick(opts);
  let b = store.list[0];
  assert.equal(b.status, 'failed'); assert.equal(b.landing.attempt, 1, 'the landing run counts from 1, whatever the dispatcher counted'); assert.equal(b.attempt, 1, 'and the build shows the landing run\'s count while it lands');
  assert.equal(b.failure.kind, 'ci-red'); assert.equal(b.failure.retry, 'rerun');
  assert.deepEqual(b.failure.runIds, [42]); assert.deepEqual(b.failure.jobIds, [7]);
  await tick(opts); // the re-run goes at once
  b = store.list[0];
  assert.equal(b.status, 'running-ci');
  assert.ok(gh.calls.includes('POST /actions/runs/42/rerun-failed-jobs'));
  await tick(opts); // still red on the same head
  b = store.list[0];
  assert.equal(b.landing.attempt, 2); assert.equal(b.failure.retry, 'fix', 'a combined PR is fixed first, not split');
  const wait = await tick(opts);
  assert.match(wait.waiting, /fix at/, 'the fix waits its backoff');
  now.add(L.backoffMinutes(2) + 1);
  await tick(opts); // the fix session starts (and pushes, in the fake)
  assert.equal(fixes.length, 1); assert.equal(fixes[0].branch, 'lander/b'); assert.equal(fixes[0].pr, 1); assert.equal(fixes[0].n, 1);
  assert.equal(fixes[0].log, 'FAIL tests: expected 1, got 2', 'the failing job\'s log tail goes to the fix session');
  b = store.list[0];
  assert.equal(b.failure.fix.session, 'axf-lander-fix-pr1-1'); assert.equal(b.failure.fix.model, 'fable'); assert.deepEqual(b.landing.fixes, { pr: 1, n: 1 });
  await tick(opts); // its push is a new head: CI green, merged
  b = store.list[0];
  assert.equal(b.status, 'landed');
  assert.equal(gh.prs.size, 1, 'still one PR'); assert.deepEqual(b.landing.merged, [1]); assert.deepEqual(b.landing.closed ?? [], []);
  assert.ok(onMain(r, 'a.txt') && onMain(r, 'b.txt') && onMain(r, 'fix.txt'));
});

test('two steps clash in code: split; then main clashes with the second: a fix session, CI on its push, landed', async () => {
  const r = repo({ 'claude/b-s1': { 'shared.txt': 'one\nTWO by s1\nthree\n' }, 'claude/b-s2': { 'shared.txt': 'one\nTWO by s2\nthree\n' } });
  const gh = github(r); const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1'], ['s2', 'claude/b-s2']])], { now });
  let fixes = 0;
  const fixSession = (job) => {
    fixes++;
    assert.equal(job.f.kind, 'clash-main'); assert.equal(job.branch, 'lander/b-2'); assert.equal(job.pr, 2);
    // the fixer: merge main, take both lines, push
    sh(r.work, 'fetch', '-q', 'origin'); sh(r.work, 'checkout', '-q', '--detach', 'origin/lander/b-2');
    spawnSync('git', ['merge', 'origin/main'], { cwd: r.work });
    writeFileSync(join(r.work, 'shared.txt'), 'one\nTWO by s1\nTWO by s2\nthree\n');
    sh(r.work, 'add', '-A'); sh(r.work, 'commit', '-q', '--no-edit'); sh(r.work, 'push', '-q', 'origin', 'HEAD:lander/b-2');
    sh(r.work, 'checkout', '-q', '--detach', 'origin/main');
    return { exit: 0, session: 'fixer-1' };
  };
  const opts = base(r, gh, store, now, { fixSession });
  await tick(opts);
  let b = store.list[0];
  assert.equal(b.status, 'failed'); assert.equal(b.failure.kind, 'clash-steps'); assert.equal(b.failure.retry, 'split');
  now.add(L.backoffMinutes(1) + 1);
  await tick(opts); // split: s1 lands as its own PR, s2's PR clashes with the new main
  b = store.list[0];
  assert.ok(onMain(r, 'shared.txt'));
  assert.equal(b.failure.kind, 'clash-main'); assert.equal(b.failure.retry, 'fix'); assert.equal(b.landing.attempt, 2);
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

test('light PR checks only: the lander starts the full CI run once and lands only on it', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  let state = 'light'; const gh = github(r, () => state);
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  const opts = base(r, gh, store, now);
  let out = await tick(opts);
  assert.equal(store.list[0].status, 'running-ci'); assert.equal(out.waiting, 'waiting for the full CI run');
  await tick(opts);
  assert.equal(gh.calls.filter((c) => c.includes('/dispatches')).length, 1, 'one full run per head');
  state = 'success'; await tick(opts);
  assert.equal(store.list[0].status, 'landed');
});

test('gate build rules run in running-ci on the green head; a failing rule is a failure with a fix session', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const gh = github(r); const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  let ruleRuns = 0; let jobs = 0;
  const opts = base(r, gh, store, now, { buildRules: ({ root }) => { ruleRuns++; assert.ok(existsSync(join(root, 'a.txt')), 'rules run in a worktree of the PR branch'); return { ok: false, failing: ['home-card'], fixed: [], detail: 'home-card: no card for the build' }; }, fixSession: (job) => { jobs++; assert.equal(job.log, 'home-card: no card for the build', 'the failing rule\'s own words go to the fix session'); return { exit: 0, session: 'f' }; } });
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

// ------------------------------------------------------------------ the merge line: emergency builds first, never a stale head

test('an emergency build cuts to the front of the merge line; the build already landing pulls main again and re-runs CI before its own merge', async () => {
  const r = repo({ 'claude/n-s1': { 'n.txt': 'n\n' }, 'claude/e-s1': { 'e.txt': 'e\n' } });
  let hold = true; const asked = [];
  const gh = github(r, (head) => { asked.push(head); return hold ? 'running' : 'success'; });
  const now = clock();
  const store = memoryStore([one('n', 'claude/n-s1'), one('e', 'claude/e-s1', { status: 'building', steps: [{ id: 's1', status: 'building', branch: 'claude/e-s1', title: 's1' }], emergency: { at: '2026-11-20T10:00:00.000Z', by: 'Brett' } })], { now });
  const opts = base(r, gh, store, now);
  // the ordinary build is first and alone in the line: it gets as far as waiting for CI
  let out = await tick(opts);
  assert.equal(out.build, 'n'); assert.equal(byId(store, 'n').status, 'running-ci'); assert.match(out.waiting, /CI is running/);
  const firstHead = sh(r.work, 'rev-parse', 'origin/lander/n');
  // the emergency build finishes: it is picked ahead of the build that is already landing
  Object.assign(byId(store, 'e'), { status: 'build-complete', steps: [{ id: 's1', status: 'completed', branch: 'claude/e-s1', title: 's1' }] });
  hold = false; now.add(1);
  out = await tick(opts);
  assert.equal(out.build, 'e', 'the emergency build goes first'); assert.deepEqual(out.others, ['n'], 'the ordinary build waits where it is');
  assert.equal(byId(store, 'e').status, 'landed'); assert.ok(onMain(r, 'e.txt'), 'the emergency work is on main');
  assert.equal(byId(store, 'n').status, 'running-ci', 'the ordinary build was not touched meanwhile');
  assert.ok(!onMain(r, 'n.txt'));
  const merges = () => gh.calls.filter((c) => c.startsWith('PUT')).length;
  assert.equal(merges(), 1);
  // the ordinary build's CI is green, but on a head from before the emergency landing: main is pulled, CI runs again, no merge yet
  now.add(1); asked.length = 0;
  out = await tick(opts);
  let n = byId(store, 'n');
  assert.equal(out.build, 'n'); assert.equal(merges(), 1, 'never merged on the stale head');
  assert.equal(n.status, 'running-ci'); assert.match(out.waiting, /newest main/);
  const secondHead = sh(r.work, 'rev-parse', 'origin/lander/n');
  assert.notEqual(secondHead, firstHead, 'the PR has a new head');
  assert.ok(holds(r, secondHead, sh(r.work, 'rev-parse', 'origin/main')), 'the new head holds the newest main (the emergency work in it)');
  assert.equal(n.landing.mainPull.head, secondHead);
  assert.ok(out.actions.some((a) => /main moved since CI ran/.test(a)));
  // CI green on the new head: only now it merges
  now.add(1); asked.length = 0;
  out = await tick(opts);
  n = byId(store, 'n');
  assert.equal(n.status, 'landed'); assert.equal(merges(), 2);
  assert.deepEqual(asked, [secondHead], 'CI was read again, on the head that holds the newest main');
  assert.equal(n.landing.lastMerge.head, secondHead, 'the merge is pinned to that head');
  assert.ok(!statuses(n).includes('failed'), 'a re-pull is not a failure');
  assert.ok(onMain(r, 'n.txt') && onMain(r, 'e.txt'));
});

test('right before any merge: main moved while CI ran (no emergency involved) → newest main pulled, CI again, then merged', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  let hold = true; const gh = github(r, () => (hold ? 'running' : 'success'));
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  const opts = base(r, gh, store, now);
  await tick(opts);
  assert.equal(store.list[0].status, 'running-ci');
  const moved = pushMain(r, { 'other.txt': 'other\n' });
  hold = false; now.add(1);
  let out = await tick(opts);
  assert.equal(store.list[0].status, 'running-ci'); assert.equal(gh.calls.filter((c) => c.startsWith('PUT')).length, 0, 'not merged on the stale head');
  assert.ok(holds(r, sh(r.work, 'rev-parse', 'origin/lander/b'), moved));
  now.add(1);
  out = await tick(opts);
  assert.equal(store.list[0].status, 'landed'); assert.equal(out.error, '');
  // main moved only by status-only commits (the builds store's own [skip ci] lines): nothing to pull, no CI again
  const r2 = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const gh2 = github(r2); const store2 = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  await tick(base(r2, gh2, store2, now));
  assert.deepEqual(statuses(store2.list[0]), ['merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main', 'landed'], 'main did not move: one pull, one CI, one merge');
});

test('main moved and conflicts in code: a Fable fix session resolves it, CI runs on its push, then it merges', async () => {
  const r = repo({ 'claude/b-s1': { 'shared.txt': 'one\nTWO from the build\nthree\n' } });
  let hold = true; const gh = github(r, () => (hold ? 'running' : 'success'));
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  const jobs = [];
  const opts = base(r, gh, store, now, { fixSession: (job) => { jobs.push(job); return { exit: 0, session: 'fixer' }; } });
  await tick(opts);
  pushMain(r, { 'shared.txt': 'one\nTWO from main\nthree\n' }, 'main changes the same line');
  hold = false; now.add(1);
  await tick(opts);
  let b = store.list[0];
  assert.equal(b.status, 'failed'); assert.equal(b.failure.kind, 'clash-main'); assert.equal(b.failure.retry, 'fix');
  assert.match(b.failure.why, /main moved before the merge/);
  assert.equal(gh.calls.filter((c) => c.startsWith('PUT')).length, 0, 'never merged with the conflict open');
  now.add(L.backoffMinutes(1) + 1);
  await tick(opts);
  assert.equal(jobs.length, 1); assert.equal(jobs[0].f.kind, 'clash-main'); assert.equal(jobs[0].branch, 'lander/b');
  assert.equal(store.list[0].failure.fix.model, 'fable', 'the conflict goes to Fable');
  // the fix session resolves the conflict on the PR branch and pushes
  sh(r.work, 'fetch', '-q', 'origin'); sh(r.work, 'checkout', '-q', '--detach', 'origin/lander/b');
  spawnSync('git', ['merge', '-q', 'origin/main'], { cwd: r.work });
  writeFileSync(join(r.work, 'shared.txt'), 'one\nTWO from both\nthree\n');
  sh(r.work, 'add', '-A'); sh(r.work, 'commit', '-q', '-m', 'resolve'); sh(r.work, 'push', '-q', 'origin', 'HEAD:lander/b'); sh(r.work, 'fetch', '-q', 'origin');
  now.add(1);
  await tick(opts);
  b = store.list[0];
  assert.equal(b.status, 'landed');
  sh(r.work, 'fetch', '-q', 'origin');
  assert.equal(sh(r.work, 'show', 'origin/main:shared.txt'), 'one\nTWO from both\nthree');
});

// node --test deploy/lander/test/lander-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../lander-core.mjs';

const at = '2026-11-19T12:00:00.000Z';
const step = (id, extra = {}) => ({ id, status: 'completed', branch: `claude/b-${id}`, ...extra });

test('statuses only move forward; failed retries forward into a landing phase', () => {
  assert.ok(L.canMove('build-complete', 'merging-pr'));
  assert.ok(L.canMove('running-ci', 'running-ci'));
  assert.ok(!L.canMove('running-ci', 'pr-pulling-main'));
  assert.ok(!L.canMove('landed', 'failed'));
  assert.ok(L.canMove('running-ci', 'failed'));
  assert.ok(L.canMove('failed', 'running-ci'));
  assert.ok(!L.canMove('failed', 'building'));
  assert.ok(L.canMove('merging-main', 'merging-pr', { group: true }), 'the next group starts its own run');
  assert.ok(!L.canMove('merging-main', 'merging-pr'));
  assert.ok(L.canMoveStep('completed', 'in-pr'));
  assert.ok(L.canMoveStep('in-pr', 'in-pr'));
  assert.ok(!L.canMoveStep('in-pr', 'completed'));
});

test('one build at a time: the one in flight first, else the oldest build-complete', () => {
  const builds = [
    { id: 'a', status: 'build-complete', completedAt: '2026-11-19T10:00:00Z' },
    { id: 'b', status: 'failed', failure: { status: 'running-ci' }, completedAt: '2026-11-19T11:00:00Z' },
    { id: 'c', status: 'building' },
    { id: 'd', status: 'landed' },
  ];
  const p = L.pickBuild(builds);
  assert.equal(p.build.id, 'b');
  assert.deepEqual(p.others, ['a']);
  assert.equal(L.pickBuild([builds[0], builds[2]]).build.id, 'a');
  assert.equal(L.pickBuild([builds[2], builds[3]]).build, null);
});

test('the merge line: emergency builds first (oldest tag first), ahead of a build already landing', () => {
  const tag = (at) => ({ at, by: 'Brett' });
  const builds = [
    { id: 'landing', status: 'running-ci', completedAt: '2026-11-20T09:00:00Z' },
    { id: 'ready', status: 'build-complete', completedAt: '2026-11-20T09:30:00Z' },
    { id: 'e2', status: 'build-complete', completedAt: '2026-11-20T10:00:00Z', emergency: tag('2026-11-20T09:50:00Z') },
    { id: 'e1', status: 'failed', failure: { status: 'running-ci' }, completedAt: '2026-11-20T10:05:00Z', emergency: tag('2026-11-20T09:40:00Z') },
    { id: 'e-building', status: 'building', emergency: tag('2026-11-20T09:00:00Z') },
    { id: 'untagged', status: 'build-complete', completedAt: '2026-11-20T08:00:00Z', emergency: { by: 'someone' } },
  ];
  const p = L.pickBuild(builds);
  assert.equal(p.build.id, 'e1', 'the oldest emergency tag goes first');
  assert.deepEqual(p.others, ['e2', 'landing', 'untagged', 'ready'], 'then the other emergency build, then the ordinary line as before');
  assert.equal(L.pickBuild(builds.filter((b) => !L.isEmergency(b))).build.id, 'landing', 'without emergency builds: the one in flight, as before');
  assert.deepEqual(L.queueRows(builds).map((r) => r.build).slice(0, 3), ['e1', 'e2', 'e-building'], 'the merge queue view lists emergency builds on top');
  assert.equal(L.queueRows(builds).find((r) => r.build === 'e1').emergency, true);
});

test('size cap: steps grouped in order into as few PRs as fit; a big step alone; split = one each', () => {
  const steps = ['s1', 's2', 's3', 's4'].map((id) => step(id));
  const sizes = { s1: 100, s2: 200, s3: 900, s4: 50 };
  assert.deepEqual(L.groupSteps(steps, sizes, 5000).map((g) => g.map((s) => s.id)), [['s1', 's2', 's3', 's4']]);
  assert.deepEqual(L.groupSteps(steps, sizes, 1000).map((g) => g.map((s) => s.id)), [['s1', 's2'], ['s3', 's4']]);
  assert.deepEqual(L.groupSteps(steps, sizes, 250).map((g) => g.map((s) => s.id)), [['s1'], ['s2'], ['s3'], ['s4']]);
  assert.deepEqual(L.groupSteps(steps, sizes, 5000, { split: true }).length, 4);
});

test('steps on one branch stay in one group and count once', () => {
  const steps = [step('s1', { branch: 'claude/b' }), step('s2', { branch: 'claude/b' }), step('s3')];
  const g = L.groupSteps(steps, { s1: 600, s2: 600, s3: 500 }, 1000, { branchOf: (s) => s.branch });
  assert.deepEqual(g.map((x) => x.map((s) => s.id)), [['s1', 's2'], ['s3']]);
});

test('numstat lines skip tracking files and binaries', () => {
  const text = '10\t2\tsrc/a.js\n-\t-\timg.png\n500\t0\t_claude/builds/store.json\n3\t3\tb.md';
  assert.equal(L.numstatLines(text, (p) => p.startsWith('_claude/builds/')), 18);
});

test('group state comes from the steps: merged, in flight, waiting', () => {
  const b = { id: 'b', landing: { merged: [10], closed: [11] }, steps: [
    step('s1', { status: 'in-pr', prNumber: 10 }), step('s2', { status: 'in-pr', prNumber: 12 }), step('s3', { status: 'in-pr', prNumber: 11 }), step('s4'),
  ] };
  const g = L.groupState(b);
  assert.deepEqual(g.merged.map((s) => s.id), ['s1']);
  assert.deepEqual(g.inFlight, { pr: 12, steps: [b.steps[1]] });
  assert.deepEqual(g.waiting.map((s) => s.id), ['s3', 's4']);
});

test('CI from check runs: github actions only; only success is green; run and job ids of the red ones', () => {
  assert.equal(L.ciOf([]).ci, 'none');
  assert.equal(L.ciOf([{ status: 'in_progress' }]).ci, 'running');
  const red = L.ciOf([{ status: 'completed', conclusion: 'success', name: 'a' }, { id: 9, status: 'completed', conclusion: 'failure', name: 'tests', details_url: 'https://github.com/o/r/actions/runs/77/job/9' }, { app: { slug: 'coderabbit' }, status: 'completed', conclusion: 'failure' }]);
  assert.deepEqual(red, { ci: 'failure', failing: ['tests'], runIds: [77], jobIds: [9], missing: [] });
  // L2-06: neutral, an unknown conclusion and a check that completed with none are not green
  for (const conclusion of ['neutral', 'cancelled', 'timed_out', 'stale', 'action_required', 'something-new', null]) {
    const c = L.ciOf([{ status: 'completed', conclusion: 'success', name: 'a' }, { status: 'completed', conclusion, name: 'odd' }]);
    assert.equal(c.ci, 'failure', `${conclusion} is not green`);
  }
  assert.deepEqual(L.ciOf([{ status: 'completed', conclusion: 'neutral', name: 'odd' }]).failing, ['odd (neutral)']);
  assert.equal(L.ciOf([{ status: 'completed', conclusion: 'skipped', name: 'a' }]).ci, 'none', 'a skipped check is not CI');
});

test('CI: every required check must have reported on the head before it is green (L2-06)', () => {
  const ok = (name, more = {}) => ({ status: 'completed', conclusion: 'success', name, ...more });
  const required = ['engine', 'console', 'gradle'];
  const early = L.ciOf([ok('engine')], { required });
  assert.equal(early.ci, 'missing', 'every check present is done, but a second workflow has not posted yet');
  assert.deepEqual(early.missing, ['console', 'gradle']);
  assert.equal(L.ciOf([ok('engine'), ok('console'), ok('gradle')], { required }).ci, 'success');
  assert.equal(L.ciOf([ok('engine'), ok('console'), { status: 'completed', conclusion: 'skipped', name: 'gradle' }], { required }).ci, 'success', 'a required check the CI scope skipped has reported');
  assert.equal(L.ciOf([ok('engine'), ok('console'), { status: 'queued', conclusion: null, name: 'gradle' }], { required }).ci, 'running');
  assert.equal(L.ciOf([ok('engine'), ok('console'), { status: 'completed', conclusion: 'failure', name: 'gradle' }], { required }).ci, 'failure');
  // a re-run replaces the older run of the same name
  const rerun = [{ id: 1, status: 'completed', conclusion: 'failure', name: 'engine', started_at: '2026-11-21T10:00:00Z' }, { id: 2, status: 'completed', conclusion: 'success', name: 'engine', started_at: '2026-11-21T10:30:00Z' }];
  assert.equal(L.ciOf(rerun).ci, 'success');
  assert.equal(L.ciOf([...rerun].reverse()).ci, 'success', 'whatever order GitHub lists them in');
});

test('failure ladder: flaky re-run, then a fix session on the PR as it is; a group splits only when the red check names one step (L2-08)', () => {
  const b = { id: 'b', status: 'running-ci' };
  const f1 = L.failure(b, 'ci-red', { status: 'running-ci', groupSize: 3, reruns: 0, at });
  assert.equal(f1.attempt, 1); assert.equal(f1.failure.retry, 'rerun'); assert.equal(f1.failure.notBefore, at, 'a flaky re-run goes at once');
  const f2 = L.failure({ ...b, landing: { attempt: 1 } }, 'ci-red', { status: 'running-ci', groupSize: 3, reruns: 1, at });
  assert.equal(f2.attempt, 2); assert.equal(f2.failure.retry, 'fix', 'red CI on a combined PR goes to a fix session first, never straight to a split');
  assert.equal(L.failure(b, 'ci-red', { groupSize: 1, reruns: 1, at }).failure.retry, 'fix');
  assert.equal(L.failure(b, 'ci-red', { groupSize: 3, reruns: 1, fixes: 2, tiedStep: 's2', at }).failure.retry, 'split', 'fixes used up and the log names one step: split');
  const stop = L.failure(b, 'ci-red', { groupSize: 3, reruns: 1, fixes: 2, at }).failure;
  assert.equal(stop.retry, 'hold', 'fixes used up and no one step named: stop, the PR stays whole'); assert.equal(stop.needsBrett, true); assert.equal(stop.resume, 'fix');
  assert.equal(L.failure(b, 'clash-steps', { at }).failure.retry, 'split');
  assert.equal(L.failure(b, 'clash-main', { at }).failure.retry, 'fix');
  assert.equal(L.failure(b, 'merge', { at }).failure.retry, 'pull-main');
  assert.equal(L.failure(b, 'nonsense', { status: 'merging-pr', at }).failure.kind, 'infra');
  assert.equal(L.retryStatus(f2.failure), 'running-ci');
  assert.equal(L.retryStatus({ retry: 'split' }), 'merging-pr');
  assert.equal(L.retryStatus({ retry: 'pull-main' }), 'pr-pulling-main');
  assert.equal(L.retryStatus({ retry: 'same', status: 'merging-main' }), 'merging-main');
});

test('the one-step rule: a red log is tied to a step only by files no other step changed (L2-08)', () => {
  const files = { s1: ['src/a.mjs', 'shared/x.mjs'], s2: ['src/b.mjs', 'shared/x.mjs'], s3: ['docs/c.md'] };
  assert.equal(L.tiedStep('FAIL src/b.mjs:12 expected 1', files), 's2');
  assert.equal(L.tiedStep('FAIL shared/x.mjs:3', files), '', 'a file two steps changed names neither');
  assert.equal(L.tiedStep('FAIL src/a.mjs and src/b.mjs', files), '', 'two steps named: the PR stays whole');
  assert.equal(L.tiedStep('exit 1', files), ''); assert.equal(L.tiedStep('', files), '');
});

test('the ladder has a top: the lander counts its own attempts and stops at maxAttempts (L2-02, L2-07)', () => {
  assert.equal(L.backoffMinutes(1), 2); assert.equal(L.backoffMinutes(3), 8); assert.equal(L.backoffMinutes(50), 30);
  // L2-07: six failed main pulls by the dispatcher are not the lander's: its first failure is attempt 1
  const first = L.failure({ id: 'b', status: 'running-ci', attempt: 7 }, 'ci-timeout', { at });
  assert.equal(first.attempt, 1); assert.equal(first.failure.retry, 'rerun'); assert.ok(!L.shouldNotify(first.attempt));
  assert.equal(first.failure.notBefore, at, 'no 30-minute backoff on the first landing failure');
  // L2-02: the same failure does not repeat for ever
  const cfg = { maxAttempts: 4 };
  const third = L.failure({ landing: { attempt: 2 } }, 'infra', { status: 'merging-pr', at }, cfg);
  assert.equal(third.attempt, 3); assert.equal(third.failure.retry, 'same');
  assert.ok(L.retryDue({ status: 'failed', failure: third.failure }, '2026-11-19T12:31:00.000Z'));
  assert.ok(!L.retryDue({ status: 'failed', failure: third.failure }, '2026-11-19T12:01:00.000Z'));
  const top = L.failure({ landing: { attempt: 3 } }, 'infra', { status: 'merging-pr', why: 'push refused', at }, cfg);
  assert.equal(top.attempt, 4); assert.equal(top.failure.retry, 'hold'); assert.equal(top.failure.needsBrett, true);
  assert.equal(top.failure.stopped, 'attempt 4 of 4'); assert.equal(top.failure.resume, 'same'); assert.equal(top.failure.notBefore, '');
  const held = { id: 'b', status: 'failed', failure: top.failure, landing: { attempt: 4 } };
  assert.ok(L.isHeld(held)); assert.ok(!L.retryDue(held, '2027-01-01T00:00:00.000Z'), 'a stopped build is never due');
  // fix sessions: maxFixes per PR, then it stops with the failing check
  assert.equal(L.failure({}, 'rules', { fixes: 1, at }).failure.retry, 'fix');
  const noFix = L.failure({}, 'fix-timeout', { fixes: 2, at, of: { kind: 'rules', why: 'home-card fails', failing: ['home-card'] } }).failure;
  assert.equal(noFix.retry, 'hold'); assert.match(noFix.stopped, /2 fix sessions/); assert.deepEqual(noFix.of.failing, ['home-card']);
  assert.ok(L.shouldNotify(3)); assert.ok(!L.shouldNotify(2));
});

test('a stopped build goes to the back of the line, shows on the systems check, and is released by a re-send', () => {
  const stopped = { id: 'old', status: 'failed', statusAt: '2026-11-21T02:00:00Z', completedAt: '2026-11-20T01:00:00Z', landing: { attempt: 6 }, failure: L.failure({ landing: { attempt: 5 } }, 'ci-red', { status: 'running-ci', reruns: 1, fixes: 2, pr: 867, why: 'CI is red on abc (tests)', failing: ['tests'], at }).failure };
  const waiting = { id: 'next', status: 'build-complete', completedAt: '2026-11-21T03:00:00Z' };
  const p = L.pickBuild([stopped, waiting]);
  assert.equal(p.build.id, 'next', 'a build that needs Brett never holds the merge line'); assert.deepEqual(p.others, ['old']);
  assert.equal(L.pickBuild([stopped]).build.id, 'old', 'alone, it is still the one looked at (its PR is read every tick)');
  const [e] = L.escalations([stopped, waiting]);
  assert.equal(e.build, 'old'); assert.equal(e.pr, 867); assert.equal(e.kind, 'red-ci'); assert.equal(e.attempts, 6);
  assert.match(e.why, /^Stopped: /); assert.match(e.log, /Failing: tests/); assert.match(e.log, /run\.mjs retry old/);
  assert.equal(L.queueRows([stopped])[0].needsBrett, true); assert.equal(L.queueRows([stopped])[0].attempt, 6);
  const ch = L.releaseHold(stopped, { at, by: 'Brett' });
  assert.equal(ch.failure.retry, 'fix'); assert.equal(ch.failure.notBefore, at); assert.ok(!('needsBrett' in ch.failure) && !('stopped' in ch.failure));
  assert.equal(ch.landing.attempt, 0); assert.equal(ch.landing.fixes, null);
  assert.equal(L.releaseHold(waiting), null);
  // a closed PR is given up on a re-send: its steps go into a new PR
  const closed = { id: 'c', status: 'failed', landing: { closed: [3] }, failure: L.failure({}, 'pr-closed', { status: 'running-ci', pr: 9, at }).failure };
  assert.equal(closed.failure.retry, 'hold');
  const re = L.releaseHold(closed, { at });
  assert.equal(re.status, 'merging-pr'); assert.equal(re.failure, null); assert.deepEqual(re.landing.closed, [3, 9]);
});

test('config: unknown keys dropped, numbers clamped, the cap is a setting', () => {
  const c = L.normConfig({ sizeCapLines: '1200', flakyReruns: 99, bogus: 1, enabled: 'off' });
  assert.equal(c.sizeCapLines, 1200); assert.equal(c.flakyReruns, 5); assert.equal(c.enabled, false); assert.ok(!('bogus' in c));
});

test('merge queue rows: read-only projection of the same builds, live status', () => {
  const rows = L.queueRows([
    { id: 'x', status: 'running-ci', steps: [step('s1', { status: 'in-pr', prNumber: 5 }), step('s2', { status: 'in-pr', prNumber: 5 })] },
    { id: 'y', status: 'building', steps: [step('s1', { status: 'building' })] },
    { id: 'z', status: 'landed', steps: [] },
    { id: 'w', status: 'pending', steps: [] },
  ]);
  assert.deepEqual(rows.map((r) => r.build), ['x', 'y']);
  assert.deepEqual(rows[0].prs, [{ pr: 5, steps: ['s1', 's2'], state: 'open' }]);
});

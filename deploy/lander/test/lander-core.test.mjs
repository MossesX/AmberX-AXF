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

test('a code conflict with main is fixed on Fable; the other fixes keep the job\'s own model', () => {
  const b = { id: 'x' };
  assert.equal(L.fixJob(b, { kind: 'clash-main' }, 'lander/x').model, 'fable');
  assert.equal(L.fixJob(b, { kind: 'ci-red' }, 'lander/x').model, undefined);
  assert.equal(L.fixJob(b, { kind: 'rules', failing: ['home-card'] }, 'lander/x').model, undefined);
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

test('CI from check runs: github actions only, run ids of the red ones', () => {
  assert.equal(L.ciOf([]).ci, 'none');
  assert.equal(L.ciOf([{ status: 'in_progress' }]).ci, 'running');
  const red = L.ciOf([{ status: 'completed', conclusion: 'success', name: 'a' }, { status: 'completed', conclusion: 'failure', name: 'tests', details_url: 'https://github.com/o/r/actions/runs/77/job/1' }, { app: { slug: 'coderabbit' }, status: 'completed', conclusion: 'failure' }]);
  assert.deepEqual(red, { ci: 'failure', failing: ['tests'], runIds: [77] });
});

test('failure ladder: flaky re-run first, then split a group, then a fix session; attempt N climbs', () => {
  const b = { id: 'b', status: 'running-ci', attempt: 0 };
  const f1 = L.failure(b, 'ci-red', { status: 'running-ci', groupSize: 3, reruns: 0, at });
  assert.equal(f1.attempt, 1); assert.equal(f1.failure.retry, 'rerun'); assert.equal(f1.failure.notBefore, at, 'a flaky re-run goes at once');
  const f2 = L.failure({ ...b, attempt: 1 }, 'ci-red', { status: 'running-ci', groupSize: 3, reruns: 1, at });
  assert.equal(f2.attempt, 2); assert.equal(f2.failure.retry, 'split');
  assert.equal(L.failure({ ...b, attempt: 2 }, 'ci-red', { groupSize: 1, reruns: 1, at }).failure.retry, 'fix');
  assert.equal(L.failure(b, 'clash-steps', { at }).failure.retry, 'split');
  assert.equal(L.failure(b, 'clash-main', { at }).failure.retry, 'fix');
  assert.equal(L.failure(b, 'merge', { at }).failure.retry, 'pull-main');
  assert.equal(L.failure(b, 'nonsense', { status: 'merging-pr', at }).failure.kind, 'infra');
  assert.equal(L.retryStatus(f2.failure), 'merging-pr');
  assert.equal(L.retryStatus(f1.failure), 'running-ci');
  assert.equal(L.retryStatus({ retry: 'pull-main' }), 'pr-pulling-main');
  assert.equal(L.retryStatus({ retry: 'same', status: 'merging-main' }), 'merging-main');
});

test('backoff is capped and nothing escalates: attempt 50 still retries', () => {
  assert.equal(L.backoffMinutes(1), 2); assert.equal(L.backoffMinutes(3), 8); assert.equal(L.backoffMinutes(50), 30);
  const f = L.failure({ attempt: 49 }, 'ci-red', { groupSize: 1, reruns: 1, at });
  assert.equal(f.attempt, 50); assert.equal(f.failure.retry, 'fix');
  assert.ok(L.retryDue({ status: 'failed', failure: f.failure }, '2026-11-19T12:31:00.000Z'));
  assert.ok(!L.retryDue({ status: 'failed', failure: f.failure }, '2026-11-19T12:10:00.000Z'));
  assert.ok(L.shouldNotify(3)); assert.ok(!L.shouldNotify(2));
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

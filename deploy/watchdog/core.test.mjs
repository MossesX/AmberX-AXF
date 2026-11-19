// node --test deploy/watchdog/core.test.mjs — the pure decision table of the Pipeline 2.0 watchdog (layer 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from './core.mjs';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const ago = (min) => new Date(NOW - min * 60_000).toISOString();
const S = C.normSettings();

test('forward-only: next statuses pass, earlier ones and failed→other refuse', () => {
  assert.ok(C.forwardOk(C.BUILD_FLOW, 'pending', 'splitting'));
  assert.ok(!C.forwardOk(C.BUILD_FLOW, 'running-ci', 'building'));
  assert.ok(C.forwardOk(C.BUILD_FLOW, 'running-ci', 'failed'));
  assert.ok(C.forwardOk(C.BUILD_FLOW, 'failed', 'running-ci', 'running-ci'));
  assert.ok(!C.forwardOk(C.BUILD_FLOW, 'failed', 'pending', 'running-ci'));
  assert.ok(!C.forwardOk(C.BUILD_FLOW, 'landed', 'failed'));
  assert.throws(() => C.stamp({ status: 'ready' }, C.BUILD_FLOW, 'split', { at: ago(0) }));
});

test('a status inside its budget is fine; past it is stuck', () => {
  const store = { builds: [{ id: 'a', status: 'splitting', statusAt: ago(5), steps: [] }, { id: 'b', status: 'merging-pr', statusAt: ago(45), steps: [] }] };
  const issues = C.findIssues(store, { now: NOW, settings: S });
  assert.deepEqual(issues.map((i) => [i.build, i.kind]), [['b', 'build-stuck']]);
});

test('split waits while another build is active (one active build), stuck when none is', () => {
  const waiting = { id: 'w', status: 'split', statusAt: ago(120), steps: [] };
  assert.equal(C.findIssues({ builds: [waiting, { id: 'x', status: 'building', statusAt: ago(1), steps: [] }] }, { now: NOW }).length, 0);
  assert.equal(C.findIssues({ builds: [waiting] }, { now: NOW })[0].kind, 'build-stuck');
});

test('building step: dead tmux, usage limit and hung log are found', () => {
  const b = { id: 'b', status: 'building', statusAt: ago(30), steps: [
    { id: 's1', status: 'building', statusAt: ago(10), account: 'acc1' },
    { id: 's2', status: 'building', statusAt: ago(10), account: 'acc2' },
    { id: 's3', status: 'building', statusAt: ago(200), account: 'acc3' },
    { id: 's4', status: 'building', statusAt: ago(1), account: 'acc1' },
  ] };
  const probes = {
    'b/s1': { tmux: false },
    'b/s2': { tmux: true, logTail: "...\nYou've hit your weekly limit · resets Nov 21\n" },
    'b/s3': { tmux: true, logAgeMin: 40 },
    'b/s4': { tmux: false }, // inside the grace period
  };
  const kinds = C.findIssues({ builds: [b] }, { now: NOW, probes }).map((i) => `${i.step}:${i.kind}`);
  assert.deepEqual(kinds, ['s1:step-dead', 's2:step-limit', 's3:step-hung']);
});

test('nudge twice, then fail; nudges are spaced', () => {
  const issue = { kind: 'build-stuck', build: 'b', status: 'merging-pr', minutes: 30, attempt: 1 };
  const k = C.keyOf(issue);
  assert.equal(C.plan(issue, { now: NOW }).action, 'nudge');
  assert.equal(C.plan(issue, { now: NOW, memory: { nudges: { [k]: { n: 1, last: NOW - 60_000 } } } }).action, 'wait');
  assert.equal(C.plan(issue, { now: NOW, memory: { nudges: { [k]: { n: 1, last: NOW - 10 * 60_000 } } } }).action, 'nudge');
  assert.equal(C.plan(issue, { now: NOW, memory: { nudges: { [k]: { n: 2, last: NOW - 10 * 60_000 } } } }).action, 'fail');
});

test('usage limit: step fails, retry relaunches through ready on another account with usage left', () => {
  const store = { builds: [{ id: 'b', status: 'building', statusAt: ago(30), notes: [], steps: [{ id: 's', status: 'building', statusAt: ago(10), account: 'acc1', attempt: 1 }] }] };
  const [issue] = C.findIssues(store, { now: NOW, probes: { 'b/s': { tmux: true, logTail: 'usage limit reached' } } });
  const d = C.plan(issue, { now: NOW });
  assert.equal(d.action, 'fail-limit');
  C.applyDecision(store, issue, d, { now: NOW });
  const step = store.builds[0].steps[0];
  assert.equal(step.status, 'failed'); assert.equal(step.failedAt, 'building'); assert.deepEqual(step.tried, ['acc1']);
  assert.equal(store.builds[0].notes.at(-1).by, 'watchdog');

  const later = NOW + 2 * 60_000;
  const [f] = C.findIssues(store, { now: later });
  assert.equal(f.kind, 'step-failed');
  const accounts = [{ name: 'acc1', usable: false }, { name: 'acc2', left: 0.2 }, { name: 'acc3', left: 0.7 }];
  const r = C.plan(f, { now: later, accounts });
  assert.deepEqual([r.action, r.to, r.account, r.attempt], ['retry', 'ready', 'acc3', 2]);
  C.applyDecision(store, f, r, { now: later });
  assert.deepEqual([step.status, step.attempt, step.account, step.statusBy], ['ready', 2, 'acc3', 'watchdog']);
  assert.equal(step.history.at(-1).by, 'watchdog');
});

test('no account with usage left: the retry waits instead of relaunching on a dead account', () => {
  const issue = { kind: 'step-failed', build: 'b', step: 's', status: 'failed', failedAt: 'building', attempt: 1, account: 'acc1', minutes: 5 };
  assert.equal(C.plan(issue, { now: NOW, accounts: [{ name: 'acc1', usable: false }] }).action, 'wait');
});

test('failed build retries forward at failedAt; at maxAttempts it gives up once', () => {
  const store = { builds: [{ id: 'b', status: 'failed', failedAt: 'running-ci', attempt: 2, statusAt: ago(5), notes: [] }] };
  const [i] = C.findIssues(store, { now: NOW });
  const d = C.plan(i, { now: NOW, store });
  assert.deepEqual([d.action, d.to, d.attempt], ['retry', 'running-ci', 3]);
  C.applyDecision(store, i, d, { now: NOW });
  assert.equal(store.builds[0].status, 'running-ci');

  const done = { kind: 'build-failed', build: 'z', status: 'failed', failedAt: 'merging-main', attempt: 5, minutes: 10 };
  const g = C.plan(done, { now: NOW });
  assert.equal(g.action, 'give-up');
  const mem = C.nextMemory({}, [done], [g], NOW);
  assert.equal(C.plan(done, { now: NOW, memory: mem }).action, 'wait');
});

test('a failed active build waits while another build holds the box', () => {
  const store = { builds: [{ id: 'a', status: 'failed', failedAt: 'merging-pr', attempt: 1, statusAt: ago(5) }, { id: 'b', status: 'running-ci', statusAt: ago(1) }] };
  const i = C.findIssues(store, { now: NOW }).find((x) => x.build === 'a');
  assert.equal(C.plan(i, { now: NOW, store }).action, 'wait');
});

test('a record that moved since the scan is left alone', () => {
  const store = { builds: [{ id: 'b', status: 'running-ci', statusAt: ago(1) }] };
  assert.equal(C.applyDecision(store, { build: 'b', status: 'merging-pr' }, { action: 'fail', why: 'x' }, { now: NOW }), '');
  assert.equal(store.builds[0].status, 'running-ci');
});

test('pickAccount: most usage left, never an excluded or limited one', () => {
  assert.equal(C.pickAccount([{ name: 'a', left: 0.9, usable: false }, { name: 'b', left: 0.1 }, { name: 'c', left: 0.5 }], ['c']), 'b');
  assert.equal(C.pickAccount([{ name: 'a', left: 0 }]), '');
});

/**
 * Pipeline 2.0 integration: the lander's and the watchdog's writes pass the builds store's own guards (pure parts of
 * framework/plan/builds-store-core.mjs normalizeStore + enforceDoneGuard, framework/core/pipeline-status.mjs
 * enforceFlow), exactly as builds-store.mjs withStore runs them, and the fields each part reads back survive.
 *   node --test deploy/watchdog/contract.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../../framework/plan/builds-store-core.mjs';
import * as P2 from '../../framework/core/pipeline-status.mjs';
import * as W from './core.mjs';
import { applyChange } from '../lander/store.mjs';
import { landedEvidence } from '../lander/lander-core.mjs';

const T0 = Date.parse('2026-11-19T12:00:00Z');
const iso = (m) => new Date(T0 + m * 60000).toISOString();
const clone = (v) => JSON.parse(JSON.stringify(v));

/** One write through the store's guards, as withStoreOnce does it. → { store, refused } */
function write(before, fn) {
  const start = core.normalizeStore(clone(before));
  const after = core.normalizeStore(fn(clone(start)) ?? start);
  const g = core.enforceDoneGuard(start, after, { by: 'test' });
  const f = P2.enforceFlow(start, g.store, { by: 'test' });
  return { store: core.normalizeStore(f.store), refused: [...g.refused, ...f.refused] };
}
const build = (s, id = 'b1') => s.builds.find((x) => x.id === id);

function p2Store(status, steps) {
  return core.normalizeStore({ builds: [{ id: 'b1', title: 'B', flow: P2.FLOW, status, statusAt: iso(0), statusBy: 'test', branch: 'claude/b1', steps }] });
}

test('lander: every landing status, a second PR group, a failed retry and landed with its evidence pass the store', () => {
  let s = p2Store('build-complete', [
    { id: 's1', text: 'one', status: 'completed', branch: 'claude/b1--s1', statusAt: iso(0) },
    { id: 's2', text: 'two', status: 'completed', branch: 'claude/b1--s2', statusAt: iso(0) },
  ]);
  let m = 1;
  const land = (ch) => { const r = write(s, (x) => { const i = x.builds.findIndex((y) => y.id === 'b1'); x.builds[i] = applyChange(x.builds[i], ch, { at: iso(m), by: 'lander' }).build; return x; }); m += 1; assert.deepEqual(r.refused, [], JSON.stringify(ch)); s = r.store; return build(s); };

  land({ status: 'merging-pr', pr: '101', steps: [{ id: 's1', status: 'in-pr', prNumber: 101 }] });
  land({ status: 'pr-pulling-main' });
  land({ status: 'running-ci', landing: { ciKick: { head: 'h1', at: iso(m) } } });
  // red CI: failed in running-ci, attempt 1, with the lander's own failure record
  let b = land({ status: 'failed', attempt: 1, failure: { kind: 'ci-red', status: 'running-ci', why: 'red', head: 'h1', pr: 101, at: iso(m), retry: 'rerun', notBefore: iso(m), failing: ['unit'] } });
  assert.equal(b.failedFrom, 'running-ci', 'failedFrom recorded');
  assert.ok(P2.holdsActive(b), 'a failed landing build keeps the one active place');
  assert.equal(b.failure.kind, 'ci-red'); assert.equal(b.failure.retry, 'rerun'); assert.deepEqual(b.failure.failing, ['unit']);
  b = land({ status: 'running-ci', landing: { reruns: { head: 'h1', n: 1 } } });
  assert.equal(b.failedFrom, undefined); assert.deepEqual(b.landing.reruns, { head: 'h1', n: 1 });
  land({ status: 'merging-main' });
  b = land({ landing: { merged: [101], lastMerge: { pr: 101, sha: 'm1', head: 'h1', at: iso(m) } }, failure: null });
  assert.deepEqual(b.landing.merged, [101]); assert.equal(b.failure, undefined);
  // the second PR group starts again at merging-pr (size cap / split)
  land({ status: 'merging-pr', group: true, pr: '102', steps: [{ id: 's2', status: 'in-pr', prNumber: 102 }] });
  land({ status: 'pr-pulling-main' });
  land({ status: 'running-ci' });
  // a merge refused after CI: failed in merging-main, retried by pulling main in again (earlier in the same group)
  land({ status: 'failed', attempt: 2, failure: { kind: 'merge', status: 'merging-main', why: '405', head: 'h2', pr: 102, at: iso(m), retry: 'pull-main', notBefore: iso(m) } });
  land({ status: 'pr-pulling-main' });
  land({ status: 'running-ci' });
  land({ status: 'merging-main' });
  b = land({ landing: { merged: [101, 102], lastMerge: { pr: 102, sha: 'm2', head: 'h2', at: iso(m) } }, failure: null });
  b = land({ status: 'landed', ...landedEvidence(b, iso(m)) });
  assert.equal(b.status, 'landed');
  assert.equal(b.landed.sha, 'm2'); assert.equal(b.landed.ci, 'success'); assert.ok(b.mergedAt); assert.ok(b.landedAt);
  assert.ok(b.notes.every((n) => n.by === 'lander' || !n.by));
});

test('lander: landed with no merge evidence is refused by the done guard (never silent)', () => {
  const s = p2Store('merging-main', [{ id: 's1', text: 'one', status: 'in-pr', prNumber: 5, statusAt: iso(0) }]);
  const r = write(s, (x) => { x.builds[0] = applyChange(x.builds[0], { status: 'landed' }, { at: iso(1) }).build; return x; });
  assert.equal(build(r.store).status, 'merging-main');
  assert.equal(r.refused.length, 1);
});

test('watchdog: a dead building step fails, then relaunches at ready with a pinned account the store keeps', () => {
  let s = p2Store('building', [{ id: 's1', text: 'one', status: 'building', account: 'acc1', tmux: 'axf-b1--s1', slot: 'hl-1', statusAt: iso(0) }]);
  const now = T0 + 30 * 60000;
  const probes = { 'b1/s1': { tmux: false, session: 'axf-b1--s1', logTail: '', logAgeMin: 30 } };
  const [dead] = W.findIssues(s, { probes, now });
  assert.equal(dead.kind, 'step-dead');
  let r = write(s, (x) => { W.applyDecision(x, dead, W.plan(dead, { now }), { now }); return x; });
  assert.deepEqual(r.refused, []); s = r.store;
  let st = build(s).steps[0];
  assert.deepEqual([st.status, st.failedFrom, st.attempt], ['failed', 'building', 1]);
  assert.deepEqual(st.tried, ['acc1']);
  assert.equal(st.statusLog.at(-1).by, 'watchdog');
  assert.equal(build(s).notes.at(-1).by, 'watchdog');

  const later = now + 5 * 60000;
  const [failed] = W.findIssues(s, { now: later });
  assert.equal(failed.kind, 'step-failed'); assert.equal(failed.failedFrom, 'building');
  const d = W.plan(failed, { now: later, accounts: [{ name: 'acc1', usable: true, left: 1 }, { name: 'acc2', usable: true, left: 0.5 }] });
  assert.deepEqual([d.action, d.to, d.account], ['retry', 'ready', 'acc2']);
  r = write(s, (x) => { W.applyDecision(x, failed, d, { now: later }); return x; });
  assert.deepEqual(r.refused, [], 'failed (from building) → ready is the contract\'s relaunch re-entry');
  st = build(r.store).steps[0];
  assert.deepEqual([st.status, st.account, st.attempt, st.tmux, st.slot], ['ready', 'acc2', 2, undefined, undefined]);

  // the orchestrator honours the pin while acc2 is not out; an out pin falls back to the normal pick (never an out one)
  const rows = [{ name: 'acc1', usable: true, free: 1, usageLeft: 1 }, { name: 'acc2', usable: true, free: 1, usageLeft: 0.2 }, { name: 'acc3', usable: true, free: 1, usageLeft: 0.9 }];
  assert.equal(P2.pinnedAccount(rows, st, { now: later })?.name, 'acc2');
  assert.equal(P2.pickAccount(rows, { now: later, exclude: st.tried })?.name, 'acc3', 'without the pin the picker would choose acc3');
  const out = rows.map((a) => (a.name === 'acc2' ? { ...a, limited: { until: new Date(later + 3600e3).toISOString() } } : a));
  assert.equal(P2.pinnedAccount(out, st, { now: later }), null, 'an out pin is never used');
  assert.equal(P2.pickAccount(out, { now: later, exclude: st.tried })?.name, 'acc3');
});

test('contract: a step cannot be sent back to ready from completed, and a build cannot leave a landing run backwards except to merging-pr', () => {
  assert.equal(P2.checkTransition({ status: 'completed' }, 'ready', 'step').ok, false);
  assert.equal(P2.checkTransition({ status: 'failed', failedFrom: 'completed' }, 'ready', 'step').ok, false);
  assert.equal(P2.checkTransition({ status: 'failed', failedFrom: 'building' }, 'ready', 'step').ok, true);
  assert.equal(P2.checkTransition({ status: 'merging-main' }, 'merging-pr', 'build').ok, true);
  assert.equal(P2.checkTransition({ status: 'merging-main' }, 'running-ci', 'build').ok, false);
  assert.equal(P2.checkTransition({ status: 'running-ci' }, 'building', 'build').ok, false);
  assert.equal(P2.checkTransition({ status: 'failed', failedFrom: 'running-ci' }, 'building', 'build').ok, false);
});

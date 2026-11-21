// node --test deploy/lander/test/store-contract.test.mjs — the repaired lander against the builds store's own rules:
// every write goes through the store's normalizer (which drops what the contract does not name), the done-means-merged
// guard and the Pipeline 2.0 flow guard, exactly as builds-store withStore runs them. What the lander needs to end its
// ladder (its own attempt count, the stop, the fix count, the green head, a hand merge's CI) must survive that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sh, repo, github, clock, onMain, statuses, base, pushMain, holds } from './helpers.mjs';

const { tick } = await import('../run.mjs');
const { applyChange, lost } = await import('../store.mjs');
const L = await import('../lander-core.mjs');
const core = await import('../../../framework/plan/builds-store-core.mjs');
const P2 = await import('../../../framework/core/pipeline-status.mjs');

const clone = (v) => JSON.parse(JSON.stringify(v));
/** The builds store's write path over a list in memory: normalize → done guard → flow guard → normalize → read back. */
function contractStore(builds, { now }) {
  let s = core.normalizeStore({ builds });
  const why = (x) => (typeof x === 'string' ? x : x?.why || JSON.stringify(x));
  return {
    get list() { return s.builds; },
    read: () => clone(s.builds),
    write(id, ch) {
      const start = s; const next = clone(start);
      const i = next.builds.findIndex((b) => b.id === id);
      if (i < 0) return { ok: false, why: `no build ${id}`, refused: [] };
      const r = applyChange(next.builds[i], ch, { at: now(), by: 'lander' });
      next.builds[i] = r.build;
      const g = core.enforceDoneGuard(start, core.normalizeStore(next), { by: 'lander' });
      const f = P2.enforceFlow(start, g.store, { by: 'lander' });
      s = core.normalizeStore(f.store);
      const b = s.builds.find((x) => x.id === id);
      const refused = [...r.refused, ...g.refused.map(why), ...f.refused.map(why), ...lost(b, ch)];
      return { ok: !refused.length, build: clone(b), refused, why: refused.join('; ') };
    },
  };
}
const p2 = (now, steps, more = {}) => ({ id: 'b', title: 'Build B', flow: P2.FLOW, status: 'build-complete', statusAt: now(), statusBy: 'orchestrator', branch: 'claude/b', attempt: 7,
  steps: steps.map(([id, branch]) => ({ id, text: id, title: id, status: 'completed', branch, statusAt: now() })), ...more });
const run = async (opts) => { const out = await tick(opts); assert.equal(out.error, '', `the store refused nothing (${out.error})`); return out; };

test('the store keeps what ends the ladder: the lander\'s own attempt, the fix count, the stop; a re-send starts again', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const gh = github(r, () => 'failure'); gh.logs[7] = 'FAIL a.test: expected 1';
  const now = clock(); const store = contractStore([p2(now, [['s1', 'claude/b-s1']])], { now });
  const fixes = [];
  const opts = base(r, gh, store, now, { fixSession: (job) => { fixes.push(job); return { exit: 0, session: `fixer-${job.n}` }; } });
  await run(opts);
  let b = store.list[0];
  assert.equal(b.status, 'failed'); assert.equal(b.failedFrom, 'running-ci');
  assert.equal(b.landing.attempt, 1, 'the landing run\'s own count is kept by the store');
  assert.equal(b.attempt, 1, 'and it is the count the store\'s attempt ceiling reads: seven dispatcher retries do not lock the build in failed');
  assert.equal(b.failure.attempt, 1); assert.deepEqual(b.failure.jobIds, [7]);
  await run(opts); await run(opts); // the flaky re-run, red again
  b = store.list[0];
  assert.equal(b.landing.attempt, 2); assert.equal(b.failure.retry, 'fix');
  now.add(5); await run(opts);
  b = store.list[0];
  assert.deepEqual(b.landing.fixes, { pr: 1, n: 1 }); assert.equal(b.failure.fix.n, 1); assert.equal(b.failure.fix.model, 'fable'); assert.equal(b.failure.fix.session, 'fixer-1');
  now.add(61); await run(opts);
  b = store.list[0];
  assert.equal(b.failure.kind, 'fix-timeout'); assert.equal(b.failure.of.kind, 'ci-red'); assert.deepEqual(b.failure.of.jobIds, [7]);
  now.add(9); await run(opts);
  assert.equal(fixes.length, 2); assert.equal(fixes[1].log, 'FAIL a.test: expected 1');
  now.add(61); await run(opts);
  b = store.list[0];
  assert.equal(b.status, 'failed'); assert.equal(b.failure.retry, 'hold'); assert.equal(b.failure.needsBrett, true);
  assert.match(b.failure.stopped, /2 fix sessions/); assert.equal(b.failure.resume, 'fix'); assert.equal(b.landing.attempt, 4);
  assert.ok(L.isHeld(b), 'read back from the store, the build is still stopped');
  for (let i = 0; i < 4; i++) { now.add(90); await run(opts); }
  assert.equal(fixes.length, 2, 'stopped stays stopped across ticks'); assert.equal(store.list[0].landing.attempt, 4);
  const re = store.write('b', L.releaseHold(store.list[0], { at: now(), by: 'Brett' }));
  assert.ok(re.ok, re.why);
  b = store.list[0];
  assert.equal(b.status, 'running-ci'); assert.equal(b.failure, undefined); assert.equal(b.landing?.attempt ?? 0, 0); assert.equal(b.landing?.fixes, undefined);
  assert.equal(b.statusLog.at(-1).reset, true, 'the re-send is a marked reset, with its reason'); assert.match(b.statusLog.at(-1).why, /re-sent by Brett/);
  now.add(1); await run(opts); await run(opts); await run(opts); // red again: attempt 1, the flaky re-run, attempt 2
  now.add(5); await run(opts);
  assert.equal(fixes.length, 3); assert.equal(fixes[2].n, 1);
});

test('at the store\'s attempt ceiling a stopped build still gets out: by a re-send, and by a hand merge', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  let state = 'failure'; const gh = github(r, () => state);
  const now = clock(); const store = contractStore([p2(now, [['s1', 'claude/b-s1']])], { now });
  // CI that is red and a fix session that never starts: the ladder runs to its top, attempt 5 of 5
  const opts = base(r, gh, store, now, { cfg: L.normConfig({ flakyReruns: 0, fixStartTries: 1 }), fixSession: () => ({ exit: 3, why: 'no account can take it' }) });
  for (let i = 0; i < 30 && !L.isHeld(store.list[0]); i++) { await run(opts); now.add(31); }
  let b = store.list[0];
  assert.ok(L.isHeld(b)); assert.equal(b.failure.stopped, 'attempt 5 of 5'); assert.equal(b.attempt, P2.MAX_ATTEMPTS, 'the build sits at the contract\'s ceiling');
  assert.equal(P2.checkTransition(b, 'running-ci').ok, false, 'the store lets nothing out of failed here without a reset');
  const re = store.write('b', L.releaseHold(b, { at: now(), by: 'Brett' }));
  assert.ok(re.ok, re.why);
  assert.equal(store.list[0].status, 'running-ci'); assert.equal(store.list[0].attempt, 1);
  // to the top again, then Brett merges the PR by hand: the lander records it and the build leaves failed
  for (let i = 0; i < 30 && !L.isHeld(store.list[0]); i++) { await run(opts); now.add(31); }
  assert.equal(store.list[0].attempt, P2.MAX_ATTEMPTS);
  gh.mergeByHand(1); state = 'success'; now.add(1);
  await run(opts);
  b = store.list[0];
  assert.equal(b.status, 'landed'); assert.deepEqual(b.landing.merged, [1]);
  assert.ok(b.statusLog.some((l) => l.reset === true && /merged by hand/.test(l.why)), 'the way out of failed is a reset with its reason');
});

test('the store lets a hand merge through: recorded from running-ci, landed with what GitHub says about its CI', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  let state = 'running'; const gh = github(r, () => state);
  const now = clock(); const store = contractStore([p2(now, [['s1', 'claude/b-s1']])], { now });
  const opts = base(r, gh, store, now);
  await run(opts);
  assert.equal(store.list[0].status, 'running-ci');
  const pr = gh.mergeByHand(1); state = 'failure'; now.add(1);
  await run(opts);
  let b = store.list[0];
  assert.equal(b.status, 'failed'); assert.equal(b.failure.kind, 'hand-merge'); assert.equal(b.failure.needsBrett, true);
  assert.deepEqual(b.landing.lastMerge, { pr: 1, sha: pr.merge_commit_sha, head: pr.head.sha, at: pr.merged_at, byHand: true, ci: 'failure', by: '' });
  assert.notEqual(b.status, 'landed', 'red CI on a hand merge is never "landed": the done guard would refuse it, and the lander does not ask');
  state = 'success'; now.add(1);
  await run(opts);
  b = store.list[0];
  assert.equal(b.status, 'landed'); assert.equal(b.landed.sha, pr.merge_commit_sha); assert.equal(b.landed.ci, 'success'); assert.equal(b.landing.lastMerge.ci, 'success');
});

test('the store lets a landing run go back from merging-main through the main pull and CI (main moved), and from a closed PR to a reopened one', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  let state = 'running'; const gh = github(r, () => state);
  const now = clock(); const store = contractStore([p2(now, [['s1', 'claude/b-s1']])], { now });
  const opts = base(r, gh, store, now);
  await run(opts);
  // closed by hand, then reopened
  gh.prs.get(1).state = 'closed'; now.add(1); await run(opts);
  assert.equal(store.list[0].failure.kind, 'pr-closed'); assert.ok(L.isHeld(store.list[0]));
  gh.prs.get(1).state = 'open'; now.add(1); await run(opts);
  let b = store.list[0];
  assert.equal(b.status, 'running-ci'); assert.equal(b.failure, undefined);
  // CI green was recorded on this head; the tick died before the merge; main moved meanwhile
  const green = sh(r.work, 'rev-parse', 'origin/lander/b');
  assert.ok(store.write('b', { status: 'merging-main', landing: { green: { head: green, at: now() } } }).ok);
  assert.deepEqual(store.list[0].landing.green, { head: green, at: now() }, 'the green head is kept by the store');
  const moved = pushMain(r, { 'other.txt': 'o\n' });
  state = 'success'; now.add(1);
  await run(opts);
  b = store.list[0];
  assert.equal(b.status, 'landed'); assert.ok(holds(r, b.landing.lastMerge.head, moved));
  assert.deepEqual(statuses(b).slice(-5), ['merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main', 'landed']);
  assert.ok(onMain(r, 'a.txt'));
});

test('the store keeps rules that could not run as an error with its try count: the gate stays closed across ticks', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const gh = github(r); const now = clock(); const store = contractStore([p2(now, [['s1', 'claude/b-s1']])], { now });
  const opts = base(r, gh, store, now, { buildRules: () => ({ error: 'the rules runner printed no JSON (exit 1)', tail: 'TypeError: x' }) });
  await run(opts);
  let b = store.list[0];
  assert.equal(b.landing.rules.error, 'the rules runner printed no JSON (exit 1)'); assert.equal(b.landing.rules.tries, 1); assert.equal(b.landing.rules.ok, false);
  now.add(1); await run(opts);
  b = store.list[0];
  assert.equal(b.status, 'failed'); assert.equal(b.failure.kind, 'infra'); assert.match(b.failure.why, /Last lines: TypeError: x/);
  assert.equal(gh.calls.filter((c) => c.startsWith('PUT')).length, 0);
  // the one allowed skip still lands, and says why it skipped
  const r2 = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const gh2 = github(r2); const store2 = contractStore([p2(now, [['s1', 'claude/b-s1']])], { now });
  const out = await run(base(r2, gh2, store2, now, { buildRules: () => ({ skipped: 'no build-rules provider installed' }) }));
  assert.equal(store2.list[0].status, 'landed'); assert.ok(out.actions.some((a) => a.includes('build rules skipped: no build-rules provider installed')));
});

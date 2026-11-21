// node --test deploy/watchdog/core.test.mjs — the pure decision table of the Pipeline 2.0 watchdog (layer 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from './core.mjs';
import * as P2 from '../../framework/core/pipeline-status.mjs';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const ago = (min) => new Date(NOW - min * 60_000).toISOString();
const S = C.normSettings();

test('one contract: the watchdog has no status lists or rules of its own (P1-14)', () => {
  assert.equal(C.BUILD_FLOW, P2.BUILD_FLOW); assert.equal(C.STEP_FLOW, P2.STEP_FLOW);
  assert.equal(C.ACTIVE_BUILD, P2.ACTIVE); assert.equal(C.WAITING_BUILD, P2.WAITING); assert.equal(C.FAILED, P2.FAILED);
  assert.equal(C.forwardOk, undefined, 'no forward-only check of its own'); assert.equal(C.stamp, undefined, 'no status stamp of its own');
  const failedActive = { flow: 'pipeline-2', id: 'a', status: 'failed', failedFrom: 'running-ci' };
  assert.equal(C.isActive(failedActive), P2.holdsActive(failedActive)); assert.equal(C.isActive(failedActive), true);
  assert.equal(C.normSettings({ maxAttempts: 99 }).maxAttempts, P2.MAX_ATTEMPTS, 'the setting may lower the attempt ceiling, never raise it');
  assert.equal(C.normSettings({ maxAttempts: 3 }).maxAttempts, 3);
  // a status change the contract refuses changes nothing
  const store = { builds: [{ flow: 'pipeline-2', id: 'b', status: 'failed', failedFrom: 'building', attempt: 5, statusAt: ago(5), notes: [] }] };
  assert.equal(C.applyDecision(store, { build: 'b', status: 'failed' }, { action: 'retry', why: 'x' }, { now: NOW }), '');
  assert.deepEqual([store.builds[0].status, store.builds[0].attempt, store.builds[0].notes.length], ['failed', 5, 0]);
});

test('P1-01: a build waiting its turn is never stuck while a FAILED build holds the active place, however long', () => {
  const active = { flow: 'pipeline-2', id: 'act', status: 'failed', failedFrom: 'running-ci', attempt: 3, statusAt: ago(40), steps: [] };
  const waiting = ['w1', 'w2', 'w3', 'w4'].map((id) => ({ flow: 'pipeline-2', id, status: 'split', statusAt: ago(180), steps: [{ id: 's1', status: 'pending', statusAt: ago(180) }] }));
  const store = { builds: [active, ...waiting] };
  assert.deepEqual(C.findIssues(store, { now: NOW }), [], 'active build failed in running-ci + four builds waiting 3 hours = no issue raised');
  assert.deepEqual(C.findIssues({ builds: [{ ...active, status: 'failed', attempt: 4 }, { ...waiting[0], statusAt: ago(60 * 24 * 3) }] }, { now: NOW }), [], 'three days of waiting is still waiting');
  // the same pass, memory carried, never plans a fail for a waiting build
  let mem = {};
  for (let n = 0; n < 30; n += 1) {
    const now = NOW + n * 5 * 60_000;
    const issues = C.findIssues(store, { now }); const ds = issues.map((i) => C.plan(i, { now, memory: mem, store }));
    assert.ok(!ds.some((d) => d.action === 'fail'), 'no waiting build is ever failed');
    mem = C.nextMemory(mem, issues, ds, now);
  }
  // an archived or deleted build holds nothing, and an emergency build is not what the line waits for
  const gone = { builds: [{ ...active, deleted: true }, waiting[0]] };
  assert.equal(C.findIssues(gone, { now: NOW })[0]?.kind, 'build-stuck', 'nobody holds the place: now the wait is a stuck dispatcher');
  const onlyEmergency = { builds: [{ ...active, status: 'building', emergency: { at: ago(50), by: 'Brett' } }, waiting[0]] };
  assert.ok(C.findIssues(onlyEmergency, { now: NOW }).some((i) => i.build === 'w1' && i.kind === 'build-stuck'), 'an emergency build runs beside the line: it is not the build waited for');
  const emergencyWaiting = { builds: [active, { ...waiting[0], emergency: { at: ago(50), by: 'Brett' } }] };
  assert.ok(C.findIssues(emergencyWaiting, { now: NOW }).some((i) => i.build === 'w1'), 'an emergency build never waits for the place: stuck at split is stuck');
});

test('S5-05: a building step is hung at twice its estimate with a silent log, not after 2.5 hours', () => {
  const step = (id, estimate, min, extra = {}) => ({ id, status: 'building', statusAt: ago(min), estimate, account: 'a', ...extra });
  const b = { flow: 'pipeline-2', id: 'b', status: 'building', statusAt: ago(60), steps: [step('s1', '10 min', 25), step('s2', '10 min', 15), step('s3', '', 35), step('s4', '', 25), step('s5', '10 min', 25)] };
  const probes = { 'b/s1': { tmux: true, logAgeMin: 21 }, 'b/s2': { tmux: true, logAgeMin: 21 }, 'b/s3': { tmux: true, logAgeMin: 30 }, 'b/s4': { tmux: true, logAgeMin: 30 }, 'b/s5': { tmux: true, logAgeMin: 2 } };
  assert.deepEqual(C.findIssues({ builds: [b] }, { now: NOW, probes }).map((i) => `${i.step}:${i.kind}:${i.minutes}`), ['s1:step-hung:5', 's3:step-hung:5'], '2 x 10 min; no estimate = 2 x the 15 minute cap; a log still growing is never hung');
  assert.equal(C.STEP_BUDGET_MIN.building, undefined, 'no fixed building budget');
  assert.equal(P2.STEP_MAX_MINUTES, 15);
  const fixed = C.normSettings({ budgets: { step: { building: 120 } } });
  assert.deepEqual(C.findIssues({ builds: [b] }, { now: NOW, probes, settings: fixed }), [], 'a budget set in the settings still wins');
});

test('a status inside its budget is fine; past it is stuck', () => {
  const store = { builds: [{ flow: 'pipeline-2', id: 'a', status: 'splitting', statusAt: ago(5), steps: [] }, { flow: 'pipeline-2', id: 'b', status: 'merging-pr', statusAt: ago(45), steps: [] }] };
  const issues = C.findIssues(store, { now: NOW, settings: S });
  assert.deepEqual(issues.map((i) => [i.build, i.kind]), [['b', 'build-stuck']]);
});

test('split waits while another build is active (one active build), stuck when none is', () => {
  const waiting = { flow: 'pipeline-2', id: 'w', status: 'split', statusAt: ago(120), steps: [] };
  assert.equal(C.findIssues({ builds: [waiting, { flow: 'pipeline-2', id: 'x', status: 'building', statusAt: ago(1), steps: [] }] }, { now: NOW }).length, 0);
  assert.equal(C.findIssues({ builds: [waiting] }, { now: NOW })[0].kind, 'build-stuck');
});

test('building step: dead tmux, usage limit and hung log are found', () => {
  const b = { flow: 'pipeline-2', id: 'b', status: 'building', statusAt: ago(30), steps: [
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
  const store = { builds: [{ flow: 'pipeline-2', id: 'b', status: 'building', statusAt: ago(30), notes: [], steps: [{ flow: 'pipeline-2', id: 's', status: 'building', statusAt: ago(10), account: 'acc1', attempt: 1 }] }] };
  const [issue] = C.findIssues(store, { now: NOW, probes: { 'b/s': { tmux: true, logTail: 'usage limit reached' } } });
  const d = C.plan(issue, { now: NOW });
  assert.equal(d.action, 'fail-limit');
  C.applyDecision(store, issue, d, { now: NOW });
  const step = store.builds[0].steps[0];
  assert.equal(step.status, 'failed'); assert.equal(step.failedFrom, 'building'); assert.deepEqual(step.tried, ['acc1']);
  assert.equal(store.builds[0].notes.at(-1).by, 'watchdog');

  const later = NOW + 2 * 60_000;
  const [f] = C.findIssues(store, { now: later });
  assert.equal(f.kind, 'step-failed');
  const accounts = [{ name: 'acc1', usable: false }, { name: 'acc2', left: 0.2 }, { name: 'acc3', left: 0.7 }];
  const r = C.plan(f, { now: later, accounts });
  assert.deepEqual([r.action, r.to, r.account, r.attempt], ['retry', 'ready', 'acc3', 2]);
  C.applyDecision(store, f, r, { now: later });
  assert.deepEqual([step.status, step.attempt, step.account, step.statusBy], ['ready', 2, 'acc3', 'watchdog']);
  assert.equal(step.statusLog.at(-1).by, 'watchdog');
});

test('no account with usage left: the retry waits instead of relaunching on a dead account', () => {
  const issue = { kind: 'step-failed', build: 'b', step: 's', status: 'failed', failedFrom: 'building', attempt: 1, account: 'acc1', minutes: 5 };
  assert.equal(C.plan(issue, { now: NOW, accounts: [{ name: 'acc1', usable: false }] }).action, 'wait');
});

test('failed build retries forward at failedFrom; at maxAttempts it gives up once', () => {
  const store = { builds: [{ flow: 'pipeline-2', id: 'b', status: 'failed', failedFrom: 'building', attempt: 2, statusAt: ago(5), notes: [] }] };
  const [i] = C.findIssues(store, { now: NOW });
  const d = C.plan(i, { now: NOW, store });
  assert.deepEqual([d.action, d.to, d.attempt], ['retry', 'building', 3]);
  C.applyDecision(store, i, d, { now: NOW });
  assert.equal(store.builds[0].status, 'building');

  const done = { kind: 'build-failed', build: 'z', status: 'failed', failedFrom: 'merging-main', attempt: 5, minutes: 10 };
  const g = C.plan(done, { now: NOW });
  assert.equal(g.action, 'give-up');
  const mem = C.nextMemory({}, [done], [g], NOW);
  assert.equal(C.plan(done, { now: NOW, memory: mem }).action, 'wait');
});

test('a failed active build waits while another build holds the box (the contract says which one holds it)', () => {
  const store = { builds: [
    { flow: 'pipeline-2', id: 'a', status: 'failed', failedFrom: 'sending', attempt: 1, statusAt: ago(5), statusLog: [{ status: 'pulling-main', at: ago(20) }, { status: 'failed', at: ago(5) }] },
    { flow: 'pipeline-2', id: 'b', status: 'running-ci', statusAt: ago(1), statusLog: [{ status: 'pulling-main', at: ago(90) }, { status: 'running-ci', at: ago(1) }] },
  ] };
  const i = C.findIssues(store, { now: NOW }).find((x) => x.build === 'a');
  assert.deepEqual([C.plan(i, { now: NOW, store }).action, C.placeHolder(store).id], ['wait', 'b'], 'b became active first: it holds the place, a (the breach) waits');
  // the holder itself is retried, whoever else is there
  store.builds[1].statusLog[0].at = ago(10);
  assert.deepEqual([C.plan(i, { now: NOW, store }).action, C.placeHolder(store).id], ['retry', 'a']);
});

test('the lander owns its statuses: a landing failure is left to it, a stuck one is nudged with a lander tick, never failed', () => {
  const store = { builds: [
    { flow: 'pipeline-2', id: 'f', status: 'failed', failedFrom: 'running-ci', attempt: 4, statusAt: ago(30) },
    { flow: 'pipeline-2', id: 's', status: 'running-ci', statusAt: ago(200) },
  ] };
  const issues = C.findIssues(store, { now: NOW });
  assert.equal(issues.find((x) => x.build === 'f'), undefined);
  // B4-05: the ceiling stops the lander too; then it is a give-up like any other (one alert), never a silent "attempt 9"
  const spent = { builds: [{ flow: 'pipeline-2', id: 'g', status: 'failed', failedFrom: 'running-ci', attempt: 5, statusAt: ago(30) }] };
  const [gi] = C.findIssues(spent, { now: NOW });
  assert.deepEqual([gi.kind, gi.attempt], ['build-failed', 5]);
  const gd = C.plan(gi, { now: NOW, store: spent });
  assert.equal(gd.action, 'give-up');
  assert.equal(C.plan(gi, { now: NOW, store: spent, memory: C.nextMemory({}, [gi], [gd], NOW) }).action, 'wait', 'alerted once');
  const i = issues.find((x) => x.build === 's');
  assert.equal(i.lander, true);
  let mem = {};
  for (let n = 1; n <= 4; n += 1) {
    const d = C.plan(i, { now: NOW + n * 10 * 60_000, memory: mem });
    assert.deepEqual([d.action, d.lander], ['nudge', true]);
    mem = C.nextMemory(mem, [i], [d], NOW + n * 10 * 60_000);
  }
});

test('a record that moved since the scan is left alone', () => {
  const store = { builds: [{ flow: 'pipeline-2', id: 'b', status: 'running-ci', statusAt: ago(1) }] };
  assert.equal(C.applyDecision(store, { build: 'b', status: 'merging-pr' }, { action: 'fail', why: 'x' }, { now: NOW }), '');
  assert.equal(store.builds[0].status, 'running-ci');
});

test('pickAccount: most usage left, never an excluded or limited one', () => {
  assert.equal(C.pickAccount([{ name: 'a', left: 0.9, usable: false }, { name: 'b', left: 0.1 }, { name: 'c', left: 0.5 }], ['c']), 'b');
  assert.equal(C.pickAccount([{ name: 'a', left: 0 }]), '');
});

test('an Opus step out of attempts is raised to Fable once; a Fable step out of attempts gives up for good', () => {
  const accts = [{ name: 'a', left: 0.9 }, { name: 'b', left: 0.5 }];
  const store = { builds: [{ flow: 'pipeline-2', id: 'b', status: 'building', statusAt: ago(30), notes: [], steps: [{ id: 's1', status: 'failed', failedFrom: 'building', attempt: C.DEFAULTS.maxAttempts, model: 'Opus', account: 'a', statusAt: ago(5) }] }] };
  const [i] = C.findIssues(store, { now: NOW });
  const d = C.plan(i, { now: NOW, accounts: accts, store });
  assert.deepEqual([d.action, d.to, d.model, d.attempt, d.account, d.reset], ['escalate', 'ready', 'Fable', 1, 'b', true]);
  const note = C.applyDecision(store, i, d, { now: NOW });
  const st = store.builds[0].steps[0];
  assert.deepEqual([st.status, st.model, st.attempt, st.account, st.failedFrom], ['ready', 'Fable', 1, 'b', undefined], 'past the ceiling only as a reset: a fresh attempt count on Fable');
  assert.deepEqual([st.statusLog.at(-1).reset, /raised to Fable/.test(st.statusLog.at(-1).why)], [true, true], 'the reset and its reason are in the log (the store guard asks for both)');
  assert.match(note, /raised Opus → Fable after 5 failed attempts/);
  // Fable uses up its attempts too: final give-up, alerted once, then left alone
  Object.assign(st, { status: 'failed', failedFrom: 'building', attempt: C.DEFAULTS.maxAttempts, statusAt: ago(5) });
  const [j] = C.findIssues(store, { now: NOW });
  const g = C.plan(j, { now: NOW, accounts: accts, store });
  assert.equal(g.action, 'give-up'); assert.match(g.why, /Fable included/);
  assert.equal(C.plan(j, { now: NOW, accounts: accts, memory: C.nextMemory({}, [j], [g], NOW) }).action, 'wait');
  // a step that failed before its slot (pulling-main) is never escalated: plain give-up
  const pm = { kind: 'step-failed', build: 'x', step: 's1', status: 'failed', failedFrom: 'pulling-main', attempt: 5, model: 'Opus', minutes: 5 };
  assert.equal(C.plan(pm, { now: NOW, accounts: accts }).action, 'give-up');
  assert.equal(C.DEFAULTS.maxAttempts, 5, 'the shared cap (pipeline-status MAX_ATTEMPTS)');
});

test('a completed step waits for its siblings: never stuck while the build builds; failed-from-completed heals back', () => {
  const store = { builds: [{ flow: 'pipeline-2', id: 'b', status: 'building', statusAt: ago(10), notes: [], steps: [
    { id: 's1', status: 'completed', statusAt: ago(400) },
    { id: 's2', status: 'failed', failedFrom: 'completed', attempt: 21, statusAt: ago(10) },
  ] }] };
  const issues = C.findIssues(store, { now: NOW });
  assert.equal(issues.find((i) => i.step === 's1'), undefined, 'a completed step 400 min old is not stuck while the build is building');
  const i = issues.find((x) => x.step === 's2');
  const d = C.plan(i, { now: NOW, memory: { alerted: { [C.keyOf(i)]: ago(5) } } });
  assert.deepEqual([d.action, d.to, d.reset], ['retry', 'completed', true], 'its session ended cleanly: back to completed (cap and earlier alert ignored: a reset)');
  C.applyDecision(store, i, d, { now: NOW });
  assert.deepEqual([store.builds[0].steps[1].status, store.builds[0].steps[1].attempt, store.builds[0].steps[1].done], ['completed', 1, true]);
  // once the lander owns the build a late completed step is the lander's: nudged, never failed
  const late = { builds: [{ flow: 'pipeline-2', id: 'l', status: 'merging-pr', statusAt: ago(5), steps: [{ id: 's1', status: 'completed', statusAt: ago(400) }] }] };
  const li = C.findIssues(late, { now: NOW }).find((x) => x.step === 's1');
  assert.equal(li?.lander, true);
  assert.equal(C.plan(li, { now: NOW }).action, 'nudge');
});

test('a build waiting its turn: its pending and ready steps are never late, the active build\'s are', () => {
  const store = { builds: [
    { flow: 'pipeline-2', id: 'act', status: 'building', statusAt: ago(10), steps: [{ id: 's1', status: 'pending', statusAt: ago(120) }] },
    { flow: 'pipeline-2', id: 'wait', status: 'split', statusAt: ago(120), steps: [{ id: 's1', status: 'pending', statusAt: ago(400) }, { id: 's2', status: 'ready', statusAt: ago(400) }] },
  ] };
  const issues = C.findIssues(store, { now: NOW });
  assert.equal(issues.filter((i) => i.build === 'wait').length, 0, 'the waiting build is left alone');
  assert.ok(issues.some((i) => i.build === 'act' && i.step === 's1'), 'a pending step of the active build is still watched');
});

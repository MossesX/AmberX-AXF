#!/usr/bin/env node
/**
 * check-build-steps — the small-steps rule (Oct 21 2026) in pending-core and build-queue-core:
 * step entries (done/doneAt), the `step` action, `subPrompts` replace, splitCheck / needsSplit / stepsProgress,
 * artifact round trip, build-queue `stepsAction` + the view's steps/estimate/minutesLeft, and `unsplitSteps`.
 * Pure (no files written). Exit 1 on the first failure.
 *
 *   node framework/spec/check-build-steps.mjs
 */
import assert from 'node:assert/strict';
import * as pc from '../plan/pending-core.mjs';
import * as qc from '../plan/build-queue-core.mjs';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}: ${e.message}`); process.exit(1); } };
const T0 = '2026-10-21T00:00:00.000Z', T1 = '2026-10-21T01:00:00.000Z';

// ---- estimates
t('estimateMinutes', () => { assert.equal(pc.estimateMinutes('45 min'), 45); assert.equal(pc.estimateMinutes('1.5 h'), 90); assert.equal(pc.estimateMinutes('2 d'), 960); assert.equal(pc.estimateMinutes('soon'), null); });
t('SPLIT_LIMIT_MINUTES is 30', () => assert.equal(pc.SPLIT_LIMIT_MINUTES, 30));

// ---- pending: steps on sub prompts
let s = pc.emptyPending();
t('add big item', () => { const r = pc.apply(s, { action: 'add', title: 'Big build', estimate: '2 h' }, T0); s = r.state; assert.equal(s.items[0].id, 'big-build'); });
t('big item without steps needs split', () => { const c = pc.splitCheck(s.items[0]); assert.equal(c.needsSplit, true); assert.equal(c.totalMinutes, 120); assert.match(c.reasons[0], /no steps/); });
t('small item never needs split', () => assert.equal(pc.needsSplit({ estimate: '30 min' }), false));
t('no estimate = not flagged', () => assert.equal(pc.needsSplit({ subPrompts: [] }), false));
t('sub with estimate', () => { s = pc.apply(s, { action: 'sub', id: 'big-build', text: 'one', estimate: '30 min' }, T0).state; s = pc.apply(s, { action: 'sub', id: 'big-build', text: 'two', estimate: '45 min' }, T0).state; });
t('step over 30 min flagged', () => { const c = pc.splitCheck(s.items[0]); assert.equal(c.needsSplit, true); assert.match(c.reasons[0], /step 2 is 45 min/); });
t('step without estimate flagged on a big build', () => { const c = pc.splitCheck({ estimate: '2 h', subPrompts: [{ text: 'x' }] }); assert.match(c.reasons[0], /no estimate/); });
t('step action re-estimates and ticks', () => { const r = pc.apply(s, { action: 'step', id: 'big-build', index: 1, estimate: '25 min', done: true }, T1); s = r.state; const sp = s.items[0].subPrompts[1]; assert.equal(sp.estimate, '25 min'); assert.equal(sp.done, true); assert.equal(sp.doneAt, T1); assert.match(r.log[0], /step 2/); });
t('ticking again keeps doneAt', () => { const r = pc.apply(s, { action: 'step', id: 'big-build', index: 1, done: true }, '2026-10-22T00:00:00.000Z'); assert.equal(r.state.items[0].subPrompts[1].doneAt, T1); });
t('untick clears done + doneAt', () => { const r = pc.apply(s, { action: 'step', id: 'big-build', index: 1, done: false }, T1); const sp = r.state.items[0].subPrompts[1]; assert.equal(sp.done, undefined); assert.equal(sp.doneAt, undefined); });
t('step reword', () => { const r = pc.apply(s, { action: 'step', id: 'big-build', index: 0, text: 'one, reworded' }, T1); assert.equal(r.state.items[0].subPrompts[0].text, 'one, reworded'); });
t('step bad index throws', () => assert.throws(() => pc.apply(s, { action: 'step', id: 'big-build', index: 9, done: true }), /no step 9/));
t('step empty text throws', () => assert.throws(() => pc.apply(s, { action: 'step', id: 'big-build', index: 0, text: '  ' }), /text is required/));
t('split check clean after fix', () => { const c = pc.splitCheck(s.items[0]); assert.equal(c.needsSplit, false); assert.deepEqual(c.reasons, []); });
t('stepsProgress', () => { const p = pc.stepsProgress(s.items[0]); assert.deepEqual(p, { done: 1, total: 2, minutesTotal: 55, minutesLeft: 30, minutesDone: 25 }); });
t('stepsProgress without steps = whole estimate left', () => assert.deepEqual(pc.stepsProgress({ estimate: '1 h' }), { done: 0, total: 0, minutesTotal: 60, minutesLeft: 60, minutesDone: 0 }));
t('itemEstimate = the steps added up when every step has one (Oct 23 2026)', () => assert.equal(pc.itemEstimate(s.items[0]), '55 min'));
t('itemEstimate keeps its own estimate while a step has none', () => assert.equal(pc.itemEstimate({ estimate: '2 h', subPrompts: [{ text: 'a', estimate: '20 min' }, { text: 'b' }] }), '2 h'));
t('stepsProgress: unestimated steps share what the own estimate leaves', () => assert.deepEqual(pc.stepsProgress({ estimate: '2 h', subPrompts: [{ text: 'a', estimate: '20 min', done: true }, { text: 'b' }] }), { done: 1, total: 2, minutesTotal: 120, minutesLeft: 100, minutesDone: 20 }));
t('formatMinutes: hours past an hour, never 8-hour days', () => { assert.equal(pc.formatMinutes(45), '45 min'); assert.equal(pc.formatMinutes(150), '2.5 h'); assert.equal(pc.formatMinutes(1170), '19.5 h'); assert.equal(pc.formatMinutes(0), ''); });
t('cost in dollars from the pricing file', () => {
  const pricing = { models: { opus: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } }, heuristic: { tokensPerMinute: { input: 5000, output: 3000, cacheRead: 300000, cacheWrite: 0 } } };
  assert.equal(pc.minuteCostUsd('Opus', pricing), 0.14);
  assert.equal(pc.costForMinutes('claude-opus-5-5', 60, pricing), 8.4);
  assert.equal(pc.costForMinutes('Fable', 60, pricing), null);
  assert.equal(pc.formatUsd(8.4), '$8.40'); assert.equal(pc.formatUsd(1650.2), '$1,650'); assert.equal(pc.formatUsd(null), '');
});
t('update replaces subPrompts', () => { const r = pc.apply(s, { action: 'update', id: 'big-build', estimate: '', subPrompts: [{ text: 'a', estimate: '20 min' }, { text: 'b', estimate: '30 min', done: true, doneAt: T0 }] }, T1); const it = r.state.items[0]; assert.equal(it.estimate, undefined); assert.equal(it.subPrompts.length, 2); assert.equal(it.subPrompts[0].at, T1); assert.equal(it.subPrompts[1].doneAt, T0); assert.equal(pc.itemEstimate(it), '50 min'); });
t('update subPrompts refuses empty text', () => assert.throws(() => pc.apply(s, { action: 'update', id: 'big-build', subPrompts: [{ text: '' }] }), /needs text/));
t('normalize keeps done/doneAt, drops false', () => { const it = pc.normalize({ title: 'x', subPrompts: [{ text: 'a', done: true, doneAt: T0 }, { text: 'b', done: false }] }, T1); assert.equal(it.subPrompts[0].doneAt, T0); assert.equal('done' in it.subPrompts[1], false); });
t('normalize done without doneAt falls back to at', () => { const it = pc.normalize({ title: 'x', subPrompts: [{ text: 'a', at: T0, done: true }] }, T1); assert.equal(it.subPrompts[0].doneAt, T0); });
t('artifact round trip keeps steps', () => { const a = pc.toArtifact(s.items[0]); assert.equal(a.subPrompts[1].done, true); assert.equal(a.subPrompts[1].doneAt, Date.parse(T1)); assert.equal(typeof a.subPrompts[0].at, 'number'); const back = pc.fromArtifact(a); assert.equal(back.subPrompts[1].doneAt, T1); assert.equal(back.subPrompts[1].estimate, '25 min'); assert.equal('done' in back.subPrompts[0], false); });
t('old payloads still apply', () => { const r = pc.apply(s, { action: 'update', id: 'big-build', subEstimates: ['10 min', ''] }, T1); assert.equal(r.state.items[0].subPrompts[0].estimate, '10 min'); assert.equal(r.state.items[0].subPrompts[1].estimate, undefined); });

// ---- build queue
const features = [
  { id: 'x.a', kind: 'epic', title: 'A', status: 'planned', model: 'opus' },
  { id: 'x.b', kind: 'epic', title: 'B', status: 'planned', model: 'fable', dependsOn: ['x.a'] },
  { id: 'x.c', kind: 'epic', title: 'C', status: 'built', model: 'opus' },
];
let q = null;
t('stepsAction sets estimate + steps', () => { q = qc.stepsAction(features, q, { id: 'x.a', estimate: '2 h', steps: [{ text: 'one', estimate: '30 min' }, { text: 'two', estimate: '1 h' }] }, T0, 'test'); assert.equal(q.steps['x.a'].estimate, '2 h'); assert.equal(q.steps['x.a'].steps.length, 2); assert.match(q.history.at(-1).text, /A: ~2 h, 2 step\(s\) set/); });
t('view carries steps and flags the big one', () => { const v = qc.computeQueue(features, q); const a = v.steps.find((x) => x.id === 'x.a'); assert.equal(a.estimate, '1.5 h'); /* the steps added up (Oct 23 2026) */ assert.equal(a.needsSplit, true); assert.match(a.splitReasons[0], /step 2 is 1 h/); assert.equal(a.minutesLeft, 90); assert.deepEqual(v.unsplit, ['x.a']); assert.equal(v.minutesLeftByModel.opus, 90); assert.equal(v.minutesLeftByModel.fable, 0); });
t('unsplitSteps lists only remaining steps', () => { const u = qc.unsplitSteps(features, q); assert.deepEqual(u.map((x) => x.id), ['x.a']); });
t('index edit: re-estimate + tick', () => { q = qc.stepsAction(features, q, { id: 'x.a', index: 1, stepEstimate: '30 min', done: true }, T1, 'test'); const st = q.steps['x.a'].steps[1]; assert.equal(st.estimate, '30 min'); assert.equal(st.done, true); assert.equal(st.doneAt, T1); const v = qc.computeQueue(features, q); const a = v.steps.find((x) => x.id === 'x.a'); assert.equal(a.needsSplit, false); assert.equal(a.stepsDone, 1); assert.equal(a.minutesLeft, 30); assert.deepEqual(v.unsplit, []); });
t('add + removeIndex', () => { q = qc.stepsAction(features, q, { id: 'x.a', add: { text: 'three', estimate: '15 min' } }, T1); assert.equal(q.steps['x.a'].steps.length, 3); q = qc.stepsAction(features, q, { id: 'x.a', removeIndex: 2 }, T1); assert.equal(q.steps['x.a'].steps.length, 2); });
t('estimate without steps = view estimate, flagged', () => { q = qc.stepsAction(features, q, { id: 'x.b', estimate: '3 h' }, T1); const b = qc.computeQueue(features, q).steps.find((x) => x.id === 'x.b'); assert.equal(b.estimate, '3 h'); assert.equal(b.needsSplit, true); assert.equal(b.steps.length, 0); });
t('steps without estimate = summed estimate', () => { q = qc.stepsAction(features, q, { id: 'x.b', estimate: '', steps: [{ text: 'p', estimate: '20 min' }, { text: 'q', estimate: '25 min' }] }, T1); const b = qc.computeQueue(features, q).steps.find((x) => x.id === 'x.b'); assert.equal(b.estimate, '45 min'); assert.equal(b.needsSplit, false); });
t('clearing everything removes the record', () => { const q2 = qc.stepsAction(features, q, { id: 'x.b', estimate: '', steps: [] }, T1); assert.equal(q2.steps['x.b'], undefined); });
t('done steps are never flagged', () => { const q2 = qc.stepsAction(features, q, { id: 'x.c', estimate: '5 h' }, T1); assert.deepEqual(qc.unsplitSteps(features, q2).map((x) => x.id), []); });
t('unknown epic throws', () => assert.throws(() => qc.stepsAction(features, q, { id: 'x.zz', estimate: '1 h' }), /no build step/));
t('bad index throws', () => assert.throws(() => qc.stepsAction(features, q, { id: 'x.a', index: 7, done: true }), /no step 7/));
t('empty step text throws', () => assert.throws(() => qc.stepsAction(features, q, { id: 'x.a', add: { text: ' ' } }), /text is required/));
t('recordSteps tolerates junk', () => assert.deepEqual(qc.recordSteps({ steps: [{ text: 'ok', done: 'yes' }, { text: '' }, null] }), [{ text: 'ok' }]));
t('stepAction + syncQueue keep steps', () => { const r = qc.stepAction(features, q, { id: 'x.a', action: 'start' }, T1); assert.equal(r.queue.steps['x.a'].steps.length, 2); const sy = qc.syncQueue(features, r.queue, T1); assert.equal(sy.queue.steps['x.a'].estimate, '2 h'); });
t('old view fields unchanged', () => { const v = qc.computeQueue(features, null); assert.equal(v.steps[0].steps.length, 0); assert.equal(v.steps[0].estimate, ''); assert.equal(v.steps[0].needsSplit, false); assert.deepEqual(v.unsplit, []); });

console.log(`check-build-steps: ${n} checks passed`);

#!/usr/bin/env node
/**
 * pipeline-2@1 checks (framework/spec/PIPELINE-2.md): the status contract engine (framework/core/pipeline-status.mjs)
 * against its fixture, the JSON Schemas' enums against the engine, the store guard (forward-only, at / by stamped,
 * refusals logged), the split, the model pick, the account pick, the one-active rule, plan-build@1 (planning steps) and
 * the splitting stage's design checks (normDesign, fallbackDesign).
 *   node framework/spec/check-pipeline-2.mjs            check
 *   node framework/spec/check-pipeline-2.mjs --write    regenerate framework/spec/fixtures/pipeline-2.json from the engine
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../core/pipeline-status.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIX = join(ROOT, 'framework/spec/fixtures/pipeline-2.json');
let n = 0; let failed = 0;
const ok = (c, what) => { n++; if (!c) { failed++; console.error(`FAIL ${what}`); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// ---- transition cases: the fixture is the engine's answers, so a port answers the same
const CASES = [
  ['build', { status: 'pending' }, 'splitting'], ['build', { status: 'split' }, 'pulling-main'], ['build', { status: 'ready' }, 'building'],
  ['build', { status: 'building' }, 'ready'], ['build', { status: 'landed' }, 'failed'], ['build', { status: 'landed' }, 'landed'],
  ['build', { status: 'building' }, 'failed'], ['build', { status: 'failed', failedFrom: 'building', attempt: 1 }, 'sending'],
  ['build', { status: 'failed', failedFrom: 'building', attempt: 1 }, 'building'], ['build', { status: 'failed', failedFrom: 'building', attempt: 2 }, 'build-complete'],
  ['build', { status: 'running' }, 'building'], ['build', {}, 'pending'], ['build', { status: 'pending' }, 'queued'], ['build', { status: 'building' }, 'archived'],
  ['step', { status: 'pending' }, 'pulling-main'], ['step', { status: 'building' }, 'completed'], ['step', { status: 'completed' }, 'building'],
  ['step', { status: 'completed' }, 'in-pr'], ['step', { status: 'in-pr' }, 'failed'], ['step', { status: 'building' }, 'failed'],
  ['step', { status: 'failed', failedFrom: 'building', attempt: 1 }, 'sending'], ['step', { status: 'failed', failedFrom: 'building', attempt: 1 }, 'building'],
  ['step', { status: 'ready' }, 'build-complete'],
  // the two named re-entries (watchdog relaunch at ready; the lander's PR groups)
  ['step', { status: 'failed', failedFrom: 'building', attempt: 1 }, 'ready'], ['step', { status: 'failed', failedFrom: 'completed', attempt: 1 }, 'ready'],
  ['build', { status: 'merging-main' }, 'merging-pr'], ['build', { status: 'merging-main' }, 'running-ci'],
  ['build', { status: 'failed', failedFrom: 'merging-main', attempt: 1 }, 'pr-pulling-main'], ['build', { status: 'failed', failedFrom: 'running-ci', attempt: 1 }, 'building'],
  // the attempt ceiling (B4-05): at MAX_ATTEMPTS nothing leaves failed without a reset; a reset starts again at attempt 1
  ['step', { status: 'failed', failedFrom: 'building', attempt: 4 }, 'ready'], ['step', { status: 'failed', failedFrom: 'building', attempt: 5 }, 'ready'],
  ['build', { status: 'failed', failedFrom: 'running-ci', attempt: 9 }, 'running-ci'], ['build', { status: 'failed', failedFrom: 'split', attempt: 5 }, 'split'],
  ['step', { status: 'failed', failedFrom: 'building', attempt: 5 }, 'ready', { reset: true, why: 'raised to Fable' }], ['build', { status: 'failed', failedFrom: 'split', attempt: 5 }, 'split', { reset: true, why: 'Retry by Brett' }],
  ['build', { status: 'failed', failedFrom: 'split', attempt: 5 }, 'split', { reset: true }], ['build', { status: 'failed', failedFrom: 'building', attempt: 5 }, 'ready', { reset: true, why: 'Retry by Brett' }],
  // archive (B4-03): a build returns only to the status it was archived from, or to failed from it
  ['build', { flow: 'pipeline-2', status: 'archived', archivedFrom: 'building' }, 'building'], ['build', { flow: 'pipeline-2', status: 'archived', archivedFrom: 'building' }, 'failed'],
  ['build', { flow: 'pipeline-2', status: 'archived', archivedFrom: 'building' }, 'pending'], ['build', { flow: 'pipeline-2', status: 'archived', archivedFrom: 'building' }, 'landed'],
  ['build', { flow: 'pipeline-2', status: 'archived', statusLog: [{ status: 'ready', at: 'T' }, { status: 'archived', at: 'T' }] }, 'split'], ['build', { flow: 'pipeline-2', status: 'archived', statusLog: [{ status: 'ready', at: 'T' }, { status: 'archived', at: 'T' }] }, 'ready'],
  ['build', { flow: 'pipeline-2', status: 'archived', archivedFrom: 'failed', failedFrom: 'running-ci', attempt: 3 }, 'failed'], ['build', { flow: 'pipeline-2', status: 'archived', archivedFrom: 'landed' }, 'failed'],
  ['build', { status: 'archived' }, 'pending'], ['build', { flow: 'pipeline-2', status: 'archived' }, 'building'],
  // in the contract but the status was lost: it continues from the last status its log shows, never from anywhere
  ['build', { flow: 'pipeline-2', status: 'running', statusLog: [{ status: 'building', at: 'T' }] }, 'pending'], ['build', { flow: 'pipeline-2', status: 'running', statusLog: [{ status: 'building', at: 'T' }] }, 'build-complete'],
];
const answer = ([kind, rec, to, opts = {}]) => { const t = P.transition(rec, to, { kind, at: '2026-11-19T12:00:00.000Z', by: 'fixture', ...opts }); return { kind, rec, to, ...(Object.keys(opts).length ? { opts } : {}), ok: t.ok, ...(t.ok ? { status: t.rec.status, attempt: t.rec.attempt ?? null, failedFrom: t.rec.failedFrom ?? null, ...(t.rec.archivedFrom ? { archivedFrom: t.rec.archivedFrom } : {}) } : { why: t.why }) }; };
const fixture = {
  $axf: 'pipeline-2-fixture@1', schema: P.SCHEMA, buildFlow: P.BUILD_FLOW, stepFlow: P.STEP_FLOW, active: P.ACTIVE,
  labels: { build: P.BUILD_LABELS, step: P.STEP_LABELS, failed2: P.labelOf('failed', 2) },
  transitions: CASES.map(answer),
  split: [
    { steps: [{ files: ['a/x.mjs'] }, { files: ['b'] }, { files: ['a'] }, { files: [] }], slots: 3 },
    { steps: [{ files: ['x'] }, { files: ['x/y'] }, { files: ['x/z'] }], slots: 4 },
    { steps: [{}, {}, {}, {}, {}], slots: 2 },
    // the step cap (S5-05): steps are never joined past it, even when they share files or the slots are full
    { steps: [{ files: ['x'], minutes: 10 }, { files: ['x/y'], minutes: 5 }, { files: ['x/z'], minutes: 5 }], slots: 4 },
    { steps: [{ estimate: '10 min' }, { estimate: '10 min' }, { estimate: '5 min' }, { estimate: '5 min' }], slots: 2 },
    { steps: [{ files: ['x'], minutes: 12 }, { files: ['x'], minutes: 12 }], slots: 1, maxMinutes: 30 },
  ].map((c) => ({ ...c, parts: P.splitParts(c.steps, c.slots, c.maxMinutes ? { maxMinutes: c.maxMinutes } : {}).map((p) => p.map((s) => c.steps.indexOf(s))) })),
  plans: [
    { $axf: 'plan-build@1', id: 'good-plan', title: 'Good', steps: [{ text: 'a', model: 'Opus', minutes: 20 }] },
    { $axf: 'plan-build@1', id: 'planning-only', title: 'No hints', steps: [{ text: 'a' }, { text: 'b', minutes: 90 }] },
    { $axf: 'plan-build@1', id: 'body-only', title: 'Body', detail: 'Do the thing.', steps: [] },
    { $axf: 'plan-build@1', id: 'Bad Id', title: '', steps: [{ text: 'a', model: 'Sonnet', minutes: 45 }, { text: 'a', model: 'Opus', minutes: 0 }] },
    { $axf: 'plan-build@1', id: 'no-steps', title: 'x', steps: [] },
  ].map((p) => ({ plan: p, errors: P.validatePlan(p).map((x) => x.path) })),
  normPlan: P.normPlan({ id: 'x', title: ' T ', steps: [{ text: 'a', model: 'sonnet', estimate: '45 min' }, { text: 'b', model: 'fable' }, { text: 'c', model: '' }] }),
  designs: [
    { steps: [{ text: 'Schema', model: 'fable', minutes: 20, files: ['a'] }, { text: 'UI', model: 'Opus', minutes: 30 }] },
    { steps: [{ text: 'x', model: 'Sonnet', minutes: 90 }, { text: '', model: 'Opus' }] },
    [{ text: 'list form', model: 'Opus', minutes: 5 }],
    { steps: [] }, null,
  ].map((answer) => ({ answer, ...P.normDesign(answer), errors: P.normDesign(answer).errors.map((x) => x.path) })),
  fallbacks: [
    { title: 'T', planning: [{ text: 'Write the contract' }, { text: 'Button', minutes: 10 }, { text: 'Big', minutes: 90 }] },
    { title: 'Engine work', detail: 'Body only.' },
  ].map((b) => ({ build: b, steps: P.fallbackDesign(b) })),
  maxAttempts: P.MAX_ATTEMPTS,
  stepMaxMinutes: P.STEP_MAX_MINUTES,
  stepBudgets: [{ estimate: '10 min' }, { minutes: 15 }, {}, { estimate: '40 min' }].map((step) => ({ step, minutes: P.stepBudgetMinutes(step) })),
  stepsLocked: [
    { flow: 'pipeline-2', status: 'pending' }, { flow: 'pipeline-2', status: 'splitting' }, { flow: 'pipeline-2', status: 'failed', failedFrom: 'splitting' },
    { flow: 'pipeline-2', status: 'split' }, { flow: 'pipeline-2', status: 'failed', failedFrom: 'split' }, { flow: 'pipeline-2', status: 'building' },
    { flow: 'pipeline-2', status: 'archived', archivedFrom: 'ready' }, { flow: 'pipeline-2', status: 'landed' }, { status: 'running' },
  ].map((build) => ({ build, locked: P.stepsLocked(build), frozen: P.stepsFrozen(build) })),
  sendable: [
    { status: 'ready' }, { status: 'ready', attempt: 9 }, { status: 'failed', failedFrom: 'building', attempt: 4 },
    { status: 'failed', failedFrom: 'building', attempt: 5 }, { status: 'failed', failedFrom: 'sending', attempt: 21 },
    { status: 'failed', failedFrom: 'pulling-main', attempt: 1 }, { status: 'building' }, { status: 'completed' },
  ].map((step) => ({ step, sendable: P.sendable(step), gaveUp: P.gaveUp(step) })),
  // emergency builds: beside the one active build (never the active one, never a breach), oldest tag first
  emergency: (() => {
    const tag = (at) => ({ at, by: 'Brett' });
    const builds = [
      { id: 'active', flow: 'pipeline-2', status: 'building', statusAt: '2' },
      { id: 'e-late', flow: 'pipeline-2', status: 'split', statusAt: '3', emergency: tag('2026-11-20T10:05:00.000Z') },
      { id: 'e-first', flow: 'pipeline-2', status: 'failed', failedFrom: 'running-ci', statusAt: '4', emergency: tag('2026-11-20T10:00:00.000Z') },
      { id: 'e-unsplit', flow: 'pipeline-2', status: 'pending', statusAt: '5', emergency: tag('2026-11-20T10:01:00.000Z') },
      { id: 'e-landed', flow: 'pipeline-2', status: 'landed', statusAt: '6', emergency: tag('2026-11-20T09:00:00.000Z') },
      { id: 'untagged', flow: 'pipeline-2', status: 'split', statusAt: '1', emergency: { by: 'someone' } },
    ];
    const a = P.activeBuild(builds);
    return { builds, active: a.active?.id ?? null, others: a.others.map((b) => b.id), emergency: P.emergencyBuilds(builds).map((b) => b.id), tags: builds.map((b) => P.normEmergency(b.emergency)) };
  })(),
  // hand builds: beside the one active build (never the active one, never a breach); watched only while their session is out
  hand: (() => {
    const tag = (at) => ({ at, by: 'Earl the Ear' });
    const builds = [
      { id: 'h-first', flow: 'pipeline-2', status: 'building', statusAt: '1', hand: tag('2026-11-23T10:00:00.000Z') },
      { id: 'active', flow: 'pipeline-2', status: 'building', statusAt: '2' },
      { id: 'h-landing', flow: 'pipeline-2', status: 'running-ci', statusAt: '3', hand: tag('2026-11-23T09:00:00.000Z') },
      { id: 'h-failed', flow: 'pipeline-2', status: 'failed', failedFrom: 'building', statusAt: '4', hand: tag('2026-11-23T08:00:00.000Z') },
      { id: 'h-archived', flow: 'pipeline-2', status: 'archived', archivedFrom: 'building', statusAt: '5', hand: tag('2026-11-23T07:00:00.000Z') },
      { id: 'untagged', flow: 'pipeline-2', status: 'building', statusAt: '6', hand: { by: 'someone' } },
    ];
    const a = P.activeBuild(builds);
    return { builds, active: a.active?.id ?? null, others: a.others.map((b) => b.id), hand: P.handBuilds(builds).map((b) => b.id), beside: builds.map((b) => P.besideLine(b)), tags: builds.map((b) => P.normHand(b.hand)) };
  })(),
  budgetStops: [{ at: '2026-11-23T10:00:00.000Z', kind: 'build', spentUsd: 55.5, capUsd: 50 }, { at: '2026-11-23T10:00:00.000Z', kind: 'daily', spentUsd: '65', capUsd: 60 }, { at: '2026-11-23T10:00:00.000Z', kind: 'weekly' }, { kind: 'build' }, null]
    .map((stop) => ({ stop, norm: P.normBudgetStop(stop), stopped: P.isBudgetStopped({ budgetStop: stop }) })),
};
if (process.argv.includes('--write')) { writeFileSync(FIX, `${JSON.stringify(fixture, null, 1)}\n`); console.log(`wrote ${FIX}`); process.exit(0); }
let fx = null; try { fx = JSON.parse(readFileSync(FIX, 'utf8')); } catch { ok(false, `fixture ${FIX} missing: run with --write`); }
if (fx) eq(fx, JSON.parse(JSON.stringify(fixture)), 'the engine answers as its fixture says');

// ---- the rules themselves (not only "same as last time")
const t = (rec, to, kind = 'build') => P.transition(rec, to, { kind, at: 'T', by: 'x' });
const core0 = (f) => [f.archivedFrom, P.normFields({ status: 'building', archivedFrom: 'building', flow: 'pipeline-2' }).archivedFrom];
ok(!t({ status: 'building' }, 'ready').ok, 'backward refused');
{ // hand builds (Nov 23 2026): beside the line
  const hb = { id: 'h', flow: 'pipeline-2', status: 'building', statusAt: '1', hand: { at: '2026-11-23T10:00:00.000Z', by: 'x' } };
  const ab = { id: 'a', flow: 'pipeline-2', status: 'building', statusAt: '2' };
  eq([P.activeBuild([hb, ab]).active.id, P.activeBuild([hb, ab]).others.length], ['a', 0], 'a hand build is never the active build and never a breach');
  eq(P.activeBuild([hb]).active, null, 'a hand build alone leaves the active place free');
  const back = P.enforceFlow({ builds: [{ ...hb, status: 'archived', archivedFrom: 'building' }, ab] }, { builds: [{ ...hb, status: 'building' }, ab] }, { at: 'T', by: 'x' });
  eq(back.refused, [], 'an archived hand build returns to building while another build is active');
  ok(P.isHand(hb) && !P.isHand(ab) && !P.isHand({ hand: { by: 'x' } }) && P.besideLine(hb) && !P.besideLine(ab), 'the tag needs its time');
}
ok(t({ status: 'ready' }, 'building').ok, 'forward skip allowed');
eq(t({ status: 'building', attempt: 1 }, 'failed').rec.failedFrom, 'building', 'failed records where it failed');
eq(t({ status: 'failed', failedFrom: 'building', attempt: 1 }, 'building').rec.attempt, 2, 'a retry is attempt + 1');
ok(!t({ status: 'failed', failedFrom: 'building', attempt: 1 }, 'ready').ok, 'a retry never goes back');
eq(P.labelOf('failed', 3), 'failed, attempt 3', 'failed label');
ok(P.gaveUp({ status: 'failed', failedFrom: 'building', attempt: 5 }) && !P.sendable({ status: 'failed', failedFrom: 'building', attempt: 5 }), 'a give-up is final: never sendable again');
ok(P.sendable({ status: 'failed', failedFrom: 'building', attempt: 4 }) && P.sendable({ status: 'ready', attempt: 6 }), 'attempts left, or the watchdog moved it to ready: sendable');
ok(!P.sendable({ status: 'failed', failedFrom: 'building', attempt: 3 }, 3), 'the cap is a setting');
eq(P.labelOf('split'), 'Pending', 'split shows as Pending');
const r1 = t({}, 'pending').rec; eq([r1.statusAt, r1.statusBy, r1.statusLog.length, r1.flow], ['T', 'x', 1, 'pipeline-2'], 'at / by / log / flow recorded');
ok(t({ status: 'in-pr' }, 'failed', 'step').ok === false, 'in-pr is final for a step');
eq(t({ status: 'building' }, 'completed', 'step').rec.done, true, 'completed step is done');

// ---- the store guard
const before = { builds: [{ id: 'b1', flow: 'pipeline-2', status: 'building', statusAt: 'T0', statusBy: 'a', attempt: 1, steps: [{ id: 's1', uid: 'u1', status: 'completed', statusAt: 'T0', done: true }, { id: 's2', uid: 'u2', status: 'building', statusAt: 'T0' }] }, { id: 'old', status: 'running', steps: [] }] };
const after = JSON.parse(JSON.stringify(before));
after.builds[0].status = 'ready'; after.builds[0].steps[0].status = 'building'; after.builds[0].steps[1].status = 'completed'; after.builds[1].status = 'queued';
const g = P.enforceFlow(before, after, { at: 'T1', by: 'tester' });
eq(g.store.builds[0].status, 'building', 'store: backward build move refused');
eq(g.store.builds[0].steps[0].status, 'completed', 'store: backward step move refused');
// B4-04: a refusal is strict. Nothing of the write is kept for that build, its legal parts included, and a note says so
eq([g.store.builds[0].steps[1].status, g.store.builds[0].steps[1].statusAt], ['building', 'T0'], 'store: a refused write keeps nothing for that build, its legal step move included');
ok(g.store.builds[0].notes.length === 1 && /refused a write by tester, nothing of it was kept/.test(g.store.builds[0].notes[0].text) && g.store.builds[0].notes[0].by === 'store', 'store: the refused write is one note on the build');
{
  const stale = JSON.parse(JSON.stringify(before)); stale.builds[0].status = 'ready'; stale.builds[0].title = 'changed by a stale writer'; stale.builds[0].pr = '#9'; stale.builds[0].steps[1].text = 'rewritten';
  const s1 = P.enforceFlow(before, stale, { at: 'T1', by: 'stale' });
  eq([s1.store.builds[0].title, s1.store.builds[0].pr, s1.store.builds[0].steps[1].text, s1.refused.length], [undefined, undefined, undefined, 1], 'store: a refused status takes the title, the pr and the step text of the same write with it');
  const s2 = P.enforceFlow(s1.store, { builds: [{ ...stale.builds[0], notes: s1.store.builds[0].notes }, stale.builds[1]] }, { at: 'T2', by: 'stale' });
  eq(s2.store.builds[0].notes.length, 1, 'store: the same refused write again adds no second note');
  const loose = P.enforceFlow(before, stale, { at: 'T1', by: 'stale', strict: false });
  eq([loose.store.builds[0].status, loose.store.builds[0].title], ['building', 'changed by a stale writer'], 'store: strict off keeps the content and drops only the status (the old behaviour, on request)');
}
{
  const fwd = JSON.parse(JSON.stringify(before)); fwd.builds[0].steps[1].status = 'completed';
  const f1 = P.enforceFlow(before, fwd, { at: 'T1', by: 'tester' });
  eq([f1.store.builds[0].steps[1].status, f1.store.builds[0].steps[1].statusAt, f1.store.builds[0].steps[1].statusBy, f1.refused.length], ['completed', 'T1', 'tester', 0], 'store: a hand-made forward move gets at / by');
}
eq(g.store.builds[1].status, 'queued', 'store: builds@1 builds are untouched');
eq(g.refused.map((r) => `${r.id}${r.step ? `/${r.step}` : ''}:${r.from}>${r.to}`), ['b1:building>ready', 'b1/s1:completed>building'], 'store: refusals listed');
const legacyIn = P.enforceFlow({ builds: [{ id: 'x', status: 'queued', steps: [] }] }, { builds: [{ id: 'x', status: 'splitting', steps: [] }] }, { at: 'T', by: 'y' });
eq([legacyIn.store.builds[0].flow, legacyIn.store.builds[0].statusBy], ['pipeline-2', 'y'], 'store: a builds@1 build entering the contract joins the flow');
const out = P.enforceFlow({ builds: [{ id: 'x', flow: 'pipeline-2', status: 'building', steps: [] }] }, { builds: [{ id: 'x', flow: 'pipeline-2', status: 'running', steps: [] }] });
eq([out.store.builds[0].status, out.refused.length], ['building', 1], 'store: a Pipeline 2.0 build cannot fall back to a builds@1 status');

// ---- B4-02: once split, a build's steps keep their identity; P1-05: every step has a status
{
  const st = (id, uid, status) => ({ id, uid, text: id, status, statusAt: 'T0' });
  const b0 = (status, extra = {}) => ({ builds: [{ id: 'b', flow: 'pipeline-2', status, statusAt: 'T0', attempt: 1, steps: [st('s1', 'u1', 'building'), st('s2', 'u2', 'ready')], ...extra }] });
  const write = (prev, fn, opts = {}) => { const next = JSON.parse(JSON.stringify(prev)); fn(next.builds[0]); return P.enforceFlow(prev, next, { at: 'T1', by: 'writer', ...opts }); };
  const swapped = write(b0('building'), (b) => { b.steps = [{ id: 's1', uid: 'new', text: 'again', status: 'pending', statusAt: 'T1' }]; });
  eq([swapped.store.builds[0].steps.map((s) => `${s.uid}:${s.status}`), [...new Set(swapped.refused.map((r) => r.step))]], [['u1:building', 'u2:ready'], ['s1', 's2']], 'steps: replacing the steps of a build that is being built is refused, the old steps and their statuses stay');
  const removed = write(b0('building'), (b) => { b.steps.pop(); });
  ok(removed.refused.length === 1 && /was removed/.test(removed.refused[0].why) && removed.store.builds[0].steps.length === 2, 'steps: removing a step past the split is refused');
  const added = write(b0('building'), (b) => { b.steps.push({ id: 's3', uid: 'u3', text: 'late' }); });
  ok(added.refused.length === 1 && /no step is added to a build that is being built/.test(added.refused[0].why) && added.store.builds[0].steps.length === 2, 'steps: adding a step past the split is refused with the reason');
  const waiting = b0('split'); waiting.builds[0].steps.forEach((s) => { s.status = 'pending'; });
  const addedWaiting = write(waiting, (b) => { b.steps.push({ id: 's3', uid: 'u3', text: 'one more' }); });
  eq([addedWaiting.refused.length, addedWaiting.store.builds[0].steps[2].status, addedWaiting.store.builds[0].steps[2].statusBy], [0, 'pending', 'writer'], 'steps: a build still waiting at split takes a new step, and it enters at pending');
  ok(write(waiting, (b) => { b.steps.shift(); }).refused.length === 1, 'steps: a waiting build loses no step either');
  const failedWaiting = b0('failed', { failedFrom: 'split' });
  ok(write(failedWaiting, (b) => { b.steps = []; }).refused.length === 2, 'steps: a build that failed while waiting keeps its steps too');
  const unsplit = b0('splitting'); unsplit.builds[0].steps.forEach((s) => { delete s.status; delete s.statusAt; });
  const split = write(unsplit, (b) => { b.status = 'split'; b.steps = [{ id: 's1', uid: 'n1', text: 'part', status: 'pending', statusAt: 'T1' }]; });
  eq([split.refused.length, split.store.builds[0].steps.map((s) => s.uid)], [0, ['n1']], 'steps: the split itself (splitting → split) sets the steps');
  // the explicit re-split: only a waiting build with no step past pending, only with the marked log line
  const again = P.transition(waiting.builds[0], 'split', { at: 'T1', by: 'orchestrator', resplit: true, why: 'the plan changed' });
  ok(again.ok && again.rec.statusLog.at(-1).resplit === true, 're-split: a waiting build may be split again, the log line says so');
  const re = P.enforceFlow(waiting, { builds: [{ ...again.rec, steps: [{ id: 's1', uid: 'r1', text: 'new cut', status: 'pending', statusAt: 'T1' }] }] }, { at: 'T1', by: 'orchestrator' });
  eq([re.refused.length, re.store.builds[0].steps.map((s) => s.uid)], [0, ['r1']], 're-split: that write may replace the steps');
  ok(!P.transition(b0('split').builds[0], 'split', { resplit: true, why: 'x' }).ok, 're-split: refused once a step is past pending');
  ok(!P.transition(waiting.builds[0], 'split', { resplit: true }).ok, 're-split: needs a reason');
  ok(!P.transition(b0('building').builds[0], 'split', { resplit: true, why: 'x' }).ok, 're-split: never for a build that is being built');
  // P1-05: no status is never a status
  const lost = write(b0('building'), (b) => { delete b.steps[0].status; delete b.steps[0].statusAt; b.steps[0].text = 'edited'; });
  eq([lost.refused.length, lost.store.builds[0].steps[0].status, lost.store.builds[0].steps[0].text], [0, 'building', 'edited'], 'steps: a step that arrives without its status keeps the one it had');
  const bare = b0('building'); delete bare.builds[0].steps[1].status; delete bare.builds[0].steps[1].statusAt;
  const healed = write(bare, (b) => { b.title = 'any write'; });
  eq([healed.store.builds[0].steps[1].status, healed.refused.length], ['pending', 0], 'steps: a step an older writer left without a status is given pending on the next write');
  const done = b0('landed'); delete done.builds[0].steps[1].status;
  eq(write(done, (b) => { b.title = 'x'; }).store.builds[0].steps[1].status, undefined, 'steps: the old steps of a landed build are left as they are');
  ok(P.everyStep({ steps: [{ status: 'completed' }, { status: 'pending', skip: true }] }, 'completed') && !P.everyStep({ steps: [{ skip: true }] }, 'completed') && !P.everyStep({ steps: [{ status: 'completed' }, {}] }, 'completed'), 'steps: the every-step tests ignore skipped steps, and a step with no status is never counted as there');
  eq([P.stepsEditRefusal(b0('building').builds[0]) !== '', P.stepsEditRefusal(b0('splitting').builds[0]), P.stepsEditRefusal(waiting.builds[0], { add: true })], [true, '', ''], 'steps: the reason for a refused edit, none before the split, none for an add while waiting');
}

// ---- B4-05: the attempt ceiling is the contract's, whoever writes
{
  ok(!t({ status: 'failed', failedFrom: 'running-ci', attempt: 5 }, 'running-ci').ok, 'ceiling: a build at attempt 5 does not leave failed (the lander too)');
  ok(t({ status: 'failed', failedFrom: 'running-ci', attempt: 4 }, 'running-ci').ok, 'ceiling: attempts left = the retry goes on');
  ok(t({ status: 'failed', failedFrom: 'building', attempt: 5 }, 'archived').ok, 'ceiling: a given-up build may still be archived');
  const reset = P.transition({ status: 'failed', failedFrom: 'building', attempt: 5, statusLog: [] }, 'ready', { kind: 'step', at: 'T', by: 'watchdog', reset: true, why: 'raised to Fable' });
  eq([reset.ok, reset.rec.attempt, reset.rec.statusLog.at(-1).reset, reset.rec.statusLog.at(-1).why], [true, 1, true, 'raised to Fable'], 'ceiling: a reset with a reason starts again at attempt 1, marked in the log');
  ok(!P.transition({ status: 'failed', failedFrom: 'building', attempt: 5 }, 'ready', { kind: 'step', reset: true }).ok, 'ceiling: a reset without a reason is refused');
  ok(!P.transition({ status: 'failed', failedFrom: 'building', attempt: 2 }, 'ready', { kind: 'step', max: 2 }).ok && P.transition({ status: 'failed', failedFrom: 'building', attempt: 5 }, 'ready', { kind: 'step', max: 99 }).ok === false, 'ceiling: a caller may lower it, never raise it');
  const gone = { builds: [{ id: 'b', flow: 'pipeline-2', status: 'failed', failedFrom: 'running-ci', attempt: 5, statusAt: 'T0', statusLog: [{ status: 'failed', at: 'T0', by: 'lander', attempt: 5 }], steps: [{ id: 's1', uid: 'u1', status: 'failed', failedFrom: 'building', attempt: 5, statusAt: 'T0' }] }] };
  const raw = JSON.parse(JSON.stringify(gone)); Object.assign(raw.builds[0], { status: 'running-ci', statusAt: 'T1', statusBy: 'lander' }); raw.builds[0].statusLog.push({ status: 'running-ci', at: 'T1', by: 'lander' });
  const r1 = P.enforceFlow(gone, raw, { at: 'T1', by: 'lander' });
  eq([r1.store.builds[0].status, r1.store.builds[0].attempt, /attempts used up/.test(r1.refused[0]?.why)], ['failed', 5, true], 'ceiling: the store refuses a hand-written retry past it (no "attempt 9")');
  const viaReset = JSON.parse(JSON.stringify(gone)); viaReset.builds[0] = { ...viaReset.builds[0], ...P.transition(gone.builds[0], 'running-ci', { at: 'T1', by: 'Brett', reset: true, why: 'Retry by Brett' }).rec };
  const r2 = P.enforceFlow(gone, viaReset, { at: 'T1', by: 'Brett' });
  eq([r2.store.builds[0].status, r2.store.builds[0].attempt, r2.refused.length], ['running-ci', 1, 0], 'ceiling: the store lets a marked reset through');
  const fake = JSON.parse(JSON.stringify(gone)); fake.builds[0].steps[0] = { ...fake.builds[0].steps[0], status: 'ready', statusAt: 'T1', statusLog: [{ status: 'ready', at: 'T1', by: 'x', reset: true }] };
  ok(P.enforceFlow(gone, fake, { at: 'T1', by: 'x' }).refused.length === 1, 'ceiling: a reset mark without a reason does not pass the store');
}

// ---- B4-03: archive is not a way back
{
  const arch = P.transition({ id: 'a', flow: 'pipeline-2', status: 'failed', failedFrom: 'running-ci', attempt: 3 }, 'archived', { at: 'T', by: 'Brett' }).rec;
  eq([arch.status, arch.archivedFrom, arch.failedFrom, arch.attempt], ['archived', 'failed', 'running-ci', 3], 'archive: the build remembers where it was (and where it failed)');
  const back = P.transition(arch, 'failed', { at: 'T2', by: 'Brett' }).rec;
  eq([back.status, back.failedFrom, back.attempt, back.archivedFrom, P.holdsActive(back)], ['failed', 'running-ci', 3, undefined, true], 'archive: it returns as it left, no fresh attempts, holding what it held');
  ok(!P.transition(arch, 'pending').ok && !P.transition(arch, 'building').ok, 'archive: then any status is refused');
  const fromBuilding = P.transition({ flow: 'pipeline-2', status: 'building', attempt: 2 }, 'archived', { at: 'T' }).rec;
  const failedBack = P.transition(fromBuilding, 'failed', { at: 'T2' }).rec;
  eq([failedBack.status, failedBack.failedFrom, failedBack.attempt], ['failed', 'building', 2], 'archive: or to failed from the status it was archived from');
  eq(core0(P.normFields({ status: 'archived', archivedFrom: 'building', flow: 'pipeline-2' })), ['building', undefined], 'archive: archivedFrom is a stored field only while archived');
  // un-archive never puts a second build into the active place
  const prev = { builds: [{ id: 'a', flow: 'pipeline-2', status: 'archived', archivedFrom: 'building', statusAt: 'T0', steps: [] }, { id: 'now', flow: 'pipeline-2', status: 'ready', statusAt: 'T0', steps: [] }] };
  const un = JSON.parse(JSON.stringify(prev)); un.builds[0].status = 'building';
  const u1 = P.enforceFlow(prev, un, { at: 'T1', by: 'Brett' });
  ok(u1.store.builds[0].status === 'archived' && /now holds the active place/.test(u1.refused[0]?.why), 'archive: no return into the active place while another build holds it');
  const free = JSON.parse(JSON.stringify(prev)); free.builds[1].status = 'landed'; const un2 = JSON.parse(JSON.stringify(free)); un2.builds[0].status = 'building';
  const u2 = P.enforceFlow(free, un2, { at: 'T1', by: 'Brett' });
  eq([u2.store.builds[0].status, u2.store.builds[0].archivedFrom, u2.refused.length], ['building', undefined, 0], 'archive: it returns once the place is free');
  const two = JSON.parse(JSON.stringify(prev)); two.builds[0].status = 'pending';
  ok(P.enforceFlow(prev, two, { at: 'T1', by: 'x' }).refused.length === 1, 'archive: archive then "set any status" is refused by the store');
}

// ---- the one active build
const act = P.activeBuild([{ id: 'a', flow: 'pipeline-2', status: 'building', statusAt: '2' }, { id: 'b', flow: 'pipeline-2', status: 'split', statusAt: '1' }, { id: 'c', flow: 'pipeline-2', status: 'failed', failedFrom: 'running-ci', statusAt: '3' }]);
eq([act.active?.id, act.others.map((x) => x.id)], ['a', ['c']], 'active: the first active one, the breach listed');
ok(!P.holdsActive({ flow: 'pipeline-2', status: 'failed', failedFrom: 'splitting' }), 'a build failed before main pull is not active');

// ---- emergency builds run beside the active one
eq([fixture.emergency.active, fixture.emergency.others], ['active', []], 'emergency: an emergency build is never the active one and never a breach');
eq(fixture.emergency.emergency, ['e-first', 'e-late'], 'emergency: split or past the main pull, oldest tag first; pending and landed ones left out');
ok(!P.isEmergency({ emergency: { by: 'someone' } }) && !P.isEmergency({ emergency: true }) && P.isEmergency({ emergency: { at: 'T', by: 'Brett' } }), 'emergency: the tag needs its at');
eq(P.normLanding({ mainPull: { head: 'abc', at: 'T' }, bogus: 1 }), { mainPull: { head: 'abc', at: 'T' } }, 'landing: the re-pull of main before a merge is kept');
eq(P.normLanding({ removal: { pr: 919, steps: ['s11'], at: 'T', by: 'watchdog', why: 'red twice', junk: 1 } }), { removal: { pr: 919, steps: ['s11'], at: 'T', by: 'watchdog', why: 'red twice' } }, 'landing: a part marked for removal is kept');
eq(P.normLanding({ removal: { steps: ['s1'] } }), null, 'landing: a removal mark names its PR');

// ---- the account pick
const now = Date.parse('2026-11-19T12:00:00Z');
const accts = [
  { name: 'a', usable: true, free: 2, running: 0, usageLeft: 0.9, limited: { until: '2026-11-21T03:00:00Z' } },
  { name: 'b', usable: true, free: 1, running: 1, usageLeft: 0.4 },
  { name: 'c', usable: true, free: 1, running: 0, usageLeft: 0.8 },
  { name: 'd', usable: true, free: 0, running: 3, usageLeft: 1 },
  { name: 'e', usable: true, free: 2, running: 0, usageLeft: 0 },
];
eq(P.pickAccount(accts, { now })?.name, 'c', 'pick: never out, full or empty; most usage left');
eq(P.pickAccount(accts, { now, onBuild: { c: 1 } })?.name, 'b', 'pick: spread steps evenly across accounts');
eq(P.pickAccount(accts, { now, exclude: ['b', 'c'] }), null, 'pick: nothing left = null (never an out account)');
eq(P.pickAccount([{ name: 'z', usable: true, limited: { until: '2026-11-19T11:00:00Z' } }], { now })?.name, 'z', 'pick: a limit past its reset is over');
eq(P.pinnedAccount(accts, { status: 'ready', account: 'b' }, { now })?.name, 'b', 'pin: a ready step pinned to an account that is not out goes there');
eq(P.pinnedAccount(accts, { status: 'ready', account: 'a' }, { now }), null, 'pin: never an account marked out (the normal pick chooses)');
eq(P.pinnedAccount(accts, { status: 'ready', account: 'd' }, { now }), null, 'pin: a full account falls back to the normal pick');
eq(P.pinnedAccount(accts, { status: 'failed', account: 'b' }, { now }), null, 'pin: only a step at ready is pinned');
eq(P.normFields({ status: 'ready', tried: ['a', 'a', 'b', ''] }, 'step').tried, ['a', 'b'], 'step tried: kept, unique');

// ---- schemas match the engine
const S = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/json/pipeline-2.schema.json'), 'utf8'));
eq(S.$defs.buildStatus.enum, [...P.BUILD_STATUSES], 'schema build statuses = engine');
eq(S.$defs.stepStatus.enum, [...P.STEP_STATUSES], 'schema step statuses = engine');
const PS = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/json/plan-build.schema.json'), 'utf8'));
eq(PS.properties.steps.items.required, ['text'], 'plan schema: planning steps need only text (no minutes, no model)');
eq(PS.properties.steps.maxItems, P.PLANNING_MAX, 'plan schema planning cap = engine');
eq(PS.properties.steps.items.properties.model.enum, [...P.PLAN_MODELS], 'plan schema model hints = engine');
eq(S.properties.planning.maxItems, P.PLANNING_MAX, 'pipeline-2 schema planning cap = engine');
ok(P.validatePlan(P.normPlan({ id: 'p', title: 'P', steps: [{ text: 'a' }] })).length === 0, 'a plan with planning steps and no minutes or models may be sent');
ok(P.normDesign({ steps: [{ text: 'a', model: 'Opus', minutes: P.STEP_MAX_MINUTES + 1 }] }).errors.length === 1, 'a designed build step over the cap is refused');
ok(P.fallbackDesign({ planning: [{ text: 'a', minutes: 99 }] })[0].minutes === P.STEP_MAX_MINUTES, 'the fallback caps minutes');
eq(PS.properties.id.pattern, P.PLAN_ID_RE.source, 'plan schema id = build-id@1');

// ---- the store layer end to end (a scratch store): forward-only enforced on every write, refusals logged
{
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'axf-p2-'));
  Object.assign(process.env, { AXF_BUILDS_STORE: join(dir, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILDS_EXPORT: '0' });
  const BS = await import('../cli/builds-store.mjs');
  const core = await import('../plan/builds-store-core.mjs');
  BS.withStore((s) => { s.builds.push(core.normBuild({ id: 'p2-demo', title: 'P2', flow: 'pipeline-2', status: 'pending', steps: [{ id: 's1', text: 'one' }] })); return s; }, { by: 'check' });
  let r = BS.setFlowStatus('p2-demo', 'splitting', { by: 'check' });
  eq([r.build.status, r.build.statusBy, r.build.statusLog.length], ['splitting', 'check', 2], 'store: flow status written with by and log');
  let threw = null; try { BS.setFlowStatus('p2-demo', 'pending', { by: 'check' }); } catch (e) { threw = e; }
  eq([threw?.code, BS.loadStore().builds.find((b) => b.id === 'p2-demo').status], ['backward', 'splitting'], 'store: setFlowStatus refuses a backward move and writes nothing');
  const w = BS.withStore((s) => { s.builds.find((b) => b.id === 'p2-demo').status = 'pending'; return s; }, { by: 'raw-writer' });
  eq([w.refused.length, BS.loadStore().builds.find((b) => b.id === 'p2-demo').status], [1, 'splitting'], 'store: a raw backward write is refused by withStore');
  r = BS.setFlowStatus('p2-demo', 'pulling-main', { step: 's1', by: 'check', extra: { worktree: '/w/p2-demo--s1', account: 'acc1', slot: 'hl-1' } });
  eq([r.step.status, r.step.worktree, r.step.account, r.step.slot], ['pulling-main', '/w/p2-demo--s1', 'acc1', 'hl-1'], 'store: step fields survive normalisation');
  BS.setFlowStatus('p2-demo', 'failed', { step: 's1', by: 'check' });
  r = BS.setFlowStatus('p2-demo', 'ready', { step: 's1', by: 'check' });
  eq([r.step.status, r.step.attempt], ['ready', 2], 'store: retry forward is attempt 2');
  r = BS.setFlowStatus('p2-demo', 'in-pr', { step: 's1', by: 'check', extra: { prNumber: 42 } });
  eq([r.step.done, r.step.prNumber], [true, 42], 'store: in-pr step done with its PR');
  { const v = core.validateStore(BS.loadStore()); ok(v.ok !== false && !(v.errors ?? []).length, `store: still valid builds@1: ${JSON.stringify(v.errors)}`); }
}

console.log(`${failed ? 'FAIL' : 'ok'} pipeline-2@1: ${n - failed}/${n}`);
process.exit(failed ? 1 : 0);

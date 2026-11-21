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
];
const answer = ([kind, rec, to]) => { const t = P.transition(rec, to, { kind, at: '2026-11-19T12:00:00.000Z', by: 'fixture' }); return { kind, rec, to, ok: t.ok, ...(t.ok ? { status: t.rec.status, attempt: t.rec.attempt ?? null, failedFrom: t.rec.failedFrom ?? null } : { why: t.why }) }; };
const fixture = {
  $axf: 'pipeline-2-fixture@1', schema: P.SCHEMA, buildFlow: P.BUILD_FLOW, stepFlow: P.STEP_FLOW, active: P.ACTIVE,
  labels: { build: P.BUILD_LABELS, step: P.STEP_LABELS, failed2: P.labelOf('failed', 2) },
  transitions: CASES.map(answer),
  split: [
    { steps: [{ files: ['a/x.mjs'] }, { files: ['b'] }, { files: ['a'] }, { files: [] }], slots: 3 },
    { steps: [{ files: ['x'] }, { files: ['x/y'] }, { files: ['x/z'] }], slots: 4 },
    { steps: [{}, {}, {}, {}, {}], slots: 2 },
  ].map((c) => ({ ...c, parts: P.splitParts(c.steps, c.slots).map((p) => p.map((s) => c.steps.indexOf(s))) })),
  models: ['Write the JSON schema', 'Fix the toolbar padding', 'Kernel scheduler', 'Add a button'].map((text) => ({ text, model: P.modelFor({ text }) })),
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
};
if (process.argv.includes('--write')) { writeFileSync(FIX, `${JSON.stringify(fixture, null, 1)}\n`); console.log(`wrote ${FIX}`); process.exit(0); }
let fx = null; try { fx = JSON.parse(readFileSync(FIX, 'utf8')); } catch { ok(false, `fixture ${FIX} missing: run with --write`); }
if (fx) eq(fx, JSON.parse(JSON.stringify(fixture)), 'the engine answers as its fixture says');

// ---- the rules themselves (not only "same as last time")
const t = (rec, to, kind = 'build') => P.transition(rec, to, { kind, at: 'T', by: 'x' });
ok(!t({ status: 'building' }, 'ready').ok, 'backward refused');
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
eq([g.store.builds[0].steps[1].status, g.store.builds[0].steps[1].statusAt, g.store.builds[0].steps[1].statusBy], ['completed', 'T1', 'tester'], 'store: a hand-made forward move gets at / by');
eq(g.store.builds[1].status, 'queued', 'store: builds@1 builds are untouched');
eq(g.refused.map((r) => `${r.id}${r.step ? `/${r.step}` : ''}:${r.from}>${r.to}`), ['b1:building>ready', 'b1/s1:completed>building'], 'store: refusals listed');
const legacyIn = P.enforceFlow({ builds: [{ id: 'x', status: 'queued', steps: [] }] }, { builds: [{ id: 'x', status: 'splitting', steps: [] }] }, { at: 'T', by: 'y' });
eq([legacyIn.store.builds[0].flow, legacyIn.store.builds[0].statusBy], ['pipeline-2', 'y'], 'store: a builds@1 build entering the contract joins the flow');
const out = P.enforceFlow({ builds: [{ id: 'x', flow: 'pipeline-2', status: 'building', steps: [] }] }, { builds: [{ id: 'x', flow: 'pipeline-2', status: 'running', steps: [] }] });
eq([out.store.builds[0].status, out.refused.length], ['building', 1], 'store: a Pipeline 2.0 build cannot fall back to a builds@1 status');

// ---- the one active build
const act = P.activeBuild([{ id: 'a', flow: 'pipeline-2', status: 'building', statusAt: '2' }, { id: 'b', flow: 'pipeline-2', status: 'split', statusAt: '1' }, { id: 'c', flow: 'pipeline-2', status: 'failed', failedFrom: 'running-ci', statusAt: '3' }]);
eq([act.active?.id, act.others.map((x) => x.id)], ['a', ['c']], 'active: the first active one, the breach listed');
ok(!P.holdsActive({ flow: 'pipeline-2', status: 'failed', failedFrom: 'splitting' }), 'a build failed before main pull is not active');

// ---- emergency builds run beside the active one
eq([fixture.emergency.active, fixture.emergency.others], ['active', []], 'emergency: an emergency build is never the active one and never a breach');
eq(fixture.emergency.emergency, ['e-first', 'e-late'], 'emergency: split or past the main pull, oldest tag first; pending and landed ones left out');
ok(!P.isEmergency({ emergency: { by: 'someone' } }) && !P.isEmergency({ emergency: true }) && P.isEmergency({ emergency: { at: 'T', by: 'Brett' } }), 'emergency: the tag needs its at');
eq(P.normLanding({ mainPull: { head: 'abc', at: 'T' }, bogus: 1 }), { mainPull: { head: 'abc', at: 'T' } }, 'landing: the re-pull of main before a merge is kept');

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

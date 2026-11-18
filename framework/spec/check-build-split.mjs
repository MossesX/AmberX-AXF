#!/usr/bin/env node
/**
 * split-plan@1 checks (framework/spec/BUILD-SPLIT.md): ids, the planner (as many parts as free slots, never two parts on
 * one file, every open step in exactly one part), the validator, and the part / run state machines with roll-up and
 * all-or-nothing combine. Golden cases live in fixtures/build-split.json; every port replays `in` and must answer `out`.
 *   node framework/spec/check-build-split.mjs            compare the engine with the fixture
 *   node framework/spec/check-build-split.mjs --write    regenerate the fixture's `out` blocks from the engine
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../core/build-split.mjs';
import * as core from '../plan/builds-store-core.mjs';
import * as BP from '../core/build-pipeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures/build-split.json');
const WRITE = process.argv.includes('--write');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const AT = '2026-11-18T12:00:00.000Z';
const SHA = 'a'.repeat(40); const SHA2 = 'b'.repeat(40);

const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'));
t('fixture schema', () => assert.equal(fx.$axf, 'build-split@1'));

// ---------------- ids
t('split id: <build>.r<n>; parse, part ref, branches, session', () => {
  assert.equal(S.splitIdOf('one-build-time', 2), 'one-build-time.r2');
  assert.equal(S.splitIdOf('Bad Id', 1), ''); assert.equal(S.splitIdOf('ok', 0), ''); assert.equal(S.splitIdOf('ok', 10000), '');
  assert.deepEqual(S.parseSplitId('one-build-time.r2'), { build: 'one-build-time', run: 2 });
  for (const bad of ['one-build-time', 'one-build-time.r0', 'one-build-time.r', 'x.r1/p1', 'UP.r1', '']) assert.equal(S.parseSplitId(bad), null, bad);
  assert.equal(S.partRef('a.r1', 'p3'), 'a.r1/p3'); assert.equal(S.partRef('a.r1', 'p0'), ''); assert.deepEqual(S.parsePartRef('a.r1/p3'), { build: 'a', run: 1, part: 'p3' }); assert.equal(S.parsePartRef('a.r1/p3/x'), null);
  assert.equal(S.partBranch('a.r1', 'p3'), 'claude/a--r1-p3'); assert.deepEqual(S.parsePartBranch('claude/a--r1-p3'), { splitId: 'a.r1', part: 'p3' }); assert.equal(S.parsePartBranch('claude/a'), null);
  assert.equal(S.combineBranch('a'), 'claude/a'); assert.equal(S.partSession('a.r1', 'p3', 'earl'), 'axf-a--r1-p3--earl'); assert.equal(S.partSession('a.r1', 'p3'), 'axf-a--r1-p3');
  assert.ok(!/^claude\/a\//.test(S.partBranch('a.r1', 'p1')), 'a part branch is never under the build branch (git refs cannot nest)');
});
t('fixture ids replay', () => { const got = fx.in.ids.map((x) => ({ splitId: S.splitIdOf(x.build, x.run), partRef: S.partRef(S.splitIdOf(x.build, x.run), x.part), branch: S.partBranch(S.splitIdOf(x.build, x.run), x.part), session: S.partSession(S.splitIdOf(x.build, x.run), x.part, x.agent) })); if (WRITE) fx.out.ids = got; else assert.deepEqual(got, fx.out.ids); });

// ---------------- records
t('normSplit: shape, another build\'s plan dropped, unknown part status falls to failed, never done', () => {
  const p = S.normSplit({ id: 'a.r1', parts: [{ id: 'p1', steps: ['s1'], status: 'bogus' }, { steps: ['s2'] }], combine: {} }, { build: 'a' });
  assert.equal(p.$axf, 'split-plan@1'); assert.equal(p.run, 'queued'); assert.equal(p.parts[0].status, 'failed'); assert.equal(p.parts[1].id, 'p2'); assert.equal(p.parts[1].status, 'waiting');
  assert.equal(p.parts[0].branch, 'claude/a--r1-p1'); assert.equal(p.combine.branch, 'claude/a'); assert.equal(p.maxRebuilds, S.DEFAULT_MAX_REBUILDS);
  assert.equal(S.normSplit({ id: 'a.r1', parts: [] }, { build: 'b' }), null); assert.equal(S.normSplit({ id: 'nope' }), null); assert.equal(S.normSplit(null), null);
  assert.ok(same(p, S.normSplit(p, { build: 'a' })), 'round-trips');
});
t('normMainLock: a lock without build, split id, sha or time is no lock; the split id names the build', () => {
  const l = S.normMainLock({ $axf: 'main-lock@1', build: 'a', splitId: 'a.r1', base: SHA, lockedAt: AT, by: 'dispatcher' });
  assert.deepEqual(l, { $axf: 'main-lock@1', build: 'a', splitId: 'a.r1', base: SHA, lockedAt: AT, by: 'dispatcher' });
  assert.equal(S.normMainLock({ build: 'a', splitId: 'b.r1', base: SHA, lockedAt: AT }), null); assert.equal(S.normMainLock({ build: 'a', splitId: 'a.r1', base: 'short', lockedAt: AT }), null);
});
t('buildStatusOf: every run state maps onto a builds@1 status', () => { for (const r of S.RUN_STATES) assert.ok(core.STATUSES.includes(S.buildStatusOf(r)), r); assert.equal(S.buildStatusOf('splitting'), 'splitting'); assert.equal(S.buildStatusOf('finished'), 'complete'); assert.equal(S.buildStatusOf('failed'), 'fixing'); assert.equal(S.buildStatusOf('nope'), ''); });
t('builds@1 carries splitting (table building, Active tab, live) and the record fields', () => {
  assert.ok(core.STATUSES.includes('splitting')); assert.equal(BP.tableOf({ status: 'splitting' }), 'building'); assert.equal(BP.tabOf({ status: 'splitting' }), 'active'); assert.ok(BP.isLive({ status: 'splitting' }));
  const b = core.normBuild({ id: 'a', title: 'A', status: 'splitting', splitId: 'a.r1', split: { id: 'a.r1', parts: [{ id: 'p1', steps: ['s1'] }] }, steps: [{ id: 's1', text: 'x' }], later: { field: 1 } });
  assert.equal(b.splitId, 'a.r1'); assert.equal(b.split.id, 'a.r1'); assert.deepEqual(b.later, { field: 1 }, 'unknown fields are carried over');
  assert.equal(core.validateStore({ $axf: 'builds@1', rev: 1, builds: [b] }).ok, true);
  const plain = core.normBuild({ id: 'b', title: 'B' }); assert.ok(!('split' in plain) && !('splitId' in plain), 'a build never split has no split fields: no migration');
  const v = core.validateStore({ $axf: 'builds@1', rev: 1, builds: [{ ...b, splitId: 'a.r2' }] }); assert.ok(v.errors.some((e) => /splitId/.test(e.path)), 'splitId must equal split.id');
});

// ---------------- planner
t('estimates: minutes, hours, nothing', () => { assert.equal(S.estimateMinutes({ estimate: '10 min' }), 10); assert.equal(S.estimateMinutes({ estimate: '~15m' }), 15); assert.equal(S.estimateMinutes({ estimate: '1.5 h' }), 90); assert.equal(S.estimateMinutes({ estimate: '' }), S.DEFAULT_STEP_MINUTES); assert.equal(S.estimateMinutes(null), S.DEFAULT_STEP_MINUTES); });
t('claims: step files plus the planner\'s, normalised', () => assert.deepEqual(S.claimsOf({ id: 's1', files: [' ./a.js ', 'a.js', ''] }, { s1: ['b.js', './a.js'] }), ['a.js', 'b.js']));
const planCases = fx.in.plans.map((c) => { const r = S.planParts(c.build, c.freeSlots, c.fileClaims ?? {}, { at: AT, base: c.base ?? '', ...(c.opts ?? {}) }); return { name: c.name, ok: r.ok, why: r.why, fill: r.fill, groups: r.groups.map((g) => g.steps), parts: (r.plan?.parts ?? []).map((p) => ({ id: p.id, steps: p.steps, files: p.files, branch: p.branch, model: p.model })), id: r.plan?.id ?? '', run: r.plan?.run ?? '', base: r.plan?.base ?? '' }; });
if (WRITE) fx.out.plans = planCases;
for (const [i, c] of planCases.entries()) t(`plan fixture: ${c.name}`, () => assert.deepEqual(c, fx.out.plans[i]));
for (const c of fx.in.plans) {
  const r = S.planParts(c.build, c.freeSlots, c.fileClaims ?? {}, { at: AT, base: c.base ?? '' });
  if (!r.ok) continue;
  t(`invariants: ${c.name}`, () => {
    const parts = r.plan.parts;
    assert.ok(parts.length >= 1 && parts.length <= c.freeSlots, 'between one and the free slots');
    assert.equal(parts.length, Math.min(c.freeSlots, r.groups.length), 'as many as the slots allow, never more than the file groups');
    const files = parts.flatMap((p) => p.files); assert.equal(files.length, new Set(files).size, 'no file in two parts');
    const open = c.build.steps.filter((s) => !s.done && !s.skip).map((s) => s.id); const got = parts.flatMap((p) => p.steps);
    assert.deepEqual([...got].sort(), [...open].sort(), 'every open step in exactly one part');
    assert.ok(parts.every((p) => p.base === r.plan.base), 'one base'); assert.ok(parts.every((p) => p.status === 'waiting' && p.rebuilds === 0), 'parts start waiting');
    assert.equal(S.validatePlan(r.plan, c.build).ok, true, 'the planner\'s plan is valid');
    assert.ok(same(r.plan, S.normSplit(r.plan, { build: c.build.id })), 'in shape');
    parts.forEach((p, k) => assert.equal(p.id, `p${k + 1}`));
  });
}
t('planner: run numbers count up from the build\'s last split id', () => {
  const b = { id: 'a', splitId: 'a.r3', steps: [{ id: 's1', text: 'x' }] };
  assert.equal(S.planParts(b, 1, {}, { at: AT }).plan.id, 'a.r4'); assert.equal(S.nextRunOf({ id: 'a' }), 1); assert.equal(S.planParts(b, 1, {}, { at: AT, run: 9 }).plan.id, 'a.r9');
  assert.equal(S.planParts(b, 1, {}, { at: AT, run: 2 }).ok, false, 'a run not after the last is refused');
});
t('planner: a bad build id, no open step, no slot', () => {
  assert.match(S.planParts({ id: 'Bad' }, 2).why, /not a build id/); assert.match(S.planParts({ id: 'a', steps: [{ id: 's1', done: true }] }, 2).why, /no open step/); assert.match(S.planParts({ id: 'a', steps: [{ id: 's1' }] }, 0).why, /no free agent slot/);
});

// ---------------- validator
const vBuild = fx.in.validate.build;
const vBase = S.planParts(vBuild, 3, {}, { at: AT, base: SHA }).plan;
const validateCases = fx.in.validate.cases.map((c) => { const plan = JSON.parse(JSON.stringify(vBase)); const f = new Function('plan', 'SHA2', c.mutate); f(plan, SHA2); const v = S.validatePlan(plan, vBuild, c.opts ?? {}); return { name: c.name, ok: v.ok, errors: v.errors }; });
if (WRITE) fx.out.validate = validateCases;
for (const [i, c] of validateCases.entries()) t(`validate fixture: ${c.name}`, () => assert.deepEqual(c, fx.out.validate[i]));
t('validatePlan: the untouched plan is valid; no plan is not', () => { assert.deepEqual(S.validatePlan(vBase, vBuild), { ok: true, errors: [] }); assert.equal(S.validatePlan(null, vBuild).ok, false); assert.equal(S.validatePlan({ id: 'other.r1', parts: [] }, vBuild).ok, false); });

// ---------------- state machines
t('transition tables: every state named, terminal states go nowhere, every target is a known state', () => {
  for (const s of S.PART_STATUSES) assert.ok(Array.isArray(S.PART_TRANSITIONS[s]), s); for (const s of S.RUN_STATES) assert.ok(Array.isArray(S.RUN_TRANSITIONS[s]), s);
  assert.deepEqual(S.PART_TRANSITIONS.done, ['rebuilding'], 'a done part only moves for a combine conflict'); assert.deepEqual(S.RUN_TRANSITIONS.finished, []); assert.deepEqual(S.RUN_TRANSITIONS.failed, []);
  for (const [from, tos] of Object.entries(S.PART_TRANSITIONS)) for (const to of tos) { assert.ok(S.PART_STATUSES.includes(to), `${from}→${to}`); assert.ok(S.canPart(from, to)); }
  for (const [from, tos] of Object.entries(S.RUN_TRANSITIONS)) for (const to of tos) { assert.ok(S.RUN_STATES.includes(to), `${from}→${to}`); assert.ok(S.canRun(from, to)); }
  assert.ok(!S.canPart('done', 'building')); assert.equal(S.partTarget('done', 'conflict'), 'rebuilding'); assert.equal(S.partTarget('building', 'conflict'), ''); assert.ok(!S.canPart('waiting', 'done')); assert.ok(!S.canRun('merged', 'failed'), 'merged is never failed'); assert.ok(!S.canRun('queued', 'combining'));
  for (const s of S.RUN_STATES) if (!S.RUN_TERMINAL.includes(s) && !['merged', 'live'].includes(s)) assert.ok(S.canRun(s, 'failed'), `${s} can fail`);
});
t('rollUp: no parts splitting, all waiting queued, all done combining, a terminal failure failed, else building', () => {
  const P = (...st) => st.map((status, i) => ({ id: `p${i + 1}`, status, rebuilds: 0 }));
  assert.equal(S.rollUp([]), 'splitting'); assert.equal(S.rollUp(P('waiting', 'waiting')), 'queued'); assert.equal(S.rollUp(P('done', 'done')), 'combining');
  assert.equal(S.rollUp(P('waiting', 'building')), 'building'); assert.equal(S.rollUp(P('done', 'testing')), 'building'); assert.equal(S.rollUp(P('done', 'rebuilding')), 'building');
  assert.equal(S.rollUp(P('done', 'failed')), 'building', 'a failed part with a rebuild left is still building'); assert.equal(S.rollUp([{ id: 'p1', status: 'failed', rebuilds: 2 }, { id: 'p2', status: 'done' }]), 'failed');
  assert.equal(S.rollUp(P('done', 'failed'), 0), 'failed', 'maxRebuilds 0: the first failure is terminal');
  assert.deepEqual(S.rollUpBadge({ run: 'building', parts: P('done', 'building', 'waiting') }), { state: 'building', done: 1, total: 3, label: 'Building 1/3' });
  assert.equal(S.rollUpBadge({ run: 'ci', parts: P('done') }).label, 'CI'); assert.equal(S.rollUpBadge({ run: 'merging', parts: P('done') }).label, 'Merging'); assert.equal(S.rollUpBadge(null).label, 'Splitting');
});
const mBuild = fx.in.validate.build;
const tick = (k) => `2026-11-18T12:${String(k + 1).padStart(2, '0')}:00.000Z`;
const brief = (plan) => ({ run: plan.run, parts: plan.parts.map((p) => ({ id: p.id, status: p.status, rebuilds: p.rebuilds, head: p.head, account: p.account })), combine: { head: plan.combine.head, pr: plan.combine.pr, ci: plan.combine.ci, attempts: plan.combine.attempts, mergedAt: plan.combine.mergedAt, finishedAt: plan.combine.finishedAt }, failure: plan.failure, history: plan.history.map((h) => `${h.at.slice(14, 16)} ${h.part ? `${h.part} ` : ''}${h.from}→${h.to}${h.why ? ` (${h.why})` : ''}`) });
const machine = fx.in.machine.scripts.map((sc) => {
  let plan = S.planParts(mBuild, 3, {}, { at: AT, base: SHA, maxRebuilds: sc.maxRebuilds }).plan;
  const steps = sc.ops.map((op, k) => {
    const at = tick(k);
    if (op.op === 'part') { const r = S.partNext(plan, op.part, op.event, { ...(op.args ?? {}), at }); plan = r.plan; return { op: `${op.part} ${op.event}`, ok: r.ok, why: r.why, change: r.change }; }
    if (op.op === 'failed') { const r = S.onPartFailed(plan, op.part, op.why, at); plan = r.plan; return { op: `${op.part} failed`, ok: r.ok, action: r.action, resetSteps: r.resetSteps, why: r.why }; }
    if (op.op === 'run') { const r = S.runNext(plan, op.to, { ...(op.args ?? {}), at }); plan = r.plan; return { op: `run ${op.to}`, ok: r.ok, why: r.why, change: r.change }; }
    if (op.op === 'rollup') { const r = S.applyRollUp(plan, at); plan = r.plan; return { op: 'rollup', change: r.change, run: plan.run }; }
    if (op.op === 'ready') return { op: 'ready', ...S.combineReady(plan) };
    throw new Error(`unknown op ${op.op}`);
  });
  assert.ok(same(plan, S.normSplit(plan, { build: mBuild.id })), `${sc.name}: the plan stays in shape`);
  return { name: sc.name, steps, final: brief(plan), badge: S.rollUpBadge(plan), ready: S.combineReady(plan) };
});
if (WRITE) fx.out.machine = machine;
for (const [i, m] of machine.entries()) t(`machine fixture: ${m.name}`, () => assert.deepEqual(m, fx.out.machine[i]));
t('machine: the happy path ends finished with every part done and a merged combine', () => { const m = machine[0]; assert.equal(m.final.run, 'finished'); assert.ok(m.final.parts.every((p) => p.status === 'done')); assert.equal(m.final.combine.pr, 4242); assert.ok(m.final.combine.mergedAt); assert.ok(m.steps.every((s) => s.op === 'ready' || s.ok !== false), JSON.stringify(m.steps.filter((s) => s.ok === false))); const ready = m.steps.filter((s) => s.op === 'ready'); assert.equal(ready[0].ok, false, 'two of three done: not ready'); assert.equal(ready[1].ok, true, 'all three done: ready'); });
t('machine: a failure with a rebuild left rebuilds that part only, resets its steps, the run keeps building', () => { const m = machine[1]; const f = m.steps.find((s) => s.op === 'p1 failed'); assert.equal(f.action, 'rebuild'); assert.deepEqual(f.resetSteps, ['s1', 's3']); assert.equal(m.final.parts[0].rebuilds, 1); assert.equal(m.final.parts[0].status, 'done'); assert.equal(m.final.parts[2].status, 'waiting', 'p3 was never launched'); assert.equal(m.final.run, 'building', 'the run keeps building while a part waits'); });
t('machine: a failure past maxRebuilds fails the run, abandons the waiting part, refuses everything after', () => { const m = machine[2]; assert.equal(m.final.run, 'failed'); assert.equal(m.final.failure.part, 'p1'); assert.equal(m.final.parts[2].status, 'failed'); assert.equal(m.final.parts[1].status, 'building', 'a part mid-build is left for the dispatcher to stop'); for (const s of m.steps.slice(-3)) assert.equal(s.ok, false, s.op); });
t('machine: all-or-nothing combine readiness', () => { const m = machine[5]; const ready = m.steps.filter((s) => s.op === 'ready'); assert.equal(ready[0].ok, false); assert.match(ready[0].why, /p3 waiting/); assert.equal(m.final.run, 'building'); });
t('machine: a combine conflict rebuilds the part and combines again; red CI goes back to combining', () => { const m = machine[6]; assert.equal(m.final.run, 'merged'); assert.equal(m.final.combine.attempts, 3); assert.equal(m.final.parts[1].rebuilds, 1); assert.equal(m.final.parts[1].head, SHA2); });
t('machine: maxRebuilds 0 fails the run on the first failure', () => { assert.equal(machine[7].final.run, 'failed'); assert.equal(machine[7].final.failure.part, 'p2'); });

if (WRITE) { writeFileSync(FIXTURE, `${JSON.stringify(fx, null, 1)}\n`); console.log(`wrote ${FIXTURE}`); }
console.log(`build-split: ${n} checks passed`);

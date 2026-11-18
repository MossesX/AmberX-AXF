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

if (WRITE) { writeFileSync(FIXTURE, `${JSON.stringify(fx, null, 1)}\n`); console.log(`wrote ${FIXTURE}`); }
console.log(`build-split: ${n} checks passed`);

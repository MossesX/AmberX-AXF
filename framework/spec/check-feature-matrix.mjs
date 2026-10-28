#!/usr/bin/env node
/**
 * check-feature-matrix — feature-matrix@1 (framework/plan/feature-matrix-core.mjs) and its Apply engine
 * (framework/plan/feature-matrix-apply.mjs) against spec/fixtures/feature-matrix.json.
 *
 * The fixture is a replay: `scenario` = a list of changes applied with fixed clocks; `expected` = the dataset, totals
 * and grid they must produce; `apply` = the targets (orchestrator build, pending item, build-queue record, change-log
 * entry, plan feature) before and after projecting the matrix onto them, plus the what-changed report, and the proof
 * that a second pass changes nothing. Any port of the contract (Python server, Kotlin later) replays the same file.
 *
 *   node framework/spec/check-feature-matrix.mjs            # check
 *   node framework/spec/check-feature-matrix.mjs --write    # regenerate the fixture from the reference cores
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fm from '../plan/feature-matrix-core.mjs';
import * as ap from '../plan/feature-matrix-apply.mjs';
import * as pc from '../plan/pending-core.mjs';
import * as qc from '../plan/build-queue-core.mjs';
import * as oc from '../../apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'feature-matrix.json');
const WRITE = process.argv.includes('--write');
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}: ${e.message}`); process.exit(1); } };
const T = (i) => `2026-10-28T19:${String(i).padStart(2, '0')}:00.000Z`;

// ---- scenario: the windows-terminal-style scope list of a small build, edited over a few minutes
const REF = { kind: 'orchestrator', id: 'demo-build' }; const PROFILE = 'refactor';
const scenario = [
  { at: T(0), change: { action: 'seed', ref: REF, profile: PROFILE, title: 'Demo build', items: [
    { id: 's1', name: 'Contract', why: 'cross-app data', group: 'Core', minutes: 30, model: 'Fable', source: { kind: 'step', id: 's1' } },
    { id: 's2', name: 'Apply engine', group: 'Core', minutes: 30, model: 'Fable', source: { kind: 'step', id: 's2' } },
    { id: 's3', name: 'Console page', group: 'UI', minutes: 30, model: 'Opus', source: { kind: 'step', id: 's3' } },
    { id: 's4', name: 'Grid hooks', group: 'UI', minutes: 20, model: 'Opus', source: { kind: 'step', id: 's4' } },
  ] } },
  { at: T(1), change: { action: 'seed', ref: REF, profile: PROFILE, items: [{ id: 's1', name: 'Contract (renamed by a reseed: ignored)' }, { id: 's3', name: 'Console page' }] } }, // reseed adds nothing
  { at: T(2), change: { action: 'skip', matrix: `${PROFILE}:orchestrator:demo-build`, item: 's4', by: 'brett' } },
  { at: T(3), change: { action: 'add-item', matrix: `${PROFILE}:orchestrator:demo-build`, item: { name: 'Dark mode shots', why: 'rebuild rule', group: 'Ship', minutes: 15, model: 'Opus' } } },
  { at: T(4), change: { action: 'edit-item', matrix: `${PROFILE}:orchestrator:demo-build`, item: 's2', data: { minutes: 25, why: 'projection onto five tables' } } },
  { at: T(5), change: { action: 'applied', matrix: `${PROFILE}:orchestrator:demo-build`, by: 'apply-engine' } },
  { at: T(6), change: { action: 'add-item', matrix: `${PROFILE}:orchestrator:demo-build`, item: { id: 's4', name: 'Grid hooks' } } }, // "add" an existing (skipped) item = back to keep
  { at: T(7), change: { action: 'skip', matrix: `${PROFILE}:orchestrator:demo-build`, item: 's3' } }, // skip a step that exists in every table
  { at: T(8), change: { action: 'seed', ref: { kind: 'pending', id: 'other' }, profile: 'main-framework', title: 'Other build', items: fm.itemsFromSubPrompts([{ text: 'one', estimate: '10 min' }, { text: 'two', estimate: '1 h', skip: true }], 'Opus', T(8)) } },
];

function replay() {
  let s = fm.emptyState(T(0)); const logs = [];
  for (const step of scenario) { const r = fm.apply(s, step.change, step.at); s = r.state; logs.push(r.log); }
  return { state: s, logs };
}

// ---- apply targets: the same build as it sits in each table
const targets = () => ({
  build: oc.normalizeState({ builds: [{ id: 'demo-build', title: 'Demo build', createdAt: T(0), updatedAt: T(0), steps: [
    { id: 's1', text: 'Contract', model: 'Fable', estimate: '30 min', group: 'Core', done: true, doneAt: T(0) },
    { id: 's2', text: 'Apply engine', model: 'Fable', estimate: '30 min', group: 'Core' },
    { id: 's3', text: 'Console page', model: 'Opus', estimate: '30 min', group: 'UI' },
    { id: 's4', text: 'Grid hooks', model: 'Opus', estimate: '20 min', group: 'UI' },
  ] }] }).builds[0],
  pending: pc.normalize({ id: 'demo-build', title: 'Demo build', model: 'Fable', createdAt: T(0), updatedAt: T(0), estimate: '2 h', subPrompts: [
    { text: 'Contract', at: T(0), estimate: '30 min', done: true, doneAt: T(0), fm: 's1' }, { text: 'Apply engine', at: T(0), estimate: '30 min', fm: 's2' }, { text: 'Console page', at: T(0), estimate: '30 min', fm: 's3' }, { text: 'Grid hooks', at: T(0), estimate: '20 min', fm: 's4' },
  ] }, T(0)),
  queue: { completedAt: null, completedBy: null, deps: [], estimate: '2 h', steps: [{ text: 'Contract', estimate: '30 min', done: true, doneAt: T(0), fm: 's1' }, { text: 'Apply engine', estimate: '30 min', fm: 's2' }, { text: 'Console page', estimate: '30 min', fm: 's3' }, { text: 'Grid hooks', estimate: '20 min', fm: 's4' }] },
  change: { id: 'chg-20261028-abcdef', kind: 'build', title: 'Demo build', model: 'fable', status: 'running', estimate: { minutes: 110, costUsd: 20 }, steps: [{ text: 'Contract', state: 'done', fm: 's1' }, { text: 'Apply engine', state: 'running', fm: 's2' }, { text: 'Console page', state: 'queued', fm: 's3' }, { text: 'Grid hooks', state: 'queued', fm: 's4' }] },
  feature: { id: 'x.demo', title: 'Demo build', status: 'planned', effort: 'M', acceptance: [{ text: 'Contract', done: true, fm: 's1' }, { text: 'Apply engine', done: false, fm: 's2' }, { text: 'Console page', done: false, fm: 's3' }, { text: 'Grid hooks', done: false, fm: 's4' }] },
});

function build() {
  const { state, logs } = replay();
  const matrix = fm.findMatrix(state, REF, PROFILE);
  const before = targets();
  const first = ap.applyAll(matrix, before, T(9));
  const second = ap.applyAll(matrix, first.targets, T(10));
  return {
    $axf: 'feature-matrix@1', generatedBy: 'framework/spec/check-feature-matrix.mjs --write', scenario,
    expected: { state, logs, totals: fm.totals(matrix), grid: fm.grid(state), validate: fm.validate(state) },
    apply: { before, after: first.targets, report: first.report, secondPass: second.report },
  };
}

if (WRITE) { writeFileSync(FIXTURE, `${JSON.stringify(build(), null, 1)}\n`); console.log(`wrote ${FIXTURE}`); process.exit(0); }

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const got = build();

// ---- contract
t('replay matches the fixture dataset', () => assert.deepEqual(got.expected.state, fixture.expected.state));
t('logs match', () => assert.deepEqual(got.expected.logs, fixture.expected.logs));
t('totals match', () => assert.deepEqual(got.expected.totals, fixture.expected.totals));
t('grid matches, newest first', () => { assert.deepEqual(got.expected.grid, fixture.expected.grid); assert.equal(got.expected.grid[0].id, 'main-framework:pending:other'); });
t('dataset validates', () => assert.deepEqual(fm.validate(got.expected.state), []));
const m = fm.findMatrix(got.expected.state, REF, PROFILE);
t('matrix id = profile:kind:id', () => assert.equal(m.id, 'refactor:orchestrator:demo-build'));
t('reseed adds nothing and changes nothing', () => { assert.equal(m.items[0].name, 'Contract'); assert.deepEqual(got.expected.logs[1], []); });
t('nothing is ever deleted: 5 items, skip is a state', () => { assert.equal(m.items.length, 5); assert.equal(m.items.find((i) => i.id === 's3').state, 'skip'); assert.equal(m.items.find((i) => i.id === 'dark-mode-shots').state, 'keep'); });
t('re-adding a skipped item brings it back to keep', () => assert.equal(m.items.find((i) => i.id === 's4').state, 'keep'));
t('versions: 7 content changes, applied at 5, dirty since', () => { assert.equal(m.version, 7); assert.equal(m.appliedVersion, 5); assert.equal(fm.isDirty(m), true); assert.equal(m.appliedAt, T(5)); });
t('totals: kept 4 = 90 min, skipped 30 min, Fable 55 / Opus 35', () => { const x = fm.totals(m); assert.equal(x.kept, 4); assert.equal(x.keptMinutes, 90); assert.equal(x.skippedMinutes, 30); assert.equal(x.byModel.Fable.keptMinutes, 55); assert.equal(x.byModel.Opus.keptMinutes, 35); assert.equal(x.groups.length, 3); });
t('history kept on the matrix and the item', () => { assert.ok(m.history.length >= 7); assert.deepEqual(m.items.find((i) => i.id === 's4').history.map((h) => h.action), ['added', 'state', 'state']); });
t('remove is refused', () => { assert.throws(() => fm.apply(got.expected.state, { action: 'remove-item', matrix: m.id, item: 's1' }), /never deleted/); assert.throws(() => fm.apply(got.expected.state, { action: 'remove', matrix: m.id }), /never deleted/); });
t('add refuses a duplicate, seed merges', () => assert.throws(() => fm.apply(got.expected.state, { action: 'add', ref: REF, profile: PROFILE }), /already exists/));
t('applied cannot run ahead of version', () => assert.throws(() => fm.apply(got.expected.state, { action: 'applied', matrix: m.id, version: 99 }), /not one this matrix has/));
t('unknown state / model normalise safely', () => { const r = fm.apply(fm.emptyState(T(0)), { action: 'seed', ref: REF, profile: 'x', items: [{ name: 'a', model: 'sonnet', state: 'maybe', minutes: '12' }] }, T(0)); const it = r.state.matrices[0].items[0]; assert.equal(it.model, 'Opus'); assert.equal(it.state, 'keep'); assert.equal(it.minutes, 12); });
t('validate catches bad data', () => { const bad = { $axf: 'feature-matrix@1', matrices: [{ id: 'wrong', ref: { kind: 'orchestrator', id: 'a' }, profile: 'p', version: 1, appliedVersion: 2, items: [{ name: '', state: 'maybe' }] }] }; assert.ok(fm.validate(bad).length >= 4); });
t('seed helpers read skip + fm tags', () => { const items = fm.itemsFromSubPrompts([{ text: 'one', estimate: '10 min', fm: 'one-x', skip: true }], 'Fable', T(0)); assert.equal(items[0].id, 'one-x'); assert.equal(items[0].state, 'skip'); assert.equal(items[0].minutes, 10); const st = fm.itemsFromSteps([{ id: 's9', text: 'x', model: 'Fable', estimate: '2 h', skip: true }], T(0)); assert.equal(st[0].minutes, 120); assert.equal(st[0].state, 'skip'); });

// ---- apply engine
t('apply targets match the fixture', () => assert.deepEqual(got.apply.after, fixture.apply.after));
t('report matches the fixture', () => assert.deepEqual(got.apply.report, fixture.apply.report));
t('second pass changes nothing (idempotent)', () => { assert.deepEqual(got.apply.secondPass.changes, []); assert.deepEqual(got.apply.secondPass, fixture.apply.secondPass); });
const a = got.apply.after;
t('orchestrator: skipped step kept with skip flag, new kept item became a step, estimate/model follow the matrix', () => {
  assert.equal(a.build.steps.length, 5); assert.equal(a.build.steps.find((s) => s.id === 's4').skip, false); assert.equal(a.build.steps.find((s) => s.id === 's3').skip, true); assert.equal(a.build.steps.find((s) => s.id === 'fm-dark-mode-shots').skip, false);
  assert.equal(a.build.steps.find((s) => s.id === 's2').estimate, '25 min'); assert.equal(a.build.steps.find((s) => s.id === 's1').done, true);
  assert.equal(oc.progress(a.build).minutesLeft, 60); assert.equal(oc.progress(a.build).skipped, 1); // s2 25 + s4 20 + dark 15; s3 skipped
});
t('pending: skip flags + fm tags on sub prompts, item estimate = kept minutes', () => { assert.equal(a.pending.subPrompts.length, 5); assert.equal(a.pending.subPrompts[2].skip, true); assert.equal(a.pending.subPrompts[4].fm, 'dark-mode-shots'); assert.equal(a.pending.subPrompts[4].skip, undefined); assert.equal(a.pending.estimate, '1.5 h'); assert.equal(pc.entryMinutes(a.pending), 90); assert.equal(a.pending.subPrompts[0].done, true); });
t('build queue: small steps follow, record estimate = kept minutes', () => { assert.equal(a.queue.steps.length, 5); assert.equal(a.queue.steps[1].estimate, '25 min'); assert.equal(a.queue.steps[2].skip, true); assert.equal(a.queue.estimate, '1.5 h'); assert.deepEqual(qc.recordSteps(a.queue)[4], { text: 'Dark mode shots', estimate: '15 min', fm: 'dark-mode-shots' }); });
t('build manager entry: skipped steps, kept estimate, finished steps untouched', () => { assert.equal(a.change.steps[2].state, 'skipped'); assert.equal(a.change.steps[4].state, 'queued'); assert.equal(a.change.steps[0].state, 'done'); assert.equal(a.change.steps[1].state, 'running'); assert.equal(a.change.estimate.minutes, 90); assert.equal(a.change.estimate.costUsd, undefined); assert.equal(a.change.estimate.costEstimated, undefined); });
t('plan feature: acceptance lines carry skip + fm, matrix summary on the feature', () => { assert.equal(a.feature.acceptance.length, 5); assert.equal(a.feature.acceptance[2].skip, true); assert.equal(a.feature.acceptance[4].fm, 'dark-mode-shots'); assert.deepEqual(a.feature.matrix, { id: m.id, version: m.version, keptMinutes: 90, kept: 4, skipped: 1 }); });
t('report says what changed, per target', () => { const r = got.apply.report; assert.equal(r.matrix, m.id); assert.equal(r.keptMinutes, 90); assert.ok(r.changes.length >= 8); assert.deepEqual([...new Set(r.changes.map((c) => c.target))].sort(), ['build', 'change', 'feature', 'pending', 'queue']); assert.match(r.summary, /5 targets/); });
t('a skipped item never deletes anything already done', () => { const sk = fm.apply(got.expected.state, { action: 'skip', matrix: m.id, item: 's1' }, T(11)).state; const r = ap.applyAll(fm.findMatrix(sk, REF, PROFILE), targets(), T(12)); assert.equal(r.targets.build.steps[0].skip, true); assert.equal(r.targets.build.steps[0].done, true); assert.equal(r.targets.change.steps[0].state, 'done'); assert.equal(r.targets.pending.subPrompts[0].done, true); });
t('skipped steps leave the sums and the brief', () => { assert.equal(pc.stepsProgress(a.pending).minutesLeft, 60); const ph = oc.phases(a.build); assert.equal(ph[1].minutesLeft, 35); assert.equal(ph[1].groups[0].skipped, 1); const one = { ...a.build, steps: a.build.steps.map((st) => ({ ...st, model: 'Fable' })) }; assert.match(oc.brief(one), /\[skip\] s3/); assert.match(oc.brief(one), /\[ \] fm-dark-mode-shots/); assert.match(oc.brief(one), /3 left, ~1 h/); });

t('a skipped item that never had a row is added nowhere', () => { const st = fm.apply(got.expected.state, { action: 'add-item', matrix: m.id, item: { name: 'Never built', minutes: 5 } }, T(11)).state; const sk = fm.apply(st, { action: 'skip', matrix: m.id, item: 'never-built' }, T(12)).state; const r = ap.applyAll(fm.findMatrix(sk, REF, PROFILE), targets(), T(13)); assert.equal(r.targets.build.steps.length, 5); assert.equal(r.targets.pending.subPrompts.length, 5); assert.equal(r.targets.change.steps.length, 5); });
console.log(`feature-matrix@1: ${n} checks passed`);

#!/usr/bin/env node
/**
 * land-run@1 conformance: one serial landing attempt → its record, outcome, validation and the build's attempt entry.
 *   node framework/spec/check-land-run.mjs           check
 *   node framework/spec/check-land-run.mjs --write   regenerate fixtures/land-run.json's expected outputs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../core/land-run.mjs';
import { normLandAttempt, addLandAttempt, LAND_STATE_AFTER } from '../core/build-pipeline.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/land-run.json');
const WRITE = process.argv.includes('--write');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const T0 = '2026-11-14T22:30:00Z'; const T1 = '2026-11-14T22:41:12Z';
const BASE = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'; const HEAD = '0f1e2d3c4b5a69788796a5b4c3d2e1f0fedcba98'; const MERGED = '9999aaaabbbbccccddddeeeeffff000011112222';
const REGEN = ['apps/console-web/axf.lock.json', 'apps/console-web/src/control/inventory.json', 'apps/console-web/src/assets/help/framework.json'];
const base = { id: 'lr-shipped-20261114T223000', build: 'shipped', branch: 'claude/shipped-features-r2', pr: 350, startedAt: T0, base: BASE, head: HEAD };
const IN = {
  running: { ...base, regenerated: REGEN, merged: MERGED, ci: { run: '123456', status: 'in_progress', conclusion: '' } },
  queued: { ...base, merged: MERGED, ci: { run: '123456', status: 'queued' } },
  landed: { ...base, endedAt: T1, merged: MERGED, regenerated: REGEN, check: { ok: true }, ci: { run: '123456', status: 'completed', conclusion: 'success' }, outcome: 'landed' },
  landedUnsettled: { ...base, endedAt: T1, merged: MERGED, check: { ok: true }, ci: { run: '123456', status: 'completed', conclusion: 'success' } },
  ciRed: { ...base, endedAt: T1, merged: MERGED, regenerated: REGEN, check: { ok: true }, ci: { run: '123457', status: 'completed', conclusion: 'failure' }, fixBuild: 'fix-shipped-ci-red' },
  checkRed: { ...base, endedAt: T1, merged: MERGED, regenerated: REGEN, check: { ok: false, failed: ['control-inventory', 'check-project-fixtures'], note: 'inventory drifted' }, fixBuild: 'fix-shipped-inventory' },
  cancelled: { ...base, endedAt: T1, merged: MERGED, ci: { run: '123458', status: 'completed', conclusion: 'cancelled' } },
  skipped: { ...base, endedAt: T1, merged: MERGED, ci: { run: '123459', status: 'completed', conclusion: 'skipped' } },
  clash: { ...base, endedAt: T1, regenerated: ['apps/console-web/axf.lock.json'], unresolved: ['src/app.mjs', 'framework/core/card.mjs'] },
  error: { ...base, endedAt: T1, error: 'fatal: unable to access origin: Could not resolve host\n(second line)' },
  // junk and edge cases
  junk: { id: 'lr-x', build: 'x', startedAt: 'yesterday', endedAt: 42, base: 'ZZZ', head: 'A1B2C3D', pr: 'PR #77', regenerated: ['', 'a.json', 'a.json'], unresolved: 'nope', check: { ok: 'yes', failed: 'x' }, ci: { status: 'COMPLETED', conclusion: 'Success', state: 'failure' }, outcome: 'nope', fixBuild: 'fix-x', note: 7 },
  noIdDerived: { build: 'shipped', startedAt: T0 },
  notRedKeepsNoFix: { ...base, endedAt: T1, merged: MERGED, ci: { status: 'completed', conclusion: 'success' }, outcome: 'landed', fixBuild: 'stray' },
  nothing: {},
  list: [],
};
const BAD = {
  noBuild: { id: 'lr-1', startedAt: T0 },
  landedNoSha: { ...base, endedAt: T1, outcome: 'landed', ci: { status: 'completed', conclusion: 'success' } },
  landedBadCi: { ...base, endedAt: T1, merged: MERGED, outcome: 'landed', ci: { status: 'completed', conclusion: 'failure', state: 'failure' } },
  redNoFix: { ...base, endedAt: T1, merged: MERGED, outcome: 'red', ci: { status: 'completed', conclusion: 'failure', state: 'failure' } },
  redNothingFailed: { ...base, endedAt: T1, merged: MERGED, outcome: 'red', fixBuild: 'fix-1', ci: { status: 'completed', conclusion: 'success', state: 'success' } },
  cancelledIsNotFailure: { ...base, endedAt: T1, merged: MERGED, outcome: 'cancelled', ci: { status: 'completed', conclusion: 'failure', state: 'failure' } },
  failureIsNotCancelled: { ...base, endedAt: T1, merged: MERGED, outcome: 'red', fixBuild: 'fix-2', ci: { status: 'completed', conclusion: 'cancelled', state: 'cancelled' } },
  clashNoFiles: { ...base, endedAt: T1, outcome: 'clash' },
  errorNoText: { ...base, endedAt: T1, outcome: 'error' },
  fixOnLanded: { ...base, endedAt: T1, merged: MERGED, outcome: 'landed', fixBuild: 'fix-3', ci: { status: 'completed', conclusion: 'success', state: 'success' } },
  finishedNoEnd: { ...base, merged: MERGED, outcome: 'landed', ci: { status: 'completed', conclusion: 'success', state: 'success' } },
  endBeforeStart: { ...base, endedAt: '2026-11-14T22:00:00Z', merged: MERGED, outcome: 'landed' },
  stateDrift: { ...base, ci: { status: 'completed', conclusion: 'cancelled', state: 'failure' } },
  badSha: { ...base, merged: 'not-a-sha' },
};
const CI = [['queued', ''], ['requested', null], ['waiting', ''], ['pending', ''], ['in_progress', ''], ['completed', 'success'], ['completed', 'failure'], ['completed', 'timed_out'], ['completed', 'action_required'], ['completed', 'startup_failure'], ['completed', 'cancelled'], ['completed', 'canceled'], ['completed', 'skipped'], ['completed', 'neutral'], ['completed', 'stale'], ['completed', ''], ['', ''], ['', 'success'], ['COMPLETED', 'Cancelled']];

const run = () => ({
  norm: Object.fromEntries(Object.entries(IN).map(([k, v]) => [k, L.normLandRun(v)])),
  settled: Object.fromEntries(Object.entries(IN).map(([k, v]) => [k, L.settleLandRun(v, T1)])),
  outcome: Object.fromEntries(Object.entries(IN).map(([k, v]) => [k, L.outcomeOf(v)])),
  validate: {
    ...Object.fromEntries(Object.entries(IN).map(([k, v]) => [k, L.validateLandRun(L.settleLandRun(v, T1)).errors.map((e) => e.path)])),
    ...Object.fromEntries(Object.entries(BAD).map(([k, v]) => [`bad:${k}`, L.validateLandRun(v).errors.map((e) => e.path)])),
  },
  attempt: Object.fromEntries(Object.entries(IN).map(([k, v]) => [k, L.attemptOf(v)])),
  line: Object.fromEntries(Object.entries(IN).map(([k, v]) => [k, L.landRunLine(v)])),
  ciState: CI.map(([s, c]) => [s, c, L.ciState(s, c)]),
  ids: [L.newLandRunId('shipped', T0), L.newLandRunId('Bad Id!', T0), L.newLandRunId('x', 'nope').slice(0, 5)],
});
const actual = run();
if (WRITE) { writeFileSync(FIX, `${JSON.stringify({ $axf: 'land-run@1', note: 'Generated by framework/spec/check-land-run.mjs --write; every port replays `in` / `bad` / `ci` and must answer `out`.', in: IN, bad: BAD, ci: CI, out: actual }, null, 1)}\n`); console.log(`wrote ${FIX}`); }
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
t('fixture inputs are the ones in this file', () => assert.ok(same(fx.in, IN) && same(fx.bad, BAD) && same(fx.ci, CI), 'inputs drifted: run with --write'));
for (const k of Object.keys(fx.out)) t(`fixture replay: ${k}`, () => assert.deepEqual(actual[k], fx.out[k]));

// ------------------------------------------------------------------ the rules, spelled out
t('cancelled is not a failure: outcome cancelled, no fix build, the build goes back to waiting', () => {
  for (const k of ['cancelled', 'skipped']) {
    assert.equal(actual.outcome[k], 'cancelled'); assert.equal(actual.settled[k].fixBuild, ''); assert.equal(actual.attempt[k].ci, 'cancelled');
    assert.equal(LAND_STATE_AFTER[actual.outcome[k]], 'waiting'); assert.deepEqual(actual.validate[k], []);
  }
  assert.equal(L.ciState('completed', 'cancelled'), 'cancelled'); assert.equal(L.ciState('completed', 'failure'), 'failure'); assert.equal(L.ciState('completed', 'timed_out'), 'failure');
  assert.deepEqual(actual.validate['bad:cancelledIsNotFailure'], ['outcome', 'outcome']); assert.deepEqual(actual.validate['bad:failureIsNotCancelled'], ['outcome']);
});
t('a CI failure or a red check is red and names its fix build', () => {
  assert.equal(actual.outcome.ciRed, 'red'); assert.equal(actual.outcome.checkRed, 'red');
  assert.equal(actual.settled.ciRed.fixBuild, 'fix-shipped-ci-red'); assert.equal(actual.settled.checkRed.fixBuild, 'fix-shipped-inventory');
  assert.equal(LAND_STATE_AFTER.red, 'red'); assert.deepEqual(actual.validate.ciRed, []); assert.deepEqual(actual.validate.checkRed, []);
  assert.deepEqual(actual.validate['bad:redNoFix'], ['fixBuild']); assert.deepEqual(actual.validate['bad:redNothingFailed'], ['outcome']);
  assert.match(actual.line.checkRed, /control-inventory, check-project-fixtures/); assert.match(actual.line.ciRed, /fix build fix-shipped-ci-red/);
});
t('landed needs the merged sha and CI success; a clash lists its files and flags the build', () => {
  assert.equal(actual.outcome.landed, 'landed'); assert.equal(actual.outcome.landedUnsettled, 'landed'); assert.equal(actual.settled.landedUnsettled.outcome, 'landed');
  assert.deepEqual(actual.validate['bad:landedNoSha'], ['merged']); assert.deepEqual(actual.validate['bad:landedBadCi'], ['ci.state']); assert.deepEqual(actual.validate['bad:fixOnLanded'], ['fixBuild']);
  assert.equal(actual.outcome.clash, 'clash'); assert.equal(LAND_STATE_AFTER.clash, 'flagged'); assert.deepEqual(actual.validate['bad:clashNoFiles'], ['unresolved']);
  assert.equal(actual.outcome.error, 'error'); assert.equal(actual.line.error, 'Landing broke: fatal: unable to access origin: Could not resolve host'); assert.deepEqual(actual.validate['bad:errorNoText'], ['error']);
});
t('a running attempt has no outcome yet; settling fills endedAt only once it has one', () => {
  assert.equal(actual.outcome.running, ''); assert.equal(actual.outcome.queued, ''); assert.equal(actual.settled.running.endedAt, ''); assert.equal(actual.settled.landedUnsettled.endedAt, T1);
  assert.deepEqual(actual.validate.running, []); assert.deepEqual(actual.validate['bad:finishedNoEnd'], ['endedAt']); assert.deepEqual(actual.validate['bad:endBeforeStart'], ['endedAt']);
  assert.match(actual.line.running, /CI running/);
});
t('normalisation: junk comes out in shape, ids are derived, stray fix builds dropped, nothing is null for nothing', () => {
  const j = actual.norm.junk;
  assert.equal(j.startedAt, ''); assert.equal(j.endedAt, ''); assert.equal(j.base, ''); assert.equal(j.head, 'a1b2c3d'); assert.equal(j.pr, 77);
  assert.deepEqual(j.regenerated, ['a.json']); assert.deepEqual(j.unresolved, []); assert.deepEqual(j.check, { ok: null, failed: [], note: '' });
  assert.deepEqual(j.ci, { run: '', status: 'completed', conclusion: 'success', state: 'success' }, 'the state follows status + conclusion, never a stale field');
  assert.equal(j.outcome, ''); assert.equal(j.fixBuild, 'fix-x', 'kept while the outcome is open'); assert.equal(j.note, '7');
  assert.equal(actual.norm.noIdDerived.id, 'lr-shipped-20261114T223000'); assert.equal(actual.norm.notRedKeepsNoFix.fixBuild, '');
  assert.equal(actual.norm.nothing, null); assert.equal(actual.norm.list, null); assert.equal(L.normLandRun('x'), null);
  assert.deepEqual(actual.validate['bad:stateDrift'], ['ci.state']); assert.deepEqual(actual.validate['bad:badSha'], ['merged']); assert.deepEqual(actual.validate['bad:noBuild'], ['build']);
  assert.ok(!L.validateLandRun(null).ok); assert.ok(!L.validateLandRun([]).ok);
});
t('attemptOf fits a build\'s land.landAttempts (build-pipeline@1) and drives its landState', () => {
  for (const k of Object.keys(IN)) if (actual.norm[k]) assert.deepEqual(normLandAttempt(actual.attempt[k]), actual.attempt[k], k);
  const a = actual.attempt.landed; assert.deepEqual([a.at, a.run, a.base, a.merged, a.outcome, a.ci], [T0, base.id, BASE, MERGED, 'landed', 'success']);
  assert.equal(addLandAttempt(null, actual.attempt.running, T0).landState, 'landing');
  assert.equal(addLandAttempt(null, actual.attempt.landed, T1).landState, 'landed');
  assert.equal(addLandAttempt(null, actual.attempt.cancelled, T1).landState, 'waiting');
  assert.equal(addLandAttempt(null, actual.attempt.clash, T1).landState, 'flagged');
  assert.equal(addLandAttempt(null, actual.attempt.ciRed, T1).landState, 'red');
});
t('ids: lr-<build>-<utc stamp>; a bad build name falls back', () => { assert.equal(actual.ids[0], 'lr-shipped-20261114T223000'); assert.equal(actual.ids[1], 'lr-build-20261114T223000'); assert.equal(actual.ids[2], 'lr-x-'); });

console.log(`check-land-run: ${n} checks passed`);

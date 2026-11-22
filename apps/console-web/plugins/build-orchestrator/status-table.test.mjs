#!/usr/bin/env node
/**
 * status-table@1 (Pipeline 2.0): the one status-driven builds table's rules (web/status-table-core.mjs).
 *   node apps/console-web/plugins/build-orchestrator/status-table.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as T from './web/status-table-core.mjs';
import * as P2 from '../../../../framework/core/pipeline-status.mjs';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const at = (min) => new Date(NOW - min * 60_000).toISOString();

test('the contract: 15 build statuses, 8 step statuses, merge queue merging-pr through merging-main', () => {
  assert.deepEqual(T.BUILD_STATUSES, ['pending', 'splitting', 'split', 'pulling-main', 'assigning-models', 'ready', 'sending', 'building', 'build-complete', 'merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main', 'landed', 'failed']);
  assert.deepEqual(T.STEP_STATUSES, ['pending', 'pulling-main', 'ready', 'sending', 'building', 'completed', 'in-pr', 'failed']);
  assert.deepEqual(T.MERGE_QUEUE, ['merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main']);
});

test('the UI copy of the contract equals the reference engine (framework/core/pipeline-status.mjs)', () => {
  assert.deepEqual(T.BUILD_STATUSES, [...P2.BUILD_STATUSES]);
  assert.deepEqual(T.STEP_STATUSES, [...P2.STEP_STATUSES]);
  assert.deepEqual(T.MERGE_QUEUE, [...P2.LANDING_GROUP]);
});

test('labels: split shows Pending, failed shows its attempt', () => {
  assert.equal(T.statusLabel('split'), 'Pending');
  assert.equal(T.statusLabel('failed', 3), 'failed, attempt 3');
  assert.equal(T.statusLabel('failed'), 'failed');
  assert.equal(T.buildRow({ id: 'x', status: 'failed', attempt: 2 }).attempt, 2);
  assert.equal(T.buildRow({ id: 'x', status: 'failed', attempts: [{}, {}, {}] }).attempt, 3);
  assert.equal(T.buildRow({ id: 'x', status: 'failed' }).attempt, 1);
});

test('older records read as the contract status they stand for; archived and deleted are off the table', () => {
  assert.equal(T.buildStatus({ status: 'running' }), 'building');
  assert.equal(T.buildStatus({ status: 'built' }), 'build-complete');
  assert.equal(T.buildStatus({ status: 'landing' }), 'merging-pr');
  assert.equal(T.buildStatus({ status: 'fixing' }), 'failed');
  assert.equal(T.buildStatus({ status: 'complete' }), 'landed');
  assert.equal(T.buildStatus({ status: 'archived' }), null);
  assert.equal(T.buildStatus({ status: 'building', deleted: true }), null);
  assert.equal(T.buildStatus({ status: 'running-ci' }), 'running-ci');
});

test('a row: steps done/total, one model/account/slot or mixed, PR number', () => {
  const r = T.buildRow({ id: 'b', title: 'B', status: 'building', pr: 'https://github.com/o/r/pull/412', createdAt: at(90), statusAt: at(5), statusBy: 'pipeline',
    steps: [
      { id: 's1', status: 'completed', model: 'Opus', account: 'a1', slot: '1', at: at(10), by: 'session' },
      { id: 's2', status: 'building', model: 'Fable', account: 'a1', slot: '2' },
      { id: 's3', status: 'ready', model: 'Opus', account: 'a1', slot: '3', skip: false },
      { id: 's4', skip: true },
    ] });
  assert.equal(r.total, 3); assert.equal(r.done, 1);
  assert.equal(r.model, 'mixed'); assert.equal(r.account, 'a1'); assert.equal(r.slot, 'mixed');
  assert.equal(r.prNumber, 412); assert.equal(r.at, at(5)); assert.equal(r.by, 'pipeline');
  assert.equal(r.steps[0].at, at(10)); assert.equal(r.steps[0].by, 'session');
});

test('older steps: done → completed (in-pr once merging), the first open step of a building build is building', () => {
  const r = T.buildRow({ id: 'b', status: 'running', steps: [{ id: 's1', done: true }, { id: 's2' }, { id: 's3' }] });
  assert.deepEqual(r.steps.map((s) => s.status), ['completed', 'building', 'pending']);
  const q = T.buildRow({ id: 'b', status: 'landing', pr: '#9', steps: [{ id: 's1', done: true }] });
  assert.equal(q.steps[0].status, 'in-pr'); assert.equal(q.steps[0].prNumber, 9);
});

test('statusSince: statusAt, else the history entry for the current status, else updatedAt', () => {
  assert.equal(T.statusSince({ status: 'ready', statusAt: at(3) }), at(3));
  assert.equal(T.statusSince({ status: 'ready', statusLog: [{ status: 'pending', at: at(9) }, { status: 'ready', at: at(4), by: 'tick' }], updatedAt: at(1) }), at(4));
  assert.equal(T.statusBy({ status: 'ready', statusLog: [{ status: 'ready', at: at(4), by: 'tick' }] }), 'tick');
  assert.equal(T.statusSince({ status: 'ready', updatedAt: at(1) }), at(1));
});

test('filters: status, merge queue, landed hidden by default, account and model on any step, date, text', () => {
  const rows = T.tableRows({ builds: [
    { id: 'a', status: 'building', updatedAt: at(1), steps: [{ id: 's1', account: 'acc1', model: 'Fable' }] },
    { id: 'b', status: 'running-ci', updatedAt: at(60 * 30), pipeline: { account: 'acc2', model: 'Opus' } },
    { id: 'c', status: 'landed', updatedAt: at(2) },
    { id: 'd', status: 'merging-pr', updatedAt: at(3), title: 'Payments' },
    { id: 'e', status: 'archived', updatedAt: at(1) },
  ] });
  assert.deepEqual(rows.map((r) => r.id), ['a', 'c', 'd', 'b']);
  assert.deepEqual(T.filterRows(rows, {}, NOW).map((r) => r.id), ['a', 'd', 'b']);
  assert.deepEqual(T.filterRows(rows, { landed: true }, NOW).map((r) => r.id), ['a', 'c', 'd', 'b']);
  assert.deepEqual(T.filterRows(rows, { status: 'landed' }, NOW).map((r) => r.id), ['c']);
  assert.deepEqual(T.filterRows(rows, { queue: true }, NOW).map((r) => r.id), ['d', 'b']);
  assert.deepEqual(T.filterRows(rows, { account: 'acc1' }, NOW).map((r) => r.id), ['a']);
  assert.deepEqual(T.filterRows(rows, { model: 'Opus' }, NOW).map((r) => r.id), ['b']);
  assert.deepEqual(T.filterRows(rows, { date: '24h' }, NOW).map((r) => r.id), ['a', 'd']);
  assert.deepEqual(T.filterRows(rows, { text: 'pay' }, NOW).map((r) => r.id), ['d']);
  const o = T.filterOptions(rows);
  assert.deepEqual(o.accounts, ['acc1', 'acc2']); assert.deepEqual(o.models, ['Fable', 'Opus']); assert.equal(o.counts.landed, 1);
});

test('timers: time in status and total, frozen once landed', () => {
  assert.deepEqual(T.timers({ status: 'building', at: at(5), createdAt: at(65) }, NOW), { inStatus: 5 * 60_000, total: 65 * 60_000 });
  assert.deepEqual(T.timers({ status: 'landed', at: at(5), createdAt: at(65) }, NOW), { inStatus: null, total: 60 * 60_000 });
  assert.equal(T.formatElapsed(45_000), '45s');
  assert.equal(T.formatElapsed(12 * 60_000 + 5_000), '12m 05s');
  assert.equal(T.formatElapsed(3 * 3_600_000 + 7 * 60_000), '3h 07m');
  assert.equal(T.formatElapsed(2 * 86_400_000 + 4 * 3_600_000), '2d 4h');
  assert.equal(T.formatElapsed(null), '—');
});

test('parallel split: sub-builds grouped under their parent, combined progress over the whole family (landed parts too)', () => {
  const st = (id, status) => ({ id, status });
  const store = { builds: [
    { id: 'app', title: 'Console app', status: 'building', statusAt: at(5), updatedAt: at(5), steps: [st('s1', 'completed'), st('s2', 'pending')], pipeline: { parallel: { role: 'lead', parts: ['app-p1', 'app-p2'], contractStep: 's1', integrationStep: 's2', landing: 'together' } } },
    { id: 'app-p1', title: 'Console app · part 1', status: 'landed', statusAt: at(3), updatedAt: at(3), steps: [st('s1', 'in-pr'), st('s2', 'in-pr')], pipeline: { parallel: { role: 'part', lead: 'app', part: 1, of: 2 } } },
    { id: 'app-p2', title: 'Console app · part 2', status: 'building', statusAt: at(1), updatedAt: at(1), steps: [st('s1', 'completed'), st('s2', 'building'), st('s3', 'pending')], pipeline: { parallel: { role: 'part', lead: 'app', part: 2, of: 2 } } },
    { id: 'solo', title: 'Solo', status: 'ready', statusAt: at(2), updatedAt: at(2), steps: [st('s1', 'pending')] },
  ] };
  const rows = T.tableRows(store);
  const lead = rows.find((r) => r.id === 'app');
  assert.deepEqual(lead.parallel, { role: 'lead', lead: 'app', part: 0, of: 2, parts: ['app-p1', 'app-p2'], landing: 'together' });
  assert.equal(rows.find((r) => r.id === 'app-p2').parallel.part, 2);
  assert.equal(rows.find((r) => r.id === 'solo').parallel, null);
  assert.equal(rows.find((r) => r.id === 'solo').family, undefined);
  // 1/2 + 2/2 + 1/3 = 4/7, counted before the landed part is filtered out
  assert.equal(lead.family.done, 4); assert.equal(lead.family.total, 7); assert.equal(lead.family.percent, 57); assert.equal(lead.family.partsFinished, 1);
  assert.match(lead.family.line, /2 parts · 1\/2 built · 4\/7 steps \(57%\) · lands together/);
  const shown = T.filterRows(rows, {});
  assert.ok(!shown.some((r) => r.id === 'app-p1'), 'the landed part is filtered out by default');
  const g = T.familyGroups(shown, shown);
  assert.deepEqual(g.loose.map((r) => r.id), ['solo']);
  assert.equal(g.families.length, 1);
  const f = g.families[0];
  assert.equal(f.id, 'app'); assert.equal(f.title, 'Console app');
  assert.deepEqual(f.rows.map((r) => r.id), ['app', 'app-p2'], 'the parent first, then its parts in order');
  assert.equal(f.done, 4, 'the server numbers win over what the filter left');
  // a part whose parent is filtered out still groups under the parent's id
  const only = T.familyGroups(shown.filter((r) => r.id === 'app-p2'));
  assert.equal(only.families[0].id, 'app'); assert.equal(only.families[0].lead, null);
  // rows from an older server (no family numbers): counted from the rows given
  const bare = rows.map(({ family, ...r }) => r);
  const own = T.familyGroups(bare, bare).families[0];
  assert.equal(own.total, 7); assert.equal(own.landing, 'together');
  const inOrder = T.familyStats('app', bare.map((r) => (r.id === 'app' ? { ...r, parallel: { ...r.parallel, landing: 'own' } } : r)));
  assert.match(inOrder.line, /lands in order/);
});

test('parallel split on Pipeline 2.0 statuses: build-complete and later count as built for the family and the barrier', async () => {
  const P = await import('./pipeline-core.mjs');
  const OC = await import('./web/orchestrator-core.mjs');
  const lead = { id: 'app', status: 'building', steps: [{ id: 's1', status: 'completed', done: true }, { id: 's2', status: 'pending' }], pipeline: { parallel: { role: 'lead', parts: ['app-p1', 'app-p2'], contractStep: 's1', integrationStep: 's2', landing: 'together' } } };
  const part = (n, status) => ({ id: `app-p${n}`, status, steps: [{ id: 's1', status: 'completed', done: true }], pipeline: { parallel: { role: 'part', lead: 'app', part: n, of: 2 } } });
  assert.equal(P.parallelWait(part(1, 'ready'), [lead, part(1, 'ready')]), '', 'the contract step is completed: the parts start');
  assert.match(P.parallelWait(lead, [lead, part(1, 'build-complete'), part(2, 'building')]), /integration waits for part app-p2/);
  assert.equal(P.parallelWait(lead, [lead, part(1, 'build-complete'), part(2, 'running-ci')]), '', 'every part at build-complete or later: the integration step may run');
  const f = OC.parallelFamily(lead, [lead, part(1, 'landed'), part(2, 'build-complete')]);
  assert.equal(f.partsFinished, 2);
});

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

test('views: the orchestrator lists sent builds (queued, building, built) plus landed when asked; Pending is its own view', () => {
  const rows = T.tableRows({ builds: [
    { id: 'p1', status: 'pending', updatedAt: at(1) }, { id: 'p2', status: 'splitting', updatedAt: at(2) }, { id: 'p3', status: 'split', updatedAt: at(3) },
    { id: 'q1', status: 'ready', updatedAt: at(4) }, { id: 'q2', status: 'queued', updatedAt: at(5) }, { id: 'b1', status: 'building', updatedAt: at(6) }, { id: 'b2', status: 'running', updatedAt: at(7) },
    { id: 'd1', status: 'build-complete', updatedAt: at(8) }, { id: 'd2', status: 'running-ci', updatedAt: at(9) }, { id: 'd3', status: 'built', updatedAt: at(10) },
    { id: 'f1', status: 'failed', updatedAt: at(11) }, { id: 'l1', status: 'landed', updatedAt: at(12) }, { id: 'l2', status: 'complete', updatedAt: at(13) },
  ] });
  const ids = (f) => T.filterRows(rows, f, NOW).map((r) => r.id).sort();
  assert.deepEqual(ids({ view: 'sent' }), ['b1', 'b2', 'd1', 'd2', 'd3', 'f1', 'q1', 'q2'], 'sent: queued, building, built (and failed on the way); no Pending build, no landed one');
  assert.deepEqual(ids({ view: 'sent', landed: true }), ['b1', 'b2', 'd1', 'd2', 'd3', 'f1', 'l1', 'l2', 'q1', 'q2'], 'plus landed when asked');
  assert.deepEqual(ids({ view: 'pending' }), ['p1', 'p2', 'p3'], 'Pending stays in its own view');
  assert.deepEqual(ids({ view: 'pending', landed: true }), ['p1', 'p2', 'p3']);
  assert.deepEqual(ids({ view: 'landed' }), ['l1', 'l2'], 'the landed view needs no switch');
  assert.deepEqual(ids({ view: 'sent', status: 'building' }), ['b1', 'b2']);
  assert.deepEqual(ids({ view: 'sent', status: 'pending' }), [], 'a Pending status never shows in the sent view');
  assert.deepEqual(ids({ view: 'sent', status: 'landed' }), ['l1', 'l2']);
  assert.deepEqual(ids({}), ['b1', 'b2', 'd1', 'd2', 'd3', 'f1', 'p1', 'p2', 'p3', 'q1', 'q2'], 'no view (the CLI, an older caller): every row but landed, as before');
  assert.deepEqual(ids({ queue: true, view: 'pending' }), ['d2'], 'the merge queue is not a view: it ignores one');
  assert.deepEqual(T.viewCounts(rows), { sent: 8, landed: 2, pending: 3 });
  assert.deepEqual([...T.VIEWS], ['sent', 'landed', 'pending']);
  for (const s of T.BUILD_STATUSES) assert.ok(T.viewStatuses(T.viewOfStatus(s)).includes(s), `${s} is listed by the view it belongs to`);
  assert.deepEqual([...T.PENDING_STATUSES, ...T.SENT_STATUSES, 'landed'].sort(), [...T.BUILD_STATUSES].sort(), 'every status is in exactly one view');
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

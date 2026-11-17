// node --test deploy/auto-lander/test/reconcile.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AXF_AUTO_LANDER_DIR = mkdtempSync(join(tmpdir(), 'al-rec-'));
const { reconcile } = await import('../reconcile.mjs');
const A = await import('../attempts.mjs');
const AL = await import('../../../framework/core/auto-lander.mjs');
const policy = AL.normPolicy({});
const T0 = '2026-11-17T01:00:00.000Z'; const T1 = '2026-11-17T01:20:00.000Z';
const d = (live = false) => ({ live: async () => ({ live }) });
const run = (id, snap, { status = 'built', live = false, at = T1 } = {}) => reconcile({ build: id, since: T0 }, { id, branch: `claude/${id}`, status }, { number: 1, ...snap }, d(live), { policy, at });

test('fix still running or Queued: left open', async () => {
  A.start('r1', 'red-ci', { head: 'h1', at: T0 });
  await run('r1', { head: 'h1', ci: 'failure' }, { live: true });
  await run('r1', { head: 'h1', ci: 'failure' }, { status: 'queued' });
  assert.equal(A.list('r1')[0].result, 'started');
});

test('fix pushed: open while the new head runs, ok when green', async () => {
  await run('r1', { head: 'h2', ci: 'running' });
  assert.equal(A.list('r1')[0].result, 'started');
  await run('r1', { head: 'h2', ci: 'success' });
  assert.equal(A.list('r1')[0].result, 'ok');
});

test('fix pushed and still red counts as a failure (attempt n+1 next); no push is a failure', async () => {
  A.start('r2', 'red-ci', { head: 'h1', at: T0 });
  await run('r2', { head: 'h2', ci: 'failure', summary: 'lint' });
  assert.equal(A.list('r2')[0].result, 'failed'); assert.match(A.list('r2')[0].log, /still red/);
  A.start('r2', 'red-ci', { head: 'h2', at: T0 });
  await run('r2', { head: 'h2', ci: 'failure' });
  assert.equal(A.count('r2')['red-ci'].failures, 2);
});

test('crash mid-clash and timeouts are closed in the log', async () => {
  A.start('r3', 'clash', { at: T0 });
  await run('r3', { head: 'h', ci: 'none' });
  assert.match(A.list('r3')[0].log, /crash/);
  A.start('r3', 'red-ci', { at: T0 });
  await run('r3', { head: 'h', ci: 'failure' }, { live: true, at: '2026-11-17T02:00:00.000Z' });
  assert.equal(A.list('r3', { kind: 'red-ci' })[0].result, 'timeout');
});

test('land: red while landing fails, merged left for the tick', async () => {
  A.start('r4', 'land', { at: T0 });
  await run('r4', { head: 'h', ci: 'success', merged: true });
  assert.equal(A.list('r4')[0].result, 'started');
  await run('r4', { head: 'h', ci: 'failure' });
  assert.equal(A.list('r4')[0].result, 'failed');
});

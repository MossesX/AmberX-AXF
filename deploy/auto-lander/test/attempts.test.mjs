// node --test deploy/auto-lander/test/attempts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AXF_AUTO_LANDER_DIR = mkdtempSync(join(tmpdir(), 'al-attempts-'));
const A = await import('../attempts.mjs');

test('start + end fold into one attempt; n is dense per kind', () => {
  const s = A.start('b-one', 'clash', { branch: 'claude/b-one', pr: 7, at: '2026-11-17T01:00:00.000Z' });
  assert.equal(s.n, 1); assert.equal(s.result, 'started');
  A.end(s, 'failed', { log: 'CONFLICT in a.js', at: '2026-11-17T01:01:00.000Z' });
  const s2 = A.start('b-one', 'clash', { at: '2026-11-17T01:10:00.000Z' });
  assert.equal(s2.n, 2);
  A.end(s2, 'ok', { at: '2026-11-17T01:11:00.000Z' });
  const l = A.list('b-one');
  assert.deepEqual(l.map((a) => [a.n, a.result]), [[1, 'failed'], [2, 'ok']]);
  assert.equal(A.count('b-one').clash.failures, 1);
  assert.equal(A.count('b-one').total, 2);
});

test('invalid records are refused, bad lines skipped', () => {
  assert.throws(() => A.append({ build: 'b-two', kind: 'nope', n: 1, result: 'ok', at: '2026-11-17T01:00:00.000Z' }), (e) => e.code === 'invalid');
  assert.throws(() => A.append({ build: '../etc', kind: 'land', n: 1, result: 'ok', at: '2026-11-17T01:00:00.000Z' }), (e) => e.code === 'invalid');
  A.record('b-two', 'land', 'ok', { at: '2026-11-17T02:00:00.000Z' });
  appendFileSync(A.fileFor('b-two'), 'not json\n');
  assert.equal(A.list('b-two').length, 1);
  assert.equal(A.readLines('b-two').bad, 1);
});

test('reset turns failures into skipped; builds lists every log', () => {
  A.record('b-three', 'red-ci', 'failed', { at: '2026-11-17T03:00:00.000Z', log: 'lint' });
  A.record('b-three', 'red-ci', 'failed', { at: '2026-11-17T03:30:00.000Z', log: 'lint' });
  assert.equal(A.reset('b-three', { by: 'brett' }), 2);
  assert.equal(A.count('b-three')['red-ci'].failures, 0);
  assert.equal(A.count('b-three')['red-ci'].skipped, 2);
  assert.deepEqual(A.builds(), ['b-one', 'b-three', 'b-two']);
});

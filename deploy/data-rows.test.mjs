#!/usr/bin/env node
/**
 * deploy/data-rows.mjs: the row patch of a changed document, and writeRows over a stub data-store call (cutover: one
 * patch with the changed rows, no file) and an unmapped path (the file).
 *
 *   node deploy/data-rows.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const T = mkdtempSync(join(tmpdir(), 'axf-data-rows-'));
const data = join(T, '.axf-console');
mkdirSync(join(data, 'data-store'), { recursive: true });
writeFileSync(join(data, 'data-store', 'mode.json'), JSON.stringify({ $axf: 'data-store-mode@1', mode: 'local', namespaces: { 'plugins/claude-accounts': { mode: 'cutover' } } }));
const calls = join(T, 'calls.jsonl'); const answer = join(T, 'answer.json');
const helper = join(T, 'call.mjs');
writeFileSync(helper, `import { appendFileSync, readFileSync } from 'node:fs';
let t = ''; process.stdin.on('data', (d) => { t += d; }); process.stdin.on('end', () => {
  appendFileSync(${JSON.stringify(calls)}, t + '\\n');
  const req = JSON.parse(t); let a = { ok: true, result: { record: { etag: '2-x' } } };
  try { const o = JSON.parse(readFileSync(${JSON.stringify(answer)}, 'utf8')); if (o[req.op]) a = o[req.op]; } catch {}
  console.log(JSON.stringify(a));
});`);
Object.assign(process.env, { AXF_STATE: join(data, 'state.json'), AXF_PLUGINS_DATA_DIR: join(data, 'plugins'), AXF_DATA_CALL_SYNC: helper });
const { MAP, rowPatch, writeRows } = await import('./data-rows.mjs');
let n = 0; const ok = (what) => { n += 1; console.log(`  ✓ ${what}`); };
const sent = () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

try {
  const L = { claims: MAP, rules: 'id' };
  assert.equal(rowPatch({ claims: { a: { x: 1 } }, mode: 1 }, { claims: { a: { x: 1 } }, mode: 1 }, L), undefined); ok('nothing changed: no call');
  assert.deepEqual(rowPatch({ claims: { a: { x: 1 }, b: { x: 2 } } }, { claims: { a: { x: 1 }, c: { x: 3 } } }, L),
    { lists: { claims: [{ key: 'c', item: { x: 3 } }, { key: 'b', delete: true }] } }); ok('a map: the added row and the removed row, the untouched one left out');
  assert.deepEqual(rowPatch({ rules: [{ id: 'r1', on: true }, { id: 'r2' }] }, { rules: [{ id: 'r1', on: false }, { id: 'r2' }, { id: 'r3' }] }, L),
    { lists: { rules: [{ key: 'r1', item: { id: 'r1', on: false } }, { key: 'r3', item: { id: 'r3' } }] } }); ok('a keyed list: the changed row and the new last row');
  assert.equal(rowPatch({ rules: [{ id: 'r1' }, { id: 'r2' }] }, { rules: [{ id: 'r2' }, { id: 'r1' }] }, L), null); ok('a keyed list moved: the whole document');
  assert.deepEqual(rowPatch({ mode: 1, claims: {} }, { mode: 2, claims: {} }, L), { head: { mode: 2 } }); ok('a head field');

  const file = join(data, 'plugins', 'claude-accounts', 'worker-state.json');
  const before = { claims: { s1: { account: 'w1' }, s2: { account: 'w2' } }, limits: {} };
  const after = { claims: { s1: { account: 'w1' } }, limits: {} };
  assert.equal(writeRows(file, before, after, { claims: MAP, limits: MAP }), 'rows');
  const [p] = sent();
  assert.equal(p.op, 'patch'); assert.equal(p.key, 'plugins/claude-accounts/worker-state.json');
  assert.deepEqual(p.body, { lists: { claims: [{ key: 's2', delete: true }] } }); ok('cutover: one patch naming the one row that went');
  assert.equal(existsSync(file), false); ok('cutover: no file');
  assert.equal(writeRows(file, after, after, { claims: MAP, limits: MAP }), 'unchanged'); assert.equal(sent().length, 1); ok('cutover, nothing changed: no call');

  writeFileSync(answer, JSON.stringify({ patch: { ok: false, code: 'not_found', message: 'put the document first' }, get: { ok: true, result: null }, put: { ok: true, result: { etag: '1-x' } } }));
  assert.equal(writeRows(file, before, after, { claims: MAP, limits: MAP }), 'document');
  const ops = sent().slice(1).map((c) => c.op); assert.deepEqual(ops, ['patch', 'get', 'put']); ok('a record axf-data has not seen: written once whole');

  const scratch = join(T, 'elsewhere', 'worker-state.json');
  assert.equal(writeRows(scratch, before, after, { claims: MAP, limits: MAP }), 'document');
  assert.deepEqual(JSON.parse(readFileSync(scratch, 'utf8')), after); ok('a path the map does not name: the file');
  console.log(`data-rows: ${n} passed`);
} finally { rmSync(T, { recursive: true, force: true }); }

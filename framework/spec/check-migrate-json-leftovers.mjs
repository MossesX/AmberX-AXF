#!/usr/bin/env node
/**
 * migrate-json-leftovers (framework/cli/migrate-json-leftovers.mjs) over scratch roots and an in-memory axf-data: the
 * path map is cutover-only with a reason on every local rule, the dry run changes nothing, and --apply moves every row,
 * verifies it, puts the namespace on axf-data only and deletes the file. A file that cannot be stored stays a file and
 * its namespace is not switched.
 *   node framework/spec/check-migrate-json-leftovers.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'json-leftovers-'));
const repo = join(dir, 'repo'); const data = join(dir, 'console'); const projects = join(dir, 'projects');
Object.assign(process.env, { AXF_ROOT: repo, AXF_STATE: join(data, 'state.json'), AXF_PLUGINS_DATA_DIR: join(data, 'plugins'), AXHUB_PROJECTS_DIR: projects, AXF_DATA_URL: 'off' });
const put = (f, text) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); return f; };
const json = (f, doc) => put(f, `${JSON.stringify(doc, null, 2)}\n`);

const D = await import('../core/data-store.mjs');
const F = await import('../core/data-files.mjs');
const M = await import('../cli/migrate-json-leftovers.mjs');
const { readState } = await import('../cli/data-mode.mjs');
const store = D.createDataStore({ backend: D.memoryBackend(), by: 'svc:cli' });

let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
try {
  const slots = json(join(projects, 'amberx-axf/_data/agent-slots/settings.json'), { closeFinishedAfterSec: 60 });
  const run1 = json(join(projects, 'amberx-axf/_data/agent-slots/runs/b1.json'), { build: 'b1', exit: 0 });
  const log = put(join(projects, 'amberx-axf/_data/agent-slots/build-limit.log.jsonl'), '{"event":"a"}\n{"event":"b"}\n');
  const nightly = json(join(data, 'nightly.json'), { lastDay: '2026-11-25' });
  const item = json(join(data, 'plugins/demo-plugin/items/i1.json'), { id: 'i1', title: 'one' });
  const mode = json(join(data, 'data-store/mode.json'), { $axf: 'data-store-mode@1', mode: 'local', since: '2026-11-01T00:00:00.000Z', by: 'svc:cli', cursor: 0, manifest: '', namespaces: { 'plugins/demo-plugin': { mode: 'shadow', since: '2026-11-01T00:00:00.000Z', cursor: 0, manifest: '', drift: 0, lastDriftAt: '' } } });
  const spool = put(join(data, 'build-hooks/events.jsonl'), '{"event":"x"}\n');
  const pipeline = json(join(projects, 'amberx-axf/_data/pipeline/status.json'), { leave: 'alone' });
  const secret = put(join(data, 'secrets.env'), 'A=1\n');

  await t('the path map: cutover only, a reason on every local rule, every example maps as written', async () => {
    assert.deepEqual(M.checkPaths(), []);
    const doc = JSON.parse(readFileSync(new URL('../schemas/data-store-paths.json', import.meta.url), 'utf8'));
    assert.match(M.checkPaths({ ...doc, store: { mode: 'shadow' } }).join('; '), /store\.mode is "shadow"/);
    assert.match(M.checkPaths({ ...doc, local: { rules: {} } }).join('; '), /keeps a file local with no reason/);
  });
  await t('what it takes: mapped .json and .jsonl only; spools, the mode switch, secrets and the pipeline folder are not touched', async () => {
    const keys = M.leftovers().map((s) => s.key);
    assert.deepEqual(keys, ['console/agent-slots/build-limit.log.jsonl', 'console/agent-slots/runs/b1.json', 'console/agent-slots/settings.json', 'console/host/nightly.json', 'plugins/demo-plugin/items/i1.json']);
  });
  await t('dry run (the default): lists files, keys and rows; nothing on axf-data, nothing deleted, no mode change', async () => {
    const r = await M.run({ store });
    assert.equal(r.ok, true); assert.equal(r.apply, false); assert.equal(r.files, 5); assert.equal(r.rows, 6); assert.equal(r.deleted, 0);
    assert.equal((await store.list('console')).items.length, 0);
    for (const f of [slots, run1, log, nightly, item]) assert.ok(existsSync(f));
    assert.equal(readState().namespaces.console, undefined);
  });
  await t('--apply needs axf-data', async () => {
    const r = await M.run({ apply: true });
    assert.equal(r.ok, false); assert.match(r.problems.join('; '), /axf-data is not configured/); assert.ok(existsSync(slots));
  });
  await t('a file that is not JSON stays a file and its namespace is not switched', async () => {
    const broken = put(join(data, 'plugins/broken-plugin/state.json'), '{ not json');
    const r = await M.run({ apply: true, store, only: ['plugins/broken-plugin'] });
    assert.equal(r.ok, false); assert.equal(r.deleted, 0); assert.ok(existsSync(broken));
    assert.match(r.namespaces[0].problems.join('; '), /not JSON/);
    assert.notEqual(F.modeOf('plugins/broken-plugin/state.json'), 'cutover');
    rmSync(dirname(broken), { recursive: true });
  });
  await t('--apply: every row on axf-data and read back, each namespace on axf-data only, each file deleted', async () => {
    const r = await M.run({ apply: true, store });
    assert.equal(r.ok, true, JSON.stringify(r.namespaces.map((x) => x.problems)));
    assert.equal(r.moved, 6); assert.equal(r.deleted, 5);
    assert.deepEqual((await store.get('console/agent-slots/settings.json')).data, { closeFinishedAfterSec: 60 });
    assert.deepEqual((await store.get('console/host/nightly.json')).data, { lastDay: '2026-11-25' });
    assert.deepEqual((await store.get('plugins/demo-plugin/items/i1.json')).data, { id: 'i1', title: 'one' });
    assert.deepEqual((await store.read('console/agent-slots/build-limit.log.jsonl')).entries.map((e) => e.entry), [{ event: 'a' }, { event: 'b' }]);
    for (const f of [slots, run1, log, nightly, item]) assert.ok(!existsSync(f), `${f} is gone`);
    for (const k of ['console/agent-slots/settings.json', 'console/host/nightly.json', 'plugins/demo-plugin/items/i1.json']) assert.equal(F.modeOf(k), 'cutover', k);
    assert.equal(readState().namespaces['plugins/demo-plugin'].mode, 'cutover');
  });
  await t('what is not data is still there, untouched', async () => {
    assert.equal(readFileSync(spool, 'utf8'), '{"event":"x"}\n'); assert.equal(readFileSync(secret, 'utf8'), 'A=1\n');
    assert.deepEqual(JSON.parse(readFileSync(pipeline, 'utf8')), { leave: 'alone' }); assert.ok(existsSync(mode));
    assert.equal((await store.list('builds')).items.length, 0);
  });
  await t('a second run finds nothing left; a stale file of a cut-over key is deleted, axf-data wins', async () => {
    assert.equal((await M.run({ apply: true, store })).files, 0);
    json(slots, { closeFinishedAfterSec: 5 });
    const r = await M.run({ apply: true, store });
    assert.equal(r.ok, true); assert.equal(r.deleted, 1); assert.ok(!existsSync(slots));
    assert.deepEqual((await store.get('console/agent-slots/settings.json')).data, { closeFinishedAfterSec: 60 });
  });
  console.log(`migrate-json-leftovers: ${n} checks ok`);
} finally { rmSync(dir, { recursive: true, force: true }); }

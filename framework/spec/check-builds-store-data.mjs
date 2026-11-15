#!/usr/bin/env node
/**
 * builds-store on data-store@1: the builds store and journal in local, shadow, cutover (lock = rev check) and rollback
 * mode, against a real axf-data (services/axf-data started on a free port). Skipped with a note when Python or FastAPI
 * is missing.
 *   node framework/spec/check-builds-store-data.mjs
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
try { execFileSync('python3', ['-c', 'import fastapi, uvicorn, cryptography'], { stdio: 'ignore' }); }
catch { console.log('builds-store on data-store: skipped (python3 with fastapi, uvicorn and cryptography is needed)'); process.exit(0); }

const dir = mkdtempSync(join(tmpdir(), 'builds-store-data-'));
const port = await new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
writeFileSync(join(dir, 'tokens.json'), JSON.stringify({ tokens: [{ id: 'o', sub: 'svc:orchestrator', sha256: createHash('sha256').update('tok').digest('hex'), grants: { '*': ['admin'] } }] }));
const srv = spawn('python3', ['-m', 'uvicorn', 'main:app', '--port', String(port), '--log-level', 'warning'], { cwd: join(ROOT, 'services/axf-data'), env: { ...process.env, AXF_DATA_DIR: join(dir, 'axf-data'), AXF_DATA_TOKENS_FILE: join(dir, 'tokens.json') }, stdio: 'inherit' });
const url = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${url}/v1/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }

Object.assign(process.env, {
  AXF_ROOT: dir, AXF_STATE: join(dir, '.axf-console/state.json'), AXF_BUILDS_STORE: join(dir, '_claude/builds/store.json'),
  AXF_DATA_URL: url, AXF_DATA_TOKEN: 'tok', AXF_BUILDS_LIVE: '0', AXF_BUILD_PROFILE: 'all', AXF_BUILD_HOOKS: 'off',
});
delete process.env.AXF_ORCH_FILE; delete process.env.AXF_PENDING_FILE;
mkdirSync(join(dir, '_claude/builds'), { recursive: true });
const modeFile = join(dir, '.axf-console/data-store/mode.json');
const setMode = (mode) => { mkdirSync(join(dir, '.axf-console/data-store'), { recursive: true }); writeFileSync(modeFile, JSON.stringify({ $axf: 'data-store-mode@1', mode: 'local', namespaces: { builds: { mode } } })); const t = new Date(Date.now() + Math.random() * 5000); utimesSync(modeFile, t, t); };
const H = { authorization: 'Bearer tok' };
const remote = async (key) => { const r = await fetch(`${url}/v1/${key}`, { headers: H }); return r.status === 200 ? r.json() : null; };

let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); srv.kill(); throw e; } };
const io = await import('../cli/builds-store.mjs');
const files = await import('../core/data-files.mjs');
const add = (id) => io.withStore((s) => { s.builds.push({ id, title: id, status: 'pending', profile: 'all', steps: [] }); return s; }, { by: 'test', action: 'add' });
const ids = (s) => s.builds.map((b) => b.id).sort();

try {
  await t('local: the file, nothing on axf-data', async () => {
    assert.equal(io.storeMode(), 'local');
    add('b1');
    assert.deepEqual(ids(JSON.parse(readFileSync(process.env.AXF_BUILDS_STORE, 'utf8'))), ['b1']);
    assert.equal(await remote('builds/store.json'), null);
  });
  await t('shadow: the file first, the same store and journal line on axf-data', async () => {
    setMode('shadow');
    add('b2');
    assert.deepEqual(ids(JSON.parse(readFileSync(process.env.AXF_BUILDS_STORE, 'utf8'))), ['b1', 'b2']);
    assert.deepEqual(ids(await remote('builds/store.json')), ['b1', 'b2']);
    const list = await (await fetch(`${url}/v1/builds?prefix=store.journal/`, { headers: H })).json();
    assert.equal(list.items.length, 1, 'the journal part mirrored');
  });
  await t('cutover: axf-data only, the local copy stays as the backup', async () => {
    setMode('cutover');
    const before = readFileSync(process.env.AXF_BUILDS_STORE, 'utf8');
    add('b3');
    assert.equal(readFileSync(process.env.AXF_BUILDS_STORE, 'utf8'), before);
    assert.deepEqual(ids(await remote('builds/store.json')), ['b1', 'b2', 'b3']);
    assert.deepEqual(ids(io.loadStore()), ['b1', 'b2', 'b3']);
    const month = new Date().toISOString().slice(0, 7);
    const j = await (await fetch(`${url}/v1/builds/journal/${month}?since=0`, { headers: H })).json();
    assert.equal(j.entries.at(-1).entry.builds[0].id, 'b3');
  });
  await t('cutover: lock = rev check (another writer between read and write → re-read, both kept)', async () => {
    let raced = false;
    io.withStore((s) => {
      if (!raced) {
        raced = true; // axf-molly writes first
        const cur = files.callSync({ op: 'get', key: 'builds/store.json' });
        cur.data.builds.push({ id: 'molly', title: 'molly', status: 'pending', profile: 'all', steps: [] });
        files.callSync({ op: 'put', key: 'builds/store.json', data: cur.data, ifMatch: cur.etag });
      }
      s.builds.push({ id: 'mine', title: 'mine', status: 'pending', profile: 'all', steps: [] });
      return s;
    }, { by: 'test', action: 'race' });
    assert.deepEqual(ids(await remote('builds/store.json')), ['b1', 'b2', 'b3', 'mine', 'molly']);
  });
  await t('cutover: history reads the journal on axf-data', async () => {
    const h = io.journalOf('b3');
    assert.equal(h.length, 1); assert.equal(h[0].op, 'add');
  });
  await t('rollback: writes refused (read_only)', async () => {
    setMode('rollback');
    assert.throws(() => add('b4'), (e) => e.code === 'read_only');
  });
} finally { srv.kill(); rmSync(dir, { recursive: true, force: true }); }
console.log(`builds-store on data-store: ${n} checks ok`);

#!/usr/bin/env node
/**
 * agent-slots on data-store@1 (s4.1 of urgent-all-data-to-postgres-builds-store): the slots state in local mode, the cut
 * (`agent-slots.mjs data cutover --apply`: copy, verify, flip the key), cutover writes (rev check instead of the mkdir lock,
 * a racing writer re-read and both kept) and the way back (`data local --apply`), against a real axf-data
 * (services/axf-data started on a free port). Skipped with a note when Python or FastAPI is missing.
 *   node framework/spec/check-agent-slots-data.mjs
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
try { execFileSync('python3', ['-c', 'import fastapi, uvicorn, cryptography'], { stdio: 'ignore' }); }
catch { console.log('agent-slots on data-store: skipped (python3 with fastapi, uvicorn and cryptography is needed)'); process.exit(0); }

const dir = mkdtempSync(join(tmpdir(), 'agent-slots-data-'));
const port = await new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
writeFileSync(join(dir, 'tokens.json'), JSON.stringify({ tokens: [{ id: 'o', sub: 'svc:cli', sha256: createHash('sha256').update('tok').digest('hex'), grants: { '*': ['admin'] } }] }));
const srv = spawn('python3', ['-m', 'uvicorn', 'main:app', '--port', String(port), '--log-level', 'warning'], { cwd: join(ROOT, 'services/axf-data'), env: { ...process.env, AXF_DATA_DIR: join(dir, 'axf-data'), AXF_DATA_TOKENS_FILE: join(dir, 'tokens.json') }, stdio: 'inherit' });
const url = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${url}/v1/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }

// the slots folder sits where the hub's would (<projects>/amberx-axf/_data/agent-slots), so it maps to its data-store key
// (outside AXF_ROOT: a path is mapped by the first root that holds it)
const projects = mkdtempSync(join(tmpdir(), 'agent-slots-projects-'));
const slots = join(projects, 'amberx-axf/_data/agent-slots');
mkdirSync(slots, { recursive: true });
mkdirSync(join(dir, 'repo'), { recursive: true });
Object.assign(process.env, { AXF_ROOT: join(dir, 'repo'), AXHUB_PROJECTS_DIR: projects, AXF_SLOTS_DIR: slots, AXF_DATA_URL: url, AXF_DATA_TOKEN: 'tok', AXF_BUILD_LIMIT: 'off' });
const H = { authorization: 'Bearer tok', connection: 'close' };
const remote = async (key) => { const r = await fetch(`${url}/v1/${key}`, { headers: H }); return r.status === 200 ? r.json() : null; };
const KEY = 'console/agent-slots/state.json';

let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); srv.kill(); throw e; } };
const slotsMod = await import('../cli/agent-slots.mjs');
const files = await import('../core/data-files.mjs');
const push = (id, list = 'queue') => slotsMod.withState((s) => { s[list].push({ id, name: id, kind: 'headless', priority: 'normal', state: list === 'queue' ? 'waiting' : 'running', seq: (s.seq += 1) }); });
const ids = (s, list = 'queue') => s[list].map((x) => x.id).sort();

try {
  await t('local: the file under the mkdir lock, nothing on axf-data', async () => {
    assert.equal(files.keyFor(join(slots, 'state.json')), KEY);
    assert.equal(slotsMod.stateMode(), 'local');
    push('a'); push('b');
    assert.deepEqual(ids(JSON.parse(readFileSync(join(slots, 'state.json'), 'utf8'))), ['a', 'b']);
    assert.equal(await remote(KEY), null);
  });
  await t('data status / cutover without --apply: report only, nothing copied or flipped', async () => {
    const r = await slotsMod.dataCut('cutover');
    assert.equal(r.ok, true); assert.equal(r.remote, null); assert.deepEqual(r.flipped, []);
    assert.equal(await remote(KEY), null);
    assert.equal(slotsMod.stateMode(), 'local');
  });
  await t('data cutover --apply: the document copied, read back equal, the key flipped', async () => {
    const r = await slotsMod.dataCut('cutover', { apply: true });
    assert.equal(r.ok, true, r.problems.join('; '));
    assert.equal(r.equal, true);
    assert.deepEqual(r.local, { running: 0, queue: 2, heavy: 0, done: 0 });
    assert.equal(r.flipped.length, 1); assert.match(r.flipped[0], /state\.json: local → cutover$/);
    assert.equal(slotsMod.stateMode(), 'cutover');
    assert.deepEqual(ids(await remote(KEY)), ['a', 'b']);
  });
  await t('cutover: writes go to axf-data only; the file stays as it was', async () => {
    const before = readFileSync(join(slots, 'state.json'), 'utf8');
    push('c');
    assert.equal(readFileSync(join(slots, 'state.json'), 'utf8'), before);
    assert.deepEqual(ids(await remote(KEY)), ['a', 'b', 'c']);
    assert.deepEqual(ids(slotsMod.loadState()), ['a', 'b', 'c']);
  });
  await t('cutover: rev check instead of the lock (a writer between read and put → re-read, both kept)', async () => {
    let raced = false;
    slotsMod.withState((s) => {
      if (!raced) {
        raced = true; // the console container writes first
        const cur = files.callSync({ op: 'get', key: KEY });
        cur.data.heavy.push({ id: 'h1', name: 'h1', state: 'running' });
        files.callSync({ op: 'put', key: KEY, data: cur.data, ifMatch: cur.etag });
      }
      s.queue.push({ id: 'mine', name: 'mine', state: 'waiting', priority: 'normal', seq: 99 });
    });
    const after = await remote(KEY);
    assert.deepEqual(ids(after), ['a', 'b', 'c', 'mine']);
    assert.deepEqual(ids(after, 'heavy'), ['h1']);
  });
  await t('data local --apply: axf-data written back to the file, the key local again', async () => {
    const r = await slotsMod.dataCut('local', { apply: true });
    assert.equal(r.ok, true, r.problems.join('; '));
    assert.equal(slotsMod.stateMode(), 'local');
    assert.deepEqual(ids(JSON.parse(readFileSync(join(slots, 'state.json'), 'utf8'))), ['a', 'b', 'c', 'mine']);
    push('d');
    assert.deepEqual(ids(JSON.parse(readFileSync(join(slots, 'state.json'), 'utf8'))), ['a', 'b', 'c', 'd', 'mine']);
  });
  console.log(`agent-slots on data-store: ${n} checks ok`);
} finally {
  srv.kill();
  rmSync(dir, { recursive: true, force: true });
  rmSync(projects, { recursive: true, force: true });
}

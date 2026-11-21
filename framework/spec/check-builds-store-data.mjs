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
// one connection per request: uvicorn closes idle keep-alive sockets after 5 s and a pooled fetch on one answers "other side closed"
const H = { authorization: 'Bearer tok', connection: 'close' };
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
  await t('cutover: axf-data is the store; no store.json projection is written (Pipeline 2.0)', async () => {
    setMode('cutover');
    const before = readFileSync(process.env.AXF_BUILDS_STORE, 'utf8');
    add('b3');
    assert.equal(readFileSync(process.env.AXF_BUILDS_STORE, 'utf8'), before, 'the file is left as it was at the cut');
    assert.equal(io.projectConsole, undefined, 'the projection is gone');
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
  await t('cutover: history pages the journal (SYNC_READ_PAGE per call), so a busy month part never overflows a sync call', async () => {
    // Nov 20 2026: a 68 MB month part came back as one 5000-entry page and data-call's stdout hit spawnSync ENOBUFS
    const month = new Date().toISOString().slice(0, 7);
    const count = files.SYNC_READ_PAGE * 2 + 7;
    const at = new Date().toISOString();
    const entries = Array.from({ length: count }, (_, i) => ({ rev: 100000 + i, at, by: 'test', action: 'page', builds: [{ id: 'paged', op: 'update', rev: i + 1, after: { id: 'paged', title: `p${i}` } }] }));
    files.callSync({ op: 'append', key: `builds/journal/${month}`, entries, idem: `paged-${Date.now()}` });
    const log = join(dir, 'calls.jsonl');
    const spy = join(dir, 'spy-data-call.mjs');
    writeFileSync(spy, `import { appendFileSync } from 'node:fs'; import { execFileSync } from 'node:child_process';
const chunks = []; for await (const c of process.stdin) chunks.push(c); const input = Buffer.concat(chunks).toString('utf8');
appendFileSync(${JSON.stringify(log)}, input + '\\n');
process.stdout.write(execFileSync(process.execPath, [${JSON.stringify(join(ROOT, 'framework/cli/data-call.mjs'))}], { input, maxBuffer: 1 << 30 }));`);
    process.env.AXF_DATA_CALL_SYNC = spy;
    let h;
    try { h = io.journalOf('paged'); } finally { delete process.env.AXF_DATA_CALL_SYNC; }
    assert.deepEqual(h.map((x) => x.buildRev), entries.map((e) => e.builds[0].rev), 'every entry, in order, across pages');
    const reads = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.op === 'read' && r.key === `builds/journal/${month}`);
    assert.ok(reads.length >= 3, `paged: ${reads.length} reads`);
    assert.ok(reads.every((r) => r.limit === files.SYNC_READ_PAGE), 'each read names the page size');
    assert.ok(files.SYNC_READ_PAGE * 256 * 1024 < files.CALL_SYNC_MAX_BUFFER / 2, 'a full page of the biggest entries fits the buffer with room');
  });
  await t('a sync get of a blob past the old 64 MiB buffer comes back whole (no ENOBUFS)', async () => {
    const big = Buffer.alloc(56 * 1024 * 1024, 7); // base64 in JSON: ~75 MB of stdout
    const put = await fetch(`${url}/v1/plugins/big-test/blob.bin`, { method: 'PUT', headers: { ...H, 'content-type': 'application/octet-stream', 'if-none-match': '*' }, body: big });
    assert.equal(put.status < 300, true, `put ${put.status}`);
    const rec = files.callSync({ op: 'get', key: 'plugins/big-test/blob.bin' });
    assert.equal(Buffer.from(rec.data.$bytes, 'base64').equals(big), true);
  });
  await t('cutover: a write is a patch of the changed builds (row-level), not the whole store', async () => {
    const before = await remote('builds/store.json');
    const meta0 = await (await fetch(`${url}/v1/builds/store.json?meta=1`, { headers: H })).json();
    // another writer changes b1 between our read and our write; we change b2: no conflict, both land
    let raced = false;
    io.withStore((s) => {
      if (!raced) { raced = true; files.callSync({ op: 'patch', key: 'builds/store.json', body: { lists: { builds: [{ key: 'b1', ifRev: s.builds.find((b) => b.id === 'b1').rev, item: { ...s.builds.find((b) => b.id === 'b1'), title: 'b1 by molly', rev: s.builds.find((b) => b.id === 'b1').rev + 1 } }] } } }); }
      s.builds.find((b) => b.id === 'b2').title = 'b2 by me';
      return s;
    }, { by: 'test', action: 'rename' });
    const after = await remote('builds/store.json');
    assert.equal(after.builds.find((b) => b.id === 'b1').title, 'b1 by molly');
    assert.equal(after.builds.find((b) => b.id === 'b2').title, 'b2 by me');
    assert.equal(after.builds.length, before.builds.length);
    const meta1 = await (await fetch(`${url}/v1/builds/store.json?meta=1`, { headers: H })).json();
    assert.equal(meta1.rev, meta0.rev + 2, 'two patches: two record revs');
    // the same build changed by both: our first try conflicts on that row, withStore re-reads and re-applies on top
    raced = false;
    io.withStore((s) => {
      const b = s.builds.find((x) => x.id === 'b3');
      if (!raced) { raced = true; files.callSync({ op: 'patch', key: 'builds/store.json', body: { lists: { builds: [{ key: 'b3', ifRev: b.rev, item: { ...b, title: 'b3 by molly', rev: b.rev + 1 } }] } } }); }
      b.notes.push({ text: `seen: ${b.title}`, at: new Date().toISOString() });
      return s;
    }, { by: 'test', action: 'note' });
    const b3 = (await remote('builds/store.json')).builds.find((b) => b.id === 'b3');
    assert.equal(b3.title, 'b3 by molly');
    assert.equal(b3.notes.at(-1).text, 'seen: b3 by molly', 're-applied on the other writer\'s version');
    const month = new Date().toISOString().slice(0, 7);
    const j = await (await fetch(`${url}/v1/builds/journal/${month}?since=0`, { headers: H })).json();
    assert.equal(j.entries.at(-1).entry.action, 'note', 'the journal line went with the patch');
    assert.equal(j.entries.filter((e) => e.entry.action === 'note').length, 1, 'the conflicting first try wrote nothing');
  });
  await t('cutover: builds main has newer (a writer from before the cut) are adopted into the tables, nothing older', async () => {
    const cur = io.loadStore();
    const later = new Date(Date.now() + 60000).toISOString();
    const main = JSON.parse(JSON.stringify(cur));
    const b2 = main.builds.find((b) => b.id === 'b2'); b2.title = 'b2 from main'; b2.updatedAt = later; b2.rev += 1;
    const b1 = main.builds.find((b) => b.id === 'b1'); b1.title = 'b1 stale on main'; b1.updatedAt = '2020-01-01T00:00:00.000Z';
    main.builds.push({ id: 'old-session', title: 'old-session', status: 'pending', profile: 'all', steps: [], updatedAt: later });
    io.adoptStore(main);
    const after = await remote('builds/store.json');
    assert.equal(after.builds.find((b) => b.id === 'b2').title, 'b2 from main');
    assert.equal(after.builds.find((b) => b.id === 'b1').title, 'b1 by molly', 'an older copy on main never wins');
    assert.ok(after.builds.some((b) => b.id === 'old-session'), 'a build only main has is added');
    assert.ok(!readFileSync(process.env.AXF_BUILDS_STORE, 'utf8').includes('b2 from main'), 'no projection: the adopted build is on the tables only');
    const month = new Date().toISOString().slice(0, 7);
    const j = await (await fetch(`${url}/v1/builds/journal/${month}?since=0`, { headers: H })).json();
    assert.equal(j.entries.at(-1).entry.action, 'adopt');
    assert.deepEqual(io.adoptRemote(main), [], 'adopting the same copy again changes nothing');
  });
  // ---- deep audit, repair part B (store transport and encoding); the rest: check-store-encoding.mjs
  await t('B4-01 cutover: a write far over 64 KB with multi-byte characters round-trips byte for byte (data-call over a real pipe)', async () => {
    const BAD = '�';
    const text = 'a→é…“”🙂·'.repeat(30000); // ~600 KB: nine 64 KB pipe chunks, a character across each boundary
    files.callSync({ op: 'put', key: 'builds/encoding-test.json', data: { text }, create: true });
    const back = files.callSync({ op: 'get', key: 'builds/encoding-test.json' }).data.text;
    assert.ok(!back.includes(BAD), 'no U+FFFD');
    assert.ok(Buffer.from(back, 'utf8').equals(Buffer.from(text, 'utf8')), 'the same bytes');
    // the same through the store: a build whose brief and notes make the write (and its journal line) far bigger
    const brief = 'Settings → Appearance · “UI Review” … 🙂 '.repeat(700).trim();
    const notes = Array.from({ length: 60 }, (_, i) => ({ text: `${i} ${'→·é…🙂'.repeat(300)}`, at: new Date().toISOString() }));
    io.withStore((s) => { s.builds.push({ id: 'big-text', title: 'Big → text', status: 'pending', profile: 'all', origin: { said: 'go', brief, at: new Date().toISOString() }, notes, steps: [{ id: 's1', text: 'Move A → B' }] }); return s; }, { by: 'test', action: 'add' });
    const b = io.loadStore().builds.find((x) => x.id === 'big-text');
    assert.ok(!JSON.stringify(b).includes(BAD), 'the build has no U+FFFD');
    assert.equal(b.origin.brief, brief); assert.deepEqual(b.notes.map((x) => x.text), notes.map((x) => x.text));
    const h = io.journalOf('big-text');
    assert.ok(!JSON.stringify(h).includes(BAD), 'nor has its journal line'); assert.equal(h.at(-1).after.origin.brief, brief);
  });
  await t('S5-01 cutover: a field this checkout does not know survives a tick; the patch names only the build that changed', async () => {
    const cur = files.callSync({ op: 'get', key: 'builds/store.json' });
    const raw = cur.data.builds.find((x) => x.id === 'b1'); raw.planningV2 = [{ text: 'from a newer release' }];
    cur.data.builds.find((x) => x.id === 'b2').futureField = { keep: true };
    files.callSync({ op: 'put', key: 'builds/store.json', data: cur.data, ifMatch: cur.etag });
    const log = join(dir, 'patch-calls.jsonl'); const spy = join(dir, 'spy-patch-call.mjs');
    writeFileSync(spy, `import { appendFileSync } from 'node:fs'; import { execFileSync } from 'node:child_process';
const chunks = []; for await (const c of process.stdin) chunks.push(c); const input = Buffer.concat(chunks).toString('utf8');
appendFileSync(${JSON.stringify(log)}, input + '\\n');
process.stdout.write(execFileSync(process.execPath, [${JSON.stringify(join(ROOT, 'framework/cli/data-call.mjs'))}], { input, maxBuffer: 1 << 30 }));`);
    process.env.AXF_DATA_CALL_SYNC = spy;
    try {
      io.withStore((s) => { s.builds.find((x) => x.id === 'b1').title = 'b1 once'; return s; }, { by: 'test', action: 'tick' });
      io.withStore((s) => { s.builds.find((x) => x.id === 'b1').title = 'b1 ticked'; return s; }, { by: 'test', action: 'tick' });
    } finally { delete process.env.AXF_DATA_CALL_SYNC; }
    const patches = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.op === 'patch');
    assert.equal(patches.length, 2);
    assert.deepEqual(patches.map((p) => p.body.lists.builds.map((x) => x.key)), [['b1'], ['b1']], 'only the build the caller changed is sent');
    assert.ok(patches[0].body.journal.entry.builds[0].after, 'B4-07: a record changed outside the journal (the put above) is journalled whole');
    assert.ok(patches[1].body.journal.entry.builds[0].diff && !patches[1].body.journal.entry.builds[0].after, 'B4-07: the next tick is a diff');
    const after = await remote('builds/store.json');
    assert.equal(after.builds.find((x) => x.id === 'b1').title, 'b1 ticked');
    assert.deepEqual(after.builds.find((x) => x.id === 'b1').planningV2, [{ text: 'from a newer release' }], 'the unknown field is still on the build');
    assert.deepEqual(after.builds.find((x) => x.id === 'b2').futureField, { keep: true }, 'and on the build nobody touched');
    assert.equal(after.storeVersion, io.STORE_VERSION, 'the store carries the writer\'s schema version');
    assert.equal(io.journalOf('b1').at(-1).after.title, 'b1 ticked', 'history rebuilds the record from the diff');
  });
  await t('S5-01 cutover: a checkout older than the store is refused', async () => {
    const cur = files.callSync({ op: 'get', key: 'builds/store.json' });
    files.callSync({ op: 'put', key: 'builds/store.json', data: { ...cur.data, storeVersion: io.STORE_VERSION + 1 }, ifMatch: cur.etag });
    assert.throws(() => io.withStore((s) => { s.builds.find((x) => x.id === 'b1').title = 'old code'; return s; }, { by: 'test', action: 'old' }), (e) => e instanceof io.StoreTooNew);
    assert.equal((await remote('builds/store.json')).builds.find((x) => x.id === 'b1').title, 'b1 ticked', 'nothing written');
    const again = files.callSync({ op: 'get', key: 'builds/store.json' });
    files.callSync({ op: 'put', key: 'builds/store.json', data: { ...again.data, storeVersion: io.STORE_VERSION }, ifMatch: again.etag });
  });
  await t('B4-09 cutover: the repo\'s orchestrator.json export is not rewritten (it dirtied the live checkout)', async () => {
    const orch = join(dir, '_claude/builds/orchestrator.json');
    const sentinel = `${JSON.stringify({ $export: 'written before the cutover', builds: [] })}\n`;
    writeFileSync(orch, sentinel);
    Object.assign(process.env, { AXF_DATA_DIR: dir, AXF_BUILDS_EXPORT: '1' }); // exports on, every export file inside the scratch folder
    try { add('after-the-cut'); } finally { delete process.env.AXF_DATA_DIR; delete process.env.AXF_BUILDS_EXPORT; }
    assert.ok(ids(await remote('builds/store.json')).includes('after-the-cut'), 'the write landed');
    assert.equal(readFileSync(orch, 'utf8'), sentinel, 'orchestrator.json is untouched');
    assert.ok(existsSync(`${process.env.AXF_BUILDS_STORE}.exports.json`), 'the export pass did run');
  });
  await t('rollback: writes refused (read_only)', async () => {
    setMode('rollback');
    assert.throws(() => add('b4'), (e) => e.code === 'read_only');
  });
  await t('blob-sqlite: a consistent copy uploaded after a write, the newest fetched before opening in cutover', async () => {
    const f = join(dir, '.axf-console/plugins/shipped-features/ledger.sqlite');
    mkdirSync(join(dir, '.axf-console/plugins/shipped-features'), { recursive: true });
    writeFileSync(f, 'SQLite format 3\0 one');
    const fakeDb = { exec: (sql) => { const m = /VACUUM INTO '(.+)'/.exec(sql); writeFileSync(m[1], readFileSync(f)); } };
    const nsMode = (ns, mode) => { const doc = JSON.parse(readFileSync(modeFile, 'utf8')); doc.namespaces[ns] = { mode }; writeFileSync(modeFile, JSON.stringify(doc)); const tt = new Date(Date.now() + 10000 + Math.random() * 5000); utimesSync(modeFile, tt, tt); };
    assert.equal(files.sqliteUpload(f, fakeDb), false, 'local: nothing uploaded');
    nsMode('plugins/shipped-features', 'shadow');
    assert.equal(files.sqliteUpload(f, fakeDb), true);
    const got = await fetch(`${url}/v1/plugins/shipped-features/ledger.sqlite`, { headers: H });
    assert.equal(Buffer.from(await got.arrayBuffer()).toString(), 'SQLite format 3\0 one');
    // someone else (axf-molly) uploads a newer copy; cutover fetches it before opening
    await fetch(`${url}/v1/plugins/shipped-features/ledger.sqlite?force=1`, { method: 'PUT', headers: { ...H, 'content-type': 'application/vnd.sqlite3' }, body: 'SQLite format 3\0 two' });
    nsMode('plugins/shipped-features', 'cutover');
    assert.equal(files.sqliteHydrate(f), true);
    assert.equal(readFileSync(f, 'utf8'), 'SQLite format 3\0 two');
    assert.equal(files.sqliteHydrate(f), false, 'already the newest');
  });
  await t('changes log: the axf-data backend writes and lists entries', async () => {
    const ch = await import('../../apps/console-web/plugins/codebase-changes/changes.mjs');
    const b = ch.dataStoreBackend(files.remoteStore());
    const e = await b.put({ id: 'chg-20261115-abcdef12', title: 'Data container', kind: 'feature', asked: 'the console goes down…', repos: ['MossesX/AmberX-AXF'], startedAt: '2026-11-15T05:00:00Z' });
    assert.equal((await b.get(e.id)).title, 'Data container');
    assert.deepEqual((await b.list()).map((x) => x.id), [e.id]);
  });
} finally { srv.kill(); rmSync(dir, { recursive: true, force: true }); }
console.log(`builds-store on data-store: ${n} checks ok`);

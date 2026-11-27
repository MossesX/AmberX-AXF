#!/usr/bin/env node
/**
 * data-store@1 conformance: the registry mirror, the reference client on the memory backend (there is no local-file backend),
 * the HTTP backend's error mapping and retries, the migration map and the mode machine.
 * Contract invariants (rev conflicts, append-only journals, count manifests, mode shortcuts refused) are asserted on
 * the fixture; `--http <url>` (token in AXF_DATA_TOKEN) replays the scenario against a live, empty axf-data.
 *   node framework/spec/check-data-store.mjs           check
 *   node framework/spec/check-data-store.mjs --write   regenerate fixtures/data-store.json (+ the registry part of
 *                                                      schemas/data-store.json; its jsonSchemas are authored by hand)
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as D from '../core/data-store.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/data-store.json');
const SCHEMA = join(ROOT, 'framework/schemas/data-store.json');
const WRITE = process.argv.includes('--write');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const codeOf = async (p) => { try { await p; return 'ok'; } catch (e) { if (!(e instanceof D.DataStoreError)) throw e; return e.code; } };

// ── 1. registry mirror ───────────────────────────────────────────────────────────────────────────────────────────────
const schemaDoc = JSON.parse(readFileSync(SCHEMA, 'utf8'));
await t('registry mirrors framework/schemas/data-store.json', () => {
  const want = { ...D.registry(), jsonSchemas: schemaDoc.jsonSchemas };
  if (WRITE) writeFileSync(SCHEMA, `${JSON.stringify(want, null, 2)}\n`);
  else assert.deepEqual(schemaDoc, JSON.parse(JSON.stringify(want)), 'schemas/data-store.json drifted from core/data-store.mjs (run --write)');
  for (const f of D.FRAMES) assert.ok(schemaDoc.jsonSchemas[f], `jsonSchemas has ${f}`);
  for (const code of Object.keys(D.ERRORS)) assert.ok(schemaDoc.jsonSchemas['data-error@1'].properties.code.enum.includes(code), `error enum has ${code}`);
  assert.deepEqual(schemaDoc.jsonSchemas['data-store-mode@1'].properties.mode.enum, D.MODES);
});

// ── 2. pure parts ────────────────────────────────────────────────────────────────────────────────────────────────────
const pure = {};
await t('keys, etags, manifests, backoff', () => {
  const keyCase = (k) => { try { return D.parseKey(k); } catch (e) { return { error: e.code, message: e.message }; } };
  pure.keys = Object.fromEntries(['builds/store.json', 'builds/journal/2026-11', 'plugins/ui-review/items.json', 'notes/handoffs/2026-11-14.md', 'plugins/items.json', 'plugins/Bad_Folder/x', 'nope/x', 'builds', 'builds/../x', 'builds/a//b', `builds/${'a'.repeat(81)}`, 'settings/apps/amberx-droid.json', ''].map((k) => [k || '(empty)', keyCase(k)]));
  pure.namespaces = Object.fromEntries(['builds', 'plugins/ui-review', 'plugins', 'plugins/x/y', 'nope'].map((k) => { try { return [k, D.parseNamespace(k)]; } catch (e) { return [k, { error: e.code }]; } }));
  pure.etag = { record: D.etagOf(1, { b: 1, a: 2 }), sameKeysOtherOrder: D.etagOf(1, { a: 2, b: 1 }), rev2: D.etagOf(2, { b: 1, a: 2 }), bytes: D.etagOf(1, new Uint8Array([1, 2, 3])), canonical: D.canonical({ z: [1, { y: null, x: 'é' }], a: true }) };
  assert.equal(D.canonical({ b: 1, a: 2 }), D.canonical({ a: 2, b: 1 }));
  assert.equal(pure.etag.record, D.etagOf(1, D.canonical({ a: 2, b: 1 })));
  pure.ifMatch = ['3', 3, '"3-0123456789abcdef"', 'W/"3-0123456789abcdef"', 'x', 0, '', null].map(D.normIfMatch);
  const items = [{ path: 'b.json', etag: '2-aaaaaaaaaaaaaaaa', size: 10, kind: 'record' }, { path: 'a.json', etag: '1-bbbbbbbbbbbbbbbb', size: 5, kind: 'record' }, { path: 'gone.json', etag: '3-0000000000000000', size: 0, kind: 'record', deleted: true }, { path: 'journal/2026-11', etag: '7-cccccccccccccccc', size: 700, kind: 'journal', entries: 7 }];
  pure.manifest = D.manifestOf(items);
  assert.equal(pure.manifest, pure.manifest);
  assert.deepEqual(D.manifestOf(items.slice().reverse()), pure.manifest, 'order of input never changes the manifest');
  pure.sameManifest = {
    equal: D.sameManifest({ namespaces: { builds: pure.manifest } }, { namespaces: { builds: D.manifestOf(items) } }),
    oneOff: D.sameManifest({ namespaces: { builds: pure.manifest, notes: { count: 1, bytes: 1, hash: 'x' } } }, { namespaces: { builds: D.manifestOf(items.slice(1)) } }),
    bare: D.sameManifest(pure.manifest, pure.manifest),
  };
  pure.backoff = { fixedRnd: [0, 1, 2, 3, 4, 5, 9].map((i) => D.backoffMs(i, () => 0.5)), low: D.backoffMs(0, () => 0), high: D.backoffMs(0, () => 1) };
  pure.error = D.errorFrame('conflict', 'builds/store.json is at rev 4', { ns: 'builds', path: 'store.json', rev: 4, etag: '4-0123456789abcdef', retryAfterMs: undefined });
  pure.pluginKey = { own: D.pluginKey('ui-review', '/items.json'), ok: D.pluginKey('shipped-features', '/ledger.sqlite'), nested: D.pluginKey('sample-plugin', 'chats\\2026\\a.json'), bad: (() => { try { return D.pluginKey('Bad', 'x'); } catch (e) { return { error: e.code }; } })() };
  pure.kindOfFile = Object.fromEntries(['store.json', 'journal/2026-11.jsonl', 'log.ndjson', 'shot.png', 'ledger.sqlite', 'note.md', 'README'].map((f) => [f, D.kindOfFile(f)]));
});

// ── 3. the client on the memory backend ─────────────────────────────────────────────────────────────────
const clock = () => { let i = 0; return () => `2026-11-15T05:00:${String(i++ % 60).padStart(2, '0')}.000Z`; };
async function scenario(backend) {
  const sleeps = [];
  const s = D.createDataStore({ backend, by: 'svc:orchestrator', sleep: async (ms) => { sleeps.push(ms); }, rnd: () => 0.5 });
  const out = { steps: [] };
  const step = (name, v) => { out.steps.push({ name, v }); return v; };
  step('missing', await s.get('builds/store.json'));
  step('putNoPrecondition', await codeOf(s.put('builds/store.json', { rev: 1 })));
  const r1 = step('create', await s.put('builds/store.json', { $axf: 'builds@1', rev: 1, builds: [] }, { create: true }));
  step('createAgain', await codeOf(s.put('builds/store.json', {}, { create: true })));
  step('get', await s.get('builds/store.json'));
  step('putStaleRev', await codeOf(s.put('builds/store.json', { rev: 9 }, { ifMatch: '7' })));
  step('putStaleEtag', await codeOf(s.put('builds/store.json', { rev: 9 }, { ifMatch: '1-0000000000000000' })));
  const r2 = step('putByRev', await s.put('builds/store.json', { $axf: 'builds@1', rev: 2, builds: [{ id: 'a' }] }, { ifMatch: 1 }));
  step('putByEtag', await s.put('builds/store.json', { $axf: 'builds@1', rev: 3, builds: [{ id: 'a' }, { id: 'b' }] }, { ifMatch: r2.etag }));
  // update(): someone else writes between the read and the put → re-read and retry
  let raced = false;
  step('update', await s.update('builds/store.json', async (doc) => {
    if (!raced) { raced = true; await s.put('builds/store.json', { ...doc, rev: doc.rev + 1, builds: [...doc.builds, { id: 'racer' }] }, { ifMatch: (await s.get('builds/store.json')).etag }); }
    return { ...doc, rev: doc.rev + 1, builds: [...doc.builds, { id: 'mine' }] };
  }));
  step('afterUpdate', (await s.get('builds/store.json')).data.builds.map((b) => b.id));
  step('updateCreate', await s.update('planner/plans/p1.json', (doc) => ({ ...(doc || {}), title: 'Plan' }), { create: true }));
  step('updateMissing', await codeOf(s.update('planner/plans/p2.json', (doc) => doc)));
  step('updateNoChange', await s.update('planner/plans/p1.json', () => undefined));
  step('sleeps', sleeps.splice(0));
  // wrong kinds
  step('recordInNotes', await codeOf(s.put('notes/a.md', { not: 'bytes' }, { create: true })));
  step('blobNote', await s.put('notes/handoffs/a.md', '# Hello\n', { create: true, contentType: 'text/markdown' }));
  step('blobForce', await s.put('notes/handoffs/a.md', '# Hello again\n', { force: true, contentType: 'text/markdown' }));
  const blob = await s.get('notes/handoffs/a.md');
  step('getBlob', { ...blob, data: new TextDecoder().decode(blob.data) });
  step('blobOverRecord', await codeOf(s.put('builds/store.json', new Uint8Array([1]), { force: true })));
  step('tooLarge', await codeOf(s.put('settings/big.json', { s: 'x'.repeat(D.LIMITS.recordBytes) }, { create: true })));
  step('tooLargeEntry', await codeOf(s.append('builds/journal/big', [{ s: 'x'.repeat(D.LIMITS.entryBytes) }])));
  // journals
  step('append', await s.append('builds/journal/2026-11', [{ rev: 1, action: 'add' }, { rev: 2, action: 'step' }]));
  step('appendIdem', await s.append('builds/journal/2026-11', [{ rev: 3 }], { idempotencyKey: 'k1' }));
  step('appendIdemAgain', await s.append('builds/journal/2026-11', [{ rev: 3 }], { idempotencyKey: 'k1' }));
  step('appendEmpty', await codeOf(s.append('builds/journal/2026-11', [])));
  step('appendOnRecord', await codeOf(s.append('builds/store.json', [{ x: 1 }])));
  step('putOnJournal', await codeOf(s.put('builds/journal/2026-11', { x: 1 }, { create: true })));
  step('getJournal', await codeOf(s.get('builds/journal/2026-11')));
  step('deleteJournal', await codeOf(s.delete('builds/journal/2026-11', { force: true })));
  step('appendWrongNs', await codeOf(s.append('settings/log', [{ x: 1 }])));
  step('read', await s.read('builds/journal/2026-11'));
  step('readSince', await s.read('builds/journal/2026-11', { since: 1, limit: 1 }));
  step('readTail', await s.read('builds/journal/2026-11', { tail: 1 }));
  step('readRecord', await codeOf(s.read('builds/store.json')));
  // list + delete + tombstones
  await s.put('builds/shipped/a.json', { a: 1 }, { create: true });
  await s.put('builds/shipped/b.json', { b: 1 }, { create: true });
  step('list', await s.list('builds'));
  step('listPrefixPage', await s.list('builds', { prefix: 'shipped/', limit: 1 }));
  step('listAfter', await s.list('builds', { prefix: 'shipped/', after: 'shipped/a.json' }));
  step('deleteNoPrecondition', await codeOf(s.delete('builds/shipped/a.json')));
  step('deleteStale', await codeOf(s.delete('builds/shipped/a.json', { ifMatch: '9' })));
  const del = step('delete', await s.delete('builds/shipped/a.json', { ifMatch: 1 }));
  step('getDeleted', await s.get('builds/shipped/a.json'));
  step('getTombstone', await s.get('builds/shipped/a.json', { deleted: true }));
  step('deleteTwice', await codeOf(s.delete('builds/shipped/a.json', { ifMatch: del.etag })));
  step('putOnTombstoneStale', await codeOf(s.put('builds/shipped/a.json', { a: 2 }, { ifMatch: del.etag })));
  step('recreate', await s.put('builds/shipped/a.json', { a: 2 }, { create: true }));
  step('listDeleted', (await s.list('builds', { deleted: true })).items.map((i) => [i.path, i.rev, i.deleted]));
  // plugin namespace
  step('pluginPut', await s.put(D.pluginKey('ui-review', 'items.json'), { items: [] }, { create: true }));
  step('pluginList', await s.list('plugins/ui-review'));
  step('pluginListAll', (await s.list('plugins')).items.map((i) => i.path));
  // changes, watch, manifests, snapshot
  const ch = step('changes', await s.changes({ since: 0 }));
  step('changesNs', (await s.changes({ ns: ['plugins/ui-review', 'notes'] })).changes.map((c) => `${c.cursor}:${c.op}:${c.ns}/${c.path}`));
  step('changesSince', (await s.changes({ since: ch.cursor - 2 })).changes.map((c) => c.cursor));
  const seen = [];
  const w = s.watch({ ns: 'builds', prefix: 'shipped/', since: 0, intervalMs: 50 }, (c) => { seen.push(`${c.cursor}:${c.op}:${c.path}`); });
  await w.ready;
  await s.put('builds/shipped/c.json', { c: 1 }, { create: true });
  await new Promise((r) => setTimeout(r, 120));
  w.close();
  step('watch', { seen, cursor: w.cursor() });
  step('manifestBuilds', await s.manifest('builds'));
  step('manifestPlugin', await s.manifest('plugins/ui-review'));
  step('manifestEmpty', await s.manifest('changes'));
  const snap = step('snapshot', await s.snapshot(['builds', 'notes', 'plugins/ui-review']));
  step('snapshotStored', (await s.get(`_meta/manifests/${snap.id}`)).data.id === snap.id);
  step('health', await s.health());
  return out;
}
let mem;
await t('memory backend scenario', async () => { mem = await scenario(D.memoryBackend({ now: clock() })); });
await t('there is no local-file backend: axf-data is the one store', () => { assert.equal(D.fileBackend, undefined); });

// ── 4. HTTP backend: wire mapping, error frames, retries ─────────────────────────────────────────────────────────────
const http = {};
await t('http backend maps the wire and retries the way the spec says', async () => {
  const calls = [];
  const answers = [];
  const res = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body, arrayBuffer: async () => new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)).buffer });
  const fetchImpl = async (url, init) => { calls.push({ url, method: init.method || 'GET', headers: init.headers, body: typeof init.body === 'string' ? init.body : init.body ? `<${init.body.length} bytes>` : undefined }); return answers.shift() || res(500, { $axf: 'data-error@1', code: 'internal', message: 'no answer queued' }); };
  const sleeps = [];
  let reissued = 0;
  const b = D.httpBackend({ url: 'http://axf-data:7700/', token: () => (reissued ? 't2' : 't1'), actor: 'session:abc', fetch: fetchImpl });
  const s = D.createDataStore({ backend: b, sleep: async (ms) => { sleeps.push(ms); }, rnd: () => 0.5, onUnauthorized: async () => { reissued += 1; } });
  answers.push(res(200, { $axf: 'builds@1', rev: 4 }, { etag: '"4-0123456789abcdef"', 'x-axf-rev': '4', 'x-axf-at': '2026-11-15T05:00:00.000Z', 'x-axf-by': 'svc:console', 'content-type': 'application/json' }));
  http.get = await s.get('builds/store.json');
  answers.push(res(409, { $axf: 'data-error@1', code: 'conflict', message: 'at rev 5', ns: 'builds', path: 'store.json', rev: 5, etag: '5-aaaaaaaaaaaaaaaa' }));
  try { await s.put('builds/store.json', { rev: 5 }, { ifMatch: http.get.etag }); } catch (e) { http.conflict = { code: e.code, status: e.status, rev: e.rev, etag: e.etag, frame: e.frame() }; }
  answers.push(res(404, null));
  http.missing = await s.get('builds/none.json');
  answers.push(res(503, { $axf: 'data-error@1', code: 'unavailable', message: 'volume', retryAfterMs: 40 }), res(429, null, { 'retry-after': '1' }), res(200, { $axf: 'data-list@1', ns: 'builds', prefix: '', items: [], next: '' }));
  http.listAfterRetries = await s.list('builds');
  answers.push(res(401, { $axf: 'data-error@1', code: 'unauthorized', message: 'expired' }), res(200, { $axf: 'data-append@1', ns: 'builds', path: 'journal/2026-11', first: 8, last: 8, count: 1 }));
  http.appendAfterReissue = await s.append('builds/journal/2026-11', [{ rev: 8 }], { idempotencyKey: 'k9' });
  answers.push(res(401, { $axf: 'data-error@1', code: 'unauthorized', message: 'still expired' }), res(401, { $axf: 'data-error@1', code: 'unauthorized', message: 'still expired' }));
  http.unauthorizedTwice = await codeOf(s.health());
  for (let i = 0; i < D.RETRY.tries; i += 1) answers.push(res(503, { $axf: 'data-error@1', code: 'unavailable', message: 'down' }));
  http.givesUp = await codeOf(s.health());
  answers.push(res(423, { $axf: 'data-error@1', code: 'read_only', message: 'cutover in progress' }));
  http.readOnly = await codeOf(s.put('settings/a.json', {}, { create: true }));
  answers.push(res(500, 'not json'));
  answers.push(res(500, 'not json'));
  http.unknownBody = await codeOf(s.manifest('builds'));
  http.calls = calls.map((c) => ({ ...c, headers: Object.fromEntries(Object.entries(c.headers).filter(([k]) => k !== 'accept')) }));
  http.sleeps = sleeps;
  http.reissued = reissued;
  assert.equal(http.reissued, 2);
  assert.equal(http.conflict.code, 'conflict');
  assert.equal(http.listAfterRetries.$axf, 'data-list@1');
  assert.equal(http.calls[0].headers.authorization, 'Bearer t1');
  assert.equal(http.calls.at(-1).headers.authorization, 'Bearer t2');
  assert.equal(await codeOf(Promise.reject(new D.DataStoreError('nope', 'x'))), 'internal');
});

// ── 5. fixture ───────────────────────────────────────────────────────────────────────────────────────────────────────
const out = { $axf: 'data-store@1', note: 'Generated by framework/spec/check-data-store.mjs --write; the memory backend answers `client`, and every port answers `pure` and `http`.', pure, client: mem, http };
await t('fixture matches', () => {
  if (WRITE) { writeFileSync(FIX, `${JSON.stringify(out, null, 1)}\n`); return; }
  assert.ok(existsSync(FIX), 'fixtures/data-store.json missing (run --write)');
  const want = JSON.parse(readFileSync(FIX, 'utf8'));
  assert.ok(same(want, JSON.parse(JSON.stringify(out))), 'fixtures/data-store.json drifted (run --write and review the diff)');
});

// ── 6. migration map + mode machine (steps s3 / s4 of the build add these) ───────────────────────────────────────────
const MIG = join(ROOT, 'framework/spec/fixtures/data-store-migration.json');
if (existsSync(MIG)) {
  const { checkMigration } = await import('./check-data-store-migration.mjs');
  await t('migration map', async () => { n += await checkMigration({ WRITE }); });
}
const MODE = join(ROOT, 'framework/core/data-store-mode.mjs');
if (existsSync(MODE)) {
  const { checkMode } = await import('./check-data-store-mode.mjs');
  await t('mode machine', async () => { n += await checkMode({ WRITE }); });
}

// ── 7. contract invariants, read off the fixture (what every port and the axf-data server must keep) ───────────────
const stepOf = (name) => { const s = mem.steps.find((x) => x.name === name); assert.ok(s, `scenario step ${name}`); return s.v; };
await t('contract: rev conflicts', () => {
  assert.equal(stepOf('putNoPrecondition'), 'precondition_required', 'a record put with no precondition is refused');
  assert.equal(stepOf('createAgain'), 'exists');
  assert.equal(stepOf('putStaleRev'), 'conflict');
  assert.equal(stepOf('putStaleEtag'), 'conflict');
  assert.equal(stepOf('putOnTombstoneStale'), 'conflict');
  assert.equal(stepOf('deleteStale'), 'conflict');
  assert.deepEqual(stepOf('afterUpdate'), ['a', 'b', 'racer', 'mine'], 'update() re-reads after a conflict and keeps the other writer');
  const revs = ['create', 'putByRev', 'putByEtag'].map((k) => stepOf(k).rev);
  assert.deepEqual(revs, [1, 2, 3], 'rev is 1 on create and +1 per accepted write');
  for (const k of ['create', 'putByRev', 'putByEtag']) assert.match(stepOf(k).etag, new RegExp(D.PATTERNS.etag));
});
await t('contract: journals are append-only', () => {
  assert.equal(stepOf('putOnJournal'), 'invalid_key');
  assert.equal(stepOf('deleteJournal'), 'read_only');
  assert.equal(stepOf('getJournal'), 'invalid_key');
  assert.equal(stepOf('appendOnRecord'), 'invalid_key');
  assert.equal(stepOf('appendEmpty'), 'invalid_body');
  assert.deepEqual(stepOf('appendIdemAgain'), stepOf('appendIdem'), 'a retried idempotent append answers the same range');
  const seqs = stepOf('read').entries.map((e) => e.seq);
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1), 'seq starts at 1 and has no gaps');
});
await t('contract: count manifests', () => {
  const m = stepOf('manifestBuilds');
  const live = stepOf('list');
  assert.ok(m.count >= live.items.length, 'manifest counts every live key');
  assert.equal(stepOf('manifestEmpty').count, 0);
  const lost = D.sameManifest({ namespaces: { builds: m } }, { namespaces: { builds: { ...m, count: m.count - 1 } } });
  assert.equal(lost.equal, false, 'a lost key is a mismatch');
  assert.equal(stepOf('snapshotStored'), true, 'a snapshot stores its manifest under _meta/manifests');
});
await t('contract: mode transitions refuse shortcuts', async () => {
  const M = await import('../core/data-store-mode.mjs');
  assert.deepEqual(M.MODES, D.MODES);
  for (const [ev, [from, to]] of Object.entries(M.TRANSITIONS)) assert.ok(D.MODES.includes(from) && D.MODES.includes(to), ev);
  const pairs = new Set(Object.values(M.TRANSITIONS).map(([a, b]) => `${a}>${b}`));
  assert.ok(!pairs.has('local>cutover') && !pairs.has('cutover>local'), 'no local ↔ cutover shortcut: shadow first, roll back first');
  assert.equal(M.ROUTES.cutover.localWritable, false);
  assert.deepEqual(M.ROUTES.rollback.write, []);
});

// ── 7b. data-files: the map (same examples the Python layer checks) and the modes over a memory axf-data ──────────────
await t('data-files: path map, one store per key (local and shadow = the file, cutover = axf-data only, no mirror, no local fallback)', async () => {
  const F = await import('../core/data-files.mjs');
  const ex = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/data-store-paths.json'), 'utf8')).examples;
  for (const [k, want] of Object.entries(ex)) { const i = k.indexOf(':'); assert.equal(F.mapRel(k.slice(0, i), k.slice(i + 1)), want, k); }
  const dir = mkdtempSync(join(tmpdir(), 'axf-data-files-'));
  const env0 = { AXF_STATE: process.env.AXF_STATE, AXHUB_PROJECTS_DIR: process.env.AXHUB_PROJECTS_DIR };
  try {
    process.env.AXF_STATE = join(dir, 'console/state.json'); process.env.AXHUB_PROJECTS_DIR = join(dir, 'projects');
    const mem = D.createDataStore({ backend: D.memoryBackend() });
    F.setRemote(mem);
    const plan = join(dir, 'projects/amberx-axf/_data/plan-studio/plans/p1.json');
    const setMode = (ns, mode) => { const f = join(dir, 'console/data-store/mode.json'); const doc = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { mode: 'local', namespaces: {} }; doc.namespaces[ns] = { mode }; mkdirSync(join(dir, 'console/data-store'), { recursive: true }); writeFileSync(f, JSON.stringify(doc)); const t2 = new Date(Date.now() + Math.random() * 1000); utimesSync(f, t2, t2); };
    assert.equal(F.keyFor(plan), 'planner/plans/p1.json');
    await F.writeJson(plan, { title: 'one' });
    assert.deepEqual(JSON.parse(readFileSync(plan, 'utf8')), { title: 'one' }, 'local: the file');
    assert.equal(await mem.get('planner/plans/p1.json'), null, 'local: axf-data untouched');
    setMode('planner', 'shadow');
    await F.writeJson(plan, { title: 'two' });
    assert.deepEqual(JSON.parse(readFileSync(plan, 'utf8')), { title: 'two' }, 'shadow: still the file');
    assert.equal(await mem.get('planner/plans/p1.json'), null, 'shadow: no write is mirrored');
    await mem.put('planner/plans/p1.json', { title: 'two' }, { create: true }); // the migration's copy before the cut
    const pd = F.pluginData('shipped-features');
    setMode('plugins/shipped-features', 'shadow');
    await pd.appendJsonl('log.jsonl', { a: 1 });
    assert.equal(pd.key('log.jsonl'), 'plugins/shipped-features/log.jsonl');
    setMode('planner', 'cutover');
    await F.updateJson(plan, (d) => ({ ...d, n: 3 }));
    assert.deepEqual(JSON.parse(readFileSync(plan, 'utf8')), { title: 'two' }, 'cutover: the local copy stays as it was');
    assert.deepEqual(await F.readJson(plan, null), { title: 'two', n: 3 }, 'cutover: reads come from axf-data');
    const url0 = process.env.AXF_DATA_URL;
    try {
      F.setRemote(null); process.env.AXF_DATA_URL = 'off';
      await assert.rejects(F.readJson(plan, null), (e) => e.code === 'unavailable', 'cutover without axf-data: the read throws, the file left from before the cut is not served');
      await assert.rejects(F.writeJson(plan, { title: 'lost' }), (e) => e.code === 'unavailable');
      assert.deepEqual(JSON.parse(readFileSync(plan, 'utf8')), { title: 'two' }, 'cutover without axf-data: nothing written beside it');
    } finally { if (url0 === undefined) delete process.env.AXF_DATA_URL; else process.env.AXF_DATA_URL = url0; F.setRemote(mem); }
    setMode('planner', 'rollback');
    await assert.rejects(F.writeJson(plan, {}), (e) => e.code === 'read_only');
    F.setRemote(null);
  } finally { Object.assign(process.env, env0); for (const [k, v] of Object.entries(env0)) if (v === undefined) delete process.env[k]; rmSync(dir, { recursive: true, force: true }); }
});

// ── 8. optional: the same scenario against a live axf-data (`--http <url>`, token in AXF_DATA_TOKEN; empty store) ────
const httpAt = process.argv.indexOf('--http');
if (httpAt > 0) {
  const url = process.argv[httpAt + 1];
  await t(`live axf-data at ${url} answers the contract`, async () => {
    const live = await scenario(D.httpBackend({ url, token: process.env.AXF_DATA_TOKEN || '' }));
    // Clocks, actors and the store's own counters differ; codes and revs must not.
    for (const s of mem.steps) {
      const got = live.steps.find((x) => x.name === s.name)?.v;
      if (typeof s.v === 'string') assert.equal(got, s.v, `${s.name}: ${got} ≠ ${s.v}`);
      else if (s.v && typeof s.v === 'object' && 'rev' in s.v && s.v.$axf === 'data-record@1') { assert.equal(got?.rev, s.v.rev, `${s.name}: rev`); if (s.v.kind !== 'journal') assert.equal(got?.etag, s.v.etag, `${s.name}: etag (canonical JSON / bytes hash alike)`); }
    }
  });
}

console.log(`data-store@1: ${n} checks ok${WRITE ? ' (fixtures written)' : ''}`);

#!/usr/bin/env node
/**
 * builds-data — the builds store's move onto axf-data's Postgres tables (urgent-all-data-to-postgres-builds-store, s2).
 *
 *   node framework/cli/builds-data.mjs status                 where the store and the journal are (key modes, local vs remote,
 *                                                             rows per table when the token may read them)
 *   node framework/cli/builds-data.mjs cutover [--apply] [--no-flip]
 *                                                             copy the live store (one put) and every hub journal part (only the
 *                                                             lines axf-data lacks, the overlap compared line by line), verify
 *                                                             counts, then flip `builds/store.json` and `builds/journal/` to
 *                                                             cutover under the store lock. Without --apply: report only.
 *                                                             --no-flip: copy and verify, leave the keys local. The flip is only
 *                                                             safe once every writer on the machine runs code that reads key-level
 *                                                             modes (this build merged into main and deployed): an older writer
 *                                                             would keep writing the file while newer ones write axf-data.
 *   node framework/cli/builds-data.mjs local [--apply]        back to the files: the remote store is written to the local file
 *                                                             and the remote journal lines the hub lacks are appended, then the
 *                                                             two keys go back to local (the namespace is untouched).
 *   --json on any command. --url / --token override AXF_DATA_URL / AXF_DATA_TOKEN (the cut needs the cli token: it reads
 *   `_meta/tables` for the row counts and publishes the mode document). --store <file> names the store file to copy and
 *   lock (default: this checkout's; on the VPS the console's live file is /opt/axf/_claude/builds/store.json).
 *
 * Why keys and not the namespace: `builds` also holds pipeline state, reconcile journals, shipped manifests, reports and
 * progress files that other steps move later (framework/spec/DATA-INVENTORY.md). data-store-mode@1 key overrides move the
 * store and its journal first without touching them.
 *
 * Verification before the flip (all under the store lock, so nothing changes meanwhile):
 *   store    canonical(remote record) == canonical(local compact store); builds, steps and notes counted on both sides, and
 *            against the `builds`, `build_steps`, `build_notes` rows when `_meta/tables` is readable
 *   journal  for every part: remote entries ≥ local lines, and every local line equals the remote entry at its position
 *            (oversized entries are compared through their builds/journal-large record)
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../plan/builds-store-core.mjs';
import * as files from '../core/data-files.mjs';
import { DataStoreError, LIMITS, canonical, createDataStore, httpBackend } from '../core/data-store.mjs';
import * as MODE from '../core/data-store-mode.mjs';
import { journalDir, journalPartText, journalParts, readStoreNow, storeFile, storeText, withStoreLock } from './builds-store.mjs';
import { publish, readState, writeState } from './data-mode.mjs';

export const NS = 'builds';
export const STORE_KEY = 'builds/store.json';
export const KEYS = ['store.json', 'journal/'];
const ENTRY_MAX = LIMITS.entryBytes || 256 * 1024;
const APPEND_MAX = (LIMITS.appendBytes || 4 * 1024 * 1024) - 64 * 1024;

const nowIso = () => new Date().toISOString();
const counts = (store) => ({ builds: store.builds.length, steps: store.builds.reduce((n, b) => n + (b.steps?.length || 0), 0), notes: store.builds.reduce((n, b) => n + (b.notes?.length || 0), 0) });
const partKey = (part) => `${NS}/journal/${part}`;

/** The remote entries of one journal part, in order (large pointers resolved for comparison). */
async function remoteEntries(store, part, { resolveLarge = true } = {}) {
  const out = []; let since = 0;
  for (;;) {
    let r; try { r = await store.read(partKey(part), { since, limit: 5000 }); } catch (e) { if (e.code === 'not_found') return out; throw e; }
    for (const x of r.entries) { let e = x.entry; if (resolveLarge && e && e.large) { const big = await store.get(e.large); if (big) e = big.data; } out.push(e); }
    if (!r.next) break; since = r.next;
  }
  return out;
}
const localLines = (part) => journalPartText(part).split('\n').filter((l) => l.trim());

/**
 * One part: every local line must be on axf-data (as a set: a hub part is the merged union of several copies, so its
 * line order can differ from the copy axf-data took earlier while the lines are the same; readers order by rev). Lines
 * axf-data lacks are appended (apply); lines only axf-data has are counted and kept (a journal is never cut).
 */
async function syncPart(store, part, { apply, log }) {
  const lines = localLines(part);
  const remote = await remoteEntries(store, part);
  const rep = { part, local: lines.length, remote: remote.length, shared: 0, extraRemote: 0, mismatch: null, appended: 0, large: 0 };
  const have = new Set(remote.map((e) => canonical(e)));
  const mine = new Set();
  const missing = [];
  for (let i = 0; i < lines.length; i += 1) {
    let e; try { e = JSON.parse(lines[i]); } catch { rep.mismatch = `local line ${i + 1} is not JSON`; return rep; }
    const c = canonical(e); mine.add(c);
    if (have.has(c)) rep.shared += 1; else missing.push(e);
  }
  rep.extraRemote = remote.filter((e) => !mine.has(canonical(e))).length;
  if (!missing.length || !apply) { rep.pending = missing.length; return rep; }
  // append what is missing in batches under the append limit; an oversized entry goes as a journal-large record plus a pointer
  let batch = []; let bytes = 0; let first = remote.length + 1;
  const flush = async () => {
    if (!batch.length) return;
    await store.append(partKey(part), batch, { idempotencyKey: `builds-data-${part}-${first}` });
    rep.appended += batch.length; first += batch.length; batch = []; bytes = 0;
    log(`  ${part}: ${rep.appended}/${missing.length} appended`);
  };
  for (let e of missing) {
    const size = Buffer.byteLength(canonical(e));
    if (size > ENTRY_MAX) {
      const big = `${NS}/journal-large/${e.rev}-${String(e.at || '').replace(/[^0-9]/g, '')}.json`;
      try { await store.put(big, e, { create: true }); } catch (err) { if (err.code !== 'exists') throw err; }
      e = { rev: e.rev, at: e.at, by: e.by, action: e.action, large: big }; rep.large += 1;
    }
    const sz = Buffer.byteLength(canonical(e)) + 1;
    if (bytes + sz > APPEND_MAX) await flush();
    batch.push(e); bytes += sz;
  }
  await flush();
  return rep;
}

/** data-tables@1 (`GET /v1/_meta/tables`: rows per Postgres table), or null when the token may not read `_meta` (or no tables: SQLite, tests). */
async function tables(store) {
  try { const r = await store.backend.get('_meta', 'tables'); const t = JSON.parse(new TextDecoder().decode(r.bytes)); return Array.isArray(t.tables) ? t : null; }
  catch (e) { if (['forbidden', 'unauthorized', 'invalid_key', 'not_found', 'invalid_body'].includes(e.code)) return null; throw e; }
}
/** How many entries axf-data holds for one journal part (0 when it has none). */
async function remoteCount(store, part) {
  try { return (await store.read(partKey(part), { tail: 1 })).entries.at(-1)?.seq || 0; } catch (e) { if (e.code === 'not_found') return 0; throw e; }
}

export async function status({ store = files.remoteStore(), file = storeFile() } = {}) {
  const state = readState();
  const modes = Object.fromEntries(KEYS.map((k) => [k, MODE.modeOf(state, NS, k.endsWith('/') ? `${k}x` : k)]));
  const local = core.normalizeStore(JSON.parse(readFileSync(file, 'utf8')));
  const out = { $axf: 'builds-data-status@1', at: nowIso(), modes, local: { file, rev: local.rev, ...counts(local) }, remote: null, journal: [], tables: null };
  if (store) {
    const rec = await store.get(STORE_KEY);
    if (rec) { const rs = core.normalizeStore(rec.data); out.remote = { rev: rec.rev, etag: rec.etag, at: rec.at, storeRev: rs.rev, ...counts(rs), equal: canonical(rec.data) === canonical(JSON.parse(storeText(local))) }; }
    for (const part of Object.keys(journalParts()).sort()) out.journal.push({ part, local: localLines(part).length, remote: await remoteCount(store, part) });
    const t = await tables(store);
    if (t) out.tables = Object.fromEntries((t.tables || []).filter((x) => ['builds', 'build_steps', 'build_notes', 'journal', 'store_heads'].includes(x.name)).map((x) => [x.name, x.rows]));
    out.engine = t?.engine || '';
  }
  return out;
}

/**
 * The cut: under the store lock, put the store (when it differs), sync every journal part, verify, flip the keys.
 * Returns the report; `ok` is false when anything did not verify (nothing flipped then).
 */
export async function cutover({ store = files.remoteStore(), apply = false, flip = true, by = 'svc:cli', log = () => {}, file = storeFile() } = {}) {
  if (!store) throw new DataStoreError('unavailable', 'axf-data is not configured (AXF_DATA_URL / --url)');
  const at = nowIso();
  const report = { $axf: 'builds-data-cutover@1', at, apply, flip, ok: false, store: null, journal: [], counts: null, tables: null, flipped: [], problems: [] };
  const run = async () => {
    const localStore = core.normalizeStore(JSON.parse(readFileSync(file, 'utf8')));
    const localDoc = JSON.parse(storeText(localStore));
    report.file = file;
    const want = canonical(localDoc);
    let rec = await store.get(STORE_KEY);
    const same = rec && canonical(rec.data) === want;
    report.store = { localRev: localStore.rev, remoteRev: rec?.rev ?? null, remoteStoreRev: rec ? core.normalizeStore(rec.data).rev : null, same: !!same, written: false };
    if (!same && apply) {
      log(`store: ${rec ? `remote rev ${rec.rev} differs` : 'not on axf-data yet'}: writing ${Math.round(want.length / 1e6)} MB`);
      await store.put(STORE_KEY, localDoc, rec ? { ifMatch: rec.etag } : { create: true });
      rec = await store.get(STORE_KEY);
      report.store.written = true;
      report.store.same = canonical(rec.data) === want;
    }
    if (!report.store.same) report.problems.push(apply ? 'the store on axf-data does not read back equal to the local file' : 'the store on axf-data differs from the local file (--apply writes it)');
    for (const part of Object.keys(journalParts()).sort()) {
      const r = await syncPart(store, part, { apply, log });
      report.journal.push(r);
      if (r.mismatch) report.problems.push(`journal ${part}: ${r.mismatch}`);
      else if (r.pending) report.problems.push(`journal ${part}: ${r.pending} line(s) not on axf-data yet${apply ? '' : ' (--apply appends them)'}`);
      else if (r.extraRemote) log(`  ${part}: axf-data has ${r.extraRemote} line(s) the hub lacks (kept: a journal is never cut)`);
    }
    const remoteStore = rec ? core.normalizeStore(rec.data) : null;
    report.counts = { local: counts(localStore), remote: remoteStore ? counts(remoteStore) : null };
    if (remoteStore && JSON.stringify(report.counts.local) !== JSON.stringify(report.counts.remote)) report.problems.push(`counts differ: local ${JSON.stringify(report.counts.local)}, axf-data ${JSON.stringify(report.counts.remote)}`);
    const t = await tables(store);
    if (t) {
      const rows = Object.fromEntries((t.tables || []).map((x) => [x.name, x.rows]));
      report.tables = { engine: t.engine, builds: rows.builds ?? null, build_steps: rows.build_steps ?? null, build_notes: rows.build_notes ?? null };
      if (t.engine === 'postgres' || t.engine === 'shadow') {
        for (const [table, k] of [['builds', 'builds'], ['build_steps', 'steps'], ['build_notes', 'notes']]) if (rows[table] !== undefined && rows[table] !== report.counts.local[k]) report.problems.push(`${table} has ${rows[table]} rows, the store has ${report.counts.local[k]} ${k}${t.engine === 'shadow' ? ' (engine in shadow: rows are the mirror)' : ''}`);
      }
    }
    report.ok = !report.problems.length;
    if (!apply || !report.ok || !flip) return;
    let state = readState();
    const verified = { at: nowIso(), how: 'builds-data cutover: store record equal, every hub journal line on axf-data, counts equal', counts: report.counts.local, journal: report.journal.map((j) => ({ part: j.part, lines: j.remote + j.appended })), tables: report.tables };
    const changes = [];
    for (const k of KEYS) { if (MODE.modeOf(state, NS, k.endsWith('/') ? `${k}x` : k) === 'cutover') continue; const r = MODE.transitionKey(state, { ns: NS, path: k, to: 'cutover', at: nowIso(), by, verified }); state = r.state; changes.push(...r.changes); }
    writeState(state);
    report.flipped = changes.map((c) => `${c.ns}/${c.key}: ${c.from} → ${c.to}`);
    try { await publish(store, state, changes, by); report.published = true; } catch (e) { report.published = false; report.publishError = `${e.code || 'error'}: ${e.message}`; }
  };
  // the bulk of the journal (gigabytes) is copied before the lock, so writers wait seconds, not minutes; under the lock only
  // the tail written meanwhile is appended and every part is checked again
  if (apply) {
    for (const part of Object.keys(journalParts()).sort()) {
      const r = await syncPart(store, part, { apply, log });
      if (r.mismatch) { report.journal.push(r); report.problems.push(`journal ${part}: ${r.mismatch}`); report.ok = false; return report; }
      report.prepass = [...(report.prepass || []), { part: r.part, appended: r.appended, large: r.large }];
    }
  }
  // hold the store lock for the check and the flip: no local writer can change the file or the journal meanwhile. The lock
  // file's mtime is refreshed while held (builds-store treats a lock older than 30 s as a dead writer's and removes it).
  const keep = setInterval(() => { try { const now = new Date(); utimesSync(`${file}.lock`, now, now); } catch { /* lock gone */ } }, 10000);
  try { await withStoreLock(() => run(), 60000, file); } finally { clearInterval(keep); }
  return report;
}

/** Back to the files: remote → local file and hub journal, then the keys go local. */
export async function toLocal({ store = files.remoteStore(), apply = false, by = 'svc:cli', log = () => {}, file = storeFile() } = {}) {
  if (!store) throw new DataStoreError('unavailable', 'axf-data is not configured (AXF_DATA_URL / --url)');
  const report = { $axf: 'builds-data-local@1', at: nowIso(), apply, ok: false, store: null, journal: [], flipped: [], problems: [] };
  await withStoreLock(async () => {
    const rec = await store.get(STORE_KEY);
    if (!rec) { report.problems.push('no store on axf-data'); return; }
    const text = storeText(core.normalizeStore(rec.data));
    const f = file;
    report.store = { remoteRev: rec.rev, bytes: text.length, written: false };
    if (apply) { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, text); renameSync(tmp, f); report.store.written = true; }
    let after = '';
    const parts = new Set(Object.keys(journalParts()));
    for (;;) { const l = await store.list(NS, { prefix: 'journal/', after }); for (const i of l.items) if (i.kind === 'journal') parts.add(i.path.slice('journal/'.length)); if (!l.next) break; after = l.next; }
    for (const part of [...parts].sort()) {
      const lines = localLines(part); const remote = await remoteEntries(store, part);
      const r = { part, local: lines.length, remote: remote.length, appended: 0 };
      const extra = remote.slice(lines.length);
      if (extra.length && apply) { const d = journalDir(); mkdirSync(d, { recursive: true }); appendFileSync(join(d, `${part}.jsonl`), extra.map((e) => `${JSON.stringify(e)}\n`).join('')); r.appended = extra.length; log(`  ${part}: ${extra.length} line(s) appended to the hub`); }
      else r.pending = extra.length;
      report.journal.push(r);
    }
    report.ok = true;
    if (!apply) return;
    let state = readState(); const changes = [];
    for (const k of KEYS) { if (MODE.modeOf(state, NS, k.endsWith('/') ? `${k}x` : k) === 'local') continue; const r = MODE.transitionKey(state, { ns: NS, path: k, to: 'local', at: nowIso(), by }); state = r.state; changes.push(...r.changes); }
    writeState(state);
    report.flipped = changes.map((c) => `${c.ns}/${c.key}: ${c.from} → ${c.to}`);
    try { await publish(store, state, changes, by); } catch (e) { report.publishError = `${e.code || 'error'}: ${e.message}`; }
  }, 60000, file);
  return report;
}
// (toLocal holds the lock briefly: one record and the journal tails; no mtime refresh needed)

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (k) => { const i = args.indexOf(`--${k}`); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, v && !v.startsWith('--') ? 2 : 1); return v && !v.startsWith('--') ? v : true; };
  const json = !!flag('json'); const apply = !!flag('apply'); const noFlip = !!flag('no-flip'); const url = flag('url'); const token = flag('token'); const by = flag('by'); const storeArg = flag('store'); const file = typeof storeArg === 'string' ? resolve(storeArg) : storeFile();
  const cmd = ['status', 'cutover', 'local'].includes(args[0]) ? args.shift() : 'status';
  const store = typeof url === 'string' ? createDataStore({ backend: httpBackend({ url, token: typeof token === 'string' ? token : process.env.AXF_DATA_TOKEN || '' }), by: 'svc:cli' }) : files.remoteStore();
  const log = json ? () => {} : (m) => console.error(m);
  try {
    const r = cmd === 'status' ? await status({ store, file }) : cmd === 'cutover' ? await cutover({ store, apply, flip: !noFlip, by: typeof by === 'string' ? by : 'svc:cli', log, file }) : await toLocal({ store, apply, by: typeof by === 'string' ? by : 'svc:cli', log, file });
    if (json) console.log(JSON.stringify(r, null, 1));
    else if (cmd === 'status') {
      console.log(`modes: ${Object.entries(r.modes).map(([k, m]) => `${k} ${m}`).join(', ')}${r.engine ? `; engine ${r.engine}` : ''}`);
      console.log(`local  rev ${r.local.rev}: ${r.local.builds} builds, ${r.local.steps} steps, ${r.local.notes} notes (${r.local.file})`);
      console.log(r.remote ? `remote rev ${r.remote.storeRev} (record rev ${r.remote.rev}, ${r.remote.at}): ${r.remote.builds} builds, ${r.remote.steps} steps, ${r.remote.notes} notes${r.remote.equal ? ', equal to local' : ', DIFFERS from local'}` : 'remote: none');
      if (r.tables) console.log(`rows: ${Object.entries(r.tables).map(([k, v]) => `${k} ${v}`).join(', ')}`);
      for (const j of r.journal) console.log(`  journal ${j.part.padEnd(12)} local ${String(j.local).padStart(5)}  remote ${String(j.remote).padStart(5)}`);
    } else {
      console.log(`${r.ok ? (apply ? 'done' : 'ready') : 'NOT ok'}${r.store ? `; store ${r.store.same === false ? 'differs' : r.store.written ? 'written' : 'equal'}` : ''}`);
      for (const j of r.journal) console.log(`  ${j.part.padEnd(12)} local ${String(j.local).padStart(5)} remote ${String(j.remote).padStart(5)}${j.shared !== undefined ? ` shared ${j.shared}` : ''}${j.extraRemote ? ` remote-only ${j.extraRemote}` : ''}${j.appended ? ` appended ${j.appended}` : ''}${j.large ? ` (${j.large} large)` : ''}${j.pending ? ` pending ${j.pending}` : ''}${j.mismatch ? ` MISMATCH ${j.mismatch}` : ''}`);
      if (r.counts) console.log(`counts: local ${JSON.stringify(r.counts.local)}${r.counts.remote ? ` remote ${JSON.stringify(r.counts.remote)}` : ''}${r.tables ? ` rows ${JSON.stringify(r.tables)}` : ''}`);
      for (const p of r.problems) console.log(`✗ ${p}`);
      for (const f of r.flipped) console.log(`→ ${f}`);
      if (r.publishError) console.log(`(mode document not published to axf-data: ${r.publishError}; the local mode file is what every client reads)`);
    }
    process.exit(r.ok ? 0 : 1);
  } catch (e) { console.error(`builds-data: ${e.code || 'error'}: ${e.message}`); process.exit(1); }
}

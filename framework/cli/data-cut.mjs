#!/usr/bin/env node
/**
 * data-cut — move groups of data-store@1 keys onto axf-data's Postgres rows: backfill, verify, cut over (build
 * postgres-part-c-console-state-settings; inventory framework/spec/DATA-INVENTORY.md; groups framework/schemas/data-cut.json).
 *
 *   node framework/cli/data-cut.mjs groups                         the groups and their entries (key / prefix, table, flip, why)
 *   node framework/cli/data-cut.mjs status [<group>…]              per entry: its mode, local keys, how many are equal on axf-data
 *   node framework/cli/data-cut.mjs copy <group>… [--apply]        backfill: every local key whose content differs is written
 *                                                                  to axf-data (a journal gets only the lines it lacks). Without
 *                                                                  --apply: what would be copied
 *   node framework/cli/data-cut.mjs verify <group>…                every local key equal on axf-data (content read back from its
 *                                                                  rows), plus rows per table from `_meta/tables`
 *   node framework/cli/data-cut.mjs cutover <group>… [--apply] [--no-flip]
 *                                                                  copy, verify, then flip the entries with flip: true to key-level
 *                                                                  cutover (data-store-mode@1 keys, `verified` kept on each), wait for
 *                                                                  writers to see the mode, and push any write that landed on the
 *                                                                  file in between. Refuses to flip anything if a key differs
 *   node framework/cli/data-cut.mjs sync [<group>…]                keep the flip: false entries equal on axf-data (cron): copy only
 *   node framework/cli/data-cut.mjs local <group>… [--apply]       back to the files: each cut key's axf-data body is written to its
 *                                                                  file, then its override goes back to local
 *   --all (every group) · --json · --url / --token (default AXF_DATA_URL / AXF_DATA_TOKEN, else the host env file) · --by
 *
 * Same verbs from the console (REST /api/plugins/data-store/cut…), MCP (data-store plugin commands `cuts`, `cut`), voice
 * ("what's left to cut over", "cut the console state over"). Exit 1 when a check fails.
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, createDataStore, httpBackend, journalEtag } from '../core/data-store.mjs';
import * as files from '../core/data-files.mjs';
import * as MODE from '../core/data-store-mode.mjs';
import { copyOne, scan, sourceItem, sqliteRows } from './data-migrate.mjs';
import { publish, readState, writeState } from './data-mode.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const SPEC = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/data-cut.json'), 'utf8'));
const nowIso = () => new Date().toISOString();
const SETTLE_MS = Number(process.env.AXF_DATA_CUT_SETTLE_MS ?? 3000);

export const entryOf = (e) => e.key || e.prefix;
export const matches = (e, key) => (e.key ? key === e.key : key.startsWith(e.prefix));
const ALL_ENTRIES = Object.values(SPEC.groups).flatMap((g) => g.entries);
/** The entry that owns a key across every group: an exact key, else the longest matching prefix (so `plugins/` is a catch-all). */
export function ownerOf(key) {
  let best = null;
  for (const e of ALL_ENTRIES) {
    if (!matches(e, key)) continue;
    const score = e.key ? Infinity : e.prefix.length;
    if (!best || score > best.score) best = { e, score };
  }
  return best ? best.e : null;
}
const owns = (e, key) => ownerOf(key) === e;
/** The namespace id and the key-level override path an entry flips (relative to the namespace id). */
export function overrideOf(e) {
  const k = entryOf(e);
  const nsid = files.nsIdOf(e.key || `${e.prefix}x`);
  return { nsid, path: k.slice(nsid.length + 1) };
}
export function groupsOf(names, all) {
  const known = Object.keys(SPEC.groups);
  const want = all || !names.length ? known : names;
  for (const g of want) if (!SPEC.groups[g]) throw Object.assign(new Error(`no group "${g}" (groups: ${known.join(', ')})`), { code: 'invalid_args' });
  return want.map((g) => ({ id: g, ...SPEC.groups[g] }));
}

/** Local items of a group (data-migrate's scan + sourceItem), each tagged with its entry. */
export function localOf(group, scanned = scan()) {
  const out = [];
  for (const s of scanned.mapped) {
    const e = group.entries.find((x) => owns(x, s.key));
    if (!e) continue;
    // over the blob limit (chats.db): never read or snapshotted here; its rows come from mirror_sync
    let size = 0; try { size = statSync(s.file).size; } catch { continue; }
    if (size > LIMITS.blobBytes) { out.push({ ...s, kind: 'blob', local: `${size} bytes, over the ${LIMITS.blobBytes}-byte blob limit: stays local (rows by mirror_sync)`, notes: [], entry: entryOf(e) }); continue; }
    const it = sourceItem(s);
    if (it.vanished) continue;
    for (const x of [it, ...(it.extras || [])]) out.push({ ...x, entry: entryOf(e) });
  }
  return out;
}

/** axf-data's side of an entry: key → { kind, etag (rev-1 form), entries?, list? }. */
async function remoteOf(store, e) {
  const k = entryOf(e); const [head, ...rest] = k.split('/'); const prefix = rest.join('/');
  const out = new Map(); let after = '';
  for (;;) {
    let l; try { l = await store.list(head, { prefix, after }); } catch (err) { if (err.code === 'not_found') break; throw err; }
    for (const i of l.items) {
      const key = `${head}/${i.path}`;
      if (!owns(e, key)) continue;
      if (i.kind === 'journal') {
        const list = []; let since = 0;
        for (;;) { const r = await store.read(key, { since }); list.push(...r.entries.map((x) => x.entry)); if (!r.next) break; since = r.next; }
        out.set(key, { kind: 'journal', etag: journalEtag(list), entries: list.length, list });
      } else out.set(key, { kind: i.kind, etag: `1-${String(i.etag).split('-')[1]}`, size: i.size });
    }
    if (!l.next) break; after = l.next;
  }
  return out;
}

/** data-tables@1 rows per table, or null when the token may not read `_meta`. */
async function tableRows(store) {
  try { const r = await store.backend.get('_meta', 'tables'); const t = JSON.parse(new TextDecoder().decode(r.bytes)); return Object.fromEntries((t.tables || []).map((x) => [x.name, x.rows])); }
  catch (e) { if (['forbidden', 'unauthorized', 'invalid_key', 'not_found', 'invalid_body'].includes(e.code)) return null; throw e; }
}

const same = (it, r) => !!r && r.etag === it.item.etag;
const SQLITE = /\.(sqlite|db)$/i;
/**
 * A SQLite file is compared by its rows, not its bytes (the plugin uploads a VACUUM INTO copy, the scan a backup-API
 * snapshot: same rows, different pages): every table's row count in the local file against its mirrored `<prefix>_<table>`
 * rows on axf-data (entry.table = '<prefix>_*'). Unknown (no _meta read, no python3) counts as different.
 */
async function sqliteSame(store, e, it) {
  const local = sqliteRows(it.file);
  const rows = await tableRows(store);
  const prefix = String(e.table || '').replace(/_\*$/, '');
  if (!local || !rows || !prefix) return { same: false, local, remote: null };
  const remote = Object.fromEntries(Object.keys(local).map((t) => [t, rows[`${prefix}_${t.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`]]));
  const keys = Object.keys(local);
  return { same: keys.every((t) => remote[t] === local[t]), ahead: keys.every((t) => (remote[t] ?? -1) >= local[t]) && keys.some((t) => remote[t] > local[t]), local, remote };
}

/** Compare one group: per entry, local keys, equal, differing, missing, journals behind. */
async function compare(store, group, items) {
  const state = readState();
  const entries = [];
  for (const e of group.entries) {
    const mine = items.filter((i) => i.entry === entryOf(e) && !i.local);
    const remote = await remoteOf(store, e);
    const rep = { entry: entryOf(e), table: e.table || '', flip: !!e.flip, why: e.why || '', mode: MODE.modeOf(state, overrideOf(e).nsid, overrideOf(e).path.endsWith('/') ? `${overrideOf(e).path}x` : overrideOf(e).path),
      local: mine.length, equal: 0, differ: [], missing: [], errors: [], remoteOnly: 0, stayLocal: items.filter((i) => i.entry === entryOf(e) && i.local).map((i) => ({ key: i.key, why: i.local })) };
    for (const it of mine) {
      if (it.error) { rep.errors.push({ key: it.key, error: it.error }); continue; }
      const r = remote.get(it.key);
      if (!r) rep.missing.push(it.key);
      else if (same(it, r) || (SQLITE.test(it.key) && (await sqliteSame(store, e, it)).same)) rep.equal += 1;
      else rep.differ.push(it.key);
      remote.delete(it.key);
    }
    rep.remoteOnly = remote.size;
    rep.ok = !rep.differ.length && !rep.missing.length && !rep.errors.length;
    entries.push(rep);
  }
  return entries;
}

async function copyGroup(store, group, items, { apply, only = () => true, log = () => {} }) {
  const done = [];
  for (const e of group.entries) {
    if (!only(e)) continue;
    const remote = await remoteOf(store, e);
    for (const it of items.filter((i) => i.entry === entryOf(e) && !i.local && !i.error)) {
      const have = remote.get(it.key);
      if (same(it, have)) continue;
      // a key already cut over is axf-data's: its file is the read-only copy and is never written back over it
      if (files.modeOf(it.key) === 'cutover' || files.modeOf(it.key) === 'rollback') continue;
      if (have && SQLITE.test(it.key)) {
        const c = await sqliteSame(store, e, it);
        if (c.same) continue;
        // axf-data holds more rows than this file in every table it differs: a writer uploaded after the scan; never overwrite it
        if (c.ahead) { done.push({ key: it.key, op: 'remote-ahead', why: 'axf-data has more rows than the local file (a newer upload): kept' }); continue; }
      }
      if (!apply) { done.push({ key: it.key, op: have ? 'would-update' : 'would-create' }); continue; }
      if (SQLITE.test(it.key)) {  // a blob-sqlite file: the newest copy wins whole (the plugin's own sqlite_upload does the same)
        try { await store.put(it.key, it.bytes, { force: true, contentType: 'application/vnd.sqlite3' }); done.push({ key: it.key, op: have ? 'updated' : 'created' }); log(`  ${have ? 'updated' : 'created'}   ${it.key}`); }
        catch (err) { done.push({ key: it.key, op: 'failed', why: `${err.code || 'error'}: ${err.message}` }); }
        continue;
      }
      try { const r = await copyOne(store, it, have ? { ...have, etag: have.etag } : null); done.push(r); if (r.op !== 'same') log(`  ${r.op.padEnd(9)} ${it.key}`); }
      catch (err) { done.push({ key: it.key, op: 'failed', why: `${err.code || 'error'}: ${err.message}` }); }
    }
  }
  return done;
}

export async function run({ cmd = 'status', groups: names = [], all = false, apply = false, flip = true, store = null, by = 'svc:cli', log = () => {} } = {}) {
  if (cmd === 'groups') return { $axf: 'data-cut-groups@1', groups: groupsOf([], true) };
  const groups = groupsOf(names, all || (['status', 'sync'].includes(cmd) && !names.length));
  if (!store) throw Object.assign(new Error('axf-data is not configured here (AXF_DATA_URL / --url, or the host env file)'), { code: 'unavailable' });
  const report = { $axf: 'data-cut-report@1', cmd, at: nowIso(), apply, groups: [], flipped: [], problems: [] };
  const scanned = scan();
  for (const g of groups) {
    const items = localOf(g, scanned);
    const gr = { id: g.id, title: g.title, step: g.step || '' };
    if (cmd === 'copy' || cmd === 'cutover' || cmd === 'sync') {
      const only = cmd === 'sync' ? (e) => { const o = overrideOf(e); return MODE.modeOf(readState(), o.nsid, o.path.endsWith('/') ? `${o.path}x` : o.path) !== 'cutover'; } : () => true;
      gr.copied = await copyGroup(store, g, items, { apply: apply || cmd === 'sync', only, log });
      for (const c of gr.copied.filter((x) => x.op === 'failed' || x.op === 'mismatch')) report.problems.push(`${c.key}: ${c.op} ${c.why || ''}`.trim());
    }
    if (cmd !== 'local') gr.entries = await compare(store, g, items);
    if (cmd === 'verify' || cmd === 'cutover') for (const e of gr.entries) {
      if (e.differ.length) report.problems.push(`${e.entry}: ${e.differ.length} key(s) differ (${e.differ.slice(0, 3).join(', ')})`);
      if (e.missing.length) report.problems.push(`${e.entry}: ${e.missing.length} key(s) missing on axf-data (${e.missing.slice(0, 3).join(', ')})`);
      for (const x of e.errors) report.problems.push(`${x.key}: ${x.error}`);
    }
    if (cmd === 'cutover' && apply && flip && !report.problems.length) {
      const rows = await tableRows(store);
      let state = readState(); const changes = [];
      const flips = g.entries.filter((e) => e.flip);
      for (const e of flips) {
        const o = overrideOf(e);
        if (MODE.modeOf(state, o.nsid, o.path.endsWith('/') ? `${o.path}x` : o.path) === 'cutover') continue;
        const rep = gr.entries.find((x) => x.entry === entryOf(e));
        const verified = { at: nowIso(), how: 'data-cut: every local key equal on axf-data (content read back from its rows)', counts: { keys: rep.local, equal: rep.equal, ...(rows && e.table ? { rows: rows[e.table] ?? 0, table: e.table } : {}) } };
        const r = MODE.transitionKey(state, { ns: o.nsid, path: o.path, to: 'cutover', at: nowIso(), by, verified });
        state = r.state; changes.push(...r.changes);
      }
      if (changes.length) {
        writeState(state);
        try { await publish(store, state, changes, by); } catch (err) { report.publishError = `${err.code || 'error'}: ${err.message}`; }
        report.flipped.push(...changes.map((c) => `${c.ns}/${c.key}: ${c.from} → ${c.to}`));
        // writers re-read the mode file within 2 s; anything one wrote to the file before it saw the flip is pushed now
        await new Promise((r) => setTimeout(r, SETTLE_MS));
        const late = localOf({ ...g, entries: flips }, scan());
        const pushed = [];
        for (const e of flips) {
          const remote = await remoteOf(store, e);
          for (const it of late.filter((i) => i.entry === entryOf(e) && !i.local && !i.error)) {
            const have = remote.get(it.key);
            if (same(it, have)) continue;
            if (it.kind === 'record') { const cur = await store.get(it.key); await store.put(it.key, it.data, cur ? { ifMatch: cur.etag } : { create: true }); pushed.push(it.key); }
            else if (it.kind === 'journal') { const r = await copyOne(store, it, have); if (r.op !== 'mismatch') pushed.push(it.key); }
          }
        }
        gr.settled = pushed;
      }
    }
    if (cmd === 'local' && apply) {
      let state = readState(); const changes = [];
      gr.restored = [];
      for (const e of g.entries.filter((x) => x.flip)) {
        const o = overrideOf(e);
        if (MODE.modeOf(state, o.nsid, o.path.endsWith('/') ? `${o.path}x` : o.path) === 'local') continue;
        const remote = await remoteOf(store, e);
        for (const [key, r] of remote) {
          const file = files.pathForKey(key); if (!file) { report.problems.push(`${key}: no local file maps to it (kept on axf-data)`); continue; }
          let text;
          if (r.kind === 'journal') text = r.list.map((x) => JSON.stringify(x)).join('\n') + (r.list.length ? '\n' : '');
          else { const rec = await store.get(key); if (!rec) continue; text = r.kind === 'record' ? `${JSON.stringify(rec.data, null, 2)}\n` : Buffer.from(rec.data); }
          mkdirSync(dirname(file), { recursive: true });
          const tmp = `${file}.data-cut-${process.pid}`; writeFileSync(tmp, text); renameSync(tmp, file);
          gr.restored.push(key);
        }
        const t = MODE.transitionKey(state, { ns: o.nsid, path: o.path, to: 'local', at: nowIso(), by });
        state = t.state; changes.push(...t.changes);
      }
      if (changes.length) {
        writeState(state);
        try { await publish(store, state, changes, by); } catch (err) { report.publishError = `${err.code || 'error'}: ${err.message}`; }
        report.flipped.push(...changes.map((c) => `${c.ns}/${c.key}: ${c.from} → ${c.to}`));
      }
    }
    report.groups.push(gr);
  }
  if (['verify', 'cutover', 'status'].includes(cmd)) report.tables = await tableRows(store);
  report.ok = !report.problems.length;
  return report;
}

function print(r) {
  if (r.$axf === 'data-cut-groups@1') {
    for (const g of r.groups) { console.log(`${g.id}  ${g.title}${g.step ? `  (${g.step})` : ''}`); for (const e of g.entries) console.log(`  ${e.flip ? 'flip' : 'sync'}  ${entryOf(e).padEnd(44)} → ${e.table || '—'}${e.why ? `  · ${e.why}` : ''}`); }
    return;
  }
  for (const g of r.groups) {
    console.log(`${g.id}: ${g.title}`);
    for (const c of (g.copied || []).filter((x) => x.op !== 'same')) console.log(`  ${c.op.padEnd(12)} ${c.key}${c.why ? `  ${c.why}` : ''}`);
    for (const e of g.entries || []) console.log(`  ${(e.ok ? '✓' : '✗')} ${e.mode.padEnd(7)} ${e.flip ? 'flip' : 'sync'} ${e.entry.padEnd(44)} local ${String(e.local).padStart(4)} equal ${String(e.equal).padStart(4)}${e.differ.length ? ` differ ${e.differ.length}` : ''}${e.missing.length ? ` missing ${e.missing.length}` : ''}${e.remoteOnly ? ` remote-only ${e.remoteOnly}` : ''}${e.table && r.tables ? `  ${e.table} ${r.tables[e.table] ?? '—'} rows` : ''}`);
    for (const k of g.settled || []) console.log(`  settled      ${k}`);
    for (const k of g.restored || []) console.log(`  restored     ${k}`);
  }
  for (const f of r.flipped) console.log(`→ ${f}`);
  for (const p of r.problems) console.log(`✗ ${p}`);
  if (r.publishError) console.log(`(mode document not published to axf-data: ${r.publishError}; the local mode file is what every client reads)`);
  console.log(r.ok ? (r.apply || r.cmd === 'sync' ? 'done' : 'ok') : 'NOT ok');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (k) => { const i = args.indexOf(`--${k}`); if (i < 0) return undefined; const v = args[i + 1]; const has = v !== undefined && !v.startsWith('--') && ['url', 'token', 'by'].includes(k); args.splice(i, has ? 2 : 1); return has ? v : true; };
  const json = !!flag('json'); const apply = !!flag('apply'); const noFlip = !!flag('no-flip'); const all = !!flag('all');
  const url = flag('url'); const token = flag('token'); const by = flag('by');
  const CMDS = ['groups', 'status', 'copy', 'verify', 'cutover', 'sync', 'local'];
  const cmd = CMDS.includes(args[0]) ? args.shift() : 'status';
  const store = typeof url === 'string' ? createDataStore({ backend: httpBackend({ url, token: typeof token === 'string' ? token : process.env.AXF_DATA_TOKEN || '' }), by: 'svc:cli' }) : files.remoteStore();
  try {
    const r = await run({ cmd, groups: args, all, apply, flip: !noFlip, store, by: typeof by === 'string' ? by : 'svc:cli', log: json ? () => {} : (m) => console.error(m) });
    if (json) console.log(JSON.stringify(r, null, 1)); else print(r);
    process.exit(r.ok === false ? 1 : 0);
  } catch (e) { console.error(`data-cut: ${e.code || 'error'}: ${e.message}`); process.exit(1); }
}

#!/usr/bin/env node
/**
 * migrate-json-leftovers — one shot: every JSON data file still on disk goes onto its axf-data key (its Postgres
 * table), is verified there, its namespace is put on Postgres only, and the file is deleted.
 *
 * Brett, Nov 25 2026: "Postgres is the one store. Delete every JSON data file the database already covers, plus every
 * reader and writer of it. No dual writes, no JSON backups."
 *
 *   node framework/cli/migrate-json-leftovers.mjs [--dry-run] [<ns>…]   (the default) what would move and be deleted,
 *                                                                       per namespace, from file sizes and line counts
 *                                                                       (contents are checked at --apply); nothing is
 *                                                                       read from or written to axf-data, nothing on
 *                                                                       disk changes
 *   node framework/cli/migrate-json-leftovers.mjs --apply [<ns>…]       move, verify, switch, delete
 *   node framework/cli/migrate-json-leftovers.mjs --check               the path map only: `store.mode` is cutover and
 *                                                                       every `to: null` rule has its reason (CI)
 *   --json  machine output · --url / --token  axf-data (default AXF_DATA_URL / AXF_DATA_TOKEN) · --by <who>
 *
 * What it takes: every `.json` (a record: one row per key) and `.jsonl` (a journal: one row per line) file under the four
 * roots of framework/schemas/data-store-paths.json that a rule maps to a key. Other kinds (Markdown, SQLite, images) are
 * data-migrate.mjs's; a path no rule maps, or mapped to null, is not data and is never touched. The pipeline folder
 * (`builds/pipeline/…`) is left alone: build pipeline-fixes-drop-7-mb-status-file removes it. A file git tracks in the
 * checkout (the builds store's published copy, shipped manifests, reports) is an export, not a leftover: it stays.
 *
 * Per namespace, in this order, and nothing later happens when a step fails:
 *   1 copy     key by key through data-store@1. A record whose canonical body is already there is skipped, else put with
 *              the rev check; a journal gets only the lines it lacks (its first lines must match: a journal is never
 *              rewritten, a difference is a mismatch). One call per row: no whole-namespace write.
 *   2 verify   every key read back: the same canonical record, the same number of journal lines and the same lines.
 *              rows moved = rows read back, or the namespace stops here and its files stay.
 *   3 switch   the namespace goes to cutover (data-store-mode@1): from shadow, or from local through shadow in the same
 *              instant, with the manifests compared by the guard. When the namespace also holds files this tool does not
 *              move, the verified keys are cut over one by one instead (at most MAX_KEY_CUTS; more: data-migrate first).
 *              There is no shadow left behind and no way back to the files.
 *   4 delete   each file whose key is now served from axf-data, after one more comparison (a writer still on the old
 *              code may have written the file since step 1: it is copied again first). No backup copy is made.
 *
 * Exit 0 = nothing left (or a clean dry run), 1 = something was refused (listed), 2 = usage.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, NAMESPACES, canonical, createDataStore, httpBackend } from '../core/data-store.mjs';
import * as MODE from '../core/data-store-mode.mjs';
import { kindOfKey, mapRel, nsIdOf, remoteStore, roots } from '../core/data-files.mjs';
import { manifestRemote, plan, scan } from './data-migrate.mjs';
import { publish, readState, writeState } from './data-mode.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PATHS_FILE = join(ROOT, 'framework/schemas/data-store-paths.json');
export const MAX_KEY_CUTS = 200;
/** Left alone whatever the map says: another build owns it. */
export const LEAVE = /^builds\/pipeline\//;
const SKIP_FILE = /(\.tmp(-\d+)?|\.tmp\.\d+|\.lock|\.running|\.pid|\.axf-etag|\.bak)$|\.tmp-\d+$|\/\.history-lock$/;
const SKIP_DIR = new Set(['node_modules', '.git', 'plugins', 'data-store', 'migration', 'tmp']);
const JSONISH = /\.(json|jsonl)$/i;
const utf8len = (s) => Buffer.byteLength(s, 'utf8');
const nowIso = () => new Date().toISOString();
const sigOf = (text) => createHash('sha256').update(text).digest('hex');

// ── the path map ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Problems with the map itself: the store mode, a null rule with no reason, a reason with no rule, an example that maps elsewhere. */
export function checkPaths(doc = JSON.parse(readFileSync(PATHS_FILE, 'utf8'))) {
  const problems = [];
  if (doc.store?.mode !== 'cutover') problems.push(`store.mode is "${doc.store?.mode ?? ''}": every mapped namespace is served from axf-data only (cutover)`);
  const reasons = doc.local?.rules ?? {};
  const nulls = new Set();
  for (const [root, rules] of Object.entries(doc.rules ?? {})) for (const r of rules) if (r.to === null) nulls.add(`${root}:${r.re}`);
  for (const id of nulls) if (!String(reasons[id] ?? '').trim()) problems.push(`${id} keeps a file local with no reason in local.rules`);
  for (const id of Object.keys(reasons)) if (!nulls.has(id)) problems.push(`local.rules names ${id}, which is not a \`to: null\` rule`);
  for (const [ex, want] of Object.entries(doc.examples ?? {})) {
    const i = ex.indexOf(':'); const got = mapRel(ex.slice(0, i), ex.slice(i + 1));
    if (got !== want) problems.push(`example ${ex} maps to ${got}, the map says ${want}`);
  }
  return problems;
}

// ── source: the JSON files a rule maps ────────────────────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  if (ents.some((e) => e.name === '.git')) return out; // a checkout inside a data folder is not data
  for (const e of ents) {
    if (e.isSymbolicLink()) continue;
    const f = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(f, out); } else if (e.isFile()) out.push(f);
  }
  return out;
}
function trackedIn(repo) {
  try { return new Set(execFileSync('git', ['-C', repo, 'ls-files', '-z', '--', '_claude/builds'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean)); }
  catch { return new Set(); } // not a git checkout: nothing is tracked
}
/**
 * Every leftover: { file, root, rel, key, ns, kind }. data-migrate's walk (plugins, the builds folder, the hub) plus the
 * console's own state folder, which it only reads two paths of.
 */
export function leftovers(env = process.env) {
  const r = roots(env);
  const seen = new Map();
  for (const m of scan(env).mapped) seen.set(m.file, m);
  // the console's state folder: its top-level files, and only the folders a rule can map (the rest is checkouts,
  // previews, APKs, backups: gigabytes that are not data)
  let top = []; try { top = readdirSync(r.data, { withFileTypes: true }); } catch { /* no state folder here */ }
  const files = [];
  for (const e of top) {
    if (e.isSymbolicLink() || SKIP_DIR.has(e.name)) continue;
    if (e.isFile()) files.push(join(r.data, e.name));
    else if (e.isDirectory() && (mapRel('data', `${e.name}/x.json`) || mapRel('data', `${e.name}/x/y.json`))) walk(join(r.data, e.name), files);
  }
  for (const f of files) {
    if (seen.has(f)) continue;
    const rel = relative(r.data, f).split(sep).join('/');
    if (SKIP_FILE.test(rel)) continue;
    const key = mapRel('data', rel);
    if (key) seen.set(f, { file: f, root: 'data', rel, key, ns: nsIdOf(key) });
  }
  // a file git tracks in the checkout is a published export or a source file (the builds store's copy on main, shipped
  // manifests, reports): generated from the tables and committed, never a leftover to delete
  const tracked = trackedIn(r.repo);
  const out = [];
  for (const m of seen.values()) {
    if (!JSONISH.test(m.file) || LEAVE.test(m.key)) continue;
    if (m.root === 'repo' && tracked.has(m.rel)) continue;
    const kind = kindOfKey(m.key);
    if (kind !== 'record' && kind !== 'journal') continue;
    out.push({ ...m, kind });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
/** One file as it will be stored: { rows, bytes, data | entries } or { error }. A file gone meanwhile: { vanished }. */
export function readSource(src, { light = false } = {}) {
  if (light) {
    // the dry run: sizes and line counts only, nothing parsed (18,000 files on the VPS; their contents are checked at --apply)
    try {
      const size = statSync(src.file).size;
      if (src.kind === 'record') return { rows: 1, bytes: size };
      let rows = 0; let open = false; const fd = openSync(src.file, 'r'); const buf = Buffer.allocUnsafe(1 << 20);
      try { for (;;) { const n = readSync(fd, buf, 0, buf.length, null); if (!n) break; for (let i = 0; i < n; i += 1) { const c = buf[i]; if (c === 10) { if (open) rows += 1; open = false; } else if (c !== 13 && c !== 32 && c !== 9) open = true; } } } finally { closeSync(fd); }
      return { rows: rows + (open ? 1 : 0), bytes: size };
    } catch (e) { return e?.code === 'ENOENT' ? { vanished: true } : { error: `unreadable: ${e.code || e.message}` }; }
  }
  // looked at before it is read: a file past what a key can hold is never loaded
  const MAX_JOURNAL_FILE = 512 * 1024 * 1024;
  try { const size = statSync(src.file).size; if (size > (src.kind === 'record' ? LIMITS.recordBytes * 2 : MAX_JOURNAL_FILE)) return { error: `${size} bytes: too large for one ${src.kind}` }; } catch (e) { if (e?.code === 'ENOENT') return { vanished: true }; }
  let text; try { text = readFileSync(src.file, 'utf8'); } catch (e) { if (e?.code === 'ENOENT') return { vanished: true }; return { error: `unreadable: ${e.code || e.message}` }; }
  if (src.kind === 'record') {
    let data; try { data = JSON.parse(text); } catch { return { error: 'not JSON: fix or remove the file by hand' }; }
    const body = canonical(data);
    if (utf8len(body) > LIMITS.recordBytes) return { error: `${utf8len(body)} bytes, over the ${LIMITS.recordBytes}-byte record limit` };
    return { rows: 1, bytes: utf8len(body), data, body, sig: sigOf(body) };
  }
  const entries = []; let bad = 0;
  for (const l of text.split('\n')) { if (!l.trim()) continue; try { entries.push(JSON.parse(l)); } catch { bad += 1; } }
  if (bad) return { error: `${bad} line(s) are not JSON: fix or remove them by hand` };
  const big = entries.filter((e) => utf8len(canonical(e)) > LIMITS.entryBytes).length;
  if (big) return { error: `${big} line(s) over the ${LIMITS.entryBytes}-byte entry limit: data-migrate.mjs moves those as records` };
  return { rows: entries.length, bytes: utf8len(text), entries, sig: sigOf(text) };
}

// ── axf-data, one row at a time ───────────────────────────────────────────────────────────────────────────────────────
async function remoteEntries(store, key) {
  const out = []; let since = 0;
  for (;;) {
    let r; try { r = await store.read(key, { since }); } catch (e) { if (e.code === 'not_found') return out; throw e; }
    out.push(...r.entries.map((x) => x.entry));
    if (!r.next) return out; since = r.next;
  }
}
/** Put one file on its key. → { op: same | created | updated | appended | mismatch, rows, why? } */
export async function copyOne(store, src, body) {
  if (src.kind === 'record') {
    const cur = await store.get(src.key);
    if (cur && canonical(cur.data) === body.body) return { op: 'same', rows: 1 };
    await store.put(src.key, body.data, cur ? { ifMatch: cur.etag } : { create: true });
    return { op: cur ? 'updated' : 'created', rows: 1 };
  }
  const have = await remoteEntries(store, src.key);
  for (let i = 0; i < have.length; i += 1) {
    if (i >= body.entries.length) return { op: 'mismatch', rows: 0, why: `axf-data has ${have.length} lines, the file ${body.entries.length}` };
    if (canonical(have[i]) !== canonical(body.entries[i])) return { op: 'mismatch', rows: 0, why: `line ${i + 1} differs from axf-data's` };
  }
  const rest = body.entries.slice(have.length);
  let sent = 0;
  while (sent < rest.length) {
    let n = 0; let bytes = 0;
    while (sent + n < rest.length && n < 2000) { const b = utf8len(canonical(rest[sent + n])) + 1; if (n && bytes + b > LIMITS.appendBytes - 1024) break; bytes += b; n += 1; }
    await store.append(src.key, rest.slice(sent, sent + n), { idempotencyKey: `json-leftovers-${have.length + sent}-${n}` });
    sent += n;
  }
  return { op: rest.length ? (have.length ? 'appended' : 'created') : 'same', rows: body.entries.length };
}
/** Read one key back and compare. → rows found equal (0 = not equal), with why. */
export async function verifyOne(store, src, body) {
  if (src.kind === 'record') {
    const cur = await store.get(src.key);
    if (!cur) return { rows: 0, why: 'missing on axf-data' };
    return canonical(cur.data) === body.body ? { rows: 1 } : { rows: 0, why: 'the record read back differs' };
  }
  const have = await remoteEntries(store, src.key);
  if (have.length !== body.entries.length) return { rows: 0, why: `axf-data has ${have.length} lines, the file ${body.entries.length}` };
  for (let i = 0; i < have.length; i += 1) if (canonical(have[i]) !== canonical(body.entries[i])) return { rows: 0, why: `line ${i + 1} read back differs` };
  return { rows: have.length };
}

// ── the switch ────────────────────────────────────────────────────────────────────────────────────────────────────────
const keyPath = (src) => src.key.slice(src.ns.length + 1);
/**
 * Put `ns` on axf-data only. The whole namespace when the guard's manifests agree (everything it holds is there), else
 * the verified keys one by one. → { how: 'namespace' | 'keys' | '', changes, state, why? }
 */
async function switchNs(store, state, ns, verified, { at, by, env }) {
  const counts = { files: verified.length, rows: verified.reduce((n, v) => n + v.rows, 0) };
  const proof = { at, how: 'migrate-json-leftovers: every row read back equal', counts };
  const changes = [];
  let how = ''; let why = '';
  if (MODE.modeOf(state, ns) !== 'cutover') {
    try {
      const p = plan(scan(env), [ns]).find((x) => x.ns === ns);
      if (!p) throw new Error('nothing of it in the migration walk');
      if (p.errors.length) throw new Error(`${p.errors.length} file(s) cannot be stored as they are`);
      const manifests = { local: { namespaces: { [ns]: p.m0 } }, remote: { namespaces: { [ns]: await manifestRemote(store, ns) } } };
      const ctx = { manifests, remoteOk: true, now: at, minDriftFreeMs: 0, acceptDrift: Array.from({ length: state.namespaces?.[ns]?.drift || 0 }, () => at) };
      let s = state; const made = [];
      if (MODE.modeOf(s, ns) === 'local') { const r = MODE.transition(s, { ns, to: 'shadow', at, by, ctx }); s = r.state; made.push(...r.changes); }
      if (MODE.modeOf(s, ns) === 'shadow') { const r = MODE.transition(s, { ns, to: 'cutover', at, by, ctx }); s = r.state; made.push(...r.changes); }
      if (MODE.modeOf(s, ns) !== 'cutover') throw new Error(`it is ${MODE.modeOf(s, ns)}: finish or cancel the rollback first`);
      state = s; changes.push(...made); how = 'namespace';
    } catch (e) { why = String(e.message || e); }
  } else how = 'namespace';
  // keys the namespace move did not cover: the namespace stayed as it was, or a key override still holds them elsewhere
  const left = verified.filter((v) => MODE.modeOf(state, ns, keyPath(v.src)) !== 'cutover');
  if (left.length) {
    const held = new Map(); // an override that covers several files is moved once
    for (const v of left) { const o = MODE.keyOverride(state, ns, keyPath(v.src)); held.set(o ? o.path : keyPath(v.src), true); }
    if (held.size > MAX_KEY_CUTS) return { how: '', changes: [], state, why: `${why || 'the namespace cannot move as one'}; ${held.size} keys is too many to cut one by one: run data-migrate.mjs apply ${ns}, then this again` };
    for (const path of held.keys()) { const r = MODE.transitionKey(state, { ns, path, to: 'cutover', at, by, verified: proof }); state = r.state; changes.push(...r.changes); }
  }
  return { how: how || 'keys', changes, state, why };
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function run({ apply = false, only = [], store = null, env = process.env, by = 'svc:cli', log = () => {} } = {}) {
  const at = nowIso();
  const all = leftovers(env).filter((s) => !only.length || only.some((o) => s.ns === o || s.ns.startsWith(`${o}/`)));
  const byNs = new Map();
  for (const s of all) { if (!byNs.has(s.ns)) byNs.set(s.ns, []); byNs.get(s.ns).push(s); }
  const report = { $axf: 'json-leftovers-migration@1', at, apply, ok: true, files: all.length, rows: 0, moved: 0, deleted: 0, namespaces: [], problems: checkPaths() };
  if (apply && report.problems.length) { report.ok = false; return report; }
  if (apply && !store) { report.ok = false; report.problems.push('axf-data is not configured (AXF_DATA_URL / AXF_DATA_TOKEN, or --url / --token)'); return report; }
  if (apply) { try { const h = await store.health(); if (!h?.ok) throw new Error('not healthy'); } catch (e) { report.ok = false; report.problems.push(`axf-data is not reachable: ${e.message}`); return report; } }
  let state = readState(env);

  for (const [ns, list] of byNs) {
    const n = { ns, mode: MODE.modeOf(state, ns), files: list.length, rows: 0, verified: 0, copy: {}, switched: '', deleted: 0, items: [], problems: [] };
    report.namespaces.push(n);
    // one file at a time: read, 1 copy, 2 verify; only its row count and signature are kept
    const verified = [];
    for (const src of list) {
      const body = readSource(src, { light: !apply });
      if (body.vanished) { n.files -= 1; continue; }
      const item = { file: src.file, key: src.key, kind: src.kind, rows: body.rows ?? 0, bytes: body.bytes ?? 0 };
      n.items.push(item);
      if (body.error) { item.error = body.error; n.problems.push(`${src.key}: ${body.error}`); continue; }
      n.rows += body.rows;
      if (!apply) continue;
      try {
        // already served from axf-data: the file is a stale leftover; what axf-data holds wins, a key it lacks is copied
        const cut = MODE.modeOf(state, ns, keyPath(src)) === 'cutover';
        if (cut && (src.kind === 'journal' ? (await remoteEntries(store, src.key)).length : await store.get(src.key))) { item.op = 'stale'; verified.push({ src, rows: body.rows, sig: body.sig, stale: true }); n.copy.stale = (n.copy.stale || 0) + 1; continue; }
        const c = await copyOne(store, src, body);
        item.op = c.op; n.copy[c.op] = (n.copy[c.op] || 0) + 1;
        if (c.op === 'mismatch') { n.problems.push(`${src.key}: ${c.why}`); continue; }
        const v = await verifyOne(store, src, body);
        if (v.rows !== body.rows || v.why) { n.problems.push(`${src.key}: ${v.why || `${v.rows} of ${body.rows} rows read back`}`); continue; }
        verified.push({ src, rows: v.rows, sig: body.sig });
      } catch (e) { item.op = 'failed'; n.problems.push(`${src.key}: ${e.code || 'error'}: ${e.message}`); }
    }
    report.rows += n.rows;
    if (!apply) continue;
    n.verified = verified.reduce((x, v) => x + v.rows, 0);
    report.moved += n.verified;
    log(`${ns}: ${n.verified} of ${n.rows} row(s) on axf-data and read back equal`);
    if (n.problems.length || n.verified !== n.rows) { n.problems.push('rows moved and rows read back differ: nothing switched, no file deleted'); continue; }

    // 3 switch
    const sw = await switchNs(store, state, ns, verified, { at: nowIso(), by, env });
    if (!sw.how) { n.problems.push(`not switched: ${sw.why}`); continue; }
    if (sw.changes.length) {
      state = sw.state; writeState(state, env);
      try { await publish(store, state, sw.changes, by); } catch (e) { n.problems.push(`the mode change is local only, axf-data's copy of it failed: ${e.code || 'error'}: ${e.message}`); }
    }
    n.switched = sw.how; n.mode = MODE.modeOf(state, ns);
    if (sw.how === 'keys' && sw.why) n.note = `cut key by key (${sw.why}): its other files are data-migrate.mjs's`;

    // 4 delete: only what axf-data now serves, and only after one more look at the file
    for (const v of verified) {
      if (MODE.modeOf(state, ns, keyPath(v.src)) !== 'cutover') { n.problems.push(`${v.src.key}: still ${MODE.modeOf(state, ns, keyPath(v.src))}, file kept`); continue; }
      try {
        const again = readSource(v.src);
        if (!again.vanished && !v.stale) {
          if (again.error) { n.problems.push(`${v.src.key}: ${again.error} (changed since the copy), file kept`); continue; }
          if (again.sig !== v.sig) {
            const c = await copyOne(store, v.src, again); const back = c.op === 'mismatch' ? { rows: 0, why: c.why } : await verifyOne(store, v.src, again);
            if (back.rows !== again.rows || back.why) { n.problems.push(`${v.src.key}: written again after the copy and ${back.why || 'not equal on axf-data'}, file kept`); continue; }
          }
        }
        rmSync(v.src.file, { force: true }); n.deleted += 1;
      } catch (e) { n.problems.push(`${v.src.key}: ${e.code || 'error'}: ${e.message}, file kept`); }
    }
    report.deleted += n.deleted;
    log(`${ns}: ${n.switched === 'keys' ? 'keys' : 'namespace'} on axf-data only, ${n.deleted} file(s) deleted`);
  }
  for (const n of report.namespaces) if (n.problems.length) report.ok = false;
  if (report.problems.length) report.ok = false;
  return report;
}

function print(r) {
  const head = r.apply ? 'migrate-json-leftovers' : 'migrate-json-leftovers (dry run: nothing read from or written to axf-data, nothing deleted)';
  console.log(`${head}: ${r.files} JSON data file(s), ${r.rows} row(s), ${r.namespaces.length} namespace(s)`);
  for (const p of r.problems) console.log(`✗ ${p}`);
  for (const n of r.namespaces) {
    console.log(r.apply
      ? `${n.problems.length ? '✗' : '✓'} ${n.ns}: ${n.verified} of ${n.rows} row(s) verified, ${n.switched ? `on axf-data only (${n.switched})` : `still ${n.mode}`}, ${n.deleted} of ${n.files} file(s) deleted${n.note ? `; ${n.note}` : ''}`
      : `  ${n.ns} (${n.mode}): ${n.files} file(s), ${n.rows} row(s) to move, then cutover and delete`);
    if (!r.apply) for (const i of n.items) console.log(`      ${i.file} → ${i.key} (${i.kind}, ${i.rows} row(s), ${i.bytes} B)${i.error ? `  ✗ ${i.error}` : ''}`);
    for (const p of n.problems) console.log(`    ✗ ${p}`);
  }
  if (r.apply) console.log(r.ok ? `done: ${r.moved} row(s) on axf-data, ${r.deleted} file(s) deleted` : `stopped with problems: ${r.moved} row(s) verified, ${r.deleted} file(s) deleted; everything listed ✗ is still a file`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (k, value = false) => { const i = args.indexOf(`--${k}`); if (i < 0) return undefined; const v = value ? args[i + 1] : true; args.splice(i, value ? 2 : 1); return v; };
  const json = !!flag('json'); const apply = !!flag('apply'); const dry = !!flag('dry-run'); const check = !!flag('check');
  const url = flag('url', true); const token = flag('token', true); const by = flag('by', true) || 'svc:cli';
  const bad = args.find((a) => a.startsWith('--') || !NAMESPACES[a.split('/')[0]] || NAMESPACES[a.split('/')[0]].internal);
  if (bad || (apply && dry)) { console.error(bad ? `unknown option or namespace "${bad}"` : '--apply and --dry-run together'); process.exit(2); }
  if (check) {
    const problems = checkPaths();
    if (json) console.log(JSON.stringify({ ok: !problems.length, problems }, null, 1));
    else if (problems.length) for (const p of problems) console.error(`✗ ${p}`);
    else console.log('✓ data-store-paths: cutover only, every local rule has its reason, every example maps as written');
    process.exit(problems.length ? 1 : 0);
  }
  const store = !apply ? null : url ? createDataStore({ backend: httpBackend({ url, token: token || process.env.AXF_DATA_TOKEN || '' }), by: 'svc:cli' }) : remoteStore();
  try {
    const r = await run({ apply, only: args, store, by, log: json ? () => {} : (l) => console.error(l) });
    if (json) console.log(JSON.stringify(r, null, 1)); else print(r);
    process.exit(r.ok ? 0 : 1);
  } catch (e) { console.error(`migrate-json-leftovers: ${e.code ? `${e.code}: ` : ''}${e.message}`); process.exit(1); }
}

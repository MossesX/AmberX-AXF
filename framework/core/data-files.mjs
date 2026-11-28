/**
 * data-files — the Node side of the console's data layer: files the framework and plugins write today, routed through
 * data-store@1 (framework/core/data-store.mjs) by the mode of their namespace (data-store-mode@1).
 *
 * Brett, Nov 15 2026: "the console goes down, all the data is still available, all the notes are available, and the
 * builds keep running. That's what I need."
 *
 *   import { readJson, writeJson, appendJsonl, readJsonSync, writeJsonSync, pluginData, keyFor } from '…/data-files.mjs';
 *   const doc = await readJson(path, fallback);          await writeJson(path, doc);     await appendJsonl(path, entry);
 *   const items = pluginData('ui-review');                await items.writeJson('items.json', doc);
 *
 * Python twin: apps/console-web/server/data_store.py (same map, same modes). The map is
 * framework/schemas/data-store-paths.json; a path no rule maps stays a plain local file whatever the mode.
 *
 *   local     plain files, exactly what the callers did before (the default: no behaviour change)
 *   shadow    the file first (the caller's answer), then the same write on axf-data; a failed mirror is a data-drift@1
 *             line in <data>/data-store/drift/<ns>.jsonl, never an error
 *   cutover   axf-data only. Async calls use the client in-process; sync calls (…Sync) go through callSync (a child
 *             process per call). axf-data unreachable: reads fall back to the local read-only copy (logged), writes throw
 *   rollback  async reads from axf-data; writes refuse with `read_only`
 *
 * Table-backed records (the builds store) are also reached row by row: itemSync / summarySync below read one build or
 * the pipeline summary, and a status change is a data-patch@1 of that build's row. No status lives in a file.
 *
 * axf-data: AXF_DATA_URL + AXF_DATA_TOKEN (the env files deploy/install-data.sh writes), or on the VPS host the
 * `conf/env/host.env` file it writes for processes outside the containers (remoteConfig). Tests pass `remote`.
 * Modes are per namespace with key-level overrides (data-store-mode@1 `keys`): the builds store and its journal moved
 * first (Nov 18 2026), the rest of `builds` follows namespace by namespace.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DataStoreError, NAMESPACES, LIMITS, PATTERNS, canonical, createDataStore, etagOf, httpBackend, kindOfFile } from './data-store.mjs';
import { clip } from './clip.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PATHS = JSON.parse(readFileSync(join(REPO, 'framework/schemas/data-store-paths.json'), 'utf8'));
const RULES = Object.fromEntries(Object.entries(PATHS.rules).map(([root, rules]) => [root, rules.map((r) => ({ re: new RegExp(r.re), to: r.to }))]));
const SEGMENT = new RegExp(PATTERNS.segment);
const FOLDER = new RegExp(PATTERNS.pluginFolder);
export const MODES = ['local', 'shadow', 'cutover', 'rollback'];

/**
 * A linked git worktree (`.git` is a file) shares the main checkout's console data: its `.axf-console` (the mode document,
 * the data-store folder) is the main checkout's, never one of its own, so a build session sees the same modes as the
 * console and every other process on the machine. Memoised per repo path.
 */
const mainCheckoutMemo = new Map();
export function mainCheckout(repo) {
  if (mainCheckoutMemo.has(repo)) return mainCheckoutMemo.get(repo);
  let main = repo;
  try {
    const g = join(repo, '.git');
    if (statSync(g).isFile()) {
      const gitdir = readFileSync(g, 'utf8').match(/gitdir:\s*(.+)/)?.[1]?.trim();
      // <main>/.git/worktrees/<name> → <main>
      const m = gitdir && /^(.*)\/\.git\/worktrees\/[^/]+\/?$/.exec(resolve(repo, gitdir));
      if (m && existsSync(join(m[1], '.git'))) main = m[1];
    }
  } catch { /* not a worktree */ }
  mainCheckoutMemo.set(repo, main);
  return main;
}
/** The four roots, from the same env as the Python side. */
export function roots(env = process.env) {
  const repo = env.AXF_ROOT ? resolve(env.AXF_ROOT) : REPO;
  const data = env.AXF_STATE ? dirname(resolve(env.AXF_STATE)) : join(env.AXF_ROOT ? repo : mainCheckout(repo), '.axf-console');
  return { plugins: resolve(env.AXF_PLUGINS_DATA_DIR || join(data, 'plugins')), data, repo, projects: resolve(env.AXHUB_PROJECTS_DIR || '/projects') };
}
/** Is `key` a key data-store@1 accepts (registry namespaces, segments, plugin folder)? */
export function validKey(key) {
  const i = key.indexOf('/'); const ns = i < 0 ? key : key.slice(0, i); const path = i < 0 ? '' : key.slice(i + 1);
  if (!NAMESPACES[ns] || NAMESPACES[ns].internal || !path || key.length > LIMITS.keyChars) return false;
  const segs = path.split('/');
  if (!segs.every((s) => SEGMENT.test(s) && s !== '.' && s !== '..')) return false;
  return !NAMESPACES[ns].open || (segs.length >= 2 && FOLDER.test(segs[0]));
}
/** A segment over 80 characters → its start + '--' + 16 hex of its SHA-256 + its extension, 80 in all (data-store-paths.json longSegments). */
export function shortSegment(seg) {
  if (seg.length <= 80) return seg;
  const ext = (/(\.[A-Za-z0-9]{1,8})$/.exec(seg) || ['', ''])[1];
  return `${seg.slice(0, 62 - ext.length)}--${createHash('sha256').update(seg).digest('hex').slice(0, 16)}${ext}`;
}
/** A path relative to a root → its key, or null (stays local). */
export function mapRel(root, rel) {
  for (const { re, to } of RULES[root] || []) {
    const m = re.exec(rel);
    if (!m) continue;
    if (to === null) return null;
    const key = to.replace(/\{(\d)\}/g, (_, n) => m[Number(n)]).split('/').map(shortSegment).join('/');
    return validKey(key) ? key : null;
  }
  return null;
}
/**
 * A key → the local file it maps from (the inverse of keyFor), or null when no rule inverts to it (a shortened long
 * segment, a key only axf-data has under a rule that keeps nothing). Used by the rollback replay.
 */
export function pathForKey(key, env = process.env) {
  const r = roots(env);
  const lit = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const name of PATHS.order) {
    for (const { re, to } of RULES[name] || []) {
      if (to === null) continue;
      const order = []; const tre = new RegExp(`^${to.split(/(\{\d\})/).map((p) => { const m = /^\{(\d)\}$/.exec(p); if (m) { order.push(Number(m[1])); return '(.+?)'; } return lit(p); }).join('')}$`);
      const m = tre.exec(key);
      if (!m) continue;
      const groups = {}; order.forEach((g, i) => { groups[g] = m[i + 1]; });
      // rebuild the source path: the rule's regex with each capture group replaced by its value
      let gi = 0; let rel = '';
      const src = re.source.replace(/^\^/, '').replace(/\$$/, '');
      for (let i = 0; i < src.length; i += 1) {
        const c = src[i];
        if (c === '\\') { rel += src[i + 1]; i += 1; continue; }
        if (c === '(' && src[i + 1] !== '?') { gi += 1; let depth = 1; let j = i + 1; while (j < src.length && depth) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '(') depth += 1; if (src[j] === ')') depth -= 1; j += 1; } if (groups[gi] === undefined) { rel = null; break; } rel += groups[gi]; i = j - 1; continue; }
        if ('^$.*+?[]{}|()'.includes(c)) { rel = null; break; }
        rel += c;
      }
      if (rel && mapRel(name, rel) === key) return join(r[name], rel);
    }
  }
  return null;
}
/** An absolute (or repo-relative) path → its key, or null. */
export function keyFor(p, env = process.env) {
  const abs = isAbsolute(p) ? resolve(p) : resolve(roots(env).repo, p);
  const r = roots(env);
  for (const name of PATHS.order) {
    const rel = relative(r[name], abs);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return mapRel(name, rel.split(sep).join('/'));
  }
  return null;
}
const JOURNAL_KEYS = /^(builds\/journal\/[^/]+|planner\/shipped-log|console\/deploys\/log|notes\/_history\/.+)$/;
export function kindOfKey(key) {
  let kind = JOURNAL_KEYS.test(key) ? 'journal' : kindOfFile(key);
  if (!NAMESPACES[key.split('/')[0]].kinds.includes(kind)) kind = 'blob';
  return kind;
}
export function nsIdOf(key) { const [ns, first] = key.split('/'); return NAMESPACES[ns]?.open ? `${ns}/${first}` : ns; }

// ── mode ──
const storeDir = (env = process.env) => resolve(env.AXF_DATA_STORE_DIR || join(roots(env).data, 'data-store'));
// Cached by mtime + size. Two writes inside one timestamp tick can keep the same mtime (seen on CI runners: a write
// after a cutover still went to the local file), so a file written in the last 2 s is always read again.
let modeCache = { mtime: -1, size: -1, file: '', doc: null };
const MODE_FRESH_MS = 2000;
export function modeDoc(env = process.env) {
  const f = join(storeDir(env), 'mode.json');
  let st;
  try { st = statSync(f); } catch { return { mode: 'local', namespaces: {} }; }
  const recent = Date.now() - st.mtimeMs < MODE_FRESH_MS;
  if (recent || modeCache.file !== f || modeCache.mtime !== st.mtimeMs || modeCache.size !== st.size) {
    let doc; try { doc = JSON.parse(readFileSync(f, 'utf8')); } catch { doc = { mode: 'local', namespaces: {} }; }
    modeCache = { mtime: st.mtimeMs, size: st.size, file: f, doc };
  }
  return modeCache.doc;
}
/**
 * The mode of one key: a key-level override on its namespace entry (`keys`: the exact path, or the longest prefix ending
 * in `/`, relative to the namespace id: `builds/store.json` → `store.json`), else the namespace entry, else the store.
 */
export function modeOf(key, env = process.env) {
  const doc = modeDoc(env); const id = nsIdOf(key); const e = doc.namespaces?.[id];
  let m = '';
  const rel = key.startsWith(`${id}/`) ? key.slice(id.length + 1) : '';
  if (rel && e?.keys && typeof e.keys === 'object') {
    let best = '';
    for (const [p, k] of Object.entries(e.keys)) { const hit = p.endsWith('/') ? rel.startsWith(p) : rel === p; if (hit && p.length > best.length && k && typeof k === 'object') { best = p; m = String(k.mode || ''); } }
  }
  m = m || e?.mode || doc.mode || 'local';
  return MODES.includes(m) ? m : 'local';
}

// ── axf-data ──
let remote = null;
/**
 * Where axf-data is: AXF_DATA_URL + AXF_DATA_TOKEN from the environment (the console container, the headless drill), else
 * the host env file deploy/install-data.sh writes for processes on the VPS itself (build sessions in worktrees, the gate
 * runner, cron): `<AXF_DATA_CONF>/env/host.env` (default /root/hub/data/axf-data/conf/env/host.env, root-only, carrying
 * the loopback URL and the orchestrator token). Tests set AXF_DATA_URL or pass their own store; AXF_DATA_URL=off disables.
 */
export function remoteConfig(env = process.env) {
  if (env.AXF_DATA_URL === 'off') return null;
  if (env.AXF_DATA_URL) return { url: env.AXF_DATA_URL, token: env.AXF_DATA_TOKEN || '', from: 'env' };
  if (env.AXF_DATA_DIR !== undefined || env.AXF_BUILDS_STORE) return null; // tests and scratch runs never reach the VPS service
  const f = join(env.AXF_DATA_CONF || '/root/hub/data/axf-data/conf', 'env', 'host.env');
  try {
    const kv = Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
    if (kv.AXF_DATA_URL) return { url: kv.AXF_DATA_URL, token: kv.AXF_DATA_TOKEN || '', from: f };
  } catch { /* no host env file: not on the VPS */ }
  return null;
}
/** The axf-data client (createDataStore over httpBackend), or null when axf-data is not configured here. Tests pass their own. */
export function remoteStore(env = process.env) {
  if (remote) return remote;
  const cfg = remoteConfig(env);
  if (!cfg) return null;
  remote = createDataStore({ backend: httpBackend({ url: cfg.url, token: () => cfg.token, actor: env.AXF_DATA_ACTOR || '' }) });
  return remote;
}
export function setRemote(store) { remote = store; }
const needRemote = (key) => { const r = remoteStore(); if (!r) throw new DataStoreError('unavailable', `${nsIdOf(key)} is on axf-data but AXF_DATA_URL is unset`); return r; };

export function logDrift(op, key, kind, local, remoteMeta, error = '') {
  const e = { $axf: 'data-drift@1', at: new Date().toISOString(), op, key, kind, local, remote: remoteMeta, ...(error ? { error: String(error).slice(0, 300) } : {}) };
  const f = join(storeDir(), 'drift', `${nsIdOf(key).replace('/', '__')}.jsonl`);
  mkdirSync(dirname(f), { recursive: true });
  appendFileSync(f, `${JSON.stringify(e)}\n`);
  return e;
}

const bodyFor = (key, text) => {
  if (kindOfKey(key) === 'record') { try { return { data: JSON.parse(text) }; } catch { /* not JSON → blob */ } }
  const ext = (key.split('/').pop().split('.').pop() || '').toLowerCase();
  const ct = { md: 'text/markdown', txt: 'text/plain', html: 'text/html', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', sqlite: 'application/vnd.sqlite3', db: 'application/vnd.sqlite3' }[ext] || 'application/octet-stream';
  return { data: typeof text === 'string' ? new TextEncoder().encode(text) : text, contentType: ct };
};
async function remotePut(store, key, text) {
  const { data, contentType } = bodyFor(key, text);
  if (contentType) return store.put(key, data, { force: true, contentType });
  return store.update(key, () => data, { create: true });
}

// ── files (sync: local + shadow) ──
const writeAtomic = (p, text) => { mkdirSync(dirname(p), { recursive: true }); const tmp = `${p}.${process.pid}.${Date.now()}.tmp`; writeFileSync(tmp, text); renameSync(tmp, p); };
const pending = new Set();
const mirror = (fn) => { const p = Promise.resolve().then(fn).catch(() => {}); pending.add(p); p.finally(() => pending.delete(p)); return p; };
/** Wait for shadow mirrors still in flight (a CLI calls this before it exits). */
export async function flush() { await Promise.all([...pending]); }

function route(p) { const key = keyFor(p); return { key, mode: key ? modeOf(key) : 'local' }; }
// Sync calls reach axf-data through callSync (a child process per call, ~50 ms): shadow mirrors are written before the
// call returns (a CLI that exits at once loses nothing), cutover reads and writes go there only.
const b64 = (text) => Buffer.from(typeof text === 'string' ? text : Buffer.from(text)).toString('base64');
function putLatestSync(key, text) {
  const { data, contentType } = bodyFor(key, text);
  if (contentType) return callSync({ op: 'put', key, data: { $bytes: b64(text) }, contentType, force: true });
  for (let i = 0; ; i += 1) {
    const cur = callSync({ op: 'get', key });
    try { return callSync({ op: 'put', key, data, ...(cur ? { ifMatch: cur.etag } : { create: true }) }); }
    catch (e) { if (!['conflict', 'exists'].includes(e.code) || i >= 4) throw e; }
  }
}
function remoteTextSync(key) {
  if (kindOfKey(key) === 'journal') {
    const lines = []; let since = 0;
    for (;;) { let r; try { r = callSync({ op: 'read', key, since, limit: SYNC_READ_PAGE }); } catch (e) { if (e.code === 'not_found') return lines.length ? lines.join('') : null; throw e; } for (const x of r.entries) lines.push(`${JSON.stringify(x.entry)}\n`); if (!r.next) break; since = r.next; }
    return lines.join('');
  }
  const rec = callSync({ op: 'get', key });
  if (!rec) return null;
  return rec.data && rec.data.$bytes !== undefined ? Buffer.from(rec.data.$bytes, 'base64').toString('utf8') : JSON.stringify(rec.data, null, 2);
}

export function readTextSync(p, fallback = null) {
  const { key, mode } = route(p);
  if (mode === 'cutover' || mode === 'rollback') {
    try { const t = remoteTextSync(key); return t === null ? fallback : t; }
    catch (e) { if (e.code !== 'unavailable') throw e; logDrift('read', key, 'write-failed', null, null, `axf-data unreachable in ${mode}: served the local read-only copy`); }
  }
  try { return readFileSync(p, 'utf8'); } catch { return fallback; }
}
export function readJsonSync(p, fallback = null) {
  const t = readTextSync(p, null);
  if (t === null) return structuredClone(fallback);
  try { return JSON.parse(t); } catch { return structuredClone(fallback); }
}
export function writeTextSync(p, text) {
  const { key, mode } = route(p);
  if (mode === 'rollback') throw new DataStoreError('read_only', `${nsIdOf(key)} is rolling back: writes wait until it is local again`);
  if (mode === 'cutover') { putLatestSync(key, text); return; }
  writeAtomic(p, text);
  if (mode === 'shadow') { try { putLatestSync(key, text); } catch (e) { logDrift('write', key, 'write-failed', null, null, `${e.code || 'error'}: ${e.message}`); } }
}
export function writeJsonSync(p, doc, indent = 2) { writeTextSync(p, `${JSON.stringify(doc, null, indent)}\n`); }
export function appendJsonlSync(p, entry) {
  const { key, mode } = route(p);
  const journal = key && kindOfKey(key) === 'journal';
  if (journal && mode === 'rollback') throw new DataStoreError('read_only', `${nsIdOf(key)} is rolling back`);
  if (journal && mode === 'cutover') { callSync({ op: 'append', key, entries: [entry], idem: randomUUID() }); return; }
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(entry)}\n`);
  if (journal && mode === 'shadow') { try { callSync({ op: 'append', key, entries: [entry], idem: randomUUID() }); } catch (e) { logDrift('append', key, 'append-failed', null, null, `${e.code || 'error'}: ${e.message}`); } }
}

/** Does the file exist (on axf-data in cutover / rollback)? */
export function existsAnySync(p) {
  const { key, mode } = route(p);
  if (mode === 'cutover' || mode === 'rollback') { try { return remoteTextSync(key) !== null; } catch (e) { if (e.code !== 'unavailable') throw e; } }
  return existsSync(p);
}
/** File names directly inside `dir` (the keys under its prefix on axf-data in cutover / rollback). */
export function listSync(dir) {
  const probe = keyFor(join(dir, '__probe__.json'));
  const mode = probe ? modeOf(probe) : 'local';
  if (mode === 'cutover' || mode === 'rollback') {
    const [ns, ...rest] = probe.split('/');
    const prefix = rest.slice(0, -1).join('/') + (rest.length > 1 ? '/' : '');
    const names = new Set(); let after = '';
    try {
      for (;;) { const l = callSync({ op: 'list', ns, prefix, after }); for (const i of l.items) { const tail = i.path.slice(prefix.length); if (tail && !tail.includes('/')) names.add(tail); } if (!l.next) break; after = l.next; }
      return [...names].sort();
    } catch (e) { if (e.code !== 'unavailable') throw e; }
  }
  try { return readdirSync(dir).sort(); } catch { return []; }
}
/** Remove a file (a tombstone on axf-data; never a journal). */
export function removeSync(p) {
  const { key, mode } = route(p);
  if (mode === 'rollback') throw new DataStoreError('read_only', `${nsIdOf(key)} is rolling back`);
  const remoteDel = () => { try { callSync({ op: 'delete', key, force: true }); } catch (e) { if (e.code !== 'not_found') throw e; } };
  if (mode === 'cutover') { remoteDel(); return; }
  rmSync(p, { force: true });
  if (mode === 'shadow') { try { remoteDel(); } catch (e) { logDrift('write', key, 'write-failed', null, null, `delete: ${e.code || 'error'}: ${e.message}`); } }
}

// ── files (async: every mode) ──
export async function readText(p, fallback = null) {
  const { key, mode } = route(p);
  if (mode === 'cutover' || mode === 'rollback') {
    try {
      const store = needRemote(key);
      if (kindOfKey(key) === 'journal') {
        const lines = []; let since = 0;
        for (;;) { let r; try { r = await store.read(key, { since }); } catch (e) { if (e.code === 'not_found') return lines.length ? lines.join('') : fallback; throw e; } for (const x of r.entries) lines.push(`${JSON.stringify(x.entry)}\n`); if (!r.next) break; since = r.next; }
        return lines.join('');
      }
      const rec = await store.get(key);
      if (!rec) return fallback;
      return rec.data instanceof Uint8Array ? new TextDecoder().decode(rec.data) : JSON.stringify(rec.data, null, 2);
    } catch (e) {
      if (e.code !== 'unavailable') throw e;
      logDrift('read', key, 'write-failed', null, null, `axf-data unreachable in ${mode}: served the local read-only copy`);
    }
  }
  let t; try { t = readFileSync(p, 'utf8'); } catch { return fallback; }
  if (mode === 'shadow' && kindOfKey(key) !== 'journal') mirror(async () => {
    try {
      const rec = await needRemote(key).get(key);
      const { data } = bodyFor(key, t);
      const mine = etagOf(1, data).split('-')[1];
      if (!rec) logDrift('read', key, 'missing-remote', { etag: `0-${mine}` }, null);
      else if (rec.etag.split('-')[1] !== mine) logDrift('read', key, 'etag', { etag: `0-${mine}` }, { rev: rec.rev, etag: rec.etag });
    } catch (e) { logDrift('read', key, 'write-failed', null, null, `${e.code || 'error'}: ${e.message}`); }
  });
  return t;
}
export async function readJson(p, fallback = null) {
  const t = await readText(p, null);
  if (t === null) return structuredClone(fallback);
  try { return JSON.parse(t); } catch { return structuredClone(fallback); }
}
export async function writeText(p, text) {
  const { key, mode } = route(p);
  if (mode === 'rollback') throw new DataStoreError('read_only', `${nsIdOf(key)} is rolling back: writes wait until it is local again`);
  if (mode === 'cutover') { await remotePut(needRemote(key), key, text); return; }
  writeAtomic(p, text);
  if (mode === 'shadow') { try { await remotePut(needRemote(key), key, text); } catch (e) { logDrift('write', key, 'write-failed', null, null, `${e.code || 'error'}: ${e.message}`); } }
}
export async function writeJson(p, doc, indent = 2) { await writeText(p, `${JSON.stringify(doc, null, indent)}\n`); }
/** Read → fn(doc) → write, with the rev check on axf-data in cutover (a conflict re-reads and re-applies). */
export async function updateJson(p, fn, fallback = null) {
  const { key, mode } = route(p);
  if (mode === 'cutover') {
    const store = needRemote(key);
    return store.update(key, async (doc) => fn(doc === undefined ? structuredClone(fallback) : doc), { create: true });
  }
  const next = await fn(await readJson(p, fallback));
  if (next !== undefined) await writeJson(p, next);
  return next;
}
export async function appendJsonl(p, entry) {
  const { key, mode } = route(p);
  if (mode === 'rollback') throw new DataStoreError('read_only', `${nsIdOf(key)} is rolling back`);
  const journal = key && kindOfKey(key) === 'journal';
  if (journal && mode === 'cutover') { await needRemote(key).append(key, [entry], { idempotencyKey: randomUUID() }); return; }
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(entry)}\n`);
  if (journal && mode === 'shadow') { try { await needRemote(key).append(key, [entry], { idempotencyKey: randomUUID() }); } catch (e) { logDrift('append', key, 'append-failed', null, null, `${e.code || 'error'}: ${e.message}`); } }
}

/**
 * The biggest answer one sync call may print: a blob at the store's limit, base64 in JSON (4/3), plus room for the
 * frame. A fixed 64 MiB failed with ENOBUFS on a 207 MB SQLite blob and on a 68 MB journal page (Nov 20 2026).
 */
export const CALL_SYNC_MAX_BUFFER = Math.ceil((Math.max(LIMITS.blobBytes, LIMITS.recordBytes) * 4) / 3) + 16 * 1024 * 1024;
/**
 * Journal entries per sync `read`: each entry is at most LIMITS.entryBytes (256 KiB), so a page stays near 25 MiB
 * whatever the journal holds. The server's default page (journalPage, 5000) of a busy month part is over 60 MB.
 */
export const SYNC_READ_PAGE = 100;
/**
 * One data-store@1 call, synchronously (a child node process runs framework/cli/data-call.mjs): for sync code that
 * must work in cutover (builds-store.mjs). Throws DataStoreError with the server's code. AXF_DATA_CALL_SYNC may name
 * another helper (tests point it at an in-process store).
 */
export function callSync(req) {
  const helper = process.env.AXF_DATA_CALL_SYNC || join(REPO, 'framework/cli/data-call.mjs');
  let text;
  try { text = execFileSync(process.execPath, [helper], { input: JSON.stringify(req), encoding: 'utf8', maxBuffer: CALL_SYNC_MAX_BUFFER, timeout: 60000 }); }
  catch (e) { throw new DataStoreError('unavailable', `data-call failed: ${clip(String(e.message), 200)}`); }
  const r = JSON.parse(text.trim().split('\n').pop());
  if (!r.ok) throw new DataStoreError(r.code, r.message, { rev: r.rev, etag: r.etag });
  return r.result;
}

/**
 * One row of a table-backed record, and the summary computed from its rows, synchronously (the builds store: one build
 * by its id, the pipeline's counts). Neither reads the document, so a status read or write never moves the whole record.
 *   itemSync(key, id)   data-item@1 { rev, head, item }, or null when the record has no such row
 *   summarySync(key)    pipeline-summary@1 { counts, total, queued, queuedAll, running, rev, at }
 * Both answer { ok, result }. `ok: false`: this axf-data is from before the row calls (it answers `invalid_key` for the
 * action; the service is deployed on its own schedule), and the caller reads the record instead. Any other failure throws.
 * The write of one row is `callSync({ op: 'patch', … })` (data-patch@1 with the row's ifRev).
 */
const rowSync = (req) => { try { return { ok: true, result: callSync(req) }; } catch (e) { if (e instanceof DataStoreError && e.code === 'invalid_key') return { ok: false, result: null }; throw e; } };
export function itemSync(key, id, { list } = {}) { return rowSync({ op: 'item', key, id: String(id ?? ''), ...(list ? { list } : {}) }); }
export function summarySync(key, { list } = {}) { return rowSync({ op: 'summary', key, ...(list ? { list } : {}) }); }

/**
 * SQLite files kept as one blob (migration policy blob-sqlite: shipped-features/ledger.sqlite, chat-viewer/chats.db).
 * The local file stays the working copy SQLite opens; in shadow / cutover a consistent copy (VACUUM INTO) is uploaded
 * after each write transaction, and in cutover / rollback the newest copy is fetched before opening. `<file>.axf-etag`
 * remembers the etag last synced, so a copy written elsewhere (axf-molly, another console) is fetched, and an upload
 * that finds a newer copy there is a conflict: logged as drift, then written (the ledgers re-merge from build hooks).
 */
export function sqliteHydrate(file) {
  const key = keyFor(file); if (!key) return false;
  const mode = modeOf(key); if (mode !== 'cutover' && mode !== 'rollback') return false;
  const tag = `${file}.axf-etag`;
  const have = existsSync(tag) ? readFileSync(tag, 'utf8').trim() : '';
  let rec;
  try { rec = callSync({ op: 'get', key }); } catch (e) { if (e.code !== 'unavailable') throw e; logDrift('read', key, 'write-failed', null, null, 'axf-data unreachable: opened the local copy'); return false; }
  if (!rec || rec.etag === have || rec.data?.$bytes === undefined) return false;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.axf-fetch-${process.pid}`;
  writeFileSync(tmp, Buffer.from(rec.data.$bytes, 'base64'));
  for (const x of ['-wal', '-shm']) rmSync(`${file}${x}`, { force: true });
  renameSync(tmp, file);
  writeFileSync(tag, rec.etag);
  return true;
}
export function sqliteUpload(file, db) {
  const key = keyFor(file); if (!key) return false;
  const mode = modeOf(key); if (mode === 'local') return false;
  if (mode === 'rollback') throw new DataStoreError('read_only', `${nsIdOf(key)} is rolling back`);
  const tmp = `${file}.axf-upload-${process.pid}`;
  rmSync(tmp, { force: true });
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const bytes = readFileSync(tmp); rmSync(tmp, { force: true });
  const tag = `${file}.axf-etag`;
  const have = existsSync(tag) ? readFileSync(tag, 'utf8').trim() : '';
  const put = (pre) => callSync({ op: 'put', key, data: { $bytes: bytes.toString('base64') }, contentType: 'application/vnd.sqlite3', ...pre });
  try {
    let r;
    try { r = put(have ? { ifMatch: have } : { force: true }); }
    catch (e) { if (e.code !== 'conflict') throw e; logDrift('write', key, 'etag', { etag: have }, { rev: e.rev, etag: e.etag }, 'a newer copy was on axf-data: overwritten'); r = put({ force: true }); }
    writeFileSync(tag, r.etag);
    return true;
  } catch (e) {
    if (mode === 'shadow') { logDrift('write', key, 'write-failed', null, null, `${e.code || 'error'}: ${e.message}`); return false; }
    throw e;
  }
}

/** A plugin's lifecycle dataDir through the layer: relative paths, same calls. */
export function pluginData(folder, env = process.env) {
  if (!FOLDER.test(String(folder || ''))) throw new DataStoreError('invalid_key', `bad plugin folder "${folder}"`);
  const dir = join(roots(env).plugins, folder);
  const path = (rel) => { const p = resolve(dir, rel); if (p !== dir && !p.startsWith(dir + sep)) throw new DataStoreError('invalid_key', `${rel} leaves the plugin's data folder`); return p; };
  return {
    dir, path, key: (rel) => keyFor(path(rel), env),
    readJson: (rel, fb) => readJson(path(rel), fb), writeJson: (rel, doc, indent) => writeJson(path(rel), doc, indent), updateJson: (rel, fn, fb) => updateJson(path(rel), fn, fb),
    appendJsonl: (rel, e) => appendJsonl(path(rel), e), readText: (rel, fb) => readText(path(rel), fb), writeText: (rel, t) => writeText(path(rel), t),
    readJsonSync: (rel, fb) => readJsonSync(path(rel), fb), writeJsonSync: (rel, doc, indent) => writeJsonSync(path(rel), doc, indent), appendJsonlSync: (rel, e) => appendJsonlSync(path(rel), e),
    exists: (rel) => existsSync(path(rel)),
  };
}
export { canonical };

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
 *   cutover   axf-data only (async calls). The sync calls refuse with `unavailable` instead of reading a stale copy:
 *             a caller that must keep working after the cutover uses the async calls
 *   rollback  async reads from axf-data; writes refuse with `read_only`
 *
 * axf-data: AXF_DATA_URL + AXF_DATA_TOKEN (the env files deploy/install-data.sh writes). Tests pass `remote`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DataStoreError, NAMESPACES, LIMITS, PATTERNS, canonical, createDataStore, etagOf, httpBackend, kindOfFile } from './data-store.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PATHS = JSON.parse(readFileSync(join(REPO, 'framework/schemas/data-store-paths.json'), 'utf8'));
const RULES = Object.fromEntries(Object.entries(PATHS.rules).map(([root, rules]) => [root, rules.map((r) => ({ re: new RegExp(r.re), to: r.to }))]));
const SEGMENT = new RegExp(PATTERNS.segment);
const FOLDER = new RegExp(PATTERNS.pluginFolder);
export const MODES = ['local', 'shadow', 'cutover', 'rollback'];

/** The four roots, from the same env as the Python side. */
export function roots(env = process.env) {
  const data = env.AXF_STATE ? dirname(resolve(env.AXF_STATE)) : join(env.AXF_ROOT ? resolve(env.AXF_ROOT) : REPO, '.axf-console');
  return { plugins: resolve(env.AXF_PLUGINS_DATA_DIR || join(data, 'plugins')), data, repo: env.AXF_ROOT ? resolve(env.AXF_ROOT) : REPO, projects: resolve(env.AXHUB_PROJECTS_DIR || '/projects') };
}
/** Is `key` a key data-store@1 accepts (registry namespaces, segments, plugin folder)? */
export function validKey(key) {
  const i = key.indexOf('/'); const ns = i < 0 ? key : key.slice(0, i); const path = i < 0 ? '' : key.slice(i + 1);
  if (!NAMESPACES[ns] || NAMESPACES[ns].internal || !path || key.length > LIMITS.keyChars) return false;
  const segs = path.split('/');
  if (!segs.every((s) => SEGMENT.test(s) && s !== '.' && s !== '..')) return false;
  return !NAMESPACES[ns].open || (segs.length >= 2 && FOLDER.test(segs[0]));
}
/** A path relative to a root → its key, or null (stays local). */
export function mapRel(root, rel) {
  for (const { re, to } of RULES[root] || []) {
    const m = re.exec(rel);
    if (!m) continue;
    if (to === null) return null;
    const key = to.replace(/\{(\d)\}/g, (_, n) => m[Number(n)]);
    return validKey(key) ? key : null;
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
let modeCache = { mtime: -1, file: '', doc: null };
export function modeDoc(env = process.env) {
  const f = join(storeDir(env), 'mode.json');
  let mt;
  try { mt = statSync(f).mtimeMs; } catch { return { mode: 'local', namespaces: {} }; }
  if (modeCache.file !== f || modeCache.mtime !== mt) { let doc; try { doc = JSON.parse(readFileSync(f, 'utf8')); } catch { doc = { mode: 'local', namespaces: {} }; } modeCache = { mtime: mt, file: f, doc }; }
  return modeCache.doc;
}
export function modeOf(key, env = process.env) {
  const doc = modeDoc(env); const e = doc.namespaces?.[nsIdOf(key)];
  const m = e?.mode || doc.mode || 'local';
  return MODES.includes(m) ? m : 'local';
}

// ── axf-data ──
let remote = null;
/** The axf-data client (createDataStore over httpBackend), or null when AXF_DATA_URL is unset. Tests pass their own. */
export function remoteStore(env = process.env) {
  if (remote) return remote;
  if (!env.AXF_DATA_URL) return null;
  remote = createDataStore({ backend: httpBackend({ url: env.AXF_DATA_URL, token: () => env.AXF_DATA_TOKEN || '', actor: env.AXF_DATA_ACTOR || '' }) });
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
const refuseSync = (key, mode) => { throw new DataStoreError(mode === 'rollback' ? 'read_only' : 'unavailable', `${nsIdOf(key)} is in ${mode}: use the async call (readJson / writeJson)`); };

export function readTextSync(p, fallback = null) {
  const { key, mode } = route(p);
  if (mode === 'cutover' || mode === 'rollback') refuseSync(key, mode);
  try { return readFileSync(p, 'utf8'); } catch { return fallback; }
}
export function readJsonSync(p, fallback = null) {
  const t = readTextSync(p, null);
  if (t === null) return structuredClone(fallback);
  try { return JSON.parse(t); } catch { return structuredClone(fallback); }
}
export function writeTextSync(p, text) {
  const { key, mode } = route(p);
  if (mode === 'cutover' || mode === 'rollback') refuseSync(key, mode);
  writeAtomic(p, text);
  if (mode === 'shadow') mirror(async () => { try { await remotePut(needRemote(key), key, text); } catch (e) { logDrift('write', key, 'write-failed', null, null, `${e.code || 'error'}: ${e.message}`); } });
}
export function writeJsonSync(p, doc, indent = 2) { writeTextSync(p, `${JSON.stringify(doc, null, indent)}\n`); }
export function appendJsonlSync(p, entry) {
  const { key, mode } = route(p);
  if (mode === 'cutover' || mode === 'rollback') refuseSync(key, mode);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(entry)}\n`);
  if (mode === 'shadow' && kindOfKey(key) === 'journal') mirror(async () => { try { await needRemote(key).append(key, [entry], { idempotencyKey: randomUUID() }); } catch (e) { logDrift('append', key, 'append-failed', null, null, `${e.code || 'error'}: ${e.message}`); } });
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
  writeTextSync(p, text);
  await flush();
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
  if (mode === 'cutover' && kindOfKey(key) === 'journal') { await needRemote(key).append(key, [entry], { idempotencyKey: randomUUID() }); return; }
  appendJsonlSync(p, entry);
  await flush();
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

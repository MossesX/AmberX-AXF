/**
 * settings-source@1 — one true source for every setting (Brett, Nov 18 2026: "All settings need one true fucking source.").
 *
 * The registry framework/schemas/settings-sources.json maps a setting key (or key pattern) to exactly one owning store:
 * a data-store@1 document (`ns` + `path`, the file data-store-paths.json puts it in today) and a JSON pointer inside it.
 * Readers resolve through the owner; a write to any other store is refused. Spec: framework/spec/SETTINGS-SOURCES.md.
 *
 *   import { ownerOf, readSetting, writeSetting, assertOwner } from '…/settings-source.mjs';
 *   ownerOf('accounts.mossesx-max-.use')        → { entry, store, captures: { 1: 'mossesx-max-' }, pointer: '/perAccount/mossesx-max-/use', file }
 *   await readSetting('pipeline.maxRuns')         → { key, value, set, owner }
 *   await writeSetting('pipeline.maxRuns', 6, { by: 'plugin:build-orchestrator' })
 *   assertOwner('/projects/amberx-axf/_data/pipeline/accounts.json', 'accounts.x.use')   // throws not_owner
 *
 * Key patterns: dotted segments; `*` matches one segment (captured `{1}`, `{2}` …), a trailing `**` matches the rest
 * (captured `{rest}`: one pointer segment with its dots; `{rest/}`: nested, `.` → `/`). An exact entry beats a `*` entry beats a `**` entry; among patterns
 * more literal segments win. Two entries that could own one key at the same rank are an `ambiguous` registry error.
 *
 * Python twin: apps/console-web/server/settings_source.py (same registry, same answers; fixture spec/fixtures/settings-sources.json).
 */
import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataStoreError } from './data-store.mjs';
import { pathForKey, readJson, roots, updateJson, keyFor } from './data-files.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FRAME = 'settings-source@1';
export const REGISTRY_FRAME = 'settings-sources@1';
export const REGISTRY_FILE = join(REPO, 'framework/schemas/settings-sources.json');
export const STORE_KINDS = ['data-store', 'browser'];
export const CODES = ['no_owner', 'not_owner', 'ambiguous', 'unreachable', 'invalid_registry', 'invalid_key'];
const ROOT_NAMES = ['plugins', 'data', 'repo', 'projects'];

export class SettingsSourceError extends Error {
  constructor(code, message, extra = {}) { super(message || code); this.name = 'SettingsSourceError'; this.code = code; Object.assign(this, extra); }
}

// ── registry ──
let cache = { file: '', mtime: -1, size: -1, reg: null };
/** The registry document, validated (throws invalid_registry) and cached by mtime. `file` overrides the path (tests). */
export function loadRegistry(file = process.env.AXF_SETTINGS_SOURCES || REGISTRY_FILE) {
  let st; try { st = statSync(file); } catch (e) { throw new SettingsSourceError('invalid_registry', `settings-sources registry missing: ${file}`); }
  if (cache.file === file && cache.mtime === st.mtimeMs && cache.size === st.size) return cache.reg;
  let doc; try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new SettingsSourceError('invalid_registry', `settings-sources registry is not JSON: ${e.message}`); }
  const errors = registryErrors(doc);
  if (errors.length) throw new SettingsSourceError('invalid_registry', `settings-sources registry: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}`, { errors });
  cache = { file, mtime: st.mtimeMs, size: st.size, reg: doc };
  return doc;
}
/** Forget the cached registry (tests swap files). */
export function resetRegistry() { cache = { file: '', mtime: -1, size: -1, reg: null }; }

// ── patterns ──
const KEY_RE = /^[a-z][a-z0-9-]*(\.([a-z0-9][a-zA-Z0-9_-]*|\*))*(\.\*\*)?$/;
const CONCRETE_RE = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-zA-Z0-9_-]*)*$/;
/** Is `key` a concrete setting key (no wildcards)? */
export function validKey(key) { return typeof key === 'string' && key.length <= 240 && CONCRETE_RE.test(key); }
/** Is `pattern` a registry key or key pattern? */
export function validPattern(pattern) { return typeof pattern === 'string' && pattern.length <= 240 && KEY_RE.test(pattern) && !/\*\*\./.test(pattern); }
/** Compile a pattern: its segments, how many are literal, how many `*`, whether it ends in `**`. */
export function compilePattern(pattern) {
  if (!validPattern(pattern)) throw new SettingsSourceError('invalid_key', `bad key pattern "${pattern}"`);
  const segs = pattern.split('.');
  const rest = segs[segs.length - 1] === '**';
  const fixed = rest ? segs.slice(0, -1) : segs;
  const stars = fixed.filter((s) => s === '*').length;
  const literals = fixed.length - stars;
  return { pattern, segs: fixed, rest, stars, literals, exact: !rest && stars === 0 };
}
/** Rank: higher wins. Exact first, then no `**`, then more fixed segments, then more literal ones. */
export function rankOf(p) { const c = typeof p === 'string' ? compilePattern(p) : p; return (c.exact ? 1e6 : 0) + (c.rest ? 0 : 1e4) + c.segs.length * 100 + c.literals; }
/** Match a concrete key against a pattern → captures ({ 1: …, rest: 'a.b' }) or null. */
export function matchKey(pattern, key) {
  const c = typeof pattern === 'string' ? compilePattern(pattern) : pattern;
  const ks = String(key).split('.');
  if (c.rest ? ks.length <= c.segs.length : ks.length !== c.segs.length) return null;
  const caps = {}; let n = 0;
  for (let i = 0; i < c.segs.length; i += 1) {
    if (c.segs[i] === '*') { n += 1; caps[n] = ks[i]; } else if (c.segs[i] !== ks[i]) return null;
  }
  if (c.rest) caps.rest = ks.slice(c.segs.length).join('.');
  return caps;
}
/** Could the two patterns both match one key? (static, for the registry check) */
export function patternsOverlap(a, b) {
  const ca = typeof a === 'string' ? compilePattern(a) : a; const cb = typeof b === 'string' ? compilePattern(b) : b;
  const n = Math.min(ca.segs.length, cb.segs.length);
  for (let i = 0; i < n; i += 1) { const x = ca.segs[i], y = cb.segs[i]; if (x !== '*' && y !== '*' && x !== y) return false; }
  if (ca.segs.length === cb.segs.length) return true;
  // the shorter one must end in ** to reach the longer one's extra segments
  return ca.segs.length < cb.segs.length ? ca.rest : cb.rest;
}
const escapePtr = (s) => s.replace(/~/g, '~0').replace(/\//g, '~1');
const substitute = (tpl, caps) => String(tpl).replace(/\{(\d+|rest|rest\/)\}/g, (_, g) => (g === 'rest/' ? String(caps.rest ?? '').split('.').map(escapePtr).join('/') : g === 'rest' ? escapePtr(String(caps.rest ?? '')) : escapePtr(String(caps[g] ?? ''))));
/** The pointer with the captures filled in. */
export function resolvePointer(pointer, caps) { const p = substitute(pointer, caps); return p === '/' ? '' : p.replace(/\/+$/, ''); }

// ── JSON pointers ──
const unescape = (s) => s.replace(/~1/g, '/').replace(/~0/g, '~');
export const pointerSegments = (pointer) => (pointer === '' || pointer === '/' ? [] : String(pointer).replace(/^\//, '').split('/').map(unescape));
export function getAt(doc, pointer) {
  let cur = doc;
  for (const s of pointerSegments(pointer)) { if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, s)) return undefined; cur = cur[s]; }
  return cur;
}
export function setAt(doc, pointer, value) {
  const segs = pointerSegments(pointer);
  if (!segs.length) return value;
  const out = doc && typeof doc === 'object' && !Array.isArray(doc) ? { ...doc } : {};
  let cur = out;
  for (let i = 0; i < segs.length - 1; i += 1) { const k = segs[i]; cur[k] = cur[k] && typeof cur[k] === 'object' && !Array.isArray(cur[k]) ? { ...cur[k] } : {}; cur = cur[k]; }
  cur[segs[segs.length - 1]] = value;
  return out;
}
export function deleteAt(doc, pointer) {
  const segs = pointerSegments(pointer);
  if (!segs.length) return undefined;
  if (!doc || typeof doc !== 'object') return doc;
  const out = { ...doc }; let cur = out;
  for (let i = 0; i < segs.length - 1; i += 1) { const k = segs[i]; if (!cur[k] || typeof cur[k] !== 'object') return doc; cur[k] = { ...cur[k] }; cur = cur[k]; }
  delete cur[segs[segs.length - 1]];
  return out;
}

// ── registry validation ──
/** Every problem in a registry document, as plain lines ([] = valid). */
export function registryErrors(doc) {
  const out = [];
  if (!doc || typeof doc !== 'object' || doc.$axf !== REGISTRY_FRAME) return [`$axf must be ${REGISTRY_FRAME}`];
  const stores = doc.stores && typeof doc.stores === 'object' ? doc.stores : null;
  if (!stores) out.push('stores must be an object');
  const storeId = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9._-]*)*$/;
  for (const [id, s] of Object.entries(stores || {})) {
    if (!storeId.test(id)) out.push(`store "${id}": bad id`);
    if (!s || typeof s !== 'object') { out.push(`store "${id}": not an object`); continue; }
    if (!STORE_KINDS.includes(s.kind)) out.push(`store "${id}": kind must be one of ${STORE_KINDS.join(', ')}`);
    if (s.kind === 'data-store' && (typeof s.ns !== 'string' || typeof s.path !== 'string')) out.push(`store "${id}": a data-store store needs ns and path`);
    if (s.kind === 'browser' && typeof s.storageKey !== 'string') out.push(`store "${id}": a browser store needs storageKey`);
    if (typeof s.owner !== 'string' || !s.owner) out.push(`store "${id}": owner missing`);
    if (s.file !== undefined && typeof s.file !== 'string') out.push(`store "${id}": file must be a string template`);
  }
  if (!Array.isArray(doc.settings)) { out.push('settings must be an array'); return out; }
  const compiled = [];
  doc.settings.forEach((e, i) => {
    const at = `settings[${i}]${e && e.key ? ` (${e.key})` : ''}`;
    if (!e || typeof e !== 'object') { out.push(`${at}: not an object`); return; }
    if (!validPattern(e.key)) { out.push(`${at}: bad key pattern`); return; }
    if (!stores || !stores[e.store]) out.push(`${at}: unknown store "${e.store}"`);
    if (typeof e.pointer !== 'string' || (e.pointer !== '' && !e.pointer.startsWith('/'))) out.push(`${at}: pointer must be a JSON pointer`);
    if (!Array.isArray(e.mirrors) || e.mirrors.length) out.push(`${at}: mirrors must be [] (a copy is removed, never registered)`);
    if (!Array.isArray(e.readers) || !Array.isArray(e.writers)) out.push(`${at}: readers and writers must be arrays`);
    if (e.derive !== undefined && !/^not-in-list:\{\d+\}$/.test(String(e.derive))) out.push(`${at}: derive must be not-in-list:{n}`);
    const c = compilePattern(e.key);
    const allowed = new Set([...Array.from({ length: c.stars }, (_, k) => String(k + 1)), ...(c.rest ? ['rest'] : [])]);
    for (const m of String(e.derive || '').matchAll(/\{(\d+)\}/g)) if (!allowed.has(m[1])) out.push(`${at}: derive uses {${m[1]}} the key has no capture for`);
    for (const m of String(e.pointer || '').matchAll(/\{(\d+|rest|rest\/)\}/g)) if (!allowed.has(m[1].replace('/', ''))) out.push(`${at}: pointer uses {${m[1]}} the key has no capture for`);
    const st = stores?.[e.store];
    for (const m of String(st?.path || '').matchAll(/\{(\d+)\}/g)) if (!allowed.has(m[1])) out.push(`${at}: store path uses {${m[1]}} the key has no capture for`);
    if (c.rest && (typeof e.pointer !== 'string' || !/\{rest\/?\}/.test(e.pointer)) && e.pointer !== '') out.push(`${at}: a ** key needs {rest} or {rest/} in its pointer (or pointer "" for the whole document)`);
    for (const f of Array.isArray(e.formerly) ? e.formerly : []) { if (!f || !stores?.[f.store]) out.push(`${at}: formerly names unknown store "${f?.store}"`); if (f?.store === e.store && f?.pointer === e.pointer) out.push(`${at}: formerly repeats the owner`); }
    compiled.push({ i, c, e });
  });
  for (let a = 0; a < compiled.length; a += 1) for (let b = a + 1; b < compiled.length; b += 1) {
    const A = compiled[a], B = compiled[b];
    if (A.c.pattern === B.c.pattern) { out.push(`settings[${A.i}] and settings[${B.i}]: same key "${A.c.pattern}" twice`); continue; }
    if (rankOf(A.c) === rankOf(B.c) && patternsOverlap(A.c, B.c)) out.push(`settings[${A.i}] "${A.c.pattern}" and settings[${B.i}] "${B.c.pattern}" could both own one key (ambiguous)`);
  }
  return out;
}

// ── owner lookup ──
/** The absolute local file of a data-store store (template roots, env overrides, else the data-store key's file). */
export function storeFile(store, caps = {}, env = process.env) {
  if (store.kind !== 'data-store') return null;
  const r = roots(env);
  const path = substitute(store.path, caps);
  if (store.envFile && env[store.envFile]) return resolve(env[store.envFile]);
  if (store.envDir && env[store.envDir]) return join(resolve(env[store.envDir]), basename(path));
  if (store.file) { const f = substitute(store.file, caps).replace(/\{(plugins|data|repo|projects)\}/g, (_, n) => r[n]); return isAbsolute(f) ? f : join(r.repo, f); }
  return pathForKey(`${store.ns}/${path}`, env);
}
/**
 * Who owns `key`: { key, entry, store: { id, …store }, captures, pointer, storeKey, file } or null when no entry matches.
 * Throws `ambiguous` when two entries of the same rank match (the registry check catches this before it ships).
 */
export function ownerOf(key, { registry, env = process.env } = {}) {
  if (!validKey(key)) throw new SettingsSourceError('invalid_key', `bad setting key "${key}"`);
  const reg = registry || loadRegistry();
  let best = null; let tie = null;
  for (const e of reg.settings) {
    const c = compilePattern(e.key); const caps = matchKey(c, key);
    if (!caps) continue;
    const rank = rankOf(c);
    if (!best || rank > best.rank) { best = { e, caps, rank }; tie = null; } else if (rank === best.rank) tie = e;
  }
  if (!best) return null;
  if (tie) throw new SettingsSourceError('ambiguous', `"${key}" could belong to ${best.e.key} or ${tie.key}`, { entries: [best.e.key, tie.key] });
  const store = { id: best.e.store, ...reg.stores[best.e.store] };
  const storeKey = store.kind === 'data-store' ? `${store.ns}/${substitute(store.path, best.caps)}` : `browser:${store.storageKey}`;
  const derive = best.e.derive ? deriveSpec(best.e.derive, best.caps) : null;
  return { key, entry: best.e, store, captures: best.caps, pointer: resolvePointer(best.e.pointer, best.caps), storeKey, file: storeFile(store, best.caps, env), ...(derive ? { derive } : {}) };
}
/** Every registry entry with its store, for lists (the Sources view, the CLI, the API). */
export function listSources({ registry } = {}) {
  const reg = registry || loadRegistry();
  return reg.settings.map((e) => ({ key: e.key, label: e.label || '', store: e.store, pointer: e.pointer, owner: reg.stores[e.store]?.owner || '', editor: reg.stores[e.store]?.editor || '', kind: reg.stores[e.store]?.kind || '', readers: e.readers || [], writers: e.writers || [], formerly: e.formerly || [], api: reg.stores[e.store]?.api || null }));
}

// ── derived values: `not-in-list:{n}` = true when the captured name is absent from the array at the pointer ──
export function deriveSpec(derive, caps) { const m = /^not-in-list:\{(\d+)\}$/.exec(String(derive)); return m ? { kind: 'not-in-list', name: String(caps[m[1]] ?? '') } : null; }
export function deriveRead(owner, raw) { const list = Array.isArray(raw) ? raw : []; return owner.derive.kind === 'not-in-list' ? !list.includes(owner.derive.name) : raw; }
export function deriveWrite(owner, raw, value) {
  const list = Array.isArray(raw) ? raw.filter((x) => x !== owner.derive.name) : [];
  return value === false ? [...list, owner.derive.name] : list;
}

// ── read / write through the owner ──
const dataError = (e) => (e instanceof DataStoreError ? new SettingsSourceError('unreachable', e.message, { cause: e.code }) : e);
/** Read `key` through its owner: { key, owner, value, set, reachable }. A browser store is named, not read (reachable: false). */
export async function readSetting(key, opts = {}) {
  const owner = ownerOf(key, opts);
  if (!owner) throw new SettingsSourceError('no_owner', `"${key}" has no owner in settings-sources.json: register it first`);
  if (owner.store.kind !== 'data-store') return { key, owner, value: undefined, set: false, reachable: false };
  let doc; try { doc = await readJson(owner.file, null); } catch (e) { throw dataError(e); }
  const raw = doc === null ? undefined : getAt(doc, owner.pointer);
  const value = owner.derive ? deriveRead(owner, raw) : raw;
  return { key, owner, value, set: owner.derive ? doc !== null : value !== undefined, reachable: true };
}
/**
 * Write `key` through its owner. `store` (optional) is the store the caller believes it is writing: when it is not the
 * owner the write is refused with `not_owner`. `value === undefined` removes the key. Returns { key, owner, value, before }.
 */
export async function writeSetting(key, value, { by = '', store = '', registry, env = process.env } = {}) {
  const owner = ownerOf(key, { registry, env });
  if (!owner) throw new SettingsSourceError('no_owner', `"${key}" has no owner in settings-sources.json: register it first`);
  if (store && store !== owner.store.id) throw new SettingsSourceError('not_owner', `"${key}" is owned by ${owner.store.id}, not ${store}: change it there (${owner.store.editor || owner.store.owner})`, { owner: owner.store.id });
  if (owner.store.kind !== 'data-store') throw new SettingsSourceError('unreachable', `"${key}" lives in the browser (${owner.store.storageKey}): set it through console-control`, { owner: owner.store.id });
  if (by && Array.isArray(owner.entry.writers) && owner.entry.writers.length && !owner.entry.writers.includes(by)) throw new SettingsSourceError('not_owner', `${by} may not write "${key}": writers are ${owner.entry.writers.join(', ')}`, { owner: owner.store.id });
  let before;
  try {
    await updateJson(owner.file, (doc) => {
      const base = doc && typeof doc === 'object' ? doc : {};
      const raw = getAt(base, owner.pointer);
      before = owner.derive ? deriveRead(owner, raw) : raw;
      const next = owner.derive ? setAt(base, owner.pointer, deriveWrite(owner, raw, value)) : value === undefined ? deleteAt(base, owner.pointer) : setAt(base, owner.pointer, value);
      return owner.store.frame && next && typeof next === 'object' && !Array.isArray(next) && !next.$axf ? { $axf: owner.store.frame, ...next } : next;
    }, {});
  } catch (e) { throw dataError(e); }
  return { key, owner, value, before };
}
/**
 * For store writers: is `fileOrStore` (an absolute file path or a store id) the owner of `key`? Throws `not_owner` when it
 * is not, `no_owner` when the key is unregistered. Returns the owner.
 */
export function assertOwner(fileOrStore, key, opts = {}) {
  const owner = ownerOf(key, opts);
  if (!owner) throw new SettingsSourceError('no_owner', `"${key}" has no owner in settings-sources.json: register it first`);
  const env = opts.env || process.env;
  const same = owner.store.id === fileOrStore || (isAbsolute(String(fileOrStore)) && owner.file && resolve(fileOrStore) === resolve(owner.file))
    || (isAbsolute(String(fileOrStore)) && keyFor(fileOrStore, env) && keyFor(fileOrStore, env) === owner.storeKey);
  if (!same) throw new SettingsSourceError('not_owner', `"${key}" is owned by ${owner.store.id} (${owner.storeKey}), not ${fileOrStore}`, { owner: owner.store.id });
  return owner;
}
/** The former places of `key` (store + resolved pointer + file), for the migration helper and the check. */
export function formerPlaces(key, opts = {}) {
  const owner = ownerOf(key, opts);
  if (!owner) return [];
  const reg = opts.registry || loadRegistry();
  return (owner.entry.formerly || []).map((f) => { const store = { id: f.store, ...reg.stores[f.store] }; return { store, pointer: resolvePointer(f.pointer || '', owner.captures), file: storeFile(store, owner.captures, opts.env || process.env), note: f.note || '' }; });
}
export { ROOT_NAMES };

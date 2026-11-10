/**
 * inline-override@1 — the override store (build inline-element-editing-plugin-right-click-any-el s2, Fable).
 *
 * One record per (path, scope, token[, asset]): the element path (inline-edit-tokens@1), the scope (`item` = this
 * element only, `parent` = this element and everything under it), the token, the value, the axHub value it replaced,
 * who changed it and when (plus an optional reason). Brett (Nov 10 2026): "a monster list of everything changed from
 * axHub's inheritance, reset them individually to axHub's."
 *
 * Fits the axHub look rules (APPEARANCE-SOURCE.md, control-tokens.mjs): the records of one ROOT live in one look setting
 *
 *   axf.inline.<root>  = { "$axf": "inline-overrides@1", "r": { "<path>|<scope>|<token>[@<asset>]": { v, h, by, at, why? } } }
 *
 * `axf.inline.` is an appearance-setting prefix (core/engines/designpackage.ts), so the key rides `appearance@1 →
 * settings`: per key, last write wins, every developer app follows live, 4 KB per key (APPEARANCE_SETTING_MAX_BYTES);
 * a set that would push a root over the cap is refused by name, like a token set. `h` is the axHub value the record
 * replaced, kept on the record so the list shows from → to and a reset is honest about what it returns to.
 *
 * Resetting one item restores only that record: `unset` deletes exactly one key of one root; nothing else in that
 * root, no other root and no layer under the record is touched, so nothing re-inherits.
 *
 * Pure core (normalize / with / without / expand) + a small store over a settings adapter `{ get(key), set(key, value),
 * clear(key) }` (the runtime's settings, a plain Map in tests, the console server's appearance file). No DOM, no IO.
 * Kotlin twin deferred (framework/spec/PORTING.md).
 */
import { isPath, isWithin, parsePath, rootTextOf } from './element-map.mjs';
import { inlineLayer } from './resolve.mjs';

export const INLINE_OVERRIDE_FRAME = 'inline-override@1';
export const INLINE_OVERRIDES_FRAME = 'inline-overrides@1';
export const INLINE_PREFIX = 'axf.inline.';
/** The appearance engine's per-setting cap (engines/appearance.ts APPEARANCE_SETTING_MAX_BYTES). */
export const INLINE_MAX_BYTES = 4 * 1024;
export const INLINE_SCOPES = ['item', 'parent'];
export const INLINE_KEY = (root) => `${INLINE_PREFIX}${root}`;
export const isInlineKey = (key) => typeof key === 'string' && key.startsWith(INLINE_PREFIX) && isPath(key.slice(INLINE_PREFIX.length)) && !key.slice(INLINE_PREFIX.length).includes('/');

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const SCALAR = (v) => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const TOKEN = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$/;
const ASSET = /^[a-z0-9][a-z0-9-]{0,79}$/;
const BY = /^[A-Za-z0-9][A-Za-z0-9 ._@:/-]{0,79}$/;
const WHY_MAX = 200;

/** The record id: `<path>|<scope>|<token>[@<asset>]`. */
export const recordId = (path, scope, token, asset) => `${path}|${scope}|${token}${asset ? `@${asset}` : ''}`;
/** Parse a record id (null when malformed). */
export function parseRecordId(id) {
  if (typeof id !== 'string') return null;
  const m = /^([^|]+)\|(item|parent)\|([^|@]+)(?:@([a-z0-9][a-z0-9-]{0,79}))?$/.exec(id);
  if (!m || !isPath(m[1]) || !TOKEN.test(m[3]) || m[3].length > 80) return null;
  return { path: m[1], scope: m[2], token: m[3], asset: m[4] ?? null };
}

/** A saved setting value, shaped; anything malformed dropped (never an error). */
export function normalizeInlineOverrides(raw, root) {
  const out = { $axf: INLINE_OVERRIDES_FRAME, r: {} };
  if (!isObj(raw) || !isObj(raw.r)) return out;
  for (const [id, rec] of Object.entries(raw.r)) {
    const p = parseRecordId(id);
    if (!p || !isObj(rec) || !('v' in rec) || !SCALAR(rec.v)) continue;
    if (root && rootTextOf(p.path) !== root) continue; // a record of another root in this key: dropped
    const r = { v: rec.v, h: SCALAR(rec.h) ? rec.h : null, by: typeof rec.by === 'string' && BY.test(rec.by) ? rec.by : '', at: typeof rec.at === 'string' && !Number.isNaN(Date.parse(rec.at)) ? rec.at : '' };
    if (typeof rec.why === 'string' && rec.why.trim()) r.why = rec.why.trim().slice(0, WHY_MAX);
    if (typeof rec.from === 'string' && rec.from) r.from = rec.from.slice(0, 120);
    out.r[id] = r;
  }
  return out;
}

/** A compact record → the inline-override@1 record the API answers. */
export function expandRecord(id, rec, key) {
  const p = parseRecordId(id);
  if (!p) return null;
  return {
    $axf: INLINE_OVERRIDE_FRAME, id, root: rootTextOf(p.path), key: key ?? INLINE_KEY(rootTextOf(p.path)),
    path: p.path, scope: p.scope, token: p.token, asset: p.asset, value: rec.v, axHubValue: rec.h ?? null,
    by: rec.by ?? '', at: rec.at ?? '', reason: rec.why ?? '', migratedFrom: rec.from ?? null,
  };
}

/** Every record of one setting value, expanded, in path order. */
export function expandInlineOverrides(raw, root) {
  const n = normalizeInlineOverrides(raw, root);
  const key = root ? INLINE_KEY(root) : undefined;
  return Object.entries(n.r).map(([id, rec]) => expandRecord(id, rec, key)).filter(Boolean).sort(byPath);
}

const byPath = (a, b) => (a.path === b.path ? (a.scope === b.scope ? a.token.localeCompare(b.token) : a.scope === 'parent' ? -1 : 1) : a.path < b.path ? -1 : 1);

/** Validate the fields of a set; every problem named (empty = fine). */
export function overrideErrors({ path, scope = 'item', token, value, axHubValue = null, by = '', reason = '', asset = null } = {}) {
  const errors = [];
  if (!isPath(path)) errors.push('path: not an element path (inline-edit-tokens@1)');
  if (!INLINE_SCOPES.includes(scope)) errors.push(`scope: ${String(scope)} (item | parent)`);
  if (typeof token !== 'string' || !TOKEN.test(token) || token.length > 80) errors.push('token: a token id (textColor, field.variant, nav.colors.text)');
  if (!SCALAR(value)) errors.push('value: a string, number, boolean or null');
  if (!SCALAR(axHubValue)) errors.push('axHubValue: a string, number, boolean or null');
  if (by && !BY.test(by)) errors.push('by: up to 80 plain characters');
  if (reason && (typeof reason !== 'string' || reason.length > WHY_MAX)) errors.push(`reason: up to ${WHY_MAX} characters`);
  if (asset !== null && asset !== undefined && !ASSET.test(String(asset))) errors.push('asset: an asset id');
  return errors;
}

/** A setting value with one record set. Throws when the root would go over the cap or a field is wrong. */
export function withInlineOverride(raw, rec, now = new Date().toISOString()) {
  const errors = overrideErrors(rec);
  if (errors.length) throw new Error(errors.join('; '));
  const root = rootTextOf(rec.path);
  const o = normalizeInlineOverrides(raw, root);
  const id = recordId(rec.path, rec.scope ?? 'item', rec.token, rec.asset ?? undefined);
  const r = { v: rec.value, h: rec.axHubValue ?? null, by: rec.by ?? '', at: rec.at ?? now };
  if (rec.reason) r.why = String(rec.reason).trim().slice(0, WHY_MAX);
  if (rec.migratedFrom) r.from = String(rec.migratedFrom).slice(0, 120);
  o.r[id] = r;
  const bytes = JSON.stringify(o).length;
  if (bytes > INLINE_MAX_BYTES) throw new Error(`too many overrides on ${root} (${bytes} bytes, over ${INLINE_MAX_BYTES}): reset some first`);
  return o;
}

/** A setting value with exactly one record dropped; null = nothing left in this root. `false` when the record was not there. */
export function withoutInlineOverride(raw, path, token, scope = 'item', asset = null) {
  const root = rootTextOf(path);
  const o = normalizeInlineOverrides(raw, root);
  const id = recordId(path, scope, token, asset ?? undefined);
  if (!(id in o.r)) return false;
  delete o.r[id];
  return Object.keys(o.r).length ? o : null;
}

/* ---------------- the store ---------------- */

/**
 * `createOverridesStore({ settings, roots?, now?, by? })`
 *   settings  { get(key) → value | undefined, set(key, value), clear(key) }  (the runtime's settings or any map)
 *   roots()   the root keys to list when `settings` cannot enumerate its keys (default: `settings.keys?.()` filtered)
 *
 *   get(path, token, scope = 'item', asset?)       the record or null
 *   set({ path, scope, token, value, axHubValue, by, reason, asset })   the record written (throws: validation, cap)
 *   unset(path, token, scope = 'item', asset?)     true when a record was removed; only that record
 *   list({ root?, kind?, q?, token?, by?, scope?, since?, under? })   every record, filtered, path order
 *   roots()                                        [{ root, kind, instance, key, count }]
 *   effectiveFor(path, activeAsset?)               { [token]: record } in force at path (resolve.mjs inlineLayer)
 *   records(root?)                                 raw expanded records of one root (or all)
 */
export function createOverridesStore({ settings, roots, now = () => new Date().toISOString(), by = '' } = {}) {
  if (!settings || typeof settings.get !== 'function' || typeof settings.set !== 'function' || typeof settings.clear !== 'function') throw new Error('createOverridesStore: settings { get, set, clear } required');
  const rootKeys = () => {
    const keys = typeof roots === 'function' ? roots().map((r) => (r.startsWith(INLINE_PREFIX) ? r : INLINE_KEY(r))) : typeof settings.keys === 'function' ? [...settings.keys()] : [];
    return [...new Set(keys.filter(isInlineKey))].sort();
  };
  const records = (root) => {
    if (root) return expandInlineOverrides(settings.get(INLINE_KEY(root)), root);
    return rootKeys().flatMap((k) => expandInlineOverrides(settings.get(k), k.slice(INLINE_PREFIX.length))).sort(byPath);
  };
  return {
    records,
    get(path, token, scope = 'item', asset = null) {
      const root = rootTextOf(path);
      if (!root) return null;
      return records(root).find((r) => r.id === recordId(path, scope, token, asset ?? undefined)) ?? null;
    },
    set(rec) {
      const root = rootTextOf(rec?.path);
      if (!root) throw new Error('path: not an element path (inline-edit-tokens@1)');
      const key = INLINE_KEY(root);
      const value = withInlineOverride(settings.get(key), { by, ...rec }, now());
      settings.set(key, value);
      return this.get(rec.path, rec.token, rec.scope ?? 'item', rec.asset ?? null);
    },
    unset(path, token, scope = 'item', asset = null) {
      const root = rootTextOf(path);
      if (!root) return false;
      const key = INLINE_KEY(root);
      const next = withoutInlineOverride(settings.get(key), path, token, scope, asset);
      if (next === false) return false;
      if (next === null) settings.clear(key); else settings.set(key, next);
      return true;
    },
    list(select = {}) {
      const { root, kind, q, token, by: who, scope, since, under } = select;
      let out = records(root && isPath(root) ? root : undefined);
      if (kind) out = out.filter((r) => parsePath(r.path)?.root.kind === kind);
      if (token) out = out.filter((r) => r.token === token);
      if (who) out = out.filter((r) => r.by === who);
      if (scope) out = out.filter((r) => r.scope === scope);
      if (since) { const t = Date.parse(since); if (!Number.isNaN(t)) out = out.filter((r) => Date.parse(r.at) >= t); }
      if (under && isPath(under)) out = out.filter((r) => isWithin(r.path, under));
      if (q) { const needle = String(q).toLowerCase(); out = out.filter((r) => `${r.path} ${r.token} ${String(r.value)} ${r.by} ${r.reason}`.toLowerCase().includes(needle)); }
      return out;
    },
    roots() {
      return rootKeys().map((k) => {
        const root = k.slice(INLINE_PREFIX.length);
        const p = parsePath(root);
        return { root, kind: p?.root.kind ?? '', instance: p?.root.instance ?? '', key: k, count: records(root).length };
      }).filter((r) => r.count > 0);
    },
    effectiveFor(path, activeAsset) {
      const root = rootTextOf(path);
      return root ? inlineLayer(records(root), path, activeAsset) : {};
    },
  };
}

/** A settings adapter over a plain object or Map (tests, the console server's appearance file). */
export function mapSettings(init = {}) {
  const m = init instanceof Map ? init : new Map(Object.entries(init));
  return { get: (k) => m.get(k), set: (k, v) => { m.set(k, v); }, clear: (k) => { m.delete(k); }, keys: () => m.keys(), toObject: () => Object.fromEntries(m) };
}

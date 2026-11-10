/**
 * Migration 2026-11: existing element overrides → inline-override@1 records (build
 * inline-element-editing-plugin-right-click-any-el s2, Fable).
 *
 * What exists today and where it goes:
 *
 *   axf.custom.<type>                 asset-customize@1 (Settings → Appearance → Assets; this device only since Nov 1 2026)
 *     { all, shared: {token: value}, byId: {assetId: {token: value}} }
 *     → root `<type>:app`, scope `parent`, one record per token; `shared` values (or every asset's while `all`) become
 *       general records, `byId` values (when `all` is off) keep `asset: <id>`. axHubValue = the token's default ("theme").
 *   axf.chrome.<type>.<instance>      chrome-settings@1 instance overrides (this device)
 *     { field: value } → root `<type>:<instance>`, scope `parent`, token `field.<key>`; axHubValue = the active asset's own
 *       value when `assetData(type)` is given, else null.
 *   axf.chrome.<type>.<instance>.asset   the instance's own asset pick: not a token, left alone (listed in `skipped`).
 *   axf.tokens.<set>                  control@1 token sets: already an API target and a layer of their own; left alone.
 *   nav-style accents (`accents.<item>` inside axf.tokens.nav): a nav-style field, left alone.
 *
 * Non-destructive by default: `migrateInlineOverrides` only computes. `applyMigration` writes the new keys and clears the
 * legacy ones only with `clearLegacy: true`, because until the phase that compiles inline records to CSS lands the legacy
 * keys are what styles the screen. Idempotent: a record that already exists is not rewritten (`existing` wins), so running
 * it twice changes nothing. Pure, no IO. Kotlin twin deferred (framework/spec/PORTING.md).
 */
import { INLINE_KEY, INLINE_PREFIX, expandInlineOverrides, normalizeInlineOverrides, recordId, withInlineOverride } from '../overrides-store.mjs';

export const MIGRATION_ID = '2026-11-inline-overrides';
export const CUSTOM_PREFIX = 'axf.custom.';
export const CHROME_PREFIX = 'axf.chrome.';
const TYPE = /^[a-z][a-z0-9-]*$/;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const SCALAR = (v) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

/** The customize token defaults by key (spec = customize.json). */
const defaultsOf = (spec) => Object.fromEntries((spec?.tokens ?? []).map((t) => [t.key, t.default]));
const typesOf = (spec) => new Set(Object.keys(spec?.targets ?? {}));

/**
 * Compute the migration. `settings` is a plain object (key → saved value) or anything with `entries()`.
 * Options: `spec` (customize.json, required for custom tokens), `assetData(type)` (the active asset's data, optional),
 * `now`, `by` (default "migration"), `existing(key)` (the current axf.inline.* values, to keep records already there).
 * Answer: `{ id, records, writes: { key: value }, clears: [key…], skipped: [{ key, why }], counts }`.
 */
export function migrateInlineOverrides(settings, { spec, assetData, now = new Date().toISOString(), by = 'migration', existing } = {}) {
  const entries = settings instanceof Map ? [...settings.entries()] : typeof settings?.entries === 'function' && !Array.isArray(settings) ? [...settings.entries()] : Object.entries(settings ?? {});
  const defaults = defaultsOf(spec);
  const knownTypes = typesOf(spec);
  const writes = {};
  const clears = [];
  const skipped = [];
  const records = [];
  const current = (key) => (key in writes ? writes[key] : typeof existing === 'function' ? existing(key) : undefined);

  const add = (rec, from) => {
    const key = INLINE_KEY(rec.path.split('/')[0]);
    const before = normalizeInlineOverrides(current(key), rec.path.split('/')[0]);
    const id = recordId(rec.path, rec.scope, rec.token, rec.asset ?? undefined);
    if (id in before.r) { skipped.push({ key: from, why: `${id} already migrated` }); return; }
    try {
      writes[key] = withInlineOverride(current(key), { ...rec, by, at: now, migratedFrom: from }, now);
      records.push(expandInlineOverrides(writes[key], rec.path.split('/')[0]).find((r) => r.id === id));
    } catch (e) {
      skipped.push({ key: from, why: `${id}: ${e.message}` });
    }
  };

  for (const [key, raw] of entries) {
    if (typeof key !== 'string') continue;
    if (key.startsWith(CUSTOM_PREFIX)) {
      const type = key.slice(CUSTOM_PREFIX.length);
      if (!TYPE.test(type) || !knownTypes.has(type)) { skipped.push({ key, why: 'not a customizable asset type' }); continue; }
      if (!isObj(raw)) { skipped.push({ key, why: 'not a customize slot' }); continue; }
      const all = raw.all !== false;
      let n = 0;
      const put = (values, asset) => {
        if (!isObj(values)) return;
        for (const [token, value] of Object.entries(values)) {
          if (!(token in defaults) || !SCALAR(value) || value === defaults[token]) continue;
          add({ path: `${type}:app`, scope: 'parent', token, value, axHubValue: defaults[token], asset: asset ?? null }, key);
          n++;
        }
      };
      if (all) put(raw.shared, null);
      else if (isObj(raw.byId)) for (const [asset, values] of Object.entries(raw.byId)) put(values, asset);
      if (n) clears.push(key); else skipped.push({ key, why: 'nothing set (every value is the theme’s)' });
      continue;
    }
    if (key.startsWith(CHROME_PREFIX)) {
      const rest = key.slice(CHROME_PREFIX.length);
      if (rest.startsWith('settings.')) { skipped.push({ key, why: 'the settings interface pick, not a token' }); continue; }
      if (rest.endsWith('.asset')) { skipped.push({ key, why: 'the instance’s own asset pick, not a token' }); continue; }
      const dot = rest.indexOf('.');
      const type = dot > 0 ? rest.slice(0, dot) : '';
      const instance = dot > 0 ? rest.slice(dot + 1) : '';
      if (!TYPE.test(type) || !instance || !isObj(raw)) { skipped.push({ key, why: 'not an instance override' }); continue; }
      const base = typeof assetData === 'function' ? assetData(type) : null;
      let n = 0;
      for (const [field, value] of Object.entries(raw)) {
        if (!SCALAR(value) || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(field)) continue;
        add({ path: `${type}:${instance}`, scope: 'parent', token: `field.${field}`, value, axHubValue: isObj(base) && SCALAR(base[field]) ? base[field] : null }, key);
        n++;
      }
      if (n) clears.push(key); else skipped.push({ key, why: 'nothing set' });
      continue;
    }
  }
  return { id: MIGRATION_ID, records, writes, clears, skipped, counts: { records: records.length, keys: Object.keys(writes).length, clears: clears.length, skipped: skipped.length } };
}

/**
 * Write a computed migration through a settings adapter `{ set(key, value), clear(key) }`. The legacy keys are cleared
 * only with `clearLegacy: true` (see the header). Answers what it did.
 */
export function applyMigration(result, settings, { clearLegacy = false } = {}) {
  if (!result || !isObj(result.writes)) throw new Error('applyMigration: a result of migrateInlineOverrides');
  for (const [key, value] of Object.entries(result.writes)) settings.set(key, value);
  if (clearLegacy) for (const key of result.clears) settings.clear(key);
  return { written: Object.keys(result.writes), cleared: clearLegacy ? [...result.clears] : [], kept: clearLegacy ? [] : [...result.clears] };
}

/** Is this settings key one the migration reads? (for a "legacy overrides present" note) */
export const isLegacyOverrideKey = (key) => typeof key === 'string' && (key.startsWith(CUSTOM_PREFIX) || (key.startsWith(CHROME_PREFIX) && !key.startsWith(`${CHROME_PREFIX}settings.`) && !key.endsWith('.asset')));
export const isMigratedKey = (key) => typeof key === 'string' && key.startsWith(INLINE_PREFIX);

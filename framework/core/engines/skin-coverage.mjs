/**
 * skin-coverage@1 (build skins-asset-types, Nov 2026, Brett: "Upgrade the skins system so it styles EVERY asset type
 * now in the registry … Pull the full asset-type list from the registry dynamically so new types are covered
 * automatically going forward (no hardcoded list); add a CI check that fails if a registered asset type has no skin
 * coverage.").
 *
 * How a skin reaches each registered asset type is worked out from the registry itself (`schemas/asset-types.json`,
 * passed in: this file never imports JSON so the console can bake it), plus the style targets the customize engine
 * draws with (`schemas/customize.json` targets). Nothing here names a type; the registry declares the few exceptions
 * on the type entry (`"skin": { "by": … }`) and everything else is derived from the type's flags:
 *
 *   slot       the skin picks the active asset of the type (an appearance slot: every type not in `never`)
 *   parts      the skin styles the type's drawn elements with style parts (customize tokens) under the type's style
 *              target; widgets and attachables (many copies on banners and toolbars) are covered this way
 *   reference  the skin names an asset of the type through a field (`iconPack` → icon-pack) or through another asset
 *              it picks (`via`, e.g. logo marks through the branding slot)
 *   bundle     the type is itself a whole look the skin stands in for (design package, style package, interface, skin)
 *   none       the type has no look (an access policy, help text, a job type); declared with a `why`
 *   uncovered  a type the skin can't reach: a widget without a style target, or an excluded type with no declaration.
 *              `uncoveredTypes()` is what CI fails on.
 *
 * Composite assets (Brett: "button = box + text, nav = container + items"): a type's style target gives the elements
 * the parts reach — `box` (the root), `text`, `icon`, and `items` when the target names them — so one `parts` block
 * styles every element of the type at once.
 *
 * Scopes (same model as icon maps, `engines/iconmap-rules.mjs`): a skin applies to the whole hub (`global`), one app
 * (`app`), one UI / screen (`ui:<id>`) or one plugin (`plugin:<id>`); the chain from the most specific place to the root
 * is [plugin, ui, app, global] and the child overrides the parent.
 *
 * Plain JS shared by the TS engine (skin.ts), the build engine, the CLI and the console server. Pure.
 */

export const SKIN_COVERAGE_CONTRACT = 'skin-coverage@1';
/** The ways a skin reaches a type, in the order a table lists them. */
export const COVERAGE_KINDS = ['slot', 'parts', 'reference', 'bundle', 'none'];
/** The elements a style target can reach (composite assets). */
export const PART_ELEMENTS = ['box', 'text', 'icon', 'items'];

/* ---------------------------------------------------------------- scopes */

export const SKIN_SCOPE_KINDS = ['global', 'app', 'ui', 'plugin'];
export const SKIN_SCOPE_GLOBAL = 'global';
export const SKIN_SCOPE_APP = 'app';
const SCOPE_ID = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

/** `{ app, ui, plugin }` with only ids a scope key may carry. */
export function normalizeSkinScope(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const id = (v) => (SCOPE_ID.test(str(v, 120)) ? str(v, 120) : '');
  return { app: id(o.app), ui: id(o.ui), plugin: id(o.plugin) };
}

/** The key of the most specific level a place names: `plugin:<id>`, `ui:<id>` or `app`. */
export function skinScopeKey(scope) {
  const s = normalizeSkinScope(scope);
  if (s.plugin) return `plugin:${s.plugin}`;
  if (s.ui) return `ui:${s.ui}`;
  return SKIN_SCOPE_APP;
}

/** Which kind of level a key is. */
export function skinScopeKind(key) {
  if (key === SKIN_SCOPE_GLOBAL) return 'global';
  if (typeof key === 'string' && key.startsWith('plugin:')) return 'plugin';
  if (typeof key === 'string' && key.startsWith('ui:')) return 'ui';
  return 'app';
}

/** Is this a scope key a look document may hold under `scopes` (never `app` or `global`: those have their own place)? */
export function isSubScopeKey(key) {
  return typeof key === 'string' && /^(ui|plugin):[a-z0-9][a-z0-9._-]{0,119}$/.test(key);
}

/** The chain of keys from the most specific level to the root for one place: [plugin:x, ui:y, app, global]. */
export function skinScopeChain(scope) {
  const s = normalizeSkinScope(scope);
  const out = [];
  if (s.plugin) out.push(`plugin:${s.plugin}`);
  if (s.ui) out.push(`ui:${s.ui}`);
  out.push(SKIN_SCOPE_APP, SKIN_SCOPE_GLOBAL);
  return out;
}

/** A scope key back to a scope (`app` = the app itself). */
export function skinScopeOf(key, app = '') {
  const kind = skinScopeKind(key);
  if (kind === 'plugin') return { app, ui: '', plugin: key.slice(7) };
  if (kind === 'ui') return { app, ui: key.slice(3), plugin: '' };
  return { app, ui: '', plugin: '' };
}

/**
 * The scope element id a UI / plugin level's skin is drawn under (`data-fx-scope`, the interface engine's scope root:
 * ids are lower-case letters, digits, `-` and `_`, 64 at most), '' for the app and the hub (the page itself).
 */
export function skinScopeDomId(key) {
  const kind = skinScopeKind(key);
  if (kind !== 'plugin' && kind !== 'ui') return '';
  const id = key.slice(kind.length + 1).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  return `skin-${kind}-${id}`.slice(0, 64);
}

/** The CSS selector a level's skin is drawn under ('' = the whole app, nothing to scope). */
export function skinScopeSelector(key) {
  const id = skinScopeDomId(key);
  return id ? `[data-fx-scope="${id}"]` : '';
}

/**
 * Walk a chain of per-level skin states and say which skin is in force at the leaf. Each state is
 * `{ use: 'on' | 'off' | 'inherit', id, overrides }` (a missing level reads as inherit); the first level from the leaf
 * that isn't `inherit` decides. Overrides of the deciding level and of every level nearer the leaf apply, the child's
 * over the parent's. Result: `{ id, overrides, from }` (`from` = the deciding key) or `{ id: '', overrides: {}, from }`
 * when that level says off, or `from: ''` when every level inherits.
 */
export function resolveSkinChain(chain, stateOf) {
  const seen = [];
  for (const key of chain) {
    const st = stateOf(key) || { use: 'inherit' };
    seen.push({ key, st });
    if (st.use === 'inherit') continue;
    if (st.use !== 'on' || !st.id) return { id: '', overrides: {}, from: key };
    const overrides = {};
    for (let i = seen.length - 1; i >= 0; i--) Object.assign(overrides, seen[i].st.overrides ?? {});
    return { id: st.id, overrides, from: key };
  }
  return { id: '', overrides: {}, from: '' };
}

/* ---------------------------------------------------------------- coverage */

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The `skin` block a type may declare in the registry, checked; null when it has none. */
export function declaredCoverage(typeSpec) {
  const d = isObj(typeSpec) && isObj(typeSpec.skin) ? typeSpec.skin : null;
  if (!d) return null;
  const by = COVERAGE_KINDS.includes(d.by) ? d.by : '';
  return { by, via: str(d.via, 80), why: str(d.why, 300) };
}

/** Problems with a type's declaration (CI lists them): a kind outside the list, `none` without a why. */
export function declarationErrors(type, typeSpec) {
  const d = isObj(typeSpec) && isObj(typeSpec.skin) ? typeSpec.skin : null;
  if (!d) return [];
  const out = [];
  if (!COVERAGE_KINDS.includes(d.by)) out.push(`${type}: skin.by must be one of ${COVERAGE_KINDS.join(', ')}`);
  if (d.by === 'none' && !str(d.why, 300).trim()) out.push(`${type}: skin.by "none" needs a why`);
  if (d.by === 'reference' && !str(d.via, 80).trim()) out.push(`${type}: skin.by "reference" needs via (the field or slot that names it)`);
  return out;
}

/** The elements of a type a style target reaches (composite assets): box, text, icon, and items when it names them. */
export function partElements(target) {
  if (!isObj(target) || typeof target.root !== 'string' || !target.root.trim()) return [];
  return target.item ? ['box', 'text', 'icon', 'items'] : ['box', 'text', 'icon'];
}

/**
 * How a skin covers one type. `spec` = asset-types.json `types`, `targets` = customize.json `targets`, `never` = the
 * slot types a skin never sets (skin-rules SKIN_NEVER). Returns `{ type, by, also, elements, declared, via, why }`.
 */
export function coverageOf(type, spec, targets = {}, never = []) {
  const t = isObj(spec) ? spec[type] : null;
  const target = isObj(targets) ? targets[type] : null;
  const elements = partElements(target);
  const base = { type, label: str(t?.label, 80) || type, group: str(t?.group, 40), also: [], elements, declared: false, via: '', why: '' };
  if (!t) return { ...base, by: 'uncovered', why: 'not a registered asset type' };
  const errors = declarationErrors(type, t);
  if (errors.length) return { ...base, by: 'uncovered', declared: true, why: errors.join('; ') };
  const d = declaredCoverage(t);
  if (d) {
    const also = d.by !== 'parts' && elements.length ? ['parts'] : [];
    return { ...base, by: d.by, also, declared: true, via: d.via, why: d.why };
  }
  const widget = t.widget === true || t.attachable === true;
  if (widget) {
    if (elements.length) return { ...base, by: 'parts' };
    return { ...base, by: 'uncovered', why: 'a widget or attachable type with no style target (schemas/customize.json targets)' };
  }
  if (never.includes(type)) return { ...base, by: 'uncovered', why: 'excluded from appearance slots and not declared (add "skin": { "by": … } to its registry entry)' };
  return { ...base, by: 'slot', also: elements.length ? ['parts'] : [] };
}

/** Every registered type in registry order with its coverage. */
export function coverageTable(spec, targets = {}, never = []) {
  return Object.keys(isObj(spec) ? spec : {}).map((type) => coverageOf(type, spec, targets, never));
}

/** The rows CI fails on. */
export function uncoveredTypes(spec, targets = {}, never = []) {
  return coverageTable(spec, targets, never).filter((r) => r.by === 'uncovered');
}

/** Counts per kind for a summary line. */
export function coverageSummary(rows) {
  const out = { total: rows.length, uncovered: 0 };
  for (const k of COVERAGE_KINDS) out[k] = 0;
  for (const r of rows) { if (r.by in out) out[r.by]++; else out.uncovered++; }
  return out;
}

/** The types a skin's `parts` may name: everything with a style target, registry order. */
export function partsTypes(spec, targets = {}) {
  return Object.keys(isObj(spec) ? spec : {}).filter((t) => partElements(isObj(targets) ? targets[t] : null).length);
}

/** Validation messages for a skin's `parts` block: unknown types, types without a style target, values that aren't maps. */
export function partsErrors(parts, spec, targets = {}) {
  if (parts === undefined) return [];
  if (!isObj(parts)) return ['data.parts must be an object (asset type → style parts)'];
  const out = [];
  for (const [type, values] of Object.entries(parts)) {
    if (!isObj(spec) || !spec[type]) out.push(`data.parts.${type}: not a registered asset type`);
    else if (!partElements(isObj(targets) ? targets[type] : null).length) out.push(`data.parts.${type}: this type has no style target, so a skin can't style its parts`);
    if (!isObj(values)) out.push(`data.parts.${type} must be an object (token → value)`);
  }
  return out;
}

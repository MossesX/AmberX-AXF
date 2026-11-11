/**
 * skin-coverage@1 (build skins-asset-types, Nov 2026, Brett: "Upgrade the skins system so it styles EVERY asset type
 * now in the registry … Pull the full asset-type list from the registry dynamically so new types are covered
 * automatically going forward (no hardcoded list); add a CI check that fails if a registered asset type has no skin
 * coverage.").
 *
 * How a skin reaches each registered asset type is declared on the type's registry entry (`schemas/asset-types.json`,
 * passed in: this file never imports JSON so the console can bake it) and checked against the type's flags and the
 * style targets the customize engine draws with (`schemas/customize.json` targets). Nothing here names a type. Every
 * type carries `"skin": { "by": …, "parts"?, "ingredient"?, "via"?, "why"? }` (build skins-restyle-everything, Nov 9
 * 2026: explicit on every type, so a new type can't merge without saying how a skin reaches it):
 *
 *   slot       the skin picks the active asset of the type (an appearance slot). `parts: true` = it also styles the
 *              type's drawn elements (needs a style target). `ingredient: true` = the type is what a skin is made of
 *              (its colour theme, style theme, layout, typography, density, sizing …): picked, never styled with
 *              parts; `via` names the skin@1 field that holds a theme (`colorTheme` = the skin's colour theme section)
 *   parts      the skin styles the type's drawn elements with style parts (customize tokens) under the type's style
 *              target; widgets and attachables (many copies on banners and toolbars) are covered this way
 *   reference  the skin names an asset of the type through a field (`iconPack` → icon-pack) or through another asset
 *              it picks (`via`, e.g. logo marks through the branding slot)
 *   bundle     the type is itself a whole look the skin stands in for (design package, style package, interface, skin)
 *   none       the type has no look (an access policy, help text, a job type); declared with a `why`
 *   uncovered  a type the skin can't reach: no `skin` entry, a bad one, or one its flags or style target contradict
 *              (parts without a style target, a style target the entry doesn't mention, a widget declared as a slot,
 *              a slot a skin never sets). `uncoveredTypes()` is what CI fails on.
 *
 * Every registered type carries an explicit declaration (build skins-restyle-everything, Nov 2026) so a reader of the
 * registry sees how a skin reaches it without running this engine; nothing is derived from flags any more, so a type
 * added without one is uncovered. A skin ingredient (`ingredient: true`, with `by: slot`) is a type the skin is made of: the colour,
 * style and layout themes, typography, density, sizing and the behaviour theme set the `--fx-*` tokens every rule
 * reads and draw nothing of their own, so they never get a style target or parts and a screenshot gate skips them.
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
/** The skin@1 fields that hold a theme: what a theme ingredient's `via` may name. */
export const SKIN_THEME_FIELDS = ['layoutTheme', 'colorTheme', 'styleTheme'];

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

/** The `skin` block a type declares in the registry, checked; null when it has none. */
export function declaredCoverage(typeSpec) {
  const d = isObj(typeSpec) && isObj(typeSpec.skin) ? typeSpec.skin : null;
  if (!d) return null;
  const by = COVERAGE_KINDS.includes(d.by) ? d.by : '';
  return { by, parts: d.parts === true, ingredient: d.ingredient === true, via: str(d.via, 80), why: str(d.why, 300) };
}

/** Is the type a skin ingredient (declared `skin: { by: slot, ingredient: true }`)? */
export function isIngredient(typeSpec) {
  return declaredCoverage(typeSpec)?.ingredient === true;
}

/**
 * Problems with a type's declaration alone (CI lists them): a kind outside the list, `none` without a why, a
 * `reference` without a via, `parts` or `ingredient` on anything but a slot, an ingredient that also takes parts or
 * names a field that is not one of the skin's themes.
 */
export function declarationErrors(type, typeSpec) {
  const d = isObj(typeSpec) && isObj(typeSpec.skin) ? typeSpec.skin : null;
  if (!d) return [];
  const out = [];
  if (!COVERAGE_KINDS.includes(d.by)) out.push(`${type}: skin.by must be one of ${COVERAGE_KINDS.join(', ')}`);
  if (d.by === 'none' && !str(d.why, 300).trim()) out.push(`${type}: skin.by "none" needs a why`);
  if (d.by === 'reference' && !str(d.via, 80).trim()) out.push(`${type}: skin.by "reference" needs via (the field or slot that names it)`);
  for (const k of ['parts', 'ingredient']) if (k in d && typeof d[k] !== 'boolean') out.push(`${type}: skin.${k} must be true or false`);
  if (d.parts === true && d.by !== 'slot') out.push(`${type}: skin.parts is for a slot that also takes style parts (skin.by "parts" already says it)`);
  if (d.ingredient === true && d.by !== 'slot') out.push(`${type}: a skin ingredient is a slot the skin picks (skin.by "slot")`);
  if (d.ingredient === true && d.parts === true) out.push(`${type}: a skin ingredient is picked, not styled with parts`);
  if (d.ingredient === true && str(d.via, 80) && !SKIN_THEME_FIELDS.includes(d.via)) out.push(`${type}: an ingredient's skin.via names a theme field of the skin (${SKIN_THEME_FIELDS.join(', ')})`);
  return out;
}

/**
 * Where a (valid) declaration and the rest of the registry disagree: parts with no style target to draw them under, a
 * style target the entry doesn't mention, a widget or attachable declared as one slot, a slot a skin never sets.
 */
export function declarationConflicts(type, typeSpec, target, never = []) {
  const d = declaredCoverage(typeSpec);
  if (!d || !d.by) return [];
  const out = [];
  const takesParts = d.by === 'parts' || d.parts;
  const hasTarget = partElements(target).length > 0;
  if (takesParts && !hasTarget) out.push(`${type}: declares style parts but has no style target (schemas/customize.json targets)`);
  if (!takesParts && hasTarget) out.push(`${type}: has a style target its skin entry doesn't mention (skin.by "parts", or "parts": true on a slot)`);
  if (d.by === 'slot' && (typeSpec.widget === true || typeSpec.attachable === true)) out.push(`${type}: a widget or attachable type has many copies, not one slot (skin.by "parts")`);
  if (d.by === 'slot' && never.includes(type)) out.push(`${type}: a skin never sets this slot (skin.by "bundle", "reference" or "none")`);
  return out;
}

/** The elements of a type a style target reaches (composite assets): box, text, icon, and items when it names them. */
export function partElements(target) {
  if (!isObj(target) || typeof target.root !== 'string' || !target.root.trim()) return [];
  return target.item ? ['box', 'text', 'icon', 'items'] : ['box', 'text', 'icon'];
}

/** The line an undeclared type gets. */
export const NO_SKIN_ENTRY = 'no skin entry: add "skin": { "by": … } to its registry entry (schemas/asset-types.json)';

/**
 * How a skin covers one type. `spec` = asset-types.json `types`, `targets` = customize.json `targets`, `never` = the
 * slot types a skin never sets (skin-rules SKIN_NEVER). Returns `{ type, by, also, elements, declared, ingredient,
 * via, why }`; `by: 'uncovered'` carries the reason in `why`.
 */
export function coverageOf(type, spec, targets = {}, never = []) {
  const t = isObj(spec) ? spec[type] : null;
  const target = isObj(targets) ? targets[type] : null;
  const elements = partElements(target);
  const base = { type, label: str(t?.label, 80) || type, group: str(t?.group, 40), also: [], elements, declared: false, ingredient: false, via: '', why: '' };
  if (!t) return { ...base, by: 'uncovered', why: 'not a registered asset type' };
  const d = declaredCoverage(t);
  if (!d) return { ...base, by: 'uncovered', why: NO_SKIN_ENTRY };
  const strip = (e) => e.slice(type.length + 2);
  const errors = declarationErrors(type, t);
  if (errors.length) return { ...base, by: 'uncovered', declared: true, why: errors.map(strip).join('; ') };
  const conflicts = declarationConflicts(type, t, target, never);
  if (conflicts.length) return { ...base, by: 'uncovered', declared: true, why: conflicts.map(strip).join('; ') };
  return { ...base, by: d.by, also: d.parts ? ['parts'] : [], declared: true, ingredient: d.ingredient, via: d.via, why: d.why };
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

/** The types a skin is made of (declared `ingredient`), registry order: its themes and scale assets. */
export function skinIngredients(spec) {
  return Object.keys(isObj(spec) ? spec : {}).filter((t) => declaredCoverage(spec[t])?.ingredient && !declarationErrors(t, spec[t]).length);
}

/** The registry type whose assets a skin theme field holds (`colorTheme` → color-theme), '' when none declares it. */
export function ingredientOfField(spec, field) {
  return skinIngredients(spec).find((t) => declaredCoverage(spec[t]).via === field) ?? '';
}

/** The types a skin's `parts` may name: everything with a style target, registry order. */
export function partsTypes(spec, targets = {}) {
  return Object.keys(isObj(spec) ? spec : {}).filter((t) => !isIngredient(spec[t]) && partElements(isObj(targets) ? targets[t] : null).length);
}

/** Validation messages for a skin's `parts` block: unknown types, types without a style target, values that aren't maps. */
export function partsErrors(parts, spec, targets = {}) {
  if (parts === undefined) return [];
  if (!isObj(parts)) return ['data.parts must be an object (asset type → style parts)'];
  const out = [];
  for (const [type, values] of Object.entries(parts)) {
    if (!isObj(spec) || !spec[type]) out.push(`data.parts.${type}: not a registered asset type`);
    else if (isIngredient(spec[type])) out.push(`data.parts.${type}: a skin ingredient (the skin picks it; it draws nothing of its own, so it has no parts)`);
    else if (!partElements(isObj(targets) ? targets[type] : null).length) out.push(`data.parts.${type}: this type has no style target, so a skin can't style its parts`);
    if (!isObj(values)) out.push(`data.parts.${type} must be an object (token → value)`);
  }
  return out;
}

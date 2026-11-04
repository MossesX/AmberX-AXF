/**
 * chrome-settings@1 — every piece of chrome has a settings interface that is itself an asset (Brett, Nov 4 2026,
 * build tab-group-assets: "all tab groups are supposed to be assets. With a settings interface, that's also an asset."
 * Addendum 1: "navigation menus, toolbars, banners, are all asset types, and they all have a settings interface, which
 * is an asset, and we can get to their settings by right-clicking all of them." Addendum 2 + 3: one shared default
 * settings interface per type, a custom copy per app made automatically, and the shared default selected by default).
 *
 * ONE rules file, plain JS so the TS engines, the build engine (axf init), the CLI (cli/chrome-settings.mjs), the
 * control@1 commands and the React layer all read the same registry:
 *
 *   CHROME_TYPES           the chrome asset types that have a settings interface: tab-group, toolbar, banner,
 *                          nav-menu, app-menu, context-menu (an open list: add a type here and ship its two assets)
 *   settings asset `for`   a `settings` asset (settings-ui@1) whose data.for names a chrome type is that type's
 *                          settings interface: the shared default is `settings/chrome-<type>` (framework/assets),
 *                          the app's custom copy `settings/chrome-<type>-<app>` with data.extends = the default's id
 *   extends                inherit@1: fields the custom copy doesn't set come from the asset it extends (depth ≤ 4)
 *   pick                   setting `axf.chrome.settings.<type>` = the settings asset the dialog renders through;
 *                          unset = the shared default (Brett, addendum 3), the custom copy sits ready in the picker
 *   instance overrides     setting `axf.chrome.<type>.<instance>` = { field: value } over the active asset's data for
 *                          one tab group / toolbar / … (only CHROME_FIELDS of that type), `…<instance>.asset` = the
 *                          asset a tab group picked for itself (tab groups are many; the other kinds are one per app)
 *   context targets        the data-fx-ctx-target names a right-click / long-press on that chrome kind reports
 *   moves                  where each kind can be moved from its context menu and which setting does it
 *
 * Kotlin twin deferred (Android on hold, spec/PORTING.md); fixture spec/fixtures/chrome-settings.json.
 */

export const CHROME_SETTINGS_CONTRACT = 'chrome-settings@1';
export const CHROME_TYPES = ['tab-group', 'toolbar', 'banner', 'nav-menu', 'app-menu', 'context-menu'];
export const CHROME_LABELS = { 'tab-group': 'Tab group', toolbar: 'Toolbar', banner: 'Banner', 'nav-menu': 'Navigation menu', 'app-menu': 'Application menu', 'context-menu': 'Context menu' };
export const CHROME_ICONS = { 'tab-group': 'layers', toolbar: 'sliders', banner: 'menu', 'nav-menu': 'list', 'app-menu': 'menu', 'context-menu': 'grid' };
/** How many assets of the type one app shows at once: tab groups are many (each row its own instance), the rest one. */
export const CHROME_MANY = { 'tab-group': true, toolbar: false, banner: false, 'nav-menu': false, 'app-menu': false, 'context-menu': false };

export const CHROME_SETTINGS_PREFIX = 'chrome-';
export const CHROME_SETTINGS_MAX_DEPTH = 4;
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const INSTANCE = /^[a-z0-9][a-z0-9._:/-]{0,119}$/i;

export const isChromeType = (t) => typeof t === 'string' && CHROME_TYPES.includes(t);
export const chromeLabel = (t) => CHROME_LABELS[t] ?? String(t);

/** An app id as it appears in a custom copy's id (`chrome-tab-group-axf-console`). */
export function appSlug(app) {
  const s = String(app ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'app';
}
/** The shared default settings interface of a chrome type (ships in framework/assets/settings). */
export const chromeSettingsDefaultId = (type) => `${CHROME_SETTINGS_PREFIX}${type}`;
/** The app's own copy of it (written by axf init / chrome-settings.mjs backfill). */
export const chromeSettingsCustomId = (type, app) => `${CHROME_SETTINGS_PREFIX}${type}-${appSlug(app)}`;
/** Which chrome type a settings asset id is the default or a custom copy for, or null. */
export function chromeTypeOfSettingsId(id) {
  if (typeof id !== 'string' || !id.startsWith(CHROME_SETTINGS_PREFIX)) return null;
  const rest = id.slice(CHROME_SETTINGS_PREFIX.length);
  return CHROME_TYPES.filter((t) => rest === t || rest.startsWith(`${t}-`)).sort((a, b) => b.length - a.length)[0] ?? null;
}

/* ---------------- settings keys ---------------- */

/** The settings asset the dialog of a chrome type renders through (unset = the shared default). */
export const CHROME_SETTINGS_PICK_KEY = (type) => `axf.chrome.settings.${type}`;
/** In-app edits to the app's custom copy: a patch over the copy's data (reset = clear it). */
export const CHROME_SETTINGS_PATCH_KEY = (type) => `axf.chrome.settings.custom.${type}`;
/** One instance's field overrides over the active asset (`{ style: 'pills', position: 'left' }`). */
export const CHROME_INSTANCE_KEY = (type, instance) => `axf.chrome.${type}.${instance}`;
/** The asset one tab group picked for itself (tab groups only; the other kinds swap the app's slot). */
export const CHROME_INSTANCE_ASSET_KEY = (type, instance) => `axf.chrome.${type}.${instance}.asset`;
/** A tab group's remembered tab and fold state (per device). */
export const TAB_GROUP_LAST_KEY = (instance) => `axf.tabs.${instance}.last`;
export const TAB_GROUP_FOLD_KEY = (instance) => `axf.tabs.${instance}.folded`;
export const isChromeInstanceId = (id) => typeof id === 'string' && INSTANCE.test(id);

/* ---------------- context targets + moves ---------------- */

/** data-fx-ctx-target names each chrome kind reports on right-click / long-press (several per kind: older names kept). */
export const CHROME_TARGETS = { 'tab-group': ['tab-group'], toolbar: ['toolbar'], banner: ['banner', 'axf-banner'], 'nav-menu': ['nav', 'nav-item'], 'app-menu': ['app-menu', 'menubar'], 'context-menu': [] };
export function chromeTypeOfTarget(target) {
  if (typeof target !== 'string') return null;
  for (const t of CHROME_TYPES) if (CHROME_TARGETS[t].includes(target)) return t;
  return null;
}

/** Where a kind can be moved from its context menu, and the setting that does it. */
export const CHROME_MOVES = {
  'tab-group': { positions: ['top', 'bottom', 'left', 'right'], via: 'instance', field: 'position' },
  toolbar: { positions: ['top', 'bottom'], via: 'layout', field: 'toolbarPosition' },
  'nav-menu': { positions: ['left', 'right', 'top'], via: 'layout', field: 'nav' },
  banner: { positions: [], via: 'none', field: '' },
  'app-menu': { positions: [], via: 'none', field: '' },
  'context-menu': { positions: [], via: 'none', field: '' },
};
export const POSITION_LABELS = { top: 'Top', bottom: 'Bottom', left: 'Left', right: 'Right' };

/* ---------------- the fields a settings dialog edits per type ---------------- */

const DENSITY = ['compact', 'regular', 'roomy'];
const SURFACE = ['flat', 'raised', 'glass'];
/**
 * Every field the chrome settings dialog offers, per type: the asset type's own data fields a person may override
 * for one instance (the asset itself stays untouched; the override is a setting). `group` = the dialog tab, `level`
 * = settings-ui@1 level it shows from. Kinds: choice (options), toggle, number (min/max).
 */
export const CHROME_FIELDS = {
  'tab-group': [
    { key: 'style', label: 'Tab style', kind: 'choice', options: ['underline', 'pills', 'boxed', 'segmented', 'plain', 'chips'], group: 'look', level: 'simple' },
    { key: 'position', label: 'Position', kind: 'choice', options: ['top', 'bottom', 'left', 'right'], group: 'look', level: 'simple' },
    { key: 'display', label: 'Show', kind: 'choice', options: ['both', 'text', 'icons'], labels: { both: 'Icons + text', text: 'Text', icons: 'Icons' }, group: 'look', level: 'simple' },
    { key: 'density', label: 'Size', kind: 'choice', options: DENSITY, group: 'look', level: 'basic' },
    { key: 'align', label: 'Align', kind: 'choice', options: ['start', 'center', 'end', 'stretch'], group: 'look', level: 'basic' },
    { key: 'divider', label: 'Rule under the row', kind: 'toggle', group: 'look', level: 'basic' },
    { key: 'badges', label: 'Count badges', kind: 'toggle', group: 'look', level: 'basic' },
    { key: 'overflow', label: 'When tabs do not fit', kind: 'choice', options: ['scroll', 'wrap', 'more', 'dropdown'], labels: { scroll: 'Scroll', wrap: 'Wrap', more: 'More menu', dropdown: 'Dropdown' }, group: 'behaviour', level: 'basic' },
    { key: 'sticky', label: 'Sticky', kind: 'toggle', group: 'behaviour', level: 'basic' },
    { key: 'collapsible', label: 'Collapsible', kind: 'toggle', group: 'behaviour', level: 'basic' },
    { key: 'rememberLast', label: 'Remember last tab', kind: 'toggle', group: 'behaviour', level: 'basic' },
    { key: 'closable', label: 'Closable (where the host allows)', kind: 'toggle', group: 'behaviour', level: 'developer' },
    { key: 'reorderable', label: 'Reorderable (where the host allows)', kind: 'toggle', group: 'behaviour', level: 'developer' },
  ],
  toolbar: [
    { key: 'variant', label: 'Buttons', kind: 'choice', options: ['icons', 'icons-labels', 'labels'], labels: { icons: 'Icons', 'icons-labels': 'Icons + labels', labels: 'Labels' }, group: 'look', level: 'simple' },
    { key: 'align', label: 'Align', kind: 'choice', options: ['start', 'center', 'spread'], group: 'look', level: 'basic' },
    { key: 'density', label: 'Size', kind: 'choice', options: DENSITY, group: 'look', level: 'basic' },
    { key: 'surface', label: 'Surface', kind: 'choice', options: SURFACE, group: 'look', level: 'basic' },
    { key: 'divider', label: 'Rule between groups', kind: 'toggle', group: 'look', level: 'basic' },
    { key: 'showSearch', label: 'Search box', kind: 'toggle', group: 'behaviour', level: 'basic' },
    { key: 'collapsible', label: 'Collapsible', kind: 'toggle', group: 'behaviour', level: 'basic' },
  ],
  banner: [
    { key: 'surface', label: 'Surface', kind: 'choice', options: ['flat', 'raised', 'accent'], group: 'look', level: 'simple' },
    { key: 'height', label: 'Height', kind: 'number', min: 16, max: 48, group: 'look', level: 'basic' },
    { key: 'divider', label: 'Rule under the banner', kind: 'toggle', group: 'look', level: 'basic' },
  ],
  'nav-menu': [
    { key: 'style', label: 'Style', kind: 'choice', options: ['list', 'pills', 'rail'], group: 'look', level: 'simple' },
    { key: 'density', label: 'Size', kind: 'choice', options: DENSITY, group: 'look', level: 'basic' },
    { key: 'indicator', label: 'Active mark', kind: 'choice', options: ['auto', 'bar', 'fill', 'none'], group: 'look', level: 'basic' },
    { key: 'showIcons', label: 'Icons', kind: 'toggle', group: 'look', level: 'basic' },
    { key: 'navStyle', label: 'Sub menus (nav-style)', kind: 'toggle', group: 'behaviour', level: 'developer' },
  ],
  'app-menu': [
    { key: 'density', label: 'Size', kind: 'choice', options: DENSITY, group: 'look', level: 'simple' },
    { key: 'surface', label: 'Surface', kind: 'choice', options: SURFACE, group: 'look', level: 'basic' },
  ],
  'context-menu': [
    { key: 'variant', label: 'Style', kind: 'choice', options: ['compact', 'roomy', 'glass'], group: 'look', level: 'simple' },
    { key: 'showIcons', label: 'Icons', kind: 'toggle', group: 'look', level: 'basic' },
    { key: 'showShortcuts', label: 'Shortcuts', kind: 'toggle', group: 'look', level: 'basic' },
  ],
};

/** The tabs every chrome settings interface starts with (a settings asset may relabel, reorder or hide them). */
export const CHROME_SETTINGS_TABS = [
  { id: 'look', label: 'Look', icon: 'palette', order: 10 },
  { id: 'behaviour', label: 'Behaviour', icon: 'sliders', order: 20 },
  { id: 'asset', label: 'Asset', icon: 'layers', order: 30 },
  { id: 'interface', label: 'Interface', icon: 'settings', order: 40 },
];

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One instance override, cleaned: only this type's fields, only values the field allows; `{}` when nothing. */
export function normalizeInstanceOverride(type, raw) {
  const out = {};
  if (!isObj(raw) || !CHROME_FIELDS[type]) return out;
  for (const f of CHROME_FIELDS[type]) {
    const v = raw[f.key];
    if (v === undefined || v === null) continue;
    if (f.kind === 'toggle' && typeof v === 'boolean') out[f.key] = v;
    else if (f.kind === 'choice' && typeof v === 'string' && f.options.includes(v)) out[f.key] = v;
    else if (f.kind === 'number' && typeof v === 'number' && Number.isFinite(v)) out[f.key] = Math.min(f.max ?? v, Math.max(f.min ?? v, Math.round(v)));
  }
  return out;
}

/** An instance's effective data: the active asset's data with the instance's overrides written over it (a copy). */
export function chromeInstanceData(type, base, override) {
  return { ...(isObj(base) ? base : {}), ...normalizeInstanceOverride(type, override) };
}

/** The value one field has after an override, else in the base, else undefined. */
export function chromeFieldValue(type, base, override, key) {
  const o = normalizeInstanceOverride(type, override);
  return key in o ? o[key] : isObj(base) ? base[key] : undefined;
}

/** What is wrong with a settings asset that names a chrome type (data.for / data.extends); [] when nothing. */
export function chromeSettingsErrors(asset) {
  const errors = [];
  const d = isObj(asset) && isObj(asset.data) ? asset.data : null;
  if (!d) return ['not an asset'];
  if (d.for !== undefined && !isChromeType(d.for)) errors.push(`data.for: not a chrome type (${CHROME_TYPES.join(', ')})`);
  if (d.extends !== undefined) {
    if (typeof d.extends !== 'string' || !ID.test(d.extends)) errors.push('data.extends: must be a settings asset id');
    else if (d.extends === asset.id) errors.push('data.extends: an asset cannot extend itself');
  }
  if (d.for && typeof asset.id === 'string' && !asset.id.startsWith(`${CHROME_SETTINGS_PREFIX}${d.for}`)) errors.push(`id: a settings interface for ${d.for} is named chrome-${d.for}[-<app>]`);
  return errors;
}

/**
 * inherit@1: the data of a settings asset with its `extends` chain folded in (the child's fields win; empty arrays and
 * missing fields fall through to the parent; `levelOf` / `visible` merge key by key). `get(id)` returns an asset or
 * null. Cycles and chains deeper than CHROME_SETTINGS_MAX_DEPTH stop where they are. The result carries no `extends`.
 */
export function resolveSettingsChain(get, id, seen = []) {
  const a = typeof get === 'function' ? get(id) : null;
  if (!a || !isObj(a.data)) return null;
  const own = { ...a.data };
  const parentId = typeof own.extends === 'string' ? own.extends : '';
  delete own.extends;
  if (!parentId || seen.includes(id) || seen.length >= CHROME_SETTINGS_MAX_DEPTH) return own;
  const parent = resolveSettingsChain(get, parentId, [...seen, id]);
  if (!parent) return own;
  const out = { ...parent };
  for (const [k, v] of Object.entries(own)) {
    if (Array.isArray(v)) { if (v.length) out[k] = v; }
    else if (isObj(v) && isObj(parent[k])) out[k] = { ...parent[k], ...v };
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

/** The settings asset a chrome type's dialog renders through: the saved pick when it exists, else the shared default. */
export function chromeSettingsPick(saved, type, ids) {
  const list = Array.isArray(ids) ? ids : [];
  if (typeof saved === 'string' && list.includes(saved) && chromeTypeOfSettingsId(saved) === type) return saved;
  const d = chromeSettingsDefaultId(type);
  return list.includes(d) ? d : null;
}

/** The choices a picker offers for a chrome type: the shared default first, then every custom copy / other interface for it. */
export function chromeSettingsChoices(type, assets) {
  const d = chromeSettingsDefaultId(type);
  const mine = (Array.isArray(assets) ? assets : []).filter((a) => a && typeof a.id === 'string' && (a.id === d || (isObj(a.data) && a.data.for === type) || chromeTypeOfSettingsId(a.id) === type));
  return [...mine.filter((a) => a.id === d), ...mine.filter((a) => a.id !== d).sort((a, b) => a.id.localeCompare(b.id))].map((a) => ({ id: a.id, name: a.name ?? a.id, custom: a.id !== d, extends: isObj(a.data) && typeof a.data.extends === 'string' ? a.data.extends : '' }));
}

/**
 * The app's custom copy of a shared default (addendum 2): the same data (so every validator is happy) plus
 * `extends` = the default's id, so fields it never edits keep following the default (inherit@1).
 */
export function customCopy(defaultAsset, app) {
  if (!isObj(defaultAsset) || !isObj(defaultAsset.data) || !isChromeType(defaultAsset.data.for)) throw new Error('customCopy: a shared default chrome settings asset is needed');
  const type = defaultAsset.data.for;
  const appId = isObj(app) ? app.id : app;
  const appName = (isObj(app) && app.name) || appId;
  return {
    $axf: 'asset@1',
    type: 'settings',
    id: chromeSettingsCustomId(type, appId),
    name: `${chromeLabel(type)} settings (${appName})`,
    version: '1.0.0',
    description: `${appName}'s own copy of the shared ${chromeLabel(type).toLowerCase()} settings interface (${defaultAsset.id}). It follows the default until it is edited; the default stays selected until you pick this one (chrome-settings@1).`,
    author: 'AmberX AXF',
    tags: ['custom', 'chrome-settings', appSlug(appId)],
    data: { ...structuredClone(defaultAsset.data), extends: defaultAsset.id },
  };
}

/** Every (type, default id, custom id) an app must have. */
export function chromeSettingsPlan(appId) {
  return CHROME_TYPES.map((type) => ({ type, defaultId: chromeSettingsDefaultId(type), customId: chromeSettingsCustomId(type, appId) }));
}

/** What an app is missing: the ids of defaults and custom copies not in `ids`. */
export function chromeSettingsMissing(appId, ids) {
  const have = new Set(Array.isArray(ids) ? ids : []);
  const missing = [];
  for (const p of chromeSettingsPlan(appId)) { if (!have.has(p.defaultId)) missing.push(p.defaultId); if (!have.has(p.customId)) missing.push(p.customId); }
  return missing;
}

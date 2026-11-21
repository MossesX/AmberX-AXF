/**
 * settings-iface@1 — every asset type and every plugin has its own settings interface (Brett, Nov 18 2026, build
 * settings-iface-default-all: "a locked default for EVERY asset and plugin").
 *
 * A settings interface is a `settings` asset (core/engines/settingsui.ts). Each one says who it is built for in the
 * required field `data.builtFor`, one owner:
 *   app             the Settings page itself (standard, side-tabs, console, …)
 *   asset:<type>    one asset type's settings (Settings → Assets, the type's card)
 *   plugin:<name>   one plugin's settings (Settings → Plugins → <plugin>); name = the last dotted segment of its library id
 *   chrome:<type>   a chrome kind's settings dialog (chrome-settings@1, data.for; chrome-settings-rules.mjs)
 *
 * Every asset type and plugin owner gets a default named `default-<name>` (a plugin whose name is also an asset type
 * gets `default-<name>-plugin`, so the two never share an id). The default is what the owner's settings use until the
 * person ticks "Use another settings interface" and picks one built for that same owner. Unticking clears the pick
 * and the owner is back on its default. No interface is shared between owners for now: the picker lists only assets
 * whose builtFor equals the owner.
 *
 * The pick lives in the setting `axf.settings.iface.<kind>.<name>` (the owner with ':' → '.'), absent = default.
 * Actions (console-visible: REST /api/console-control, MCP console tools, CLI `axf console`, voice):
 *   settings.iface:<kind>:<name>:<settings id|default>   pick (default = untick, back to the locked default)
 *   settings.iface.choose:<kind>:<name>                   open the picker dialog
 *
 * Pure: no DOM, no runtime. The reference engine; the Kotlin twin is deferred (framework/spec/PORTING.md).
 * Golden outputs: framework/spec/fixtures/settings-iface.json (node framework/spec/check-settings-iface.mjs --write).
 */

export const SETTINGS_IFACE_CONTRACT = 'settings-iface@1';
export const SETTINGS_IFACE_KINDS = ['app', 'asset', 'plugin', 'chrome'];
export const SETTINGS_IFACE_FIELD = 'builtFor';
export const SETTINGS_IFACE_DEFAULT_PREFIX = 'default-';
export const SETTINGS_IFACE_PLUGIN_SUFFIX = '-plugin';
export const SETTINGS_IFACE_KEY_PREFIX = 'axf.settings.iface.';
/** The data every generated default carries besides builtFor: the layout fields settings@1 requires. */
export const SETTINGS_IFACE_DEFAULT_DATA = { layout: 'tabs-top', header: 'compact', search: false, descriptions: true, hide: [], levelOf: {} };

const NAME = /^[a-z0-9][a-z0-9-]{0,38}$/;
const ID_MAX = 48;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `{ kind, name }` of a builtFor value, or null when it is not one. `app` has an empty name. */
export function parseBuiltFor(v) {
  if (v === 'app') return { kind: 'app', name: '' };
  if (typeof v !== 'string') return null;
  const i = v.indexOf(':');
  if (i < 0) return null;
  const kind = v.slice(0, i);
  const name = v.slice(i + 1);
  if (!SETTINGS_IFACE_KINDS.includes(kind) || kind === 'app' || !NAME.test(name)) return null;
  return { kind, name };
}

/** The owner string for a kind and a name (`plugin:sample-notes`); `app` for the Settings page. */
export function ifaceOwner(kind, name = '') {
  if (kind === 'app') return 'app';
  const owner = `${kind}:${name}`;
  return parseBuiltFor(owner) ? owner : null;
}

/** Errors of a builtFor value (asset-types.json: data.builtFor is required for settings). */
export function builtForErrors(v) {
  if (v === undefined) return ['data.builtFor is required for settings (app | asset:<type> | plugin:<name> | chrome:<type>)'];
  return parseBuiltFor(v) ? [] : [`data.builtFor must be app, asset:<type>, plugin:<name> or chrome:<type> (not ${JSON.stringify(v)})`];
}

/** A plugin's owner name from its library id: the last dotted segment, lower-case, a-z0-9 and dashes. */
export function pluginIfaceName(moduleId) {
  const last = String(moduleId ?? '').split('.').filter(Boolean).pop() ?? '';
  const slug = last.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 39);
  return NAME.test(slug) ? slug : '';
}

/**
 * The default settings interface id of an owner: `default-<name>` (plugins named like an asset type:
 * `default-<name>-plugin`), the chrome kind's shared default `chrome-<type>`, `standard` for the Settings page.
 */
export function ifaceDefaultId(owner, assetTypes = []) {
  const o = parseBuiltFor(owner);
  if (!o) return null;
  if (o.kind === 'app') return 'standard';
  if (o.kind === 'chrome') return `chrome-${o.name}`;
  const clash = o.kind === 'plugin' && Array.isArray(assetTypes) && assetTypes.includes(o.name);
  const id = `${SETTINGS_IFACE_DEFAULT_PREFIX}${o.name}${clash ? SETTINGS_IFACE_PLUGIN_SUFFIX : ''}`;
  return id.length <= ID_MAX ? id : id.slice(0, ID_MAX).replace(/-+$/, '');
}

/** The setting that holds an owner's pick (absent = its default). */
export function ifaceKey(owner) {
  return parseBuiltFor(owner) ? `${SETTINGS_IFACE_KEY_PREFIX}${owner.replace(':', '.')}` : null;
}

/** The owner a saved key belongs to, or null. */
export function ownerOfIfaceKey(key) {
  if (typeof key !== 'string' || !key.startsWith(SETTINGS_IFACE_KEY_PREFIX)) return null;
  const rest = key.slice(SETTINGS_IFACE_KEY_PREFIX.length);
  if (rest === 'app') return 'app';
  const i = rest.indexOf('.');
  if (i < 0) return null;
  const owner = `${rest.slice(0, i)}:${rest.slice(i + 1)}`;
  return parseBuiltFor(owner) ? owner : null;
}

/**
 * Who an asset is built for: its data.builtFor when valid; otherwise (an asset saved before builtFor existed) the chrome
 * kind its data.for names, a chrome default id, a `default-<name>` id read as an asset type when it is one, else the
 * Settings page. Never throws.
 */
export function builtForOf(asset, assetTypes = []) {
  const d = isObj(asset?.data) ? asset.data : {};
  if (parseBuiltFor(d.builtFor)) return d.builtFor;
  if (typeof d.for === 'string' && NAME.test(d.for)) return `chrome:${d.for}`;
  const id = typeof asset?.id === 'string' ? asset.id : '';
  if (id.startsWith(SETTINGS_IFACE_DEFAULT_PREFIX)) {
    const name = id.slice(SETTINGS_IFACE_DEFAULT_PREFIX.length);
    if (name.endsWith(SETTINGS_IFACE_PLUGIN_SUFFIX)) return `plugin:${name.slice(0, -SETTINGS_IFACE_PLUGIN_SUFFIX.length)}`;
    if (Array.isArray(assetTypes) && assetTypes.includes(name)) return `asset:${name}`;
    if (NAME.test(name)) return `plugin:${name}`;
  }
  return 'app';
}

/** The full asset@1 default for an owner (what install-time files and the runtime fallback both use). */
export function ifaceDefaultAsset(owner, { label = '', assetTypes = [] } = {}) {
  const o = parseBuiltFor(owner);
  if (!o || o.kind === 'app' || o.kind === 'chrome') return null;
  const what = label || o.name;
  return {
    $axf: 'asset@1',
    type: 'settings',
    id: ifaceDefaultId(owner, assetTypes),
    name: `${what} settings (default)`,
    version: '1.0.0',
    description: `The default settings interface for the ${what} ${o.kind === 'asset' ? 'asset type' : 'plugin'}: locked until another interface built for it is picked (${SETTINGS_IFACE_CONTRACT}).`,
    author: 'AmberX AXF',
    tags: ['default', SETTINGS_IFACE_CONTRACT, o.kind],
    data: { ...SETTINGS_IFACE_DEFAULT_DATA, hide: [], levelOf: {}, builtFor: owner },
  };
}

/**
 * The picker's list for an owner: the default first, then every other settings asset built for exactly this owner
 * (no sharing between owners), sorted by name. `[{ id, name, description, isDefault }]`.
 */
export function ifaceChoices(owner, assets, assetTypes = []) {
  const d = ifaceDefaultId(owner, assetTypes);
  const mine = (Array.isArray(assets) ? assets : []).filter((a) => a && typeof a.id === 'string' && builtForOf(a, assetTypes) === owner);
  const row = (a) => ({ id: a.id, name: typeof a.name === 'string' && a.name ? a.name : a.id, description: typeof a.description === 'string' ? a.description : '', isDefault: a.id === d });
  return [...mine.filter((a) => a.id === d).map(row), ...mine.filter((a) => a.id !== d).map(row).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))];
}

/**
 * What an owner's settings use now: `{ id, defaultId, locked, source }`. locked = on the default (the checkbox is
 * unticked). A saved pick that is gone or built for another owner falls back to the default, so settings always open.
 */
export function ifacePick(saved, owner, assets, assetTypes = []) {
  const defaultId = ifaceDefaultId(owner, assetTypes);
  const ids = ifaceChoices(owner, assets, assetTypes).map((c) => c.id);
  if (typeof saved === 'string' && saved && saved !== defaultId && ids.includes(saved)) return { id: saved, defaultId, locked: false, source: 'pick' };
  return { id: defaultId, defaultId, locked: true, source: 'default' };
}

/**
 * The change `settings.iface:<kind>:<name>:<which>` makes: `{ value }` (null = clear the key, back to the default) or
 * `{ error }`. which = `default` (or empty / `off` / `untick`) unticks; anything else must be built for the owner.
 */
export function ifaceSet(owner, which, assets, assetTypes = []) {
  if (!parseBuiltFor(owner)) return { error: `No settings owner "${owner}".` };
  const w = typeof which === 'string' ? which.trim() : '';
  const defaultId = ifaceDefaultId(owner, assetTypes);
  if (!w || w === 'default' || w === 'off' || w === 'untick' || w === defaultId) return { value: null };
  if (!ifaceChoices(owner, assets, assetTypes).some((c) => c.id === w)) return { error: `"${w}" is not a settings interface built for ${owner}.` };
  return { value: w };
}

/** Parse the action args `[kind, name, which]` (app: `[app, which]`) into `{ owner, which }`, or null. */
export function parseIfaceArgs(args) {
  const a = Array.isArray(args) ? args.map((x) => String(x ?? '')) : [];
  if (a[0] === 'app') return { owner: 'app', which: a.slice(1).join(':') };
  const owner = ifaceOwner(a[0], a[1]);
  return owner ? { owner, which: a.slice(2).join(':') } : null;
}

/**
 * The settings interface an owner's tab renders through, layered over the app's (plain data in, plain data out;
 * normalizeSettingsUi after): the page keeps its layout, header, search and levels; the owner's interface adds what
 * it hides, sets levels of its own ids and can turn descriptions off.
 */
export function layerIface(appData, ownData) {
  const app = isObj(appData) ? appData : {};
  const own = isObj(ownData) ? ownData : {};
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const obj = (v) => (isObj(v) ? v : {});
  return {
    ...app,
    descriptions: app.descriptions !== false && own.descriptions !== false,
    hide: [...new Set([...arr(app.hide), ...arr(own.hide)])],
    levelOf: { ...obj(app.levelOf), ...obj(own.levelOf) },
  };
}

/** Every owner with its own pick in the saved settings: `[{ owner, interface }]`, sorted (the readable state). */
export function ifacePickList(saved) {
  if (!isObj(saved)) return [];
  const out = [];
  for (const [k, v] of Object.entries(saved)) {
    const owner = ownerOfIfaceKey(k);
    if (owner && typeof v === 'string' && v) out.push({ owner, interface: v });
  }
  return out.sort((a, b) => a.owner.localeCompare(b.owner));
}

/**
 * toolbar-owner@1 — every plugin has its own default toolbar, and every toolbar says whether it is generic or built
 * for one screen (Brett, Nov 18 2026, build every-plugin-gets-own-default-toolbar).
 *
 * Who a toolbar asset is built for lives in `data.builtFor`:
 *   generic          usable on any screen (the frame toolbar, the shared starters in framework/assets/toolbar)
 *   view:<view id>   built for one screen (`view:gate`)
 *   plugin:<name>    built for one plugin's screen; name = the plugin folder, or the last dotted segment of its library id
 * An asset without builtFor is read from its scope (scope app → generic, scope view:/plugin: → that screen), so every
 * toolbar saved before this contract keeps working.
 *
 * Every plugin gets a locked default toolbar `default-<plugin>-toolbar` (built for the plugin, scope plugin:<name>),
 * the same way every plugin has a locked default settings interface (settings-iface@1). A screen uses its own toolbar
 * (a screen-specific asset whose scope and slot match, else the plugin's default) until the person ticks "Use another
 * toolbar" and picks one. The picker lists only generic toolbars plus the ones built for that screen.
 *
 * Picking another toolbar is an override of look and style only (s4): the buttons always stay the screen's own. The
 * picked asset lends its TOOLBAR_LOOK_KEYS; groups, search and widgets come from the screen's toolbar. The per-instance
 * chrome override (`axf.chrome.toolbar.<id>`) is held to the same keys.
 *
 * The pick is the existing chrome instance key `axf.chrome.toolbar.<settings id>.asset` (absent = the default, locked).
 * Actions (console-visible: REST /api/console-control, MCP console tools, CLI `axf console`, voice):
 *   toolbar.pick:<settings id>:<asset id|default>   pick (default = untick, back to the screen's own toolbar)
 *   toolbar.choices:<settings id>                   list what the picker offers for that screen
 *
 * Pure: no DOM, no runtime. The reference engine; the Kotlin twin is deferred (framework/spec/PORTING.md).
 * Golden outputs: framework/spec/fixtures/toolbar-owner.json (node framework/spec/check-toolbar-owner.mjs --write).
 */

export const TOOLBAR_OWNER_CONTRACT = 'toolbar-owner@1';
export const TOOLBAR_OWNER_FIELD = 'builtFor';
export const TOOLBAR_GENERIC = 'generic';
export const TOOLBAR_SCREEN_KINDS = ['view', 'plugin'];
export const TOOLBAR_DEFAULT_PREFIX = 'default-';
export const TOOLBAR_DEFAULT_SUFFIX = '-toolbar';
/** Tag of a generated default with only the Settings button (no page toolbar of its own yet). */
export const TOOLBAR_PLACEHOLDER_TAG = 'placeholder';
/** Look and style: the only keys a picked toolbar or a per-instance override may change. Never buttons. */
export const TOOLBAR_LOOK_KEYS = ['variant', 'align', 'density', 'surface', 'divider', 'collapsible', 'overflow'];
/** What a person's per-instance override (`axf.chrome.toolbar.<id>`) may set: the look keys, the search box switch and tap to confirm (behaviour). Never buttons. */
export const TOOLBAR_OVERRIDE_KEYS = [...TOOLBAR_LOOK_KEYS, 'showSearch', 'tapConfirm'];

const NAME = /^[a-z0-9][a-z0-9-]{0,38}$/;
const SCREEN_ID = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const ID_MAX = 64;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const lc = (s) => String(s ?? '').toLowerCase();

/** A plugin's owner name from a folder or library id: the last dotted segment, lower-case, a-z0-9 and dashes. */
export function toolbarPluginName(moduleId) {
  const last = String(moduleId ?? '').split('.').filter(Boolean).pop() ?? '';
  const slug = last.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 39);
  return NAME.test(slug) ? slug : '';
}

/** `{ kind: 'generic' }` | `{ kind: 'view'|'plugin', id }`, or null when the value is not a builtFor. */
export function parseToolbarBuiltFor(v) {
  if (v === TOOLBAR_GENERIC) return { kind: 'generic', id: '' };
  if (typeof v !== 'string') return null;
  const i = v.indexOf(':');
  if (i <= 0) return null;
  const kind = v.slice(0, i);
  const id = v.slice(i + 1);
  if (kind === 'view') return SCREEN_ID.test(id) ? { kind, id } : null;
  if (kind === 'plugin') return NAME.test(id) ? { kind, id } : null;
  return null;
}

/** Errors of a toolbar's builtFor value (optional; validate.ts and the Python validator report the same text). */
export function toolbarBuiltForErrors(v) {
  if (v === undefined) return [];
  return parseToolbarBuiltFor(v) ? [] : [`data.builtFor must be generic, view:<view id> or plugin:<name> (not ${JSON.stringify(v)})`];
}

/** The default toolbar id of a plugin: `default-<plugin>-toolbar`. Null for a name that is not a plugin name. */
export function pluginToolbarDefaultId(plugin) {
  const name = toolbarPluginName(plugin);
  if (!name) return null;
  const id = `${TOOLBAR_DEFAULT_PREFIX}${name}${TOOLBAR_DEFAULT_SUFFIX}`;
  return id.length <= ID_MAX ? id : null;
}

/** The plugin a default toolbar id belongs to (`default-gate-toolbar` → gate), or null. */
export function pluginOfToolbarDefaultId(id) {
  if (typeof id !== 'string' || !id.startsWith(TOOLBAR_DEFAULT_PREFIX) || !id.endsWith(TOOLBAR_DEFAULT_SUFFIX)) return null;
  const name = id.slice(TOOLBAR_DEFAULT_PREFIX.length, -TOOLBAR_DEFAULT_SUFFIX.length);
  return NAME.test(name) ? name : null;
}

/**
 * Who a toolbar asset is built for: data.builtFor when valid; else its scope (app or none → generic, view:/plugin: →
 * that screen, a plugin scope slugged to its name); else a `default-<plugin>-toolbar` id → that plugin. Never throws.
 */
export function toolbarBuiltForOf(asset) {
  const d = isObj(asset?.data) ? asset.data : {};
  if (parseToolbarBuiltFor(d.builtFor)) return d.builtFor;
  const fromId = pluginOfToolbarDefaultId(asset?.id);
  if (fromId) return `plugin:${fromId}`;
  const s = typeof d.scope === 'string' ? d.scope : '';
  const i = s.indexOf(':');
  if (i > 0) {
    const kind = s.slice(0, i); const id = s.slice(i + 1);
    if (kind === 'view' && SCREEN_ID.test(id)) return `view:${id}`;
    if (kind === 'plugin') { const n = toolbarPluginName(id); if (n) return `plugin:${n}`; }
  }
  return TOOLBAR_GENERIC;
}

/** Whether a toolbar asset is generic (usable on any screen). */
export const isGenericToolbar = (asset) => toolbarBuiltForOf(asset) === TOOLBAR_GENERIC;

/** Whether a toolbar built for `builtFor` is for this page (`{ view, plugin }`); generic toolbars are for every page. */
export function toolbarBuiltForPage(builtFor, page) {
  const b = parseToolbarBuiltFor(builtFor);
  if (!b) return false;
  if (b.kind === 'generic') return true;
  if (b.kind === 'view') return !!page?.view && lc(page.view) === lc(b.id);
  return !!page?.plugin && toolbarPluginName(page.plugin) === b.id;
}

/** Whether a toolbar asset is built for exactly this page's screen (not generic). */
export const toolbarIsForScreen = (asset, page) => !isGenericToolbar(asset) && toolbarBuiltForPage(toolbarBuiltForOf(asset), page);

/** The full asset@1 default toolbar of a plugin (install-time files and the runtime fallback both use it). */
export function pluginToolbarDefaultAsset(plugin, { label = '' } = {}) {
  const name = toolbarPluginName(plugin);
  const id = pluginToolbarDefaultId(name);
  if (!id) return null;
  const what = label || name;
  return {
    $axf: 'asset@1',
    type: 'toolbar',
    id,
    name: `${what} toolbar (default)`,
    version: '1.0.0',
    description: `The default toolbar of the ${what} plugin: locked until another toolbar (generic, or built for this screen) is picked; a pick changes the look only, never the buttons (${TOOLBAR_OWNER_CONTRACT}).`,
    author: 'AmberX AXF',
    tags: ['default', TOOLBAR_OWNER_CONTRACT, 'plugin', TOOLBAR_PLACEHOLDER_TAG],
    data: {
      scope: `plugin:${name}`,
      builtFor: `plugin:${name}`,
      variant: 'icons-labels',
      align: 'start',
      showSearch: false,
      groups: [
        { id: 'plugin', label: what, items: [{ id: 'settings', icon: 'settings', label: 'Settings', action: `plugin.settings.open:${name}` }] },
      ],
    },
  };
}

/* ================================================================== the screen's own toolbar and the picker */

const nameOf = (a) => (typeof a?.name === 'string' && a.name ? a.name : a.id);
const slotOf = (a) => (isObj(a?.data) && typeof a.data.slot === 'string' && a.data.slot ? a.data.slot : 'main');
const pageSlot = (page) => (typeof page?.slot === 'string' && page.slot ? page.slot : 'main');

/** Whether a toolbar's scope names this page's view (or its plugin) and its slot matches (page-toolbar@1 scope). */
export function toolbarScopedTo(asset, page, kind) {
  const d = isObj(asset?.data) ? asset.data : {};
  if (slotOf(asset) !== pageSlot(page)) return false;
  const s = typeof d.scope === 'string' ? d.scope : '';
  const i = s.indexOf(':');
  if (i <= 0 || s.slice(0, i) !== kind) return false;
  const id = s.slice(i + 1);
  if (kind === 'view') return !!page?.view && lc(id) === lc(page.view);
  return !!page?.plugin && toolbarPluginName(id) === toolbarPluginName(page.plugin);
}

/**
 * The screen's own (default) toolbar for a page: the first asset scoped to the page's view in its slot, else the
 * first scoped to its plugin, else (main slot) the plugin's `default-<plugin>-toolbar`. A plugin default always wins
 * over another asset with the same scope. Null when the page has none (it keeps its handwritten bar).
 */
export function pageDefaultToolbar(page, assets) {
  const list = (Array.isArray(assets) ? assets : []).filter((a) => a && typeof a.id === 'string');
  const first = (kind) => {
    const hits = list.filter((a) => toolbarScopedTo(a, page, kind));
    return hits.find((a) => pluginOfToolbarDefaultId(a.id)) ?? hits[0] ?? null;
  };
  const hit = (page?.view ? first('view') : null) ?? (page?.plugin ? first('plugin') : null);
  if (hit) return hit;
  if (pageSlot(page) !== 'main' || !page?.plugin) return null;
  const did = pluginToolbarDefaultId(page.plugin);
  return list.find((a) => a.id === did) ?? null;
}

/** Whether a toolbar asset is a generated placeholder default (a page with its own handwritten bar keeps that bar). */
export const isPlaceholderToolbar = (asset) => Array.isArray(asset?.tags) && asset.tags.includes(TOOLBAR_PLACEHOLDER_TAG);

/**
 * What the picker offers a page: the screen's own toolbar first (isDefault), then every other toolbar built for this
 * screen, then every generic toolbar, each group sorted by name. `[{ id, name, description, builtFor, generic, isDefault }]`.
 */
export function toolbarChoices(page, assets) {
  const list = (Array.isArray(assets) ? assets : []).filter((a) => a && typeof a.id === 'string' && (a.type === undefined || a.type === 'toolbar'));
  const own = pageDefaultToolbar(page, list);
  const row = (a) => ({ id: a.id, name: nameOf(a), description: typeof a.description === 'string' ? a.description : '', builtFor: toolbarBuiltForOf(a), generic: isGenericToolbar(a), isDefault: !!own && a.id === own.id });
  const byName = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const screen = list.filter((a) => a !== own && toolbarIsForScreen(a, page)).map(row).sort(byName);
  const generic = list.filter((a) => a !== own && isGenericToolbar(a)).map(row).sort(byName);
  return [...(own ? [row(own)] : []), ...screen, ...generic];
}

/**
 * What a page's toolbar uses now: `{ id, defaultId, locked, source, generic }`. locked = on the screen's own toolbar
 * (the box is unticked). A saved pick that is gone or not offered to this screen falls back to the default.
 */
export function toolbarPick(saved, page, assets) {
  const own = pageDefaultToolbar(page, assets);
  const defaultId = own ? own.id : null;
  const choices = toolbarChoices(page, assets);
  const hit = typeof saved === 'string' && saved && saved !== defaultId ? choices.find((c) => c.id === saved) : null;
  if (hit) return { id: hit.id, defaultId, locked: false, source: 'pick', generic: hit.generic };
  return { id: defaultId, defaultId, locked: true, source: 'default', generic: false };
}

/**
 * The change `toolbar.pick:<settings id>:<which>` makes: `{ value }` (null = clear the key, back to the default) or
 * `{ error }`. which = `default` (or empty / `off` / `untick`) unticks; anything else must be offered to the screen.
 */
export function toolbarPickSet(page, which, assets) {
  const w = typeof which === 'string' ? which.trim() : '';
  const own = pageDefaultToolbar(page, assets);
  if (!w || w === 'default' || w === 'off' || w === 'untick' || (own && w === own.id)) return { value: null };
  if (!toolbarChoices(page, assets).some((c) => c.id === w)) return { error: `"${w}" is not a generic toolbar or one built for this screen.` };
  return { value: w };
}

/* ================================================================== look-only overrides (s4) */

/** Only the look and style keys of a toolbar data object or override (everything else dropped). */
export function toolbarLookOnly(data) {
  const out = {};
  if (!isObj(data)) return out;
  for (const k of TOOLBAR_LOOK_KEYS) if (k in data) out[k] = data[k];
  return out;
}

/** Only the keys a per-instance override may set (TOOLBAR_OVERRIDE_KEYS); groups, items and widgets are dropped. */
export function toolbarOverrideOnly(override) {
  const out = {};
  if (!isObj(override)) return out;
  for (const k of TOOLBAR_OVERRIDE_KEYS) if (k in override) out[k] = override[k];
  return out;
}

/** The keys of an override that are not look or style (what the override switch refuses to change). */
export function toolbarNonLookKeys(data) {
  return isObj(data) ? Object.keys(data).filter((k) => !TOOLBAR_LOOK_KEYS.includes(k)) : [];
}

/**
 * The toolbar a page draws when another one is picked: the screen's own data (buttons, groups, search, widgets,
 * scope, slot) with the picked toolbar's look and style laid over it. With no pick (or the same asset) the own data.
 */
export function layerToolbarLook(ownData, pickedData) {
  const own = isObj(ownData) ? ownData : {};
  if (!isObj(pickedData) || pickedData === ownData) return { ...own };
  return { ...own, ...toolbarLookOnly(pickedData) };
}

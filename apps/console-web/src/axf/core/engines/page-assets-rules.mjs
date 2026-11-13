/**
 * Page assets (page-assets@1; Brett, Nov 13 2026, build assets-menu-hide-any-asset-visible-and-hidden-li):
 * "Hide any asset on any page. Context menu gets an 'Assets' entry with two submenus: 'Visible assets' and 'Hidden
 * assets', listing every asset on the page. Each row shows a small icon and a colour for its type […]; hidden ones use
 * a hidden colour. Type colours and the hidden colour are configurable in settings."
 *
 * The pure rules: which kinds of asset a page shows, their labels, icons and default colours, the id of one asset on a
 * page, the saved hidden list and the colour settings. The web host (react/components/PageAssets.tsx) finds the assets
 * in the page, hides them, highlights them and builds the context-menu lists from these rules.
 *
 * Settings
 *   axf.assets.hidden            ["<page>|<type>:<instance>", …]   (page "*" = hidden on every page)
 *   axf.assets.colour.<type>     one of PAGE_ASSET_COLOURS          (unset = the type's default)
 *   axf.assets.colour.hidden     one of PAGE_ASSET_COLOURS          (unset = muted)
 */

export const PAGE_ASSETS_CONTRACT = 'page-assets@1';

export const PAGE_ASSET_TYPES = ['toolbar', 'tab-group', 'nav-menu', 'app-menu', 'banner', 'widget', 'grid', 'container'];
export const PAGE_ASSET_LABELS = { toolbar: 'Toolbar', 'tab-group': 'Tab group', 'nav-menu': 'Navigation menu', 'app-menu': 'Application menu', banner: 'Banner', widget: 'Widget', grid: 'Grid', container: 'Container' };
export const PAGE_ASSET_ICONS = { toolbar: 'sliders', 'tab-group': 'layers', 'nav-menu': 'list', 'app-menu': 'menu', banner: 'star', widget: 'box', grid: 'grid', container: 'layout' };
/** The colours a type or the hidden state can take: each one is a colour token (--fx-<name>), never a literal. */
export const PAGE_ASSET_COLOURS = ['accent', 'info', 'success', 'warning', 'danger', 'muted'];
export const PAGE_ASSET_DEFAULT_COLOURS = { toolbar: 'accent', 'tab-group': 'info', 'nav-menu': 'success', 'app-menu': 'warning', banner: 'danger', widget: 'accent', grid: 'info', container: 'success' };
export const PAGE_ASSET_HIDDEN_DEFAULT = 'muted';

export const PAGE_ASSETS_HIDDEN_KEY = 'axf.assets.hidden';
export const PAGE_ASSET_COLOUR_KEY = (type) => `axf.assets.colour.${type}`;
export const PAGE_ASSET_HIDDEN_COLOUR_KEY = 'axf.assets.colour.hidden';
/** Every page: an asset hidden with page "*" is hidden wherever it shows. */
export const PAGE_ANY = '*';
/** The most hidden entries kept (oldest dropped first). */
export const PAGE_ASSETS_HIDDEN_MAX = 500;
/** How long a highlight asked for through the API stays on (ms) when the caller names none, and the cap. */
export const PAGE_ASSET_HIGHLIGHT_MS = 4000;
export const PAGE_ASSET_HIGHLIGHT_MAX = 60000;

const INSTANCE = /^[a-z0-9][a-z0-9._:/-]{0,119}$/;
const PAGE = /^(\*|[a-z0-9][a-z0-9._:/-]{0,119})$/i;

export const isPageAssetType = (t) => typeof t === 'string' && PAGE_ASSET_TYPES.includes(t);
export const pageAssetLabel = (t) => PAGE_ASSET_LABELS[t] ?? String(t);
export const isPageAssetColour = (c) => typeof c === 'string' && PAGE_ASSET_COLOURS.includes(c);

/** A label as an instance id (the same slug the context menu gives an unnamed toolbar / tab row / nav). */
export function pageAssetSlug(label) {
  return String(label ?? '').toLowerCase().replace(/[^a-z0-9._:/-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

/** One asset's id on a page: "<type>:<instance>". */
export const pageAssetId = (type, instance) => `${type}:${instance}`;

/** "<type>:<instance>" → { type, instance }, or null when it isn't one. */
export function parsePageAssetId(id) {
  if (typeof id !== 'string') return null;
  const i = id.indexOf(':');
  if (i < 1) return null;
  const type = id.slice(0, i);
  const instance = id.slice(i + 1);
  if (!isPageAssetType(type) || !INSTANCE.test(instance)) return null;
  return { type, instance };
}

/** The saved hidden list, cleaned: valid "<page>|<type>:<instance>" entries, no repeats, at most PAGE_ASSETS_HIDDEN_MAX. */
export function normalizeHiddenAssets(raw) {
  const out = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    if (typeof e !== 'string') continue;
    const bar = e.indexOf('|');
    if (bar < 1) continue;
    const page = e.slice(0, bar);
    if (!PAGE.test(page) || !parsePageAssetId(e.slice(bar + 1))) continue;
    if (!out.includes(e)) out.push(e);
  }
  return out.slice(-PAGE_ASSETS_HIDDEN_MAX);
}

/** Whether an asset is hidden on a page (hidden there, or hidden on every page). */
export function isAssetHidden(hidden, page, id) {
  const list = normalizeHiddenAssets(hidden);
  return list.includes(`${page}|${id}`) || list.includes(`${PAGE_ANY}|${id}`);
}

/**
 * The hidden list after hiding (`on`) or showing an asset on a page. Showing drops it from this page and from every
 * page (so "unhide" always brings it back where you are); hiding on page "*" hides it everywhere.
 */
export function withAssetHidden(hidden, page, id, on) {
  const list = normalizeHiddenAssets(hidden);
  if (!parsePageAssetId(id) || !PAGE.test(String(page))) return list;
  if (on) return normalizeHiddenAssets([...list.filter((e) => e !== `${page}|${id}`), `${page}|${id}`]);
  return list.filter((e) => e !== `${page}|${id}` && e !== `${PAGE_ANY}|${id}`);
}

/** The hidden entries of one page (its own and the every-page ones), as ids. */
export function hiddenOnPage(hidden, page) {
  const ids = [];
  for (const e of normalizeHiddenAssets(hidden)) {
    const bar = e.indexOf('|');
    const p = e.slice(0, bar);
    const id = e.slice(bar + 1);
    if ((p === page || p === PAGE_ANY) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** A type's colour from its setting (unset or unknown = its default). */
export function pageAssetColourOf(type, value) {
  return isPageAssetColour(value) ? value : PAGE_ASSET_DEFAULT_COLOURS[type] ?? 'accent';
}
/** The hidden colour from its setting (unset or unknown = muted). */
export function pageAssetHiddenColourOf(value) {
  return isPageAssetColour(value) ? value : PAGE_ASSET_HIDDEN_DEFAULT;
}

/** How long an API highlight stays on: a number of ms within 500 … PAGE_ASSET_HIGHLIGHT_MAX, else the default. */
export function pageAssetHighlightMs(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return PAGE_ASSET_HIGHLIGHT_MS;
  return Math.max(500, Math.min(PAGE_ASSET_HIGHLIGHT_MAX, Math.round(n)));
}

/**
 * What a console reports of its page's assets (console_where → here.assets): [{ id, type, label, hidden }], valid
 * rows only, at most 200.
 */
export function normalizePageAssetSummary(raw) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof r !== 'object') continue;
    const p = parsePageAssetId(r.id);
    if (!p || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, type: p.type, label: String(r.label ?? '').slice(0, 120) || pageAssetLabel(p.type), hidden: r.hidden === true });
    if (out.length >= 200) break;
  }
  return out;
}

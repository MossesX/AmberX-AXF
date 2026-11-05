/**
 * screen-layouts@1 — three layouts per plugin screen (Brett, Nov 4 2026: "From now on, all plugin screens get three
 * layouts, and come with a toolbar to select which one, with the toolbar hidden by default." … "Not old ones, only new
 * ones.").
 *
 * One module for every reader: the web runtime (core/runtime.ts, react/components/ScreenLayouts.tsx), the plugin
 * validators (cli/plugins.mjs, the console server), the CI check (cli/check-screen-layouts.mjs), the scaffold and the
 * fixtures (spec/fixtures/screen-layouts.json). Pure: no DOM, no files, no runtime.
 *
 * The contract (plugin@1 `screens`):
 *
 *   "screens": {
 *     "<view id>": {
 *       "layouts": [ { "id": "compact", "label": "Compact", "icon": "list", "description": "…" }, … ],   // 3 or more
 *       "default": "standard"                                                                             // one of them
 *     }
 *   }
 *
 * A screen's layouts are presets of that screen (how its own content is arranged: Compact / Standard / Spacious,
 * List / Grid / Split, whatever fits), never the app's layout asset. The web library declares the same on the view
 * (`views.<id>.layouts` / `defaultLayout`); plugin.json mirrors it so tooling can read it without loading code.
 *
 * The switcher is ONE shared toolbar asset (`toolbar/layout-switcher`, qualified `axf.toolbar.layout-switcher`) whose
 * buttons come from the runtime's `screen-layouts` live list. It is hidden by default; a screen's title (right-click →
 * Show layout toolbar), a setting, an action or a voice command shows it. The pick and the toolbar's visibility are
 * settings, per screen, per device. A plugin may get its own copy of the toolbar (inherits the shared one until edited)
 * and go back to the shared one; both are settings too, never code.
 *
 * Android twin: deferred (port on hold, Oct 21 2026); see spec/PORTING.md.
 */

export const SCREEN_LAYOUTS_SCHEMA = 'screen-layouts@1';

/** The shared switcher toolbar asset (type toolbar) and its qualified name. */
export const LAYOUT_SWITCHER_TOOLBAR = 'layout-switcher';
export const LAYOUT_SWITCHER_QUALIFIED = 'axf.toolbar.layout-switcher';

/** The live list the switcher's buttons come from (a built-in app-menu provider). */
export const SCREEN_LAYOUTS_PROVIDER = 'screen-layouts';

/** Every new plugin screen declares at least this many layouts. */
export const MIN_LAYOUTS = 3;
/** And at most this many (a switcher is a short row of buttons). */
export const MAX_LAYOUTS = 8;

export const LAYOUT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const VIEW_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const ICON_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Settings keys (device scope: localStorage per app on the web, the same keys on Android). */
export const SCREEN_LAYOUT_KEYS = Object.freeze({
  /** boolean, default false: show the layout toolbar on every screen that has layouts */
  toolbarDefault: 'axf.screens.layoutToolbar',
  /** prefix of `axf.screen.<view>.layout` (the picked layout id) and `axf.screen.<view>.layoutToolbar` (show | hide) */
  perScreen: 'axf.screen.',
  /** prefix of `axf.screens.layoutToolbar.copy.<plugin id>`: JSON of the plugin's own copy of the switcher */
  copy: 'axf.screens.layoutToolbar.copy.',
});

export const TOOLBAR_OVERRIDES = Object.freeze(['inherit', 'show', 'hide']);

/** Actions the runtime registers (every one takes the current screen when no view is named). */
export const SCREEN_LAYOUT_ACTIONS = Object.freeze({
  /** screen.layout:<layout id>[:<view>] — pick a layout */
  pick: 'screen.layout',
  /** screen.layout-toolbar:show|hide|toggle|inherit[:<view>] — the switcher's visibility on a screen */
  toolbar: 'screen.layout-toolbar',
  /** screen.layout-toolbar.copy:<plugin id> — give a plugin its own copy of the switcher */
  copy: 'screen.layout-toolbar.copy',
  /** screen.layout-toolbar.shared:<plugin id> — back to the shared switcher */
  shared: 'screen.layout-toolbar.shared',
});

/** Context-menu targets the runtime adds items to (payload = the view id, or the plugin id on the toolbar). */
export const SCREEN_LAYOUT_CTX = Object.freeze({ title: 'screen-title', toolbar: 'layout-toolbar' });

/** The three starter layouts every scaffold begins with (a plugin renames them to what fits its screen). */
export const STARTER_LAYOUTS = Object.freeze([
  { id: 'compact', label: 'Compact', icon: 'list', description: 'Tight rows, more on one screen.' },
  { id: 'standard', label: 'Standard', icon: 'layout', description: 'The everyday arrangement.' },
  { id: 'spacious', label: 'Spacious', icon: 'grid', description: 'Room around every block, big targets.' },
]);
export const STARTER_DEFAULT = 'standard';

const str = (v) => (typeof v === 'string' ? v : '');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/* ───────────────────────── keys ───────────────────────── */

export const screenLayoutKey = (view) => `${SCREEN_LAYOUT_KEYS.perScreen}${view}.layout`;
export const screenToolbarKey = (view) => `${SCREEN_LAYOUT_KEYS.perScreen}${view}.layoutToolbar`;
export const toolbarCopyKey = (pluginId) => `${SCREEN_LAYOUT_KEYS.copy}${pluginId}`;

/** `axf.screen.<view>.layout` → the view, else null (used by the runtime to answer check marks with the resolved pick). */
export function viewOfLayoutKey(key) {
  const m = /^axf\.screen\.(.+)\.layout$/.exec(str(key));
  return m ? m[1] : null;
}

/** The asset id of a plugin's own copy of the switcher: `ls-<plugin id with dots as dashes>`, within the asset id rules. */
export function copyAssetId(pluginId) {
  const slug = str(pluginId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `ls-${slug || 'plugin'}`.slice(0, 48).replace(/-+$/, '');
}

/* ───────────────────────── the contract ───────────────────────── */

/**
 * One screen's declaration, normalized: `{ layouts, default }` or null when it isn't a declaration at all.
 * Fields outside the contract are dropped; a missing `default` is the first layout.
 */
export function normalizeScreen(raw) {
  if (!isObj(raw) || !Array.isArray(raw.layouts)) return null;
  const layouts = raw.layouts.filter(isObj).map((l) => ({
    id: str(l.id), label: str(l.label), ...(str(l.icon) ? { icon: str(l.icon) } : {}), ...(str(l.description) ? { description: str(l.description) } : {}),
  }));
  const def = str(raw.default) || layouts[0]?.id || '';
  return { layouts, default: def };
}

/** `screens` of a manifest (or a web library's views with `layouts`), normalized: `{ [view]: { layouts, default } }`. */
export function normalizeScreens(screens) {
  const out = {};
  if (!isObj(screens)) return out;
  for (const [view, raw] of Object.entries(screens)) { const n = normalizeScreen(raw); if (n) out[view] = n; }
  return out;
}

/**
 * Problems with one screen's declaration (empty = fine). `where` prefixes every message. Count rules apply only when
 * `enforceCount` (new plugins; grandfathered screens skip them, see `grandfathered`).
 */
export function checkScreen(view, raw, { enforceCount = true, where = '' } = {}) {
  const at = where ? `${where}: ` : '';
  const problems = [];
  if (!VIEW_ID.test(str(view))) problems.push(`${at}"${view}" is not a view id`);
  if (!isObj(raw)) return [...problems, `${at}screen "${view}" is an object {layouts, default}`];
  for (const k of Object.keys(raw)) if (!['layouts', 'default'].includes(k)) problems.push(`${at}screen "${view}" has an unknown key "${k}"`);
  if (!Array.isArray(raw.layouts)) return [...problems, `${at}screen "${view}" needs "layouts": a list of {id, label, icon?, description?}`];
  const ids = new Set();
  raw.layouts.forEach((l, i) => {
    const p = `screen "${view}" layout ${i + 1}`;
    if (!isObj(l)) { problems.push(`${at}${p} is an object {id, label, icon?, description?}`); return; }
    for (const k of Object.keys(l)) if (!['id', 'label', 'icon', 'description'].includes(k)) problems.push(`${at}${p} has an unknown key "${k}"`);
    if (!LAYOUT_ID.test(str(l.id))) problems.push(`${at}${p}: "id" is a short slug (${LAYOUT_ID})`);
    else if (ids.has(l.id)) problems.push(`${at}${p}: layout id "${l.id}" is used twice`);
    else ids.add(l.id);
    if (!str(l.label).trim() || l.label.length > 40) problems.push(`${at}${p}: "label" is short text (1–40 characters)`);
    if (l.icon !== undefined && !ICON_ID.test(str(l.icon))) problems.push(`${at}${p}: "icon" is an icon name`);
    if (l.description !== undefined && (typeof l.description !== 'string' || l.description.length > 200)) problems.push(`${at}${p}: "description" is one short sentence`);
  });
  if (enforceCount && raw.layouts.length < MIN_LAYOUTS) problems.push(`${at}screen "${view}" declares ${raw.layouts.length} layout(s); every new plugin screen has at least ${MIN_LAYOUTS} (Brett, Nov 4 2026)`);
  if (raw.layouts.length > MAX_LAYOUTS) problems.push(`${at}screen "${view}" declares ${raw.layouts.length} layouts; at most ${MAX_LAYOUTS}`);
  if (raw.default !== undefined && (!str(raw.default) || !ids.has(raw.default))) problems.push(`${at}screen "${view}": "default" names one of its layouts`);
  return problems;
}

/**
 * Problems with a manifest's `screens` (plugin@1): every key is a view the plugin provides (`view:<id>` in `provides`,
 * when `provides` is given), every entry passes `checkScreen`. `views` (ids from the web code) adds the other direction:
 * a view with no declaration is a problem when `enforceCount` (new plugins) and not in `grandfathered` (`<view>` ids).
 */
export function checkScreens(manifest, { enforceCount = true, views = null, grandfathered = [], where = '' } = {}) {
  const at = where ? `${where}: ` : '';
  const s = manifest?.screens;
  const problems = [];
  if (s === undefined) {
    if (enforceCount && views) for (const v of views) if (v.startsWith('?')) problems.push(`${at}a view key "[${v.slice(1)}]" can't be read: use a literal key or a const string in the same file`); else if (!grandfathered.includes(v)) problems.push(`${at}screen "${v}" declares no layouts: every new plugin screen lists ${MIN_LAYOUTS} in plugin.json "screens" (Brett, Nov 4 2026)`);
    return problems;
  }
  if (!isObj(s)) return [`${at}"screens" is an object: { "<view id>": { "layouts": [...], "default": "<id>" } }`];
  const provided = Array.isArray(manifest.provides) ? manifest.provides.filter((p) => typeof p === 'string' && p.startsWith('view:')).map((p) => p.slice(5)) : null;
  for (const [view, raw] of Object.entries(s)) {
    const gf = grandfathered.includes(view);
    problems.push(...checkScreen(view, raw, { enforceCount: enforceCount && !gf, where }));
    if (provided && !provided.includes(view)) problems.push(`${at}screen "${view}" isn't a page the plugin provides ("view:${view}")`);
    if (views && !views.includes(view)) problems.push(`${at}screen "${view}" isn't a view in its web code`);
  }
  if (enforceCount && views) for (const v of views) {
    if (v.startsWith('?')) { problems.push(`${at}a view key "[${v.slice(1)}]" can't be read: use a literal key or a const string in the same file`); continue; }
    if (!(v in s) && !grandfathered.includes(v)) problems.push(`${at}screen "${v}" declares no layouts: every new plugin screen lists ${MIN_LAYOUTS} in plugin.json "screens" (Brett, Nov 4 2026)`);
  }
  return problems;
}

/**
 * The view ids a web library file declares (`views: { a: …, 'b-c': …, [VIEW]: … }`), read from the source text. A
 * computed key `[NAME]` is resolved from a `const NAME = '…'` in the same file; one that can't be resolved is returned
 * as `?NAME` so a check can say so (use a literal key or a const).
 */
export function viewIdsInSource(text, readImport = null) {
  const consts = new Map();
  for (const c of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(['"`])([a-z0-9][a-z0-9._-]*)\2/g)) consts.set(c[1], c[3]);
  // `import { VIEW, A as B } from './keys'`: a const string exported by a sibling file (readImport(path) → its text or null)
  if (readImport) for (const im of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*(['"])(\.[^'"]*)\2/g)) {
    const src = readImport(im[3]);
    if (!src) continue;
    const theirs = new Map();
    for (const c of src.matchAll(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(['"`])([a-z0-9][a-z0-9._-]*)\2/g)) theirs.set(c[1], c[3]);
    for (const part of im[1].split(',')) { const [from, as] = part.trim().split(/\s+as\s+/); if (from && theirs.has(from) && !consts.has(as ?? from)) consts.set(as ?? from, theirs.get(from)); }
  }
  const out = [];
  const re = /\bviews\s*:\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 1, i = re.lastIndex;
    let keyStart = i;
    let bracketKey = null;
    while (i < text.length && depth > 0) {
      const c = text[i];
      if (c === '[' && depth === 1 && !text.slice(keyStart, i).trim()) { const end = text.indexOf(']', i); bracketKey = text.slice(i + 1, end).trim(); i = end + 1; continue; }
      if (c === '{' || c === '[' || c === '(') { depth++; }
      else if (c === '}' || c === ']' || c === ')') { depth--; if (depth === 1) { keyStart = i + 1; bracketKey = null; } }
      else if (c === ',' && depth === 1) { keyStart = i + 1; bracketKey = null; }
      else if (c === ':' && depth === 1) {
        if (bracketKey !== null) { const lit = /^(['"`])(.*)\1$/.exec(bracketKey); const key = lit ? lit[2] : consts.get(bracketKey); out.push(key && /^[a-z0-9][a-z0-9._-]*$/.test(key) ? key : `?${bracketKey}`); bracketKey = null; }
        else { const key = text.slice(keyStart, i).trim().replace(/^['"]|['"]$/g, ''); if (/^[a-z0-9][a-z0-9._-]*$/.test(key)) out.push(key); }
      }
      i++;
    }
  }
  return [...new Set(out)];
}

/** Is `folder/view` grandfathered (an existing screen that predates the rule)? Baseline: `{ screens: ["<folder>/<view>", …] }`. */
export function grandfathered(baseline, folder, view) {
  const list = Array.isArray(baseline?.screens) ? baseline.screens : [];
  return list.includes(`${folder}/${view}`) || list.includes(`${folder}/*`);
}

/* ───────────────────────── resolution (runtime) ───────────────────────── */

/** The layout to show: the saved pick when it is one of the screen's layouts, else the default, else the first. '' without layouts. */
export function resolveScreenLayout(screen, saved) {
  const s = normalizeScreen(screen);
  if (!s || !s.layouts.length) return '';
  const pick = str(saved);
  if (pick && s.layouts.some((l) => l.id === pick)) return pick;
  return s.layouts.some((l) => l.id === s.default) ? s.default : s.layouts[0].id;
}

/**
 * Is the switcher shown on a screen? The screen's own choice (`show` | `hide`) wins; `inherit` or nothing falls back
 * to the app-wide default (`axf.screens.layoutToolbar`, off by default: Brett, "with the toolbar hidden by default").
 * Never shown on a screen without layouts.
 */
export function layoutToolbarShown(get, view, screen) {
  if (!normalizeScreen(screen)?.layouts.length) return false;
  const own = str(get(screenToolbarKey(view)));
  if (own === 'show') return true;
  if (own === 'hide') return false;
  const d = get(SCREEN_LAYOUT_KEYS.toolbarDefault);
  return d === true || d === 'true' || d === 'on';
}

/** The switcher's live-list rows for a screen (what the `screen-layouts` provider answers). Empty without layouts. */
export function layoutMenuItems(view, screen, current) {
  const s = normalizeScreen(screen);
  if (!s) return [];
  return s.layouts.map((l) => ({
    id: `layout:${l.id}`,
    label: l.label,
    icon: l.icon ?? 'layout',
    action: `${SCREEN_LAYOUT_ACTIONS.pick}:${l.id}:${view}`,
    checked: `setting:${screenLayoutKey(view)}=${l.id}`,
    ...(l.description ? { detail: l.description } : {}),
    ...(l.id === current ? { current: true } : {}),
  }));
}

/** The screen title's right-click items: the layouts (check mark on the current one), then show / hide the toolbar. */
export function screenTitleMenu(view, screen, shown) {
  const s = normalizeScreen(screen);
  if (!s || !s.layouts.length) return [];
  return [
    ...s.layouts.map((l) => ({ id: `screen-layout-${l.id}`, label: l.label, icon: l.icon ?? 'layout', action: `${SCREEN_LAYOUT_ACTIONS.pick}:${l.id}:${view}`, checked: `setting:${screenLayoutKey(view)}=${l.id}` })),
    { id: 'screen-layout-sep', separator: true },
    shown
      ? { id: 'screen-layout-toolbar', label: 'Hide layout toolbar', icon: 'x', action: `${SCREEN_LAYOUT_ACTIONS.toolbar}:hide:${view}` }
      : { id: 'screen-layout-toolbar', label: 'Show layout toolbar', icon: 'sliders', action: `${SCREEN_LAYOUT_ACTIONS.toolbar}:show:${view}` },
  ];
}

/** The layout toolbar's right-click items: its own copy or back to the shared one, then hide. */
export function layoutToolbarMenu(view, pluginId, hasCopy) {
  return [
    hasCopy
      ? { id: 'layout-toolbar-shared', label: 'Go back to the shared toolbar', icon: 'layers', action: `${SCREEN_LAYOUT_ACTIONS.shared}:${pluginId}` }
      : { id: 'layout-toolbar-copy', label: 'Give this plugin its own copy', icon: 'copy', action: `${SCREEN_LAYOUT_ACTIONS.copy}:${pluginId}` },
    { id: 'layout-toolbar-settings', label: 'All layout toolbars…', icon: 'settings', action: 'settings.open:toolbars' },
    { id: 'layout-toolbar-sep', separator: true },
    { id: 'layout-toolbar-hide', label: 'Hide layout toolbar', icon: 'x', action: `${SCREEN_LAYOUT_ACTIONS.toolbar}:hide:${view}` },
  ];
}

/* ───────────────────────── the plugin's own copy (inherit) ───────────────────────── */

/**
 * A plugin's copy of the switcher: `{ id, data }` where `data` holds only what the plugin changed. Until edited it is
 * empty and the copy reads the shared toolbar live, so a change to the shared toolbar still reaches a plugin whose
 * copy hasn't diverged. Stored as JSON under `axf.screens.layoutToolbar.copy.<plugin id>`.
 */
export function parseToolbarCopy(raw, pluginId) {
  let v = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { return null; } }
  if (!isObj(v)) return null;
  const id = str(v.id) || copyAssetId(pluginId);
  return { id: /^[a-z0-9][a-z0-9-]{1,47}$/.test(id) ? id : copyAssetId(pluginId), data: isObj(v.data) ? v.data : {} };
}

/** A fresh, unedited copy for a plugin (inherits everything). */
export function newToolbarCopy(pluginId) { return { id: copyAssetId(pluginId), data: {} }; }

/**
 * The toolbar envelope a plugin's layout toolbar draws: the shared asset as it is now (`shared` = its envelope), or the
 * plugin's copy over it (`copy.data` wins key by key at the top level of `data`; a copied `groups` replaces the groups).
 * `overrides` = the toolbar's chrome settings (chrome-settings@1, its right-click Toolbar settings…): `shared` applies to
 * the shared toolbar and so to every copy that hasn't set the same field, `copy` to this plugin's copy only. null when
 * there is no shared asset to inherit from.
 */
export function resolveLayoutToolbar(shared, copy, overrides = {}) {
  if (!isObj(shared) || !isObj(shared.data)) return null;
  const onShared = isObj(overrides.shared) ? overrides.shared : {};
  const onCopy = isObj(overrides.copy) ? overrides.copy : {};
  const base = { ...shared.data, ...onShared };
  if (!copy) return { id: shared.id, name: shared.name, data: base, shared: true };
  const edited = Object.keys(copy.data).length > 0 || Object.keys(onCopy).length > 0;
  return { id: copy.id, name: `${shared.name} (copy)`, data: { ...base, ...copy.data, ...onCopy }, shared: false, inherits: shared.id, edited };
}

/* ───────────────────────── UI Review ───────────────────────── */

/**
 * What the UI Review item's Layout dropdown may offer for a screen (Brett, Nov 4 2026: "UI Review will only allow you to
 * select from the three layouts it is going to generate"): only that screen's declared layouts, the default marked;
 * a screen without them (an older, grandfathered plugin) gets a disabled dropdown that says why. Never other layout
 * assets. `screens` = the app's normalized screens ({ [view]: { layouts, default } }), `view` = the screen under review.
 */
export function reviewLayoutChoices(screens, view) {
  const s = normalizeScreens(screens)[str(view)];
  if (!s || !s.layouts.length) return { view: str(view), options: [], disabled: true, reason: 'no layout variants', default: '' };
  const def = resolveScreenLayout(s, '');
  return { view: str(view), options: s.layouts.map((l) => ({ value: l.id, label: l.id === def ? `${l.label} (default)` : l.label, default: l.id === def })), disabled: false, reason: '', default: def };
}

/** The normalized screens of many manifests at once, keyed by view (first declaration wins; `pluginId` kept per view). */
export function screensOfManifests(manifests) {
  const out = {};
  for (const m of Array.isArray(manifests) ? manifests : []) {
    for (const [view, s] of Object.entries(normalizeScreens(m?.screens))) if (!(view in out)) out[view] = { ...s, plugin: str(m?.id) };
  }
  return out;
}

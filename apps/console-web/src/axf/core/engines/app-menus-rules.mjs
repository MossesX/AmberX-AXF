/**
 * app-menus@1 — every app has its own navigation menu and its own application menu, locked by default (Brett, Nov 18
 * 2026, build every-app-gets-own-locked-default; same model as settings-iface@1, settings-iface-rules.mjs).
 *
 * A menu (`nav-menu` / `app-menu` asset) says which app it is built for in `data.builtFor`: `app:<app>`, where <app>
 * is the app's folder under apps/ (console-web, axhub-web, amberx-droid, molly, walkthrough-studio, demo, …). Each app
 * ships one default of each kind, `default-<app>-nav` and `default-<app>-appmenu`, and its manifest's defaults name
 * them. The app knows who it is from that default id, so no extra manifest field is needed.
 *
 * Locked by default: the app's slot is on its default until the person ticks "Use another navigation menu" /
 * "Use another application menu" and picks one in the dialog. The dialog lists ONLY the menus built for that app.
 * A menu without a builtFor (the shared starters in framework/assets/nav-menu, framework/assets/app-menu) is never
 * offered and never used: every app is different. A saved pick that is not built for the app falls back to its
 * default, which is how older saved looks migrate.
 *
 * Kinds: `nav` (nav-menu) and `appmenu` (app-menu). The pick is the app's slot itself (app-look@1); unticking puts the
 * slot back on the default. Actions (console-visible: REST /api/console-control, MCP console tools, CLI `axf console`,
 * voice):
 *   menus.pick:<nav|appmenu>:<menu id|default>   pick (default = untick, back to the locked default)
 *   menus.choose:<nav|appmenu>                    open the picker dialog
 *
 * Pure: no DOM, no runtime. The reference engine; the Kotlin twin is deferred (framework/spec/PORTING.md).
 * Golden outputs: framework/spec/fixtures/app-menus.json (node framework/spec/check-app-menus.mjs --write).
 */

export const APP_MENUS_CONTRACT = 'app-menus@1';
export const APP_MENU_FIELD = 'builtFor';
export const APP_MENU_KINDS = { nav: 'nav-menu', appmenu: 'app-menu' };
export const APP_MENU_TYPES = Object.values(APP_MENU_KINDS);
export const APP_MENU_LABELS = { nav: 'navigation menu', appmenu: 'application menu' };

const APP = /^[a-z0-9][a-z0-9-]{0,30}$/;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The kind (`nav` | `appmenu`) of an asset type, or null when it is not a menu type. */
export function menuKindOf(type) {
  for (const [k, t] of Object.entries(APP_MENU_KINDS)) if (t === type) return k;
  return null;
}

/** The asset type of a kind (`nav` → `nav-menu`), also accepting the type itself; null otherwise. */
export function menuTypeOf(kind) {
  if (APP_MENU_KINDS[kind]) return APP_MENU_KINDS[kind];
  return APP_MENU_TYPES.includes(kind) ? kind : null;
}

/** `app:<app>` for a valid app name, else null. */
export function menuOwner(app) {
  return typeof app === 'string' && APP.test(app) ? `app:${app}` : null;
}

/** The app a builtFor value names (`app:molly` → `molly`), or null. */
export function parseMenuBuiltFor(v) {
  if (typeof v !== 'string' || !v.startsWith('app:')) return null;
  const app = v.slice(4);
  return APP.test(app) ? app : null;
}

/** The default menu id of an app for a kind or type: `default-<app>-nav` / `default-<app>-appmenu`. */
export function menuDefaultId(app, kindOrType) {
  const type = menuTypeOf(kindOrType);
  if (!type || !menuOwner(app)) return null;
  return `default-${app}-${menuKindOf(type)}`;
}

/** The app and kind of a default id (`default-molly-nav` → `{ app: 'molly', kind: 'nav', type: 'nav-menu' }`), or null. */
export function parseMenuDefaultId(id) {
  const m = typeof id === 'string' ? /^default-([a-z0-9][a-z0-9-]*)-(nav|appmenu)$/.exec(id) : null;
  if (!m || !APP.test(m[1])) return null;
  return { app: m[1], kind: m[2], type: APP_MENU_KINDS[m[2]] };
}

/**
 * The app a runtime belongs to, read from its manifest defaults: the app of its `default-<app>-nav` (or -appmenu).
 * null = an app not on app-menus@1 yet (it keeps the plain slot behaviour).
 */
export function appOfDefaults(defaults) {
  const d = isObj(defaults) ? defaults : {};
  for (const t of APP_MENU_TYPES) {
    const p = parseMenuDefaultId(d[t]);
    if (p && p.type === t) return p.app;
  }
  return null;
}

/** The app a menu asset is built for, or null (a shared, generic menu). */
export function menuBuiltForOf(asset) {
  return parseMenuBuiltFor(isObj(asset?.data) ? asset.data[APP_MENU_FIELD] : undefined);
}

/** Whether a menu asset may be used by an app: built for exactly that app. Non-menu assets are always allowed. */
export function menuAllowed(app, asset) {
  if (!asset || !menuKindOf(asset.type)) return true;
  return menuBuiltForOf(asset) === app;
}

/**
 * The picker's list for an app and a kind: its default first, then every other menu of that type built for exactly
 * this app, sorted by name. Shared menus and other apps' menus never appear. `[{ id, name, description, isDefault }]`.
 */
export function menuChoices(app, kindOrType, assets) {
  const type = menuTypeOf(kindOrType);
  const d = menuDefaultId(app, type);
  if (!d) return [];
  const mine = (Array.isArray(assets) ? assets : []).filter((a) => a && a.type === type && typeof a.id === 'string' && menuBuiltForOf(a) === app);
  const row = (a) => ({ id: a.id, name: typeof a.name === 'string' && a.name ? a.name : a.id, description: typeof a.description === 'string' ? a.description : '', isDefault: a.id === d });
  return [...mine.filter((a) => a.id === d).map(row), ...mine.filter((a) => a.id !== d).map(row).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))];
}

/**
 * What an app's menu slot uses now: `{ id, defaultId, locked, source }`. locked = on the default (checkbox unticked).
 * A pick that is gone, shared or built for another app falls back to the default (source `default`; `migrated` when
 * there was such a pick, so the caller can save the fallback).
 */
export function menuPick(current, app, kindOrType, assets) {
  const defaultId = menuDefaultId(app, kindOrType);
  const ids = menuChoices(app, kindOrType, assets).map((c) => c.id);
  if (typeof current === 'string' && current && current !== defaultId && ids.includes(current)) return { id: current, defaultId, locked: false, source: 'pick' };
  const migrated = typeof current === 'string' && current !== '' && current !== defaultId;
  return { id: defaultId, defaultId, locked: true, source: migrated ? 'migrated' : 'default' };
}

/**
 * The change `menus.pick:<kind>:<which>` makes: `{ id }` (the slot's new id; the default when unticking) or
 * `{ error }`. which = `default` (or empty / `off` / `untick`) unticks; anything else must be built for the app.
 */
export function menuSet(app, kindOrType, which, assets) {
  const type = menuTypeOf(kindOrType);
  if (!type) return { error: `No menu kind "${kindOrType}" (nav | appmenu).` };
  const defaultId = menuDefaultId(app, type);
  if (!defaultId) return { error: 'This app has no menus of its own (app-menus@1).' };
  const w = typeof which === 'string' ? which.trim() : '';
  if (!w || w === 'default' || w === 'off' || w === 'untick' || w === defaultId) return { id: defaultId };
  if (!menuChoices(app, type, assets).some((c) => c.id === w)) return { error: `"${w}" is not a ${APP_MENU_LABELS[menuKindOf(type)]} built for ${app}.` };
  return { id: w };
}

/** Parse the action args `[kind, which]` into `{ kind, type, which }`, or null. */
export function parseMenuArgs(args) {
  const a = Array.isArray(args) ? args.map((x) => String(x ?? '')) : [];
  const type = menuTypeOf(a[0]);
  return type ? { kind: menuKindOf(type), type, which: a.slice(1).join(':') } : null;
}

/** The readable state of an app's menus: `[{ kind, type, id, defaultId, locked, choices }]`. */
export function menuState(app, active, assets) {
  const act = isObj(active) ? active : {};
  return Object.entries(APP_MENU_KINDS).map(([kind, type]) => {
    const p = menuPick(act[type], app, type, assets);
    return { kind, type, id: p.id, defaultId: p.defaultId, locked: p.locked, choices: menuChoices(app, type, assets).map((c) => c.id) };
  });
}

/**
 * Audit one app (the CI guard): `{ app, errors }`. Every menu type has its default in the manifest and in the app's
 * own assets, built for the app; no menu the app ships is built for another app; the manifest never points at a
 * shared menu. `ownAssets` = the app's src/assets menus (not the baked shared set). `sharedIds` = `<type>/<id>` of the
 * framework's shared menus: an app's untagged copy of one is a shared menu (never offered), not an error.
 */
export function auditAppMenus(app, { defaults, ownAssets, sharedIds = [] } = {}) {
  const errors = [];
  if (!menuOwner(app)) return { app, errors: [`"${app}" is not a valid app name`] };
  const d = isObj(defaults) ? defaults : {};
  const own = Array.isArray(ownAssets) ? ownAssets : [];
  for (const [kind, type] of Object.entries(APP_MENU_KINDS)) {
    const want = menuDefaultId(app, kind);
    if (d[type] !== want) errors.push(`manifest defaults["${type}"] is ${JSON.stringify(d[type] ?? null)}, must be "${want}" (no shared menu)`);
    const file = own.find((a) => a?.type === type && a.id === want);
    if (!file) errors.push(`missing ${type} asset "${want}" in the app's own assets`);
    else if (menuBuiltForOf(file) !== app) errors.push(`${type} "${want}" must have data.builtFor "app:${app}"`);
  }
  for (const a of own) {
    if (!a || !menuKindOf(a.type)) continue;
    const b = menuBuiltForOf(a);
    if (b === null && sharedIds.includes(`${a.type}/${a.id}`)) continue;
    if (b === null) errors.push(`${a.type} "${a.id}" has no data.builtFor (every app menu is built for one app)`);
    else if (b !== app) errors.push(`${a.type} "${a.id}" is built for ${b}, not ${app}`);
    const p = parseMenuDefaultId(a.id);
    if (p && p.app !== app) errors.push(`${a.type} "${a.id}" is another app's default`);
  }
  return { app, errors };
}

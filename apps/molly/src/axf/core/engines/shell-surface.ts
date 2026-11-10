/*
 * Shell surface (shell-surface@1, build molly-one-shell s4, Nov 8 2026): what one app brings into a shell.
 *
 * Brett, Nov 8 2026: "Molly becomes the single shell for every app and plugin … Do NOT embed other apps as
 * pages/iframes … Every app's screens, plugins, menus and settings load natively into Molly as plugins, merged into
 * Molly's single menu/nav." Every app (Dev Console, axHub web, AmberX, Expenses, every later one) describes itself as
 * data, and a shell (Molly) builds one menu, one nav and one settings from all of them:
 *
 *   { $axf: 'shell-surface@1',
 *     app:   { id, label, icon?, description?, url? },               url = its standalone address ("open on its own")
 *     mount: { kind: 'native', module, export?, api?, auth },          the native mount seam (below); never a frame
 *     items: [{ kind, id, label, category?, icon?, detail?, keywords?, requires?, parent?, effect?, plugin? }] }
 *
 * Item kinds: `screen` (a view), `plugin`, `action`, `settings` (a settings tab), `setting` (one setting), `dialog`,
 * `menu` (an application-menu entry with an action). Open list: an unknown kind is kept as long as it has an id and a
 * label (so a later kind needs no contract change), and the shell decides whether it can open it.
 *
 * The mount seam: `module` names the app's native entry (an ES module the shell imports, e.g. `@axf-app/console`), and
 * `export` the function in it (default `mountSurface`) that registers the app's views, dialogs, settings tabs and
 * actions into the shell's runtime under the app's namespace. `api` is the https base its screens call; `auth` how
 * they sign in (`none`, `console-token`, `hub-session`, `app-session`), handed out by the shell. `kind` is `native`
 * only: a `frame` / `iframe` / `embed` mount is refused by name (no embedding, Brett, Nov 8 2026).
 *
 * Nothing here is written by hand per app: `surfaceFromSearch` turns an AXF app's own search index (views, actions,
 * settings tabs, settings, dialogs, contributed menu items, plugins' too) into its surface, and `surfaceFromCatalog` a
 * console-catalog@1 (console-commands.mjs), so a new plugin or screen shows up in the shell the moment it is
 * registered (Brett: "when a new plugin or UI is added anywhere, it appears automatically with no manual menu edits").
 *
 * Ids inside a shell are qualified `<app>:<kind>:<id>` (`qualify` / `parseRef`), so two apps never clash.
 * Pure (no IO, no DOM). Kotlin twin deferred (Android on hold, spec/PORTING.md); fixture spec/fixtures/shell-surface.json.
 */
import type { SearchEntry } from './search';

export const SHELL_SURFACE_CONTRACT = 'shell-surface@1';

/** The item kinds every shell knows (an open list: other kinds are kept). */
export const SURFACE_KINDS = ['screen', 'plugin', 'action', 'settings', 'setting', 'dialog', 'menu'] as const;
export type SurfaceKind = (typeof SURFACE_KINDS)[number] | (string & {});
/** The default category (menu group) of each kind when an item names none. */
export const KIND_CATEGORY: Readonly<Record<string, string>> = { screen: 'Screens', plugin: 'Plugins', action: 'Actions', settings: 'Settings', setting: 'Settings', dialog: 'Dialogs', menu: 'Menus' };
export const OTHER_CATEGORY = 'More';
/** How an app mounts in a shell. Native only. */
export const MOUNT_KINDS = ['native'] as const;
/** Mount kinds that would embed another app; refused by name. */
export const REFUSED_MOUNTS = ['frame', 'iframe', 'embed', 'webview', 'url'] as const;
export const AUTH_KINDS = ['none', 'console-token', 'hub-session', 'app-session'] as const;
export type AuthKind = (typeof AUTH_KINDS)[number];
export const EFFECTS = ['navigate', 'change', 'destructive'] as const;
export type Effect = (typeof EFFECTS)[number];
export const SURFACE_LIMITS = { items: 5000, id: 200, label: 120, detail: 200, keywords: 12, keyword: 40, category: 4, categoryPart: 60, module: 200, url: 300 } as const;
/** Separator of a qualified ref `<app>:<kind>:<id>` and of a category path written as a string (`A > B`). */
export const REF_SEP = ':';
export const CATEGORY_SEP = '>';

const APP_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const KIND_ID = /^[a-z][a-z0-9-]{0,31}$/;
const ITEM_ID = /^[^\s\u0000-\u001f\u007f][^\u0000-\u001f\u007f]{0,199}$/;
const ICON_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MODULE_ID = /^[@A-Za-z0-9][A-Za-z0-9@._\/-]{0,199}$/;
const EXPORT_ID = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;

export interface SurfaceApp { id: string; label: string; icon?: string; description?: string; url?: string }
export interface SurfaceMount { kind: 'native'; module: string; export: string; api?: string; auth: AuthKind }
export interface SurfaceItem {
  kind: SurfaceKind;
  /** the app's own id for it (unique per kind within the app) */
  id: string;
  label: string;
  /** menu group path, outermost first (`['Builds', 'Merge queue']`); absent = the kind's default group */
  category?: string[];
  icon?: string;
  detail?: string;
  keywords?: string[];
  /** UAC permission the shell checks before showing it */
  requires?: string;
  /** the id of the item it sits under (a setting under its settings tab, a plugin's screen under the plugin) */
  parent?: string;
  effect?: Effect;
  /** the plugin that contributed it (its manifest id) */
  plugin?: string;
}
export interface ShellSurface { $axf: typeof SHELL_SURFACE_CONTRACT; app: SurfaceApp; mount: SurfaceMount; items: SurfaceItem[] }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '');
const httpsUrl = (v: unknown): string | null => { const s = str(v, SURFACE_LIMITS.url); try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password ? u.toString().replace(/\/$/, '') : null; } catch { return null; } };

/** A category path from `['A', 'B']` or `'A > B'`: trimmed parts, empty ones dropped, at most 4 deep. */
export function parseCategory(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(CATEGORY_SEP) : [];
  return parts.map((p) => str(p, SURFACE_LIMITS.categoryPart)).filter(Boolean).slice(0, SURFACE_LIMITS.category);
}

/** The menu group path of an item: its own category, else the kind's default group. */
export function categoryOf(item: Pick<SurfaceItem, 'kind' | 'category'>): string[] {
  return item.category?.length ? [...item.category] : [KIND_CATEGORY[item.kind] ?? OTHER_CATEGORY];
}

/** One item, checked; null when it has no usable kind, id or label. */
export function parseItem(raw: unknown): SurfaceItem | null {
  if (!isObj(raw)) return null;
  const kind = str(raw.kind, 32).toLowerCase(), id = str(raw.id, SURFACE_LIMITS.id), label = str(raw.label, SURFACE_LIMITS.label);
  if (!KIND_ID.test(kind) || !ITEM_ID.test(id) || !label) return null;
  const out: SurfaceItem = { kind, id, label };
  const category = parseCategory(raw.category); if (category.length) out.category = category;
  const icon = str(raw.icon, 40); if (icon && ICON_ID.test(icon)) out.icon = icon;
  const detail = str(raw.detail, SURFACE_LIMITS.detail); if (detail) out.detail = detail;
  if (Array.isArray(raw.keywords)) {
    const kw = [...new Set(raw.keywords.map((k) => str(k, SURFACE_LIMITS.keyword).toLowerCase()).filter(Boolean))].slice(0, SURFACE_LIMITS.keywords);
    if (kw.length) out.keywords = kw;
  }
  const requires = str(raw.requires, 120); if (requires) out.requires = requires;
  const parent = str(raw.parent, SURFACE_LIMITS.id); if (parent && ITEM_ID.test(parent) && parent !== id) out.parent = parent;
  if ((EFFECTS as readonly string[]).includes(raw.effect as string)) out.effect = raw.effect as Effect;
  const plugin = str(raw.plugin, 80); if (plugin && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(plugin)) out.plugin = plugin;
  return out;
}

/** The app block, checked; null without a valid id. */
export function parseApp(raw: unknown): SurfaceApp | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 32).toLowerCase();
  if (!APP_ID.test(id)) return null;
  const out: SurfaceApp = { id, label: str(raw.label, SURFACE_LIMITS.label) || id };
  const icon = str(raw.icon, 40); if (icon && ICON_ID.test(icon)) out.icon = icon;
  const description = str(raw.description, SURFACE_LIMITS.detail); if (description) out.description = description;
  const url = httpsUrl(raw.url); if (url) out.url = url;
  return out;
}

/** The mount seam, checked; null when it isn't a native mount with a module. */
export function parseMount(raw: unknown): SurfaceMount | null {
  if (!isObj(raw) || raw.kind !== 'native') return null;
  const module = str(raw.module, SURFACE_LIMITS.module);
  if (!MODULE_ID.test(module)) return null;
  const exp = str(raw.export, 64);
  const out: SurfaceMount = { kind: 'native', module, export: EXPORT_ID.test(exp) ? exp : 'mountSurface', auth: (AUTH_KINDS as readonly string[]).includes(raw.auth as string) ? (raw.auth as AuthKind) : 'none' };
  const api = httpsUrl(raw.api); if (api) out.api = api;
  return out;
}

/** The items: bad ones dropped, (kind, id) repeats dropped (first wins), at most 5000. */
export function parseItems(raw: unknown): SurfaceItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SurfaceItem[] = []; const seen = new Set<string>();
  for (const v of raw) {
    if (out.length >= SURFACE_LIMITS.items) break;
    const it = parseItem(v); if (!it) continue;
    const key = `${it.kind}${REF_SEP}${it.id}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push(it);
  }
  return out;
}

/** A surface with every field checked; null when it has no valid app or no native mount. */
export function normalizeSurface(raw: unknown): ShellSurface | null {
  if (!isObj(raw)) return null;
  const app = parseApp(raw.app), mount = parseMount(raw.mount);
  if (!app || !mount) return null;
  return { $axf: SHELL_SURFACE_CONTRACT, app, mount, items: parseItems(raw.items) };
}

/** What's wrong with a surface (empty = fine). A frame mount is named as refused (no embedding). */
export function surfaceErrors(raw: unknown): string[] {
  if (!isObj(raw)) return ['a shell surface must be an object'];
  const e: string[] = [];
  if (raw.$axf !== SHELL_SURFACE_CONTRACT) e.push(`$axf must be "${SHELL_SURFACE_CONTRACT}"`);
  if (!isObj(raw.app)) e.push('app must be an object { id, label, icon?, description?, url? }');
  else {
    if (!APP_ID.test(str(raw.app.id, 32).toLowerCase())) e.push(`app.id must match ${APP_ID.source}`);
    if (!str(raw.app.label, SURFACE_LIMITS.label)) e.push('app.label is required');
    if (raw.app.url !== undefined && !httpsUrl(raw.app.url)) e.push('app.url must be an https address');
  }
  if (!isObj(raw.mount)) e.push("mount must be an object { kind: 'native', module, export?, api?, auth? }");
  else {
    const k = raw.mount.kind;
    if ((REFUSED_MOUNTS as readonly unknown[]).includes(k)) e.push(`mount.kind "${String(k)}" is refused: apps mount natively, never in a frame (no embedding, Brett, Nov 8 2026)`);
    else if (k !== 'native') e.push("mount.kind must be 'native'");
    if (!MODULE_ID.test(str(raw.mount.module, SURFACE_LIMITS.module))) e.push('mount.module must name the app\'s native entry module');
    if (raw.mount.export !== undefined && !EXPORT_ID.test(str(raw.mount.export, 64))) e.push('mount.export must be a function name');
    if (raw.mount.api !== undefined && !httpsUrl(raw.mount.api)) e.push('mount.api must be an https address');
    if (raw.mount.auth !== undefined && !(AUTH_KINDS as readonly unknown[]).includes(raw.mount.auth)) e.push(`mount.auth must be one of: ${AUTH_KINDS.join(', ')}`);
  }
  if (!Array.isArray(raw.items)) e.push('items must be a list of { kind, id, label, … }');
  else {
    if (raw.items.length > SURFACE_LIMITS.items) e.push(`items has ${raw.items.length}; at most ${SURFACE_LIMITS.items}`);
    const seen = new Set<string>();
    raw.items.slice(0, SURFACE_LIMITS.items).forEach((v, i) => {
      if (!isObj(v)) { e.push(`items[${i}] must be an object`); return; }
      const it = parseItem(v);
      if (!it) { e.push(`items[${i}] needs a kind ([a-z-]), an id and a label`); return; }
      const key = `${it.kind}${REF_SEP}${it.id}`;
      if (seen.has(key)) e.push(`items[${i}] repeats ${key}`); else seen.add(key);
      if (v.effect !== undefined && !(EFFECTS as readonly unknown[]).includes(v.effect)) e.push(`items[${i}].effect must be one of: ${EFFECTS.join(', ')}`);
    });
  }
  return e;
}

/* ---------- qualified refs ---------- */

/** `<app>:<kind>:<id>`: an item's name inside a shell. */
export const qualify = (app: string, item: Pick<SurfaceItem, 'kind' | 'id'>) => `${app}${REF_SEP}${item.kind}${REF_SEP}${item.id}`;

/** The parts of a qualified ref (the id may itself hold `:`); null when it isn't one. */
export function parseRef(ref: string): { app: string; kind: string; id: string } | null {
  if (typeof ref !== 'string') return null;
  const a = ref.indexOf(REF_SEP); if (a <= 0) return null;
  const k = ref.indexOf(REF_SEP, a + 1); if (k <= a + 1) return null;
  const app = ref.slice(0, a), kind = ref.slice(a + 1, k), id = ref.slice(k + 1);
  return APP_ID.test(app) && KIND_ID.test(kind) && id ? { app, kind, id } : null;
}

/** The surface and item a ref names, or null. */
export function resolveRef(surfaces: readonly ShellSurface[], ref: string): { surface: ShellSurface; item: SurfaceItem } | null {
  const p = parseRef(ref); if (!p) return null;
  const surface = surfaces.find((s) => s.app.id === p.app); if (!surface) return null;
  const item = surface.items.find((i) => i.kind === p.kind && i.id === p.id);
  return item ? { surface, item } : null;
}

/** Surfaces checked and merged by app: one per app id (a later one for the same app replaces it), in first-seen order. */
export function mergeSurfaces(list: readonly unknown[]): ShellSurface[] {
  const byApp = new Map<string, ShellSurface>();
  for (const raw of list) { const s = normalizeSurface(raw); if (s) byApp.set(s.app.id, s); }
  return [...byApp.values()];
}

/* ---------- adapters: surfaces from what apps already register ---------- */

/** Search kinds → surface kinds. `asset`, `window` and `text` aren't places to go, so they're left out. */
export const SEARCH_KIND_MAP: Readonly<Record<string, SurfaceKind>> = { view: 'screen', action: 'action', 'settings-tab': 'settings', setting: 'setting', dialog: 'dialog', menu: 'menu', plugin: 'plugin' };

/** The app's own id behind a search entry (`view:home` → `home`, `setting:axf.x` → `axf.x`). */
function searchItemId(e: Pick<SearchEntry, 'id' | 'kind' | 'focus'>): string {
  const f = e.focus as Record<string, unknown> | undefined;
  if (f) {
    if (f.kind === 'view' && typeof f.view === 'string') return f.view;
    if (f.kind === 'action' && typeof f.spec === 'string') return f.spec;
    if (f.kind === 'dialog' && typeof f.id === 'string') return f.id;
    if (f.kind === 'setting' && typeof f.tab === 'string') return e.kind === 'settings-tab' ? f.tab : typeof f.anchor === 'string' && f.anchor ? f.anchor : e.id.replace(/^[a-z-]+:/, '');
  }
  return e.id.replace(/^[a-z-]+:/, '');
}

/** An AXF app's surface from its own search index (rt.search.entries()): every view, action, settings tab, setting, dialog and menu item it registers. */
export function surfaceFromSearch(app: unknown, mount: unknown, entries: readonly Pick<SearchEntry, 'id' | 'kind' | 'label' | 'detail' | 'icon' | 'keywords' | 'requires' | 'focus'>[]): ShellSurface | null {
  const items: Record<string, unknown>[] = [];
  for (const e of entries) {
    const kind = SEARCH_KIND_MAP[e.kind]; if (!kind) continue;
    const f = e.focus as Record<string, unknown> | undefined;
    const it: Record<string, unknown> = { kind, id: searchItemId(e), label: e.label, icon: e.icon, detail: e.detail, keywords: e.keywords, requires: e.requires };
    if (kind === 'setting' && f && typeof f.tab === 'string') it.parent = f.tab;
    items.push(it);
  }
  return normalizeSurface({ $axf: SHELL_SURFACE_CONTRACT, app, mount, items });
}

/** A surface from a console-catalog@1 (console-commands.mjs: what an open console reports). */
export function surfaceFromCatalog(app: unknown, mount: unknown, catalog: unknown): ShellSurface | null {
  const items = isObj(catalog) && Array.isArray(catalog.items) ? catalog.items : [];
  return normalizeSurface({ $axf: SHELL_SURFACE_CONTRACT, app, mount, items });
}

/** A surface's counts per kind (for pickers and the settings page). */
export function surfaceCounts(s: Pick<ShellSurface, 'items'>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of s.items) out[i.kind] = (out[i.kind] ?? 0) + 1;
  return out;
}

/*
 * Unified chrome (chrome@1) — Molly as ONE app (Brett, Nov 2 2026): "only ONE banner, application menu, navigation
 * menu and context menu render, covering the whole page; the user must not be able to tell it is multiple apps."
 *
 * Guest side: an app the host frames sends its chrome as DATA — application menu, navigation, context menus, toolbars,
 * banner widgets — in one `ChromeBundle` (an embed@1 `chrome` message; the host asks with `chrome-request`). No action
 * ids cross over: the app keeps id → action and runs an item only when the host sends `run` back with that id.
 *
 * Host side: `mergeChrome` folds the host's own chrome and every guest's into one namespaced model (`<app>:<id>`): one
 * menu bar (a top-level menu per app holding that app's menus), one navigation (a section per app), one context menu
 * per target (host items first, then each app's under its name), every toolbar, one widget per kind. Picks come back
 * through `routePick`: a host id → the app and the app's own id (or the host's own action).
 *
 * Pure; checked on both ends and cut to size (limits below). The xlayout@1 asset (engines/xlayout.ts) says which kinds
 * are merged; the embed@1 takes `nav-menu` / `context-menu` / `toolbar` / `widgets` (+ `app-menu`) carry it to the
 * guests. Kotlin twin deferred (spec/PORTING.md); fixture spec/fixtures/chrome.json.
 */
import { parseEmbedMenus, type EmbedMenu, type EmbedMenuItem } from './embed';

export const CHROME_CONTRACT = 'chrome@1';
export const CHROME_LIMITS = { apps: 12, label: 80, id: 160, icon: 40, navSections: 12, navItems: 120, context: 40, contextItems: 400, toolbars: 6, toolbarItems: 60, widgets: 12, text: 120, raw: 196608 } as const;
export const NS = ':';

const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,159}$/;
const APP_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ICON_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TARGET_ID = /^[A-Za-z0-9*][A-Za-z0-9._:*-]{0,63}$/;
export const WIDGET_TYPES = ['clock', 'counter', 'status', 'badge', 'avatar', 'progress', 'search-bar', 'label', 'link', 'theme-switch'] as const;
export const WIDGET_TONES = ['neutral', 'accent', 'success', 'warning', 'danger'] as const;

export interface ChromeNavItem { id: string; label: string; icon?: string; /** a count badge */ badge?: number; /** greyed out (the app's access policy) */ locked?: boolean }
export interface ChromeNavSection { label?: string; items: ChromeNavItem[] }
export interface ChromeToolbarItem { id: string; label: string; icon: string; badge?: number; /** drawn pressed (a toggle that is on) */ pressed?: boolean; locked?: boolean }
export interface ChromeToolbar { id: string; label?: string; items: ChromeToolbarItem[] }
export interface ChromeContextTarget { target: string; items: EmbedMenuItem[] }
/** What a banner widget shows (data only: the host draws it with its own widget assets). */
export interface ChromeWidget { id: string; type: (typeof WIDGET_TYPES)[number]; label?: string; text?: string; icon?: string; tone?: (typeof WIDGET_TONES)[number]; count?: number }

export interface ChromeBundle {
  $axf: typeof CHROME_CONTRACT;
  /** the app's id as the host knows it (its namespace) */
  app: string;
  label?: string;
  menus: EmbedMenu[];
  nav: ChromeNavSection[];
  /** the navigation item that is active in the app right now */
  active?: string;
  context: ChromeContextTarget[];
  toolbars: ChromeToolbar[];
  widgets: ChromeWidget[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const clip = (v: unknown, max: number): string | undefined => { if (typeof v !== 'string') return undefined; const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim(); return s ? s.slice(0, max) : undefined; };
const count = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 99999) : undefined);

function parseNav(raw: unknown): ChromeNavSection[] {
  if (!Array.isArray(raw)) return [];
  let budget = CHROME_LIMITS.navItems; const seen = new Set<string>();
  const out: ChromeNavSection[] = [];
  for (const s of raw.slice(0, CHROME_LIMITS.navSections)) {
    if (!isObj(s) || !Array.isArray(s.items)) continue;
    const items: ChromeNavItem[] = [];
    for (const v of s.items) {
      if (budget <= 0 || !isObj(v) || typeof v.id !== 'string' || !ITEM_ID.test(v.id) || seen.has(v.id)) continue;
      const label = clip(v.label, CHROME_LIMITS.label); if (!label) continue;
      budget--; seen.add(v.id);
      const it: ChromeNavItem = { id: v.id, label };
      if (typeof v.icon === 'string' && ICON_ID.test(v.icon)) it.icon = v.icon;
      const b = count(v.badge); if (b !== undefined) it.badge = b;
      if (v.locked === true) it.locked = true;
      items.push(it);
    }
    if (!items.length) continue;
    const sec: ChromeNavSection = { items }; const label = clip(s.label, CHROME_LIMITS.label); if (label) sec.label = label;
    out.push(sec);
  }
  return out;
}

function parseContext(raw: unknown): ChromeContextTarget[] {
  if (!Array.isArray(raw)) return [];
  let budget = CHROME_LIMITS.contextItems; const seen = new Set<string>();
  const out: ChromeContextTarget[] = [];
  const countItems = (items: EmbedMenuItem[]): number => items.reduce((a, i) => a + 1 + (i.items ? countItems(i.items) : 0), 0);
  for (const t of raw.slice(0, CHROME_LIMITS.context)) {
    if (!isObj(t) || typeof t.target !== 'string' || !TARGET_ID.test(t.target) || seen.has(t.target)) continue;
    // reuse the menu parser: one pseudo menu whose items are the target's items
    const menus = parseEmbedMenus([{ id: 'ctx', label: 'ctx', items: t.items }]);
    const items = menus?.[0]?.items ?? [];
    if (!items.length) continue;
    const n = countItems(items); if (n > budget) continue; budget -= n;
    seen.add(t.target);
    out.push({ target: t.target, items });
  }
  return out;
}

function parseToolbars(raw: unknown): ChromeToolbar[] {
  if (!Array.isArray(raw)) return [];
  let budget = CHROME_LIMITS.toolbarItems; const seen = new Set<string>();
  const out: ChromeToolbar[] = [];
  for (const t of raw.slice(0, CHROME_LIMITS.toolbars)) {
    if (!isObj(t) || typeof t.id !== 'string' || !ITEM_ID.test(t.id) || seen.has(t.id) || !Array.isArray(t.items)) continue;
    const items: ChromeToolbarItem[] = []; const ids = new Set<string>();
    for (const v of t.items) {
      if (budget <= 0 || !isObj(v) || typeof v.id !== 'string' || !ITEM_ID.test(v.id) || ids.has(v.id)) continue;
      const label = clip(v.label, CHROME_LIMITS.label); if (!label) continue;
      const icon = typeof v.icon === 'string' && ICON_ID.test(v.icon) ? v.icon : 'circle';
      budget--; ids.add(v.id);
      const it: ChromeToolbarItem = { id: v.id, label, icon };
      const b = count(v.badge); if (b !== undefined) it.badge = b;
      if (v.pressed === true) it.pressed = true;
      if (v.locked === true) it.locked = true;
      items.push(it);
    }
    if (!items.length) continue;
    seen.add(t.id);
    const tb: ChromeToolbar = { id: t.id, items }; const label = clip(t.label, CHROME_LIMITS.label); if (label) tb.label = label;
    out.push(tb);
  }
  return out;
}

function parseWidgets(raw: unknown): ChromeWidget[] {
  if (!Array.isArray(raw)) return [];
  const out: ChromeWidget[] = []; const seen = new Set<string>();
  for (const v of raw) {
    if (out.length >= CHROME_LIMITS.widgets || !isObj(v) || typeof v.id !== 'string' || !ITEM_ID.test(v.id) || seen.has(v.id)) continue;
    if (typeof v.type !== 'string' || !(WIDGET_TYPES as readonly string[]).includes(v.type)) continue;
    seen.add(v.id);
    const w: ChromeWidget = { id: v.id, type: v.type as ChromeWidget['type'] };
    const label = clip(v.label, CHROME_LIMITS.label); if (label) w.label = label;
    const text = clip(v.text, CHROME_LIMITS.text); if (text) w.text = text;
    if (typeof v.icon === 'string' && ICON_ID.test(v.icon)) w.icon = v.icon;
    if (typeof v.tone === 'string' && (WIDGET_TONES as readonly string[]).includes(v.tone)) w.tone = v.tone as ChromeWidget['tone'];
    const c = count(v.count); if (c !== undefined) w.count = c;
    out.push(w);
  }
  return out;
}

/** A bundle as it arrived (object or JSON text), checked and cut to size; null when it isn't one (no app id = not a bundle). */
export function parseChromeBundle(raw: unknown): ChromeBundle | null {
  let m: unknown = raw;
  if (typeof raw === 'string') { if (raw.length > CHROME_LIMITS.raw) return null; try { m = JSON.parse(raw); } catch { return null; } }
  if (!isObj(m) || m.$axf !== CHROME_CONTRACT) return null;
  const app = typeof m.app === 'string' ? m.app.trim().toLowerCase() : '';
  if (!APP_ID.test(app)) return null;
  const out: ChromeBundle = { $axf: CHROME_CONTRACT, app, menus: parseEmbedMenus(m.menus) ?? [], nav: parseNav(m.nav), context: parseContext(m.context), toolbars: parseToolbars(m.toolbars), widgets: parseWidgets(m.widgets) };
  const label = clip(m.label, CHROME_LIMITS.label); if (label) out.label = label;
  if (typeof m.active === 'string' && ITEM_ID.test(m.active) && out.nav.some((s) => s.items.some((i) => i.id === m.active))) out.active = m.active;
  return out;
}

/** An empty bundle for an app (what a guest sends before it has anything, or a host uses for its own chrome). */
export const emptyChrome = (app: string, label?: string): ChromeBundle => ({ $axf: CHROME_CONTRACT, app, ...(label ? { label } : {}), menus: [], nav: [], context: [], toolbars: [], widgets: [] });

/* ---------- namespacing ---------- */

/** `<app>:<id>` — the host's id for an app's item (the host's own items keep their ids). */
export const nsId = (app: string, id: string) => `${app}${NS}${id}`;

/** Where a host id leads: an app and the app's own id, or the host itself (`app: null`) when no known app owns the prefix. */
export function routePick(hostId: string, apps: readonly string[]): { app: string | null; id: string } {
  const at = hostId.indexOf(NS);
  if (at > 0) { const app = hostId.slice(0, at), id = hostId.slice(at + 1); if (id && apps.includes(app)) return { app, id }; }
  return { app: null, id: hostId };
}

const nsItems = (app: string, items: EmbedMenuItem[]): UnifiedMenuItem[] => items.map((i) => { const { items: kids, ...rest } = i; const out: UnifiedMenuItem = { ...rest, id: nsId(app, i.id), app }; if (kids) out.items = nsItems(app, kids); return out; });
const hostItems = (items: EmbedMenuItem[]): UnifiedMenuItem[] => items.map((i) => { const { items: kids, ...rest } = i; const out: UnifiedMenuItem = { ...rest, app: null }; if (kids) out.items = hostItems(kids); return out; });

/* ---------- the merged model ---------- */

export interface UnifiedMenuItem extends Omit<EmbedMenuItem, 'items'> { /** the app that owns it (null = the host) */ app: string | null; items?: UnifiedMenuItem[] }
export interface UnifiedMenu { id: string; label: string; app: string | null; items: UnifiedMenuItem[] }
export interface UnifiedNavItem extends ChromeNavItem { app: string | null; active: boolean }
export interface UnifiedNavSection { id: string; label?: string; app: string | null; items: UnifiedNavItem[] }
export interface UnifiedToolbar extends Omit<ChromeToolbar, 'items'> { app: string | null; items: (ChromeToolbarItem & { app: string | null })[] }
export interface UnifiedWidget extends ChromeWidget { app: string | null }
export interface UnifiedChrome {
  /** the host's menus first, then one top-level menu per app holding that app's menus (an app with one menu shows it flat) */
  menus: UnifiedMenu[];
  /** the host's sections first, then one section per app (labelled with the app's name) */
  nav: UnifiedNavSection[];
  /** target → host items first, then each app's items under a separator; `default` always present */
  context: Record<string, UnifiedMenuItem[]>;
  toolbars: UnifiedToolbar[];
  /** one widget per kind: the host's first, then the first app that sends it; the others are noted */
  widgets: UnifiedWidget[];
  /** what was left out and why (two clocks, an app named twice…) */
  notes: string[];
  /** the apps that took part, in order */
  apps: string[];
}

export interface MergeOptions {
  /** the order the apps appear in (unknown apps follow, in arrival order) */
  order?: readonly string[];
  /** the app on screen (its nav section comes first among the apps, its active item is the active one) */
  activeApp?: string | null;
  /** one widget per kind across apps (default true); false keeps every widget */
  widgetsOnce?: boolean;
  /** menus: `per-app` (default) = a top-level menu per app; `flat` = every app's menus side by side, labels prefixed */
  menus?: 'per-app' | 'flat';
}

/**
 * Fold the host's own chrome (`host`, may be null) and every guest bundle into one model. Every guest id is namespaced
 * `<app>:<id>`; the host's ids stay as they are. A guest sent twice keeps its last bundle.
 */
export function mergeChrome(host: ChromeBundle | null, guests: readonly ChromeBundle[], opts: MergeOptions = {}): UnifiedChrome {
  const notes: string[] = [];
  const byApp = new Map<string, ChromeBundle>();
  for (const g of guests) { if (byApp.has(g.app)) notes.push(`${g.app}: sent its chrome again; the newer one is used`); byApp.set(g.app, g); }
  const order = [...(opts.order ?? [])].filter((a) => byApp.has(a));
  for (const a of byApp.keys()) if (!order.includes(a)) order.push(a);
  const active = opts.activeApp && byApp.has(opts.activeApp) ? opts.activeApp : null;
  const appsOrdered = active ? [active, ...order.filter((a) => a !== active)] : order;
  const label = (g: ChromeBundle) => g.label ?? g.app;

  // menus
  const menus: UnifiedMenu[] = (host?.menus ?? []).map((m) => ({ id: m.id, label: m.label, app: null, items: hostItems(m.items) }));
  for (const a of order) {
    const g = byApp.get(a)!; if (!g.menus.length) continue;
    if (opts.menus === 'flat') { for (const m of g.menus) menus.push({ id: nsId(a, m.id), label: g.menus.length > 1 ? `${label(g)} · ${m.label}` : label(g), app: a, items: nsItems(a, m.items) }); continue; }
    if (g.menus.length === 1) { menus.push({ id: nsId(a, g.menus[0]!.id), label: label(g), app: a, items: nsItems(a, g.menus[0]!.items) }); continue; }
    menus.push({ id: nsId(a, 'menu'), label: label(g), app: a, items: g.menus.map((m) => ({ id: nsId(a, m.id), label: m.label, app: a, items: nsItems(a, m.items) })) });
  }
  // navigation
  // one active item on the page: the active app's; the host's own only while no app is on screen
  const nav: UnifiedNavSection[] = (host?.nav ?? []).map((s, i) => ({ id: `host-${i}`, ...(s.label ? { label: s.label } : {}), app: null, items: s.items.map((it) => ({ ...it, app: null, active: !active && host?.active === it.id })) }));
  for (const a of appsOrdered) {
    const g = byApp.get(a)!;
    const items = g.nav.flatMap((s) => s.items).map((it) => ({ ...it, id: nsId(a, it.id), app: a, active: a === active && g.active === it.id }));
    if (items.length) nav.push({ id: nsId(a, 'nav'), label: label(g), app: a, items });
  }
  // context menus, per target
  const context: Record<string, UnifiedMenuItem[]> = {};
  for (const t of host?.context ?? []) context[t.target] = hostItems(t.items);
  for (const a of order) {
    const g = byApp.get(a)!;
    for (const t of g.context) {
      const list = context[t.target] ?? (context[t.target] = []);
      if (list.length) list.push({ id: nsId(a, `sep-${t.target}`), label: '', separator: true, app: a });
      list.push(...nsItems(a, t.items));
    }
  }
  if (!context.default) context.default = [];
  // toolbars
  const toolbars: UnifiedToolbar[] = (host?.toolbars ?? []).map((t) => ({ ...t, app: null, items: t.items.map((i) => ({ ...i, app: null })) }));
  for (const a of order) for (const t of byApp.get(a)!.toolbars) toolbars.push({ id: nsId(a, t.id), ...(t.label ? { label: `${label(byApp.get(a)!)} · ${t.label}` } : { label: label(byApp.get(a)!) }), app: a, items: t.items.map((i) => ({ ...i, id: nsId(a, i.id), app: a })) });
  // widgets: one per kind
  const widgets: UnifiedWidget[] = []; const kinds = new Set<string>();
  const once = opts.widgetsOnce !== false;
  const take = (w: ChromeWidget, app: string | null) => {
    if (once && kinds.has(w.type)) { notes.push(`${app ?? 'host'}: ${w.type} widget "${w.id}" left out, the ${widgets.find((x) => x.type === w.type)!.app ?? 'host'} one is shown`); return; }
    kinds.add(w.type); widgets.push({ ...w, id: app ? nsId(app, w.id) : w.id, app });
  };
  for (const w of host?.widgets ?? []) take(w, null);
  for (const a of order) for (const w of byApp.get(a)!.widgets) take(w, a);
  return { menus, nav, context, toolbars, widgets, notes, apps: order };
}

/** Every pick a merged model can send back (leaf items: no separators, no submenu heads), with where it leads (the host's own ids route to `app: null`). */
export function chromePicks(u: UnifiedChrome): { id: string; app: string | null }[] {
  const out: { id: string; app: string | null }[] = [];
  const walk = (items: UnifiedMenuItem[]) => { for (const i of items) { if (i.items) walk(i.items); else if (!i.separator) out.push({ id: i.id, app: i.app }); } };
  for (const m of u.menus) walk(m.items);
  for (const s of u.nav) for (const i of s.items) out.push({ id: i.id, app: i.app });
  for (const items of Object.values(u.context)) walk(items);
  for (const t of u.toolbars) for (const i of t.items) out.push({ id: i.id, app: i.app });
  return out;
}

/** The nav item that is active in the merged navigation (the active app's), or null. */
export function activeNav(u: UnifiedChrome): UnifiedNavItem | null {
  for (const s of u.nav) for (const i of s.items) if (i.active) return i;
  return null;
}

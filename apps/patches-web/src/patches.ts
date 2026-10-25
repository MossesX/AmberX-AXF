/**
 * Patches (web): the Dev Console, Build Pilot and axHub (and plugin tabs such as Todos) working as one app.
 *
 * Suite mode (Brett, Oct 24 2026: "make it all function like 1 professional high level app when patches runs things").
 * Every app tab is marked with embed@1 (`?axf-embed=patches&axf-embed-hide=none&axf-embed-take=banner,app-menu,search,links`):
 *  - one banner: the app hides its own banner and sends what is on it (`banner`); Patches draws the front app's items on
 *    its banner, next to its own;
 *  - one menu bar: the app hides its menu bar and sends its menu (`menu`); Patches' menu bar shows the front app's menus;
 *  - one search: the app sends its search entries (`search-catalog`) and hands Ctrl/Cmd+K over (`focus-search`); Patches'
 *    search box finds things in every app and opens them in their tab;
 *  - one set of tabs: a link to another app (`open-url`) brings that app's tab up instead of opening a browser tab;
 *  - one look: colours, style and controls are one choice for every app (the shared part of axHub's appearance document,
 *    engines/appearance.ts); each app keeps its own layout, menus and bars.
 * Nothing else changes: each app keeps its own pages, settings, plugins and toolbar. An app built before suite mode
 * ignores the takes it doesn't know and draws that part itself, so nothing is ever lost.
 *
 * Pure helpers here (tests: test.mts); the UI is in patchesLibrary.tsx.
 */
import {
  EMBED_MESSAGE, embedUrlFull, parseEmbedMessage,
  type EmbedBannerItem, type EmbedMenu, type EmbedMenuItem, type EmbedMessage, type EmbedPlugin, type EmbedSearchEntry, type MenuItem, type SearchEntry,
} from './axf/core';
import manifest from '../axf.manifest.json';

export const HOST_ID = 'patches';

/** What Patches takes from the app in a tab (not from a plugin page or the banner strip, which share nothing). */
export const TAB_TAKES = ['banner', 'app-menu', 'search', 'links'] as const;

export interface PatchTab {
  id: 'console' | 'pilot' | 'axhub';
  label: string;
  icon: string;
  /** settings key holding its address ('' = the hub, from the manifest) */
  key: string;
  /** default address (https host only) */
  fallback: string;
  /** the page the tab opens on */
  path: string;
  /** which of its addresses load in the tab (`any`: a single-page app answers every path; `root`: only its start page) */
  pages: 'any' | 'root';
  /** one line for Settings → Patches → Apps */
  blurb: string;
}

/** The hub's address (manifest developer.hub, else axHub's public address). */
export const HUB = normalizeOrigin((manifest as { developer?: { hub?: string } }).developer?.hub) ?? 'https://axhub.amberxai.com';

export const TABS: PatchTab[] = [
  { id: 'console', label: 'Console', icon: 'terminal', key: 'patches.console', fallback: 'https://console.amberxai.com', path: '/', pages: 'any', blurb: 'The Dev Console: framework, builds, plugins.' },
  { id: 'pilot', label: 'Pilot', icon: 'rocket', key: 'patches.pilot', fallback: 'https://pilot.amberxai.com', path: '/', pages: 'any', blurb: 'Build Pilot: design and build apps.' },
  // axHub's front end (apps/axhub-web) answers only its start page; every other hub address is the hub server's own page.
  { id: 'axhub', label: 'axHub', icon: 'layers', key: '', fallback: HUB, path: '/', pages: 'root', blurb: 'axHub: approvals, the app catalog, the hub.' },
];

/** Setting: the Dev Console's plugin banners above every tab (the banner strip). On by default in suite mode. */
export const BANNERS_KEY = 'patches.strip';
/** Setting: open on the tab that was in front last time (per device). */
export const REMEMBER_KEY = 'patches.remember';
/** Setting: load every app tab in the background as Patches opens (search, menus and banners cover every app at once). */
export const WARM_KEY = 'patches.warm';
/** Device storage: the tab in front. */
export const FRONT_STORE = 'patches.front';

/** An https origin (scheme + host + port, no path, no credentials), or null. */
export function normalizeOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 200) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname) return null;
    return u.origin;
  } catch { return null; }
}

/** A tab's origin: its saved address (https host only; anything else = its default). */
export function tabOrigin(t: PatchTab, saved: unknown): string {
  if (!t.key) return HUB;
  return normalizeOrigin(saved) ?? normalizeOrigin(t.fallback)!;
}

/**
 * The page a tab shows: its app, marked for suite mode. `hide=none`: nothing is hidden beyond what Patches carries for it
 * (its banner, its menu bar), so an older build that doesn't know a take still shows that part itself.
 */
export function tabUrl(t: PatchTab, origin: string, page?: string): string {
  return embedUrlFull(page ?? `${origin}${t.path}`, HOST_ID, { hidden: ['none'], takes: [...TAB_TAKES] });
}

/** The banner strip: the Dev Console's plugin banners on their own page, above every tab. It shares nothing. */
export function stripUrl(consoleOrigin: string): string {
  return embedUrlFull(`${consoleOrigin}/?axf-strip=banners`, HOST_ID);
}

/** What the console's banner strip page sends Patches (patches-strip@1): its height, or "bring the Console tab up". */
export type StripMessage = { $axf: 'patches-strip@1'; type: 'height'; px: number } | { $axf: 'patches-strip@1'; type: 'open'; tab: 'console' };

export function parseStripMessage(raw: unknown): StripMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.$axf !== 'patches-strip@1') return null;
  if (o.type === 'height' && typeof o.px === 'number' && Number.isFinite(o.px)) return { $axf: 'patches-strip@1', type: 'height', px: Math.max(0, Math.min(400, Math.round(o.px))) };
  if (o.type === 'open' && o.tab === 'console') return { $axf: 'patches-strip@1', type: 'open', tab: 'console' };
  return null;
}

/** An embed@1 message from one of the apps (anything else is ignored). */
export function fromApp(data: unknown): EmbedMessage | null { return parseEmbedMessage(data); }

/* ---------------- tab states ---------------- */

/** loading → ready (it said so, or loaded without suite mode); slow after a while; error when it never loaded. */
export type TabStatus = 'loading' | 'ready' | 'slow' | 'error';
export interface TabState {
  status: TabStatus;
  /** what the app said it hands Patches (`ready` message); empty = an older build that draws everything itself */
  takes: string[];
  /** it said `ready` (suite mode); false = it only loaded */
  suite: boolean;
  /** when the current status started (ms) */
  since: number;
}
/** After the page loaded, how long to wait for `ready` before treating it as an older build. */
export const READY_WAIT_MS = 2500;
/** Loading this long: say it is slow (the cover stays, with Reload). */
export const SLOW_MS = 12_000;
/** Loading this long without the page ever loading: say it failed. */
export const ERROR_MS = 45_000;

/** "banner, menu, search and links": what an app hands Patches, in words. */
export function shareSummary(takes: readonly string[]): string {
  const words = TAB_TAKES.filter((t) => takes.includes(t)).map((t) => (t === 'app-menu' ? 'menu' : t));
  if (!words.length) return 'nothing (an older build: it shows its own banner and menu)';
  return words.length === 1 ? words[0]! : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/* ---------------- the front app's banner items on Patches' banner ---------------- */

/** Banner items Patches has its own of (its clock, day/night switch, search box, mark) or that only space things out. */
export const OWN_BANNER_TYPES = new Set(['clock', 'theme-switch', 'logo', 'spacer', 'divider', 'search-bar']);
/** The counter Patches' own axHub badge reads; an app's copy of that badge isn't shown twice. */
const HUB_COUNTER = 'hub.live';

export interface MirroredItem { type: string; id: string; key: string; at: 'left' | 'center' | 'right'; order: number; data: Record<string, unknown>; counter?: { name: string; value: number }; popup?: string }

/** The asset id an app's banner item gets in Patches (`g-<tab>-<item>`, an asset id: ≤ 48, lowercase). */
export function mirroredId(tab: string, key: string, i: number): string {
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  const id = `g-${tab}-${slug}`;
  return id.length <= 48 ? id : `${id.slice(0, 44).replace(/-+$/, '')}-${i}`;
}

/** The counter an app's banner counter becomes in Patches (each app keeps its own numbers). */
export function bannerCounter(tab: string, counter: string): string { return `patches.g.${tab}.${counter}`; }

const isSettingsAction = (a: unknown) => typeof a === 'string' && (a === 'app.settings' || a === 'nav:settings' || a.startsWith('settings.open'));

/**
 * What of an app's banner Patches shows: its own items (badges, status, counters, buttons, labels…), with their taps
 * turned into `patches.w:<tab>:<key>` (Patches brings the tab up and hands the tap back) and their counters renamed per
 * app. Left out: what Patches has itself (clock, day/night, search box, mark, its axHub badge), spacing, and the app's
 * own Settings button (its settings are in its menu and in Patches → Settings → Apps).
 * Order: left items after Patches' mark, right items before Patches' own (day/night, clock, gear), center after the search.
 */
export function mirrorBanner(tab: PatchTab['id'], items: readonly EmbedBannerItem[]): MirroredItem[] {
  const out: MirroredItem[] = [];
  for (const it of items) {
    if (OWN_BANNER_TYPES.has(it.type)) continue;
    const data: Record<string, unknown> = { ...it.data };
    if (it.type === 'status' && data.counter === HUB_COUNTER) continue;
    if (it.type === 'action-button' && isSettingsAction(data.action)) continue;
    const tap = `patches.w:${tab}:${it.key}`;
    if (it.type === 'action-button') data.action = tap;
    else if (it.type !== 'link' && typeof data.link === 'string' && data.link) data.link = tap;
    let counter: MirroredItem['counter'];
    if (typeof data.counter === 'string' && data.counter) {
      counter = { name: bannerCounter(tab, data.counter), value: it.value ?? 0 };
      data.counter = counter.name;
    }
    const base = it.at === 'left' ? 6 : it.at === 'center' ? 50 : 1;
    const m: MirroredItem = { type: it.type, id: mirroredId(tab, it.key, out.length), key: it.key, at: it.at, order: base + Math.min(it.order, 99) / 100, data };
    if (counter) m.counter = counter;
    if (it.popup) m.popup = it.popup;
    out.push(m);
  }
  return out;
}

/* ---------------- one search over every app ---------------- */

/** An app's search entries as entries of Patches' search: labelled with the app, picked through `patches.find`. */
export function guestSearchEntries(t: PatchTab, entries: readonly EmbedSearchEntry[]): SearchEntry[] {
  return entries.filter((e) => !e.locked).map((e) => ({
    id: `patches.${t.id}.${e.id}`,
    kind: e.kind,
    label: e.label,
    detail: e.detail ? `${t.label} · ${e.detail}` : t.label,
    ...(e.icon ? { icon: e.icon } : {}),
    keywords: [...(e.keywords ?? []), t.label],
    focus: { kind: 'action', spec: `patches.find:${t.id}:${e.id}` },
  }));
}

/* ---------------- links between the apps ---------------- */

/** The tab that shows this address in place, or null (another site, or a hub page that isn't its front end). */
export function tabForUrl(url: string, origins: Readonly<Record<string, string>>): { tab: PatchTab; url: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const tab = TABS.find((t) => origins[t.id] === u.origin);
  if (!tab) return null;
  if (tab.pages === 'root' && u.pathname !== '/' && u.pathname !== '/index.html') return null;
  return { tab, url: u.href };
}

/** The message that tells an app which other apps Patches has (their links then open in their tab). */
export function appsMessage(origins: Readonly<Record<string, string>>): EmbedMessage {
  return { $axf: EMBED_MESSAGE, type: 'apps', apps: TABS.map((t) => ({ id: t.id, label: t.label, origin: origins[t.id] ?? tabOrigin(t, null) })) };
}

/* ---------------- deep links and shortcuts ---------------- */

/** `#/pilot` (or `#pilot`) → the view it names, when Patches has it. */
export function viewFromHash(hash: string, known: readonly string[]): string | null {
  const v = decodeURIComponent(hash.replace(/^#\/?/, '')).trim();
  return v && known.includes(v) ? v : null;
}
export function hashForView(view: string): string { return `#/${encodeURIComponent(view)}`; }

/** Alt+1 … Alt+9 → tab 0 … 8 (Ctrl, Cmd and Shift untouched, so the apps' own shortcuts keep working). */
export function tabShortcut(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; code?: string; key?: string }): number | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  const m = /^Digit([1-9])$/.exec(e.code ?? '') ?? /^([1-9])$/.exec(e.key ?? '');
  return m ? Number(m[1]) - 1 : null;
}

/* ---------------- the front app's menus in Patches' menu bar ---------------- */

/**
 * An app's menus as Patches' own: each of its menus becomes a top-level menu of Patches' menu bar while its tab is in
 * front (like a desktop menu bar following the front window). Items carry no action of the app's: picking one runs
 * `patches.menu:<tab>:<item id>`, which hands the id back to the app (`run`). Check marks and counts become Patches
 * counters (`counterName`).
 */
export function guestMenuItems(tab: PatchTab['id'], menus: readonly EmbedMenu[]): MenuItem[] {
  // levels under the app's menu: its menus are level 0, so items nest to level 3 (app-menu maxDepth 4)
  const conv = (it: EmbedMenuItem, level: number): MenuItem | null => {
    if (it.separator) return { id: `g.${it.id}`, label: '', separator: true };
    if (it.locked) return null;
    const out: MenuItem = { id: `g.${it.id}`, label: it.label };
    if (it.icon) out.icon = it.icon;
    if (typeof it.check === 'boolean') out.checked = `counter:${counterName(tab, it.id)}`;
    else if (it.count) out.badge = counterName(tab, it.id);
    const kids = level >= 3 ? [] : (it.items ?? []).map((k) => conv(k, level + 1)).filter((k): k is MenuItem => !!k);
    if (kids.length) out.items = kids;
    else if (it.items?.length) return null;
    else out.action = `patches.menu:${tab}:${it.id}`;
    return out;
  };
  return menus.map((m) => ({ id: `g.${m.id}`, label: m.label, items: m.items.map((k) => conv(k, 1)).filter((k): k is MenuItem => !!k) })).filter((m) => m.items!.some((k) => !k.separator));
}

/** The top-level menu id an app's menu gets in Patches' menu bar. */
export function guestMenuId(tab: string, menuId: string): string { return `g-${tab}-${menuId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 60); }

/** The counter that carries an app item's check mark or count in Patches' menu. */
export function counterName(tab: string, id: string): string { return `patches.menu.${tab}.${id}`; }

/** Every counter an app's menu sets (check = 1 / 0, count = the number). */
export function guestMenuCounters(tab: string, menus: readonly EmbedMenu[]): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (it: EmbedMenuItem) => {
    if (typeof it.check === 'boolean') out[counterName(tab, it.id)] = it.check ? 1 : 0;
    else if (it.count) out[counterName(tab, it.id)] = it.count;
    it.items?.forEach(walk);
  };
  menus.forEach((m) => m.items.forEach(walk));
  return out;
}

/** The message that asks the app in a tab to run one of the items it sent (menu item, banner tap `w:`, search pick `s:`). */
export function runMessage(id: string): EmbedMessage { return { $axf: EMBED_MESSAGE, type: 'run', id }; }

/** The message that asks the app in a tab to open its own settings (on one of its tabs). */
export function openSettingsMessage(tab?: string): EmbedMessage { return tab ? { $axf: EMBED_MESSAGE, type: 'open-settings', tab } : { $axf: EMBED_MESSAGE, type: 'open-settings' }; }

/* ---------------- Patches' tab group: apps and tabable plugins (patches-tabs@1) ----------------
 *
 * Brett, Oct 22 2026: "Give all plugins a field … to declare it as tabable, meaning it can be added to a tab group. Then
 * add to Patches' tab group." A tab is an app (the whole app) or a plugin tab: one tabable plugin of an app (plugin.json
 * `tabable`, reported with its plugin list as `tab`), shown as that app's view page (`axf-embed-page=view:<view>`), so only
 * that page. The list is kept on Patches' server (`/api/tabs`) so every device shows the same tabs. Since Oct 24 2026 the
 * apps run their own plugins in Patches too, so a plugin tab needs its plugin switched on in its app.
 */

export type TabEntry =
  | { kind: 'app'; app: PatchTab['id'] }
  | { kind: 'plugin'; app: PatchTab['id']; plugin: string; view: string; label: string; icon?: string };

export const DEFAULT_TABS: TabEntry[] = TABS.map((t) => ({ kind: 'app', app: t.id }));
export const MAX_TABS = 20;

/** A tab's view id in Patches: the app's id for an app tab, `tab.<app>.<view>` for a plugin tab. */
export function tabViewId(e: TabEntry): string { return e.kind === 'app' ? e.app : `tab.${e.app}.${e.view}`; }
/** The same tab, whichever device added it (an app once, a plugin page of an app once). */
export function tabKey(e: TabEntry): string { return e.kind === 'app' ? e.app : `${e.app}:${e.view}`; }
export const appOf = (id: string): PatchTab | undefined => TABS.find((t) => t.id === id);
export function tabLabel(e: TabEntry): string { return e.kind === 'app' ? appOf(e.app)?.label ?? e.app : e.label; }
export function tabIcon(e: TabEntry): string { return e.kind === 'app' ? appOf(e.app)?.icon ?? 'layers' : e.icon ?? 'box'; }

/** A tabable plugin's page in a tab: the app, marked as embedded in Patches, showing only that view (it shares nothing). */
export function pluginTabUrl(t: PatchTab, origin: string, view: string): string {
  return embedUrlFull(`${origin}${t.path}`, HOST_ID, { page: `view:${view}` });
}

/** The tab list Patches' server answered, checked (unknown entries dropped, each tab once, ≤ 20). */
export function readTabs(raw: unknown): TabEntry[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: TabEntry[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    if (!appOf(String(o.app))) continue;
    const app = o.app as PatchTab['id'];
    let e: TabEntry | null = null;
    if (o.kind === 'app') e = { kind: 'app', app };
    else if (o.kind === 'plugin' && typeof o.plugin === 'string' && typeof o.view === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(o.view)) {
      e = { kind: 'plugin', app, plugin: o.plugin, view: o.view, label: typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 80) : o.view, ...(typeof o.icon === 'string' ? { icon: o.icon } : {}) };
    }
    if (e && !seen.has(tabKey(e)) && out.length < MAX_TABS) { seen.add(tabKey(e)); out.push(e); }
  }
  return out;
}

/** Something the Add tab dialog offers: an app not in the group yet, or a tabable plugin an app reported. */
export interface TabChoice {
  entry: TabEntry;
  /** already a tab */
  added: boolean;
  /** plugin tabs: switched on in its app (its page shows only then) */
  on?: boolean;
  /** plugin tabs: the model that built it, as its app reported */
  model?: string;
}

/**
 * Everything that can be a tab: the apps, then every tabable plugin each app reported (only plugins whose plugin.json
 * says `tabable`; every other plugin never shows here). `reports` = what each app last reported.
 */
export function tabChoices(current: readonly TabEntry[], reports: Partial<Record<PatchTab['id'], EmbedPlugin[]>>): { apps: TabChoice[]; plugins: { app: PatchTab; choices: TabChoice[] }[] } {
  const have = new Set(current.map(tabKey));
  const apps = TABS.map((t) => { const entry: TabEntry = { kind: 'app', app: t.id }; return { entry, added: have.has(tabKey(entry)) }; });
  const plugins = TABS.map((t) => {
    const choices = (reports[t.id] ?? []).filter((p) => p.tab).map((p) => {
      const entry: TabEntry = { kind: 'plugin', app: t.id, plugin: p.id, view: p.tab!.view, label: p.tab!.label ?? p.name, ...(p.tab!.icon ? { icon: p.tab!.icon } : {}) };
      return { entry, added: have.has(tabKey(entry)), on: p.on, ...(p.model ? { model: p.model } : {}) };
    }).sort((a, b) => tabLabel(a.entry).localeCompare(tabLabel(b.entry)));
    return { app: t, choices };
  }).filter((g) => g.choices.length > 0);
  return { apps, plugins };
}

/** Move a tab one place up (-1) or down (+1); the list is returned unchanged at either end. */
export function moveTab(list: readonly TabEntry[], key: string, by: -1 | 1): TabEntry[] {
  const i = list.findIndex((e) => tabKey(e) === key);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

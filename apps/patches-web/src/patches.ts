/**
 * Patches (web): the Dev Console, Build Pilot and axHub in one page — one banner, three tabs kept alive, one settings.
 *
 * The web twin of apps/patches (Android). The apps load in frames marked with embed@1 (`?axf-embed=patches`): each hides
 * its own banner, and because Patches **takes their settings** (`axf-embed-take=settings`) each also drops its own
 * settings hooks (menu items, buttons, nav entries) and asks Patches instead. Patches answers with its combined
 * Settings: one tab per app (Patches, Console, Pilot, axHub), each app's tab showing that app's own settings page
 * (`axf-embed-page=settings`).
 *
 * Pure helpers here; the UI is in patchesLibrary.tsx and views/.
 */
import { embedUrlFull, parseEmbedMessage, EMBED_MESSAGE, type EmbedPlugin, type EmbedMenu, type EmbedMenuItem, type EmbedMessage, type MenuItem } from './axf/core';
import manifest from '../axf.manifest.json';

export const HOST_ID = 'patches';

/**
 * What Patches takes over from the apps in its tabs: their settings, and their banners' settings (every banner's look,
 * behaviour and own settings in Patches' Banners settings tab; Brett, Oct 22 2026), and their plugins (Brett, Oct 22
 * 2026: every page of an app runs only the plugins Patches has installed and switched on for it; the app's own plugin
 * hooks are greyed out with "Plugins are managed in Patches"). Android also takes notifications.
 */
export const TAKES = ['settings', 'banners', 'plugins'] as const;
/**
 * …and, from the app in a tab (not its settings page or the banner strip), its application menu (Brett, Oct 22 2026:
 * "all app menus are inherited by Patches' menu and the apps in tabs hide theirs").
 */
export const TAB_TAKES = [...TAKES, 'app-menu'] as const;

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
  /** its settings page inside Patches' combined settings */
  settingsPath: string;
  /** is it an AXF app (understands embed@1 page mode)? axHub reads the marker by convention */
  axf: boolean;
}

/** The hub's address (manifest developer.hub, else axHub's public address). */
export const HUB = normalizeOrigin((manifest as { developer?: { hub?: string } }).developer?.hub) ?? 'https://axhub.amberxai.com';

export const TABS: PatchTab[] = [
  { id: 'console', label: 'Console', icon: 'terminal', key: 'patches.console', fallback: 'https://console.amberxai.com', path: '/', settingsPath: '/', axf: true },
  { id: 'pilot', label: 'Pilot', icon: 'rocket', key: 'patches.pilot', fallback: 'https://pilot.amberxai.com', path: '/', settingsPath: '/', axf: true },
  { id: 'axhub', label: 'axHub', icon: 'layers', key: '', fallback: HUB, path: '/apps', settingsPath: '/auth/account', axf: false },
];

/**
 * Patches' combined Settings is a tab group (Brett, Oct 23 2026): a tab for Patches itself, Banners (every banner shown
 * above the tabs), then one for every tab in Patches' tab group that has a settings interface: each app (its own
 * settings page) and each plugin tab whose plugin has settings (its app's settings page opened on that plugin's tab).
 */
export interface SettingsTabSpec {
  /** `patches`, `banners`, an app id, or a plugin tab's view id (`tab.<app>.<view>`) */
  id: string;
  label: string;
  icon: string;
  kind: 'own' | 'banners' | 'app' | 'plugin';
  app?: PatchTab['id'];
  /** the settings tab to open inside the app's settings page (a plugin's own tab) */
  sub?: string;
}
export const OWN_SETTINGS: SettingsTabSpec[] = [{ id: 'patches', label: 'Patches', icon: 'layers', kind: 'own' }, { id: 'banners', label: 'Banners', icon: 'bell', kind: 'banners' }];
/** @deprecated the fixed list before Oct 23 2026; use settingsTabs(tabs, reports) */
export const SETTINGS_APPS = [...OWN_SETTINGS, ...TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, kind: 'app' as const, app: t.id }))];

/** The combined settings' tabs for this tab group, in its order (Patches and Banners first). */
export function settingsTabs(tabs: readonly TabEntry[], reports: Partial<Record<PatchTab['id'], EmbedPlugin[]>> = {}): SettingsTabSpec[] {
  const out = [...OWN_SETTINGS];
  const seen = new Set(out.map((x) => x.id));
  for (const e of tabs) {
    let spec: SettingsTabSpec | null = null;
    if (e.kind === 'app') { const t = appOf(e.app); if (t) spec = { id: t.id, label: t.label, icon: t.icon, kind: 'app', app: t.id }; }
    else {
      const sub = reports[e.app]?.find((p) => p.id === e.plugin)?.tab?.settings;
      if (sub) spec = { id: tabViewId(e), label: e.label, icon: e.icon ?? 'box', kind: 'plugin', app: e.app, sub };
    }
    if (spec && !seen.has(spec.id)) { seen.add(spec.id); out.push(spec); }
  }
  return out;
}

/** The settings tab for the tab in front (an app tab, or a plugin tab with settings), else Patches' own. */
export function settingsTabFor(view: string | null | undefined, list: readonly SettingsTabSpec[]): string {
  return (view && list.some((x) => x.id === view && x.kind !== 'own' && x.kind !== 'banners') ? view : 'patches');
}

export type SettingsApp = string;
export const isSettingsApp = (v: unknown): v is SettingsApp => typeof v === 'string' && (/^(patches|banners|console|pilot|axhub)$/.test(v) || /^tab\.[a-z]+\.[a-z0-9][a-z0-9._-]{0,63}$/.test(v));

export const BANNERS_KEY = 'patches.banners';
export const SETTINGS_APP_KEY = 'patches.settings.app';

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

/** The page a tab shows: its app, marked as embedded in Patches, with Patches taking its settings. */
export function tabUrl(t: PatchTab, origin: string): string {
  return embedUrlFull(`${origin}${t.path}`, HOST_ID, { takes: [...TAB_TAKES] });
}

/** An app's settings page for the combined settings (page mode; all its chrome hidden). */
export function settingsUrl(t: PatchTab, origin: string): string {
  return embedUrlFull(`${origin}${t.settingsPath}`, HOST_ID, { takes: [...TAKES], page: 'settings' });
}

/** The Banners settings page: the console's every-banner settings on its own (its banners are the ones above the tabs). */
export function bannersUrl(consoleOrigin: string): string {
  return embedUrlFull(`${consoleOrigin}/`, HOST_ID, { takes: [...TAKES], page: 'banners' });
}

/** An app asks for banner settings with `open-settings` tab `banners` or `banners:<banner id>`: the banner id, or null. */
export function bannerAsk(tab: string | undefined): string | null {
  if (!tab || (tab !== 'banners' && !tab.startsWith('banners:'))) return null;
  return tab.slice('banners:'.length);
}

/** The banner strip: the Dev Console's plugin banners on their own page, above every tab. */
export function stripUrl(consoleOrigin: string): string {
  return embedUrlFull(`${consoleOrigin}/?axf-strip=banners`, HOST_ID, { takes: [...TAKES] });
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

/**
 * An app's menu as items of Patches' own application menu: one top-level menu per app, the app's menus as its
 * submenus. Items carry no action of the app's: picking one runs `patches.menu:<tab>:<item id>`, which hands the id
 * back to the app (`run`). Check marks and counts become Patches counters (`counterName`).
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

/** The message that asks the app in a tab to run one of the items it sent. */
export function runMessage(id: string): EmbedMessage { return { $axf: EMBED_MESSAGE, type: 'run', id }; }

/** The message that asks an app's settings page to open one of its own tabs. */
export function openTabMessage(tab: string): EmbedMessage { return { $axf: EMBED_MESSAGE, type: 'open-tab', tab }; }

/* ---------------- plugins Patches manages for the apps in its tabs (embed@1 take `plugins`) ---------------- */

/** One plugin installed in Patches for an app (server/main.py → patches-plugins@1). */
export interface InstalledPlugin { name: string; version: string; enabled: boolean; installedAt: string; /** the model that built it, as its app reported (plugin@1 builtWith.model) */ model?: string }
export interface PluginsState { $axf: 'patches-plugins@1'; apps: Record<string, { plugins: Record<string, InstalledPlugin> }> }

/** Setting: try to install an app's missing plugins into Patches by itself (on by default). */
export const AUTO_INSTALL_KEY = 'patches.plugins.autoInstall';

/** The plugins an app reported that Patches doesn't have installed for it (report order). */
export function missingPlugins(reported: readonly EmbedPlugin[] | undefined, state: PluginsState | null, app: string): EmbedPlugin[] {
  if (!reported?.length || !state) return [];
  const have = state.apps[app]?.plugins ?? {};
  return reported.filter((p) => !have[p.id]);
}

/** The plugins an app may run: installed in Patches for it and switched on. */
export function enabledPluginIds(state: PluginsState | null, app: string): string[] {
  return Object.entries(state?.apps[app]?.plugins ?? {}).filter(([, p]) => p.enabled).map(([id]) => id).sort();
}

/** The message that tells an app which plugins to run. */
export function pluginsEnabledMessage(ids: readonly string[]): EmbedMessage { return { $axf: EMBED_MESSAGE, type: 'plugins-enabled', plugins: [...ids] }; }

/** The message that asks an app to report its plugins again. */
export function pluginsRequestMessage(): EmbedMessage { return { $axf: EMBED_MESSAGE, type: 'plugins-request' }; }

/** "Console: Activity, Terminal and 3 more" — the missing plugins in one line. */
export function missingSummary(label: string, missing: readonly EmbedPlugin[], shown = 3): string {
  const names = missing.slice(0, shown).map((p) => p.name);
  const more = missing.length - names.length;
  return `${label}: ${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

/* ---------------- Patches' tab group: apps and tabable plugins (patches-tabs@1) ----------------
 *
 * Brett, Oct 22 2026: "Give all plugins a field … to declare it as tabable, meaning it can be added to a tab group. Then
 * add to Patches' tab group. Every plugin that can be tabable appears in Patches settings where you select from a list
 * of apps or plugins to have a tab. The available tab things are selected from a dialog."
 *
 * A tab is an app (its whole app, as before) or a plugin tab: one tabable plugin of an app (plugin.json `tabable`,
 * reported with its plugin list as `tab`), shown as that app's view page (`axf-embed-page=view:<view>`), so only that
 * page, no chrome. The list is kept on Patches' server (`/api/tabs`) so every device shows the same tabs.
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

/** A tabable plugin's page in a tab: the app, marked as embedded in Patches, showing only that view. */
export function pluginTabUrl(t: PatchTab, origin: string, view: string): string {
  return embedUrlFull(`${origin}${t.path}`, HOST_ID, { takes: [...TAKES], page: `view:${view}` });
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
  /** plugin tabs: installed in Patches for that app and switched on (it runs only then) */
  enabled?: boolean;
  /** plugin tabs: installed in Patches for that app at all */
  installed?: boolean;
}

/**
 * Everything that can be a tab: the apps, then every tabable plugin each app reported (only plugins whose plugin.json
 * says `tabable`; every other plugin never shows here). `reports` = what each app's pages last reported.
 */
export function tabChoices(current: readonly TabEntry[], reports: Partial<Record<PatchTab['id'], EmbedPlugin[]>>, state: PluginsState | null): { apps: TabChoice[]; plugins: { app: PatchTab; choices: TabChoice[] }[] } {
  const have = new Set(current.map(tabKey));
  const apps = TABS.map((t) => { const entry: TabEntry = { kind: 'app', app: t.id }; return { entry, added: have.has(tabKey(entry)) }; });
  const plugins = TABS.map((t) => {
    const choices = (reports[t.id] ?? []).filter((p) => p.tab).map((p) => {
      const entry: TabEntry = { kind: 'plugin', app: t.id, plugin: p.id, view: p.tab!.view, label: p.tab!.label ?? p.name, ...(p.tab!.icon ? { icon: p.tab!.icon } : {}) };
      const mine = state?.apps[t.id]?.plugins[p.id];
      return { entry, added: have.has(tabKey(entry)), installed: !!mine, enabled: !!mine?.enabled };
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

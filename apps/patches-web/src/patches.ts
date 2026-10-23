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
import { availableApps, directoryApps, pickedApps, type AppEntry } from './axf/libs/apps/apps';

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

/**
 * One tab: an app from the framework's app directory (lib-apps, app-directory@1) or one added by hand. Brett, Oct 23
 * 2026: "select any app from the framework to appear in tabs like console, build, axhub". The tab id is the
 * directory's short `tab` id (console, pilot, axhub, walkthrough, demo, …): it names the view, its settings tab and
 * its plugins in Patches' store.
 */
export type PatchTab = Omit<AppEntry, 'id'> & {
  /** the tab id (= the directory's `tab`): view id, settings tab, plugins key */
  id: string;
  /** the directory id (project name) */
  appId: string;
  /** settings key holding an address that replaces the directory's ('' = none; axHub is always the app's hub) */
  key: string;
  /** default address (https host only) */
  fallback: string;
  /** an AXF app (understands embed@1 page mode, takes, menus, plugins)? axHub reads the marker by convention */
  axf: boolean;
};

/** Which apps are tabs, in order (tab ids); not set = DEFAULT_TABS. */
export const TABS_KEY = 'patches.tabs';
/** Apps added by hand (lib-apps CustomApp list). */
export const CUSTOM_KEY = 'patches.apps.custom';
export const DEFAULT_TABS = ['console', 'pilot', 'axhub'];
/** Address settings kept from the first Patches (Console / Pilot addresses in Settings → Patches). */
const ADDRESS_KEYS: Record<string, string> = { console: 'patches.console', pilot: 'patches.pilot' };

/** The hub's address (manifest developer.hub, else axHub's public address). */
export const HUB = normalizeOrigin((manifest as { developer?: { hub?: string } }).developer?.hub) ?? 'https://axhub.amberxai.com';

function asTab(a: AppEntry): PatchTab {
  const hub = a.tab === 'axhub';
  return { ...a, id: a.tab, appId: a.id, origin: hub ? HUB : a.origin, key: ADDRESS_KEYS[a.tab] ?? '', fallback: hub ? HUB : a.origin, axf: a.embed === 'axf' };
}

/** Every app Patches can show as a tab (the directory, minus Patches itself, plus apps added by hand). */
export function availableTabs(custom: unknown): PatchTab[] { return availableApps(custom).map(asTab); }

/** The tabs Patches shows, in order. With nothing picked, the Console (its banners are above every tab anyway). */
export function pickTabs(saved: unknown, custom: unknown): PatchTab[] {
  const all = availableTabs(custom);
  const got = pickedApps(all, saved, DEFAULT_TABS);
  return got.length ? got : all.filter((t) => t.tab === 'console');
}

/** The Dev Console: the banner strip and the Banners settings come from it whether or not it is a tab. */
export const CONSOLE: PatchTab = asTab(directoryApps().find((a) => a.tab === 'console') ?? { id: 'axf-console-web', tab: 'console', label: 'Console', name: 'AXF Dev Console', icon: 'terminal', origin: 'https://console.amberxai.com', path: '/', settingsPath: '/', embed: 'axf', host: false, description: '', from: 'manifest', order: 10 });

/** Tab ids Patches' own views use, which an app's tab id can never be. */
export const RESERVED_VIEWS = new Set(['settings', 'patches', 'banners']);

/** The first three tabs as before (kept for code that wants a known tab; the live list is pickTabs). */
export const TABS: PatchTab[] = DEFAULT_TABS.map((id) => availableTabs([]).find((t) => t.tab === id)).filter((t): t is PatchTab => !!t);

/** The settings tabs of Patches' combined settings, in order: Patches itself, Banners (every banner shown above the tabs), then one per app. */
export type SettingsApp = string;
export interface SettingsAppDef { id: SettingsApp; label: string; icon: string }
/** Patches, Banners, then every tab that has a settings page Patches can show. */
export function settingsApps(tabs: readonly PatchTab[]): SettingsAppDef[] {
  return [{ id: 'patches', label: 'Patches', icon: 'layers' }, { id: 'banners', label: 'Banners', icon: 'bell' }, ...tabs.filter((t) => t.settingsPath).map((t) => ({ id: t.tab, label: t.label, icon: t.icon }))];
}
export const isSettingsApp = (v: unknown, tabs: readonly PatchTab[]): v is SettingsApp => typeof v === 'string' && settingsApps(tabs).some((a) => a.id === v);

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
  if (t.tab === 'axhub') return HUB;
  return (t.key ? normalizeOrigin(saved) : null) ?? t.origin;
}

/** The page a tab shows: its app, marked as embedded in Patches, with Patches taking its settings. */
export function tabUrl(t: PatchTab, origin: string): string {
  return embedUrlFull(`${origin}${t.path}`, HOST_ID, { takes: [...TAB_TAKES] });
}

/** An app's settings page for the combined settings (page mode; all its chrome hidden). */
export function settingsUrl(t: PatchTab, origin: string): string {
  return embedUrlFull(`${origin}${t.settingsPath ?? '/'}`, HOST_ID, { takes: [...TAKES], page: 'settings' });
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
export function guestMenuItems(tab: string, menus: readonly EmbedMenu[]): MenuItem[] {
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
export interface InstalledPlugin { name: string; version: string; enabled: boolean; installedAt: string }
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

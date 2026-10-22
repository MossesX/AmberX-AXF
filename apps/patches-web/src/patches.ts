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
import { embedUrlFull, parseEmbedMessage, EMBED_MESSAGE, type EmbedMenu, type EmbedMenuItem, type EmbedMessage, type MenuItem } from './axf/core';
import manifest from '../axf.manifest.json';

export const HOST_ID = 'patches';

/** What Patches takes over from the apps in its tabs (web: settings; Android also takes notifications). */
export const TAKES = ['settings'] as const;
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

/** The settings tabs of Patches' combined settings, in order: Patches itself, then one per app. */
export const SETTINGS_APPS = [{ id: 'patches', label: 'Patches', icon: 'layers' }, ...TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))] as const;
export type SettingsApp = (typeof SETTINGS_APPS)[number]['id'];
export const isSettingsApp = (v: unknown): v is SettingsApp => SETTINGS_APPS.some((a) => a.id === v);

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

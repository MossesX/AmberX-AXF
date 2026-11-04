/*
 * main-tabs@1: the app's main area as a tab group on the dock engine (windows.ts + dock.ts). Every screen opened in
 * the main area becomes a tab of the main window's dock; tabs persist across reloads, can be pinned, reopened after
 * closing, dragged out to float and dropped back onto a strip, and split along any edge (the dock engine's drops).
 *
 * This file holds the pure rules (no DOM, no storage): the tab group settings, the saved session, and which tabs an
 * operation closes, keeps or opens. The React layer (framework/react/windows/MainTabs.tsx) wires them to the window
 * manager and the runtime. Fixture: framework/spec/fixtures/main-tabs.json. Kotlin twin deferred (spec/PORTING.md).
 */
import type { TabSpec } from './windows';
import { PLACED_VIEW_TAB } from './placement';

export const MAIN_TABS_FRAME = 'main-tabs@1';
/** The tab kind a main-area screen uses (the same kind placed views use, so a floated screen renders anywhere). */
export const MAIN_VIEW_TAB = PLACED_VIEW_TAB;

export type TabStripPosition = 'top' | 'bottom' | 'left' | 'right';
export const TAB_STRIP_POSITIONS: TabStripPosition[] = ['top', 'bottom', 'left', 'right'];
export type TabStripSize = 'compact' | 'normal' | 'large';
export const TAB_STRIP_SIZES: TabStripSize[] = ['compact', 'normal', 'large'];
export type TabCloseButtons = 'always' | 'hover' | 'active' | 'never';
export const TAB_CLOSE_BUTTONS: TabCloseButtons[] = ['always', 'hover', 'active', 'never'];
export type TabOpenMode = 'tab' | 'replace';

/** The tab group settings (Settings → Tab group, right-click the strip). Per device. */
export interface MainTabSettings {
  /** off = the main area shows one screen at a time, as before */
  enabled: boolean;
  position: TabStripPosition;
  size: TabStripSize;
  showIcons: boolean;
  closeButtons: TabCloseButtons;
  /** most tabs a group keeps (0 = no limit); past it the oldest unpinned, inactive tab closes */
  maxTabs: number;
  /** a screen opened from the menu: a new tab, or replace the active tab (pinned tabs are never replaced) */
  openAs: TabOpenMode;
  /** reopen the saved tabs when the app starts */
  restore: boolean;
  animation: boolean;
  /** phone: swipe the content sideways to move between tabs */
  swipe: boolean;
}

export const DEFAULT_MAIN_TAB_SETTINGS: MainTabSettings = {
  enabled: true, position: 'top', size: 'normal', showIcons: true, closeButtons: 'hover', maxTabs: 12, openAs: 'tab', restore: true, animation: true, swipe: true,
};
export const MAX_TABS_LIMIT = 50;
/** How many closed tabs "Reopen closed tab" remembers. */
export const CLOSED_TABS_KEPT = 20;

/** Settings keys (namespaced like every framework setting). */
export const MAIN_TAB_KEYS: Record<keyof MainTabSettings, string> = {
  enabled: 'axf.mainTabs.enabled', position: 'axf.mainTabs.position', size: 'axf.mainTabs.size', showIcons: 'axf.mainTabs.showIcons',
  closeButtons: 'axf.mainTabs.closeButtons', maxTabs: 'axf.mainTabs.maxTabs', openAs: 'axf.mainTabs.openAs', restore: 'axf.mainTabs.restore',
  animation: 'axf.mainTabs.animation', swipe: 'axf.mainTabs.swipe',
};
/** Where the open tabs are saved (per device, not a setting a person edits). */
export const MAIN_TABS_SESSION_KEY = 'axf.mainTabs.session';

const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Settings from whatever is stored (unknown or broken values fall back to the defaults). */
export function normalizeMainTabSettings(raw: Partial<Record<keyof MainTabSettings, unknown>> | null | undefined): MainTabSettings {
  const r = raw ?? {};
  const d = DEFAULT_MAIN_TAB_SETTINGS;
  const max = Number(r.maxTabs);
  return {
    enabled: bool(r.enabled, d.enabled),
    position: pick(r.position, TAB_STRIP_POSITIONS, d.position),
    size: pick(r.size, TAB_STRIP_SIZES, d.size),
    showIcons: bool(r.showIcons, d.showIcons),
    closeButtons: pick(r.closeButtons, TAB_CLOSE_BUTTONS, d.closeButtons),
    maxTabs: Number.isFinite(max) && r.maxTabs !== null && r.maxTabs !== '' ? Math.max(0, Math.min(MAX_TABS_LIMIT, Math.round(max))) : d.maxTabs,
    openAs: pick(r.openAs, ['tab', 'replace'] as const, d.openAs),
    restore: bool(r.restore, d.restore),
    animation: bool(r.animation, d.animation),
    swipe: bool(r.swipe, d.swipe),
  };
}

/** True when the strip runs down a side (left / right stack). */
export const isVerticalStrip = (p: TabStripPosition) => p === 'left' || p === 'right';

/* ---------- the saved session ---------- */

/** A closed tab "Reopen closed tab" can bring back. */
export interface ClosedTab { view: string; title: string; icon?: string | null }
/** What is saved: the main window's dock snapshot (dock@1), the pinned tab ids and the closed-tab stack. */
export interface MainTabsSession { $axf: typeof MAIN_TABS_FRAME; dock: unknown; pinned: string[]; closed: ClosedTab[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

export function emptyMainTabsSession(): MainTabsSession { return { $axf: MAIN_TABS_FRAME, dock: null, pinned: [], closed: [] }; }

/** A saved session, cleaned: anything unreadable becomes an empty session (the app then just opens its first screen). */
export function normalizeMainTabsSession(raw: unknown): MainTabsSession {
  if (!isObj(raw) || raw.$axf !== MAIN_TABS_FRAME) return emptyMainTabsSession();
  const pinned = Array.isArray(raw.pinned) ? [...new Set(raw.pinned.map((x) => str(x)).filter(Boolean))].slice(0, MAX_TABS_LIMIT) : [];
  const closed = Array.isArray(raw.closed)
    ? raw.closed.filter(isObj).map((c) => ({ view: str(c.view), title: str(c.title) || str(c.view), ...(typeof c.icon === 'string' ? { icon: c.icon } : {}) })).filter((c) => c.view).slice(0, CLOSED_TABS_KEPT)
    : [];
  return { $axf: MAIN_TABS_FRAME, dock: isObj(raw.dock) ? raw.dock : null, pinned, closed };
}

/* ---------- tab rules ---------- */

/** A new tab for a screen (`seq` keeps duplicates apart). */
export function viewTab(view: string, title: string, icon: string | null | undefined, seq = 0): TabSpec {
  return { id: `view-${view}${seq ? `-${seq}` : ''}`, title, kind: MAIN_VIEW_TAB, payload: view, icon: icon ?? null };
}
/** The screen a tab shows (null for tabs that aren't screens: terminals, comparisons…). */
export const tabView = (t: Pick<TabSpec, 'kind' | 'payload'>): string | null => (t.kind === MAIN_VIEW_TAB && t.payload ? t.payload : null);

/** Remember a closed tab (newest first, one entry per screen, capped). Tabs that aren't screens aren't remembered. */
export function pushClosed(stack: ClosedTab[], tab: TabSpec, keep = CLOSED_TABS_KEPT): ClosedTab[] {
  const view = tabView(tab); if (!view) return stack;
  return [{ view, title: tab.title, ...(tab.icon ? { icon: tab.icon } : {}) }, ...stack.filter((c) => c.view !== view)].slice(0, keep);
}

/** Pinned tabs first (in their order), then the rest: the order a strip shows and keeps. */
export function pinnedFirst(tabs: TabSpec[], pinned: readonly string[]): TabSpec[] {
  const p = new Set(pinned);
  return [...tabs.filter((t) => p.has(t.id)), ...tabs.filter((t) => !p.has(t.id))];
}

/** A tab may be closed by a bulk close or a limit (not pinned, not marked unclosable). */
const closable = (t: TabSpec, pinned: ReadonlySet<string>) => !pinned.has(t.id) && t.closable !== false;

/** "Close others": every closable tab except `keep`. */
export function closeOthersIds(tabs: TabSpec[], keep: string, pinned: readonly string[]): string[] {
  const p = new Set(pinned);
  return tabs.filter((t) => t.id !== keep && closable(t, p)).map((t) => t.id);
}

/** "Close tabs to the right": every closable tab after `of` (below it in a side stack). */
export function closeRightIds(tabs: TabSpec[], of: string, pinned: readonly string[]): string[] {
  const p = new Set(pinned);
  const i = tabs.findIndex((t) => t.id === of);
  return i < 0 ? [] : tabs.slice(i + 1).filter((t) => closable(t, p)).map((t) => t.id);
}

/**
 * Over the limit: the tabs to close so at most `max` stay (0 = no limit). Oldest first by `order` (tab ids, least
 * recently used first; ids missing from it count as oldest), never the active tab, never a pinned one; when only
 * pinned or active tabs are left the group stays over the limit.
 */
export function evictIds(tabs: TabSpec[], active: string | null, pinned: readonly string[], max: number, order: readonly string[] = []): string[] {
  if (!max || tabs.length <= max) return [];
  const p = new Set(pinned);
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? -1 : i; };
  const candidates = tabs.filter((t) => t.id !== active && closable(t, p)).sort((a, b) => rank(a.id) - rank(b.id) || tabs.indexOf(a) - tabs.indexOf(b));
  return candidates.slice(0, tabs.length - max).map((t) => t.id);
}

/** Most-recently-used order: `id` moves to the end. */
export const touchOrder = (order: readonly string[], id: string): string[] => [...order.filter((x) => x !== id), id].slice(-MAX_TABS_LIMIT * 4);

/** The tab a swipe lands on: one step left / right, no wrap. */
export function swipeIndex(index: number, dir: 'prev' | 'next', count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, index + (dir === 'next' ? 1 : -1)));
}

/** A drag along a strip: the index the tab lands at, from the pointer and each tab's [start, end] along the strip axis. */
export function stripDropIndex(spans: [number, number][], at: number): number {
  for (let i = 0; i < spans.length; i++) { const [a, b] = spans[i]!; if (at < (a + b) / 2) return i; }
  return spans.length;
}

/** What a horizontal touch move means on the content: a swipe to another tab, or nothing (a scroll, a tap). */
export function swipeOf(dx: number, dy: number, minDx = 80, maxSlope = 0.5): 'prev' | 'next' | null {
  if (Math.abs(dx) < minDx || Math.abs(dy) > Math.abs(dx) * maxSlope) return null;
  return dx < 0 ? 'next' : 'prev';
}

/** Find a screen by id, title or the start of either (what tabs_open / tab_close are given). */
export function resolveView(views: { id: string; title: string }[], q: string): string | null {
  const f = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const w = f(q); if (!w) return null;
  return views.find((v) => v.id === q)?.id
    ?? views.find((v) => f(v.id) === w || f(v.title) === w)?.id
    ?? views.find((v) => f(v.title).startsWith(w) || f(v.id).startsWith(w))?.id
    ?? views.find((v) => f(v.title).includes(w))?.id
    ?? null;
}

/* ---------- what the runtime exposes (console commands, REST, MCP, CLI) ---------- */

/** One open tab as console commands list it. */
export interface MainTabInfo { id: string; view: string | null; title: string; where: 'main' | 'floating'; window: string; group: string; active: boolean; pinned: boolean; dirty: boolean }
/** The main-area tab group's API on the runtime (`rt.mainTabs`, null while the shell shows no tab group). `q` = a tab id, a screen id or its title. */
export interface MainTabsApi {
  list(): MainTabInfo[];
  open(q: string): boolean;
  close(q: string): boolean;
  float(q: string): boolean;
  dock(q: string): boolean;
  reopen(): boolean;
}

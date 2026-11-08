/*
 * Terminal window header: what stays on the bar and what goes into the ⋯ menu (terminal-header-responsive, Nov 8 2026,
 * Brett: "The header on Terminal windows … gets squished on smaller screens: items overlap … Priority order for what
 * stays visible (title/session name and status first); setting to choose which items stay pinned.").
 *
 * Pure (no DOM, no React): the item registry of the two header bars (the command toolbar and the context chain's bar),
 * their priority order, the pinned list and the header style. The measuring and the ⋯ menu are the framework's overflow
 * control (framework/react/components/Overflow.tsx on core/engines/bannerwidgets.ts `overflowWidgets`), the same one the
 * banner uses. The server mirrors HEADER_IDS / HEADER_STYLES / DEFAULT_PINS (server/store.py) to validate the setting.
 */

export type HeaderBar = 'toolbar' | 'chain';
/** priority = the bar's ⋯ rule: higher stays longer (1…9, the banner's scale). */
export interface HeaderItemDef { id: string; bar: HeaderBar; label: string; priority: number }

export const HEADER_ITEMS: readonly HeaderItemDef[] = [
  // the command toolbar: session name and status first
  { id: 'toolbar.session', bar: 'toolbar', label: 'Session name (the tab’s connection)', priority: 9 },
  { id: 'toolbar.status', bar: 'toolbar', label: 'Status (working / waiting / done / failed)', priority: 9 },
  { id: 'toolbar.settings', bar: 'toolbar', label: 'Terminal settings', priority: 7 },
  { id: 'toolbar.find', bar: 'toolbar', label: 'Find', priority: 6 },
  { id: 'toolbar.size', bar: 'toolbar', label: 'Text size (A− / A+)', priority: 5 },
  { id: 'toolbar.claude', bar: 'toolbar', label: 'New Claude Code tab', priority: 4 },
  { id: 'toolbar.copy', bar: 'toolbar', label: 'Copy', priority: 4 },
  { id: 'toolbar.paste', bar: 'toolbar', label: 'Paste', priority: 4 },
  { id: 'toolbar.mouse', bar: 'toolbar', label: 'Mouse mode', priority: 3 },
  { id: 'toolbar.mosh', bar: 'toolbar', label: 'Mosh mode', priority: 3 },
  { id: 'toolbar.hide', bar: 'toolbar', label: 'Hide the toolbar', priority: 2 },
  // the context chain's bar: its title first
  { id: 'chain.title', bar: 'chain', label: 'Context chain title', priority: 9 },
  { id: 'chain.count', bar: 'chain', label: 'Files and rules count', priority: 8 },
  { id: 'chain.play', bar: 'chain', label: 'Play / pause', priority: 6 },
  { id: 'chain.skip', bar: 'chain', label: 'Skip to the end', priority: 5 },
  { id: 'chain.fold', bar: 'chain', label: 'Fold / open every file', priority: 4 },
  { id: 'chain.speed', bar: 'chain', label: 'Reveal speed', priority: 3 },
];
export const HEADER_IDS: readonly string[] = HEADER_ITEMS.map((i) => i.id);
/** Pinned by default: the title / session name and the status never leave the bar. */
export const DEFAULT_PINS: readonly string[] = ['toolbar.session', 'toolbar.status', 'chain.title'];

/**
 * How the header gives way (each one is a `toolbar` asset in the plugin's assets, picked in UI Review):
 *   priority = items keep their labels; the lowest priority leaves for ⋯ first (default)
 *   compact  = labels drop to icons first, then the lowest priority leaves for ⋯
 *   menu     = only the pinned items stay on the bar, everything else is always in ⋯
 */
export type HeaderStyle = 'priority' | 'compact' | 'menu';
export const HEADER_STYLES: readonly HeaderStyle[] = ['priority', 'compact', 'menu'];
export const HEADER_STYLE_LABEL: Record<HeaderStyle, string> = {
  priority: 'Priority: least important items go into ⋯ first',
  compact: 'Compact: labels turn into icons first, then ⋯',
  menu: 'Menu: only pinned items on the bar, the rest always in ⋯',
};

export const headerStyle = (v: unknown): HeaderStyle => (HEADER_STYLES.includes(v as HeaderStyle) ? (v as HeaderStyle) : 'priority');

/** A clean pinned list: known ids, no repeats, registry order; missing/invalid = the defaults. */
export function normPins(v: unknown): string[] {
  if (!Array.isArray(v)) return [...DEFAULT_PINS];
  const set = new Set(v.filter((x): x is string => typeof x === 'string'));
  return HEADER_IDS.filter((id) => set.has(id));
}

/** Pin or unpin one item (by id, or a name someone said: "status", "the find button"). Unknown = unchanged. */
export function setPin(pins: readonly string[], item: string, on: boolean): string[] {
  const def = findHeaderItem(item);
  if (!def) return normPins(pins);
  const set = new Set(normPins(pins));
  if (on) set.add(def.id); else set.delete(def.id);
  return HEADER_IDS.filter((id) => set.has(id));
}

/** The item someone meant: an id ("toolbar.find"), a short id ("find") or words from its label ("mouse mode"). */
export function findHeaderItem(q: string): HeaderItemDef | null {
  const norm = (s: string) => s.toLowerCase().replace(/^the\s+/, '').replace(/\s+(button|item)$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const n = norm(q);
  if (!n) return null;
  return HEADER_ITEMS.find((i) => i.id === q || norm(i.id.split('.')[1]!) === n || norm(i.label) === n)
    ?? HEADER_ITEMS.find((i) => norm(i.label).includes(n)) ?? null;
}

/** What the overflow control needs for one bar: its items in bar order with priority, pinned ones may not leave. */
export function overflowEntries(bar: HeaderBar, present: readonly string[], pins: readonly string[]): { key: string; priority: number; overflow: boolean }[] {
  const pinned = new Set(normPins(pins));
  return present.map((key) => {
    const def = HEADER_ITEMS.find((i) => i.id === key && i.bar === bar);
    return { key, priority: def?.priority ?? 1, overflow: !pinned.has(key) };
  });
}

/** In menu style everything not pinned is in ⋯ from the start, whatever the room. */
export function forcedOut(style: HeaderStyle, present: readonly string[], pins: readonly string[]): string[] {
  if (style !== 'menu') return [];
  const pinned = new Set(normPins(pins));
  return present.filter((k) => !pinned.has(k));
}

/** The header's answer for API / MCP / CLI / voice: every item with its bar, priority and whether it is pinned. */
export function headerState(pins: unknown, style: unknown) {
  const p = normPins(pins);
  return { style: headerStyle(style), styles: [...HEADER_STYLES], pinned: p, items: HEADER_ITEMS.map((i) => ({ ...i, pinned: p.includes(i.id) })) };
}

/**
 * What the Notes page shows, as a small store outside React, so actions (`notes.open:<list>`, `notes.search:<text>`,
 * `notes.add`) from menus, voice or other plugins can steer the page before or while it's on screen.
 */
import { useSyncExternalStore } from 'react';

export type NotesTab = 'inbox' | 'lists' | 'notes' | 'pinned' | 'search';
export const TABS: { id: NotesTab; label: string; icon: string }[] = [
  { id: 'inbox', label: 'Inbox', icon: 'bell' },
  { id: 'lists', label: 'Lists', icon: 'folder' },
  { id: 'notes', label: 'Notes', icon: 'file' },
  { id: 'pinned', label: 'Pinned', icon: 'star' },
  { id: 'search', label: 'Search', icon: 'search' },
];

export interface NotesUi {
  tab: NotesTab;
  /** the list open in the Lists tab (null = the tree) */
  list: string | null;
  q: string;
  /** bumped by `notes.add`: the quick add box opens and takes the focus */
  quickAdd: number;
}

let ui: NotesUi = { tab: 'inbox', list: null, q: '', quickAdd: 0 };
const subs = new Set<() => void>();
export function setUi(patch: Partial<NotesUi>) { ui = { ...ui, ...patch }; subs.forEach((f) => f()); }
export const getUi = () => ui;
export const useUi = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => ui);

/**
 * A focus asked for from outside the page: the `?notes=<focus>` query on load (the Dev Console's Notes screen frames this
 * page with it) or the action `notes.focus:<focus>`. `<focus>` is `item:<id>` (open that note), `list:<id>` (Lists tab
 * on that list), `search:<text>`, `add` (quick add), a tab name (`inbox`, `lists`, `notes`, `pinned`, `search`) or a
 * bare item id. Pure: returns the page state to set and the item to open (null when the focus is empty or unknown).
 */
export function parseFocus(raw: string | null | undefined): { ui: Partial<NotesUi>; item?: string; add?: boolean } | null {
  const f = (raw ?? '').trim().slice(0, 300);
  if (!f) return null;
  const at = f.indexOf(':');
  const kind = at > 0 ? f.slice(0, at).toLowerCase() : '';
  const rest = at > 0 ? f.slice(at + 1).trim() : '';
  if (kind === 'item' && rest) return { ui: {}, item: rest };
  if (kind === 'list' && rest) return { ui: { tab: 'lists', list: rest } };
  if (kind === 'search') return { ui: { tab: 'search', q: rest } };
  if (f === 'add') return { ui: { tab: 'inbox' }, add: true };
  if (TABS.some((t) => t.id === f)) return { ui: { tab: f as NotesTab, ...(f === 'lists' ? { list: null } : {}) } };
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(f)) return { ui: {}, item: f };
  return null;
}

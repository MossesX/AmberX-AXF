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

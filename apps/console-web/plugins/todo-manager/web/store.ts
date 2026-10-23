/**
 * Todo manager — talks to the plugin's server part and keeps one shared copy of the lists, the open list's contents and
 * the type schema, so every view (the page, a Patches tab, the editor dialog) shows the same thing.
 */
import { useSyncExternalStore } from 'react';
import { pluginApi } from '@console/plugins';
import type { Entry, EntryKind, TodoList, TypeSchema } from './core';

export const FOLDER = 'todo-manager';
export const api = pluginApi(FOLDER, 'The Todo manager plugin');

export interface TodoState {
  types: TypeSchema | null;
  lists: TodoList[];
  /** the list shown, its groups and every entry inside it */
  open: { list: TodoList; lists: TodoList[]; entries: Entry[] } | null;
  openId: number | null;
  loading: boolean;
  error: string;
}

let state: TodoState = { types: null, lists: [], open: null, openId: null, loading: false, error: '' };
const subs = new Set<() => void>();
function set(next: Partial<TodoState>) { state = { ...state, ...next }; subs.forEach((f) => f()); }
export function useTodo(): TodoState { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state); }
export function todoState(): TodoState { return state; }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Run a call; a failure lands in `error` (and the promise answers null). */
async function run<T>(p: Promise<T>): Promise<T | null> {
  try { const r = await p; if (state.error) set({ error: '' }); return r; } catch (e) { set({ error: msg(e) }); return null; }
}

export async function loadAll(openId?: number | null): Promise<void> {
  set({ loading: true });
  const [t, l] = await Promise.all([run(api.call<{ types: TypeSchema }>('types')), run(api.call<{ lists: TodoList[] }>('lists'))]);
  set({ loading: false, ...(t ? { types: t.types } : {}), ...(l ? { lists: l.lists } : {}) });
  const want = openId !== undefined ? openId : state.openId;
  const lists = l?.lists ?? state.lists;
  const top = lists.filter((x) => x.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder)[0];
  await openList(want && lists.some((x) => x.id === want) ? want : top?.id ?? null);
}

export async function openList(id: number | null): Promise<void> {
  set({ openId: id });
  if (id == null) { set({ open: null }); return; }
  const r = await run(api.call<TodoState['open']>(`lists/${id}/entries`));
  if (r && state.openId === id) set({ open: r });
}

/** Reload the lists (counts) and the open list after a change. */
async function refresh(): Promise<void> {
  const l = await run(api.call<{ lists: TodoList[] }>('lists'));
  if (l) set({ lists: l.lists });
  await openList(state.openId && (l?.lists ?? state.lists).some((x) => x.id === state.openId) ? state.openId : null);
}

export async function createList(title: string, parentId: number | null = null): Promise<TodoList | null> {
  const r = await run(api.post<{ list: TodoList }>('lists', { title, parentId }));
  await refresh();
  if (r && parentId == null) await openList(r.list.id);
  return r?.list ?? null;
}
export async function updateList(id: number, patch: Partial<Pick<TodoList, 'title' | 'parentId' | 'tone' | 'icon'>>): Promise<boolean> {
  const r = await run(api.put(`lists/${id}`, patch)); await refresh(); return !!r;
}
export async function deleteList(id: number): Promise<boolean> {
  const r = await run(api.del(`lists/${id}`)); if (state.openId === id) set({ openId: null }); await loadAll(); return !!r;
}
export async function exportList(id: number): Promise<void> { await run(api.download(`lists/${id}/export.md`, 'list.md')); }

export interface SaveResult { entry: Entry | null; error: string; warnings: string[] }
export type EntryDraft = Partial<Omit<Entry, 'id' | 'createdAt' | 'updatedAt' | 'completedAt' | 'sortOrder'>> & { draft?: boolean };

/** Create (no id) or update an entry. Errors come back for the editor to show instead of the page-wide error line. */
export async function saveEntry(id: number | null, body: EntryDraft): Promise<SaveResult> {
  try {
    const r = id == null ? await api.post<{ entry: Entry; warnings: string[] }>('entries', body) : await api.put<{ entry: Entry; warnings: string[] }>(`entries/${id}`, body);
    await refresh();
    return { entry: r.entry, error: '', warnings: r.warnings ?? [] };
  } catch (e) { return { entry: null, error: msg(e), warnings: [] }; }
}
export async function deleteEntry(id: number): Promise<boolean> { const r = await run(api.del(`entries/${id}`)); await refresh(); return !!r; }

export type BulkAction = { action: 'delete' } | { action: 'duplicate' } | { action: 'move'; listId: number; parentId?: number | null } | { action: 'patch'; patch: { status?: string; priority?: string; kind?: EntryKind; addTags?: string[]; removeTags?: string[] } };
export async function bulk(ids: number[], a: BulkAction): Promise<{ ok: boolean; count: number; errors?: string[] } | null> {
  const r = await run(api.post<{ ok: boolean; count: number; errors?: string[] }>('entries/bulk', { ids, ...a }));
  await refresh();
  return r;
}

/** Tick an entry done / open (to-dos and tasks), or one checklist item. */
export async function toggleDone(e: Entry): Promise<void> { await saveEntry(e.id, { status: e.status === 'done' ? (state.types?.[e.kind].defaultStatus ?? 'open') : 'done' }); }
export async function toggleCheck(e: Entry, itemId: string): Promise<void> {
  await saveEntry(e.id, { checklist: e.checklist.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c)) });
}

export async function saveTypes(types: TypeSchema): Promise<TypeSchema | null> {
  const r = await run(api.put<{ types: TypeSchema }>('types', { types }));
  if (r) set({ types: r.types });
  return r?.types ?? null;
}

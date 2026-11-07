/**
 * Notes data: two sources behind one row model, so the Classic and Grid views draw both the same way.
 *   claude  Brett's saved notes in the hub's shared Claude files (Markdown files in folders; the plugin's own store)
 *   amberx  the AmberX app's notes (amberx.items, through the plugin's /amberx routes → the control@1 capability)
 * Plus the view settings (framework settings, per device) and the grid's column state.
 */
import { useEffect, useReducer } from 'react';
import { useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';

export const FOLDER = 'notes-browser';
export const api = pluginApi(FOLDER, 'The Notes plugin');
const enc = encodeURIComponent;

export type SourceId = 'claude' | 'amberx';
export type ViewId = 'classic' | 'grid';
export const VIEWS: { id: ViewId; label: string; icon: string }[] = [
  { id: 'classic', label: 'Classic', icon: 'file' },
  { id: 'grid', label: 'Grid', icon: 'list' },
];
export const SOURCES: { id: SourceId; label: string; icon: string }[] = [
  { id: 'amberx', label: 'AmberX', icon: 'edit' },
  { id: 'claude', label: 'Claude files', icon: 'folder' },
];

/** Settings keys (Settings → Plugins → Notes; the view and source are per device). */
export const KEYS = {
  view: 'notes-browser.view',
  source: 'notes-browser.source',
  caps: 'notes-browser.capsHeadings',
  collapsed: 'notes-browser.startCollapsed',
} as const;
/** Toolbar / menu check marks (counter:<name> bindings): 1 on the active view or source, 0 on the others. */
export const viewCounter = (v: string) => `notes-browser.view:${v}`;
export const sourceCounter = (s: string) => `notes-browser.source:${s}`;

/** One note, whichever source it came from. */
export interface Row {
  key: string;
  source: SourceId;
  title: string;
  kind: string;
  /** folder (Claude files) or list path (AmberX) */
  list: string;
  /** what Move takes: a folder name or a list id */
  listId: string;
  tags: string[];
  priority: number;
  due: string;
  status: string;
  pinned: boolean;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  text: string;
  /** Claude files: the note's path and version (conflict-safe saves); AmberX: its id */
  ref: string;
  version: string;
  snippet?: string;
}
export interface Place { value: string; label: string }
export interface Loaded { available: boolean; why: string; rows: Row[]; places: Place[]; folders: string[] }

interface ClaudeNote { path: string; folder: string; name: string; title: string; size: number; version: string; updatedAt: string; updatedBy: string; snippet?: string; content?: string }
interface ClaudeListing { root: string; available: boolean; folders: string[]; notes: ClaudeNote[] }
interface AmberxItem { id: string; kind: string; list: string; listPath?: string; listName?: string; title: string; text: string; tags?: string[]; pinned?: boolean; starred?: boolean; status?: string; priority?: number; due?: string; createdAt?: string; updatedAt?: string; by?: string }
interface AmberxListing { available: boolean; why?: string; items: AmberxItem[]; lists: { id: string; name: string; path: string }[] }

const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->\n?/g, '');

export async function loadRows(source: SourceId, q: string): Promise<Loaded> {
  if (source === 'claude') {
    const l = await api.call<ClaudeListing>(`notes?q=${enc(q)}&content=1`);
    return {
      available: l.available, why: l.available ? '' : `The hub's shared Claude files aren't mounted on this console (${l.root}).`, folders: l.folders,
      places: [{ value: '', label: 'Top level' }, ...l.folders.map((f) => ({ value: f, label: f }))],
      rows: l.notes.map((n) => ({
        key: `claude:${n.path}`, source: 'claude', title: n.title, kind: 'note', list: n.folder || 'Top level', listId: n.folder, tags: [], priority: 0, due: '', status: '',
        pinned: false, starred: false, createdAt: '', updatedAt: n.updatedAt, updatedBy: n.updatedBy, text: stripComments(n.content ?? ''), ref: n.path, version: n.version, snippet: n.snippet,
      })),
    };
  }
  const l = await api.call<AmberxListing>(`amberx?q=${enc(q)}`);
  return {
    available: l.available, why: l.available ? '' : `AmberX notes can't be read here: ${l.why ?? 'unavailable'}.`, folders: [],
    places: l.lists.map((x) => ({ value: x.id, label: x.path || x.name })),
    rows: l.items.map((i) => ({
      key: `amberx:${i.id}`, source: 'amberx', title: i.title || ((i.text ?? '').split('\n')[0] ?? '').slice(0, 80) || 'Untitled', kind: i.kind, list: i.listPath || i.listName || i.list, listId: i.list,
      tags: i.tags ?? [], priority: i.priority ?? 0, due: i.due ?? '', status: i.status ?? '', pinned: !!i.pinned, starred: !!i.starred,
      createdAt: i.createdAt ?? '', updatedAt: i.updatedAt ?? '', updatedBy: i.by ?? '', text: i.text ?? '', ref: i.id, version: '',
    })),
  };
}

/** Save a note's text (Claude files: only when nobody changed it since it was loaded). */
export async function saveText(r: Row, text: string): Promise<void> {
  if (r.source === 'claude') await api.put('note', { path: r.ref, content: text, if_version: r.version });
  else await api.put(`amberx/item?id=${enc(r.ref)}`, { text });
}
export async function moveRow(r: Row, to: string): Promise<string> {
  if (r.source === 'claude') {
    const name = r.ref.split('/').pop() ?? r.ref;
    const d = await api.post<{ path: string }>('move', { from: r.ref, to: to ? `${to}/${name}` : name, if_version: r.version });
    return `claude:${d.path}`;
  }
  await api.post(`amberx/act?id=${enc(r.ref)}&action=move`, { input: { list: to } });
  return r.key;
}
export async function pinRow(r: Row, on: boolean): Promise<void> {
  await api.post(`amberx/act?id=${enc(r.ref)}&action=pin`, { input: { on } });
}
/** Delete after the person confirmed (AmberX: control@1 hands a token first, then deletes with it). */
export async function removeRow(r: Row): Promise<void> {
  if (r.source === 'claude') { await api.del(`note?path=${enc(r.ref)}&if_version=${enc(r.version)}`); return; }
  const first = await api.del<{ removed: number; confirm?: string }>(`amberx/item?id=${enc(r.ref)}`);
  if (first.confirm) await api.del(`amberx/item?id=${enc(r.ref)}&confirm=${enc(first.confirm)}`);
}

/** A framework setting, re-read whenever it changes (any writer: this page, Settings, a menu, a voice command). */
export function useSetting<T>(key: string, fallback: T): T {
  const rt = useRuntime();
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => rt.settings.onChange(key, () => tick()), [rt, key]);
  const v = rt.settings.get(key);
  return (v === undefined || v === null || v === '' ? fallback : v) as T;
}

/* ── per-device UI memory (not settings: column picks and the grid's expanded rows) ──────────────────────────── */

const LOCAL = 'axf.notes-browser.';
export function readLocal<T>(k: string, fallback: T): T { try { const v = localStorage.getItem(LOCAL + k); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } }
export function writeLocal(k: string, v: unknown) { try { localStorage.setItem(LOCAL + k, JSON.stringify(v)); } catch { /* storage off */ } }

export const day = (iso: string) => { const d = new Date(iso); return !iso || Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
export const when = (iso: string) => { const d = new Date(iso); return !iso || Number.isNaN(d.getTime()) ? '' : d.toLocaleString(); };
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

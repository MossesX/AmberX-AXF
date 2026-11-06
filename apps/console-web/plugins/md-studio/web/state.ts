/**
 * MD Studio state: one store for the file listing, the open docs (text, draft, version), the edit switches and the view,
 * shared by the studio page and every doc tab (docked, split or floating: the tabs live in the runtime's window manager,
 * dock@1, so they render wherever they are dropped). Opening and splitting go through the dock engine (`wm.openGroup`,
 * `wm.addTab`, `wm.splitGroup`); conflict-safe saves send the version the doc was opened at (`if_version`).
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { APP_MENU_PHONE_QUERY } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { nameOfId, tabIdOf, viewOf, type PaneMode, type ViewId } from './model';

export const FOLDER = 'md-studio';
export const VIEW_ID = 'md-studio';
export const api = pluginApi(FOLDER, 'MD Studio');
export const K = {
  view: 'md-studio.view',
  split: 'md-studio.splitDirection',
  autosave: 'md-studio.autosave',
  autosaveSeconds: 'md-studio.autosaveSeconds',
  depth: 'md-studio.chainDepth',
} as const;

export interface FileEntry { id: string; path: string; name: string; title?: string; size: number; updatedAt: string; snippet?: string }
export interface Group { id: string; label: string; category: string; files: FileEntry[] }
export interface Scope { id: 'project' | 'claude' | 'repo' | 'notes'; label: string; available: boolean; hub?: boolean; groups: Group[] }
export interface Listing { repo: string; scopes: Scope[] }
export interface Ref { ref: string; kind: 'import' | 'link' | 'code'; line: number; id: string | null }
export interface FileDoc { id: string; root: string; path: string; name: string; title: string; content: string; version: string; size: number; tokens: number; refs: Ref[]; updatedAt: string; updatedBy: string }
export interface Version { version: string; size: number; savedAt: string; savedBy?: string; reason: string }
export interface DocState { doc: FileDoc | null; draft: string; loading: boolean; saving: boolean; error: string; conflict: boolean; savedAt: string }

interface State {
  listing: Listing | null;
  listError: string;
  docs: Record<string, DocState>;
  editable: Record<string, boolean>;
  view: ViewId;
  /** the group md tabs open into (the last one an md tab was activated in) */
  group: string | null;
}

let state: State = { listing: null, listError: '', docs: {}, editable: {}, view: 'browse', group: null };
const listeners = new Set<() => void>();
const set = (f: (s: State) => State) => { state = f(state); listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useStudio = <T,>(pick: (s: State) => T): T => useSyncExternalStore(subscribe, () => pick(state), () => pick(state));
export const studio = () => state;

let rt: AxfRuntime | null = null;
export const runtime = () => rt;
export function bindRuntime(r: AxfRuntime) {
  rt = r;
  const v = r.settings.get(K.view);
  set((s) => ({ ...s, view: viewOf(typeof v === 'string' ? v : 'browse').id }));
}
const setting = <T,>(key: string, fallback: T): T => { const v = rt?.settings.get(key); return (v ?? fallback) as T; };
/** Where a referenced file opens: the split-direction setting, always stacked on a phone (two columns don't fit). */
export const splitSide = (): 'right' | 'bottom' => (setting<string>(K.split, 'side') === 'stacked' || window.matchMedia?.(APP_MENU_PHONE_QUERY).matches ? 'bottom' : 'right');

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const enc = encodeURIComponent;
const patchDoc = (id: string, p: Partial<DocState>) => set((s) => ({ ...s, docs: { ...s.docs, [id]: { ...(s.docs[id] ?? { doc: null, draft: '', loading: false, saving: false, error: '', conflict: false, savedAt: '' }), ...p } } }));

/* ------------------------------------------------------------------ listing */

let listSeq = 0;
export async function loadListing(q = '', content = false) {
  const seq = ++listSeq;
  try {
    const l = await api.call<Listing>(`files?q=${enc(q)}${content ? '&content=true' : ''}`);
    if (seq === listSeq) set((s) => ({ ...s, listing: l, listError: '' }));
  } catch (e) { if (seq === listSeq) set((s) => ({ ...s, listError: errText(e) })); }
}

export function setView(v: ViewId) {
  set((s) => ({ ...s, view: v }));
  rt?.settings.set(K.view, v);
}

export const setEditable = (id: string, on: boolean) => set((s) => ({ ...s, editable: { ...s.editable, [id]: on } }));
export const setGroup = (gid: string) => { if (state.group !== gid) set((s) => ({ ...s, group: gid })); };

/* ------------------------------------------------------------------ docs */

export async function loadDoc(id: string, force = false) {
  const cur = state.docs[id];
  if (cur?.doc && !force) return;
  patchDoc(id, { loading: true, error: '' });
  try {
    const d = await api.call<FileDoc>(`file?id=${enc(id)}`);
    patchDoc(id, { doc: d, draft: d.content, loading: false, conflict: false, error: '' });
    retitle(id);
  } catch (e) { patchDoc(id, { loading: false, error: errText(e) }); }
}

export const isDirty = (d: DocState | undefined) => !!d?.doc && d.draft !== d.doc.content;

const timers = new Map<string, number>();
export function setDraft(id: string, draft: string) {
  const was = isDirty(state.docs[id]);
  patchDoc(id, { draft });
  if (was !== isDirty(state.docs[id])) retitle(id);
  if (!setting(K.autosave, true) || !state.editable[id]) return;
  window.clearTimeout(timers.get(id));
  timers.set(id, window.setTimeout(() => { timers.delete(id); if (isDirty(state.docs[id]) && !state.docs[id]?.conflict) void saveDoc(id); }, Math.max(1, Number(setting(K.autosaveSeconds, 3))) * 1000));
}

export async function saveDoc(id: string): Promise<boolean> {
  const d = state.docs[id];
  if (!d?.doc || d.saving) return false;
  const draft = d.draft;
  patchDoc(id, { saving: true, error: '' });
  try {
    const n = await api.put<FileDoc>('file', { id, content: draft, if_version: d.doc.version });
    // keep typing that happened while saving
    const now = state.docs[id]?.draft ?? draft;
    patchDoc(id, { doc: n, draft: now, saving: false, conflict: false, savedAt: new Date().toISOString() });
    retitle(id);
    return true;
  } catch (e) {
    const m = errText(e);
    patchDoc(id, { saving: false, error: m, conflict: /changed since you opened it|no longer exists/.test(m) });
    return false;
  }
}

/** Create a new file (create-only) and open it, editable. */
export async function createDoc(id: string, content: string, where: 'tab' | 'split' = 'tab') {
  const d = await api.put<FileDoc>('file', { id, content, if_version: '' });
  patchDoc(d.id, { doc: d, draft: d.content, error: '', conflict: false });
  setEditable(d.id, true);
  openDoc(d.id, where);
  void loadListing();
  return d;
}

export async function history(id: string) { return (await api.call<{ versions: Version[] }>(`history?id=${enc(id)}`)).versions; }
export async function versionText(id: string, v: string) { return (await api.call<Version & { content: string }>(`version?id=${enc(id)}&version=${enc(v)}`)).content; }
export async function restore(id: string, v: string) {
  const d = state.docs[id];
  const n = await api.post<FileDoc>('restore', { id, version: v, if_version: d?.doc?.version });
  patchDoc(id, { doc: n, draft: n.content, conflict: false, error: '', savedAt: new Date().toISOString() });
  retitle(id);
}

/* ------------------------------------------------------------------ tabs on the dock */

function retitle(id: string) {
  const wm = rt?.windows; const d = state.docs[id]; if (!wm || !d?.doc) return;
  const tid = tabIdOf(id);
  if (wm.groupOf(tid)) wm.renameTab(tid, `${isDirty(d) ? '● ' : ''}${d.doc.name}`);
}

/** The group md tabs open into: the remembered one, else any group that holds an md tab, else the first in main. */
function targetGroup(): string | null {
  const wm = rt?.windows; if (!wm) return null;
  const s = wm.state;
  if (state.group && s.groups[state.group]) return state.group;
  const withMd = Object.values(s.groups).find((g) => g.tabs.some((t) => t.kind.startsWith('md-')));
  if (withMd) return withMd.id;
  return Object.values(s.groups).find((g) => g.windowId === wm.mainWindowId)?.id ?? null;
}

/**
 * Open a file as a dock tab. `tab` = in the current md group (or activate it when it's open); `split` / `right` /
 * `bottom` = in a new pane beside the current group (the split-direction setting for `split`).
 */
export function openDoc(id: string, where: 'tab' | 'split' | 'right' | 'bottom' = 'tab', kind: 'md-doc' | 'md-chain' = 'md-doc') {
  const wm = rt?.windows; if (!wm) return;
  if (kind === 'md-doc') void loadDoc(id);
  const tid = tabIdOf(id, kind);
  const tab = { id: tid, title: kind === 'md-chain' ? `Context: ${nameOfId(id)}` : nameOfId(id), kind, payload: id, icon: kind === 'md-chain' ? 'layers' : 'file' };
  const open = wm.groupOf(tid);
  if (open && where === 'tab') { const g = wm.state.groups[open]!; wm.activate(open, g.tabs.findIndex((t) => t.id === tid)); setGroup(open); return; }
  if (open) wm.closeTab(tid);
  const gid = targetGroup();
  if (!gid) { setGroup(wm.openGroup([tab])); return; }
  if (where === 'tab') { wm.addTab(gid, tab); setGroup(gid); return; }
  const side = where === 'split' ? splitSide() : where;
  const ng = wm.splitGroup(gid, side, [tab]);
  if (ng) setGroup(ng);
}

/** The chain control panel (shared with Claude settings) as a dock tab. */
export function openChainControl() {
  const wm = rt?.windows; if (!wm) return;
  const tid = 'md-chain-control';
  const open = wm.groupOf(tid);
  if (open) { const g = wm.state.groups[open]!; wm.activate(open, g.tabs.findIndex((t) => t.id === tid)); setGroup(open); return; }
  const tab = { id: tid, title: 'Headless sessions', kind: 'md-chain-control', icon: 'layers' };
  const gid = targetGroup();
  if (gid) { wm.addTab(gid, tab); setGroup(gid); } else setGroup(wm.openGroup([tab]));
}

/** Dock the outline + references beside the docs (IDE view) or take them away. */
export function setSidePanes(on: boolean) {
  const wm = rt?.windows; if (!wm) return;
  const ids = ['md-side:outline', 'md-side:refs'];
  const has = ids.some((t) => wm.groupOf(t));
  if (on && !has) {
    const tabs = [{ id: ids[0]!, title: 'Outline', kind: 'md-outline', icon: 'list', closable: true }, { id: ids[1]!, title: 'References', kind: 'md-refs', icon: 'layers', closable: true }];
    const gid = targetGroup();
    if (gid) wm.splitGroup(gid, 'right', tabs); else wm.openGroup(tabs);
  }
  if (!on) ids.forEach((t) => { if (wm.groupOf(t)) wm.closeTab(t); });
}

/** The md doc that is active in the current group (for the outline and references panes). */
export function activeDocId(): string | null {
  const wm = rt?.windows; if (!wm) return null;
  const g = state.group ? wm.state.groups[state.group] : null;
  const t = g?.tabs[g.active];
  if (t?.kind === 'md-doc' && t.payload) return t.payload;
  for (const gr of Object.values(wm.state.groups)) { const a = gr.tabs[gr.active]; if (a?.kind === 'md-doc' && a.payload) return a.payload; }
  return null;
}

/** Ask the doc pane showing `id` to jump to a line (outline clicks, find). */
export const JUMP_EVENT = 'md-studio:jump';
export const jump = (id: string, line: number) => window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: { id, line } }));

/** The pane mode a newly shown doc starts in (the view's), downgraded to preview while the file isn't editable. */
export const startMode = (id: string): PaneMode => { const m = viewOf(state.view).mode; return state.editable[id] ? m : 'preview'; };

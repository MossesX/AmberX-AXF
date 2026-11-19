/**
 * Plan Studio 2.0: the server calls (pluginApi: console token + standard messages) and the page's one store. Every
 * write goes to the server route of the same name (so REST, MCP, the CLI and the page share tree.mjs api), then the
 * tree is reloaded; collapse toggles apply locally first so folding feels instant.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { pluginApi } from '@console/plugins';
import * as tc from './tree-core.mjs';
import type { Item, Link, State } from './tree-core.mjs';

export const FOLDER = 'plan-studio-2';
export const VIEW = 'plan-studio-2';
export const ID = 'ai.amberx.axf.console.plan-studio-2';
export const CTX_TARGET = 'axp-plan-studio-2-item';
/** console-control@1: the tree is a grid of the view, every item a row (`view:plan-studio-2/grid:plan-studio-2.tree/row:<id>`). */
export const TREE_GRID = `view:${VIEW}/grid:plan-studio-2.tree`;
export const rowAddress = (id: string) => `${TREE_GRID}/row:${id}`;
export const DND_ZONE = 'axp-plan-studio-2';
export const TOP = '__top__';
export const DIALOGS = { item: 'plan-studio-2.item', move: 'plan-studio-2.move', link: 'plan-studio-2.link', build: 'plan-studio-2.build' } as const;
export const KEYS = {
  showDone: 'plan-studio-2.showDone', voiceLang: 'plan-studio-2.voiceLang', voiceOut: 'plan-studio-2.voiceOut', defaultModel: 'plan-studio-2.defaultModel', meta: 'plan-studio-2.meta',
  pageLayout: 'plan-studio-2.pageLayout', dock: 'plan-studio-2.dock', tab: 'plan-studio-2.tab',
} as const;
export const api = pluginApi(FOLDER, 'Plan Studio 2.0', { unavailable: 'Plan Studio 2.0 is switched off or its server part is not running.' });

export interface ItemView extends Item { path: string; depth: number; progress: { done: number; total: number; minutes: number }; children: number }
export interface OpResult { ok: boolean; rev?: number; item?: ItemView | null; say?: string; error?: string; trashId?: string; removed?: number; restored?: number; count?: number; build?: { profile: string; id: string }; steps?: number; minutes?: number; understood?: boolean; focus?: string; action?: string; address?: string; link?: string; hits?: tc.Hit[]; markdown?: string; command?: tc.VoiceCommand; changed?: boolean | number }
export interface BuildPreview { ok: boolean; preview: true; build: { profile: string; id: string }; change: tc.BuildChange; minutes: number }
interface StateWire { ok: boolean; error?: string; rev: number; items: Item[]; trash: State['trash']; store: string; onHub: boolean }

/* ---------------------------------------------------------------- the store */

/** `opened`: the plan (or any item) the page shows on its own (Open / `view:plan-studio-2/plan:<id>`), null = everything. */
interface Store { state: State | null; error: string; selected: string | null; focus: string | null; opened: string | null; store: string; onHub: boolean; busy: boolean }
let store: Store = { state: null, error: '', selected: null, focus: null, opened: null, store: '', onHub: false, busy: false };
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());
const set = (p: Partial<Store>) => { store = { ...store, ...p }; tell(); };

export async function reload(): Promise<void> {
  loading = (async () => {
    try {
      const r = await api.call<StateWire>('state');
      if (!r.ok) throw new Error(r.error || 'no data');
      set({ state: tc.normalize({ $axf: tc.SCHEMA, rev: r.rev, items: r.items, trash: r.trash }), error: '', store: r.store, onHub: r.onHub });
    } catch (e) { set({ error: (e as Error).message }); } finally { loading = null; }
  })();
  return loading;
}
const snap = () => store;
export function useTree(): Store & { reload: () => Promise<void> } {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, snap, snap);
  useEffect(() => { if (!store.state && !loading) void reload(); }, []);
  return { ...s, reload };
}
export const treeState = () => store.state;
export const selectedId = () => store.selected;
export const select = (id: string | null) => set({ selected: id });
/** A deep link (`plan-studio-2.focus:<id or words>`): the page selects it, opens its ancestors and scrolls to it. */
export const requestFocus = (ref: string) => set({ focus: ref });
export const tookFocus = () => set({ focus: null });
/** Open one plan (id or words) as the page: only it and everything under it, selected. null = back to every plan. */
export const openPlan = (ref: string | null) => {
  const it = ref && store.state ? tc.resolve(store.state, ref) : null;
  set({ opened: ref ? (it?.id ?? ref) : null, ...(it ? { selected: it.id } : {}) });
};
export const openedRef = () => store.opened;
/** The deep-link address of an opened plan (the resolver maps `plan:<id>` to the `plan-studio-2.open:<id>` action). */
export const planAddress = (id: string) => `view:${VIEW}/plan:${id}`;

/* ---------------------------------------------------------------- writes */

type Op = 'add' | 'rename' | 'edit' | 'move' | 'nudge' | 'indent' | 'outdent' | 'duplicate' | 'undo' | 'link' | 'unlink' | 'collapse' | 'import' | 'build' | 'say';
async function post(op: Op, body: Record<string, unknown>, { quiet = false } = {}): Promise<OpResult> {
  set({ busy: true });
  try {
    const r = await api.post<OpResult>(op, body);
    if (!quiet) await reload();
    return r;
  } finally { set({ busy: false }); }
}
export const addItem = (o: { parent?: string | null; kind?: string; title: string; body?: string; index?: number; priority?: string; model?: string; minutes?: number; tags?: string[]; status?: string }) => post('add', o);
export const renameItem = (id: string, title: string) => post('rename', { id, title });
export const editItem = (id: string, patch: Partial<Item>) => post('edit', { id, patch });
export const moveItem = (id: string, parent: string | null, index?: number) => post('move', { id, parent, index });
export const nudgeItem = (id: string, delta: -1 | 1) => post('nudge', { id, delta });
export const indentItem = (id: string) => post('indent', { id });
export const outdentItem = (id: string) => post('outdent', { id });
export const duplicateItem = (id: string) => post('duplicate', { id });
export const undoDelete = (trashId = '') => post('undo', trashId ? { trashId } : {});
export const linkItem = (id: string, l: Partial<Link>) => post('link', { id, ...l });
export const unlinkItem = (id: string, l: { type: string; ref: string }) => post('unlink', { id, ...l });
export const importItems = (data: unknown, parent: string | null) => post('import', { data, parent });
export const sendToBuild = (id: string, o: { preview?: boolean; buildId?: string; said?: string } = {}) => post('build', { id, ...o }, { quiet: !!o.preview }) as Promise<OpResult | BuildPreview>;
export const sayCommand = (text: string) => post('say', { text, local: true });
export async function deleteItem(id: string): Promise<OpResult> {
  set({ busy: true });
  try { const r = await api.del<OpResult>(`item/${encodeURIComponent(id)}`); await reload(); if (store.selected === id) set({ selected: null }); return r; } finally { set({ busy: false }); }
}
/** Fold / unfold locally first (instant), then tell the server so the CLI and voice see the same tree. */
export function setCollapsed(ids: string[] | null, collapsed: boolean): void {
  if (store.state) set({ state: tc.setCollapsed(store.state, ids, collapsed).state });
  void post('collapse', ids ? { id: ids[0], collapsed } : { all: true, collapsed }, { quiet: true });
}
export async function exportText(id: string | null, format: 'md' | 'json'): Promise<string> {
  const r = await api.call<{ ok: boolean; markdown?: string; data?: unknown; error?: string }>(`export?format=${format}${id ? `&id=${encodeURIComponent(id)}` : ''}`);
  if (!r.ok) throw new Error(r.error || 'export failed');
  return format === 'json' ? JSON.stringify(r.data, null, 1) : r.markdown ?? '';
}
export function download(name: string, text: string, type = 'text/markdown'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------------------------------------------------------- links to the rest of the console (explicit, never a sync) */

export const LINK_LABEL: Record<tc.LinkType, string> = { todo: 'To-do', build: 'Build', note: 'Note', shipped: 'Shipped feature', plan: 'Plan item', url: 'Link' };
export const LINK_ICON: Record<tc.LinkType, string> = { todo: 'list', build: 'layers', note: 'file', shipped: 'check-circle', plan: 'branch', url: 'external' };
/** The action spec that opens a link's target in the console (another plugin's deep link), or null for a URL. */
export function linkAction(l: Link): string | null {
  switch (l.type) {
    case 'todo': return 'todo-manager.open';
    case 'build': return `build-orchestrator.open:${l.ref.includes(':') ? l.ref.slice(l.ref.indexOf(':') + 1) : l.ref}`;
    case 'note': return 'nav:notes';
    case 'shipped': return `shipped-features.show:${l.ref}`;
    case 'plan': return `plan-studio-2.focus:${l.ref}`;
    default: return null;
  }
}

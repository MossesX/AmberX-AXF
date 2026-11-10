/**
 * Search bar shared state: matching options (server is the source of truth, cached here), the AI status, and every
 * search bar instance on screen (so actions, voice and the API can drive one without the UI).
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { pluginApi } from '@console/plugins';
import { DEFAULT_OPTIONS, aiActive, normOptions, type Options, type Scope } from './match.mjs';

export const FOLDER = 'search-bar';
export const ID = 'ai.amberx.axf.console.search-bar';
export const api = pluginApi(FOLDER, 'Search bar');

export interface AiStatus { capability: boolean; ollama: boolean; profile: string; enabled: boolean; active: boolean }
export interface Instance {
  key: string; id: string; host: string; view: string;
  scope: Scope; query: string; open: boolean; results: number; categories: Record<string, number>;
  /** type into it, open the drop-down and focus the box */
  show(query?: string): void;
  setScope(s: Scope): void;
  close(): void;
}

interface State { options: Options; ai: AiStatus; aiEnabled: boolean; instances: Instance[]; rev: number }
let st: State = {
  options: normOptions(DEFAULT_OPTIONS), aiEnabled: false, rev: 0,
  ai: { capability: false, ollama: false, profile: '', enabled: false, active: false }, instances: [],
};
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p, rev: st.rev + 1 }; subs.forEach((f) => f()); scheduleReport(); };
export const getState = () => st;
export const useSearchState = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);

interface ConfigReply { options: Options & { ai: boolean } }

export async function loadConfig(): Promise<void> {
  try {
    const c = await api.call<ConfigReply>('config');
    set({ options: normOptions(c.options), aiEnabled: c.options.ai === true });
  } catch { /* server part unavailable: built-in defaults */ }
  await loadAi();
}

export async function loadAi(): Promise<void> {
  try { set({ ai: await api.call<AiStatus>('ai') }); } catch { set({ ai: { ...st.ai, active: false } }); }
}

/** Change matching options / the AI switch (partial). Returns the error text, '' when saved. */
export async function saveConfig(patch: Partial<Options> & { ai?: boolean }): Promise<string> {
  try {
    const c = await api.put<ConfigReply>('config', patch);
    set({ options: normOptions(c.options), aiEnabled: c.options.ai === true });
    await loadAi();
    return '';
  } catch (e) {
    return (e as Error).message;
  }
}

/** Is AI ranking on right now (Ollama connection + AI capability + AI assistance switched on)? */
export const aiOn = (s: State = st) => aiActive({ ollama: s.ai.ollama, capability: s.ai.capability, enabled: s.aiEnabled });

/* ---------------- instances ---------------- */

export function upsertInstance(i: Instance): void {
  const rest = st.instances.filter((x) => x.key !== i.key);
  set({ instances: [...rest, i] });
}
export function dropInstance(key: string): void { set({ instances: st.instances.filter((x) => x.key !== key) }); }
/** Pick an instance: by key or asset id, else the first banner one, else the first. */
export function findInstance(which?: string): Instance | undefined {
  const all = st.instances;
  if (which) return all.find((i) => i.key === which || i.id === which);
  return all.find((i) => i.host === 'banner') ?? all[0];
}

/* ---------------- state report (GET /state on the API reads it) ---------------- */

const TAB = Math.random().toString(36).slice(2, 10);
let timer: ReturnType<typeof setTimeout> | null = null;
function scheduleReport(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const instances = st.instances.map(({ key, host, view, scope, query, open, results, categories }) => ({ id: key, host, view, scope, query, open, results, categories }));
    void api.put('state', { tab: TAB, instances, ai: aiActive({ ollama: st.ai.ollama, capability: st.ai.capability, enabled: st.aiEnabled }) }).catch(() => undefined);
  }, 800);
}

/* ---------------- placed bars (more than one; each its own asset, attached to a host) ---------------- */

export const PLACED_KEY = 'search-bar.placed';
export interface Placed { id: string; host: 'banner' | 'toolbar'; at: string; view: string; scope: Scope }
export const VIEWS = ['bar', 'compact', 'icon'] as const;
export const VIEW_LABELS: Record<string, string> = { bar: 'Full bar', compact: 'Compact bar', icon: 'Icon (opens on tap)' };

export function placedList(rt: AxfRuntime): Placed[] {
  const v = rt.settings.get(PLACED_KEY);
  if (typeof v !== 'string' || !v) return [];
  try { const a = JSON.parse(v) as Placed[]; return Array.isArray(a) ? a.filter((p) => p && typeof p.id === 'string') : []; } catch { return []; }
}

export function placedAsset(p: Placed) {
  return {
    $axf: 'asset@1', type: 'search-bar', id: p.id, name: `Search bar (${p.scope === 'settings' ? 'settings' : 'everything'}, ${VIEW_LABELS[p.view] ?? p.view})`,
    version: '0.1.0', author: 'Search bar plugin', tags: ['search', 'widget'],
    description: 'A search bar placed by the Search bar plugin.',
    data: { placeholder: p.scope === 'settings' ? 'Search settings…' : 'Search everything…', maxResults: 25, width: p.view === 'bar' ? 'regular' : 'compact', shortcut: false, view: p.view, scope: p.scope },
  };
}

/** Register + attach every placed bar (called at start and whenever the list changes). */
export function paintPlaced(rt: AxfRuntime): void {
  for (const a of rt.hostAttachments('banner').filter((x) => x.origin === ID)) rt.detachFromBanner(`search-bar:${a.id}`);
  for (const a of rt.hostAttachments('toolbar').filter((x) => x.origin === ID)) rt.detachFromToolbar(`search-bar:${a.id}`);
  placedList(rt).forEach((p, n) => {
    rt.registry.register(placedAsset(p), 'app', ID);
    if (p.host === 'toolbar') rt.attachToToolbar({ type: 'search-bar', id: p.id, at: p.at === 'start' ? 'start' : 'end', order: 50 + n, origin: ID });
    else rt.attachToBanner({ type: 'search-bar', id: p.id, at: p.at === 'left' || p.at === 'center' ? p.at : 'right', order: 40 + n, origin: ID, widget: { label: 'Search bar', size: 'compact', priority: 2, aliases: ['search', 'find'] } });
  });
}

export function addPlaced(rt: AxfRuntime, host: 'banner' | 'toolbar', view: string, scope: Scope): Placed {
  const list = placedList(rt);
  const p: Placed = { id: `sb-${Date.now().toString(36)}`, host, at: host === 'toolbar' ? 'end' : 'right', view: (VIEWS as readonly string[]).includes(view) ? view : 'bar', scope };
  rt.settings.set(PLACED_KEY, JSON.stringify([...list, p]));
  paintPlaced(rt);
  return p;
}

export function removePlaced(rt: AxfRuntime, id: string): boolean {
  const list = placedList(rt);
  if (!list.some((p) => p.id === id)) return false;
  rt.settings.set(PLACED_KEY, JSON.stringify(list.filter((p) => p.id !== id)));
  paintPlaced(rt);
  return true;
}

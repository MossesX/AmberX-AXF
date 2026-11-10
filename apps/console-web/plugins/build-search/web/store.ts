/**
 * Build search: the view's state (last result, open log, settings) and the calls to the server part. Every call is a
 * plain REST route (no model), the same routes MCP and the CLI reach through plugin-commands@1.
 */
import { useSyncExternalStore } from 'react';
import { pluginApi } from '@console/plugins';

export const FOLDER = 'build-search';
export const ID = 'ai.amberx.axf.console.build-search';
export const VERSION = '0.1.0';
export const VIEW = 'build-search';
export const CAPABILITY = 'axf.build-search@1';
export const URL_PARAM = 'axf-build-search';

const api = pluginApi(FOLDER, 'Build search');

export interface Hit { id: string; n: number; line: number; text: string; ranges: [number, number][] }
export interface Group { doc: string; type: string; icon: string; typeLabel: string; title: string; build: string; path: string; at: string; count: number; hits: Hit[] }
export interface Result { q: string; error: string; total: number; shown: number; docs: number; searched: number; truncated: boolean; groups: Group[]; ms?: number }
export interface HitAction { id: string; label: string; icon: string; run?: string; builtin?: boolean; types?: string[] }
export interface Opened { doc: { id: string; type: string; title: string; build: string; path: string; at: string }; start: number; end: number; line: number; total: number; lines: string[]; actions: HitAction[] }
export interface Source { id: string; name: string; path: string; type: string; count?: number }
export interface Settings { types: string[]; maxHits: number; maxPerDoc: number; context: number; snippet: number; sources: Source[]; actions: HitAction[]; ai: { enabled: boolean } }

interface State {
  q: string; types: string[]; build: string;
  busy: boolean; error: string; message: string;
  result: Result | null;
  opened: Opened | null; openedHit: string; openBusy: boolean;
  settings: Settings | null;
  sources: { builtIn: { id: string; label: string; count: number }[]; user: Source[]; roots: string[] } | null;
}

let state: State = { q: '', types: [], build: '', busy: false, error: '', message: '', result: null, opened: null, openedHit: '', openBusy: false, settings: null, sources: null };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const getState = () => state;
export const useBuildSearch = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, getState);

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

let seq = 0;
/** Run a query (or a typed command when it starts with '>'). */
export async function runQuery(q: string, opts: { types?: string[]; build?: string } = {}): Promise<Result | null> {
  const types = opts.types ?? state.types;
  const build = opts.build ?? state.build;
  set({ q, types, build, error: '', message: '' });
  if (q.trim().startsWith('>')) { await runCommand(q); return null; }
  if (!q.trim()) { set({ result: null, busy: false }); return null; }
  const mine = ++seq;
  set({ busy: true });
  try {
    const p = new URLSearchParams({ q });
    if (types.length) p.set('type', types.join(','));
    if (build) p.set('build', build);
    const r = await api.call<Result>(`search?${p}`);
    if (mine === seq) set({ result: r, busy: false });
    return r;
  } catch (e) {
    if (mine === seq) set({ busy: false, error: msg(e) });
    return null;
  }
}

export async function runCommand(text: string): Promise<boolean> {
  set({ busy: true, error: '', message: '' });
  try {
    const r = await api.post<{ message?: string; settings?: Settings }>('command', { text: text.replace(/^\s*>\s*/, '') });
    set({ busy: false, message: r.message ?? 'Done.', ...(r.settings ? { settings: r.settings } : {}) });
    void loadSources();
    return true;
  } catch (e) { set({ busy: false, error: msg(e) }); return false; }
}

/** Open a hit (`<doc id>#<line>`) or a document in the log viewer. */
export async function openHit(id: string): Promise<boolean> {
  set({ openBusy: true, openedHit: id, error: '' });
  try {
    const r = await api.call<Opened>(`open?${new URLSearchParams({ id, context: '400' })}`);
    set({ opened: r, openBusy: false });
    return true;
  } catch (e) { set({ openBusy: false, error: msg(e) }); return false; }
}
export const closeLog = () => set({ opened: null, openedHit: '' });

export async function loadSettings() {
  try { const r = await api.call<{ settings: Settings }>('settings'); set({ settings: r.settings }); } catch (e) { set({ error: msg(e) }); }
}
export async function loadSources() {
  try { const r = await api.call<NonNullable<State['sources']>>('sources'); set({ sources: r }); } catch { /* shown by settings */ }
}
export async function setAi(enabled: boolean) {
  try { await api.put('ai', { enabled }); await loadSettings(); } catch (e) { set({ error: msg(e) }); }
}
export async function setSetting(key: string, value: unknown) {
  try { await api.put('settings', { key, value }); await loadSettings(); } catch (e) { set({ error: msg(e) }); }
}
export async function addSource(name: string, path: string, type: string) {
  try { await api.post('sources', { name, path, type }); await Promise.all([loadSettings(), loadSources()]); return true; } catch (e) { set({ error: msg(e) }); return false; }
}
export async function removeSource(id: string) {
  try { await api.post('sources/remove', { id }); await Promise.all([loadSettings(), loadSources()]); } catch (e) { set({ error: msg(e) }); }
}
export async function addAction(label: string, run: string) {
  try { await api.post('actions', { label, run }); await loadSettings(); return true; } catch (e) { set({ error: msg(e) }); return false; }
}
export async function removeAction(id: string) {
  try { await api.post('actions/remove', { id }); await loadSettings(); } catch (e) { set({ error: msg(e) }); }
}
export const setTypes = (types: string[]) => { set({ types }); if (state.q.trim()) void runQuery(state.q); };
export const setBuild = (build: string) => { set({ build }); if (state.q.trim()) void runQuery(state.q); };

/** The group and position of a hit in the last result (instance navigation in the log viewer). */
export function hitPlace(id: string): { group: Group; index: number } | null {
  for (const g of state.result?.groups ?? []) { const i = g.hits.findIndex((h) => h.id === id); if (i >= 0) return { group: g, index: i }; }
  return null;
}

/** A link that opens this hit in the console (the console reads the parameter on load). */
export function hitLink(id: string): string {
  const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set(URL_PARAM, id);
  return u.toString();
}

/** Fill a user action's placeholders from a hit (the same rules as engine.mjs fillAction). */
export function fillRun(run: string, ctx: Record<string, string | number>) {
  const url = /^https:\/\//i.test(run);
  return run.replace(/\{(build|line|doc|type|n|q|text|path)\}/g, (_, k: string) => { const v = String(ctx[k] ?? ''); return url || run.includes(':') ? encodeURIComponent(v) : v; });
}

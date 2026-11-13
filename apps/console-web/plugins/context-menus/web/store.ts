/*
 * Context menus — the web store and the bridge to the runtime. Every menu lives on axHub (the server part reads the
 * hub's shared data: one true source); here each one is registered as a context-menu asset (`ctx-<id>`) so the runtime
 * can draw it, and the one the app shows is swapped in. The capability `context-menus@1` is published on
 * `globalThis.__axfWebServices` for other plugins' web parts (list / get / active / zones / use), and the UI Manager's
 * `ui-elements@1` is read (when present) to link zones to the elements that draw them. Never another plugin's folder.
 */
import type { AxfRuntime } from '@console/axf/core';
import { pluginApi } from '@console/plugins';
import * as R from '@console/axf/core/engines/context-menus-rules.mjs';
import type { CtxItem, LevelId, MenuDoc, Zone } from '@console/axf/core/engines/context-menus-rules.mjs';

export const FOLDER = 'context-menus';
export const ID = 'ai.amberx.axf.console.context-menus';
export const VIEW = 'context-menus';
export const APP = 'console-web';
export const CAPABILITY = R.CAPABILITY;
export const UI_ELEMENTS = 'ui-elements@1';

export interface Draft { $axf: string; id: string; at: string; by: string; model: string; level: LevelId; app: string; page: string; menu: MenuDoc; warnings: string[]; diff: R.TargetDiff[]; summary: R.Summary }
export interface ClaudeState { ready: boolean; reason: string; state: string }
export interface State { menus: MenuDoc[]; active: Record<string, string>; levels: R.Level[]; zones: Zone[]; drafts: Draft[]; store: string; onHub: boolean; apps: string[]; claude: ClaudeState }

export const api = pluginApi(FOLDER, 'The Context menus plugin');

let state: State | null = null;
let error = '';
let loading = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
export const getState = () => state;
export const getError = () => error;
export const isLoading = () => loading;
export function subscribe(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }

/** Register every hub menu as a runtime asset and put the one the app shows on screen. */
export function applyToRuntime(rt: AxfRuntime, s: State): void {
  const activeNow = (rt.getState().active as Record<string, string>)['context-menu'];
  for (const m of s.menus) rt.registry.register(m.asset, 'imported', FOLDER);
  const want = s.active[APP];
  const wantAsset = want ? s.menus.find((m) => m.id === want)?.asset.id : undefined;
  if (wantAsset && activeNow !== wantAsset) rt.swap('context-menu' as never, wantAsset);
  else if (wantAsset && activeNow === wantAsset) rt.swap('context-menu' as never, wantAsset); // recompile after an edit
}

export async function load(rt?: AxfRuntime): Promise<State | null> {
  loading = true; emit();
  try {
    const s = await api.call<State>(`state?app=`);
    state = s; error = '';
    if (rt) applyToRuntime(rt, s);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally { loading = false; emit(); }
  return state;
}

export async function generate(level: LevelId, opts: { app?: string; page?: string; name?: string; actions?: { id: string; label: string; module?: string }[]; apply?: boolean } = {}): Promise<{ ok: boolean; draft?: Draft; menu?: MenuDoc; error?: string; aiMissing?: boolean; model?: string; warnings?: string[] }> {
  const r = await api.post<{ ok: boolean; draft?: Draft; menu?: MenuDoc; error?: string; aiMissing?: boolean; model?: string; warnings?: string[] }>('generate', { level, app: opts.app ?? APP, page: opts.page ?? '', name: opts.name ?? '', actions: opts.actions, apply: !!opts.apply });
  return r;
}
export const applyDraft = (id: string, use = true) => api.post<{ ok: boolean; menu: MenuDoc }>('apply', { id, use });
export const discardDraft = (id: string) => api.post<{ ok: boolean }>('discard', { id });
export const useMenu = (id: string) => api.post<{ ok: boolean }>(`menus/${encodeURIComponent(id)}/use`, {});
export const saveMenu = (id: string, menu: MenuDoc) => api.put<{ ok: boolean; menu: MenuDoc }>(`menus/${encodeURIComponent(id)}`, { menu });
export const deleteMenu = (id: string) => api.del<{ ok: boolean }>(`menus/${encodeURIComponent(id)}`);
export const restoreMenu = (id: string, v: number) => api.post<{ ok: boolean; menu: MenuDoc }>(`menus/${encodeURIComponent(id)}/restore`, { v });
export const historyOf = (id: string) => api.call<{ history: R.History }>(`menus/${encodeURIComponent(id)}/history`);
export const voice = (text: string) => api.post<Record<string, unknown>>('voice', { text });
export const claudeCheck = (live = false) => api.call<ClaudeState>(`claude?live=${live}`);

/** The real actions the open console can run (ids + labels): Claude may only use these. */
export function liveActions(rt: AxfRuntime): { id: string; label: string; module?: string }[] {
  return rt.actions.list().filter((a) => !a.meta.stub).map((a) => ({ id: a.id, label: a.meta.label || a.id, ...(a.meta.module ? { module: a.meta.module } : {}) }));
}

/** The zones on the screen right now (every data-fx-ctx-target plus the implicit kinds), with element labels. */
export function zonesOnScreen(): { id: string; label?: string; elements: string[] }[] {
  if (typeof document === 'undefined') return [];
  const seen = new Map<string, Set<string>>();
  const add = (id: string, el: Element) => {
    const s = seen.get(id) ?? new Set<string>();
    const label = el.getAttribute('aria-label') || el.getAttribute('data-axf-toolbar') || el.getAttribute('data-axf-tab-group') || el.getAttribute('data-axf-nav') || el.getAttribute('data-fx-ctx-payload') || '';
    if (label) s.add(label.slice(0, 80));
    seen.set(id, s);
  };
  document.querySelectorAll('[data-fx-ctx-target]').forEach((el) => add(el.getAttribute('data-fx-ctx-target') ?? '', el));
  document.querySelectorAll('[role="toolbar"]').forEach((el) => add('toolbar', el));
  document.querySelectorAll('[role="tablist"]').forEach((el) => add('tab-group', el));
  document.querySelectorAll('nav:not([data-axf-not-nav])').forEach((el) => add('nav', el));
  return [...seen.entries()].filter(([id]) => id).map(([id, els]) => ({ id, elements: [...els].slice(0, 12) }));
}

export async function reportZones(rt: AxfRuntime): Promise<void> {
  const items = zonesOnScreen();
  if (!items.length) return;
  try { await api.post('zones/report', { items, page: rt.getState().view }); } catch { /* the registry is a convenience; the page still works */ }
}

/* ---------------- capabilities ---------------- */

type Services = Record<string, unknown>;
const services = () => ((globalThis as { __axfWebServices?: Services }).__axfWebServices ??= {});

/** The UI Manager's element service (ui-elements@1) when that plugin is on: zones link to the elements that draw them. */
export interface UiElements { version?: number; list?(): { id: string; label?: string; category?: string }[]; open?(elementId: string): void; find?(q: string): { id: string; label?: string }[] }
export function uiElements(): UiElements | null {
  const s = services()[UI_ELEMENTS] as UiElements | undefined;
  return s && typeof s === 'object' ? s : null;
}

/** context-menus@1 (web): what other plugins' web parts may call. */
export interface ContextMenusService {
  version: 1;
  list(filter?: { app?: string; level?: string; zone?: string; q?: string }): MenuDoc[];
  get(id: string): MenuDoc | null;
  active(app?: string): MenuDoc | null;
  zones(): Zone[];
  itemsFor(zone: string, app?: string): CtxItem[];
  use(id: string): Promise<void>;
  refresh(): Promise<void>;
  levels(): R.Level[];
}
export function publishService(rt: AxfRuntime): () => void {
  const svc: ContextMenusService = {
    version: 1,
    list: (f = {}) => R.filterMenus(state?.menus ?? [], f),
    get: (id) => state?.menus.find((m) => m.id === id) ?? null,
    active: (app = APP) => { const id = state?.active[app]; return (id && state?.menus.find((m) => m.id === id)) || null; },
    zones: () => state?.zones ?? [],
    itemsFor: (zone, app = APP) => { const id = state?.active[app]; const m = id ? state?.menus.find((x) => x.id === id) : null; return m?.asset.data.targets[zone] ?? m?.asset.data.targets.default ?? []; },
    use: async (id) => { await useMenu(id); await load(rt); },
    refresh: async () => { await load(rt); },
    levels: () => Object.values(R.LEVELS),
  };
  services()[CAPABILITY] = svc;
  return () => { if (services()[CAPABILITY] === svc) delete services()[CAPABILITY]; };
}

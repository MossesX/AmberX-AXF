/**
 * Page toolbars on the React port (page-toolbar@1; engine core/engines/toolbar-actions.ts). Build
 * rebuild-every-toolbar-page-specific (Brett, Nov 17 2026: "Everywhere there's a toolbar, rebuild the asset for that
 * page/plugin with useful, integrated buttons made for it.").
 *
 * Three small registries and one hook:
 *   - page state: a page publishes what its toolbar may read (`usePublishPageState(view, { selection, busy… })`);
 *     the toolbar and the API read it with dotted keys (enabledWhen / visibleWhen / badges / toggles / args);
 *   - handlers: a page registers the functions a `handler:<id>` button runs (`useToolbarHandlers(view, { 'gate.pause': fn })`);
 *   - dispatchers: how this host runs the four ref kinds. Actions go through the runtime's action bus, control refs
 *     through the console-control registry, handlers through the page; plugin commands need the host's runner
 *     (`setToolbarCommandRunner`: the console installs one that posts the command the way REST / MCP / CLI do);
 *   - `usePageToolbar(view?, slot?)`: the asset for this page (the person's pick for the slot, else scope + slot),
 *     resolved through the engine against the page state, the runtime's gates, counters, host takes and locks, the
 *     live provider lists and the measured room on the bar; re-resolved when any of them changes.
 * The view id defaults to the enclosing console-control scope (`view:<id>`), so a page needs no plumbing.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../core/runtime';
import { findToolbarButton, invokeToolbarButton, pickPageToolbar, resolvePageToolbar, toolbarState, type ResolvedToolbar, type ResolvedToolbarButton, type ToolbarAssetLike, type ToolbarDispatchers, type ToolbarEnv, type ToolbarPage, type ToolbarPageState, type ToolbarPressOutcome } from '../core/engines/toolbar-actions';
import { TOOLBAR_DEFAULTS } from '../core/engines/toolbar-rules.mjs';
import type { CompiledMenuItem } from '../core/engines/appmenu';
import { useAxfState, useOptionalRuntime } from './AxfProvider';
import { controlRegistry, useControlScope } from './controlTargets';

/* ================================================================== page state */

type Listener = () => void;
const states = new Map<string, ToolbarPageState>();
const stateListeners = new Set<Listener>();
const EMPTY: ToolbarPageState = Object.freeze({}) as ToolbarPageState;
const notifyState = () => { for (const l of stateListeners) l(); };

/** Publish (merge) a page's state; `null` clears it. The API (`toolbar:<id>` state) and the toolbar read the same map. */
export function publishPageState(view: string, state: ToolbarPageState | null, replace = false): void {
  if (!view) return;
  if (state === null) states.delete(view);
  else states.set(view, replace ? { ...state } : { ...(states.get(view) ?? {}), ...state });
  notifyState();
}
export const pageStateOf = (view: string | null | undefined): ToolbarPageState => (view ? states.get(view) ?? EMPTY : EMPTY);
export const pageStateViews = (): string[] => [...states.keys()];
function subscribeState(l: Listener) { stateListeners.add(l); return () => { stateListeners.delete(l); }; }

/** The current state of a page (re-renders when it changes). */
export function usePageState(view: string | null | undefined): ToolbarPageState {
  return useSyncExternalStore(subscribeState, () => pageStateOf(view), () => pageStateOf(view));
}

/**
 * Publish a page's state for its lifetime. Pass a fresh object each render: it is replaced (not merged) whenever its
 * JSON changes, and cleared when the page unmounts. Keys are the dotted keys the toolbar asset reads.
 */
export function usePublishPageState(view: string | null | undefined, state: ToolbarPageState): void {
  const json = JSON.stringify(state);
  useEffect(() => {
    if (!view) return undefined;
    publishPageState(view, JSON.parse(json) as ToolbarPageState, true);
    return () => publishPageState(view, null);
  }, [view, json]);
}

/* ================================================================== handlers */

export type ToolbarHandler = (args: Record<string, unknown>, button: ResolvedToolbarButton | null) => unknown | Promise<unknown>;
const handlers = new Map<string, Map<string, ToolbarHandler>>();
const handlerListeners = new Set<Listener>();
const notifyHandlers = () => { for (const l of handlerListeners) l(); };

/** Register one handler a `handler:<id>` button of this page runs; returns the unregister. Ids are global per page. */
export function registerToolbarHandler(view: string, id: string, fn: ToolbarHandler): () => void {
  let m = handlers.get(view);
  if (!m) { m = new Map(); handlers.set(view, m); }
  m.set(id, fn);
  notifyHandlers();
  return () => { const cur = handlers.get(view); if (cur?.get(id) === fn) { cur.delete(id); if (!cur.size) handlers.delete(view); notifyHandlers(); } };
}
export const toolbarHandlerIds = (view: string | null | undefined): string[] => (view ? [...(handlers.get(view)?.keys() ?? [])] : []);
export const toolbarHandlerOf = (view: string | null | undefined, id: string): ToolbarHandler | null => (view ? handlers.get(view)?.get(id) ?? null : null);
function subscribeHandlers(l: Listener) { handlerListeners.add(l); return () => { handlerListeners.delete(l); }; }
const handlerKey = (view: string | null | undefined) => toolbarHandlerIds(view).join('\n');

/** Register a page's handlers for its lifetime. Handlers read the latest closure: re-registration never re-resolves. */
export function useToolbarHandlers(view: string | null | undefined, fns: Record<string, ToolbarHandler>): void {
  const ids = Object.keys(fns).sort().join('\n');
  const latest = useMemo(() => ({ fns }), [fns]);
  latest.fns = fns;
  useEffect(() => {
    if (!view) return undefined;
    const offs = ids.split('\n').filter(Boolean).map((id) => registerToolbarHandler(view, id, (args, b) => latest.fns[id]?.(args, b)));
    return () => { for (const off of offs) off(); };
  }, [view, ids, latest]);
}

/* ================================================================== dispatchers */

export type ToolbarCommandRunner = (plugin: string, command: string, input: Record<string, unknown>, opts: { confirm?: boolean }) => Promise<unknown>;
export type ToolbarConfirmer = (question: string, button: ResolvedToolbarButton) => boolean | Promise<boolean>;
let commandRunner: ToolbarCommandRunner | null = null;
let confirmer: ToolbarConfirmer | null = null;

/** The host's plugin command runner (the console posts `plugins.commands` through its API, as REST / MCP / CLI do). */
export function setToolbarCommandRunner(fn: ToolbarCommandRunner | null): void { commandRunner = fn; }
export const toolbarCommandRunner = (): ToolbarCommandRunner | null => commandRunner;
/** How a press asks before a confirm button runs (default: the window's confirm). */
export function setToolbarConfirmer(fn: ToolbarConfirmer | null): void { confirmer = fn; }

const defaultConfirm: ToolbarConfirmer = (q) => (typeof globalThis.confirm === 'function' ? globalThis.confirm(q) : false);

/** The dispatchers for a page on this runtime: action bus, host command runner, console-control registry, page handlers. */
export function toolbarDispatchers(rt: AxfRuntime, view: string | null | undefined, opts: { confirm?: ToolbarConfirmer | null } = {}): ToolbarDispatchers {
  return {
    action: (spec) => { const ok = rt.dispatch(spec); if (!ok) throw new Error(`no handler for "${spec}"`); return true; },
    command: commandRunner ? (plugin, command, input) => commandRunner!(plugin, command, input, {}) : undefined,
    control: async (address, verb, args) => {
      const r = await controlRegistry(rt).run({ op: verb, target: address, ...(verb === 'press' && args && Object.keys(args).length ? { value: args } : {}) });
      if (!r.ok) throw new Error(String((r as { message?: string }).message ?? `console-control ${verb} failed`));
      return r;
    },
    handler: (id, args) => { const fn = toolbarHandlerOf(view, id); if (!fn) throw new Error(`no handler "${id}" on this page`); return fn(args, null); },
    confirm: opts.confirm === null ? undefined : opts.confirm ?? confirmer ?? defaultConfirm,
  };
}

/* ================================================================== the hook */

/** The view id of the enclosing console-control scope (`view:gate/tab:…` → `gate`), or null. */
export function useScopeView(): string | null {
  const scope = useControlScope();
  const m = scope ? /(?:^|\/)view:([^/]+)/.exec(scope) : null;
  return m ? decodeURIComponent(m[1] ?? '') : null;
}

export interface PageToolbarHook {
  /** the resolved toolbar, or null when this page has no toolbar asset (keep the handwritten bar) */
  toolbar: ResolvedToolbar | null;
  asset: ToolbarAssetLike | null;
  page: ToolbarPage;
  /** press a button (or its id); what the engine answers */
  press: (button: ResolvedToolbarButton | string) => Promise<ToolbarPressOutcome>;
  /** tell the hook how many buttons fit on the bar now (the component measures; undefined = all) */
  setFit: (n: number | undefined) => void;
  /** readable state (console-control) */
  state: () => ReturnType<typeof toolbarState> | null;
}

/** The provider lists a toolbar's live groups need, loaded through the runtime (reloaded shortly after the app changes). */
function useProviderItems(rt: AxfRuntime | null, asset: ToolbarAssetLike | null, rev: number): Record<string, CompiledMenuItem[]> {
  const [items, setItems] = useState<Record<string, CompiledMenuItem[]>>({});
  const providers = (asset?.data.groups ?? []).filter((g) => g.provider).map((g) => `${g.provider}:${g.max ?? 8}`).join(',');
  useEffect(() => {
    if (!rt || !providers) { setItems({}); return undefined; }
    let gone = false;
    const t = setTimeout(() => {
      Promise.all(providers.split(',').map(async (p) => { const [id, max] = p.split(':'); try { return [id!, await rt.loadToolbarProvider(id!, Number(max) || 8)] as const; } catch { return [id!, []] as const; } }))
        .then((pairs) => { if (!gone) setItems(Object.fromEntries(pairs)); });
    }, 0);
    return () => { gone = true; clearTimeout(t); };
  }, [rt, providers, rev]);
  return items;
}

/**
 * The page toolbar of a view (default: the enclosing scope's view) in a slot (default main), resolved through the
 * engine. `assetId` forces one asset (a page that names its own, or a preview). Null toolbar = no asset for the page.
 */
export function usePageToolbar(view?: string | null, slot?: string | null, assetId?: string | null): PageToolbarHook {
  const rt = useOptionalRuntime();
  const scopeView = useScopeView();
  const v = view ?? scopeView;
  const state = useAxfState();
  const pageState = usePageState(v);
  const handlerIds = useSyncExternalStore(subscribeHandlers, () => handlerKey(v), () => handlerKey(v));
  const [fit, setFit] = useState<number | undefined>(undefined);
  const page = useMemo<ToolbarPage>(() => ({ view: v, plugin: v ? pluginOfView(rt, v) : null, slot: slot ?? TOOLBAR_DEFAULTS.slot }), [rt, v, slot]);
  const asset = useMemo<ToolbarAssetLike | null>(() => {
    if (!rt) return null;
    const list = rt.registry.list('toolbar') as unknown as ToolbarAssetLike[];
    if (assetId) return list.find((a) => a.id === assetId) ?? null;
    return pickPageToolbar(list, page, (k) => rt.settings.get(k));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, page, assetId, state.rev]);
  const providerItems = useProviderItems(rt, asset, state.rev);
  const toolbar = useMemo<ResolvedToolbar | null>(() => {
    if (!rt || !asset) return null;
    const env: ToolbarEnv = {
      get: (k) => rt.settings.get(k),
      gate: (req) => rt.gate(req),
      counter: (n) => rt.badge(n),
      setting: (k) => rt.settings.get(k),
      hidden: (t) => rt.slotHidden(t as never),
      takenByHost: (a) => rt.takenByHost({ action: a }),
      lockedByHost: (a) => rt.lockedByHost({ action: a }),
      handlers: handlerIds ? handlerIds.split('\n') : [],
      actions: rt.actions.list().map((a) => a.id),
      providerItems,
      fit,
    };
    return resolvePageToolbar(asset, page, pageState, env);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, asset, page, pageState, handlerIds, providerItems, fit, state.rev]);
  const press = useCallback(async (b: ResolvedToolbarButton | string): Promise<ToolbarPressOutcome> => {
    const btn = typeof b === 'string' ? (toolbar ? findToolbarButton(toolbar, b) : null) : b;
    if (!btn) return { ok: false, button: typeof b === 'string' ? b : b.id, code: 'hidden', message: 'no such button on this toolbar' };
    if (!rt) return { ok: false, button: btn.id, code: 'unsupported', message: 'no runtime' };
    const out = await invokeToolbarButton(btn, toolbarDispatchers(rt, v));
    if (!out.ok && out.code === 'failed') rt.toast(out.message, 'danger', btn.label);
    else if (!out.ok && (out.code === 'disabled' || out.code === 'unsupported')) rt.toast(out.message, 'warning', btn.label);
    return out;
  }, [rt, toolbar, v]);
  return { toolbar, asset, page, press, setFit, state: () => (toolbar ? toolbarState(toolbar) : null) };
}

/** The plugin that provides a view (`provides: view:<id>`), from the runtime's installed libraries, or null. */
export function pluginOfView(rt: AxfRuntime | null, view: string): string | null {
  const libs = (rt as unknown as { libraries?: { id: string; provides?: string[]; views?: Record<string, unknown> }[] } | null)?.libraries ?? [];
  for (const lib of libs) {
    if (lib.provides?.includes(`view:${view}`) || (lib.views && view in lib.views)) return lib.id;
  }
  return null;
}

/* ================================================================== live toolbars (for the API) */

const live = new Map<string, { hook: () => PageToolbarHook; view: string | null }>();
const liveListeners = new Set<Listener>();
/** A mounted page toolbar announces itself under its settings id so the API can list, read and press it. */
export function registerLiveToolbar(id: string, entry: { hook: () => PageToolbarHook; view: string | null }): () => void {
  live.set(id, entry);
  for (const l of liveListeners) l();
  return () => { if (live.get(id) === entry) { live.delete(id); for (const l of liveListeners) l(); } };
}
export const liveToolbars = (): { id: string; hook: PageToolbarHook; view: string | null }[] => [...live.entries()].map(([id, e]) => ({ id, hook: e.hook(), view: e.view }));
export const liveToolbar = (id: string): PageToolbarHook | null => live.get(id)?.hook() ?? null;
export function onLiveToolbars(l: Listener): () => void { liveListeners.add(l); return () => { liveListeners.delete(l); }; }

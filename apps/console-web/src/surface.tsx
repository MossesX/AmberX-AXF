/**
 * The Dev Console as a native surface (shell-surface@1, build molly-one-shell s7, Nov 2026).
 *
 * Brett, Nov 8 2026: "Every app's screens, plugins, menus and settings load natively into Molly as plugins … NO
 * embedding." A shell (Molly) imports this module (built on its own as `/surface/console-surface.js`, see
 * vite.surface.config.ts) and mounts the console's screens straight into its own page: no frame, no second banner,
 * menu, nav or settings. The console keeps its runtime, store, plugins, dialogs and toasts; the shell keeps the chrome
 * and the look (the runtime is `hosted`, so it inherits the shell's tokens instead of writing its own on the root).
 *
 * One runtime and one React tree per page, whatever the number of mounts: each mount is a portal into the element the
 * shell gave it, showing one view, so the main area and a pane can each show a different console screen while they
 * share one store and one set of dialogs.
 *
 * The seam (what the shell calls):
 *   mountSurface(el, view, ctx) → { show(view), unmount() }   a console screen inside the shell's element
 *   searchEntries()                                         every view, action, settings tab, setting, dialog and menu
 *                                                           item the console and its plugins registered (the shell
 *                                                           turns them into the surface with surfaceFromSearch)
 *   screens()                                               the screens: { id, title, icon }
 *   run(kind, id, parent?)                                  open a dialog / settings tab / setting, or run an action
 *   subscribe(f)                                            told when the above change (a plugin loaded, a view added)
 *   routes                                                  the relative paths this app calls on its own server (the
 *                                                           shell sends them there: `/api/`, `/data/`)
 */
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { AxfProvider, DialogHost, SlotsProvider, TabRenderersProvider, ToastHost, builtinDialogs, terminalDialog, windowDialogs } from './axf/react';
import type { AxfRuntime } from './axf/core';
import { ConsoleStoreProvider } from './store';
import { usePlugins, views } from './App';
import { dialogs } from './dialogs';
import { consoleTabs } from './views/Explorer';
import { PlanFeatureTab } from './views/Plan';
import { useBindAccount } from './account';
import { createConsoleRuntime } from './runtime';
import './console.css';
import './surface.css';

export const SURFACE_CONTRACT = 'shell-surface@1';
export const APP = { id: 'console', label: 'Console', icon: 'terminal', description: 'The AXF Dev Console: builds, plugins, UI Review.' } as const;
/** Relative paths the console's screens call on the console's own server. */
export const routes = ['/api/', '/data/'] as const;

export interface SurfaceContext {
  /** the shell's id, e.g. `molly` */
  host: string;
  /** the console's own screens navigated somewhere (a card's link): the shell shows that screen */
  onNavigate?: (view: string) => void;
}
export interface MountedSurface { show(view: string): void; unmount(): void }
export interface SurfaceScreen { id: string; title: string; icon?: string }

interface Mount { key: number; el: HTMLElement; view: string }

let rt: AxfRuntime | null = null;
let root: Root | null = null;
let mounts: Mount[] = [];
let ctx: SurfaceContext | null = null;
let nextKey = 1;
let screenList: SurfaceScreen[] = Object.entries(views).map(([id, v]) => ({ id, title: v.title, icon: v.icon }));
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
const mountListeners = new Set<() => void>();
const mountsChanged = () => mountListeners.forEach((f) => f());
const useMounts = () => useSyncExternalStore((f) => { mountListeners.add(f); return () => { mountListeners.delete(f); }; }, () => mounts, () => mounts);

function runtime(): AxfRuntime {
  if (rt) return rt;
  rt = createConsoleRuntime();
  let lastView = rt.getState().view;
  rt.subscribe(() => {
    const v = rt!.getState().view;
    if (v !== lastView) { lastView = v; ctx?.onNavigate?.(v); }
    notify();
  });
  return rt;
}

/** The console's screens, each portalled into the element a mount gave; dialogs and toasts once. */
function SurfaceTree() {
  useBindAccount();
  const plugins = usePlugins();
  const list = useMounts();
  const all = { ...plugins.contributed.views, ...views };
  const ids = Object.keys(all).join('|');
  if (ids !== screenList.map((s) => s.id).join('|')) {
    screenList = Object.entries(all).map(([id, v]) => ({ id, title: v.title, icon: v.icon }));
    queueMicrotask(notify);
  }
  const allDialogs = { ...builtinDialogs, ...windowDialogs, ...terminalDialog, ...plugins.contributed.dialogs, ...dialogs };
  return (
    <SlotsProvider slots={plugins.contributed.slots}>
      <TabRenderersProvider renderers={{ ...plugins.contributed.tabs, ...consoleTabs, 'plan-feature': (t) => <PlanFeatureTab id={t.payload || ''} /> }}>
        {list.map((m) => {
          const v = all[m.view] ?? all.home!;
          return createPortal(
            <div className="axf-surface" data-axf-surface={APP.id} data-axf-surface-view={m.view} data-axf-host={ctx?.host}>
              <div className="fx-main__inner axf-surface__inner" data-fx-ctx-target="canvas">{v.render()}</div>
            </div>,
            m.el,
            String(m.key),
          );
        })}
        <div className="axf-surface__overlays" data-axf-surface={APP.id}>
          <DialogHost dialogs={allDialogs} />
          <ToastHost />
        </div>
      </TabRenderersProvider>
    </SlotsProvider>
  );
}

function ensureRoot(): void {
  if (root) return;
  const host = document.createElement('div');
  host.dataset.axfSurfaceRoot = APP.id;
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    <AxfProvider runtime={runtime()} hosted>
      <ConsoleStoreProvider><SurfaceTree /></ConsoleStoreProvider>
    </AxfProvider>,
  );
}

/** Show a console screen inside `el` (the shell's element). */
export function mountSurface(el: HTMLElement, view: string, context: SurfaceContext): MountedSurface {
  ctx = context;
  ensureRoot();
  const m: Mount = { key: nextKey++, el, view: view || 'home' };
  mounts = [...mounts, m];
  mountsChanged();
  return {
    show(v: string) { mounts = mounts.map((x) => (x.key === m.key ? { ...x, view: v } : x)); mountsChanged(); },
    unmount() { mounts = mounts.filter((x) => x.key !== m.key); mountsChanged(); },
  };
}

/** Every searchable thing the console and its plugins registered (the shell builds the surface from these). */
export function searchEntries(): unknown[] {
  return runtime().search.entries().map((e) => ({ id: e.id, kind: e.kind, label: e.label, detail: e.detail, icon: e.icon, keywords: e.keywords, requires: e.requires, focus: e.focus }));
}

export function screens(): SurfaceScreen[] { runtime(); return screenList; }

/** Open a dialog, a settings tab or setting, or run an action in the console, without the console's own chrome. */
export function run(kind: string, id: string, parent?: string): boolean {
  const r = runtime();
  ensureRoot();
  switch (kind) {
    case 'dialog': r.openDialog(id); return true;
    case 'settings': return r.dispatch(`settings.open:${id}`) !== false;
    case 'setting': return r.dispatch(`settings.open:${parent ?? ''}`) !== false;
    case 'screen': r.navigate(id); return true;
    default: return r.dispatch(id) !== false;
  }
}

export function subscribe(f: () => void): () => void { listeners.add(f); runtime(); return () => { listeners.delete(f); }; }

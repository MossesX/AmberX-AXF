/**
 * Native surface (shell-surface@1 `mount.kind: 'native'`, build molly-one-shell s7/s8, Nov 2026): an AXF app as an ES
 * module a shell (Molly) imports and mounts in its own page. No frame, no second banner, menu, nav or settings (Brett,
 * Nov 8 2026: "Every app's screens, plugins, menus and settings load natively into Molly … NO embedding").
 *
 * An app writes a few lines (its `src/surface.tsx`): its id, the relative paths its screens call on its own server, how
 * to make its runtime, and a hook giving its views, dialogs, tab renderers and slots (its libraries installed). This
 * returns the seam the shell calls:
 *
 *   mountSurface(el, view, ctx) → { show(view), unmount() }   one of the app's screens inside the shell's element
 *   searchEntries()     every view, action, settings tab, setting, dialog and menu item the app and its plugins
 *                       registered (the shell turns them into the app's surface with `surfaceFromSearch`)
 *   screens()           its screens: { id, title, icon }
 *   run(kind, id, parent?)   open a dialog / settings tab / setting / screen, or run an action, in the app
 *   subscribe(f)        told when the above change (a plugin loaded, a view added, the app navigated)
 *   routes              the relative paths it calls on its own server (the shell sends them there)
 *
 * One runtime and one React tree per page, whatever the number of mounts: each mount is a portal into the element the
 * shell gave it, showing one view, so the main area and a pane can each show a different screen while they share one
 * store and one set of dialogs. The runtime is `hosted` (AxfProvider): it inherits the shell's look and leaves the
 * document-level hooks to the shell. When the app's own code navigates (a card's link), the shell is told
 * (`ctx.onNavigate`) and shows that screen.
 */
import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { AxfRuntime } from '../core';
import { AxfProvider } from './AxfProvider';
import type { ViewMap } from './AppShell';
import { DialogHost, ToastHost, type DialogMap } from './components/Overlays';
import { SlotsProvider } from './components/Slots';
import { useSearchHost } from './components/Search';
import type { SlotDef } from './library';
import { TabRenderersProvider, windowDialogs, type TabRenderers } from './windows/WindowHost';
import { builtinDialogs } from './studio/builtinDialogs';
import { terminalDialog } from './studio/OutputTerminal';

export const NATIVE_SURFACE_CONTRACT = 'shell-surface@1';

export interface NativeSurfaceApp { id: string; label: string; icon: string; description: string }
export interface NativeSurfaceContents { views: ViewMap; dialogs?: DialogMap; tabs?: TabRenderers; slots?: Record<string, SlotDef[]> }
export interface NativeSurfaceSpec {
  app: NativeSurfaceApp;
  /** relative paths the app's screens call on its own server (`/api/`) */
  routes: readonly string[];
  createRuntime(): AxfRuntime;
  /** the app's views, dialogs, tab renderers and slots; a hook, called inside the app's providers */
  useContents(): NativeSurfaceContents;
  /** the app's own providers around everything (a store) */
  wrap?: (children: ReactNode) => ReactNode;
}
export interface SurfaceContext { host: string; onNavigate?: (view: string) => void }
export interface MountedSurface { show(view: string): void; unmount(): void }
export interface SurfaceScreen { id: string; title: string; icon?: string }
export interface NativeSurface {
  SURFACE_CONTRACT: string;
  APP: NativeSurfaceApp;
  routes: readonly string[];
  mountSurface(el: HTMLElement, view: string, ctx: SurfaceContext): MountedSurface;
  searchEntries(): unknown[];
  screens(): SurfaceScreen[];
  run(kind: string, id: string, parent?: string): boolean;
  subscribe(f: () => void): () => void;
}

interface Mount { key: number; el: HTMLElement; view: string }

export function createNativeSurface(spec: NativeSurfaceSpec): NativeSurface {
  let rt: AxfRuntime | null = null;
  let root: Root | null = null;
  let mounts: Mount[] = [];
  let ctx: SurfaceContext | null = null;
  let nextKey = 1;
  let screenList: SurfaceScreen[] = [];
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((f) => f());
  const mountListeners = new Set<() => void>();
  const mountsChanged = () => mountListeners.forEach((f) => f());
  const subscribeMounts = (f: () => void) => { mountListeners.add(f); return () => { mountListeners.delete(f); }; };

  const runtime = (): AxfRuntime => {
    if (rt) return rt;
    const r = spec.createRuntime();
    rt = r;
    let lastView = r.getState().view;
    r.subscribe(() => {
      const v = r.getState().view;
      if (v !== lastView) { lastView = v; ctx?.onNavigate?.(v); }
      notify();
    });
    return r;
  };

  function Tree() {
    const c = spec.useContents();
    const list = useSyncExternalStore(subscribeMounts, () => mounts, () => mounts);
    const ids = Object.keys(c.views).join('|');
    if (ids !== screenList.map((s) => s.id).join('|')) {
      screenList = Object.entries(c.views).map(([id, v]) => ({ id, title: v.title, ...(v.icon ? { icon: v.icon } : {}) }));
      queueMicrotask(notify);
    }
    const dialogs: DialogMap = { ...builtinDialogs, ...windowDialogs, ...terminalDialog, ...(c.dialogs ?? {}) };
    // the app's screens and dialogs go into its search index, as its own shell (AppShell) would put them: the shell's
    // menus are built from that index (searchEntries)
    useSearchHost(c.views, dialogs);
    const fallback = c.views.home ?? Object.values(c.views)[0];
    return (
      <SlotsProvider slots={c.slots ?? {}}>
        <TabRenderersProvider renderers={c.tabs ?? {}}>
          {list.map((m) => {
            const v = c.views[m.view] ?? fallback;
            return createPortal(
              <div className="axf-surface" data-axf-surface={spec.app.id} data-axf-surface-view={m.view} data-axf-host={ctx?.host}>
                <div className="fx-main__inner axf-surface__inner" data-fx-ctx-target="canvas">{v?.render()}</div>
              </div>,
              m.el,
              String(m.key),
            );
          })}
          <div className="axf-surface__overlays" data-axf-surface={spec.app.id}>
            <DialogHost dialogs={dialogs} />
            <ToastHost />
          </div>
        </TabRenderersProvider>
      </SlotsProvider>
    );
  }

  const ensureRoot = () => {
    if (root) return;
    const host = document.createElement('div');
    host.dataset.axfSurfaceRoot = spec.app.id;
    document.body.appendChild(host);
    root = createRoot(host);
    const tree = <Tree />;
    root.render(<AxfProvider runtime={runtime()} hosted>{spec.wrap ? spec.wrap(tree) : tree}</AxfProvider>);
  };

  return {
    SURFACE_CONTRACT: NATIVE_SURFACE_CONTRACT,
    APP: spec.app,
    routes: spec.routes,
    mountSurface(el, view, context) {
      ctx = context;
      ensureRoot();
      const m: Mount = { key: nextKey++, el, view: view || 'home' };
      mounts = [...mounts, m];
      mountsChanged();
      return {
        show(v: string) { mounts = mounts.map((x) => (x.key === m.key ? { ...x, view: v || 'home' } : x)); mountsChanged(); },
        unmount() { mounts = mounts.filter((x) => x.key !== m.key); mountsChanged(); },
      };
    },
    searchEntries() {
      return runtime().search.entries().map((e) => ({ id: e.id, kind: e.kind, label: e.label, detail: e.detail, icon: e.icon, keywords: e.keywords, requires: e.requires, focus: e.focus }));
    },
    screens() { ensureRoot(); return screenList; },
    run(kind, id, parent) {
      const r = runtime();
      ensureRoot();
      switch (kind) {
        case 'dialog': r.openDialog(id); return true;
        case 'settings': return r.dispatch(`settings.open:${id}`);
        case 'setting': return r.dispatch(`settings.open:${parent ?? ''}`);
        case 'screen': r.navigate(id); return true;
        default: return r.dispatch(id);
      }
    },
    subscribe(f) { listeners.add(f); runtime(); return () => { listeners.delete(f); }; },
  };
}

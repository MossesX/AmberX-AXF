import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Note, useRuntime, type ViewMap } from '../axf/react';
import type { AxfRuntime } from '../axf/core';
import { surfaceFromSearch, type SurfaceItem } from '../axf/core/engines/shell-surface';
import type { OpenTarget } from '../axf/core/engines/xlayout';
import { MOLLY_APPS, mollyApp, type MollyApp } from './apps';
import { mollyService } from './host';

/**
 * Molly's native host (shell-surface@1, build molly-one-shell s7/s8, Nov 2026): every app's screens mount in Molly's own
 * page. No frames, no second banner, menu, nav or settings (Brett, Nov 8 2026: "NO embedding … ONE native app").
 *
 * An app with a `surface` module (molly/apps.ts) is imported once (`import()` of its ES module, its styles linked next
 * to it). The module's seam: `mountSurface(el, view, ctx)` shows one of its screens inside an element Molly renders;
 * `searchEntries()` lists every screen, action, settings tab, setting, dialog and menu item it and its plugins
 * registered (Molly turns them into the app's surface with `surfaceFromSearch`, so its menus reach everything with no
 * hand-written list); `run(kind, id)` opens a dialog / settings / action in the app; `routes` are the relative paths
 * its screens call on its own server (Molly sends them there, below).
 *
 * Each app's screens are Molly views `<app>/<screen>` (deep links `#/console/plan`), and its surface is registered with
 * One shell (capability `axf.shell@1`) so the one menu, Go to anything, voice and the API reach it.
 */

export interface SurfaceModule {
  mountSurface(el: HTMLElement, view: string, ctx: { host: string; onNavigate?: (view: string) => void }): { show(view: string): void; unmount(): void };
  searchEntries(): unknown[];
  screens(): { id: string; title: string; icon?: string }[];
  run(kind: string, id: string, parent?: string): boolean;
  subscribe(f: () => void): () => void;
  routes?: readonly string[];
}

type LoadState = { state: 'loading' } | { state: 'ready'; mod: SurfaceModule } | { state: 'failed'; error: string };

const SHELL_SERVICE = 'axf.shell@1';
interface ShellLike { register(surface: unknown, open?: (item: SurfaceItem, target: OpenTarget) => boolean): () => void }

const loads = new Map<string, LoadState>();
/** The address Molly opened on (`#/console/plan`): its app's screen is shown once that app has loaded. */
const startHash = typeof location !== 'undefined' ? location.hash.replace(/^#\/?/, '') : '';
const listeners = new Set<() => void>();
let rev = 0;
const changed = () => { rev++; listeners.forEach((f) => f()); };
export const onNative = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const nativeRev = () => rev;
export const useNativeRev = () => useSyncExternalStore(onNative, nativeRev, nativeRev);

/** The module address for an app: its own, or a local override for development (`molly.surface.<app>` in this browser,
 *  https or localhost only). */
export function surfaceUrl(app: MollyApp): string | null {
  let override: string | null = null;
  try { override = localStorage.getItem(`molly.surface.${app.id}`); } catch { /* storage unavailable */ }
  if (override) {
    try { const u = new URL(override); if (u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1') return u.toString(); } catch { /* ignored */ }
  }
  return app.surface ?? null;
}

/** Apps that mount natively (they have a surface module). */
export const nativeApps = (): MollyApp[] => MOLLY_APPS.filter((a) => !!surfaceUrl(a));
export const isNative = (id: string): boolean => { const a = mollyApp(id); return !!a && !!surfaceUrl(a); };
export const nativeState = (id: string): LoadState | null => loads.get(id) ?? null;

/* ---------- requests: an app's relative paths go to its own server ---------- */

const routeTable: { prefix: string; origin: string }[] = [];
let routed = false;

function routeFor(url: URL): string | null {
  if (url.origin !== location.origin) return null;
  let best: { prefix: string; origin: string } | null = null;
  for (const r of routeTable) if (url.pathname.startsWith(r.prefix) && (!best || r.prefix.length > best.prefix.length)) best = r;
  return best ? best.origin + url.pathname + url.search : null;
}

/** Send `prefixes` (relative paths an app's screens call) to `origin`. Molly itself serves no API, so nothing of its own
 *  is redirected; the longest prefix wins when two apps share one (`/api/ai/` beats `/api/`). */
export function addRoutes(prefixes: readonly string[], origin: string): void {
  for (const p of prefixes) if (typeof p === 'string' && p.startsWith('/') && !routeTable.some((r) => r.prefix === p)) routeTable.push({ prefix: p, origin });
  if (routed) return;
  routed = true;
  const fetch0 = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let to: string | null = null;
    try { to = routeFor(new URL(raw, location.href)); } catch { to = null; }
    if (!to) return fetch0(input, init);
    return input instanceof Request ? fetch0(new Request(to, input), init) : fetch0(to, init);
  };
  const ES = window.EventSource;
  if (ES) {
    window.EventSource = class extends ES {
      constructor(url: string | URL, opts?: EventSourceInit) {
        let to: string | null = null;
        try { to = routeFor(new URL(String(url), location.href)); } catch { to = null; }
        super(to ?? url, opts);
      }
    } as typeof EventSource;
  }
}

/* ---------- loading ---------- */

function linkStyles(moduleUrl: string, app: string) {
  if (document.querySelector(`link[data-molly-surface="${app}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = moduleUrl.replace(/\.js(\?.*)?$/, '.css$1');
  l.dataset.mollySurface = app;
  document.head.appendChild(l);
}

/** Import an app's surface module once; the result is shared by every mount. */
export function loadNative(rt: AxfRuntime, app: MollyApp): void {
  if (loads.has(app.id)) return;
  const url = surfaceUrl(app);
  if (!url) return;
  loads.set(app.id, { state: 'loading' });
  changed();
  linkStyles(url, app.id);
  import(/* @vite-ignore */ url)
    .then((m: Partial<SurfaceModule>) => {
      if (typeof m.mountSurface !== 'function' || typeof m.searchEntries !== 'function') throw new Error('not a shell-surface@1 module (no mountSurface)');
      const mod = m as SurfaceModule;
      addRoutes(mod.routes ?? [], new URL(url).origin);
      loads.set(app.id, { state: 'ready', mod });
      registerWithShell(rt, app, mod, url);
      changed();
      // a deep link into one of its screens waited for it (the view did not exist when Molly started)
      if (startHash.startsWith(`${app.id}/`) && rt.getState().view === app.id) rt.navigate(startHash);
      mod.subscribe(() => { registerWithShell(rt, app, mod, url); changed(); });
    })
    .catch((e: unknown) => {
      loads.set(app.id, { state: 'failed', error: e instanceof Error ? e.message : String(e) });
      rt.terminal.warn('molly', `${app.label} could not load in Molly: ${e instanceof Error ? e.message : String(e)}`);
      changed();
    });
}

/** Load every app that mounts natively (Molly's menus need their surfaces at once). */
export function loadAllNative(rt: AxfRuntime): void { for (const a of nativeApps()) loadNative(rt, a); }

const removers = new Map<string, () => void>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();
function registerWithShell(rt: AxfRuntime, app: MollyApp, mod: SurfaceModule, url: string) {
  // a surface changes in bursts (plugins load one after another): register once things settle
  clearTimeout(pending.get(app.id));
  pending.set(app.id, setTimeout(() => {
    pending.delete(app.id);
    const shell = mollyService<ShellLike>(SHELL_SERVICE);
    if (!shell) return;
    const surface = surfaceFromSearch(
      { id: app.id, label: app.label, icon: app.icon, description: app.description, url: app.url },
      { kind: 'native', module: url, api: new URL(url).origin, auth: app.auth ?? 'none' },
      mod.searchEntries() as Parameters<typeof surfaceFromSearch>[2],
    );
    if (!surface) return;
    removers.get(app.id)?.();
    removers.set(app.id, shell.register(surface, (item) => openNative(rt, app.id, item)));
  }, 150));
}

/** Open one of an app's items: a screen becomes Molly's view `<app>/<screen>`; anything else runs in the app. */
export function openNative(rt: AxfRuntime, app: string, item: Pick<SurfaceItem, 'kind' | 'id' | 'parent'>): boolean {
  const s = loads.get(app);
  if (item.kind === 'screen') { rt.navigate(item.id === 'home' ? app : `${app}/${item.id}`); return true; }
  if (s?.state !== 'ready') return false;
  return s.mod.run(item.kind, item.id, item.parent);
}

/** Molly views for every native app's screens (`<app>/<screen>`). */
export function nativeViews(): ViewMap {
  const out: ViewMap = {};
  for (const a of nativeApps()) {
    const s = loads.get(a.id);
    if (s?.state !== 'ready') continue;
    for (const sc of s.mod.screens()) if (sc.id !== 'home') out[`${a.id}/${sc.id}`] = { title: `${a.label}: ${sc.title}`, icon: sc.icon ?? a.icon, render: () => <NativeView app={a.id} view={sc.id} /> };
  }
  return out;
}

/** One of an app's screens, mounted natively in this element. */
export function NativeView({ app, view = 'home' }: { app: string; view?: string }) {
  const rt = useRuntime();
  useNativeRev();
  const a = mollyApp(app);
  const ref = useRef<HTMLDivElement>(null);
  const handle = useRef<{ show(view: string): void; unmount(): void } | null>(null);
  const [, bump] = useState(0);
  const s = loads.get(app);
  useEffect(() => { if (a) loadNative(rt, a); }, [rt, a]);
  useEffect(() => {
    if (s?.state !== 'ready' || !ref.current) return;
    const h = s.mod.mountSurface(ref.current, view, { host: 'molly', onNavigate: (v) => rt.navigate(v === 'home' ? app : `${app}/${v}`) });
    handle.current = h;
    bump((n) => n + 1);
    return () => { h.unmount(); handle.current = null; };
    // the view changes through show(), not a new mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.state, app, rt]);
  useEffect(() => { handle.current?.show(view); }, [view]);
  if (!a) return null;
  if (!s || s.state === 'loading') return <div className="molly-native" data-app={app} data-state="loading" aria-busy="true"><Note tone="info" icon={a.icon}>Loading {a.label}…</Note></div>;
  if (s.state === 'failed') {
    return (
      <div className="molly-native" data-app={app} data-state="failed">
        <Note tone="warning">{a.label} could not load in Molly ({s.error}).</Note>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={() => { loads.delete(app); changed(); loadNative(rt, a); }}>Try again</Button>
          <Button icon="external" onClick={() => window.open(a.url, '_blank', 'noopener')}>Open on its own</Button>
        </div>
      </div>
    );
  }
  return <div ref={ref} className="molly-native" data-app={app} data-view={view} data-state="ready" />;
}

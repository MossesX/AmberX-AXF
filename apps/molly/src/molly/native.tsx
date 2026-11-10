import { Component, useEffect, useRef, useState, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react';
import { Button, Note, useRuntime, type ViewMap } from '../axf/react';
import type { AxfRuntime } from '../axf/core';
import { surfaceFromSearch, type SurfaceItem } from '../axf/core/engines/shell-surface';
import type { OpenTarget } from '../axf/core/engines/xlayout';
import { MOLLY_APPS, mollyApp, type MollyApp } from './apps';
import { mollyHooks, mollyService } from './host';

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
  /** hand Molly's context over at load (the `host:<spec>` bridge: the app's remote commands reach Molly's actions) */
  connect?(ctx: { host: string; onNavigate?: (view: string) => void; dispatch?: (spec: string) => boolean }): void;
  routes?: readonly string[];
  /** In-process modules only (a Molly plugin that is an app's module, `provideModule`): render a screen as part of
   *  Molly's own React tree instead of mounting into an element. */
  render?(view: string): ReactNode;
}

/* ---------- Molly modules (build convert-every-app-into-a-molly-module) ----------
 * Every app is a module: its manifest is its MOLLY_APPS entry (id, label, icon, own address, routes, auth) plus the
 * surface it brings (screens, actions, settings, dialogs: `searchEntries`). A module comes either from the app's own
 * server (`surface`, an ES module) or in-process from a Molly plugin (`provideModule`), and each one is fenced:
 *   - it can be switched off (`molly.modules.<app>.enabled`); Molly then lists it and opens it on its own;
 *   - its address can be pointed elsewhere (`molly.modules.<app>.surface`, https or localhost);
 *   - a load that hangs fails after MODULE_LOAD_TIMEOUT_MS;
 *   - every call into it (screens, searchEntries, run, subscribe, mountSurface, render) is guarded, and its screen
 *     renders inside an error boundary: a module that throws is marked failed (Try again / Open on its own) and the
 *     rest of Molly keeps running. */

export const MODULE_LOAD_TIMEOUT_MS = 20000;
export const moduleSettingKeys = (app: string) => ({ enabled: `molly.modules.${app}.enabled`, surface: `molly.modules.${app}.surface` });

let settingsReader: { get(k: string): unknown } | null = null;
/** Molly hands its settings in at start (main.tsx) so module switches and addresses are per-device settings. */
export function attachModuleSettings(rt: { settings: { get(k: string): unknown; onChange(k: string, f: () => void): () => void } }): void {
  settingsReader = rt.settings;
  for (const a of MOLLY_APPS) for (const k of Object.values(moduleSettingKeys(a.id))) rt.settings.onChange(k, () => changed());
}
const setting = (k: string): unknown => { try { return settingsReader?.get(k); } catch { return undefined; } };
/** A module is on unless switched off. */
export const moduleEnabled = (id: string): boolean => setting(moduleSettingKeys(id).enabled) !== false;

const local = new Map<string, { owner: string; mod: SurfaceModule }>();
/** A Molly plugin provides an app's module in-process (an app whose screens Molly draws itself, such as Expenses). */
export function provideModule(owner: string, app: string, mod: SurfaceModule): () => void {
  local.set(app, { owner, mod });
  loads.delete(app);
  changed();
  return () => { if (local.get(app)?.owner === owner) { local.delete(app); loads.delete(app); removers.get(app)?.(); removers.delete(app); changed(); } };
}
export const hasLocalModule = (app: string): boolean => local.has(app);

/** Mark a module failed (it threw); Molly shows its failure card and keeps going. */
let lastRt: AxfRuntime | null = null;
function fail(rt: AxfRuntime | null, app: string, e: unknown): void {
  rt ??= lastRt;
  const error = e instanceof Error ? e.message : String(e);
  if (loads.get(app)?.state === 'failed') return;
  loads.set(app, { state: 'failed', error });
  const a = mollyApp(app);
  rt?.terminal.warn('molly', `${a?.label ?? app} stopped in Molly: ${error}`);
  queueMicrotask(changed);
}
/** Run one call into a module; if it throws, the module is marked failed and `fallback` comes back. */
function guard<T>(rt: AxfRuntime | null, app: string, f: () => T, fallback: T): T {
  try { return f(); } catch (e) { fail(rt, app, e); return fallback; }
}

/** What Molly hands each app: its host id, where its own navigation goes, and Molly's actions (`host:<spec>`). */
const contextFor = (rt: AxfRuntime, app: string) => ({
  host: 'molly',
  onNavigate: (v: string) => rt.navigate(v === 'home' ? app : `${app}/${v}`),
  dispatch: (spec: string) => rt.dispatch(spec),
});

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
  const set = setting(moduleSettingKeys(app.id).surface);
  if (typeof set === 'string' && set.trim()) override = set.trim();
  else try { override = localStorage.getItem(`molly.surface.${app.id}`); } catch { /* storage unavailable */ }
  if (override) {
    try { const u = new URL(override); if (u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1') return u.toString(); } catch { /* ignored */ }
  }
  return app.surface ?? null;
}

/** Apps that mount natively (they have a surface module). */
export const nativeApps = (): MollyApp[] => MOLLY_APPS.filter((a) => isNative(a.id));
/** Mounts inside Molly: switched on, and a module from its server or from a Molly plugin. */
export const isNative = (id: string): boolean => { const a = mollyApp(id); return !!a && moduleEnabled(a.id) && (local.has(a.id) || !!surfaceUrl(a)); };
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
  lastRt = rt;
  if (loads.has(app.id) || !moduleEnabled(app.id)) return;
  const own = local.get(app.id)?.mod;
  const url = own ? null : surfaceUrl(app);
  if (!own && !url) return;
  loads.set(app.id, { state: 'loading' });
  changed();
  const ready = (mod: SurfaceModule, origin: string) => {
    if (loads.get(app.id)?.state !== 'loading') return; // timed out, reloaded or switched off meanwhile
    if (url) addRoutes(guard(rt, app.id, () => mod.routes ?? [], []), origin);
    guard(rt, app.id, () => mod.connect?.(contextFor(rt, app.id)), undefined);
    if (loads.get(app.id)?.state !== 'loading') return;
    loads.set(app.id, { state: 'ready', mod });
    registerWithShell(rt, app, mod, origin);
    changed();
    // a deep link into one of its screens waited for it (the view did not exist when Molly started)
    if (startHash.startsWith(`${app.id}/`) && rt.getState().view === app.id) rt.navigate(startHash);
    guard(rt, app.id, () => mod.subscribe(() => { if (loads.get(app.id)?.state === 'ready') { registerWithShell(rt, app, mod, origin); changed(); } }), () => {});
  };
  if (own) { ready(own, location.origin); return; }
  linkStyles(url!, app.id);
  const timer = setTimeout(() => { if (loads.get(app.id)?.state === 'loading') fail(rt, app.id, new Error(`no answer in ${MODULE_LOAD_TIMEOUT_MS / 1000} s`)); }, MODULE_LOAD_TIMEOUT_MS);
  import(/* @vite-ignore */ url!)
    .then((m: Partial<SurfaceModule>) => {
      if (typeof m.mountSurface !== 'function' || typeof m.searchEntries !== 'function') throw new Error('not a shell-surface@1 module (no mountSurface)');
      ready(m as SurfaceModule, new URL(url!).origin);
    })
    .catch((e: unknown) => fail(rt, app.id, e))
    .finally(() => clearTimeout(timer));
}

/** Load every app that mounts natively (Molly's menus need their surfaces at once). */
export function loadAllNative(rt: AxfRuntime): void { for (const a of nativeApps()) loadNative(rt, a); }

const removers = new Map<string, () => void>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();
function registerWithShell(rt: AxfRuntime, app: MollyApp, mod: SurfaceModule, origin: string) {
  // a surface changes in bursts (plugins load one after another): register once things settle
  clearTimeout(pending.get(app.id));
  pending.set(app.id, setTimeout(() => {
    pending.delete(app.id);
    const shell = mollyService<ShellLike>(SHELL_SERVICE);
    if (!shell) return;
    const surface = surfaceFromSearch(
      { id: app.id, label: app.label, icon: app.icon, description: app.description, url: app.url },
      // module: the app's module id (shell-surface@1 keeps ids, not addresses); api: the server it was loaded from
      { kind: 'native', module: `@axf-app/${app.id}`, api: origin, auth: app.auth ?? 'none' },
      guard(rt, app.id, () => mod.searchEntries(), []) as Parameters<typeof surfaceFromSearch>[2],
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
  return guard(rt, app, () => s.mod.run(item.kind, item.id, item.parent), false);
}

/** One of an app's screens as Molly's main area shows it: through the layout plugin when there is one (`main` hook, so
 *  the IDE dock and toolbars stay), else on its own. */
function screenView(app: string, screen: string) {
  const main = mollyHooks().main;
  return main ? main(`${app}/${screen}`) : <NativeView app={app} view={screen} />;
}

/** Molly views for every native app's screens (`<app>/<screen>`). */
export function nativeViews(): ViewMap {
  const out: ViewMap = {};
  for (const a of nativeApps()) {
    const s = loads.get(a.id);
    if (s?.state !== 'ready') continue;
    for (const sc of guard(null, a.id, () => s.mod.screens(), [])) if (sc.id !== 'home') out[`${a.id}/${sc.id}`] = { title: `${a.label}: ${sc.title}`, icon: sc.icon ?? a.icon, render: () => screenView(a.id, sc.id) };
  }
  return out;
}

/** One of an app's screens, mounted natively in this element. */
export function NativeView({ app, view = 'home', quiet = false }: { app: string; view?: string; quiet?: boolean }) {
  const rt = useRuntime();
  useNativeRev();
  const a = mollyApp(app);
  const ref = useRef<HTMLDivElement>(null);
  const handle = useRef<{ show(view: string): void; unmount(): void } | null>(null);
  const [, bump] = useState(0);
  const s = loads.get(app);
  useEffect(() => { if (a) loadNative(rt, a); }, [rt, a]);
  const inProcess = s?.state === 'ready' && typeof s.mod.render === 'function';
  useEffect(() => {
    if (s?.state !== 'ready' || inProcess || !ref.current) return;
    const el = ref.current;
    const h = guard(rt, app, () => s.mod.mountSurface(el, view, contextFor(rt, app)), null);
    if (!h) return;
    handle.current = h;
    bump((n) => n + 1);
    return () => { guard(rt, app, () => h.unmount(), undefined); handle.current = null; };
    // the view changes through show(), not a new mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.state, app, rt]);
  useEffect(() => { const h = handle.current; if (h) guard(rt, app, () => h.show(view), undefined); }, [view, rt, app]);
  if (!a) return null;
  if (!isNative(app)) return quiet ? null : <NotNative app={a} />;
  if (quiet && s?.state !== 'ready') return null;
  if (!s || s.state === 'loading') return <div className="molly-native" data-app={app} data-state="loading" aria-busy="true"><Note tone="info" icon={a.icon}>Loading {a.label}…</Note></div>;
  if (s.state === 'failed') {
    return (
      <div className="molly-native" data-app={app} data-state="failed">
        <Note tone="warning">{a.label} could not load in Molly ({s.error}).</Note>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={() => reloadNative(rt, app)}>Try again</Button>
          <Button icon="external" onClick={() => window.open(a.url, '_blank', 'noopener')}>Open on its own</Button>
        </div>
      </div>
    );
  }
  if (inProcess) {
    return (
      <div className="molly-native" data-app={app} data-view={view} data-state="ready">
        <ModuleBoundary app={app} onError={(e) => fail(rt, app, e)}>{s.mod.render!(view)}</ModuleBoundary>
      </div>
    );
  }
  return (
    <ModuleBoundary app={app} onError={(e) => fail(rt, app, e)}>
      <div ref={ref} className="molly-native" data-app={app} data-view={view} data-state="ready" />
    </ModuleBoundary>
  );
}

/** A module's screen renders inside this fence: if it throws, only that module stops (its failure card shows). */
class ModuleBoundary extends Component<{ app: string; onError: (e: unknown) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown, _info: ErrorInfo) { this.props.onError(e); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** Load an app again (Molly's "Reload this app"): its screens unmount and mount again. */
export function reloadNative(rt: AxfRuntime, id: string): void {
  const a = mollyApp(id);
  if (!a) return;
  loads.delete(id);
  clearTimeout(pending.get(id));
  changed();
  loadNative(rt, a);
}

/** Switch a module off (it unmounts, leaves Molly's menus and opens on its own) or on (it loads again). */
export function unloadNative(id: string): void {
  loads.delete(id);
  clearTimeout(pending.get(id));
  removers.get(id)?.();
  removers.delete(id);
  changed();
}

/** One module as the Modules screen and `molly.modules.list` read it. */
export interface ModuleStatus {
  id: string; label: string; icon: string; url: string; description: string;
  /** where it comes from: the app's own server, a Molly plugin, or nowhere yet */
  source: 'server' | 'plugin' | 'none';
  enabled: boolean;
  state: 'loading' | 'ready' | 'failed' | 'off' | 'not-native' | 'not-loaded';
  error?: string;
  surface: string | null;
  surfaceOverridden: boolean;
  auth: string;
  screens: { id: string; title: string }[];
}

export function moduleStatuses(): ModuleStatus[] {
  return MOLLY_APPS.map((a) => {
    const s = loads.get(a.id);
    const source: ModuleStatus['source'] = local.has(a.id) ? 'plugin' : surfaceUrl(a) ? 'server' : 'none';
    const enabled = moduleEnabled(a.id);
    const state: ModuleStatus['state'] = !enabled ? 'off' : source === 'none' ? 'not-native' : s?.state ?? 'not-loaded';
    const set = setting(moduleSettingKeys(a.id).surface);
    return {
      id: a.id, label: a.label, icon: a.icon, url: a.url, description: a.description, source, enabled, state,
      ...(s?.state === 'failed' ? { error: s.error } : {}),
      surface: source === 'plugin' ? `plugin:${local.get(a.id)!.owner}` : surfaceUrl(a),
      surfaceOverridden: typeof set === 'string' && !!set.trim(),
      auth: a.auth ?? 'none',
      screens: s?.state === 'ready' ? guard(null, a.id, () => s.mod.screens(), []).map((x) => ({ id: x.id, title: x.title })) : [],
    };
  });
}

/** An app that is not mounted in Molly (switched off, or no module yet): listed, and opens on its own. Never a frame. */
export function NotNative({ app }: { app: MollyApp }) {
  const rt = useRuntime();
  const off = !moduleEnabled(app.id);
  return (
    <div className="molly-native" data-app={app.id} data-state={off ? 'off' : 'not-native'}>
      <Note tone="info" icon={app.icon}>{off ? `${app.label} is switched off in Molly (Settings → Modules). It still opens on its own.` : `${app.label} does not run inside Molly yet. It opens on its own, at its own address.`}</Note>
      <div className="fx-row fx-row--wrap">
        {off && <Button tone="primary" icon="zap" onClick={() => rt.dispatch(`molly.modules.enable:${app.id}`)}>Switch {app.label} on</Button>}
        <Button tone={off ? 'neutral' : 'primary'} icon="external" onClick={() => window.open(app.url, '_blank', 'noopener')}>Open {app.label} on its own</Button>
      </div>
    </div>
  );
}

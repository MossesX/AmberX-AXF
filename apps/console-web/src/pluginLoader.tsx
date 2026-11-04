/**
 * Console plugin lazy loader (plugin-lazy@1; Brett, Nov 3 2026: "The console gets slower as more plugins are installed").
 *
 * Every plugin's web part is its own chunk (a non-eager Vite glob), loaded the first time it's needed. Until then the
 * shell runs a stand-in built from the plugin's cached *shape*: what its library contributed the last time it loaded
 * (nav, views, dialogs, settings tabs and groups, menus, help, the actions it registered), with every function replaced
 * by one that loads the plugin and then runs the real thing. So menus, icons, routes, settings tabs and commands are all
 * there at startup, and opening any of them loads that plugin only. A plugin whose shape isn't known yet (first visit,
 * or its code changed: the content hash from `virtual:axf-plugin-hashes` differs) loads once at startup to learn it.
 *
 * Banners load first, in parallel (banner plugins are found by `banners` or by painting the banner in `register`), then
 * core plugins, pins and the most-used ones (src/lazyEngine.ts), then idle preloads. Loaded on-open plugins beyond the
 * cache size go back to their stand-in, least recently used first (the module stays in the browser, so it comes back
 * at once). Settings: Settings → Plugins → Plugin Manager → Lazy loader (config stored by the plugin-manager server
 * part, cached here so startup never waits for it).
 *
 * Dev: each plugin's web/index.tsx is its own HMR boundary (scripts/plugin-chunks.mjs); an edit swaps that plugin only.
 */
import { createElement, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import hashes from 'virtual:axf-plugin-hashes';
import type { AxfRuntime } from './axf/core';
import type { ActionMeta } from './axf/core/engines/actions';
import type { AxfWebLibrary } from './axf/react/library';
import { Button, Note } from './axf/react';
import { authHeaders } from './axf/libs/apiclient';
import { consoleTokens } from './api';
import { CORE_PLUGINS, evictions, KNOWN_BANNERS, idlePicks, LAZY_DEFAULTS, modeOf, normalizeLazyConfig, startupList, touch, type LazyConfig, type LazyMode, type StartReason, type UsageStat } from './lazyEngine';

type WebModule = { plugin?: AxfWebLibrary };

const loaders = import.meta.glob<WebModule>(['../plugins/*/web/index.tsx', '!../plugins/_*/**']);
const folderOf = (path: string) => path.split('/')[2] ?? '';
const importers = new Map(Object.entries(loaders).map(([p, f]) => [folderOf(p), f]));

export const HOT_EVENT = 'axf:plugin-hot';
const CHUNK_CACHE = 'axf-plugin-chunks';
const SERVICE_WORKER = '/alerts-sw.js';
const KEYS = { shapes: 'axf.lazy.shapes', stats: 'axf.lazy.stats', config: 'axf.lazy.config', enabled: 'axf.lazy.enabled' } as const;

/* ---------------- shapes: a library with its functions taken out ---------------- */

type Dry = null | boolean | number | string | Dry[] | { [k: string]: Dry } | { $fn: 1 };

export interface PluginShape {
  hash: string;
  lib: Dry;
  actions: { id: string; meta: ActionMeta }[];
  banner: boolean;
}

class NotSerializable extends Error {}

/** A library → plain data; functions become `{ $fn: 1 }` (their path says what they were). Throws on anything else. */
export function dehydrate(v: unknown, path: string[] = []): Dry {
  if (v === null || typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'function') return { $fn: 1 };
  if (Array.isArray(v)) return v.map((x, i) => dehydrate(x === undefined ? null : x, [...path, String(i)]));
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    if ((proto !== Object.prototype && proto !== null) || '$$typeof' in (v as object)) throw new NotSerializable(`${path.join('.') || 'library'} is not plain data`);
    const out: Record<string, Dry> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x === undefined || (path.length === 0 && k === 'register')) continue;
      out[k] = dehydrate(x, [...path, k]);
    }
    return out;
  }
  throw new NotSerializable(`${path.join('.')} is ${typeof v}`);
}

const isFn = (d: Dry): d is { $fn: 1 } => !!d && typeof d === 'object' && !Array.isArray(d) && (d as { $fn?: unknown }).$fn === 1 && Object.keys(d).length === 1;
/** Render functions (they return UI) get a placeholder that loads the plugin; everything else just starts the load. */
const isRender = (path: string[]) => path[path.length - 1] === 'render' || (path[0] === 'tabs' && path.length === 2);

function hydrate(d: Dry, folder: string, path: string[] = []): unknown {
  if (isFn(d)) {
    if (isRender(path)) return (...args: unknown[]) => createElement(LazyCall, { folder, path, args });
    if (path[0] === 'appMenuProviders') return () => { void loader.request(folder); return []; };
    return () => { void loader.request(folder); return undefined; };
  }
  if (Array.isArray(d)) return d.map((x, i) => hydrate(x, folder, [...path, String(i)]));
  if (d && typeof d === 'object') return Object.fromEntries(Object.entries(d).map(([k, x]) => [k, hydrate(x, folder, [...path, k])]));
  return d;
}

function at(lib: unknown, path: string[]): unknown {
  let v: unknown = lib;
  for (const k of path) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
  return v;
}

/* ---------------- storage ---------------- */

function read<T>(key: string, d: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : d; } catch { return d; }
}
function write(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* full or blocked: the loader still works, it just learns again */ }
}

/* ---------------- the loader ---------------- */

export type PluginLoadState = 'loaded' | 'cached' | 'loading' | 'not-loaded' | 'error' | 'disabled';

export interface PluginLoadRow {
  folder: string;
  state: PluginLoadState;
  mode: LazyMode;
  core: boolean;
  banner: boolean;
  /** why it loaded at startup (banner / core / pin / start / used / learn), if it did */
  startup?: StartReason;
  /** its own chunk (JS + CSS), bytes; null when unknown (dev server) */
  bytes: number | null;
  loadMs: number | null;
  lastUsed: number | null;
  uses: number;
  error?: string;
  /** why it can't stand in until loaded (its library isn't plain data), if so */
  eager?: string;
}

interface ChunkInfo { file: string; bytes: number; css: string[]; cssBytes: number }

class PluginLoader {
  /** loaded modules' libraries (stay in memory once loaded) */
  private libs = new Map<string, AxfWebLibrary>();
  /** loaded plugins the shell runs for real right now (the rest run their stand-in) */
  private installed = new Set<string>();
  private pending = new Map<string, Promise<void>>();
  private errors = new Map<string, string>();
  private loadMs = new Map<string, number>();
  private shapes: Record<string, PluginShape> = read(KEYS.shapes, {});
  private stats: Record<string, UsageStat> = read(KEYS.stats, {});
  private eagerWhy = new Map<string, string>();
  private stubs = new Map<string, AxfWebLibrary>();
  private reasons = new Map<string, StartReason>();
  private waiters = new Map<string, (() => void)[]>();
  /** how many of each plugin's pages / dialogs / slots / banners are mounted right now */
  private onScreen = new Map<string, number>();
  /** plugins whose real register ran since they were last a stand-in */
  private live = new Set<string>();
  private recent = new Map<string, number>();
  private chunks: Record<string, ChunkInfo> | null = null;
  private listeners = new Set<() => void>();
  private ver = 0;
  private bumpQueued = false;
  config: LazyConfig = normalizeLazyConfig(read(KEYS.config, LAZY_DEFAULTS));
  /** startup bundle info from the build (`axf-plugin-chunks.json`), null in dev */
  startup: { file: string; bytes: number; css: number } | null = null;
  bootedAt = 0;
  readyAt = 0;

  readonly folders = [...importers.keys()];

  /* --- store for React --- */
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  version = () => this.ver;
  private bump() {
    if (this.bumpQueued) return;
    this.bumpQueued = true;
    queueMicrotask(() => { this.bumpQueued = false; this.ver++; for (const f of [...this.listeners]) f(); });
  }

  /* --- what the shell installs --- */

  /** The library to install for a folder: the real one while installed, else its stand-in, else undefined (unknown yet). */
  library(folder: string): AxfWebLibrary | undefined {
    if (this.installed.has(folder)) return this.libs.get(folder);
    const shape = this.freshShape(folder);
    if (!shape) return undefined;
    let s = this.stubs.get(folder);
    if (!s) { s = this.stub(folder, shape); this.stubs.set(folder, s); }
    return s;
  }

  /** A plugin switched off in the lazy loader: no menus, no views; its commands say it's off. */
  disabledLibrary(folder: string, label: string): AxfWebLibrary | undefined {
    const shape = this.shapes[folder];
    const lib = (shape?.lib ?? {}) as { id?: string; version?: string };
    if (!lib.id) return undefined;
    return {
      id: lib.id, label, version: lib.version ?? '',
      register: (rt) => {
        for (const a of shape!.actions) rt.actions.register(a.id, () => rt.toast(`${label} is switched off in the lazy loader (Settings → Plugins → Plugin Manager → Lazy loader).`, 'warning', 'Plugin disabled'), { ...a.meta, searchable: false });
      },
    };
  }

  isInstalled(folder: string) { return this.installed.has(folder); }
  isBanner(folder: string) { return KNOWN_BANNERS.includes(folder) || !!this.shapes[folder]?.banner; }
  problem(folder: string) { return this.errors.get(folder); }
  private freshShape(folder: string): PluginShape | undefined {
    const s = this.shapes[folder];
    return s && s.hash === (hashes[folder] ?? '') && !this.eagerWhy.has(folder) ? s : undefined;
  }
  /** Folders whose stand-in can't be built (never loaded, changed since, or not plain data): they load at startup. */
  unknown(folders: string[]) { return folders.filter((f) => !this.installed.has(f) && !this.freshShape(f)); }

  private stub(folder: string, shape: PluginShape): AxfWebLibrary {
    const lib = hydrate(shape.lib, folder) as AxfWebLibrary;
    lib.register = (rt: AxfRuntime) => {
      this.live.delete(folder);
      for (const a of shape.actions) {
        rt.actions.register(a.id, (args, ctx) => {
          const spec = [a.id, ...args].join(':');
          void this.request(folder).then(() => this.whenInstalled(folder)).then(() => {
            if (rt.actions.get(a.id)?.fn === stubFns.get(`${folder}:${a.id}`)) rt.toast(`${a.meta.label} isn't available any more.`, 'warning', 'Unknown action');
            else rt.dispatch(spec, ctx.payload ? { payload: ctx.payload } : {});
          }).catch(() => undefined);
        }, a.meta);
        stubFns.set(`${folder}:${a.id}`, rt.actions.get(a.id)?.fn);
      }
    };
    return lib;
  }

  /** Wrap a real library so its register is watched: which actions it adds and whether it paints the banner. */
  private watched(folder: string, raw: AxfWebLibrary): AxfWebLibrary {
    const self = this;
    return {
      ...raw,
      register(rt: AxfRuntime) {
        let banner = !!raw.banners?.length;
        const r = rt as unknown as Record<string, unknown>;
        const spies = ['setBadge', 'attachToBanner'].map((name) => {
          const own = Object.prototype.hasOwnProperty.call(r, name);
          const orig = r[name] as (...a: unknown[]) => unknown;
          r[name] = (...a: unknown[]) => { banner = true; return orig.apply(rt, a); };
          return () => { if (own) r[name] = orig; else delete r[name]; };
        });
        try { raw.register?.call(raw, rt); } finally { for (const undo of spies) undo(); }
        self.live.add(folder);
        self.learn(folder, raw, rt, banner);
      },
    };
  }

  private learn(folder: string, raw: AxfWebLibrary, rt: AxfRuntime, banner: boolean) {
    const actions = rt.actions.list().filter((a) => a.meta.module === raw.id).map((a) => ({ id: a.id, meta: { ...a.meta } }));
    let lib: Dry;
    try { lib = dehydrate(raw); this.eagerWhy.delete(folder); } catch (e) {
      this.eagerWhy.set(folder, (e as Error).message);
      return;
    }
    const prev = this.shapes[folder];
    const next: PluginShape = { hash: hashes[folder] ?? '', lib, actions, banner: banner || !!prev?.banner && prev.hash === hashes[folder] };
    if (prev && JSON.stringify(prev) === JSON.stringify(next)) return;
    this.shapes = { ...this.shapes, [folder]: next };
    this.stubs.delete(folder);
    write(KEYS.shapes, this.shapes);
  }

  /** Load a plugin's chunk (once) and install it for real. */
  request(folder: string, why?: StartReason): Promise<void> {
    if (why && !this.reasons.has(folder)) this.reasons.set(folder, why);
    if (this.installed.has(folder)) { this.lastSeen(folder); return Promise.resolve(); }
    if (this.libs.has(folder)) { this.install(folder); return Promise.resolve(); }
    const busy = this.pending.get(folder);
    if (busy) return busy;
    const imp = importers.get(folder);
    if (!imp) return Promise.reject(new Error(`no web part for ${folder}`));
    const t0 = performance.now();
    this.errors.delete(folder);
    const p = imp().then((m) => {
      this.loadMs.set(folder, Math.round(performance.now() - t0));
      this.accept(folder, m);
      if (!this.errors.has(folder)) { this.install(folder); void this.keepOffline(folder); }
    }, (e: unknown) => {
      this.errors.set(folder, `couldn't load: ${(e as Error)?.message ?? e}`);
    }).finally(() => { this.pending.delete(folder); this.bump(); });
    this.pending.set(folder, p);
    this.bump();
    return p;
  }

  /** A loaded module (or a hot update): check it, keep its library. */
  private accept(folder: string, m: WebModule) {
    const lib = m?.plugin;
    if (!lib || typeof lib !== 'object') { this.errors.set(folder, 'web/index.tsx does not export `plugin`'); return; }
    const help = helpFor(folder);
    if (help && !lib.help) lib.help = help;
    this.libs.set(folder, this.watched(folder, lib));
    this.errors.delete(folder);
  }

  /** Raw library (unwrapped) of a loaded plugin, for the manifest id check. */
  loadedId(folder: string): string | undefined { return this.libs.get(folder)?.id; }

  private install(folder: string) {
    this.installed.add(folder);
    this.lastSeen(folder);
    this.evict();
    this.bump();
  }

  private lastSeen(folder: string) { this.recent.set(folder, Date.now()); }

  private evict() {
    const keep = new Set<string>([...this.onScreen.keys(), ...[...this.reasons.entries()].filter(([, r]) => r !== 'used' && r !== 'learn').map(([f]) => f)]);
    for (const f of this.installed) if (this.shapes[f]?.banner || this.eagerWhy.has(f) || !this.freshShape(f)) keep.add(f);
    const out = evictions({ installed: [...this.installed], cfg: this.config, lastUsed: Object.fromEntries(this.recent), keep });
    for (const f of out) this.installed.delete(f);
  }

  /** A use of a plugin (its page, dialog, tab or settings panel opened). */
  used(folder: string) {
    this.stats = { ...this.stats, [folder]: touch(this.stats[folder], Date.now()) };
    this.recent.set(folder, Date.now());
    write(KEYS.stats, this.stats);
    this.report();
  }
  mounted(folder: string, on: boolean) {
    const n = (this.onScreen.get(folder) ?? 0) + (on ? 1 : -1);
    if (n > 0) this.onScreen.set(folder, n); else this.onScreen.delete(folder);
  }

  /** Called by the shell after it installed libraries: resolves actions waiting for their real handler. */
  markInstalled() {
    for (const f of this.installed) { const w = this.waiters.get(f); if (w) { this.waiters.delete(f); for (const r of w) r(); } }
  }
  private whenInstalled(folder: string): Promise<void> {
    if (this.live.has(folder) && this.installed.has(folder)) return Promise.resolve();
    return new Promise((res) => { const list = this.waiters.get(folder) ?? []; list.push(res); this.waiters.set(folder, list); this.bump(); });
  }

  /* --- startup --- */

  /**
   * Start loading what loads at startup, for the enabled plugins: banners in parallel first, then the rest of the startup
   * list in parallel, then (once idle) the idle picks. Safe to call again (already loaded ones are skipped).
   */
  boot(enabled: string[]) {
    write(KEYS.enabled, enabled);
    if (!this.bootedAt) this.bootedAt = performance.now();
    const list = startupList({ enabled, cfg: this.config, banners: enabled.filter((f) => this.isBanner(f)), stats: this.stats, now: Date.now(), unknown: this.unknown(enabled) });
    const banners = list.filter((x) => x.reason === 'banner');
    const rest = list.filter((x) => x.reason !== 'banner');
    const first = Promise.allSettled(banners.map((x) => this.request(x.folder, x.reason)));
    void first.then(() => Promise.allSettled(rest.map((x) => this.request(x.folder, x.reason)))).then(() => {
      if (!this.readyAt) this.readyAt = performance.now();
      this.bump();
      idle(() => {
        const picks = idlePicks({ enabled, cfg: this.config, loaded: new Set([...this.libs.keys()]), stats: this.stats, now: Date.now() });
        // idle loads only fetch + evaluate: they become "cached" and install on first use
        for (const f of picks) void this.prefetch(f);
      });
    });
  }

  /** The folders a previous visit had enabled, so banner chunks can start before the backend answers. */
  lastEnabled(): string[] { return read<string[]>(KEYS.enabled, []); }

  /** Fetch + evaluate without installing (idle preload). */
  prefetch(folder: string): Promise<void> {
    if (this.libs.has(folder) || this.pending.has(folder)) return Promise.resolve();
    const imp = importers.get(folder);
    if (!imp) return Promise.resolve();
    const t0 = performance.now();
    const p = imp().then((m) => { this.loadMs.set(folder, Math.round(performance.now() - t0)); this.accept(folder, m); }, () => undefined).finally(() => { this.pending.delete(folder); this.bump(); });
    this.pending.set(folder, p);
    return p;
  }

  /* --- hot updates (dev) --- */

  hot(folder: string, m: WebModule) {
    this.accept(folder, m);
    this.stubs.delete(folder);
    this.bump();
  }

  /* --- config --- */

  setConfig(raw: unknown) {
    this.config = normalizeLazyConfig(raw);
    write(KEYS.config, this.config);
    this.evict();
    this.bump();
  }

  /** Reset usage numbers and learned shapes (the next start learns every plugin again). */
  forget() {
    this.stats = {}; this.shapes = {}; this.stubs.clear();
    write(KEYS.stats, {}); write(KEYS.shapes, {});
    this.bump();
  }

  /* --- the live table --- */

  rows(enabled: Set<string>): PluginLoadRow[] {
    return this.folders.map((folder) => {
      const mode = modeOf(this.config, folder);
      const st = this.stats[folder];
      const c = this.chunks?.[folder];
      const state: PluginLoadState = mode === 'off' || !enabled.has(folder) ? 'disabled'
        : this.errors.has(folder) ? 'error' : this.installed.has(folder) ? 'loaded' : this.pending.has(folder) ? 'loading' : this.libs.has(folder) ? 'cached' : 'not-loaded';
      const why = this.reasons.get(folder);
      return {
        folder, state, mode, core: !!CORE_PLUGINS[folder], banner: this.isBanner(folder),
        ...(why ? { startup: why } : {}),
        bytes: c ? c.bytes + c.cssBytes : null,
        loadMs: this.loadMs.get(folder) ?? null,
        lastUsed: st?.lastUsed || null,
        uses: st?.uses ?? 0,
        ...(this.errors.has(folder) ? { error: this.errors.get(folder) } : {}),
        ...(this.eagerWhy.has(folder) ? { eager: this.eagerWhy.get(folder) } : {}),
      };
    });
  }

  enabledNow = new Set<string>();

  /** What would load at startup now, in order (the lazy loader settings' startup list). */
  startupPreview() {
    const enabled = [...this.enabledNow];
    return startupList({ enabled, cfg: this.config, banners: enabled.filter((f) => this.isBanner(f)), stats: this.stats, now: Date.now() });
  }

  /** Chunk sizes from the build (`/axf-plugin-chunks.json`); absent in dev. */
  async loadChunkInfo(): Promise<void> {
    try {
      const r = await fetch('/axf-plugin-chunks.json', { cache: 'no-cache' });
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return;
      const j = (await r.json()) as { startup: { file: string; bytes: number; css: number } | null; plugins: Record<string, ChunkInfo> };
      this.chunks = j.plugins; this.startup = j.startup;
      this.bump();
    } catch { /* dev server or offline: sizes stay unknown */ }
  }

  /** Keep a loaded plugin's chunk files in Cache Storage for offline use (the console's service worker answers from it). */
  private async keepOffline(folder: string) {
    const c = this.chunks?.[folder];
    if (!this.config.cache.offline || !c || typeof caches === 'undefined') return;
    try {
      // the console's service worker (the alerts one, /alerts-sw.js) answers /assets/ requests from this cache
      const sw = (navigator as Navigator & { serviceWorker?: ServiceWorkerContainer }).serviceWorker;
      if (sw && !(await sw.getRegistration())) await sw.register(SERVICE_WORKER).catch(() => undefined);
      const cache = await caches.open(CHUNK_CACHE);
      for (const f of [c.file, ...c.css]) { const url = `/${f}`; if (!(await cache.match(url))) await cache.add(url); }
      await this.trimOffline(cache);
    } catch { /* quota or private mode: the browser's own cache still has it */ }
  }

  private async trimOffline(cache: Cache) {
    const max = this.config.cache.offlineMb * 1024 * 1024;
    const sizeOf = new Map<string, number>();
    for (const c of Object.values(this.chunks ?? {})) { sizeOf.set(`/${c.file}`, c.bytes); for (const f of c.css) sizeOf.set(`/${f}`, Math.round(c.cssBytes / Math.max(1, c.css.length))); }
    const owner = new Map<string, string>();
    for (const [f, c] of Object.entries(this.chunks ?? {})) for (const x of [c.file, ...c.css]) owner.set(`/${x}`, f);
    const keys = (await cache.keys()).map((r) => new URL(r.url).pathname);
    let total = keys.reduce((n, k) => n + (sizeOf.get(k) ?? 0), 0);
    const lru = keys.sort((a, b) => (this.stats[owner.get(a) ?? '']?.lastUsed ?? 0) - (this.stats[owner.get(b) ?? '']?.lastUsed ?? 0));
    for (const k of lru) { if (total <= max) break; await cache.delete(k); total -= sizeOf.get(k) ?? 0; }
  }

  async clearOffline() { if (typeof caches !== 'undefined') await caches.delete(CHUNK_CACHE); }

  /* --- server side (plugin-manager routes; REST / MCP / CLI read and change the same config) --- */

  private reportTimer: ReturnType<typeof setTimeout> | null = null;
  /** Send the live table to the plugin-manager server part (debounced), so `axf plugin-manager lazy` can show it. */
  report() {
    if (this.reportTimer) return;
    this.reportTimer = setTimeout(() => {
      this.reportTimer = null;
      const body = { at: new Date().toISOString(), startup: this.startup, bootMs: this.readyAt && this.bootedAt ? Math.round(this.readyAt - this.bootedAt) : null, plugins: this.rows(this.enabledNow) };
      void fetch('/api/plugins/plugin-manager/lazy/report', { method: 'POST', headers: authHeaders(consoleTokens, { headers: { 'content-type': 'application/json' } }), body: JSON.stringify(body), keepalive: true }).catch(() => undefined); // axf-plugin:plugin-manager
    }, 5000);
  }

  /** Fetch the stored config from the plugin-manager server part (it may be off or removed: the cached one stays). */
  async pullConfig(): Promise<void> {
    try {
      const r = await fetch('/api/plugins/plugin-manager/lazy', { headers: authHeaders(consoleTokens, {}), cache: 'no-store' }); // axf-plugin:plugin-manager
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return;
      const j = (await r.json()) as { config?: unknown };
      if (j.config && JSON.stringify(normalizeLazyConfig(j.config)) !== JSON.stringify(this.config)) this.setConfig(j.config);
    } catch { /* keep the cached config */ }
  }
}

const stubFns = new Map<string, unknown>();

// plugin help files ship eagerly (Help mode needs them before anything loads); plugins.ts registers them here
let helpFor: (folder: string) => AxfWebLibrary['help'] | undefined = () => undefined;
export function setHelpSource(f: typeof helpFor) { helpFor = f; }

function idle(f: () => void) {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(f, { timeout: 8000 }); else setTimeout(f, 3000);
}

export const loader = new PluginLoader();

if (import.meta.hot) {
  globalThis.addEventListener(HOT_EVENT, (e) => {
    const d = (e as CustomEvent<{ folder: string; exports: WebModule }>).detail;
    if (d?.folder) loader.hot(d.folder, d.exports);
  });
}

/** Re-render on every loader change (loads, evictions, config). */
export function useLoaderVersion(): number {
  return useSyncExternalStore(loader.subscribe, loader.version, loader.version);
}

/* ---------------- the placeholder a stand-in renders ---------------- */

function LazyCall({ folder, path, args }: { folder: string; path: string[]; args: unknown[] }): ReactNode {
  useLoaderVersion();
  useEffect(() => { void loader.request(folder); }, [folder]);
  const err = loader.problem(folder);
  if (err) {
    return (
      <div className="axf-lazy">
        <Note tone="danger">{folder}: {err}</Note>
        <Button icon="refresh" onClick={() => void loader.request(folder)}>Retry</Button>
      </div>
    );
  }
  const real = loader.isInstalled(folder) ? at(loader.library(folder), path) : undefined;
  if (typeof real === 'function') return (real as (...a: unknown[]) => ReactNode)(...args);
  return <div className="axf-lazy" role="status" aria-busy="true"><span className="fx-muted">Loading {folder}…</span></div>;
}

/** Counts a use while a plugin's page, dialog, tab or settings panel is on screen (frecency + never evicted while shown). */
function Used({ folder, children }: { folder: string; children?: ReactNode }) {
  useEffect(() => { loader.used(folder); loader.mounted(folder, true); return () => loader.mounted(folder, false); }, [folder]);
  return <>{children}</>;
}

/** On screen without being a use (slot content, banners): never evicted while shown, so it can't flip back and forth. */
function Shown({ folder, children }: { folder: string; children?: ReactNode }) {
  useEffect(() => { loader.mounted(folder, true); return () => loader.mounted(folder, false); }, [folder]);
  return <>{children}</>;
}

/** Wrap a library's pages, dialogs, tabs and settings panels so opening one counts as a use of its plugin; slots and banners only mark it on screen. */
export function countingUses(folder: string, lib: AxfWebLibrary): AxfWebLibrary {
  const wrap = (n: ReactNode) => createElement(Used, { folder }, n);
  const shown = (n: ReactNode) => createElement(Shown, { folder }, n);
  return {
    ...lib,
    ...(lib.views ? { views: Object.fromEntries(Object.entries(lib.views).map(([k, v]) => [k, { ...v, render: () => wrap(v.render()) }])) } : {}),
    ...(lib.dialogs ? { dialogs: Object.fromEntries(Object.entries(lib.dialogs).map(([k, d]) => [k, { ...d, render: (p: Record<string, unknown>, close: () => void) => wrap(d.render(p, close)) }])) } : {}),
    ...(lib.tabs ? { tabs: Object.fromEntries(Object.entries(lib.tabs).map(([k, r]) => [k, (t: Parameters<typeof r>[0]) => wrap(r(t))])) } : {}),
    ...(lib.settingsPanels ? { settingsPanels: lib.settingsPanels.map((p) => ({ ...p, render: () => wrap(p.render() as ReactNode) })) } : {}),
    ...(lib.slots ? { slots: Object.fromEntries(Object.entries(lib.slots).map(([k, defs]) => [k, defs.map((d) => ({ ...d, render: (props: Record<string, unknown>) => shown(d.render(props)) }))])) } : {}),
    ...(lib.banners ? { banners: lib.banners.map((b) => ({ ...b, render: () => shown(b.render()) })) } : {}),
  };
}

export { CORE_PLUGINS, LAZY_DEFAULTS, normalizeLazyConfig, type LazyConfig, type LazyMode, type StartReason };

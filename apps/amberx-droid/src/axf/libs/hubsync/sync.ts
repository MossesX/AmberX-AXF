/**
 * lib-hubsync runtime side (no React): FollowSource, HubSync, startHubSync. See index.tsx for the overview.
 */
import { HubAppearanceSource } from '../../react/hubAppearance';
import type { AppearanceSource, AxfRuntime } from '../../core/runtime';
import type { AppearanceSourceState } from '../../core/engines/appearance';
import { HubData, HubSettings, type HubState } from '../hubstore';
import { CONNECTION_KEY, dataFolderFor, describeSync, followState, resolveHubSync, settingsFileFor, type HubSyncConfig } from './core';

/** A look source that never makes the app wait: the runtime always sees `ready`; `real()` keeps what the hub said. */
export class FollowSource implements AppearanceSource {
  private st: AppearanceSourceState;
  private readonly watchers = new Set<() => void>();
  constructor(readonly inner: AppearanceSource & { origin?: string }) { this.st = inner.state(); }
  get origin() { return this.inner.origin; }
  real(): AppearanceSourceState { return this.st; }
  onReal(fn: () => void) { this.watchers.add(fn); return () => { this.watchers.delete(fn); }; }
  state(): AppearanceSourceState { return followState(this.st); }
  subscribe(listener: Parameters<AppearanceSource['subscribe']>[0]): () => void {
    return this.inner.subscribe((ev) => {
      if ('state' in ev) { this.st = ev.state; for (const w of this.watchers) w(); listener({ state: followState(ev.state) }); }
      else listener(ev);
    });
  }
  start() { this.inner.start(); }
  stop() { this.inner.stop(); }
  refresh() { this.inner.refresh(); }
  save(change: Parameters<AppearanceSource['save']>[0]) { this.inner.save(change); }
}

export interface HubSyncStatus {
  config: HubSyncConfig;
  /** the look: what the hub said, `own` when this app's look was already attached by someone else, `off` */
  look: AppearanceSourceState | { status: 'off' } | { status: 'own'; hub?: string };
  settings: HubState | { status: 'off' };
  summary: string;
}

export interface HubSyncOptions extends Partial<HubSyncConfig> {
  appId?: string;
  fetchImpl?: typeof fetch;
}

/** One app's sync with axHub. `startHubSync` makes it; `restart(config)` applies a changed connection. */
export class HubSync {
  private cfg: HubSyncConfig;
  private look: FollowSource | HubAppearanceSource | null = null;
  private lookOwn = false;
  private offLook: (() => void) | null = null;
  private offMirror: (() => void) | null = null;
  private hubSettings: HubSettings | null = null;
  private hubData: HubData;
  private readonly listeners = new Set<() => void>();
  private snap: HubSyncStatus;
  private readonly appId: string;

  constructor(private readonly rt: AxfRuntime, private readonly opts: HubSyncOptions = {}) {
    this.appId = opts.appId ?? (rt.manifest as { app?: { id?: string } }).app?.id ?? 'app';
    this.cfg = resolveHubSync(opts);
    this.hubData = new HubData({ deviceOnly: true });
    this.snap = this.compute();
  }

  get config(): HubSyncConfig { return this.cfg; }
  get settings(): HubSettings | null { return this.hubSettings; }
  /** The app's tables: on axHub or on this device as configured. */
  get data(): HubData { return this.hubData; }
  state(): HubSyncStatus { return this.snap; }
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit() { this.snap = this.compute(); for (const l of this.listeners) l(); }

  private compute(): HubSyncStatus {
    const look: HubSyncStatus['look'] = this.cfg.look === 'off' ? { status: 'off' }
      : this.lookOwn || (this.look && !this.rt.appearanceSourceIs(this.look)) ? { status: 'own', hub: this.rt.appearanceHub() }
      : this.look instanceof FollowSource ? this.look.real()
      : this.look ? this.look.state() : { status: 'connecting' };
    return { config: this.cfg, look, settings: this.hubSettings ? this.hubSettings.state() : { status: 'off' }, summary: describeSync(this.cfg) };
  }

  start(): this {
    const c = this.cfg;
    // look: an app that already attached a source (developer.hub, the console's own) keeps it
    if (c.look !== 'off') {
      if (this.rt.hasAppearanceSource()) this.lookOwn = true;
      else {
        const inner = new HubAppearanceSource({ hub: c.hub, appId: this.appId, fetchImpl: this.opts.fetchImpl });
        const src = c.look === 'follow' ? new FollowSource(inner) : inner;
        this.look = src;
        this.offLook = src instanceof FollowSource ? src.onReal(() => this.emit()) : inner.subscribe((ev) => { if ('state' in ev) this.emit(); });
        this.rt.attachAppearanceSource(src);
      }
    }
    if (c.settings) {
      const s = new HubSettings({ hub: c.hub, project: c.project, file: settingsFileFor(this.appId), appId: this.appId, fetchImpl: this.opts.fetchImpl });
      this.hubSettings = s;
      s.subscribe(() => this.emit());
      void s.load().then(() => { if (this.hubSettings === s) this.offMirror = s.mirror(this.rt.settings, (k) => k !== CONNECTION_KEY); })
        .catch((e) => this.rt.terminal.warn('hubsync', `settings stay on this device until axHub answers: ${(e as Error).message}`));
    }
    this.hubData = c.data === 'off' ? new HubData({ deviceOnly: true })
      : new HubData({ hub: c.hub, project: c.project, mode: c.data, tables: c.tables, folder: dataFolderFor(this.appId), appId: this.appId, fetchImpl: this.opts.fetchImpl });
    this.rt.terminal.log('hubsync', describeSync(c));
    this.emit();
    return this;
  }

  stop(): void {
    this.offMirror?.(); this.offMirror = null;
    this.offLook?.(); this.offLook = null;
    // only our own source: an app's own (the console's developer source, attached after us) stays attached
    // (Oct 28 2026: a restart here detached the console's source, so its look never reached axHub)
    if (this.look && this.rt.appearanceSourceIs(this.look)) this.rt.detachAppearanceSource();
    this.look = null;
    this.lookOwn = false;
    this.hubSettings = null;
    this.hubData = new HubData({ deviceOnly: true });
    this.emit();
  }

  restart(next: Partial<HubSyncConfig>): void { this.stop(); this.cfg = resolveHubSync(this.cfg, next); this.start(); }

  /** Re-read everything from the hub (fresh on focus). */
  refresh(): void {
    this.look?.refresh();
    if (this.hubSettings) void this.hubSettings.load().catch(() => undefined);
    this.emit();
  }

  /** Can this browser read the hub project? (the shared look document; 404 = reachable, nothing saved yet) */
  async test(): Promise<{ ok: boolean; message: string }> {
    const f = this.opts.fetchImpl ?? ((i: RequestInfo | URL, n?: RequestInit) => fetch(i, n));
    try {
      const r = await f(`${this.cfg.hub}/data/${this.cfg.project}/${settingsFileFor(this.appId)}`, { credentials: 'include', redirect: 'error', cache: 'no-store', headers: { accept: 'application/json' } });
      if (r.ok || r.status === 404) return { ok: true, message: r.ok ? 'Connected: this app\'s settings are on axHub.' : 'Connected: nothing saved for this app yet.' };
      if (r.status === 401 || r.status === 403) return { ok: false, message: `Signed out of axHub (${r.status}). Sign in, then test again.` };
      return { ok: false, message: `axHub answered ${r.status}.` };
    } catch (e) { return { ok: false, message: `Can't reach axHub (${(e as Error).message}).` }; }
  }
}

let current: HubSync | null = null;
/** The sync the library started (null before it registers). */
export const hubSync = () => current;

/** Start syncing this app with axHub. Replaces a sync started earlier. */
export function startHubSync(rt: AxfRuntime, opts: HubSyncOptions = {}): HubSync {
  current?.stop();
  current = new HubSync(rt, opts).start();
  return current;
}

export function savedConnection(rt: AxfRuntime): unknown {
  const raw = rt.settings.get(CONNECTION_KEY);
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch { return null; }
}


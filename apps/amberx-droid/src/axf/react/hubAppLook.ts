/**
 * HubAppLookStore: one app's app-look@1 document on the axHub data server (`shared/settings/looks/<app>.json`,
 * engines/skin.ts). Same transport as HubAppearanceSource: GET, PUT with If-Match, server-sent `change` events.
 * Only this app writes its document, so a 409 is another tab or the skins CLI: take the newest version and save again.
 *
 * A chosen look survives a reload (Nov 10 2026, Brett: "Now it's loading the old banner again, the old look"): a failed
 * PUT used to be dropped silently, so the skin showed until the next reload and then the hub's older document came back.
 * Now each save is kept on this device (`pendingKey`) until the hub has it; a reload finds the unsaved copy, draws it and
 * sends it again; a failed save is retried with a back-off, and `saveError()` says why it isn't on the hub yet.
 */
import { APP_LOOK_PROJECT, appLookPath, parseAppLook, type AppLookDocument, type AppLookStore } from '../core';

export interface HubAppLookOptions {
  hub: string;
  appId: string;
  fetchImpl: typeof fetch;
  eventSource?: typeof EventSource;
  live?: boolean;
  /** Where an unsaved look waits (default: localStorage; null = keep nothing). */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** Back-off between save attempts (ms); default 1 s, 5 s, 20 s. */
  retryMs?: readonly number[];
}

/** The device key an unsaved look of `appId` waits under. */
export const pendingKey = (appId: string): string => `axf.app-look.pending.${appId}`;
/** An unsaved copy older than this is dropped (the hub's newer document wins). */
export const PENDING_MAX_AGE_MS = 7 * 24 * 3600_000;
const RETRY_MS = [1_000, 5_000, 20_000];

function defaultStorage(): HubAppLookOptions['storage'] {
  try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; }
}

export class HubAppLookStore implements AppLookStore {
  private doc: AppLookDocument | null = null;
  private version: string | null = null;
  private st: ReturnType<AppLookStore['status']> = 'loading';
  private readonly listeners = new Set<() => void>();
  private es: EventSource | null = null;
  private wanted: AppLookDocument | null = null;
  private saving = false;
  private failures = 0;
  private error: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly path: string;
  private readonly storage: HubAppLookOptions['storage'];

  constructor(private readonly opts: HubAppLookOptions) {
    this.path = `${APP_LOOK_PROJECT}/${appLookPath(opts.appId)}`;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  }

  /** Why the last change isn't on the hub yet (null = saved, or nothing to save). */
  saveError(): string | null { return this.error; }
  /** True while a change waits for the hub (on this device). */
  unsaved(): boolean { return !!this.wanted || this.saving || !!this.readPending(); }

  private readPending(): AppLookDocument | null {
    try {
      const raw = this.storage?.getItem(pendingKey(this.opts.appId));
      if (!raw) return null;
      const j = JSON.parse(raw) as { at?: number; doc?: unknown };
      const doc = parseAppLook(JSON.stringify(j.doc ?? null));
      if (!doc || typeof j.at !== 'number' || Date.now() - j.at > PENDING_MAX_AGE_MS) { this.clearPending(); return null; }
      return doc;
    } catch { return null; }
  }
  private writePending(doc: AppLookDocument): void {
    try { this.storage?.setItem(pendingKey(this.opts.appId), JSON.stringify({ at: Date.now(), doc })); } catch { /* full or private mode */ }
  }
  private clearPending(): void {
    try { this.storage?.removeItem(pendingKey(this.opts.appId)); } catch { /* private mode */ }
  }

  private get url(): string { return `${this.opts.hub}/data/${this.path}`; }

  get(): AppLookDocument | null { return this.doc; }
  status(): ReturnType<AppLookStore['status']> { return this.st; }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  stop(): void { this.es?.close(); this.es = null; if (this.retryTimer) clearTimeout(this.retryTimer); this.retryTimer = null; }

  /** Read once; later reads come from the live feed. */
  async load(): Promise<void> {
    if (this.st === 'loading' || this.st === 'failed') {
      await this.read();
      this.adoptPending();
    }
    this.watch();
  }

  /**
   * A look chosen on this device that never reached the hub (the tab closed, the hub refused, no network): newer than the
   * hub's copy → draw it and send it again; older (another device changed the look since) → drop it.
   */
  private adoptPending(): void {
    const mine = this.readPending();
    if (!mine) return;
    if (this.st === 'failed') { this.doc = mine; this.st = 'ready'; this.wanted = mine; return; } // the next flush retries
    const hubAt = Date.parse(this.doc?.updatedAt ?? '') || 0;
    const myAt = Date.parse(mine.updatedAt ?? '') || 0;
    if (this.doc && JSON.stringify(this.doc) === JSON.stringify(mine)) { this.clearPending(); return; }
    if (this.doc && hubAt > myAt) { this.clearPending(); return; }
    this.doc = mine;
    this.st = 'ready';
    this.wanted = mine;
    void this.flush();
  }

  /** Returns true when the document changed. */
  private async read(): Promise<boolean> {
    let r: Response;
    try {
      r = await this.opts.fetchImpl(this.url, { credentials: 'include', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' } });
    } catch { this.st = 'failed'; return false; }
    if (r.status === 404) { const had = !!this.doc; this.doc = null; this.version = null; this.st = 'missing'; return had; }
    if (!r.ok) { this.st = 'failed'; return false; }
    const text = await r.text().catch(() => '');
    const doc = parseAppLook(text);
    if (!doc) { this.st = 'failed'; return false; }
    const changed = JSON.stringify(doc) !== JSON.stringify(this.doc);
    this.doc = doc;
    this.version = versionOf(r) ?? this.version;
    this.st = 'ready';
    return changed;
  }

  private watch(): void {
    const ES = this.opts.eventSource ?? (globalThis as { EventSource?: typeof EventSource }).EventSource;
    if (this.es || this.opts.live === false || !ES) return;
    this.es = new ES(`${this.opts.hub}/data-events?watch=${encodeURIComponent(this.path)}`, { withCredentials: true });
    this.es.addEventListener('change', () => { if (!this.saving && !this.wanted && !this.retryTimer) void this.read().then((changed) => { if (changed) for (const fn of this.listeners) fn(); }); });
  }

  /** Takes effect at once; saves in the background, newest wins. */
  save(doc: AppLookDocument): void {
    this.doc = doc;
    this.st = 'ready';
    this.wanted = doc;
    this.writePending(doc);
    this.failures = 0;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.saving || !this.wanted) return;
    const doc = this.wanted;
    this.wanted = null;
    this.saving = true;
    let error: string | null = null;
    try {
      const put = () => this.opts.fetchImpl(this.url, { method: 'PUT', credentials: 'include', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', 'If-Match': this.version ? `"${this.version}"` : 'new' }, body: `${JSON.stringify(doc)}\n` });
      let r = await put();
      if (r.status === 409 || r.status === 412) {
        // another tab or the skins CLI saved in between: take the newest version (or "new" when it is gone) and save again
        const latest = await this.opts.fetchImpl(this.url, { credentials: 'include', cache: 'no-store', redirect: 'error' });
        this.version = latest.status === 404 ? null : versionOf(latest) ?? this.version;
        r = await put();
      }
      if (r.ok) this.version = versionOf(r) ?? this.version;
      else error = r.status === 401 || r.status === 403 ? `axHub refused the save (${r.status}): sign in to axHub again` : `axHub answered ${r.status}`;
    } catch (e) {
      error = `can't reach axHub: ${(e as Error)?.message ?? e}`;
    } finally { this.saving = false; }
    if (this.wanted) { void this.flush(); return; } // a newer change came in meanwhile: that one is what gets saved
    if (!error) {
      this.error = null;
      this.failures = 0;
      if (JSON.stringify(this.readPending()) === JSON.stringify(doc)) this.clearPending();
      return;
    }
    this.error = error;
    for (const fn of this.listeners) fn();
    const delays = this.opts.retryMs ?? RETRY_MS;
    if (this.failures < delays.length) {
      const wait = delays[this.failures++];
      this.retryTimer = setTimeout(() => { this.retryTimer = null; if (!this.wanted) this.wanted = doc; void this.flush(); }, wait);
    }
    // out of retries: the copy stays on this device; the next load or change sends it again
  }
}

function versionOf(r: Response): string | null {
  return r.headers.get('X-Data-Version') ?? r.headers.get('ETag')?.replace(/^W\//, '').replace(/^"|"$/g, '') ?? null;
}

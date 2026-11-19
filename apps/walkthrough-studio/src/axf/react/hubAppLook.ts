/**
 * HubAppLookStore: one app's app-look@1 document on the axHub data server (`shared/settings/looks/<app>.json`,
 * engines/skin.ts). Same transport as HubAppearanceSource: GET, PUT with If-Match, server-sent `change` events.
 * Only this app writes its document, so a 409 is another tab or the skins CLI: take the newest version and save again.
 */
import { APP_LOOK_PROJECT, appLookPath, parseAppLook, type AppLookDocument, type AppLookStore } from '../core';

export interface HubAppLookOptions {
  hub: string;
  appId: string;
  fetchImpl: typeof fetch;
  eventSource?: typeof EventSource;
  live?: boolean;
}

export class HubAppLookStore implements AppLookStore {
  private doc: AppLookDocument | null = null;
  private version: string | null = null;
  private st: ReturnType<AppLookStore['status']> = 'loading';
  private readonly listeners = new Set<() => void>();
  private es: EventSource | null = null;
  private wanted: AppLookDocument | null = null;
  private saving = false;
  private readonly path: string;

  constructor(private readonly opts: HubAppLookOptions) { this.path = `${APP_LOOK_PROJECT}/${appLookPath(opts.appId)}`; }

  private get url(): string { return `${this.opts.hub}/data/${this.path}`; }

  get(): AppLookDocument | null { return this.doc; }
  status(): ReturnType<AppLookStore['status']> { return this.st; }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  stop(): void { this.es?.close(); this.es = null; }

  /** Read once; later reads come from the live feed. */
  async load(): Promise<void> {
    if (this.st === 'loading' || this.st === 'failed') await this.read();
    this.watch();
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
    this.es.addEventListener('change', () => { if (!this.saving) void this.read().then((changed) => { if (changed) for (const fn of this.listeners) fn(); }); });
  }

  /** Takes effect at once; saves in the background, newest wins. */
  save(doc: AppLookDocument): void {
    this.doc = doc;
    this.st = 'ready';
    this.wanted = doc;
    void this.flush();
  }

  private async flush(retried = false): Promise<void> {
    if (this.saving || !this.wanted) return;
    const doc = this.wanted;
    this.wanted = null;
    this.saving = true;
    try {
      const put = () => this.opts.fetchImpl(this.url, { method: 'PUT', credentials: 'include', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', 'If-Match': this.version ? `"${this.version}"` : 'new' }, body: `${JSON.stringify(doc)}\n` });
      let r = await put();
      if (r.status === 409 && !retried) {
        const latest = await this.opts.fetchImpl(this.url, { credentials: 'include', cache: 'no-store', redirect: 'error' });
        this.version = versionOf(latest) ?? this.version;
        r = await put();
      }
      if (r.ok) this.version = versionOf(r) ?? this.version;
    } catch { /* the document in hand stays; the next change saves it */ } finally { this.saving = false; }
    if (this.wanted) void this.flush();
  }
}

function versionOf(r: Response): string | null {
  return r.headers.get('X-Data-Version') ?? r.headers.get('ETag')?.replace(/^W\//, '').replace(/^"|"$/g, '') ?? null;
}

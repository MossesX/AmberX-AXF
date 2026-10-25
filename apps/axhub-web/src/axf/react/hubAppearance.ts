/**
 * HubAppearanceSource — the web implementation of the runtime's `AppearanceSource`: a developer app's appearance
 * (and, by the same mechanism, its other settings documents) read from and written to the axHub data server.
 *
 *   read   GET  <hub>/data/shared/settings/appearance.json   (credentials: the browser's hub session cookie)
 *   write  PUT  …  If-Match: <version>                        (409 → re-read, re-merge this app's keys, retry once)
 *   live   GET  <hub>/data-events?watch=shared/settings/appearance.json  (server-sent events; re-read on `change`)
 *
 * Hub unreachable, signed out or not allowed → the state is `unreachable` / `unauthorized` and the runtime keeps the
 * app on its waiting screen; reconnects back off 1 s → 30 s. There is no cached copy and no default-theme run:
 * a developer app does not run without the hub (Brett's decision, Oct 20 2026). Off by default: only an app that
 * calls `rt.attachAppearanceSource(new HubAppearanceSource({ hub }))` is a developer app.
 */
import { APPEARANCE_PATH, APPEARANCE_PROJECT, appearanceRetryMs, mergeAppearanceFor, parseAppearance, serializeAppearance, type AppearanceDocument, type AppearanceSource, type AppearanceSourceState, type Spacing } from '../core';

export interface HubAppearanceOptions {
  /** The hub's origin, https (http only for localhost while developing). */
  hub: string;
  /** This app's id, recorded as `updatedBy`. */
  appId: string;
  /** Project + path of the document; defaults to the shared appearance document. */
  project?: string;
  path?: string;
  /** Use the live change feed (default true); false = poll every `pollMs`. */
  live?: boolean;
  pollMs?: number;
  fetchImpl?: typeof fetch;
  /** Test seam: EventSource constructor. */
  eventSource?: typeof EventSource;
}

type Listener = Parameters<AppearanceSource['subscribe']>[0];

export class HubAppearanceSource implements AppearanceSource {
  private readonly hub: string;
  private readonly project: string;
  private readonly path: string;
  private readonly listeners = new Set<Listener>();
  private st: AppearanceSourceState = { status: 'connecting' };
  private doc: AppearanceDocument | null = null;
  private version: string | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private es: EventSource | null = null;
  private running = false;
  private loading: Promise<void> | null = null;
  private pending: Parameters<AppearanceSource['save']>[0] | null = null;
  private saving = false;
  private readonly f: typeof fetch;

  constructor(private readonly opts: HubAppearanceOptions) {
    const u = new URL(opts.hub);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('HubAppearanceSource: the hub address must be https');
    this.hub = u.origin;
    this.project = opts.project ?? APPEARANCE_PROJECT;
    this.path = opts.path ?? APPEARANCE_PATH;
    this.f = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /** The hub origin this source talks to. */
  get origin(): string { return this.hub; }
  get documentUrl(): string { return `${this.hub}/data/${this.project}/${this.path}`; }

  state(): AppearanceSourceState { return this.st; }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    void this.load();
    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('online', this.onOnline);
      globalThis.addEventListener('focus', this.onFocus);
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.es?.close();
    this.es = null;
    if (typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('online', this.onOnline);
      globalThis.removeEventListener('focus', this.onFocus);
    }
  }

  refresh(): void { if (this.running) void this.load(); }

  private onOnline = () => { this.attempt = 0; this.refresh(); };
  private onFocus = () => this.refresh();

  private emitState(st: AppearanceSourceState): void {
    this.st = st;
    for (const l of this.listeners) l({ state: st });
  }

  private emitDoc(): void {
    for (const l of this.listeners) l({ doc: this.doc, version: this.version });
  }

  /** Read the document; schedules a retry on failure. One load at a time. */
  private load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = this.loadOnce().finally(() => { this.loading = null; });
    return this.loading;
  }

  private async loadOnce(): Promise<void> {
    if (!this.running) return;
    let r: Response;
    try {
      r = await this.f(this.documentUrl, { credentials: 'include', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' } });
    } catch (e) {
      return this.failed(`Can't reach ${this.hub}: ${(e as Error).message}`);
    }
    if (r.status === 401) return this.unauthorized(`Sign in to ${this.hub} first.`);
    if (r.status === 403) return this.unauthorized(`${this.hub} doesn't allow this site or this account to read settings.`);
    if (r.status === 404) {
      // nothing saved yet: a developer app starts from its defaults and the first change creates the document
      this.doc = null;
      this.version = null;
    } else if (r.ok) {
      const text = await r.text().catch(() => '');
      const doc = parseAppearance(text);
      if (text && !doc) return this.failed('The appearance document on the hub is not a valid appearance@1 document.');
      this.doc = doc;
      this.version = r.headers.get('X-Data-Version') ?? r.headers.get('ETag')?.replace(/^W\//, '').replace(/^"|"$/g, '') ?? null;
    } else {
      return this.failed(`${this.hub} answered ${r.status}.`);
    }
    this.attempt = 0;
    this.emitState({ status: 'ready', version: this.version });
    this.emitDoc();
    this.watch();
    if (this.pending) void this.flush();
  }

  private failed(reason: string): void {
    this.attempt += 1;
    const retryInMs = appearanceRetryMs(this.attempt - 1);
    this.emitState({ status: 'unreachable', reason, retryInMs, attempt: this.attempt });
    this.es?.close();
    this.es = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.load(); }, retryInMs);
  }

  private unauthorized(reason: string): void {
    this.emitState({ status: 'unauthorized', reason });
    this.es?.close();
    this.es = null;
    // a sign-in in another tab fixes it: look again in a while
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.load(); }, 15_000);
  }

  /** Follow changes: SSE when available (through Traefik it's a plain streamed GET), else polling. */
  private watch(): void {
    if (this.es || !this.running) return;
    const ES = this.opts.eventSource ?? (globalThis as { EventSource?: typeof EventSource }).EventSource;
    if (this.opts.live === false || !ES) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.timer = null; void this.load(); }, this.opts.pollMs ?? 10_000);
      return;
    }
    const es = new ES(`${this.hub}/data-events?watch=${encodeURIComponent(`${this.project}/${this.path}`)}`, { withCredentials: true });
    this.es = es;
    es.addEventListener('change', () => void this.load());
    es.onerror = () => {
      // the browser reconnects by itself; if the hub is really gone the next read fails and the state says so
      if (es.readyState === 2) { this.es = null; this.failed(`Lost the live connection to ${this.hub}.`); }
    };
  }

  /** Save: merge this app's keys into the latest document (last write wins per key) and PUT with If-Match. */
  save(change: Parameters<AppearanceSource['save']>[0]): void {
    this.pending = this.pending ? { slots: { ...this.pending.slots, ...change.slots }, hidden: { ...this.pending.hidden, ...change.hidden }, ...(change.spacing ?? this.pending.spacing ? { spacing: (change.spacing ?? this.pending.spacing) as Spacing } : {}), ...(change.palette ?? this.pending.palette ? { palette: change.palette ?? this.pending.palette } : {}) } : change;
    void this.flush();
  }

  private async flush(retried = false): Promise<void> {
    if (this.saving || !this.pending || this.st.status !== 'ready') return;
    const change = this.pending;
    this.pending = null;
    this.saving = true;
    try {
      // scoped: the look goes to the top level for every app, this app's frame (layout, banner, menus, bars) to its own keys
      const next = mergeAppearanceFor(this.doc, change, this.opts.appId, this.opts.appId, new Date().toISOString());
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'If-Match': this.version ? `"${this.version}"` : 'new' };
      let r: Response;
      try {
        r = await this.f(this.documentUrl, { method: 'PUT', credentials: 'include', cache: 'no-store', redirect: 'error', headers, body: serializeAppearance(next) });
      } catch (e) {
        this.pending = { ...change, ...(this.pending ?? {}) };
        return this.failed(`Couldn't save to ${this.hub}: ${(e as Error).message}`);
      }
      if (r.status === 409 && !retried) {
        // someone else saved first: take their document, re-apply only our keys, try once more
        this.saving = false;
        this.pending = { ...change, ...(this.pending ?? {}) };
        await this.load();
        return this.flush(true);
      }
      if (r.status === 401 || r.status === 403) { this.pending = null; return this.unauthorized(r.status === 401 ? `Sign in to ${this.hub} to change the look.` : `Your hub account may not change the shared look (needs admin or data.write).`); }
      if (!r.ok) { this.pending = null; return this.failed(`${this.hub} refused the save (${r.status}).`); }
      this.doc = next;
      this.version = r.headers.get('X-Data-Version') ?? r.headers.get('ETag')?.replace(/^W\//, '').replace(/^"|"$/g, '') ?? this.version;
      this.emitState({ status: 'ready', version: this.version });
    } finally {
      this.saving = false;
    }
    if (this.pending) void this.flush();
  }
}

/** The hub origin for a developer app: `AXF_HUB` at build time (Vite `import.meta.env.VITE_AXF_HUB`), else the default. */
export const DEFAULT_HUB = 'https://axhub.amberxai.com';

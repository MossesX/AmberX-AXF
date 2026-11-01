/**
 * lib-hub for the web port (`ai.amberx.axf.hub`, first slice, Oct 20 2026). A plain module, no UI of its own:
 *
 *   import { HubWatcher, normalizeHub, approvalUrl } from '<app>/axf/libs/hub';
 *   const w = new HubWatcher({ hub: 'https://axhub.amberxai.com', everyMs: 5000 });
 *   w.subscribe(() => render(w.state)); w.start();
 *
 * - `./hub.ts`: hub address rules, hub URLs, the approvals feed (decision #85) read with the browser's own hub session,
 *   status mapping, seen-id tracking. Same rules as the Kotlin lib-hub; both replay `spec/fixtures/hub-approvals.json`.
 * - `./apps.ts`: the app catalog `GET /apps.json` (decision #90, harvested from apps/axhub-web Oct 23 2026) and the words
 *   apps use for hub data (sizes, times, approval expiry, why a list is empty). Catalog rules pinned by the fixture's `apps`.
 * - `./react.tsx`: React hooks + views (useHubApprovals, useHubApps, useHubBannerCount, HubApprovalList, HubStatusNote).
 * - {@link HubWatcher}: polls the feed while the page is visible (and on focus), keeps the last state, tells subscribers.
 *   Framework-agnostic (React hosts use `useSyncExternalStore(w.subscribe, () => w.state)`).
 */
import { HUB_DEFAULT, fetchHubFeed, normalizeHub, approvalsUrl, type HubFeed, type HubFetch } from './hub';

export * from './hub';
export * from './apps';
export * from './source';

export interface HubWatchState extends HubFeed {
  /** 'idle' until the first answer. */
  phase: 'idle' | 'checked';
  hub: string;
  checkedAt: string | null;
}

export interface HubWatcherOptions {
  hub?: string;
  /** Polling period while the page is visible (default 5 s, at least 2 s). */
  everyMs?: number;
  /** Resolves the hub address once before the first check (e.g. from the app's own account endpoint). */
  resolveHub?: () => Promise<string | null | undefined>;
  fetch?: HubFetch;
  /** Called after every check with the new state (e.g. auto-open new approvals). */
  onCheck?: (s: HubWatchState) => void;
}

/** Polls the approvals feed and keeps the latest state. One check at a time. */
export class HubWatcher {
  state: HubWatchState;
  private subs = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight = false;
  private resolved = false;
  private readonly opts: HubWatcherOptions;
  private readonly onVisible = () => { if (this.visible()) void this.check(); };

  constructor(opts: HubWatcherOptions = {}) {
    this.opts = opts;
    const hub = normalizeHub(opts.hub) ?? HUB_DEFAULT;
    this.state = { phase: 'idle', hub, status: 'unreachable', count: 0, pending: [], approvalsUrl: approvalsUrl(hub), error: '', checkedAt: null };
  }

  subscribe = (f: () => void): (() => void) => { this.subs.add(f); return () => { this.subs.delete(f); }; };
  private set(s: HubWatchState) { this.state = s; this.subs.forEach((f) => f()); }
  private visible() { return typeof document === 'undefined' || document.visibilityState === 'visible'; }

  async check(): Promise<HubWatchState> {
    if (this.inflight) return this.state;
    this.inflight = true;
    try {
      let hub = this.state.hub;
      if (!this.resolved) {
        this.resolved = true;
        if (this.opts.resolveHub) { try { hub = normalizeHub(await this.opts.resolveHub()) ?? hub; } catch { /* keep */ } }
      }
      const feed = await fetchHubFeed(hub, { fetch: this.opts.fetch });
      this.set({ ...feed, phase: 'checked', hub, checkedAt: new Date().toISOString() });
      this.opts.onCheck?.(this.state);
      return this.state;
    } finally {
      this.inflight = false;
    }
  }

  start(): void {
    if (this.timer) return;
    void this.check();
    this.timer = setInterval(() => { if (this.visible()) void this.check(); }, Math.max(2_000, this.opts.everyMs ?? 5_000));
    globalThis.addEventListener?.('focus', this.onVisible);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    globalThis.removeEventListener?.('focus', this.onVisible);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
  }
}

/**
 * lib-approvals (web, `ai.amberx.axf.approvals`): open approvals + held calls for any AXF app's title bar, live.
 *
 *   import { approvalsWatcher } from '<app>/axf/libs/approvals';
 *   const w = approvalsWatcher('https://axhub.amberxai.com');
 *   w.subscribe(() => render(w.state)); w.start();
 *
 * - `./core.ts`: the pure part (one list from the feed, words and times, deciding from the hub's own origin).
 * - {@link ApprovalsWatcher}: reads the feed with the app's own hub session every few seconds while the page is visible,
 *   again on focus, on {@link APPROVALS_CHECK_EVENT} and on {@link ApprovalsWatcher.push} (a hub push or a notification:
 *   read now). The hub has no approvals event stream today, so polling is the live path; a held call's own job stream
 *   (veto@1 `followVeto`) is left to the apps that show its output.
 * - `./react.tsx`: the badge + popover (`ApprovalsBadge`) and the host seam (`setApprovalsHost`) apps use to plug in
 *   their own deciding path.
 */
import { HUB_DEFAULT, feedUrl, normalizeHub, readCapped, type HubFetch } from '../hub/hub';
import { vetoFromPush } from '../hub/veto';
import { APPROVALS_CHECK_EVENT, APPROVALS_POLL_MAX_MS, APPROVALS_POLL_MIN_MS, APPROVALS_POLL_MS, emptyApprovals, interpretApprovals, type ApprovalsState } from './core';

export * from './core';

export interface ApprovalsWatcherOptions {
  hub: string;
  everyMs?: number;
  fetch?: HubFetch;
  now?: () => number;
  /** The feed address (default lib-hub's `feedUrl`). */
  url?: string;
  /** Polls only while this says so (default: the page is visible). */
  visible?: () => boolean;
}

/** Clamp a poll period to 2 s – 5 min. */
export const clampPoll = (ms: unknown): number => {
  const n = typeof ms === 'number' && Number.isFinite(ms) ? ms : APPROVALS_POLL_MS;
  return Math.min(APPROVALS_POLL_MAX_MS, Math.max(APPROVALS_POLL_MIN_MS, Math.round(n)));
};

/** Reads the approvals feed once (lib-hub's rules: own session, redirects refused, reply capped) → the one list. */
export async function fetchApprovals(base: string, opts: { fetch?: HubFetch; now?: () => number; url?: string } = {}): Promise<ApprovalsState> {
  const hub = normalizeHub(base);
  const now = opts.now ?? Date.now;
  if (!hub) return { ...emptyApprovals(HUB_DEFAULT, 'unreachable', "Can't reach the hub."), checkedAt: now() };
  const f: HubFetch = opts.fetch ?? ((u, i) => fetch(u, i));
  let r: Response;
  try {
    r = await f(opts.url ?? feedUrl(hub), { credentials: 'include', cache: 'no-store', redirect: 'error' });
  } catch (e) {
    return { ...emptyApprovals(hub, 'unreachable', ((e as Error)?.message || "Can't reach the hub.").slice(0, 120)), checkedAt: now() };
  }
  if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) return interpretApprovals(hub, r.status || 302, '', now());
  if (r.status !== 200) return interpretApprovals(hub, r.status, '', now());
  let body: string | null;
  try { body = await readCapped(r); } catch (e) { return { ...emptyApprovals(hub, 'unreachable', ((e as Error)?.message || "Can't reach the hub.").slice(0, 120)), checkedAt: now() }; }
  if (body === null) return { ...emptyApprovals(hub, 'unreachable', 'Reply too large.'), checkedAt: now() };
  return interpretApprovals(hub, 200, body, now());
}

const pageVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

/** One watcher per hub: polls while started and visible, tells subscribers on every answer. */
export class ApprovalsWatcher {
  state: ApprovalsState;
  readonly hub: string;
  private everyMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private subs = new Set<() => void>();
  private inflight: Promise<ApprovalsState> | null = null;
  private again = () => { if (this.opts.visible?.() ?? pageVisible()) void this.check(); };

  constructor(private opts: ApprovalsWatcherOptions) {
    this.hub = normalizeHub(opts.hub) ?? HUB_DEFAULT;
    this.everyMs = clampPoll(opts.everyMs);
    this.state = emptyApprovals(this.hub);
  }

  subscribe = (fn: () => void): (() => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };
  get running(): boolean { return this.timer !== null; }

  /** Reads now (one read at a time; a second call joins the first). */
  check(): Promise<ApprovalsState> {
    if (this.inflight) return this.inflight;
    this.inflight = fetchApprovals(this.hub, { fetch: this.opts.fetch, now: this.opts.now, url: this.opts.url })
      .then((st) => { this.state = st; this.subs.forEach((f) => f()); return st; })
      .finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** A hub push or a tapped notification: read now. Returns the held call it names, if it is one (veto@1 push). */
  push(raw: unknown): string | null {
    void this.check();
    return vetoFromPush(this.hub, raw)?.call.id ?? null;
  }

  setEvery(ms: number): void {
    this.everyMs = clampPoll(ms);
    if (this.timer) { clearInterval(this.timer); this.timer = setInterval(this.again, this.everyMs); }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(this.again, this.everyMs);
    globalThis.addEventListener?.('focus', this.again);
    globalThis.addEventListener?.(APPROVALS_CHECK_EVENT, this.again);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.again);
    void this.check();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    globalThis.removeEventListener?.('focus', this.again);
    globalThis.removeEventListener?.(APPROVALS_CHECK_EVENT, this.again);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.again);
  }
}

const watchers = new Map<string, ApprovalsWatcher>();
/** The one watcher for this hub address (every badge in the app shares it). */
export function approvalsWatcher(hub: string, opts: Omit<ApprovalsWatcherOptions, 'hub'> = {}): ApprovalsWatcher {
  const key = normalizeHub(hub) ?? HUB_DEFAULT;
  let w = watchers.get(key);
  if (!w) { w = new ApprovalsWatcher({ ...opts, hub: key }); watchers.set(key, w); }
  return w;
}

/** Asks every watcher to read now (an app's "Check now", a push arriving). */
export const checkApprovalsNow = (): void => { globalThis.dispatchEvent?.(new Event(APPROVALS_CHECK_EVENT)); };

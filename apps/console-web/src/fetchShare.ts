/**
 * One shared read per source for every card and screen (urgent-console-perf, Nov 4 2026).
 *
 * The console's cards and plugins each poll `/api/*` on their own timers; with Home open in two consoles the server
 * got the same reads many times over, kept getting them from background tabs, and retried a failing read as fast as
 * its pollers ran. Installed once before the app renders, this wraps `fetch` for same-origin `GET /api/…` only:
 *
 * - **Shared:** identical GETs in flight at the same time (same URL and token) send one request; every caller gets
 *   its own copy of the answer. A GET with its own abort signal is sent on its own.
 * - **Hidden tab:** a GET started while the tab is hidden waits until it is visible again (pollers sharing a URL
 *   share that one waiting request), so a background console sends nothing.
 * - **5xx backoff:** after a server error (or no answer) a URL is not asked again for 1 s, then 2, 4 … up to 60 s;
 *   callers in between get a 503 at once. The first good answer resets it.
 *
 * POST and other methods, other origins and EventSource (`/api/events`) are untouched. Opt out per request with the
 * header `x-axf-fetch: direct`.
 */

const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

export interface FetchShareStats { sent: number; shared: number; heldHidden: number; backedOff: number }

interface Failure { count: number; until: number }

export function createFetchShare(base: typeof fetch, doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> | null, origin: string, now: () => number = Date.now) {
  const inflight = new Map<string, Promise<Response>>();
  const failures = new Map<string, Failure>();
  const stats: FetchShareStats = { sent: 0, shared: 0, heldHidden: 0, backedOff: 0 };

  const whenVisible = (signal?: AbortSignal | null) => new Promise<void>((resolve, reject) => {
    if (!doc || doc.visibilityState !== 'hidden') { resolve(); return; }
    stats.heldHidden += 1;
    const done = () => { doc.removeEventListener('visibilitychange', on); signal?.removeEventListener('abort', abort); };
    const on = () => { if (doc.visibilityState !== 'hidden') { done(); resolve(); } };
    const abort = () => { done(); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
    doc.addEventListener('visibilitychange', on);
    signal?.addEventListener('abort', abort);
  });

  const failed = (key: string) => {
    const f = failures.get(key);
    const count = (f?.count ?? 0) + 1;
    failures.set(key, { count, until: now() + Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (count - 1)) });
  };

  function target(input: RequestInfo | URL, init?: RequestInit): URL | null {
    if (typeof input !== 'string' && !(input instanceof URL)) return null; // Request objects pass through
    if ((init?.method ?? 'GET').toUpperCase() !== 'GET' || init?.body) return null;
    const h = new Headers(init?.headers);
    if (h.get('x-axf-fetch') === 'direct') return null;
    let url: URL;
    try { url = new URL(String(input), origin); } catch { return null; }
    if (url.origin !== new URL(origin).origin || !url.pathname.startsWith('/api/') || url.pathname === '/api/events') return null;
    return url;
  }

  const shared: typeof fetch = (input, init) => {
    const url = target(input, init);
    if (!url) return base(input, init);
    const key = `${url.pathname}${url.search}\n${new Headers(init?.headers).get('authorization') ?? ''}`;
    const f = failures.get(key);
    if (f && now() < f.until) {
      stats.backedOff += 1;
      return Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'The server failed this read a moment ago; trying again shortly.', backoffMs: f.until - now() }),
        { status: 503, headers: { 'content-type': 'application/json', 'x-axf-backoff': '1' } }));
    }
    // a caller with its own abort signal gets its own request: aborting it must not cancel anyone else's
    const own = !!init?.signal;
    let p = own ? undefined : inflight.get(key);
    if (p) stats.shared += 1;
    else {
      p = (async () => {
        try {
          await whenVisible(init?.signal);
          stats.sent += 1;
          const r = await base(input, init);
          if (r.status >= 500) failed(key); else failures.delete(key);
          return r;
        } catch (e) {
          if ((e as Error)?.name !== 'AbortError') failed(key);
          throw e;
        } finally { if (!own) inflight.delete(key); }
      })();
      if (!own) inflight.set(key, p);
    }
    return p.then((r) => r.clone());
  };
  return { fetch: shared, stats, inflight, failures };
}

let installed: ReturnType<typeof createFetchShare> | null = null;
/** Wrap window.fetch once (main.tsx). `window.__axfFetchShare` shows the counters in devtools. */
export function installFetchShare() {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return installed;
  installed = createFetchShare(window.fetch.bind(window), document, window.location.origin);
  window.fetch = installed.fetch;
  (window as unknown as { __axfFetchShare: FetchShareStats }).__axfFetchShare = installed.stats;
  return installed;
}

/**
 * lib-hub (web) — the first slice of the axHub connector for AXF apps (Oct 20 2026, Opus).
 *
 * Only what axHub serves today:
 *  - **hub address rules**: a hub is `https://<host>[:port]` and nothing else (no path, query, fragment or user info), so
 *    a typo can never send a session elsewhere; `isHub` checks a link points at exactly that origin;
 *  - **hub URLs**: approvals list, one approval (only for real ids), sign-in (with a safe return path), account, sign-out,
 *    the app catalog, the approvals feed;
 *  - **the approvals feed** `GET /auth/admin/approvals.json` (axHub decision #85): read with the browser's own hub session
 *    cookie (credentials included, redirects refused, reply size capped), mapped to ok / signed-out / not-admin /
 *    unreachable; only items whose link points at the hub are kept, and every link the app uses is built here;
 *  - **seen-id tracking** for "ring once per new approval".
 *
 * The same rules are the Kotlin `ai.amberx.axf.hub.HubRules` (framework/android/lib-hub); both replay
 * `framework/spec/fixtures/hub-approvals.json` (generated from this file by `spec/gen-fixtures.mts`).
 *
 * Not here (parked for Fable): the hub protocol contract AXPP. Its pieces are named placeholders ({@link HUB_PLACEHOLDERS})
 * so later work plugs in without renaming anything.
 */

import { parseSource, type HubSource } from './source';
export const HUB_LIBRARY_ID = 'ai.amberx.axf.hub';
export const HUB_DEFAULT = 'https://axhub.amberxai.com';
/** Largest feed reply read (bytes); anything bigger is refused. */
export const HUB_FEED_MAX_BYTES = 256 * 1024;
/** At most this many waiting items are kept from one reply (the hub sends up to 20). */
export const HUB_FEED_MAX_ITEMS = 50;
/** Seen ids kept for ring-once tracking. */
export const HUB_SEEN_CAP = 200;
export const HUB_FIELD_CAPS = { tool: 120, summary: 600, time: 64 } as const;
export const HUB_PATHS = {
  feed: '/auth/admin/approvals.json',
  approvals: '/auth/admin/approvals',
  login: '/auth/login',
  account: '/auth/account',
  logout: '/auth/logout',
  apps: '/apps',
} as const;
/** User-facing words both ports use for the same outcome. `{status}` is replaced by the HTTP status. */
export const HUB_MESSAGES = {
  answered: 'The hub answered {status}.',
  unexpected: 'The hub sent something unexpected.',
  tooLarge: 'Reply too large.',
  unreachable: "Can't reach the hub.",
} as const;
/** Named placeholders for the parts of the hub contract not built yet (AXPP stays parked for Fable). */
export const HUB_PLACEHOLDERS = [
  { capability: 'axf.hub.axpp', note: 'The hub protocol contract (AXPP): typed calls, jobs and events between an AXF app and axHub. Parked for Fable; not designed here.' },
  { capability: 'axf.hub.push', note: 'Hub-pushed approvals and events instead of polling the feed.' },
  { capability: 'axf.hub.admin-api', note: "The hub's admin API (services, jobs, audit, vault names, users, projects), hub step 4." },
] as const;

const APPROVAL_ID = /^[0-9a-f-]{36}$/;
const HOST = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;
const RETURN_PATH = /^\/[A-Za-z0-9/_.-]*$/;
const APK_PATH = /^\/apps\/download\/[a-z0-9][a-z0-9-]{0,63}\/([A-Za-z0-9][A-Za-z0-9._-]{0,127}\.apk)$/;
const CSRF = /name="csrf" value="([^"]+)"/;
/** Lowercases A–Z only (no locale or Unicode folding), the same on every port. */
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
/** Index where the authority of an `https://` URL ends (first `/`, `?`, `#` or `\` after the scheme), or -1. */
function authorityEnd(rest: string): number {
  let end = -1;
  for (const c of ['/', '?', '#', '\\']) { const i = rest.indexOf(c); if (i >= 0 && (end < 0 || i < end)) end = i; }
  return end;
}

/**
 * The origin of an https URL (`https://host[:port]`, default port dropped, host lowercased), or null. Parsed by hand, the
 * same way on every port: the authority ends at the first `/`, `?`, `#` or `\`; user info, odd characters, IPv6 literals
 * and ports outside 1–65535 are refused.
 */
export function hubOrigin(url: unknown): string | null {
  if (typeof url !== 'string' || asciiLower(url.slice(0, 8)) !== 'https://') return null;
  const rest = url.slice(8);
  const e = authorityEnd(rest);
  const authority = e < 0 ? rest : rest.slice(0, e);
  if (!authority || authority.includes('@')) return null;
  const colon = authority.indexOf(':');
  const rawHost = colon >= 0 ? authority.slice(0, colon) : authority;
  const portText = colon >= 0 ? authority.slice(colon + 1) : '';
  // plain ASCII host names only (checked before lowercasing, so no Unicode case folding can sneak a letter in)
  if (!rawHost || rawHost.length > 253 || !HOST.test(rawHost)) return null;
  const host = rawHost.toLowerCase();
  let port = '';
  if (colon >= 0) {
    if (!/^[0-9]{1,5}$/.test(portText)) return null;
    const n = Number(portText);
    if (n < 1 || n > 65535) return null;
    if (n !== 443) port = `:${n}`;
  }
  return `https://${host}${port}`;
}

/** A hub address as typed or configured → `https://host[:port]`, or null when it is anything more or less than that. */
export function normalizeHub(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // trims spaces and control characters only (the same set on every port), then trailing slashes
  const t = raw.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '').replace(/\/+$/, '');
  const o = hubOrigin(t);
  if (!o) return null;
  // nothing may follow the authority (no path, query or fragment)
  return /[/?#\\]/.test(t.slice(8)) ? null : o;
}

/** True when `url` points at exactly the hub's origin (https, same host, same port). */
export function isHub(base: string, url: unknown): boolean {
  const b = normalizeHub(base);
  const o = hubOrigin(url);
  return b !== null && o !== null && b === o;
}

/* ---------------------------------------------------------------- URLs (base must be a normalized hub address) */

export const approvalsUrl = (base: string) => `${base}${HUB_PATHS.approvals}`;
export const appsUrl = (base: string) => `${base}${HUB_PATHS.apps}`;
export const accountUrl = (base: string) => `${base}${HUB_PATHS.account}`;
export const logoutUrl = (base: string) => `${base}${HUB_PATHS.logout}`;
export const feedUrl = (base: string) => `${base}${HUB_PATHS.feed}`;
export const isApprovalId = (id: unknown): id is string => typeof id === 'string' && APPROVAL_ID.test(id);
/** The hub's single-request page; ids are checked so nothing else can be built into the link. */
export const approvalUrl = (base: string, id: unknown): string | null => (isApprovalId(id) ? `${approvalsUrl(base)}/${id}` : null);
/** The hub's sign-in page, returning to `returnPath` afterwards (a plain path on the hub; anything else → the approvals list). */
export function loginUrl(base: string, returnPath: string = HUB_PATHS.approvals): string {
  const rd = RETURN_PATH.test(returnPath) && !returnPath.startsWith('//') && !returnPath.includes('..') ? returnPath : HUB_PATHS.approvals;
  return `${base}${HUB_PATHS.login}?rd=${rd.replace(/\//g, '%2F')}`;
}

/** The file name of a hub app download (`/apps/download/<project>/<file>.apk` on the hub, no query or fragment), or null. */
export function apkDownloadName(base: string, url: unknown): string | null {
  if (typeof url !== 'string' || !isHub(base, url)) return null;
  const rest = url.slice(8);
  const end = authorityEnd(rest);
  // the path must start right after the authority (a `/` inside a query or fragment doesn't count)
  if (end < 0 || rest[end] !== '/') return null;
  const path = rest.slice(end);
  if (/[?#\\]/.test(path)) return null;
  return APK_PATH.exec(path)?.[1] ?? null;
}

/** The CSRF token in one of the hub's own pages (its sign-out form), or null. */
export const csrfFromPage = (html: unknown): string | null => (typeof html === 'string' ? CSRF.exec(html)?.[1] ?? null : null);

/* ---------------------------------------------------------------- the approvals feed */

export type HubFeedStatus = 'ok' | 'signed-out' | 'not-admin' | 'unreachable';
export const HUB_FEED_STATUSES: readonly HubFeedStatus[] = ['ok', 'signed-out', 'not-admin', 'unreachable'];

/** One call waiting for approval, as the hub's feed lists it; `url` is always built here from the id. */
export interface HubApproval {
  id: string; tool: string; summary: string; createdAt: string; expiresAt: string; url: string;
  /** What it is: the caller's reason title (axHub decision #99), when the hub sent one. */
  title?: string;
  /** Who asked (axHub decision 109), when the hub sent it. */
  source?: HubSource;
}

export interface HubFeed {
  status: HubFeedStatus;
  count: number;
  pending: HubApproval[];
  approvalsUrl: string;
  /** Why it is unreachable ('' otherwise). */
  error: string;
}

const str = (o: Record<string, unknown>, k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null);
const empty = (base: string, status: HubFeedStatus, error = ''): HubFeed => ({ status, count: 0, pending: [], approvalsUrl: approvalsUrl(base), error });

/** A feed outcome for a transport failure (network error, refused redirect, oversized reply). */
export const unreachableFeed = (base: string, error: string = HUB_MESSAGES.unreachable): HubFeed => empty(base, 'unreachable', error);

/**
 * What a reply from the feed means. 401 → signed-out, 403 → not-admin, 200 → the list (a body saying `signedIn: false` /
 * `admin: false` maps the same way), anything else → unreachable. Items need a real approval id and a `url` pointing at
 * the hub (only links pointing at the hub are used; the link itself is rebuilt from the id), duplicates are dropped,
 * fields are capped. `count` is the hub's number when it is one (never less than the items kept).
 */
export function interpretFeed(base: string, status: number, body: string): HubFeed {
  if (status === 401) return empty(base, 'signed-out');
  if (status === 403) return empty(base, 'not-admin');
  if (status !== 200) return empty(base, 'unreachable', HUB_MESSAGES.answered.replace('{status}', String(status)));
  let o: unknown;
  try { o = JSON.parse(body); } catch { return empty(base, 'unreachable', HUB_MESSAGES.unexpected); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return empty(base, 'unreachable', HUB_MESSAGES.unexpected);
  const j = o as Record<string, unknown>;
  if (j.signedIn === false) return empty(base, 'signed-out');
  if (j.admin === false) return empty(base, 'not-admin');
  const pending: HubApproval[] = [];
  const ids = new Set<string>();
  for (const e of Array.isArray(j.pending) ? j.pending : []) {
    if (pending.length >= HUB_FEED_MAX_ITEMS) break;
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const p = e as Record<string, unknown>;
    const id = str(p, 'id');
    const url = id === null ? null : approvalUrl(base, id);
    if (id === null || url === null || ids.has(id)) continue;
    if (!isHub(base, p.url)) continue;
    ids.add(id);
    pending.push({
      id,
      tool: (str(p, 'tool') ?? 'call').slice(0, HUB_FIELD_CAPS.tool),
      summary: (str(p, 'summary') ?? '').slice(0, HUB_FIELD_CAPS.summary),
      createdAt: (str(p, 'createdAt') ?? '').slice(0, HUB_FIELD_CAPS.time),
      expiresAt: (str(p, 'expiresAt') ?? '').slice(0, HUB_FIELD_CAPS.time),
      url,
      ...titleAndSource(p),
    });
  }
  const c = typeof j.count === 'number' && Number.isFinite(j.count) ? Math.min(1_000_000, Math.max(0, Math.floor(j.count))) : pending.length;
  return { status: 'ok', count: Math.max(c, pending.length), pending, approvalsUrl: approvalsUrl(base), error: '' };
}

/** The reason title and the source of one entry, only when the hub sent them (older hubs: neither). */
function titleAndSource(p: Record<string, unknown>): Pick<HubApproval, 'title' | 'source'> {
  const title = (str(p, 'title') ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, HUB_FIELD_CAPS.summary);
  const source = parseSource(p.source);
  return { ...(title ? { title } : {}), ...(source ? { source } : {}) };
}

/* ---------------------------------------------------------------- ring once per new approval */

export interface SeenPlan { fresh: string[]; gone: string[]; next: string[] }

/**
 * Which waiting ids are new (alert them), which seen ids are gone (decided elsewhere or expired: clear their alerts), and the
 * seen list to keep (still-waiting seen ids + the new ones, last {@link HUB_SEEN_CAP}).
 */
export function seenPlan(seen: readonly string[], current: readonly string[], cap: number = HUB_SEEN_CAP): SeenPlan {
  const cur = [...new Set(current)];
  const was = [...new Set(seen)];
  const fresh = cur.filter((id) => !was.includes(id));
  const gone = was.filter((id) => !cur.includes(id));
  const keep = [...was.filter((id) => cur.includes(id)), ...fresh];
  const next = cap > 0 ? keep.slice(-cap) : [];
  return { fresh, gone, next };
}

/* ---------------------------------------------------------------- the client */

export type HubFetch = (input: string, init: RequestInit) => Promise<Response>;

/** Reads a reply body up to `max` bytes; null when it is bigger. */
export async function readCapped(r: Response, max: number = HUB_FEED_MAX_BYTES): Promise<string | null> {
  if (!r.body) { const t = await r.text(); return new TextEncoder().encode(t).length > max ? null : t; }
  const reader = r.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { void reader.cancel().catch(() => undefined); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(all);
}

/**
 * Reads the approvals feed with the browser's own hub session (credentials included; the app's server never sees the
 * session). Redirects are refused and the reply is size-capped. Read-only: approving happens on the hub's own page.
 */
export async function fetchHubFeed(base: string, opts: { fetch?: HubFetch } = {}): Promise<HubFeed> {
  const hub = normalizeHub(base);
  if (!hub) return unreachableFeed(HUB_DEFAULT, HUB_MESSAGES.unreachable);
  const f: HubFetch = opts.fetch ?? ((u, i) => fetch(u, i));
  let r: Response;
  try {
    r = await f(feedUrl(hub), { credentials: 'include', cache: 'no-store', redirect: 'error' });
  } catch (e) {
    return unreachableFeed(hub, ((e as Error)?.message || HUB_MESSAGES.unreachable).slice(0, 120));
  }
  if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) return interpretFeed(hub, r.status || 302, '');
  if (r.status !== 200) return interpretFeed(hub, r.status, '');
  let body: string | null;
  try { body = await readCapped(r); } catch (e) { return unreachableFeed(hub, ((e as Error)?.message || HUB_MESSAGES.unreachable).slice(0, 120)); }
  if (body === null) return unreachableFeed(hub, HUB_MESSAGES.tooLarge);
  return interpretFeed(hub, 200, body);
}

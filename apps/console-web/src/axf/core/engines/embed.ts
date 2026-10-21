/**
 * Embed engine (embed@1) — an app running inside another app's frame.
 *
 * A host app (Patches: one banner, the Dev Console / Build Pilot / axHub in tabs) marks the pages it embeds, and the
 * embedded app hides the chrome the host already shows (its banner by default), so there is one banner on screen.
 * Standalone, the same app keeps its own banner. Nothing is stored: the marker rides on every page load.
 *
 * The marker, two carriers (the query wins when both are present):
 *   query        ?axf-embed=<host>[&axf-embed-hide=<type>[,<type>]]        (a browser tab, tests, a frame src)
 *   user agent   AXF-Embed/<host>[/<type>[+<type>]]                        (a WebView: survives sign-in redirects and SPA routing)
 * `<host>` is a short id (`[a-z0-9][a-z0-9-]{0,31}`); the types are hideable chrome types (asset-types.json → hideable);
 * unknown or non-hideable types are dropped; none named = `DEFAULT_HIDDEN`. A marker without a valid host is no marker.
 *
 * The embedded app applies `hidden` as a forced layer over its hide engine (hide.ts → hiddenSlots(overrides, defaults,
 * forced)): the user's "show the banner" choice can't bring the host's banner back while embedded, and the choice itself
 * is left untouched for when the app runs on its own.
 *
 * Pure; the Kotlin kernel mirrors it as EmbedEngine (fixture spec/fixtures/embed.json). The host side (Patches) uses
 * `userAgentSuffix` / `embedUrl` to mark what it loads; the guest side uses `detectEmbed`.
 */
import { hideable, hideableTypes } from './hide';

export interface Embed {
  /** the host app's id, e.g. `patches` */
  host: string;
  /** chrome the host shows for the app (hideable types only, spec order); forced hidden while embedded */
  hidden: string[];
}

export const EMBED_QUERY = 'axf-embed';
export const EMBED_HIDE_QUERY = 'axf-embed-hide';
export const EMBED_UA_TOKEN = 'AXF-Embed';
/** What a host hides in the apps it embeds unless it says otherwise: the banner (one banner on screen, the host's). */
export const DEFAULT_HIDDEN: readonly string[] = ['banner'];

const HOST_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** A valid host id, lower-cased, or null. */
export function embedHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().toLowerCase();
  return HOST_ID.test(id) ? id : null;
}

/** The word a host uses to hide nothing (`axf-embed-hide=none`, `AXF-Embed/<host>/none`). */
export const HIDE_NONE = 'none';

/**
 * The types a host names, cleaned: hideable only, spec order, no repeats. Nothing named, or nothing valid named, = the
 * default (a host that misspells a type still gets one banner on screen); `none` = hide nothing.
 */
export function embedHidden(named: readonly string[] | string | null | undefined): string[] {
  const list = (typeof named === 'string' ? named.split(/[,+ ]/) : named ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (list.includes(HIDE_NONE)) return [];
  const wanted = new Set(list.filter(hideable));
  const out = hideableTypes().filter((t) => wanted.has(t));
  return out.length > 0 ? out : hideableTypes().filter((t) => DEFAULT_HIDDEN.includes(t));
}

/** The marker in a page's query string (`?axf-embed=…`), or null. Takes `location.search` or any query string. */
export function embedFromQuery(search: string | null | undefined): Embed | null {
  if (!search) return null;
  let params: URLSearchParams;
  try { params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search); } catch { return null; }
  const host = embedHost(params.get(EMBED_QUERY));
  if (!host) return null;
  return { host, hidden: embedHidden(params.get(EMBED_HIDE_QUERY)) };
}

/** The marker in a user-agent string (`AXF-Embed/<host>[/<type>+<type>]`), or null. */
export function embedFromUserAgent(ua: string | null | undefined): Embed | null {
  if (!ua) return null;
  const m = new RegExp(`(?:^|[\\s(;,])${EMBED_UA_TOKEN}/([^\\s/;),]+)(?:/([^\\s;),]+))?`).exec(ua);
  if (!m) return null;
  const host = embedHost(m[1]);
  if (!host) return null;
  return { host, hidden: embedHidden(m[2] ?? null) };
}

/** The embed an app runs in: the query marker, else the user-agent marker, else null (standalone). */
export function detectEmbed(search: string | null | undefined, userAgent: string | null | undefined): Embed | null {
  return embedFromQuery(search) ?? embedFromUserAgent(userAgent);
}

/** Host side: the user-agent suffix a host's web views append (`AXF-Embed/<host>` [+ `/<type>+<type>` when not the default]). */
export function userAgentSuffix(host: string, hidden: readonly string[] = DEFAULT_HIDDEN): string {
  const id = embedHost(host);
  if (!id) throw new Error(`embed: bad host id "${host}"`);
  const types = embedHidden(hidden);
  if (isDefault(types)) return `${EMBED_UA_TOKEN}/${id}`;
  return `${EMBED_UA_TOKEN}/${id}/${types.length === 0 ? HIDE_NONE : types.join('+')}`;
}

function isDefault(types: readonly string[]): boolean {
  const dflt = embedHidden([]);
  return types.length === dflt.length && types.every((t, i) => t === dflt[i]);
}

/** Host side: a page URL with the query marker added (existing `axf-embed*` params replaced; hash kept). */
export function embedUrl(url: string, host: string, hidden: readonly string[] = DEFAULT_HIDDEN): string {
  const id = embedHost(host);
  if (!id) throw new Error(`embed: bad host id "${host}"`);
  const hashAt = url.indexOf('#');
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const noHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const qAt = noHash.indexOf('?');
  const path = qAt >= 0 ? noHash.slice(0, qAt) : noHash;
  const params = new URLSearchParams(qAt >= 0 ? noHash.slice(qAt + 1) : '');
  params.delete(EMBED_QUERY);
  params.delete(EMBED_HIDE_QUERY);
  params.set(EMBED_QUERY, id);
  const types = embedHidden(hidden);
  if (!isDefault(types)) params.set(EMBED_HIDE_QUERY, types.length === 0 ? HIDE_NONE : types.join(','));
  return `${path}?${params.toString().replace(/%2C/gi, ',')}${hash}`;
}

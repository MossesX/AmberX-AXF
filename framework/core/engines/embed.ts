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
  /** app functions the host takes over (`settings`, `notifications`, …; see `registerEmbedTake`); absent = none */
  takes?: string[];
  /** the one page the host shows on its own (`settings`); absent = the whole app. All chrome is hidden on it. */
  page?: string;
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

/* ---------------------------------------------------------------------------------------------------------------
 * What a host takes over (embed@1 `takes`, Brett Oct 21 2026: "when console, pilot or axhub are running inside
 * Patches remove settings hooks from the apps and combine all 3 apps' settings … into a single settings interface").
 *
 * A host may take app functions over from the apps it embeds. The embedded app then drops its own hooks for that
 * function (menu items, toolbar buttons, nav entries, widgets, context items) and hands any request that still reaches
 * it (a search hit, a deep link, a plugin calling `app.settings`) to the host as a message instead.
 *
 *   query        &axf-embed-take=<fn>[,<fn>]          user agent   AXF-Embed-Take/<fn>[+<fn>]   (its own token)
 *
 * Functions are an open registry (`registerEmbedTake`); unknown names are dropped, `none` = nothing taken, nothing
 * named = nothing taken (old hosts keep working unchanged).
 *
 * Page mode: a host shows one page of the app on its own (`&axf-embed-page=<fn>`, query only: it belongs to one URL),
 * e.g. the app's settings inside the host's combined settings. On that page the app's chrome is all hidden and the
 * page's own function is never taken (the settings page must open its own tabs).
 * --------------------------------------------------------------------------------------------------------------- */

export const EMBED_TAKE_QUERY = 'axf-embed-take';
export const EMBED_PAGE_QUERY = 'axf-embed-page';
export const EMBED_TAKE_UA_TOKEN = 'AXF-Embed-Take';

/** One function a host can take over: the actions, action prefixes, views and app-menu live lists that are its hooks. */
export interface EmbedTakeSpec {
  /** exact action ids that are this function's hooks */
  actions: string[];
  /** action prefixes (`settings.open:` covers every settings tab) */
  prefixes: string[];
  /** views that are this function (navigating to one asks the host instead) */
  views: string[];
  /** app-menu live lists that list this function's pages */
  providers: string[];
  /** can the host show this function as a page on its own (`axf-embed-page=<id>`)? */
  page: boolean;
  /** chrome the app hides while the host takes this function (the app menu: the host's menu carries it instead) */
  hides: string[];
}

const TAKES = new Map<string, EmbedTakeSpec>([
  ['settings', { actions: ['app.settings', 'settings.open', 'nav:settings'], prefixes: ['settings.open:'], views: ['settings'], providers: ['settings'], page: true, hides: [] }],
  // The host shows the app's notifications (Patches on Android): the app hands them over instead of posting its own.
  ['notifications', { actions: [], prefixes: [], views: [], providers: [], page: false, hides: [] }],
  // The host's application menu carries the app's (Brett, Oct 22 2026: "all app menus are inherited by Patches' menu and
  // the apps in tabs hide theirs"): the app hides its own menu bar and sends its menu to the host (`menu` message); the
  // host runs a picked item back in the app (`run` message).
  ['app-menu', { actions: [], prefixes: [], views: [], providers: [], page: false, hides: ['app-menu'] }],
]);

/** Add (or replace) a function hosts can take over. Same id on every port (the Kotlin twin keeps the same registry). */
export function registerEmbedTake(id: string, spec: Partial<EmbedTakeSpec>): void {
  if (!HOST_ID.test(id) || id === HIDE_NONE) throw new Error(`embed: bad function id "${id}"`);
  TAKES.set(id, { actions: [...(spec.actions ?? [])], prefixes: [...(spec.prefixes ?? [])], views: [...(spec.views ?? [])], providers: [...(spec.providers ?? [])], page: spec.page === true, hides: [...(spec.hides ?? [])] });
}

/** Functions a host can take over, in registry order. */
export function embedTakeIds(): string[] { return [...TAKES.keys()]; }

/** The spec of one function, or null. */
export function embedTakeSpec(id: string): EmbedTakeSpec | null { return TAKES.get(id) ?? null; }

/** The functions a host names, cleaned: known only, registry order, no repeats; nothing / `none` = nothing taken. */
export function embedTakes(named: readonly string[] | string | null | undefined): string[] {
  const list = (typeof named === 'string' ? named.split(/[,+ ]/) : named ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  if (list.includes(HIDE_NONE)) return [];
  const wanted = new Set(list);
  return embedTakeIds().filter((t) => wanted.has(t));
}

/** A page a host may show on its own (a known function with `page: true`), or null. */
export function embedPage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().toLowerCase();
  return TAKES.get(id)?.page ? id : null;
}

/** Put takes + page on an embed: only when set (an embed without them keeps its old shape), page's own function never taken. */
function withExtras(e: Embed, takes: string[], page: string | null): Embed {
  const t = page ? takes.filter((x) => x !== page) : takes;
  // a taken function may hide chrome too (app-menu: the host's menu carries the app's); spec order, like embedHidden
  const extra = new Set(t.flatMap((fn) => TAKES.get(fn)?.hides ?? []));
  const hidden = page ? [...hideableTypes()] : extra.size ? hideableTypes().filter((x) => e.hidden.includes(x) || extra.has(x)) : e.hidden;
  const out: Embed = { host: e.host, hidden };
  if (t.length) out.takes = t;
  if (page) out.page = page;
  return out;
}

/** The full marker in a query string: host, hidden chrome, functions taken, page. */
export function embedFromQueryFull(search: string | null | undefined): Embed | null {
  const base = embedFromQuery(search);
  if (!base) return null;
  const params = new URLSearchParams(search!.startsWith('?') ? search!.slice(1) : search!);
  return withExtras(base, embedTakes(params.get(EMBED_TAKE_QUERY)), embedPage(params.get(EMBED_PAGE_QUERY)));
}

/** The full marker in a user agent: host, hidden chrome and the functions taken (`AXF-Embed-Take/…`). */
export function embedFromUserAgentFull(ua: string | null | undefined): Embed | null {
  const base = embedFromUserAgent(ua);
  if (!base) return null;
  const m = new RegExp(`(?:^|[\\s(;,])${EMBED_TAKE_UA_TOKEN}/([^\\s;),]+)`).exec(ua!);
  return withExtras(base, embedTakes(m ? m[1] : null), null);
}

/**
 * The embed an app runs in, with what the host takes over: the query marker, else the user-agent marker. When the
 * query marker wins and names no takes of its own, the user agent's takes still apply (a WebView host marks every
 * request; a page URL it builds may add a page).
 */
export function detectEmbedFull(search: string | null | undefined, userAgent: string | null | undefined): Embed | null {
  const q = embedFromQueryFull(search);
  const u = embedFromUserAgentFull(userAgent);
  if (!q) return u;
  if (q.takes || !u?.takes || u.host !== q.host) return q;
  const params = new URLSearchParams(search!.startsWith('?') ? search!.slice(1) : search!);
  return withExtras(q, u.takes, embedPage(params.get(EMBED_PAGE_QUERY)));
}

/** Does the host take this function over? */
export function embedTakesFn(e: Embed | null | undefined, fn: string): boolean { return !!e?.takes?.includes(fn); }

/** Is this action one of a taken function's hooks? Returns the function id, or null. */
export function embedTakenBy(e: Embed | null | undefined, action: string | null | undefined): string | null {
  if (!e?.takes?.length || typeof action !== 'string' || !action) return null;
  for (const fn of e.takes) {
    const s = TAKES.get(fn);
    if (!s) continue;
    if (s.actions.includes(action) || s.prefixes.some((p) => action.startsWith(p))) return fn;
    if (action.startsWith('nav:') && s.views.includes(action.slice(4))) return fn;
  }
  return null;
}

/** Is this view one a taken function owns? Returns the function id, or null. */
export function embedTakenView(e: Embed | null | undefined, view: string | null | undefined): string | null {
  if (!e?.takes?.length || typeof view !== 'string') return null;
  for (const fn of e.takes) if (TAKES.get(fn)?.views.includes(view)) return fn;
  return null;
}

/** Is this app-menu live list one a taken function owns? */
export function embedTakenProvider(e: Embed | null | undefined, provider: string | null | undefined): string | null {
  if (!e?.takes?.length || typeof provider !== 'string') return null;
  for (const fn of e.takes) if (TAKES.get(fn)?.providers.includes(provider)) return fn;
  return null;
}

/** Host side: user-agent suffix with the functions it takes (`AXF-Embed/<host>[/…] AXF-Embed-Take/<fn>+<fn>`). */
export function userAgentSuffixFull(host: string, hidden: readonly string[] = DEFAULT_HIDDEN, takes: readonly string[] = []): string {
  const base = userAgentSuffix(host, hidden);
  const t = embedTakes(takes);
  return t.length ? `${base} ${EMBED_TAKE_UA_TOKEN}/${t.join('+')}` : base;
}

/** Host side: a page URL with the full marker (host, hidden, takes, page); old `axf-embed*` params replaced. */
export function embedUrlFull(url: string, host: string, opts: { hidden?: readonly string[]; takes?: readonly string[]; page?: string | null } = {}): string {
  const base = embedUrl(url, host, opts.hidden ?? DEFAULT_HIDDEN);
  const hashAt = base.indexOf('#');
  const hash = hashAt >= 0 ? base.slice(hashAt) : '';
  const noHash = hashAt >= 0 ? base.slice(0, hashAt) : base;
  const qAt = noHash.indexOf('?');
  const params = new URLSearchParams(noHash.slice(qAt + 1));
  params.delete(EMBED_TAKE_QUERY);
  params.delete(EMBED_PAGE_QUERY);
  const page = embedPage(opts.page ?? null);
  const takes = embedTakes(opts.takes ?? []).filter((t) => t !== page);
  if (takes.length) params.set(EMBED_TAKE_QUERY, takes.join(','));
  if (page) params.set(EMBED_PAGE_QUERY, page);
  return `${noHash.slice(0, qAt)}?${params.toString().replace(/%2C/gi, ',')}${hash}`;
}

/* ---------------------------------------------------------------------------------------------------------------
 * Messages between a host and the apps it embeds (embed@1). Plain JSON, checked on both ends, never trusted for more
 * than asking: a guest asks the host to open its settings or show a notification; the host asks a settings page to
 * open one of its tabs. Web: window.postMessage (the host checks the sender's origin against its tabs; the guest
 * checks the message came from its parent). Android: the guest calls the host's JS bridge `AxfEmbedHost.post(json)`.
 * --------------------------------------------------------------------------------------------------------------- */

export const EMBED_MESSAGE = 'embed@1';

export type EmbedMessage =
  /** guest → host: open the combined settings on this app's tab (and its `tab` inside it) */
  | { $axf: typeof EMBED_MESSAGE; type: 'open-settings'; tab?: string }
  /** guest → host: show a notification for this app (the host takes notifications) */
  | { $axf: typeof EMBED_MESSAGE; type: 'notify'; title: string; body?: string; tag?: string; level?: 'info' | 'success' | 'warning' | 'error'; link?: string }
  /** guest → host: the app is up (and what it takes no longer matters to the host) */
  | { $axf: typeof EMBED_MESSAGE; type: 'ready'; app?: string }
  /** host → settings page: open this settings tab */
  | { $axf: typeof EMBED_MESSAGE; type: 'open-tab'; tab: string }
  /** guest → host (the host takes `app-menu`): the app's application menu, as the host should show it */
  | { $axf: typeof EMBED_MESSAGE; type: 'menu'; menus: EmbedMenu[] }
  /** host → guest: send your menu now (the host just loaded, or the user is opening its menu) */
  | { $axf: typeof EMBED_MESSAGE; type: 'menu-request' }
  /** host → guest: the user picked this item of your menu in the host's menu; run it */
  | { $axf: typeof EMBED_MESSAGE; type: 'run'; id: string };

/**
 * One item of a menu an app sends its host. Data only: no action ids cross over. The app keeps id → action and runs
 * the item itself when the host sends `run` back, so the host can never make the app run anything it didn't offer.
 */
export interface EmbedMenuItem {
  id: string;
  label: string;
  icon?: string;
  /** a divider line (no label needed) */
  separator?: boolean;
  /** greyed out (the app's access policy locks it) */
  locked?: boolean;
  /** check mark state (true / false); absent = not a checkable item */
  check?: boolean;
  /** a count badge */
  count?: number;
  /** a submenu */
  items?: EmbedMenuItem[];
}
export interface EmbedMenu { id: string; label: string; items: EmbedMenuItem[] }

export const EMBED_MESSAGE_LIMITS = { title: 120, body: 500, tag: 64, tab: 64, app: 32, link: 300, raw: 4000, menuRaw: 131072, menus: 16, menuItems: 600, menuDepth: 4, label: 80, itemId: 160, icon: 40 } as const;
const MENU_ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,159}$/;
const ICON_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** A menu an app sent, checked and cut to size (limits above; bad entries dropped, never the whole menu). */
function parseMenus(raw: unknown): EmbedMenu[] | null {
  if (!Array.isArray(raw)) return null;
  const L = EMBED_MESSAGE_LIMITS;
  let budget = L.menuItems;
  const item = (v: unknown, depth: number): EmbedMenuItem | null => {
    if (budget <= 0 || !v || typeof v !== 'object' || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.id !== 'string' || !MENU_ITEM_ID.test(o.id)) return null;
    if (o.separator === true) { budget--; return { id: o.id, label: '', separator: true }; }
    const label = clip(o.label, L.label);
    if (!label) return null;
    budget--;
    const out: EmbedMenuItem = { id: o.id, label };
    if (typeof o.icon === 'string' && ICON_ID.test(o.icon)) out.icon = o.icon;
    if (o.locked === true) out.locked = true;
    if (typeof o.check === 'boolean') out.check = o.check;
    if (typeof o.count === 'number' && Number.isFinite(o.count) && o.count > 0) out.count = Math.min(Math.floor(o.count), 99999);
    if (Array.isArray(o.items) && depth < L.menuDepth) {
      const kids = o.items.map((k) => item(k, depth + 1)).filter((k): k is EmbedMenuItem => !!k);
      if (kids.length) out.items = kids;
    }
    return out;
  };
  const menus: EmbedMenu[] = [];
  for (const m of raw.slice(0, L.menus)) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
    const o = m as Record<string, unknown>;
    const label = clip(o.label, L.label);
    if (typeof o.id !== 'string' || !MENU_ITEM_ID.test(o.id) || !label || !Array.isArray(o.items)) continue;
    const items = o.items.map((k) => item(k, 1)).filter((k): k is EmbedMenuItem => !!k);
    if (items.length) menus.push({ id: o.id, label, items });
  }
  return menus;
}
const TAB_ID = /^[a-z0-9][a-z0-9._:-]{0,63}$/i;
const LEVELS = ['info', 'success', 'warning', 'error'] as const;

function clip(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
}

/** A link a notification may carry: https, or an in-app `view:<id>` / `settings:<tab>`. */
export function embedLinkOk(link: unknown): link is string {
  if (typeof link !== 'string' || !link || link.length > EMBED_MESSAGE_LIMITS.link) return false;
  if (/^(view|settings):[a-z0-9][a-z0-9._:-]{0,63}$/i.test(link)) return true;
  try { const u = new URL(link); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
}

/** A message as it arrived (object or JSON text), checked and cut to size; null when it isn't one. */
export function parseEmbedMessage(raw: unknown): EmbedMessage | null {
  let m: unknown = raw;
  if (typeof raw === 'string') {
    // a menu may be long; every other message stays small
    if (raw.length > EMBED_MESSAGE_LIMITS.menuRaw) return null;
    try { m = JSON.parse(raw); } catch { return null; }
    if (raw.length > EMBED_MESSAGE_LIMITS.raw && (m as { type?: unknown } | null)?.type !== 'menu') return null;
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  if (o.$axf !== EMBED_MESSAGE) return null;
  switch (o.type) {
    case 'open-settings': {
      const tab = typeof o.tab === 'string' && TAB_ID.test(o.tab) ? o.tab : undefined;
      return tab ? { $axf: EMBED_MESSAGE, type: 'open-settings', tab } : { $axf: EMBED_MESSAGE, type: 'open-settings' };
    }
    case 'notify': {
      const title = clip(o.title, EMBED_MESSAGE_LIMITS.title);
      if (!title) return null;
      const out: EmbedMessage = { $axf: EMBED_MESSAGE, type: 'notify', title };
      const body = clip(o.body, EMBED_MESSAGE_LIMITS.body); if (body) out.body = body;
      const tag = typeof o.tag === 'string' && TAB_ID.test(o.tag) ? o.tag : undefined; if (tag) out.tag = tag;
      if (typeof o.level === 'string' && (LEVELS as readonly string[]).includes(o.level)) out.level = o.level as (typeof LEVELS)[number];
      if (embedLinkOk(o.link)) out.link = o.link;
      return out;
    }
    case 'ready': {
      const app = embedHost(o.app);
      return app ? { $axf: EMBED_MESSAGE, type: 'ready', app } : { $axf: EMBED_MESSAGE, type: 'ready' };
    }
    case 'open-tab': {
      return typeof o.tab === 'string' && TAB_ID.test(o.tab) ? { $axf: EMBED_MESSAGE, type: 'open-tab', tab: o.tab } : null;
    }
    case 'menu': {
      const menus = parseMenus(o.menus);
      return menus ? { $axf: EMBED_MESSAGE, type: 'menu', menus } : null;
    }
    case 'menu-request': return { $axf: EMBED_MESSAGE, type: 'menu-request' };
    case 'run': {
      return typeof o.id === 'string' && MENU_ITEM_ID.test(o.id) ? { $axf: EMBED_MESSAGE, type: 'run', id: o.id } : null;
    }
    default: return null;
  }
}

/** The settings tab an action names (`settings.open:<tab>` → tab), else undefined. */
export function settingsTabOf(action: string): string | undefined {
  const t = /^settings\.open:([^:\s]+)/.exec(action)?.[1];
  return t && TAB_ID.test(t) ? t : undefined;
}

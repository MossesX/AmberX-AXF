/**
 * open-url-route@1 — how a page asked for by Amber reaches Brett's screen (pure, IO-free).
 *
 * Brett, Nov 16 2026: "It sent a notification, but it didn't open. I have the browser open right now." Three things open
 * pages for him and each decided on its own: the console's wake path (console-commands `wake.py` asks axHub to run
 * `amberx.open_url`), axHub's device relay, and the AmberX phone app (`OpenUrlRules` / `AxppLink`: overlay, Chrome, or a
 * notification). Chrome was in front with the console in it, AmberX sat in the background with no "Display over other
 * apps", Android dropped the background start and the fallback notification went out. This module is the one rule set
 * all three share: every route in order, what makes each one eligible, and one result shape.
 *
 *   routes, in order:
 *     console-tab          a connected console tab that is on screen takes the command and navigates in place
 *     overlay              AmberX's always-on toolbar expands into its full-screen browser (Display over other apps on)
 *     direct               AmberX starts the browser itself: allowed when it is in front, or exempt from Android's
 *                          background-start rule because Display over other apps is granted
 *     full-screen-intent   the phone is locked: a full-screen notification opens the page the moment the screen wakes
 *     notification         a high-priority notification whose tap opens the page (the last resort, never "opened")
 *
 *   open-url-request@1 = { url, hosts, where, browser, console: { connected, visible, origin, ageMs }, phone: { paired,
 *                          inFront, overlay, overlayReady, notifications, fullScreenIntent, locked }, foreground }
 *   open-url-plan@1    = { url, routes: [{ route, try, reason }] }        every route, in order, with why it is tried or skipped
 *   open-url-result@1  = { route, opened, reason, notified, tried }     what happened; `opened` is true only for a route
 *                        Android cannot have dropped without a trace (a notification is never "opened")
 *
 * Host sides (the console server, axHub's relay, the AmberX app) call `plan` / `decide`, try the route, and on a failed
 * attempt ask `next`; `settle` turns the attempts into the result; `fromPhoneAnswer` reads the AXPP answer the phone
 * already sends ({ opened, notified, overlay, where }) into the same shape. Reasons are codes; `message` gives the words.
 */

export const SCHEMA = 'open-url-route@1';
export const REQUEST = 'open-url-request@1';
export const PLAN = 'open-url-plan@1';
export const RESULT = 'open-url-result@1';
export const VERSION = 1;

/** Every route, in the order it is tried. `none` is the result when nothing could be tried. */
export const ROUTES = Object.freeze(['console-tab', 'overlay', 'direct', 'full-screen-intent', 'notification']);
/** Whether a route that succeeded counts as "opened" (the page is on screen with no tap from Brett). */
export const OPENS = Object.freeze({ 'console-tab': true, overlay: true, direct: true, 'full-screen-intent': true, notification: false });
/** Where the caller wants the page: auto tries everything in order; the others narrow the list (see `plan`). */
export const WHERE = Object.freeze(['auto', 'console', 'overlay', 'browser']);
export const BROWSERS = Object.freeze(['chrome', 'default']);
/** What the phone says is on its screen (best effort; a connected console tab's own `visible` outranks it). */
export const FOREGROUNDS = Object.freeze(['console', 'browser', 'amberx', 'other', 'unknown']);
/** Brett's own sites: the only hosts a page may be opened on (host or any subdomain), https only. */
export const DEFAULT_HOSTS = Object.freeze(['amberxai.com']);
export const MAX_URL = 2000;
/** A console client older than this (no hello / heartbeat) is treated as gone; mirrors console-commands' CONSOLE_CLIENT_STALE_MS. */
export const CONSOLE_STALE_MS = 45_000;

/** Reason codes and their plain words. Success codes name the route that opened; the rest say why a route was skipped or failed. */
export const REASONS = Object.freeze({
  'console-visible': 'the console tab on screen took it and opened the page',
  'overlay-open': 'AmberX opened it full screen in its overlay',
  'direct-start': 'AmberX started the browser on the page',
  'screen-locked-open': 'the phone is locked; the full-screen notice opens the page as the screen wakes',
  'tap-to-open': 'Android held the browser back: AmberX\'s notification opens the page with one tap',
  'url-refused': 'the address is not one of Brett\'s own https pages',
  'no-console': 'no console tab is connected',
  'console-stale': 'the console tab stopped answering',
  'console-behind': 'the console tab is connected but not on screen',
  'console-other-origin': 'the connected console is not the site the page is on',
  'asked-elsewhere': 'the caller asked for another place',
  'console-only': 'the caller asked for the console tab only',
  'no-phone': 'no AmberX phone is paired',
  'overlay-off': 'Display over other apps is off on the phone',
  'overlay-not-ready': 'AmberX\'s toolbar is not on screen',
  'background-start-blocked': 'Android blocks a browser start from the background while Display over other apps is off and AmberX is not in front',
  'phone-unlocked': 'the phone is unlocked, so a full-screen notice would only show as a banner',
  'no-full-screen-intent': 'AmberX may not use full-screen notices on this phone',
  'notifications-off': 'AmberX\'s notifications are off',
  'attempt-failed': 'the route was tried and failed',
  'nothing-left': 'every route was skipped or failed',
});

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bool = (v, d = false) => (typeof v === 'boolean' ? v : d);
const tri = (v) => (typeof v === 'boolean' ? v : null);
const num = (v, d = 0) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : d);
const pick = (v, list, d) => (list.includes(v) ? v : d);

/** True when `host` is one of the allowed hosts or a subdomain of one. */
export function ownHost(host, hosts = DEFAULT_HOSTS) {
  const h = str(host, 300).toLowerCase();
  if (!h || h.endsWith('.')) return false;
  return normHosts(hosts).some((d) => h === d || h.endsWith(`.${d}`));
}
export function normHosts(hosts) {
  const out = [...new Set((Array.isArray(hosts) ? hosts : []).map((h) => str(h, 253).toLowerCase().replace(/^\.+|\.+$/g, '')).filter(Boolean))];
  return out.length ? out : [...DEFAULT_HOSTS];
}

/**
 * The URL when it may be opened, else why not: https, one of the allowed hosts, no user info, the default port, at most
 * MAX_URL characters. The same checks as the phone's OpenUrlRules and axHub's relay; `url` is the normalised form.
 */
export function allowedUrl(raw, hosts = DEFAULT_HOSTS) {
  const s = str(raw, MAX_URL + 1);
  if (!s) return { ok: false, url: '', reason: 'url-refused', detail: 'url is required' };
  if (s.length > MAX_URL) return { ok: false, url: '', reason: 'url-refused', detail: 'url is too long' };
  let u;
  try { u = new URL(s); } catch { return { ok: false, url: '', reason: 'url-refused', detail: 'url is not a valid address' }; }
  if (u.protocol !== 'https:') return { ok: false, url: '', reason: 'url-refused', detail: 'only https pages can be opened' };
  if (u.username || u.password) return { ok: false, url: '', reason: 'url-refused', detail: 'url cannot carry a user name or password' };
  if (u.port) return { ok: false, url: '', reason: 'url-refused', detail: 'url cannot name a port' };
  if (!ownHost(u.hostname, hosts)) return { ok: false, url: '', reason: 'url-refused', detail: `AmberX only opens Brett's own sites (${normHosts(hosts).join(', ')}), not "${u.hostname}"` };
  return { ok: true, url: u.toString(), reason: '', detail: '' };
}

/** The request as every host sees it: unknown fields dropped, every flag with its default (nothing assumed to be on). */
export function normRequest(raw) {
  const r = isObj(raw) ? raw : {};
  const c = isObj(r.console) ? r.console : {};
  const p = isObj(r.phone) ? r.phone : {};
  return {
    $axf: REQUEST,
    url: str(r.url, MAX_URL + 1),
    hosts: normHosts(r.hosts),
    where: pick(r.where, WHERE, 'auto'),
    browser: pick(r.browser, BROWSERS, 'chrome'),
    console: { connected: bool(c.connected), visible: tri(c.visible), origin: str(c.origin, 300).toLowerCase().replace(/\/+$/, ''), ageMs: num(c.ageMs) },
    phone: { paired: bool(p.paired), inFront: bool(p.inFront), overlay: bool(p.overlay), overlayReady: bool(p.overlayReady), notifications: bool(p.notifications), fullScreenIntent: bool(p.fullScreenIntent), locked: bool(p.locked) },
    foreground: pick(r.foreground, FOREGROUNDS, 'unknown'),
  };
}

const originOf = (url) => { try { return new URL(url).origin.toLowerCase(); } catch { return ''; } };

/** Why one route is skipped for this request, or '' when it is to be tried. */
export function skipReason(route, req) {
  const q = normRequest(req);
  const w = q.where; const c = q.console; const p = q.phone;
  if (route === 'console-tab') {
    if (w === 'overlay' || w === 'browser') return 'asked-elsewhere';
    if (!c.connected) return 'no-console';
    if (c.ageMs > CONSOLE_STALE_MS) return 'console-stale';
    if (c.origin && c.origin !== originOf(q.url)) return 'console-other-origin';
    const onScreen = c.visible === true || (c.visible === null && (q.foreground === 'console' || q.foreground === 'browser'));
    return onScreen ? '' : 'console-behind';
  }
  if (w === 'console') return 'console-only';
  if (!p.paired) return 'no-phone';
  if (route === 'overlay') {
    if (w === 'browser') return 'asked-elsewhere';
    if (!p.overlay) return 'overlay-off';
    return p.overlayReady ? '' : 'overlay-not-ready';
  }
  if (route === 'direct') return p.overlay || p.inFront || q.foreground === 'amberx' ? '' : 'background-start-blocked';
  if (route === 'full-screen-intent') {
    if (!p.notifications) return 'notifications-off';
    if (!p.fullScreenIntent) return 'no-full-screen-intent';
    return p.locked ? '' : 'phone-unlocked';
  }
  if (route === 'notification') return p.notifications ? '' : 'notifications-off';
  return 'nothing-left';
}

/** Every route in order with try / skip and the reason. A refused URL plans nothing. */
export function plan(raw) {
  const q = normRequest(raw);
  const a = allowedUrl(q.url, q.hosts);
  if (!a.ok) return { $axf: PLAN, url: q.url, ok: false, reason: a.reason, detail: a.detail, routes: ROUTES.map((route) => ({ route, try: false, reason: a.reason })) };
  const routes = ROUTES.map((route) => { const reason = skipReason(route, q); return { route, try: !reason, reason }; });
  return { $axf: PLAN, url: a.url, ok: routes.some((r) => r.try), reason: routes.some((r) => r.try) ? '' : 'nothing-left', detail: '', routes };
}

/** The first route to try: { route, reason } with route 'none' and the headline reason when nothing can be tried. */
export function decide(raw) {
  const p = plan(raw);
  const first = p.routes.find((r) => r.try);
  return first ? { route: first.route, reason: '' } : { route: 'none', reason: p.reason || 'nothing-left' };
}

/** After `route` was tried and failed: the next route the plan allows, or 'none'. */
export function next(planned, route) {
  const routes = Array.isArray(planned?.routes) ? planned.routes : [];
  const i = routes.findIndex((r) => r.route === route);
  const n = routes.slice(i + 1).find((r) => r.try);
  return n ? n.route : 'none';
}

/** The success reason code of a route. */
export const successReason = (route) => ({ 'console-tab': 'console-visible', overlay: 'overlay-open', direct: 'direct-start', 'full-screen-intent': 'screen-locked-open', notification: 'tap-to-open' })[route] || 'nothing-left';

/**
 * The result from the plan and the attempts the host made, in order: attempts = [{ route, ok, reason? }]. The first
 * attempt that worked decides; a notification that went out is `notified`, never `opened`. Skipped routes and failed
 * attempts are listed in `tried` so the caller can say exactly what was ruled out.
 */
export function settle(planned, attempts = []) {
  const p = isObj(planned) && Array.isArray(planned.routes) ? planned : plan(planned);
  const tried = [];
  const byRoute = new Map((Array.isArray(attempts) ? attempts : []).filter((a) => isObj(a) && ROUTES.includes(a.route)).map((a) => [a.route, a]));
  let won = null;
  for (const r of p.routes) {
    if (won) break;
    const a = byRoute.get(r.route);
    if (!r.try) { tried.push({ route: r.route, outcome: 'skipped', reason: r.reason }); continue; }
    if (!a) { tried.push({ route: r.route, outcome: 'not-tried', reason: '' }); continue; }
    if (a.ok === true) { won = r.route; tried.push({ route: r.route, outcome: 'ok', reason: successReason(r.route) }); } else tried.push({ route: r.route, outcome: 'failed', reason: pick(a.reason, Object.keys(REASONS), 'attempt-failed') });
  }
  const route = won || 'none';
  const reason = won ? successReason(won) : (p.ok ? (tried.some((t) => t.outcome === 'failed') ? 'attempt-failed' : 'nothing-left') : (p.reason || 'nothing-left'));
  return { $axf: RESULT, url: str(p.url, MAX_URL), route, opened: won ? OPENS[won] : false, notified: won === 'notification', reason, tried };
}

/**
 * The AXPP answer the phone sends today ({ opened, notified, overlay, where, verb }) read as a result, so the console's
 * wake path and axHub speak this shape before the phone does. Only what the phone said counts: `opened: true` with
 * `where: browser` is a direct start, `where: overlay` is the overlay, `notified` alone is the notification.
 */
export function fromPhoneAnswer(raw, url = '') {
  const a = isObj(raw) ? raw : {};
  const u = str(a.url, MAX_URL) || str(url, MAX_URL);
  const base = (route, extra = {}) => ({ $axf: RESULT, url: u, route, opened: route !== 'none' && OPENS[route], notified: route === 'notification', reason: successReason(route), tried: [], ...extra });
  if (!isObj(raw) || a.held === true) return base('none', { opened: false, reason: 'attempt-failed', tried: [{ route: 'direct', outcome: 'failed', reason: 'attempt-failed' }] });
  if (a.where === 'overlay') return a.opened === true ? base('overlay') : base('none', { opened: false, reason: 'overlay-not-ready', tried: [{ route: 'overlay', outcome: 'failed', reason: 'overlay-not-ready' }] });
  if (a.opened === true) return base('direct');
  if (a.notified !== false) return base('notification', { tried: [{ route: 'direct', outcome: 'failed', reason: a.overlay === false ? 'background-start-blocked' : 'attempt-failed' }] });
  return base('none', { opened: false, reason: 'notifications-off', tried: [{ route: 'direct', outcome: 'failed', reason: a.overlay === false ? 'background-start-blocked' : 'attempt-failed' }, { route: 'notification', outcome: 'skipped', reason: 'notifications-off' }] });
}

/** Plain words for a result (the wake answer, the voice reply, a banner line). */
export function message(result) {
  const r = isObj(result) ? result : {};
  const words = REASONS[r.reason] || REASONS['nothing-left'];
  if (r.route !== 'none' && r.route) return words[0].toUpperCase() + words.slice(1);
  const why = (Array.isArray(r.tried) ? r.tried : []).map((t) => REASONS[t.reason]).filter(Boolean);
  return `The page did not open: ${why.length ? why.join('; ') : words}`;
}

export function validateRequest(raw) {
  const r = isObj(raw) ? raw : {}; const errors = [];
  const a = allowedUrl(r.url, r.hosts);
  if (!a.ok) errors.push({ field: 'url', message: a.detail });
  if (r.where !== undefined && !WHERE.includes(r.where)) errors.push({ field: 'where', message: `where must be one of ${WHERE.join(', ')}` });
  if (r.browser !== undefined && !BROWSERS.includes(r.browser)) errors.push({ field: 'browser', message: `browser must be one of ${BROWSERS.join(', ')}` });
  if (r.foreground !== undefined && !FOREGROUNDS.includes(r.foreground)) errors.push({ field: 'foreground', message: `foreground must be one of ${FOREGROUNDS.join(', ')}` });
  return { ok: !errors.length, errors };
}
export function validateResult(raw) {
  const r = isObj(raw) ? raw : {}; const errors = [];
  if (r.route !== 'none' && !ROUTES.includes(r.route)) errors.push({ field: 'route', message: `route must be none or one of ${ROUTES.join(', ')}` });
  if (typeof r.opened !== 'boolean') errors.push({ field: 'opened', message: 'opened must be true or false' });
  if (!REASONS[r.reason]) errors.push({ field: 'reason', message: 'reason must be a known code' });
  if (r.opened === true && r.route !== 'none' && OPENS[r.route] === false) errors.push({ field: 'opened', message: `a ${r.route} is never "opened"` });
  return { ok: !errors.length, errors };
}

export const REGISTRY = Object.freeze({ schema: SCHEMA, request: REQUEST, plan: PLAN, result: RESULT, version: VERSION, routes: ROUTES, opens: OPENS, where: WHERE, browsers: BROWSERS, foregrounds: FOREGROUNDS, defaultHosts: DEFAULT_HOSTS, maxUrl: MAX_URL, consoleStaleMs: CONSOLE_STALE_MS, reasons: REASONS });

export function jsonSchemas() {
  const reasonCodes = Object.keys(REASONS);
  const $schema = 'https://json-schema.org/draft/2020-12/schema';
  const tried = { type: 'array', items: { type: 'object', additionalProperties: false, required: ['route', 'outcome', 'reason'], properties: { route: { enum: [...ROUTES] }, outcome: { enum: ['skipped', 'not-tried', 'ok', 'failed'] }, reason: { enum: ['', ...reasonCodes] } } } };
  return {
    'open-url-request.schema.json': {
      $schema, $id: 'https://amberx.ai/axf/schemas/open-url-request.schema.json', title: `${REQUEST} (${SCHEMA})`, type: 'object', additionalProperties: false, required: ['url'],
      properties: {
        $axf: { const: REQUEST }, url: { type: 'string', maxLength: MAX_URL }, hosts: { type: 'array', items: { type: 'string' } }, where: { enum: [...WHERE] }, browser: { enum: [...BROWSERS] },
        console: { type: 'object', additionalProperties: false, properties: { connected: { type: 'boolean' }, visible: { type: ['boolean', 'null'] }, origin: { type: 'string' }, ageMs: { type: 'integer', minimum: 0 } } },
        phone: { type: 'object', additionalProperties: false, properties: { paired: { type: 'boolean' }, inFront: { type: 'boolean' }, overlay: { type: 'boolean' }, overlayReady: { type: 'boolean' }, notifications: { type: 'boolean' }, fullScreenIntent: { type: 'boolean' }, locked: { type: 'boolean' } } },
        foreground: { enum: [...FOREGROUNDS] },
      },
    },
    'open-url-plan.schema.json': {
      $schema, $id: 'https://amberx.ai/axf/schemas/open-url-plan.schema.json', title: `${PLAN} (${SCHEMA})`, type: 'object', additionalProperties: false, required: ['url', 'ok', 'routes'],
      properties: { $axf: { const: PLAN }, url: { type: 'string' }, ok: { type: 'boolean' }, reason: { enum: ['', ...reasonCodes] }, detail: { type: 'string' }, routes: { type: 'array', minItems: ROUTES.length, maxItems: ROUTES.length, items: { type: 'object', additionalProperties: false, required: ['route', 'try', 'reason'], properties: { route: { enum: [...ROUTES] }, try: { type: 'boolean' }, reason: { enum: ['', ...reasonCodes] } } } } },
    },
    'open-url-result.schema.json': {
      $schema, $id: 'https://amberx.ai/axf/schemas/open-url-result.schema.json', title: `${RESULT} (${SCHEMA})`, type: 'object', additionalProperties: false, required: ['route', 'opened', 'reason'],
      properties: { $axf: { const: RESULT }, url: { type: 'string' }, route: { enum: ['none', ...ROUTES] }, opened: { type: 'boolean' }, notified: { type: 'boolean' }, reason: { enum: reasonCodes }, tried },
    },
  };
}

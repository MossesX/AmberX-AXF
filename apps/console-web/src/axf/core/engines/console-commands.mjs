/**
 * Console commands (build console-commands, Brett Nov 3 2026: "add console commands to the MCP, the API and the CLI
 * so I can tell Amber to load screens for me"). The `console` domain of control@1 (control-rules.mjs): a Claude session,
 * the REST API or the CLI opens a screen, a dialog or a settings tab in Brett's open console, runs one of its registered
 * actions, or moves it back / home.
 *
 * Since build apps-control-surface (Brett Nov 3 2026: "Put EVERY app on the API, MCP and CLI") the same engine is the
 * control surface of every app on the framework: the `apps` domain (`apps.list`, `apps.screens`, `apps.dialogs`,
 * `apps.settings`, `apps.actions`, `apps.nav`, `apps.clients`) takes `input.app` / `select.app` (an app id, label or alias
 * from the apps registry, framework/schemas/apps.json) and resolves against that app's clients only. `console.*` is
 * the same surface with the app fixed to the Dev Console. Every app's client (the control-surface library,
 * framework/libs/control-surface) reports its catalog with its `app` id; a client inside a host says `<host>/<app>`.
 *
 * Pure (no IO, no DOM), shared by the Token control runner (which gates and resolves) and the clients (which report
 * their catalog and run what they are sent). Nothing here knows an app's screens: every open client reports a catalog
 * built from its own search index (views, settings tabs, dialogs, actions — plugins' too), and resolving runs against
 * that, so a new plugin's screen can be opened the moment it is installed.
 *
 *   catalog  { $axf: 'console-catalog@1', app, items: [{ kind, id, label, detail?, icon?, keywords?, requires?, effect?, params?, parent? }], here? }
 *   client   { id, app, host?, front?, title, device, user, lastUsed, here, catalog }   (one per open tab / phone, kept by the broker;
 *            app `molly/console-web` + host `molly` inside Molly; front = visible and shown by its host)
 *   message  { $axf: 'console-command@1', id, op: open|run|back|home|close, app?, kind?, target?, label?, spec?, anchor?, arg?, by, at }
 *   apps     { $axf: 'apps@1', apps: [{ id, label, url, kind, aliases, description }] }   (framework/schemas/apps.json; passed in as ctx.apps)
 *
 * The frame names stay `console-catalog@1` / `console-command@1` on the wire (every client already speaks them).
 * Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */
import { CONTROL_WIRE, controlConfirmToken, controlConfirmValid, controlGranted, CONTROL_CONFIRM_TTL_MS } from './control-rules.mjs';

export const CONSOLE_CATALOG_FRAME = 'console-catalog@1';
export const CONSOLE_COMMAND_FRAME = 'console-command@1';
export const APPS_FRAME = 'apps@1';
/** control@1 target → catalog kind (the console's targets and every app's). */
export const CONSOLE_KINDS = { 'console.screens': 'screen', 'console.dialogs': 'dialog', 'console.settings': 'settings', 'console.actions': 'action', 'apps.screens': 'screen', 'apps.dialogs': 'dialog', 'apps.settings': 'settings', 'apps.actions': 'action' };
export const CONSOLE_ITEM_KINDS = ['screen', 'dialog', 'settings', 'action'];
/** Where a command goes: the client used last (default), every open client of the caller, or one client id. */
export const CONSOLE_DELIVERY = ['recent', 'all'];
export const CONSOLE_CATALOG_MAX = 3000;
export const CONSOLE_LIST_DEFAULT = 50;
/** How long a client counts as open without a heartbeat (the client re-announces every 30 s and on focus). */
export const CONSOLE_CLIENT_STALE_MS = 90_000;
/** The MCP shortcut tools every console MCP server publishes (names are a contract: Claude sessions call them through axHub). */
export const CONSOLE_TOOLS = ['console_open', 'console_dialog', 'console_settings', 'console_action', 'console_back', 'console_where', 'console_list', 'console_clients'];
/** The same for every app (build apps-control-surface): `apps_list` reads the apps, the rest take `app`. */
export const APP_TOOLS = ['apps_list', 'app_open', 'app_dialog', 'app_settings', 'app_action', 'app_back', 'app_where', 'app_list', 'app_clients', 'app_show'];
/** The Dev Console's app id (axf.manifest.json app.id) and the ids its clients have reported so far. */
export const CONSOLE_APP = 'axf-console';
const CONSOLE_APP_IDS = new Set([CONSOLE_APP, 'console-web', 'console']);
/** The console's own registry entry, so console.* works with no apps registry handed in. */
export const CONSOLE_APP_ENTRY = { id: CONSOLE_APP, label: 'Dev Console', url: 'https://console.amberxai.com', kind: 'web', aliases: ['console', 'console-web', 'dev console', 'the console'] };

/** Action ids that only navigate (open, show, move a window): run with control.console.navigate alone. */
const NAVIGATING = /^(nav|dialog|settings\.open|banners\.settings|windows\.[A-Za-z]+|terminal\.(open|dialog)|help(\.[A-Za-z.]+)?|help\.mode|search(\.[A-Za-z]+)?|inspector|asset\.json|plugins\.open|views?\.[A-Za-z.]+|molly\.(show|app)|xlayout\.open)$/;
/** Words in an action id that mean it deletes or throws away something. */
const DESTRUCTIVE = /(^|[.:_-])(delete|remove|reset|restore|clear|wipe|purge|uninstall|discard|drop|kill|destroy)([.:_-]|$)/i;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** Lower case, accents and punctuation folded to spaces. */
export const foldWords = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** Words a person adds that don't name anything ("open the plan studio screen"). */
const FILLER = new Set(['open', 'show', 'go', 'to', 'the', 'a', 'an', 'my', 'me', 'screen', 'page', 'view', 'tab', 'window', 'dialog', 'popup', 'please', 'load', 'up', 'pull', 'bring', 'take', 'run', 'action', 'settings', 'setting', 'sub', 'subtab', 'in', 'on', 'of']);

/* ================================================================== apps registry */

/** One registry entry, cleaned, or null. */
export function normalizeAppEntry(raw) {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 60).toLowerCase();
  if (!id) return null;
  const out = { id, label: str(raw.label, 80) || id, url: str(raw.url, 300), kind: str(raw.kind, 30) || 'web', aliases: [] };
  if (Array.isArray(raw.aliases)) out.aliases = raw.aliases.map((a) => foldWords(a)).filter(Boolean).slice(0, 12);
  const d = str(raw.description, 300);
  if (d) out.description = d;
  return out;
}

/** The apps registry (apps@1) as a clean list; the console is always in it. */
export function normalizeApps(raw) {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.apps) ? raw.apps : [];
  const out = [];
  const seen = new Set();
  for (const a of [...list, CONSOLE_APP_ENTRY]) {
    const n = normalizeAppEntry(a);
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  return out;
}

/** The app id a client reports, without its host prefix (`molly/console-web` → the console's id). */
export function clientAppId(client) {
  const raw = str(client?.app, 80) || 'console-web';
  const bare = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
  return CONSOLE_APP_IDS.has(bare.toLowerCase()) ? CONSOLE_APP : bare.toLowerCase();
}

/**
 * Which app a word names: a registry id, an alias, a label, or (unknown to the registry) the word itself as an id, so an
 * app whose client is connected works before it is listed. '' when nothing was given.
 */
export function resolveAppId(word, apps = []) {
  const w = str(word, 80);
  if (!w) return '';
  const low = w.toLowerCase();
  if (CONSOLE_APP_IDS.has(low)) return CONSOLE_APP;
  const list = normalizeApps(apps);
  const hit = list.find((a) => a.id === low) ?? list.find((a) => a.aliases.includes(foldWords(w)) || foldWords(a.label) === foldWords(w));
  return hit ? hit.id : low.replace(/[^a-z0-9._-]+/g, '-');
}

/** Does this client belong to the app? (no app = every client) */
export const clientOfApp = (client, app) => !app || clientAppId(client) === app;

/** The registry entry for an app id (an unlisted app gets a bare entry). */
export const appEntry = (id, apps = []) => normalizeApps(apps).find((a) => a.id === id) ?? { id, label: id, url: '', kind: 'web', aliases: [] };

/* ================================================================== catalog */

/** One catalog item, cleaned (unknown kinds and fields dropped), or null. */
export function normalizeConsoleItem(raw) {
  if (!isObj(raw) || !CONSOLE_ITEM_KINDS.includes(raw.kind)) return null;
  const id = str(raw.id, 160);
  if (!id) return null;
  const out = { kind: raw.kind, id, label: str(raw.label, 160) || id };
  for (const k of ['detail', 'icon', 'requires', 'parent', 'module']) { const v = str(raw[k], 200); if (v) out[k] = v; }
  if (Array.isArray(raw.keywords)) { const kw = raw.keywords.map((x) => str(x, 80)).filter(Boolean).slice(0, 12); if (kw.length) out.keywords = kw; }
  if (['navigate', 'read', 'write', 'destructive'].includes(raw.effect)) out.effect = raw.effect;
  if (raw.params === true) out.params = true;
  return out;
}

/** A catalog as a client reports it, cleaned and de-duplicated (kind + id), capped. */
export function normalizeConsoleCatalog(raw) {
  const r = isObj(raw) ? raw : {};
  const seen = new Set();
  const items = [];
  for (const it of Array.isArray(r.items) ? r.items : []) {
    const n = normalizeConsoleItem(it);
    if (!n || seen.has(`${n.kind}:${n.id}`)) continue;
    seen.add(`${n.kind}:${n.id}`);
    items.push(n);
    if (items.length >= CONSOLE_CATALOG_MAX) break;
  }
  return { $axf: CONSOLE_CATALOG_FRAME, app: str(r.app, 60) || 'console-web', items, here: normalizeHere(r.here) };
}

/** Where a client is: the screen, an open dialog, the settings tab when Settings shows, and anything the app adds (`extra`). */
export function normalizeHere(raw) {
  const r = isObj(raw) ? raw : {};
  const out = {};
  for (const k of ['screen', 'screenLabel', 'dialog', 'settings']) { const v = str(r[k], 160); if (v) out[k] = v; }
  if (isObj(r.extra)) { const e = {}; for (const [k, v] of Object.entries(r.extra).slice(0, 12)) { const s = str(v, 160); if (s && /^[a-z][a-z0-9_-]{0,30}$/i.test(k)) e[k] = s; } if (Object.keys(e).length) out.extra = e; }
  return out;
}

/**
 * A catalog from a runtime's search entries and action list (what a client sends). `entries` = rt.search.entries()
 * shape ({ kind, label, detail?, icon?, keywords?, requires?, focus }); `actions` = rt.actions.list() ({ id, meta }).
 */
export function consoleCatalogFrom(entries, actions = [], extra = {}) {
  const items = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    const f = isObj(e?.focus) ? e.focus : {};
    const base = { label: String(e.label ?? '').replace(/ settings$/, ''), detail: e.detail, icon: e.icon, keywords: e.keywords, requires: e.requires };
    if (e.kind === 'view' && f.view) items.push({ ...base, kind: 'screen', id: f.view });
    else if (e.kind === 'settings-tab' && f.tab) items.push({ ...base, kind: 'settings', id: f.tab, ...(e.parent ? { parent: e.parent } : {}) });
    else if (e.kind === 'dialog' && f.id) items.push({ ...base, kind: 'dialog', id: f.id });
  }
  for (const a of Array.isArray(actions) ? actions : []) {
    const m = isObj(a?.meta) ? a.meta : {};
    if (!a?.id || m.stub) continue;
    items.push({ kind: 'action', id: a.id, label: m.label || a.id, detail: a.id, requires: m.requires, effect: m.effect, params: m.params === true, module: m.module });
  }
  for (const it of Array.isArray(extra.items) ? extra.items : []) items.push(it);
  const { items: _drop, ...rest } = extra;
  return normalizeConsoleCatalog({ ...rest, items });
}

/* ================================================================== search + resolve */

const wordsOf = (q) => foldWords(q).split(' ').filter((w) => w && !FILLER.has(w));

/** How well an item matches the words (0 = not at all; every word must hit somewhere). */
function scoreItem(item, words, phrase) {
  if (!words.length) return 1;
  const label = foldWords(item.label);
  const id = foldWords(item.id);
  const extra = foldWords([item.detail, ...(item.keywords ?? [])].join(' '));
  const lw = label.split(' ');
  let score = 0;
  for (const w of words) {
    if (lw.includes(w)) score += 4;
    else if (lw.some((x) => x.startsWith(w))) score += 3;
    else if (id.split(' ').includes(w)) score += 3;
    else if (label.includes(w) || id.includes(w)) score += 2;
    else if (extra.includes(w)) score += 1;
    else return 0;
  }
  if (label === phrase) score += 20;
  else if (label.startsWith(phrase)) score += 5;
  if (id === phrase.replace(/ /g, '-') || id === phrase) score += 15;
  return score - lw.length * 0.01; // shorter labels win ties
}

/** Items of a kind matching the words, best first (no words = all, catalog order). */
export function consoleSearch(items, kind, q = '', limit = CONSOLE_LIST_DEFAULT) {
  const list = (Array.isArray(items) ? items : []).filter((i) => !kind || i.kind === kind);
  const words = wordsOf(q);
  if (!words.length) return list.slice(0, limit);
  const phrase = words.join(' ');
  return list.map((i) => [i, scoreItem(i, words, phrase)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([i]) => i);
}

/**
 * The one item a path names: the exact id (case-insensitive; `plugins/<id>` and `<parent>/<id>` for sub-tabs; an action
 * spec `id:arg:arg` names the action `id`), the exact title, then the best search hit when it clearly wins.
 * → { item, args? } or { candidates, ambiguous: true } or { candidates: [] } (nothing).
 */
export function consoleResolve(items, kind, path) {
  const list = (Array.isArray(items) ? items : []).filter((i) => i.kind === kind);
  const raw = String(path ?? '').trim();
  const low = raw.toLowerCase();
  const byId = (id) => list.find((i) => i.id.toLowerCase() === id);
  let hit = byId(low);
  if (hit) return { item: hit };
  if (low.includes('/')) { hit = byId(low.slice(low.lastIndexOf('/') + 1)); if (hit) return { item: hit }; }
  if (kind === 'action' && low.includes(':')) {
    const [id, ...args] = raw.split(':');
    hit = byId(id.toLowerCase());
    if (hit) return { item: hit, args };
  }
  const phrase = foldWords(raw);
  hit = list.find((i) => foldWords(i.label) === phrase);
  if (hit) return { item: hit };
  const words = wordsOf(raw);
  if (!words.length) return { candidates: [] };
  const scored = list.map((i) => [i, scoreItem(i, words, words.join(' '))]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  if (!scored.length) return { candidates: [] };
  if (scored.length === 1 || scored[0][1] - scored[1][1] >= 1) return { item: scored[0][0] };
  return { candidates: scored.slice(0, 6).map(([i]) => i), ambiguous: true };
}

/* ================================================================== action policy */

/** What running an action does: its declared effect, else navigate for known navigation ids, destructive for deleting words, else write. */
export function consoleActionEffect(item) {
  if (item?.effect) return item.effect === 'read' ? 'navigate' : item.effect;
  const id = String(item?.id ?? '');
  if (NAVIGATING.test(id)) return 'navigate';
  if (DESTRUCTIVE.test(id)) return 'destructive';
  return 'write';
}

/** The permissions a caller needs to run an action remotely: the effect's control.<domain>.* plus what the action itself requires. */
export function consoleActionNeeds(item, domain = 'console') {
  const effect = consoleActionEffect(item);
  const needs = [effect === 'navigate' ? `control.${domain}.navigate` : effect === 'destructive' ? `control.${domain}.delete` : `control.${domain}.write`];
  if (item?.requires && effect !== 'navigate') needs.push(item.requires);
  return { effect, needs };
}

/* ================================================================== clients + delivery */

/**
 * The clients a command goes to: `recent`, `all`, or a client id, among the clients of `app` (no app = every app).
 * Stale clients are left out. `recent` = the one Brett is looking at: a client in front (`front: true`: its page is
 * visible and, inside a host such as Molly, the host shows its frame) wins over one that isn't, then the one used last
 * (Nov 3 2026: a console hidden behind another app in Molly used to win because it was touched last).
 */
export function consolePickClients(clients, to = 'recent', now = Date.now(), app = '') {
  const live = (Array.isArray(clients) ? clients : []).filter((c) => c && c.id && clientOfApp(c, app) && now - (Number(c.lastSeen ?? c.lastUsed) || 0) <= CONSOLE_CLIENT_STALE_MS);
  const front = (c) => (c.front === false ? 0 : 1);
  const sorted = [...live].sort((a, b) => front(b) - front(a) || (Number(b.lastUsed) || 0) - (Number(a.lastUsed) || 0));
  if (to === 'all') return sorted;
  if (!to || to === 'recent') return sorted.slice(0, 1);
  return sorted.filter((c) => c.id === to);
}

/** A client as `clients list` shows it (no catalog). */
export const consoleClientSummary = (c) => ({ id: c.id, app: c.app ?? 'console-web', appId: clientAppId(c), ...(c.host ? { host: c.host } : {}), front: c.front !== false, title: c.title ?? '', device: c.device ?? '', user: c.user ?? '', lastUsed: c.lastUsed ? new Date(Number(c.lastUsed)).toISOString() : '', here: normalizeHere(c.here), items: c.catalog?.items?.length ?? 0 });

/** One row of apps.list: the registry entry, its clients online and what it reports. */
export function appSummary(entry, clients = [], now = Date.now()) {
  const live = consolePickClients(clients, 'all', now, entry.id);
  const cat = live[0]?.catalog?.items ?? [];
  const count = (kind) => cat.filter((i) => i.kind === kind).length;
  return {
    id: entry.id, label: entry.label, url: entry.url, kind: entry.kind, ...(entry.description ? { description: entry.description } : {}), aliases: entry.aliases,
    online: live.length, clients: live.map(consoleClientSummary), here: live.length ? normalizeHere(live[0].here) : {},
    screens: count('screen'), dialogs: count('dialog'), settings: count('settings'), actions: count('action'),
  };
}

/** Every app: the registry's plus any app a connected client reports (unlisted apps show under their own id). */
export function appsList(apps, clients = [], now = Date.now(), select = {}) {
  const list = normalizeApps(apps);
  const known = new Set(list.map((a) => a.id));
  for (const c of consolePickClients(clients, 'all', now)) { const id = clientAppId(c); if (!known.has(id)) { known.add(id); list.push(appEntry(id, [])); } }
  const words = wordsOf(str(select.q, 120));
  let rows = list.map((a) => appSummary(a, clients, now));
  if (words.length) rows = rows.filter((r) => words.every((w) => foldWords([r.id, r.label, ...r.aliases, r.description ?? ''].join(' ')).includes(w)));
  if (select.online === true) rows = rows.filter((r) => r.online > 0);
  rows.sort((a, b) => (b.online > 0) - (a.online > 0) || a.label.localeCompare(b.label));
  return rows;
}

/** The message an open client receives. */
export function consoleMessage(fields, { id, by = '', now = Date.now() } = {}) {
  const m = { $axf: CONSOLE_COMMAND_FRAME, id: String(id ?? ''), op: fields.op };
  for (const k of ['app', 'kind', 'target', 'label', 'spec', 'anchor', 'arg']) if (fields[k] !== undefined && fields[k] !== '') m[k] = String(fields[k]);
  m.by = by;
  m.at = new Date(now).toISOString();
  return m;
}

/** Is a message one a client may run? (the client checks before it touches its runtime) */
export function consoleMessageErrors(m) {
  const errors = [];
  if (!isObj(m) || m.$axf !== CONSOLE_COMMAND_FRAME) return [`$axf must be ${CONSOLE_COMMAND_FRAME}`];
  if (!['open', 'run', 'back', 'home', 'close'].includes(m.op)) errors.push('op must be open, run, back, home or close');
  if (m.op === 'open' && (!CONSOLE_ITEM_KINDS.includes(m.kind) || m.kind === 'action' || !m.target)) errors.push('open needs a kind (screen, dialog, settings) and a target');
  if (m.op === 'run' && !m.spec) errors.push('run needs an action spec');
  return errors;
}

/* ================================================================== the console + apps domains of control@1 */

/** Paths that mean "whichever dialog is open" for act close on dialogs. */
export const ANY_DIALOG = new Set(['current', 'any', 'open', 'dialog']);

const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
/** The app a command is for: console.* = the Dev Console; apps.* = input.app / select.app (an id, label or alias). */
export function commandApp(c, apps = []) {
  if (String(c?.target ?? '').startsWith('console.')) return CONSOLE_APP;
  const input = isObj(c?.input) ? c.input : {};
  const select = isObj(c?.select) ? c.select : {};
  return resolveAppId(input.app ?? select.app ?? '', apps);
}

/**
 * Run an already-gated control@1 command of the console or apps domain against what the open clients reported.
 * ctx = { clients, grants, salt, now, id, by, apps }. → { ok: true, data, deliver? } or { ok: false, code, message, …extra }.
 * `deliver` = { to: [client ids], message }: the broker sends the message and adds the clients' acks to the answer.
 * `noConsole: true` (with `app`, its label and `url`) tells the broker nothing of that app is connected (rather than
 * "no such screen"), so it can queue the command and wake the app (console-wake, Nov 3 2026; per app since Nov 4).
 */
export function runConsoleCommand(c, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const clients = Array.isArray(ctx.clients) ? ctx.clients : [];
  const apps = normalizeApps(ctx.apps);
  const input = isObj(c.input) ? c.input : {};
  const to = str(input.to, 80) || 'recent';
  const select = isObj(c.select) ? c.select : {};
  const limit = Math.max(1, Math.min(Number(select.limit) || CONSOLE_LIST_DEFAULT, 500));
  const domain = String(c.target ?? '').startsWith('apps.') ? 'apps' : 'console';
  if (c.target === 'apps.list') return { ok: true, data: { items: appsList(apps, clients, now, select).slice(0, limit), total: appsList(apps, clients, now, select).length } };
  const app = commandApp(c, apps);
  if (c.target === 'console.clients' || c.target === 'apps.clients') {
    const live = consolePickClients(clients, 'all', now, app).slice(0, limit);
    return { ok: true, data: { items: live.map(consoleClientSummary), total: live.length, ...(app ? { app } : {}) } };
  }
  if (domain === 'apps' && !app) return fail(CONTROL_WIRE.VALIDATION, `${c.target} needs the app: input.app (act, get) or select.app (list): an id, label or alias from apps.list`);
  const entry = appEntry(app, apps);
  const noClient = () => (app === CONSOLE_APP
    ? fail(CONTROL_WIRE.NOT_FOUND, 'no console is open for you right now: open the Dev Console (https://console.amberxai.com) in a browser, then try again', { noConsole: true, app, label: entry.label, url: entry.url })
    : fail(CONTROL_WIRE.NOT_FOUND, `no ${entry.label} is open for you right now${entry.url ? `: open ${entry.url}` : ''} (apps.list shows which apps are online), then try again`, { noConsole: true, app, label: entry.label, url: entry.url }));
  const targets = consolePickClients(clients, c.op === 'act' ? to : (str(select.client, 80) || 'recent'), now, app);
  if (!targets.length) return to !== 'recent' && to !== 'all' && c.op === 'act' ? fail(CONTROL_WIRE.NOT_FOUND, `no open ${entry.label} client ${to} (${domain}.clients lists them)`, { app }) : noClient();
  const catalog = targets[0].catalog?.items ?? [];
  const send = (fields, extra = {}) => ({ ok: true, data: { changed: [], app, ...extra }, deliver: { to: targets.map((t) => t.id), message: consoleMessage({ app, ...fields }, { id: ctx.id, by: ctx.by ?? c.by ?? '', now }) } });

  if (c.target === 'console.nav' || c.target === 'apps.nav') {
    if (c.op === 'get') return { ok: true, data: { value: normalizeHere(targets[0].here), app, client: consoleClientSummary(targets[0]) } };
    return send({ op: c.action });
  }
  const kind = CONSOLE_KINDS[c.target];
  // act close on dialogs: shut the open one ("current" / "any" / "open" = whichever it is; a dialog's id or name = only that one)
  if (kind === 'dialog' && c.op === 'act' && c.action === 'close') {
    const p = str(c.path, 200).trim().toLowerCase();
    if (!p || ANY_DIALOG.has(p)) return send({ op: 'close', kind });
    const d = consoleResolve(catalog, kind, c.path);
    if (!d.item) return fail(d.ambiguous ? CONTROL_WIRE.VALIDATION : CONTROL_WIRE.NOT_FOUND, d.ambiguous ? `"${c.path}" matches several: ${d.candidates.map((i) => `${i.label} (${i.id})`).join(', ')}; send the id` : `${entry.label} has no dialog "${c.path}" (send "current" to close whichever is open)`, { candidates: d.candidates ?? [], app });
    return send({ op: 'close', kind, target: d.item.id, label: d.item.label }, { item: d.item });
  }
  if (c.op === 'list') {
    const items = consoleSearch(catalog, kind, str(select.q, 200), limit);
    return { ok: true, data: { items, total: catalog.filter((i) => i.kind === kind).length, app, client: targets[0].id } };
  }
  const r = consoleResolve(catalog, kind, c.path);
  if (!r.item) {
    const near = r.candidates?.length ? r.candidates : consoleSearch(catalog, kind, String(c.path).split(/[\s:/]+/)[0], 6);
    return r.ambiguous
      ? fail(CONTROL_WIRE.VALIDATION, `"${c.path}" matches several: ${r.candidates.map((i) => `${i.label} (${i.id})`).join(', ')}; send the id`, { candidates: r.candidates, app })
      : fail(CONTROL_WIRE.NOT_FOUND, `${entry.label} has no ${kind} "${c.path}"${near.length ? `; close ones: ${near.map((i) => `${i.label} (${i.id})`).join(', ')}` : ''} (control list ${c.target} names them)`, { candidates: near, app });
  }
  const item = r.item;
  if (c.op === 'get') return { ok: true, data: { item, app } };
  if (kind === 'action') {
    const { effect, needs } = consoleActionNeeds(item, domain);
    const grants = ctx.grants ?? [];
    const missing = needs.filter((p) => !controlGranted(grants, p));
    if (missing.length) return fail(CONTROL_WIRE.DENIED, `running ${item.label} (${item.id}) ${effect === 'navigate' ? 'navigates' : effect === 'destructive' ? 'deletes or resets something' : 'changes data'} and needs ${missing.join(' + ')}`, { requires: missing[0], effect, app });
    const args = Array.isArray(input.args) ? input.args.map(String) : typeof input.args === 'string' && input.args ? input.args.split(':') : r.args ?? [];
    if (item.params && !args.length) return fail(CONTROL_WIRE.VALIDATION, `${item.label} (${item.id}) needs arguments: input.args (e.g. ${item.id}:<value>)`, { app });
    const spec = [item.id, ...args].join(':');
    if (effect === 'destructive') {
      const bound = { op: 'act', target: c.target, path: spec, action: 'run', ...(domain === 'apps' ? { input: { app } } : {}) };
      if (!controlConfirmValid(bound, c.confirm, ctx.salt ?? '', now)) {
        return fail(CONTROL_WIRE.CONFIRMATION_REQUIRED, `${item.label} (${spec}) deletes or resets something; tell Brett, then send the same command again with this confirm token within ${CONTROL_CONFIRM_TTL_MS / 60000} minutes`, { confirm: controlConfirmToken(bound, ctx.salt ?? '', now), ttlMs: CONTROL_CONFIRM_TTL_MS, effect, app });
      }
    }
    return send({ op: 'run', kind: 'action', target: item.id, label: item.label, spec }, { item, effect });
  }
  return send({ op: 'open', kind, target: item.id, label: item.label, anchor: str(input.anchor, 160), arg: str(input.arg, 400) }, { item });
}

/** The confirm token a destructive action needs (what the CLI prints, the check uses); `app` for the apps domain. */
export const consoleActionConfirm = (spec, salt, now = Date.now(), app = '') => controlConfirmToken(app ? { op: 'act', target: 'apps.actions', path: spec, action: 'run', input: { app } } : { op: 'act', target: 'console.actions', path: spec, action: 'run' }, salt, now);

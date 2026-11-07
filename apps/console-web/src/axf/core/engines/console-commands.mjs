/**
 * Console commands (build console-commands, Brett Nov 3 2026: "add console commands to the MCP, the API and the CLI
 * so I can tell Amber to load screens for me"). The `console` domain of control@1 (control-rules.mjs): a Claude session,
 * the REST API or the CLI opens a screen, a dialog or a settings tab in Brett's open console, runs one of its registered
 * actions, or moves it back / home.
 *
 * Pure (no IO, no DOM), shared by the Token control runner (which gates and resolves) and the console client (which
 * reports its catalog and runs what it is sent). Nothing here knows the console's screens: every open console reports
 * a catalog built from its own search index (views, settings tabs, dialogs, actions — plugins' too), and resolving runs
 * against that, so a new plugin's screen can be opened the moment it is installed.
 *
 *   catalog  { $axf: 'console-catalog@1', app, items: [{ kind, id, label, detail?, icon?, keywords?, requires?, effect?, params?, parent?, action? }], here? }
 *            (a screen with `action` is a window the action opens, e.g. the Terminal: actions declare it with meta.screen)
 *   client   { id, app, host?, front?, title, device, user, lastUsed, here, catalog }   (one per open console tab, kept by the server;
 *            app `molly/console-web` + host `molly` inside Molly; front = visible and shown by its host)
 *   message  { $axf: 'console-command@1', id, op: open|run|back|home|close|refresh|read|set|unset|elements|press, kind?, target?, label?, spec?, anchor?, arg?, verb?, hard?, confirmed?, by, at }
 *            read / set / unset = a setting value (console.values; set's arg is the JSON value); elements = list or get what
 *            is on screen (arg = search words, target = one id); press = act on an element (verb press|toggle|set|focus|context,
 *            arg = JSON input). The console answers with `data` in its ack (the value, the elements).
 *
 * Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */
import { CONTROL_WIRE, controlConfirmToken, controlConfirmValid, controlGranted, CONTROL_CONFIRM_TTL_MS } from './control-rules.mjs';

export const CONSOLE_CATALOG_FRAME = 'console-catalog@1';
export const CONSOLE_COMMAND_FRAME = 'console-command@1';
/** control@1 target → catalog kind. */
export const CONSOLE_KINDS = { 'console.screens': 'screen', 'console.dialogs': 'dialog', 'console.settings': 'settings', 'console.actions': 'action', 'console.values': 'value' };
export const CONSOLE_ITEM_KINDS = ['screen', 'dialog', 'settings', 'action', 'value'];
/** Setting kinds that hold no value of their own (headings, custom panels, buttons, links): never console.values items. */
export const CONSOLE_VALUE_SKIP = ['section', 'custom', 'action', 'link'];
/** What a remote caller may do to an element on screen (console.elements act). */
export const CONSOLE_ELEMENT_ACTS = ['press', 'toggle', 'set', 'focus', 'context'];
/** The roles console.elements lists (what a person can press, flip, fill or open). */
export const CONSOLE_ELEMENT_ROLES = ['button', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'checkbox', 'radio', 'option', 'link', 'textbox', 'combobox', 'slider', 'spinbutton', 'searchbox', 'treeitem', 'row'];
export const CONSOLE_ELEMENTS_MAX = 400;
/** A setting key: what console.values takes for a key no group declares (toolbar and chrome keys, for one). */
export const CONSOLE_VALUE_KEY = /^[A-Za-z][A-Za-z0-9._:@/-]{0,159}$/;
/** Where a console command goes: the console used last (default), every open console of the caller, or one client id. */
export const CONSOLE_DELIVERY = ['recent', 'all'];
export const CONSOLE_CATALOG_MAX = 6000;
/** Message ops: navigation (open … refresh), setting values (read, set, unset) and elements on screen (elements = list / get, press = act). */
export const CONSOLE_OPS = ['open', 'run', 'back', 'home', 'close', 'refresh', 'read', 'set', 'unset', 'elements', 'press'];
export const CONSOLE_LIST_DEFAULT = 50;
/** How long a console counts as open without a heartbeat (the client re-announces every 30 s and on focus). */
export const CONSOLE_CLIENT_STALE_MS = 90_000;
/** The MCP shortcut tools every console MCP server publishes (names are a contract: Claude sessions call them through axHub). */
export const CONSOLE_TOOLS = ['console_open', 'console_dialog', 'console_settings', 'console_action', 'console_back', 'console_where', 'console_list', 'console_clients', 'console_refresh', 'console_value', 'console_elements', 'console_press'];

/** Action ids that only navigate (open, show, move a window): run with control.console.navigate alone. */
const NAVIGATING = /^(nav|dialog|settings\.open|banners\.settings|windows\.[A-Za-z]+|terminal\.(open|dialog)|help(\.[A-Za-z.]+)?|help\.mode|search(\.[A-Za-z]+)?|inspector|asset\.json|plugins\.open|views?\.[A-Za-z.]+)$/;
/** Words in an action id that mean it deletes or throws away something. */
const DESTRUCTIVE = /(^|[.:_-])(delete|remove|reset|restore|clear|wipe|purge|uninstall|discard|drop|kill|destroy)([.:_-]|$)/i;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** Lower case, accents and punctuation folded to spaces. */
export const foldWords = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** Words a person adds that don't name anything ("open the plan studio screen"). */
const FILLER = new Set(['open', 'show', 'go', 'to', 'the', 'a', 'an', 'my', 'me', 'screen', 'page', 'view', 'tab', 'window', 'dialog', 'popup', 'please', 'load', 'up', 'pull', 'bring', 'take', 'run', 'action', 'settings', 'setting', 'sub', 'subtab', 'in', 'on', 'of']);

/* ================================================================== catalog */

/** One catalog item, cleaned (unknown kinds and fields dropped), or null. */
export function normalizeConsoleItem(raw) {
  if (!isObj(raw) || !CONSOLE_ITEM_KINDS.includes(raw.kind)) return null;
  const id = str(raw.id, 160);
  if (!id) return null;
  const out = { kind: raw.kind, id, label: str(raw.label, 160) || id };
  for (const k of ['detail', 'icon', 'requires', 'parent', 'module', 'action']) { const v = str(raw[k], 200); if (v) out[k] = v; }
  if (Array.isArray(raw.keywords)) { const kw = raw.keywords.map((x) => str(x, 80)).filter(Boolean).slice(0, 12); if (kw.length) out.keywords = kw; }
  if (['navigate', 'read', 'write', 'destructive'].includes(raw.effect)) out.effect = raw.effect;
  if (raw.params === true) out.params = true;
  if (raw.kind === 'value') { // a setting: its control's kind, choices and range, so a set is checked before it is sent
    const vk = str(raw.valueKind, 40); if (vk) out.valueKind = vk;
    if (Array.isArray(raw.options)) { const o = raw.options.map((x) => str(typeof x === 'object' && x ? x.value : x, 120)).filter(Boolean).slice(0, 100); if (o.length) out.options = o; }
    for (const k of ['min', 'max', 'step']) if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) out[k] = raw[k];
    if (raw.secret === true) out.secret = true;
  }
  return out;
}

/** A catalog as a console reports it, cleaned and de-duplicated (kind + id), capped. */
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

/** Where a console is: the screen, an open dialog, the settings tab when Settings shows. */
export function normalizeHere(raw) {
  const r = isObj(raw) ? raw : {};
  const out = {};
  for (const k of ['screen', 'screenLabel', 'dialog', 'settings']) { const v = str(r[k], 160); if (v) out[k] = v; }
  return out;
}

/**
 * A catalog from a runtime's search entries and action list (what the console client sends). `entries` = rt.search.entries()
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
    if (!a?.id || m.stub || m.personOnly === true) continue; // personOnly: a person's tap only, never a remote caller
    // a screen that is a window, not a page (the Terminal): the action that opens it names it (meta.screen)
    if (typeof m.screen === 'string' && m.screen) items.push({ kind: 'screen', id: m.screen, label: m.screen.replace(/[-_.]+/g, ' ').replace(/^./, (c) => c.toUpperCase()), detail: `window (${a.id})`, keywords: [m.label || ''], action: a.id });
    items.push({ kind: 'action', id: a.id, label: m.label || a.id, detail: a.id, requires: m.requires, effect: m.effect, params: m.params === true, module: m.module });
  }
  return normalizeConsoleCatalog({ ...extra, items });
}

/**
 * console.values items from a settings registry's groups (`[{ tab, settings: SettingSpec[] }]`): every setting with a
 * value of its own, keyed by its key, with its tab as the parent.
 */
export function consoleValueItems(groups) {
  const out = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    for (const sp of Array.isArray(g?.settings) ? g.settings : []) {
      if (!isObj(sp) || !sp.key || CONSOLE_VALUE_SKIP.includes(sp.kind)) continue;
      out.push({ kind: 'value', id: sp.key, label: sp.label || sp.key, parent: g.tab || 'general', detail: `${g.label ? `${g.label} · ` : ''}${sp.kind}`, valueKind: sp.kind, requires: sp.requires,
        ...(Array.isArray(sp.options) ? { options: sp.options.map((o) => (isObj(o) ? o.value : o)) } : {}), ...(typeof sp.min === 'number' ? { min: sp.min } : {}), ...(typeof sp.max === 'number' ? { max: sp.max } : {}), ...(typeof sp.step === 'number' ? { step: sp.step } : {}), ...(sp.kind === 'secret' ? { secret: true } : {}) });
    }
  }
  return out;
}

/** Why a value can't go into this setting ([] = it can), checked against its kind, choices and range. No item = a key no group declares: any plain value. */
export function consoleValueErrors(item, value) {
  const kind = item?.valueKind;
  const plain = value === null || ['string', 'number', 'boolean'].includes(typeof value) || (Array.isArray(value) && value.every((x) => typeof x === 'string'));
  if (!plain) return ['value must be a string, number, true / false, null or a list of strings'];
  if (!item) return [];
  const name = `${item.label} (${item.id})`;
  switch (kind) {
    case 'toggle': return typeof value === 'boolean' ? [] : [`${name} is a switch: true or false`];
    case 'number': case 'slider': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return [`${name} is a number`];
      if (typeof item.min === 'number' && value < item.min) return [`${name} is at least ${item.min}`];
      if (typeof item.max === 'number' && value > item.max) return [`${name} is at most ${item.max}`];
      return [];
    }
    case 'choice': return typeof value === 'string' && (!item.options || item.options.includes(value)) ? [] : [`${name} is one of: ${(item.options ?? []).join(', ')}`];
    case 'multi_choice': return Array.isArray(value) && (!item.options || value.every((v) => item.options.includes(v))) ? [] : [`${name} is a list of: ${(item.options ?? []).join(', ')}`];
    case 'text': case 'secret': case 'color': case 'asset_slot': return typeof value === 'string' && value.length <= 4000 ? [] : [`${name} is text (at most 4000 characters)`];
    default: return [];
  }
}

/* ================================================================== elements on screen */

/** Words in an element's label that mean pressing it deletes or throws something away. */
const DESTRUCTIVE_LABEL = /\b(delete|remove|reset|restore|clear|wipe|purge|uninstall|discard|drop|kill|destroy|revoke|erase|empty trash|sign out|log out|disconnect)\b/i;
/** Does pressing this element delete or reset something? (its label, or a danger style the console marks) */
export const consoleElementDestructive = (el) => !!(el && (el.danger === true || DESTRUCTIVE_LABEL.test(String(el.label ?? ''))));

/**
 * An element's stable id: `<where>/<role>:<label>` (where = the dialog, menu, toolbar, tab group or screen it sits in;
 * `#n` when the same label shows twice there). An element with its own `data-axf-id` keeps that.
 */
export function consoleElementId({ own, where, role, label, n = 1 } = {}) {
  if (own) return str(own, 160);
  const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').replace(/[/]/g, '∕').trim().slice(0, 60);
  return `${clean(where) || 'screen'}/${role || 'element'}:${clean(label) || '?'}${n > 1 ? `#${n}` : ''}`;
}

/** The elements matching a path: exact id first, then label words (every word must hit). */
export function consoleElementResolve(items, path) {
  const list = Array.isArray(items) ? items : [];
  const raw = String(path ?? '').trim();
  const hit = list.find((e) => e.id === raw) ?? list.find((e) => e.id.toLowerCase() === raw.toLowerCase());
  if (hit) return { item: hit };
  const words = foldWords(raw).split(' ').filter(Boolean);
  if (!words.length) return { candidates: [] };
  const scored = list.map((e) => {
    const label = foldWords(e.label); const where = foldWords(`${e.where ?? ''} ${e.role ?? ''}`);
    let sc = 0;
    for (const w of words) { if (label.split(' ').includes(w)) sc += 3; else if (label.includes(w)) sc += 2; else if (where.includes(w)) sc += 1; else return [e, 0]; }
    if (label === words.join(' ')) sc += 10;
    return [e, sc];
  }).filter(([, sc]) => sc > 0).sort((a, b) => b[1] - a[1]);
  if (!scored.length) return { candidates: [] };
  if (scored.length === 1 || scored[0][1] - scored[1][1] >= 1) return { item: scored[0][0] };
  return { candidates: scored.slice(0, 8).map(([e]) => e), ambiguous: true };
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

/** The permissions a caller needs to run an action remotely: the effect's control.console.* plus what the action itself requires. */
export function consoleActionNeeds(item) {
  const effect = consoleActionEffect(item);
  const needs = [effect === 'navigate' ? 'control.console.navigate' : effect === 'destructive' ? 'control.console.delete' : 'control.console.write'];
  if (item?.requires && effect !== 'navigate') needs.push(item.requires);
  return { effect, needs };
}

/* ================================================================== clients + delivery */

/**
 * The consoles a command goes to: `recent`, `all`, or a client id. Stale clients are left out. `recent` = the one Brett
 * is looking at: a client in front (`front: true`: its page is visible and, inside a host such as Molly, the host shows
 * its frame) wins over one that isn't, then the one used last (Nov 3 2026: a console hidden behind another app in Molly
 * used to win because it was touched last).
 */
export function consolePickClients(clients, to = 'recent', now = Date.now()) {
  const live = (Array.isArray(clients) ? clients : []).filter((c) => c && c.id && now - (Number(c.lastSeen ?? c.lastUsed) || 0) <= CONSOLE_CLIENT_STALE_MS);
  const front = (c) => (c.front === false ? 0 : 1);
  const sorted = [...live].sort((a, b) => front(b) - front(a) || (Number(b.lastUsed) || 0) - (Number(a.lastUsed) || 0));
  if (to === 'all') return sorted;
  if (!to || to === 'recent') return sorted.slice(0, 1);
  return sorted.filter((c) => c.id === to);
}

/** A client as `console.clients list` shows it (no catalog). */
export const consoleClientSummary = (c) => ({ id: c.id, app: c.app ?? 'console-web', ...(c.host ? { host: c.host } : {}), front: c.front !== false, title: c.title ?? '', device: c.device ?? '', user: c.user ?? '', lastUsed: c.lastUsed ? new Date(Number(c.lastUsed)).toISOString() : '', here: normalizeHere(c.here), items: c.catalog?.items?.length ?? 0 });

/** The message an open console receives. */
export function consoleMessage(fields, { id, by = '', now = Date.now() } = {}) {
  const m = { $axf: CONSOLE_COMMAND_FRAME, id: String(id ?? ''), op: fields.op };
  if (fields.hard === true) m.hard = true;
  for (const k of ['kind', 'target', 'label', 'spec', 'anchor', 'arg', 'verb']) if (fields[k] !== undefined && fields[k] !== '') m[k] = String(fields[k]);
  if (fields.confirmed === true) m.confirmed = true;
  m.by = by;
  m.at = new Date(now).toISOString();
  return m;
}

/** Is a message one a console may run? (the client checks before it touches its runtime) */
export function consoleMessageErrors(m) {
  const errors = [];
  if (!isObj(m) || m.$axf !== CONSOLE_COMMAND_FRAME) return [`$axf must be ${CONSOLE_COMMAND_FRAME}`];
  if (!CONSOLE_OPS.includes(m.op)) errors.push(`op must be ${CONSOLE_OPS.join(', ')}`);
  if ((m.op === 'read' || m.op === 'set' || m.op === 'unset') && !m.target) errors.push(`${m.op} needs a setting key (target)`);
  if (m.op === 'set' && m.arg === undefined) errors.push('set needs the value (arg, JSON)');
  if (m.op === 'press' && (!m.target || !CONSOLE_ELEMENT_ACTS.includes(m.verb))) errors.push(`press needs an element (target) and a verb (${CONSOLE_ELEMENT_ACTS.join(', ')})`);
  if (m.op === 'open' && (!CONSOLE_ITEM_KINDS.includes(m.kind) || m.kind === 'action' || !m.target)) errors.push('open needs a kind (screen, dialog, settings) and a target');
  if (m.op === 'run' && !m.spec) errors.push('run needs an action spec');
  return errors;
}

/* ================================================================== the console domain of control@1 */

/** Paths that mean "whichever dialog is open" for act close on console.dialogs. */
export const ANY_DIALOG = new Set(['current', 'any', 'open', 'dialog']);

const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
// `noConsole: true` tells the console server nothing is connected (rather than "no such screen"), so it can queue the
// command and deliver it when a console connects (console-wake, Nov 3 2026).
const noConsole = () => fail(CONTROL_WIRE.NOT_FOUND, 'no console is open for you right now: open the Dev Console (https://console.amberxai.com) in a browser, then try again', { noConsole: true });

/**
 * Run an already-gated control@1 command of the console domain against what the open consoles reported.
 * ctx = { clients, grants, salt, now, id, by }. → { ok: true, data, deliver? } or { ok: false, code, message, …extra }.
 * `deliver` = { to: [client ids], message }: the server sends the message and adds the consoles' acks to the answer.
 */
export function runConsoleCommand(c, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const clients = Array.isArray(ctx.clients) ? ctx.clients : [];
  const input = isObj(c.input) ? c.input : {};
  const to = str(input.to, 80) || 'recent';
  const select = isObj(c.select) ? c.select : {};
  const limit = Math.max(1, Math.min(Number(select.limit) || CONSOLE_LIST_DEFAULT, 500));
  if (c.target === 'console.clients') {
    const live = consolePickClients(clients, 'all', now).slice(0, limit);
    return { ok: true, data: { items: live.map(consoleClientSummary), total: live.length } };
  }
  const targets = consolePickClients(clients, c.op === 'act' ? to : (str(select.client, 80) || 'recent'), now);
  if (!targets.length) return to !== 'recent' && to !== 'all' && c.op === 'act' ? fail(CONTROL_WIRE.NOT_FOUND, `no open console ${to} (console.clients lists them)`) : noConsole();
  const catalog = targets[0].catalog?.items ?? [];
  const send = (fields, extra = {}) => ({ ok: true, data: { changed: [], ...extra }, deliver: { to: targets.map((t) => t.id), message: consoleMessage(fields, { id: ctx.id, by: ctx.by ?? c.by ?? '', now }) } });

  if (c.target === 'console.nav') {
    if (c.op === 'get') return { ok: true, data: { value: normalizeHere(targets[0].here), client: consoleClientSummary(targets[0]) } };
    return send(c.action === 'refresh' ? { op: 'refresh', hard: input.hard === true } : { op: c.action });
  }
  if (c.target === 'console.values') return runValues(c, catalog, select, limit, send);
  if (c.target === 'console.elements') return runElements(c, input, select, limit, send, ctx, now);
  const kind = CONSOLE_KINDS[c.target];
  // act close on dialogs: shut the open one ("current" / "any" / "open" = whichever it is; a dialog's id or name = only that one)
  if (c.target === 'console.dialogs' && c.op === 'act' && c.action === 'close') {
    const p = str(c.path, 200).trim().toLowerCase();
    if (!p || ANY_DIALOG.has(p)) return send({ op: 'close', kind });
    const d = consoleResolve(catalog, kind, c.path);
    if (!d.item) return fail(d.ambiguous ? CONTROL_WIRE.VALIDATION : CONTROL_WIRE.NOT_FOUND, d.ambiguous ? `"${c.path}" matches several: ${d.candidates.map((i) => `${i.label} (${i.id})`).join(', ')}; send the id` : `the console has no dialog "${c.path}" (send "current" to close whichever is open)`, { candidates: d.candidates ?? [] });
    return send({ op: 'close', kind, target: d.item.id, label: d.item.label }, { item: d.item });
  }
  if (c.op === 'list') {
    const items = consoleSearch(catalog, kind, str(select.q, 200), limit);
    return { ok: true, data: { items, total: catalog.filter((i) => i.kind === kind).length, client: targets[0].id } };
  }
  const r = consoleResolve(catalog, kind, c.path);
  if (!r.item) {
    const near = r.candidates?.length ? r.candidates : consoleSearch(catalog, kind, String(c.path).split(/[\s:/]+/)[0], 6);
    return r.ambiguous
      ? fail(CONTROL_WIRE.VALIDATION, `"${c.path}" matches several: ${r.candidates.map((i) => `${i.label} (${i.id})`).join(', ')}; send the id`, { candidates: r.candidates })
      : fail(CONTROL_WIRE.NOT_FOUND, `the console has no ${kind} "${c.path}"${near.length ? `; close ones: ${near.map((i) => `${i.label} (${i.id})`).join(', ')}` : ''} (control list ${c.target} names them)`, { candidates: near });
  }
  const item = r.item;
  if (c.op === 'get') return { ok: true, data: { item } };
  if (c.target === 'console.actions') {
    const { effect, needs } = consoleActionNeeds(item);
    const grants = ctx.grants ?? [];
    const missing = needs.filter((p) => !controlGranted(grants, p));
    if (missing.length) return fail(CONTROL_WIRE.DENIED, `running ${item.label} (${item.id}) ${effect === 'navigate' ? 'navigates' : effect === 'destructive' ? 'deletes or resets something' : 'changes data'} and needs ${missing.join(' + ')}`, { requires: missing[0], effect });
    const args = Array.isArray(input.args) ? input.args.map(String) : typeof input.args === 'string' && input.args ? input.args.split(':') : r.args ?? [];
    if (item.params && !args.length) return fail(CONTROL_WIRE.VALIDATION, `${item.label} (${item.id}) needs arguments: input.args (e.g. ${item.id}:<value>)`);
    const spec = [item.id, ...args].join(':');
    if (effect === 'destructive') {
      const bound = { op: 'act', target: c.target, path: spec, action: 'run' };
      if (!controlConfirmValid(bound, c.confirm, ctx.salt ?? '', now)) {
        return fail(CONTROL_WIRE.CONFIRMATION_REQUIRED, `${item.label} (${spec}) deletes or resets something; tell Brett, then send the same command again with this confirm token within ${CONTROL_CONFIRM_TTL_MS / 60000} minutes`, { confirm: controlConfirmToken(bound, ctx.salt ?? '', now), ttlMs: CONTROL_CONFIRM_TTL_MS, effect });
      }
    }
    return send({ op: 'run', kind: 'action', target: item.id, label: item.label, spec }, { item, effect });
  }
  return send({ op: 'open', kind, target: item.id, label: item.label, anchor: str(input.anchor, 160), arg: str(input.arg, 400) }, { item });
}

/** console.values: list from the catalog; get / set / reset go to the console (its settings registry answers). */
function runValues(c, catalog, select, limit, send) {
  const values = catalog.filter((i) => i.kind === 'value');
  if (c.op === 'list') {
    const tab = str(select.tab, 120);
    const all = consoleSearch(values, 'value', str(select.q, 200), CONSOLE_CATALOG_MAX).filter((i) => !tab || i.parent === tab || i.parent === tab.replace(/^plugins\//, ''));
    return { ok: true, data: { items: all.slice(0, limit), total: all.length } };
  }
  const key = str(c.path, 200);
  let item = values.find((i) => i.id === key) ?? values.find((i) => i.id.toLowerCase() === key.toLowerCase());
  if (!item && !(CONSOLE_VALUE_KEY.test(key) && key.includes('.'))) { // words, not a key: find the setting by its label
    const r = consoleResolve(values, 'value', key);
    if (!r.item) return fail(r.ambiguous ? CONTROL_WIRE.VALIDATION : CONTROL_WIRE.NOT_FOUND, r.ambiguous ? `"${key}" matches several settings: ${r.candidates.map((i) => `${i.label} (${i.id})`).join(', ')}; send the key` : `the console has no setting "${key}" (control list console.values names them)`, { candidates: r.candidates ?? [] });
    item = r.item;
  }
  const id = item?.id ?? key;
  const label = item?.label ?? key;
  const known = item ?? { kind: 'value', id, label: key, undeclared: true };
  if (c.op === 'get') {
    if (item?.secret) return fail(CONTROL_WIRE.DENIED, `${label} is a secret: it can be set, never read back`);
    return send({ op: 'read', kind: 'value', target: id, label }, { item: known });
  }
  if (c.op === 'reset') return send({ op: 'unset', kind: 'value', target: id, label }, { item: known });
  const errors = consoleValueErrors(item, c.value);
  if (errors.length) return fail(CONTROL_WIRE.VALIDATION, errors.join('; '));
  return send({ op: 'set', kind: 'value', target: id, label, arg: JSON.stringify(c.value) }, { item: known, value: item?.secret ? '(secret)' : c.value });
}

/** console.elements: what is on screen lives only in the console, so every op goes there; a destructive press needs a confirm. */
function runElements(c, input, select, limit, send, ctx, now) {
  if (c.op === 'list') return send({ op: 'elements', arg: str(select.q, 200), spec: String(Math.min(limit, CONSOLE_ELEMENTS_MAX)) });
  const path = str(c.path, 300);
  if (!path) return fail(CONTROL_WIRE.VALIDATION, 'name the element: its id from control list console.elements, or its label');
  if (c.op === 'get') return send({ op: 'elements', target: path });
  const verb = c.action;
  if (!CONSOLE_ELEMENT_ACTS.includes(verb)) return fail(CONTROL_WIRE.VALIDATION, `act on an element is ${CONSOLE_ELEMENT_ACTS.join(', ')}`);
  if (verb === 'set' && input.value === undefined) return fail(CONTROL_WIRE.VALIDATION, 'set needs input.value (the text, number or choice to put in)');
  if (verb === 'toggle' && input.on !== undefined && typeof input.on !== 'boolean') return fail(CONTROL_WIRE.VALIDATION, 'toggle takes input.on = true or false (or nothing, to flip it)');
  const bound = { op: 'act', target: 'console.elements', path, action: verb };
  let confirmed = false;
  if (c.confirm !== undefined) {
    if (!controlConfirmValid(bound, c.confirm, ctx.salt ?? '', now)) return fail(CONTROL_WIRE.VALIDATION, 'that confirm token is wrong or out of date: send the press again without it for a fresh one');
    if (!controlGranted(ctx.grants ?? [], 'control.console.delete')) return fail(CONTROL_WIRE.DENIED, `pressing ${path} deletes or resets something and needs control.console.delete`, { requires: 'control.console.delete' });
    confirmed = true;
  }
  const arg = JSON.stringify({ ...(input.on !== undefined ? { on: input.on } : {}), ...(input.value !== undefined ? { value: input.value } : {}) });
  // confirmToken: the server hands it back only when the console says the element deletes or resets something
  return send({ op: 'press', target: path, verb, arg, confirmed }, { verb, confirmToken: controlConfirmToken(bound, ctx.salt ?? '', now), ttlMs: CONTROL_CONFIRM_TTL_MS });
}

/** The confirm token a destructive console action needs (what the CLI prints, the check uses). */
export const consoleActionConfirm = (spec, salt, now = Date.now()) => controlConfirmToken({ op: 'act', target: 'console.actions', path: spec, action: 'run' }, salt, now);

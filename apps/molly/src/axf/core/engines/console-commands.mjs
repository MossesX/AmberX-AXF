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
 *   catalog  { $axf: 'console-catalog@1', app, items: [{ kind, id, label, detail?, icon?, keywords?, requires?, effect?, params?, parent? }], here? }
 *   client   { id, app, title, device, user, lastUsed, here, catalog }   (one per open console tab, kept by the server)
 *   message  { $axf: 'console-command@1', id, op: open|run|back|home|close, kind?, target?, label?, spec?, anchor?, arg?, by, at }
 *
 * Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */
import { CONTROL_WIRE, controlConfirmToken, controlConfirmValid, controlGranted, CONTROL_CONFIRM_TTL_MS } from './control-rules.mjs';

export const CONSOLE_CATALOG_FRAME = 'console-catalog@1';
export const CONSOLE_COMMAND_FRAME = 'console-command@1';
/** control@1 target → catalog kind. */
export const CONSOLE_KINDS = { 'console.screens': 'screen', 'console.dialogs': 'dialog', 'console.settings': 'settings', 'console.actions': 'action' };
export const CONSOLE_ITEM_KINDS = ['screen', 'dialog', 'settings', 'action'];
/** Where a console command goes: the console used last (default), every open console of the caller, or one client id. */
export const CONSOLE_DELIVERY = ['recent', 'all'];
export const CONSOLE_CATALOG_MAX = 3000;
export const CONSOLE_LIST_DEFAULT = 50;
/** How long a console counts as open without a heartbeat (the client re-announces every 30 s and on focus). */
export const CONSOLE_CLIENT_STALE_MS = 90_000;
/** The MCP shortcut tools every console MCP server publishes (names are a contract: Claude sessions call them through axHub). */
export const CONSOLE_TOOLS = ['console_open', 'console_dialog', 'console_settings', 'console_action', 'console_back', 'console_where', 'console_list', 'console_clients'];

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
  for (const k of ['detail', 'icon', 'requires', 'parent', 'module']) { const v = str(raw[k], 200); if (v) out[k] = v; }
  if (Array.isArray(raw.keywords)) { const kw = raw.keywords.map((x) => str(x, 80)).filter(Boolean).slice(0, 12); if (kw.length) out.keywords = kw; }
  if (['navigate', 'read', 'write', 'destructive'].includes(raw.effect)) out.effect = raw.effect;
  if (raw.params === true) out.params = true;
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
    if (!a?.id || m.stub) continue;
    items.push({ kind: 'action', id: a.id, label: m.label || a.id, detail: a.id, requires: m.requires, effect: m.effect, params: m.params === true, module: m.module });
  }
  return normalizeConsoleCatalog({ ...extra, items });
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

/** The consoles a command goes to: `recent` (the one used last), `all`, or a client id. Stale clients are left out. */
export function consolePickClients(clients, to = 'recent', now = Date.now()) {
  const live = (Array.isArray(clients) ? clients : []).filter((c) => c && c.id && now - (Number(c.lastSeen ?? c.lastUsed) || 0) <= CONSOLE_CLIENT_STALE_MS);
  const sorted = [...live].sort((a, b) => (Number(b.lastUsed) || 0) - (Number(a.lastUsed) || 0));
  if (to === 'all') return sorted;
  if (!to || to === 'recent') return sorted.slice(0, 1);
  return sorted.filter((c) => c.id === to);
}

/** A client as `console.clients list` shows it (no catalog). */
export const consoleClientSummary = (c) => ({ id: c.id, app: c.app ?? 'console-web', title: c.title ?? '', device: c.device ?? '', user: c.user ?? '', lastUsed: c.lastUsed ? new Date(Number(c.lastUsed)).toISOString() : '', here: normalizeHere(c.here), items: c.catalog?.items?.length ?? 0 });

/** The message an open console receives. */
export function consoleMessage(fields, { id, by = '', now = Date.now() } = {}) {
  const m = { $axf: CONSOLE_COMMAND_FRAME, id: String(id ?? ''), op: fields.op };
  for (const k of ['kind', 'target', 'label', 'spec', 'anchor', 'arg']) if (fields[k] !== undefined && fields[k] !== '') m[k] = String(fields[k]);
  m.by = by;
  m.at = new Date(now).toISOString();
  return m;
}

/** Is a message one a console may run? (the client checks before it touches its runtime) */
export function consoleMessageErrors(m) {
  const errors = [];
  if (!isObj(m) || m.$axf !== CONSOLE_COMMAND_FRAME) return [`$axf must be ${CONSOLE_COMMAND_FRAME}`];
  if (!['open', 'run', 'back', 'home', 'close'].includes(m.op)) errors.push('op must be open, run, back, home or close');
  if (m.op === 'open' && (!CONSOLE_ITEM_KINDS.includes(m.kind) || m.kind === 'action' || !m.target)) errors.push('open needs a kind (screen, dialog, settings) and a target');
  if (m.op === 'run' && !m.spec) errors.push('run needs an action spec');
  return errors;
}

/* ================================================================== the console domain of control@1 */

const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const noConsole = () => fail(CONTROL_WIRE.NOT_FOUND, 'no console is open for you right now: open the Dev Console (https://console.amberxai.com) in a browser, then try again');

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
    return send({ op: c.action });
  }
  const kind = CONSOLE_KINDS[c.target];
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

/** The confirm token a destructive console action needs (what the CLI prints, the check uses). */
export const consoleActionConfirm = (spec, salt, now = Date.now()) => controlConfirmToken({ op: 'act', target: 'console.actions', path: spec, action: 'run' }, salt, now);

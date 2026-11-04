#!/usr/bin/env node
/**
 * Console commands runner + CLI (control@1 console and apps domains, framework/spec/CONTROL.md → Console, Apps). A Claude
 * session, the REST API or the CLI opens a screen, a dialog or a settings tab in Brett's open console — or in any app on
 * the framework (build apps-control-surface, Nov 4 2026) — runs one of its actions, or moves it back / home. The gate is
 * control@1's (framework/core/engines/control-rules.mjs); resolving and the message are core/engines/console-commands.mjs;
 * the console server (server/__init__.py, the broker) hands in the caller's open clients and sends the message to them.
 *
 *   node console.mjs run      one command on stdin ({command, grants?, by?, clients}) → the answer as JSON (`deliver` = what to send)
 *   node console.mjs open <screen> | dialog <id> | dialog close [id] | settings <tab> [--anchor a] | action <id> [args…] [--confirm t]
 *                    | back | home | close | where | list [screens|dialogs|settings|actions|clients] [words] | clients
 *   node console.mjs app <app> open <screen> | dialog … | settings … | action … | back | home | close | where | list … | clients
 *   node console.mjs apps [words] [--online]          every app on the framework, its clients online and what it reports
 *        → sent to the console (AXF_CONSOLE_URL, default https://console.amberxai.com; AXF_TOKEN), which runs it
 *   --to recent|all|<client id>   which open client (default: the one in front, else used last)
 *   --remote <url> · --json
 *
 * Exit codes: 0 ok · 1 failed · 2 usage · 3 confirmation_required (a destructive action: the token and the command to repeat are printed).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROL_TARGETS, controlFailure, controlGate, controlResult, normalizeControl } from '../../../../framework/core/engines/control-rules.mjs';
import { APP_TOOLS, CONSOLE_TOOLS, normalizeApps, normalizeConsoleCatalog, runConsoleCommand } from '../../../../framework/core/engines/console-commands.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
export const FOLDER = 'console-commands';
export const DATA_DIR = process.env.AXF_CONSOLE_COMMANDS_DATA_DIR || join(ROOT, '.axf-console', 'plugins', FOLDER);
export const API_PATH = '/api/console';
export const APPS_FILE = process.env.AXF_APPS_FILE || join(ROOT, 'framework', 'schemas', 'apps.json');
const DOMAINS = new Set(['console', 'apps']);

/** The apps registry (apps@1, framework/schemas/apps.json), cleaned; the console is always in it. */
export function appsRegistry(file = APPS_FILE) {
  try { return normalizeApps(JSON.parse(readFileSync(file, 'utf8'))); } catch { return normalizeApps([]); }
}

/** The salt a destructive action's confirm token is made with (AXF_CONSOLE_COMMANDS_SALT, else random in the data folder). */
export function confirmSalt() {
  if (process.env.AXF_CONSOLE_COMMANDS_SALT) return process.env.AXF_CONSOLE_COMMANDS_SALT;
  const f = join(DATA_DIR, 'salt');
  try { const s = readFileSync(f, 'utf8').trim(); if (s) return s; } catch { /* first run */ }
  const s = randomBytes(24).toString('hex');
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(f, s, { mode: 0o600 });
  return s;
}

/**
 * Run one console / apps command for a caller: the control@1 gate (grants), then resolve against `clients` (the caller's
 * open clients of every app, with their catalogs). The answer is the control@1 envelope; `deliver` ({ to, message }) is
 * for the server.
 */
export function runConsole(raw, { grants = ['*'], by = '', clients = [], now = Date.now(), apps = appsRegistry() } = {}) {
  const c = normalizeControl(raw);
  if (!c.by && by) c.by = by;
  if (typeof c.target === 'string' && c.target in CONTROL_TARGETS && !DOMAINS.has(CONTROL_TARGETS[c.target].domain)) {
    return controlFailure('invalid', `${c.target} isn't a console or apps target (console.screens, console.dialogs, console.settings, console.actions, console.nav, console.clients; apps.list, apps.screens, apps.dialogs, apps.settings, apps.actions, apps.nav, apps.clients)`, { op: c.op, target: c.target });
  }
  const salt = confirmSalt();
  const gate = controlGate(c, grants, { salt, now });
  if (!gate.ok) { const { ok: _ok, code, message, ...extra } = gate; return controlFailure(code, message, { op: c.op, target: c.target, ...(c.path ? { path: c.path } : {}), ...extra }); }
  const known = (Array.isArray(clients) ? clients : []).map((x) => ({ ...x, catalog: normalizeConsoleCatalog(x?.catalog) }));
  const r = runConsoleCommand(c, { clients: known, grants, salt, now, apps, id: `cc-${now.toString(36)}-${randomBytes(3).toString('hex')}`, by: c.by ?? '' });
  if (!r.ok) { const { ok: _ok, code, message, ...extra } = r; return controlFailure(code, message, { op: c.op, target: c.target, ...(c.path ? { path: c.path } : {}), ...extra }); }
  return { ...controlResult(c, r.data, { by: c.by || 'unknown', reason: c.reason ?? '', at: new Date(now).toISOString() }), ...(r.deliver ? { deliver: r.deliver } : {}) };
}

/* ------------------------------------------------------------------ CLI */

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--') || a === '--') { out._.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    const takes = !['json', 'help', 'online'].includes(k);
    out[k] = inline !== undefined ? inline : takes && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

const KINDS = { screens: 'screens', screen: 'screens', dialogs: 'dialogs', dialog: 'dialogs', settings: 'settings', actions: 'actions', action: 'actions', clients: 'clients', consoles: 'clients' };
export const USAGE = [
  'usage: axf console open <screen> | dialog <id> | dialog close [id] | settings <tab> | action <id> [args…] | back | home | close | where | list [screens|dialogs|settings|actions|clients] [words] | clients   [--to recent|all|<client>]',
  '       axf app <app> open <screen> | dialog <id> | settings <tab> | action <id> [args…] | back | home | close | where | list [kind] [words] | clients   (app = its id, label or alias: amberx, hub, molly, console)',
  '       axf apps [words] [--online]      every app on the framework, its clients online and what it reports',
].join('\n');

/** `axf console …` / `axf app <app> …` / `axf apps …` words → a control@1 command, or { error }. */
export function commandFromArgv(argv) {
  const f = flags(argv);
  let words_ = f._;
  let domain = 'console';
  let app = '';
  if (words_[0] === 'console') words_ = words_.slice(1);
  else if (words_[0] === 'apps') {
    const q = words_.slice(1).join(' ').trim();
    const select = { ...(q ? { q } : {}), ...(f.online ? { online: true } : {}), ...(f.limit ? { limit: Number(f.limit) } : {}) };
    return { command: { op: 'list', target: 'apps.list', ...(Object.keys(select).length ? { select } : {}) }, base: typeof f.remote === 'string' ? f.remote : '', json: !!f.json };
  } else if (words_[0] === 'app') {
    domain = 'apps';
    app = words_[1] ?? '';
    if (!app) return { error: USAGE };
    words_ = words_.slice(2);
  }
  const [verb, ...rest] = words_;
  const words = rest.join(' ').trim();
  const T = (kind) => `${domain}.${kind}`;
  const input = Object.fromEntries(['to', 'anchor', 'arg'].filter((k) => typeof f[k] === 'string').map((k) => [k, f[k]]));
  if (app) input.app = app;
  const act = (kind, action, path) => (path ? { op: 'act', target: T(kind), path, action, ...(Object.keys(input).length ? { input } : {}) } : null);
  let cmd = null;
  switch (verb) {
    case 'open': case 'screen': case 'go': cmd = act('screens', 'open', words); break;
    case 'dialog': cmd = rest[0] === 'close' ? act('dialogs', 'close', rest.slice(1).join(' ').trim() || 'current') : act('dialogs', 'open', words); break;
    case 'settings': case 'setting': cmd = act('settings', 'open', words); break;
    case 'action': case 'run': {
      const [id, ...args] = rest;
      cmd = act('actions', 'run', id);
      if (cmd && args.length) cmd.input = { ...(cmd.input ?? {}), args };
      if (cmd && typeof f.confirm === 'string') cmd.confirm = f.confirm;
      break;
    }
    case 'back': case 'home': case 'close': cmd = act('nav', verb, 'here'); break;
    case 'where': case 'here': cmd = { op: 'get', target: T('nav'), path: 'here', ...(app ? { input: { app } } : {}) }; break;
    case 'clients': case 'consoles': cmd = { op: 'list', target: T('clients'), ...(app ? { select: { app } } : {}) }; break;
    case 'list': case 'ls': {
      const kind = KINDS[rest[0]];
      const q = (kind ? rest.slice(1) : rest).join(' ').trim();
      const select = { ...(app ? { app } : {}), ...(q ? { q } : {}), ...(f.limit ? { limit: Number(f.limit) } : {}), ...(typeof f.to === 'string' && f.to !== 'all' && f.to !== 'recent' ? { client: f.to } : {}) };
      cmd = { op: 'list', target: T(kind ?? 'screens'), ...(Object.keys(select).length ? { select } : {}) };
      break;
    }
    default: return { error: USAGE };
  }
  if (!cmd) return { error: USAGE };
  if (typeof f.by === 'string') cmd.by = f.by;
  if (typeof f.reason === 'string') cmd.reason = f.reason;
  return { command: cmd, base: typeof f.remote === 'string' ? f.remote : '', json: !!f.json };
}

/** An answer as a person reads it. */
export function formatAnswer(r) {
  if (!r.ok) return r.code === 'confirmation_required' ? `${r.message}\nconfirm token: ${r.confirm}` : `${r.code}: ${r.message}`;
  if (r.op === 'list') {
    const rows = r.items ?? [];
    if (r.target === 'apps.list') return rows.length ? rows.map((a) => `${a.id.padEnd(16)} ${a.label.padEnd(14)} ${(a.online ? `${a.online} online` : 'closed').padEnd(10)} ${String(a.screens).padStart(3)} screens ${String(a.settings).padStart(3)} settings ${String(a.dialogs).padStart(3)} dialogs ${String(a.actions).padStart(3)} actions  ${a.here?.screenLabel ?? a.here?.screen ?? ''}  ${a.url}`).join('\n') : 'no apps';
    if (!rows.length) return r.target.endsWith('.clients') ? (r.target === 'apps.clients' ? 'no app is open right now' : 'no console is open right now') : 'nothing matches';
    if (r.target.endsWith('.clients')) return rows.map((c) => `${c.id.padEnd(26)} ${(c.appId ?? c.app ?? '').padEnd(14)} ${(c.device || '').padEnd(8)} ${(c.here?.screen ?? '').padEnd(22)} ${c.front === false ? 'hidden ' : '       '} ${c.lastUsed}  ${c.user}`).join('\n');
    return `${rows.map((i) => `${i.id.padEnd(32)} ${i.label}${i.params ? '  (needs args)' : ''}`).join('\n')}${r.total > rows.length ? `\n… ${r.total - rows.length} more (add words, or --limit N)` : ''}`;
  }
  if (r.op === 'get') return r.item ? `${r.item.kind} ${r.item.id}: ${r.item.label}${r.item.detail ? ` (${r.item.detail})` : ''}` : `here${r.app ? ` (${r.app})` : ''}: ${Object.entries(r.value ?? {}).map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') || 'unknown'}`;
  const sent = r.delivered ?? [];
  const what = r.item ? `${r.item.label} (${r.item.id})` : r.action;
  const inApp = r.app && r.target?.startsWith('apps.') ? ` in ${r.app}` : '';
  if (r.queued) return `queued: ${r.action} ${what}${inApp} — ${r.message ?? 'waiting for the app'}`;
  if (!sent.length) return `sent: ${r.action} ${what}${inApp} (nothing answered yet)`;
  const how = r.delivery?.how && r.delivery.how !== 'live' ? ` (${r.delivery.how})` : '';
  return `${sent.some((d) => d.ok) ? '✓' : '✗'} ${r.action} ${what}${inApp}${how} → ${sent.map((d) => `${d.client}: ${d.ok ? d.message || 'done' : `failed: ${d.message}`}`).join(' · ')}`;
}

/** Send a whole command to the broker's /api/console. Never throws: network trouble is an `unexpected` failure. */
export async function sendToConsole(command, { base = process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com', token = process.env.AXF_TOKEN || '', fetch: f = globalThis.fetch } = {}) {
  const url = `${String(base).replace(/\/$/, '')}${API_PATH}`;
  try {
    const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ $axf: 'control@1', ...command }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { $axf: 'control@1', ok: false, code: res.status === 404 ? 'not_found' : res.status === 401 || res.status === 403 ? 'denied' : 'unexpected', message: `${res.status} ${text.slice(0, 200)}` }; }
  } catch (e) {
    return { $axf: 'control@1', ok: false, code: 'unexpected', message: `could not reach ${url}: ${e?.message ?? e}` };
  }
}

const sh = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, "'\\''")}'`);

export async function main(argv) {
  const [cmd] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || (cmd === 'console' && (!argv[1] || argv[1] === 'help'))) {
    console.log([USAGE, '', 'Examples:', '  axf console open plan studio', '  axf console settings plugins', '  axf console action terminal.open', '  axf console list screens build', '  axf console back · axf console where · axf console clients',
      '  axf apps · axf app amberx open to-dos · axf app molly action xlayout.ide · axf app hub where',
      '', `MCP tools (console /mcp, and through axHub): ${CONSOLE_TOOLS.join(', ')}; every app: ${APP_TOOLS.join(', ')}`, `REST: POST ${API_PATH} (a whole control@1 command), POST ${API_PATH}/open {screen} …, GET ${API_PATH}/apps, POST ${API_PATH}/app/open {app, screen} …`].join('\n'));
    return 0;
  }
  if (cmd === 'run') {
    const body = JSON.parse(argv[1] && argv[1].startsWith('{') ? argv[1] : readFileSync(0, 'utf8'));
    console.log(JSON.stringify(runConsole(body.command ?? body, { grants: Array.isArray(body.grants) ? body.grants : ['*'], by: body.by ?? '', clients: Array.isArray(body.clients) ? body.clients : [] })));
    return 0;
  }
  const parsed = commandFromArgv(argv);
  if (parsed.error) { console.error(parsed.error); return 2; }
  const { command, json } = parsed;
  if (!command.by) command.by = process.env.AXF_ACTOR || `cli:${process.env.USER || 'user'}`;
  const r = await sendToConsole(command, parsed.base ? { base: parsed.base } : {});
  console.log(json ? JSON.stringify(r, null, 1) : formatAnswer(r));
  if (!r.ok && r.code === 'confirmation_required') {
    if (!json) console.log(`repeat to run it: axf ${argv.filter((a) => a !== '--json').map(sh).join(' ')} --confirm ${r.confirm}`);
    return 3;
  }
  return r.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 1; });
}

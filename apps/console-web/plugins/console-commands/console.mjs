#!/usr/bin/env node
/**
 * Console commands runner + CLI (control@1 console domain, framework/spec/CONTROL.md → Console). A Claude session, the
 * REST API or the CLI opens a screen, a dialog or a settings tab in Brett's open console, runs one of its actions, or
 * moves it back / home. The gate is control@1's (framework/core/engines/control-rules.mjs); resolving and the message
 * are core/engines/console-commands.mjs; the console server (server/__init__.py) hands in the caller's open consoles
 * and sends the message to them.
 *
 *   node console.mjs run      one command on stdin ({command, grants?, by?, clients}) → the answer as JSON (`deliver` = what to send)
 *   node console.mjs open <screen> | dialog <id> | settings <tab> [--anchor a] | action <id> [args…] [--confirm t]
 *                    | back | home | close | where | list [screens|dialogs|settings|actions|clients] [words] | clients
 *        → sent to the console (AXF_CONSOLE_URL, default https://console.amberxai.com; AXF_TOKEN), which runs it
 *   --to recent|all|<client id>   which open console (default: the one used last)
 *   --remote <url> · --json
 *
 * Exit codes: 0 ok · 1 failed · 2 usage · 3 confirmation_required (a destructive action: the token and the command to repeat are printed).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROL_TARGETS, controlFailure, controlGate, controlResult, normalizeControl } from '../../../../framework/core/engines/control-rules.mjs';
import { CONSOLE_TOOLS, TAB_ACTIONS, TAB_TOOLS, normalizeConsoleCatalog, runConsoleCommand } from '../../../../framework/core/engines/console-commands.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
export const FOLDER = 'console-commands';
export const DATA_DIR = process.env.AXF_CONSOLE_COMMANDS_DATA_DIR || join(ROOT, '.axf-console', 'plugins', FOLDER);
export const API_PATH = '/api/console';

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
 * Run one console command for a caller: the control@1 gate (grants), then resolve against `clients` (the caller's open
 * consoles with their catalogs). The answer is the control@1 envelope; `deliver` ({ to, message }) is for the server.
 */
export function runConsole(raw, { grants = ['*'], by = '', clients = [], now = Date.now() } = {}) {
  const c = normalizeControl(raw);
  if (!c.by && by) c.by = by;
  if (typeof c.target === 'string' && c.target in CONTROL_TARGETS && CONTROL_TARGETS[c.target].domain !== 'console') {
    return controlFailure('invalid', `${c.target} isn't a console target (console.screens, console.dialogs, console.settings, console.actions, console.nav, console.clients)`, { op: c.op, target: c.target });
  }
  const salt = confirmSalt();
  const gate = controlGate(c, grants, { salt, now });
  if (!gate.ok) { const { ok: _ok, code, message, ...extra } = gate; return controlFailure(code, message, { op: c.op, target: c.target, ...(c.path ? { path: c.path } : {}), ...extra }); }
  const known = (Array.isArray(clients) ? clients : []).map((x) => ({ ...x, catalog: normalizeConsoleCatalog(x?.catalog) }));
  const r = runConsoleCommand(c, { clients: known, grants, salt, now, id: `cc-${now.toString(36)}-${randomBytes(3).toString('hex')}`, by: c.by ?? '' });
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
    const takes = !['json', 'help'].includes(k);
    out[k] = inline !== undefined ? inline : takes && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

const LIST_KINDS = { screens: 'console.screens', screen: 'console.screens', dialogs: 'console.dialogs', dialog: 'console.dialogs', settings: 'console.settings', actions: 'console.actions', action: 'console.actions', clients: 'console.clients', consoles: 'console.clients' };
export const USAGE = 'usage: axf console open <screen> | dialog <id> | settings <tab> | action <id> [args…] | back | home | close | where | list [screens|dialogs|settings|actions|clients] [words] | clients | tabs | tab open|close|float|dock <tab or screen>   [--to recent|all|<client>]';

/** `axf console …` words → a control@1 console command, or { error }. */
export function commandFromArgv(argv) {
  const f = flags(argv);
  const [verb, ...rest] = f._[0] === 'console' ? f._.slice(1) : f._;
  const words = rest.join(' ').trim();
  const input = Object.fromEntries(['to', 'anchor', 'arg'].filter((k) => typeof f[k] === 'string').map((k) => [k, f[k]]));
  const act = (target, action, path) => (path ? { op: 'act', target, path, action, ...(Object.keys(input).length ? { input } : {}) } : null);
  let cmd = null;
  switch (verb) {
    case 'open': case 'screen': case 'go': cmd = act('console.screens', 'open', words); break;
    case 'dialog': cmd = act('console.dialogs', 'open', words); break;
    case 'settings': case 'setting': cmd = act('console.settings', 'open', words); break;
    case 'action': case 'run': {
      const [id, ...args] = rest;
      cmd = act('console.actions', 'run', id);
      if (cmd && args.length) cmd.input = { ...(cmd.input ?? {}), args };
      if (cmd && typeof f.confirm === 'string') cmd.confirm = f.confirm;
      break;
    }
    case 'back': case 'home': case 'close': cmd = act('console.nav', verb, 'here'); break;
    case 'where': case 'here': cmd = { op: 'get', target: 'console.nav', path: 'here' }; break;
    case 'clients': case 'consoles': cmd = { op: 'list', target: 'console.clients' }; break;
    // main-tabs@1: the main area's tab group
    case 'tabs': cmd = { op: 'get', target: 'console.nav', path: 'here' }; break;
    case 'tab': {
      const [op, ...what] = rest;
      const action = TAB_ACTIONS[op];
      const q = what.join(' ').trim();
      cmd = action && q ? { op: 'act', target: 'console.actions', path: action, action: 'run', input: { ...input, args: [q] } } : null;
      break;
    }
    case 'list': case 'ls': {
      const kind = LIST_KINDS[rest[0]];
      const q = (kind ? rest.slice(1) : rest).join(' ').trim();
      const select = { ...(q ? { q } : {}), ...(f.limit ? { limit: Number(f.limit) } : {}), ...(typeof f.to === 'string' && f.to !== 'all' && f.to !== 'recent' ? { client: f.to } : {}) };
      cmd = { op: 'list', target: kind ?? 'console.screens', ...(Object.keys(select).length ? { select } : {}) };
      break;
    }
    default: return { error: USAGE };
  }
  if (!cmd) return { error: USAGE };
  if (typeof f.by === 'string') cmd.by = f.by;
  if (typeof f.reason === 'string') cmd.reason = f.reason;
  return { command: cmd, base: typeof f.remote === 'string' ? f.remote : '', json: !!f.json, ...(verb === 'tabs' ? { format: 'tabs' } : {}) };
}

/** An answer as a person reads it (`format: 'tabs'` = the open tabs of a `here` answer). */
export function formatAnswer(r, format = '') {
  if (!r.ok) return r.code === 'confirmation_required' ? `${r.message}\nconfirm token: ${r.confirm}` : `${r.code}: ${r.message}`;
  if (r.op === 'list') {
    const rows = r.items ?? [];
    if (!rows.length) return r.target === 'console.clients' ? 'no console is open right now' : 'nothing matches';
    if (r.target === 'console.clients') return rows.map((c) => `${c.id.padEnd(26)} ${(c.device || '').padEnd(8)} ${(c.here?.screen ?? '').padEnd(22)} ${c.lastUsed}  ${c.user}`).join('\n');
    return `${rows.map((i) => `${i.id.padEnd(32)} ${i.label}${i.params ? '  (needs args)' : ''}`).join('\n')}${r.total > rows.length ? `\n… ${r.total - rows.length} more (add words, or --limit N)` : ''}`;
  }
  if (format === 'tabs' && r.ok) return !Array.isArray(r.value?.tabs) ? 'this console shows no tab group' : r.value.tabs.length ? r.value.tabs.map((t) => `${t.active ? '●' : ' '} ${t.id.padEnd(28)} ${(t.where).padEnd(9)} ${t.title}${t.pinned ? '  (pinned)' : ''}${t.dirty ? '  (unsaved)' : ''}`).join('\n') : 'no tabs open';
  if (r.op === 'get') return r.item ? `${r.item.kind} ${r.item.id}: ${r.item.label}${r.item.detail ? ` (${r.item.detail})` : ''}` : `here: ${Object.entries(r.value ?? {}).filter(([k]) => k !== 'tabs').map(([k, v]) => `${k} ${v}`).join(' · ') || 'unknown'}`;
  const sent = r.delivered ?? [];
  const what = r.item ? `${r.item.label} (${r.item.id})` : r.action;
  if (!sent.length) return `sent: ${r.action} ${what} (no console answered yet)`;
  return `${sent.some((d) => d.ok) ? '✓' : '✗'} ${r.action} ${what} → ${sent.map((d) => `${d.client}: ${d.ok ? d.message || 'done' : `failed: ${d.message}`}`).join(' · ')}`;
}

/** Send a whole command to a console's /api/console. Never throws: network trouble is an `unexpected` failure. */
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
  if (argv[0] === 'console') argv = argv.slice(1);
  const [cmd] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log([USAGE, '', 'Examples:', '  axf console open plan studio', '  axf console settings plugins', '  axf console action terminal.open', '  axf console list screens build', '  axf console back · axf console where · axf console clients', '  axf console tabs · axf console tab open plan · axf console tab float plan · axf console tab dock plan',
      '', `MCP tools (console /mcp, and through axHub): ${[...CONSOLE_TOOLS, ...TAB_TOOLS].join(', ')}`, `REST: POST ${API_PATH} (a whole control@1 command), POST ${API_PATH}/open {screen} …`].join('\n'));
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
  console.log(json ? JSON.stringify(r, null, 1) : formatAnswer(r, parsed.format));
  if (!r.ok && r.code === 'confirmation_required') {
    if (!json) console.log(`repeat to run it: axf console ${argv.filter((a) => a !== '--json' && a !== 'console').map(sh).join(' ')} --confirm ${r.confirm}`);
    return 3;
  }
  return r.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 1; });
}

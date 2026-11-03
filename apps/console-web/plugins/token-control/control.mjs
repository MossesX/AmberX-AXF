#!/usr/bin/env node
/**
 * Token control runner + CLI (control@1, framework/spec/CONTROL.md). ONE place runs a command, whatever carried it:
 * the console's REST routes and MCP tools (server/__init__.py → `node control.mjs run`), the CLI (`axf control …`,
 * `axf token | note | todo | task | list | plan | build …`, or this file directly) and the shared JS client
 * (web/client.mjs → POST /api/control). The gate, the validation, the confirm tokens and the result envelope come from
 * framework/core/engines/control-rules.mjs; the targets are run by lib/tokens.mjs, lib/amberx.mjs and lib/planner.mjs.
 *
 *   node control.mjs run                       one command as JSON on stdin ({command, grants?, by?}) → the answer as JSON
 *   node control.mjs <op> <target> [path] …     list | get | set | reset | add | remove | act (see `help`)
 *   node control.mjs targets | tools | routes | schema | registry | audit [n] | where | help
 *   node control.mjs console open <screen> | dialog <id> | settings <tab> | action <id> [args…] | back | home | close | where
 *                    | list [screens|dialogs|settings|actions|clients] [words]     (`axf console …`; always sent to the console)
 *   --remote [url]   send it to a console instead (AXF_CONSOLE_URL, default https://console.amberxai.com; AXF_TOKEN)
 *   --json           print the raw answer
 *
 * Exit codes: 0 ok · 1 failed · 2 usage · 3 confirmation_required (the token and the exact command to repeat are printed).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTROL_ALIASES, CONTROL_OPS, CONTROL_TARGETS, CONTROL_TARGET_IDS, CONTROL_WIRE, controlCli, controlFailure, controlGate, controlRegistry,
  controlResult, controlRoutes, controlSchema, controlTools, normalizeControl,
} from '../../../../framework/core/engines/control-rules.mjs';
import { ControlError, audit, confirmSalt, readAudit } from './lib/common.mjs';
import { appearanceFile, runTokens } from './lib/tokens.mjs';
import { notesDir, runAmberx } from './lib/amberx.mjs';
import { runPlanner } from './lib/planner.mjs';
import { runConsoleCommand } from '../../../../framework/core/engines/console-commands.mjs';
import { randomBytes } from 'node:crypto';

/**
 * Run one control@1 command. `grants` = the caller's permissions (the console token = ['*']; a wall user's role
 * grants; already capped for a remote caller). `preset` = fields an alias fixes (`axf todo …` → kind todo).
 * `context` = what only the console server knows: `clients` (the caller's open consoles and their catalogs) for the
 * console domain; the answer then carries `deliver` ({ to, message }) for the server to send and strip.
 */
export async function runControl(raw, { grants = ['*'], by = '', preset = null, now = Date.now(), context = null } = {}) {
  const c = normalizeControl(raw);
  if (!c.by && by) c.by = by;
  // an alias preset (kind) is a filter on list and a default on add
  if (preset && c.target === 'amberx.items') {
    if (c.op === 'list') c.select = { ...preset, ...(c.select ?? {}) };
    if (c.op === 'add' && c.value && typeof c.value === 'object') c.value = { ...preset, ...c.value };
  }
  const gate = controlGate(c, grants, { salt: confirmSalt(), now });
  if (!gate.ok) {
    const { ok: _ok, code, message, ...extra } = gate;
    return controlFailure(code, message, { op: c.op, target: c.target, ...(c.path ? { path: c.path } : {}), ...extra });
  }
  const domain = CONTROL_TARGETS[c.target].domain;
  try {
    const data = domain === 'tokens' ? runTokens(c) : domain === 'amberx' ? runAmberx(c) : domain === 'console' ? runConsole(c, context, grants, now) : await runPlanner(c);
    const at = new Date(now).toISOString();
    if (gate.effect !== 'read') audit({ by: c.by || 'unknown', reason: c.reason ?? '', op: c.op, target: c.target, path: c.path, action: c.action, value: c.value, input: c.input });
    return controlResult(c, data, { by: c.by || 'unknown', reason: c.reason ?? '', at });
  } catch (e) {
    if (e instanceof ControlError) return controlFailure(e.code, e.message, { op: c.op, target: c.target, ...(c.path ? { path: c.path } : {}), ...e.extra });
    return controlFailure(CONTROL_WIRE.UNEXPECTED, e?.message ?? String(e), { op: c.op, target: c.target });
  }
}

/** The console domain: resolved against the open consoles the server hands in (core/engines/console-commands.mjs). */
function runConsole(c, context, grants, now) {
  if (!context || !Array.isArray(context.clients)) {
    throw new ControlError(CONTROL_WIRE.NOT_IMPLEMENTED, 'console commands run in the console server, where the open consoles are: axf console … sends them there (AXF_CONSOLE_URL), or POST /api/control');
  }
  const r = runConsoleCommand(c, { clients: context.clients, grants, salt: confirmSalt(), now, id: `cc-${now.toString(36)}-${randomBytes(3).toString('hex')}`, by: c.by ?? '' });
  if (!r.ok) { const { ok: _ok, code, message, ...extra } = r; throw new ControlError(code, message, extra); }
  return r.deliver ? { ...r.data, deliver: r.deliver } : r.data;
}

/* ------------------------------------------------------------------ CLI → command */

const CONSOLE_LIST_KINDS = { screens: 'console.screens', screen: 'console.screens', dialogs: 'console.dialogs', dialog: 'console.dialogs', settings: 'console.settings', actions: 'console.actions', action: 'console.actions', clients: 'console.clients', consoles: 'console.clients' };

/**
 * `axf console …` words → a control@1 command of the console domain, or { error }.
 *   open <screen words> · dialog <id|words> · settings <tab|plugins/<id>|words> [--anchor a] · action <id|words> [args…]
 *   back · home · close · where · list [screens|dialogs|settings|actions|clients] [words] · clients
 *   --to recent|all|<client id> · --confirm <token> (a destructive action's second call)
 */
export function consoleCommandFromArgv(argv) {
  const f = flags(argv);
  const [verb, ...rest] = f._[0] === 'console' ? f._.slice(1) : f._;
  const words = rest.join(' ').trim();
  const input = { ...(typeof f.to === 'string' ? { to: f.to } : {}), ...(typeof f.anchor === 'string' ? { anchor: f.anchor } : {}), ...(typeof f.arg === 'string' ? { arg: f.arg } : {}) };
  const usage = 'usage: axf console open <screen> | dialog <id> | settings <tab> | action <id> [args…] | back | home | close | where | list [screens|dialogs|settings|actions|clients] [words]';
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
    case 'clients': cmd = { op: 'list', target: 'console.clients' }; break;
    case 'list': case 'ls': {
      const kind = CONSOLE_LIST_KINDS[rest[0]];
      const q = (kind ? rest.slice(1) : rest).join(' ').trim();
      cmd = { op: 'list', target: kind ?? 'console.screens', ...(q || f.limit ? { select: { ...(q ? { q } : {}), ...(f.limit ? { limit: Number(f.limit) } : {}) } } : {}) };
      break;
    }
    default: return { error: usage };
  }
  if (!cmd) return { error: usage };
  if (typeof f.by === 'string') cmd.by = f.by;
  if (typeof f.reason === 'string') cmd.reason = f.reason;
  return { command: cmd, remote: f.remote ?? true, json: !!f.json };
}

const TOKEN_SETS = ['theme', 'style', 'layout', 'typography', 'density', 'sizing', 'look', 'custom', 'slots'];

/** A CLI word as a value: JSON when it parses (numbers, true/false, objects), else the plain string. */
export function parseValue(s) {
  if (s === undefined) return undefined;
  try { return JSON.parse(s); } catch { return s; }
}

function flags(argv) {
  const out = { _: [], select: {}, field: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--') || a === '--') { out._.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    const takes = !['json', 'remote', 'help', 'yes', 'deep', 'include-hidden'].includes(k) || (k === 'remote' && argv[i + 1] && /^https?:/.test(argv[i + 1]));
    const v = inline !== undefined ? inline : takes && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    if (k === 'select' || k === 'field' || k === 'input') { const [fk, fv] = String(v).split(/=(.*)/s); (out[k === 'input' ? 'field' : k])[fk] = parseValue(fv); }
    else out[k] = v;
  }
  return out;
}

/** Which target an alias word + the next word name; null when the word isn't an alias. */
export function aliasTarget(word, next) {
  if (word === 'control') return { target: null };
  if (word === 'token' || word === 'tokens') return TOKEN_SETS.includes(next) ? { target: `tokens.${next}`, eat: 1 } : { target: null, error: `axf token <${TOKEN_SETS.join('|')}> <op> …` };
  const a = CONTROL_ALIASES[word];
  return a ? { target: a.target, preset: a.preset ?? null } : null;
}

/**
 * CLI words → { command, preset } or { error }. Accepted shapes:
 *   control <op> <target> [path] [value|json] [action] [json input]
 *   token <set> <op> [path] [value]
 *   note|todo|task|list|plan|build <op> [path] [value|json]       (op may be a verb: `axf todo done <id>`)
 * Shortcuts: `add "some text"` → {text} for items / {name} for lists / {title} for plans and builds; --field k=v adds
 * fields to set/add (and act input), --select k=v filters list, --confirm <token>, --by, --reason, --list <id>.
 */
export function commandFromArgv(argv) {
  const f = flags(argv);
  let words = f._;
  let target = null; let preset = null;
  const head = aliasTarget(words[0], words[1]);
  if (head?.error) return { error: head.error };
  if (head && head.target === null) words = words.slice(1); // control …
  else if (head) { target = head.target; preset = head.preset; words = words.slice(1 + (head.eat ?? 0)); }
  let op = words.shift();
  if (!target) target = words.shift();
  if (!op || !target) return { error: 'usage: axf control <op> <target> … (axf control help)' };
  if (!CONTROL_TARGET_IDS.includes(target)) return { error: `unknown target ${target} (${CONTROL_TARGET_IDS.join(', ')})` };
  const t = CONTROL_TARGETS[target];
  const cmd = { op, target };
  // a verb in the op's place: act
  if (!CONTROL_OPS.includes(op) && t.acts && op in t.acts) { cmd.op = 'act'; cmd.action = op; op = 'act'; }
  else if (!CONTROL_OPS.includes(op)) return { error: `${op} isn't an op (${CONTROL_OPS.join(', ')}) or a verb of ${target} (${Object.keys(t.acts ?? {}).join(', ') || 'none'})` };
  const fields = { ...f.field };
  if (f.list && target === 'amberx.items') fields.list = parseValue(f.list);
  switch (op) {
    case 'list': if (Object.keys(f.select).length) cmd.select = f.select; if (f.deep) cmd.select = { ...(cmd.select ?? {}), deep: true }; if (f['include-hidden']) cmd.select = { ...(cmd.select ?? {}), includeHidden: true }; break;
    case 'get': cmd.path = words[0]; break;
    case 'set': {
      cmd.path = words[0];
      const v = parseValue(words[1]);
      cmd.value = t.paths === 'entity' ? { ...(v && typeof v === 'object' ? v : {}), ...fields } : v;
      break;
    }
    case 'reset': if (words[0]) cmd.path = words[0]; break;
    case 'add': {
      const v = parseValue(words.join(' ') || undefined);
      const key = target === 'amberx.items' ? 'text' : target === 'amberx.lists' ? 'name' : 'title';
      cmd.value = { ...(v && typeof v === 'object' ? v : v !== undefined ? { [key]: String(v) } : {}), ...fields };
      break;
    }
    case 'remove': cmd.path = words[0]; if (typeof f.confirm === 'string') cmd.confirm = f.confirm; break;
    case 'act': {
      if (!cmd.action) { cmd.path = words[0]; cmd.action = words[1]; words = words.slice(2); } else { cmd.path = words[0]; words = words.slice(1); }
      const v = parseValue(words.join(' ') || undefined);
      const wants = Object.keys(t.acts?.[cmd.action] ?? {});
      // a bare word fills the verb's only input (axf todo move <id> groceries; axf build note <id> some text)
      const input = v && typeof v === 'object' ? v : v !== undefined && wants.length ? { [wants[0]]: wants[0] === 'text' || wants[0] === 'title' || wants[0] === 'name' ? words.join(' ') : v } : {};
      cmd.input = { ...input, ...fields };
      // booleans a verb wants default to true; a trailing undo / off / false turns them off (axf build step <id> s3 undo)
      const off = ['undo', 'off', 'false', 'no'].includes(String(words[words.length - 1] ?? '').toLowerCase());
      if (off && wants[0] && typeof cmd.input[wants[0]] === 'string') cmd.input[wants[0]] = words.slice(0, -1).join(' ');
      for (const [k, decl] of Object.entries(t.acts?.[cmd.action] ?? {})) if (decl === 'boolean' && !(k in cmd.input)) cmd.input[k] = !off;
      break;
    }
    default: break;
  }
  if (typeof f.by === 'string') cmd.by = f.by;
  if (typeof f.reason === 'string') cmd.reason = f.reason;
  return { command: cmd, preset, profile: typeof f.profile === 'string' ? f.profile : '', remote: f.remote, json: !!f.json };
}

/* ------------------------------------------------------------------ printing */

const show = (v) => (v === null || v === undefined ? '–' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function formatAnswer(r) {
  if (!r.ok) {
    if (r.code === 'confirmation_required') return `${r.message}\nconfirm token: ${r.confirm}`;
    return `${r.code}: ${r.message}`;
  }
  if (r.target?.startsWith('console.')) return formatConsole(r);
  if (r.op === 'list') {
    const rows = r.items ?? [];
    if (!rows.length) return r.note ?? 'nothing';
    const lines = rows.map((x) => {
      if ('value' in x && 'id' in x && !('title' in x)) return `${String(x.id).padEnd(28)} ${show(x.value).padEnd(24)}${x.overridden ? ' (override)' : ''}${x.unit ? ` ${x.unit}` : ''}`;
      if ('kind' in x && 'title' in x) return `${x.id.padEnd(18)} ${x.kind.padEnd(5)} ${(x.status ?? '').padEnd(5)} ${x.title}${x.listName ? `  [${x.listName}]` : ''}`;
      if ('path' in x && 'name' in x) return `${x.id.padEnd(18)} ${x.path} (${x.items})`;
      if ('stepsDone' in x) return `${x.id.padEnd(36)} ${(x.status ?? '').padEnd(9)} ${x.stepsDone}/${x.steps}  ${x.title}`;
      return JSON.stringify(x);
    });
    return `${lines.join('\n')}${r.total > rows.length ? `\n… ${r.total - rows.length} more (--select limit=N)` : ''}`;
  }
  if (r.op === 'get') return r.item ? JSON.stringify(r.item, null, 2) : show(r.value);
  if (r.op === 'remove') return `removed ${r.removed} (${r.target} ${r.path})`;
  const what = r.item ? (r.item.title ?? r.item.name ?? `${r.item.id} = ${show(r.item.value)}`) : '';
  return `${r.changed === false ? 'unchanged' : 'done'}: ${r.op}${r.action ? ` ${r.action}` : ''} ${r.target}${r.path ? ` ${r.path}` : ''}${what ? ` → ${what}` : ''}${r.text ? `\n${r.text}` : ''}`;
}

/** A console answer as a person reads it. */
function formatConsole(r) {
  if (r.op === 'list') {
    const rows = r.items ?? [];
    if (!rows.length) return r.target === 'console.clients' ? 'no console is open right now' : 'nothing matches';
    if (r.target === 'console.clients') return rows.map((c) => `${c.id.padEnd(24)} ${(c.device || '').padEnd(8)} ${(c.here?.screen ?? '').padEnd(22)} ${c.lastUsed}  ${c.title}`).join('\n');
    return `${rows.map((i) => `${i.id.padEnd(30)} ${i.label}${i.params ? '  (needs args)' : ''}`).join('\n')}${r.total > rows.length ? `\n… ${r.total - rows.length} more (add words, or --limit N)` : ''}`;
  }
  if (r.op === 'get') return r.item ? `${r.item.kind} ${r.item.id}: ${r.item.label}${r.item.detail ? ` — ${r.item.detail}` : ''}` : `here: ${Object.entries(r.value ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ') || 'unknown'}`;
  const sent = r.delivered ?? [];
  const done = sent.filter((d) => d.ok);
  const what = r.item ? `${r.item.label} (${r.item.id})` : r.action;
  if (!sent.length) return `sent ${r.action} ${what} — no console answered yet`;
  return `${done.length ? '✓' : '✗'} ${r.action} ${what} → ${sent.map((d) => `${d.client}: ${d.ok ? d.message || 'done' : `failed: ${d.message}`}`).join(' · ')}`;
}

function help() {
  const u = controlCli();
  return [
    'Token control (control@1): every token, AmberX note / to-do / task / list, Plan Studio plan and orchestrator build.',
    '', ...u.usage.map((l) => `  ${l}`), '', 'Aliases:', ...Object.values(u.aliases).map((l) => `  ${l}`), '',
    'Examples:',
    '  axf token layout get navWidth',
    '  axf token theme set accent "#ff8800" --reason "warmer accent"',  // theme-ok: an example value in the help text
    '  axf token layout reset navWidth',
    '  axf token slots set color-theme arctic-daylight',
    '  axf todo add "Buy milk" --list groceries',
    '  axf todo list --select status=not-done',
    '  axf todo done <id>',
    '  axf note remove <id>              (prints a confirm token; repeat with --confirm <token>)',
    '  axf plan add "Voice macros" --field category="Apps > AmberX"',
    '  axf build step token-control s5 --profile urgent',
    '  axf control act planner.builds token-control note --field text="halfway"',
    '  axf console open plan studio          (Brett\'s open console goes there; --to all for every open one)',
    '  axf console settings plugins/token-control',
    '  axf console action terminal.open',
    '  axf console list screens build        · axf console back · axf console where · axf console clients',
    '', 'Flags: --select k=v · --field k=v · --list <id> · --profile <id> · --confirm <token> · --by · --reason · --remote [url] · --json',
    'Targets: ' + CONTROL_TARGET_IDS.join(', '),
  ].join('\n');
}

/** Shell-quote a word for the "repeat this" line. */
const q = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, "'\\''")}'`);

export async function main(argv) {
  if (argv[0] === 'control') argv = argv.slice(1); // `axf control …` = this file's own words
  const [cmd] = argv;
  const json = argv.includes('--json');
  const out = (o, text) => console.log(json ? JSON.stringify(o, null, 1) : text);
  if (!cmd || cmd === 'help' || cmd === '--help') { console.log(help()); return 0; }
  if (cmd === 'run') {
    const body = JSON.parse(argv[1] && argv[1].startsWith('{') ? argv[1] : readFileSync(0, 'utf8'));
    const env = body && body.command ? body : { command: body };
    console.log(JSON.stringify(await runControl(env.command, { grants: Array.isArray(env.grants) ? env.grants : ['*'], by: env.by ?? '', preset: env.preset ?? null, context: env.context ?? null })));
    return 0;
  }
  if (cmd === 'targets') { out(CONTROL_TARGETS, CONTROL_TARGET_IDS.map((id) => `${id.padEnd(18)} ${CONTROL_TARGETS[id].ops.join(',').padEnd(30)} ${CONTROL_TARGETS[id].label}`).join('\n')); return 0; }
  if (cmd === 'tools') { out(controlTools(), controlTools().map((t) => `${t.name.padEnd(15)} ${t.effect.padEnd(11)} ${t.description}`).join('\n')); return 0; }
  if (cmd === 'routes') { out(controlRoutes(), controlRoutes().map((r) => `${r.method.padEnd(6)} ${r.path.padEnd(44)} ${r.op}${r.body ? `  body ${r.body}` : ''}`).join('\n')); return 0; }
  if (cmd === 'schema') { console.log(JSON.stringify(controlSchema(), null, 1)); return 0; }
  if (cmd === 'registry') { console.log(JSON.stringify(controlRegistry(), null, 1)); return 0; }
  if (cmd === 'audit') { const rows = readAudit(Number(argv[1]) || 30); out(rows, rows.map((r) => `${r.at} ${r.by} ${r.op} ${r.target}${r.path ? ` ${r.path}` : ''}${r.action ? ` ${r.action}` : ''}${r.reason ? ` — ${r.reason}` : ''}`).join('\n') || 'no writes yet'); return 0; }
  if (cmd === 'where') { out({ appearance: appearanceFile(), amberx: notesDir() }, `look: ${appearanceFile()}\nAmberX notes: ${notesDir()}`); return 0; }

  const parsed = cmd === 'console' ? consoleCommandFromArgv(argv) : commandFromArgv(argv);
  if (parsed.error) { console.error(parsed.error); return 2; }
  const { command, preset, remote } = parsed;
  if (parsed.profile && command.target === 'planner.builds') {
    if (command.op === 'list') command.select = { ...(command.select ?? {}), profile: parsed.profile };
    else if (command.op === 'act') command.input = { ...(command.input ?? {}), profile: parsed.profile };
    else process.env.AXF_BUILD_PROFILE = parsed.profile;
  }
  if (preset && command.target === 'amberx.items') {
    if (command.op === 'list') command.select = { ...preset, ...(command.select ?? {}) };
    if (command.op === 'add') command.value = { ...preset, ...command.value };
  }
  if (!command.by) command.by = process.env.AXF_ACTOR || `cli:${process.env.USER || 'user'}`;
  let r;
  if (remote) {
    const { controlClient } = await import('./web/client.mjs');
    const base = typeof remote === 'string' ? remote : process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com';
    r = await controlClient({ base, token: process.env.AXF_TOKEN }).send(command);
  } else r = await runControl(command, { grants: ['*'] });
  out(r, formatAnswer(r));
  if (!r.ok && r.code === 'confirmation_required') {
    if (!json) console.log(`repeat to ${command.target === 'console.actions' ? 'run it' : 'delete'}: axf ${argv.filter((a) => a !== '--json').map(q).join(' ')} --confirm ${r.confirm}`);
    return 3;
  }
  return r.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 1; });
}

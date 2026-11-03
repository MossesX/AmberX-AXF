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
 *   node control.mjs pass-publication | pass-check <target> [op] | pass-settings [json]   (veto passes: lib/pass.mjs)
 *   --remote [url]   send it to a console instead (AXF_CONSOLE_URL, default https://console.amberxai.com; AXF_TOKEN)
 *   --json           print the raw answer
 *
 * Exit codes: 0 ok · 1 failed · 2 usage · 3 confirmation_required (the token and the exact command to repeat are printed).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTROL_ALIASES, CONTROL_EFFECT, CONTROL_OPS, CONTROL_TARGETS, CONTROL_TARGET_IDS, CONTROL_WIRE, controlCli, controlFailure, controlGate, controlIrreversible, controlRegistry,
  controlResult, controlRoutes, controlSchema, controlTools, normalizeControl,
} from '../../../../framework/core/engines/control-rules.mjs';
import { ControlError, audit, confirmSalt, readAudit } from './lib/common.mjs';
import { appearanceFile, runTokens } from './lib/tokens.mjs';
import { notesDir, runAmberx } from './lib/amberx.mjs';
import { runPlanner } from './lib/planner.mjs';
import { coveringCall, coveringPass, passSettings, publication, recordPassChanges, recordPassCommand, runPass, savePassSettings } from './lib/pass.mjs';
import { PASS_DEFAULT_SCOPE, PASS_SCOPE_IDS, PASS_TARGET, passScopeId, passScopeOf, passScopeWord } from '../../../../framework/core/engines/control-pass.mjs';

/** The token rows a write may change, by id (what a covered write records as before / after). */
function tokenState(c) {
  const rows = c.path ? [runTokens({ op: 'get', target: c.target, path: c.path }).item] : runTokens({ op: 'list', target: c.target }).items;
  return Object.fromEntries(rows.map((r) => [r.id, { overridden: !!r.overridden, value: r.value ?? null }]));
}
/** tokenState, or null when the target can't list its rows here (host tokens: the change is logged as a command). */
function tokenStateOrNull(c) {
  try { return tokenState(c); } catch { return null; }
}
/** A short title for the record a command touches (so the log and undo's "can't roll back" list say what it was). */
function recordTitle(c) {
  if (!c.path || CONTROL_TARGETS[c.target]?.paths !== 'entity' || CONTROL_TARGETS[c.target].domain !== 'amberx') return '';
  try { const it = runAmberx({ op: 'get', target: c.target, path: c.path }).item; return String(it?.title || it?.text || it?.name || '').slice(0, 60); } catch { return ''; }
}

/**
 * Run one control@1 command. `grants` = the caller's permissions (the console token = ['*']; a wall user's role
 * grants; already capped for a remote caller). `preset` = fields an alias fixes (`axf todo …` → kind todo).
 * `approver` / `proof` = how the transport reached Brett (veto passes only; lib/pass.mjs): never from the command.
 * Every write answer carries `passScope` (the narrowest scope a veto pass would need, null = none can cover it) and,
 * when an active pass covered it, `pass { id, scope, expiresAt }`; the change is then logged on the pass (token writes
 * with before / after, for undo; every other command as a record undo lists). A delete an `all` pass covers runs
 * without the confirm token (`confirmSkipped`), except an irreversible one unless the pass includes irreversible.
 */
export async function runControl(raw, { grants = ['*'], by = '', preset = null, now = Date.now(), approver = null, proof = null } = {}) {
  const c = normalizeControl(raw);
  if (!c.by && by) c.by = by;
  // an alias preset (kind) is a filter on list and a default on add
  if (preset && c.target === 'amberx.items') {
    if (c.op === 'list') c.select = { ...preset, ...(c.select ?? {}) };
    if (c.op === 'add' && c.value && typeof c.value === 'object') c.value = { ...preset, ...c.value };
  }
  const isWrite = CONTROL_TARGETS[c.target] && CONTROL_EFFECT[c.op] && CONTROL_EFFECT[c.op] !== 'read';
  const pass = isWrite && passScopeOf(c) ? coveringPass(c, now) : null;
  const gate = controlGate(c, grants, { salt: confirmSalt(), now, passCovers: !!pass });
  if (!gate.ok) {
    const { ok: _ok, code, message, ...extra } = gate;
    const why = gate.code === CONTROL_WIRE.CONFIRMATION_REQUIRED && controlIrreversible(c) && coveringCall({ target: c.target }, now) ? { irreversible: true, note: 'this delete can\'t be undone: the pass on now doesn\'t include irreversible commands, so it still confirms' } : {};
    return controlFailure(code, message, { op: c.op, target: c.target, ...(c.path ? { path: c.path } : {}), ...extra, ...why });
  }
  const domain = CONTROL_TARGETS[c.target].domain;
  try {
    if (domain === 'console') throw new ControlError(CONTROL_WIRE.NOT_IMPLEMENTED, 'console commands are run by the Console commands plugin where the open consoles are: POST /api/control or /api/console on the console, or axf console …');
    const scope = gate.effect === 'read' ? null : passScopeOf(c);
    const tokenWrite = !!pass && domain === 'tokens' && ['set', 'reset'].includes(c.op);
    const before = tokenWrite ? tokenStateOrNull(c) : null;
    const title = pass && !before ? recordTitle(c) : '';
    const data = domain === 'tokens' ? runTokens(c) : domain === 'amberx' ? runAmberx(c) : domain === 'pass' ? runPass(c, { approver, proof, now, runTokens }) : await runPlanner(c);
    const at = new Date(now).toISOString();
    if (pass && before) recordPassChanges(pass.id, c, before, tokenState(c), now);
    else if (pass) recordPassCommand(pass.id, c, `${c.op}${c.action ? ` ${c.action}` : ''} ${c.target}${c.path ? ` ${c.path}` : data?.item?.id ? ` ${data.item.id}` : ''}${title ? ` ("${title}")` : ''}`, now);
    if (gate.effect !== 'read' && domain !== 'pass') audit({ by: c.by || 'unknown', reason: c.reason ?? '', op: c.op, target: c.target, path: c.path, action: c.action, value: c.value, input: c.input, ...(pass ? { pass: pass.id } : {}) });
    const stamp = gate.effect === 'read' || domain === 'pass' ? {} : { passScope: scope, ...(pass ? { pass: { id: pass.id, scope: pass.scope, expiresAt: pass.expiresAt }, ...(gate.effect === 'destructive' ? { confirmSkipped: true } : {}) } : {}) };
    return controlResult(c, { ...data, ...stamp }, { by: c.by || 'unknown', reason: c.reason ?? '', at });
  } catch (e) {
    if (e instanceof ControlError) return controlFailure(e.code, e.message, { op: c.op, target: c.target, ...(c.path ? { path: c.path } : {}), ...e.extra });
    return controlFailure(CONTROL_WIRE.UNEXPECTED, e?.message ?? String(e), { op: c.op, target: c.target });
  }
}

/* ------------------------------------------------------------------ CLI → command */

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
    const takes = !['json', 'remote', 'help', 'yes', 'deep', 'include-hidden', 'include-irreversible'].includes(k) || (k === 'remote' && argv[i + 1] && /^https?:/.test(argv[i + 1]));
    const v = inline !== undefined ? inline : takes && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    if (k === 'select' || k === 'field' || k === 'input') { const [fk, fv] = String(v).split(/=(.*)/s); (out[k === 'input' ? 'field' : k])[fk] = parseValue(fv); }
    else out[k] = v;
  }
  return out;
}

/** Which target an alias word + the next word name; null when the word isn't an alias. */
export function aliasTarget(word, next) {
  if (word === 'control') return { target: null };
  if ((word === 'token' || word === 'tokens') && next === 'pass') return { target: PASS_TARGET, eat: 1 };
  if (word === 'token' || word === 'tokens') return TOKEN_SETS.includes(next) ? { target: `tokens.${next}`, eat: 1 } : { target: null, error: `axf token <${TOKEN_SETS.join('|')}|pass> <op> …` };
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
  if (target === PASS_TARGET) {
    // axf pass grant [minutes] [--scope all|theme|style|layout|tokens] [--include-irreversible] · status [scope] ·
    // revoke | undo [scope] · approve | deny [scope] <request>; also the old word order: axf token pass grant theme 30.
    // No scope named = all (everything).
    if (!op || op === 'status') op = words.length || typeof f.scope === 'string' ? 'get' : 'list';
    let sc = typeof f.scope === 'string' ? passScopeId(f.scope) : null;
    if (typeof f.scope === 'string' && !sc) return { error: `no pass scope ${f.scope} (all, theme, style, layout, tokens = ${PASS_SCOPE_IDS.join(', ')})` };
    if (!sc && words[0] !== undefined && !/^\d+$/.test(words[0]) && !/^pass-/.test(words[0])) {
      sc = passScopeId(words[0]);
      if (!sc) return { error: `no pass scope ${words[0]} (all, theme, style, layout, tokens = ${PASS_SCOPE_IDS.join(', ')})` };
      words.shift();
    }
    if (op !== 'list') words.unshift(sc ?? PASS_DEFAULT_SCOPE);
    if (f['include-irreversible'] === true) f.field.include_irreversible = true;
  }
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
      if (target === PASS_TARGET && cmd.action === 'grant' && typeof f.reason === 'string') cmd.input.reason = f.reason;
      // booleans a verb wants default to true; a trailing undo / off / false turns them off (axf build step <id> s3 undo)
      const off = ['undo', 'off', 'false', 'no'].includes(String(words[words.length - 1] ?? '').toLowerCase());
      if (off && wants[0] && typeof cmd.input[wants[0]] === 'string') cmd.input[wants[0]] = words.slice(0, -1).join(' ');
      // (not on passes: include_irreversible is only ever on when asked for by name)
      if (target !== PASS_TARGET) for (const [k, decl] of Object.entries(t.acts?.[cmd.action] ?? {})) if (decl === 'boolean' && !(k in cmd.input)) cmd.input[k] = !off;
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
  if (r.ok && r.target === PASS_TARGET) {
    if (r.op === 'list') return [r.text, ...(r.items ?? []).map((x) => `  ${x.id.padEnd(14)} ${x.text}${x.pending && x.active ? ` (waiting: ${x.pending.text})` : ''}`)].join('\n');
    const req = r.approval?.required ? `\nrequest ${r.approval.request}: ${r.approval.how.join('; ')}` : '';
    return `${r.text ?? ''}${req}`;
  }
  if (!r.ok) {
    if (r.code === 'confirmation_required') return `${r.message}\nconfirm token: ${r.confirm}`;
    return `${r.code}: ${r.message}`;
  }
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

function help() {
  const u = controlCli();
  return [
    'Token control (control@1): every token, AmberX note / to-do / task / list, Plan Studio plan and orchestrator build.',
    '', ...u.usage.map((l) => `  ${l}`), '', 'Aliases:', ...Object.values(u.aliases).map((l) => `  ${l}`), '',
    'Examples:',
    '  axf pass grant 30                 (everything skips the veto for 30 min once Brett approves)',
    '  axf pass grant 30 --scope theme   (only theme changes)',
    '  axf pass grant 30 --include-irreversible   (hard deletes too, no confirm)',
    '  axf pass status · axf pass revoke · axf pass undo   (undo lists what it can\'t roll back)',
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
    '', 'Flags: --select k=v · --field k=v · --list <id> · --profile <id> · --confirm <token> · --by · --reason · --remote [url] · --json',
    'Targets: ' + CONTROL_TARGET_IDS.join(', '),
  ].join('\n');
}

/**
 * A veto pass grant / approve / deny typed at a real terminal counts as Brett's own approval once he types the scope
 * back (a script, an agent's shell and a pipe have no terminal and only ever file a request).
 */
async function terminalApproval(command) {
  if (command.target !== PASS_TARGET || !['grant', 'approve', 'deny'].includes(command.action)) return null;
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.AXF_NO_TTY_APPROVAL) return null;
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const word = passScopeWord(command.path);
    const irr = command.input?.include_irreversible === true ? ' (irreversible deletes included)' : '';
    const typed = (await rl.question(`${command.action} the ${command.path === 'all' ? 'everything' : command.path}${irr} veto pass as Brett? Type "${word}" to confirm (anything else files a request): `)).trim().toLowerCase();
    return typed === word ? { via: 'cli-tty', name: process.env.AXF_OWNER || 'brett' } : null;
  } finally { rl.close(); }
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
    // approver / proof: set by the console server from the request (session, axHub's signed approval), never by a command
    console.log(JSON.stringify(await runControl(env.command, { grants: Array.isArray(env.grants) ? env.grants : ['*'], by: env.by ?? '', preset: env.preset ?? null, approver: env.approver ?? null, proof: env.proof ?? null })));
    return 0;
  }
  if (cmd === 'targets') { out(CONTROL_TARGETS, CONTROL_TARGET_IDS.map((id) => `${id.padEnd(18)} ${CONTROL_TARGETS[id].ops.join(',').padEnd(30)} ${CONTROL_TARGETS[id].label}`).join('\n')); return 0; }
  if (cmd === 'tools') { out(controlTools(), controlTools().map((t) => `${t.name.padEnd(15)} ${t.effect.padEnd(11)} ${t.description}`).join('\n')); return 0; }
  if (cmd === 'routes') { out(controlRoutes(), controlRoutes().map((r) => `${r.method.padEnd(6)} ${r.path.padEnd(44)} ${r.op}${r.body ? `  body ${r.body}` : ''}`).join('\n')); return 0; }
  if (cmd === 'schema') { console.log(JSON.stringify(controlSchema(), null, 1)); return 0; }
  if (cmd === 'registry') { console.log(JSON.stringify(controlRegistry(), null, 1)); return 0; }
  if (cmd === 'audit') { const rows = readAudit(Number(argv[1]) || 30); out(rows, rows.map((r) => `${r.at} ${r.by} ${r.op} ${r.target}${r.path ? ` ${r.path}` : ''}${r.action ? ` ${r.action}` : ''}${r.reason ? ` — ${r.reason}` : ''}`).join('\n') || 'no writes yet'); return 0; }
  if (cmd === 'pass-publication') { const p = publication(); console.log(JSON.stringify({ body: p.body, payload: p.payload, signature: p.signature })); return 0; }
  if (cmd === 'pass-check') {
    // pass-check <control target> [op]  ·  pass-check --call <service.tool> [--irreversible]   (an axHub call)
    const irreversible = argv.includes('--irreversible');
    const ci = argv.indexOf('--call');
    if (ci >= 0) {
      const tool = argv[ci + 1] || '';
      const p = coveringCall({ tool, irreversible });
      out({ ok: true, call: tool, irreversible, scope: 'all', covered: !!p, ...(p ? { pass: { id: p.id, scope: p.scope, expiresAt: p.expiresAt } } : {}) }, p ? `covered by ${p.id} until ${p.expiresAt}` : `not covered (needs an all pass${irreversible ? ' with include_irreversible' : ''})`);
      return 0;
    }
    const c = { op: argv[2] && !argv[2].startsWith('--') ? argv[2] : 'set', target: argv[1] };
    const scope = passScopeOf(c); const p = scope ? coveringPass(c) : null;
    const irr = controlIrreversible(c);
    out({ ok: true, target: c.target, op: c.op, scope, irreversible: irr, covered: !!p, ...(p ? { pass: { id: p.id, scope: p.scope, expiresAt: p.expiresAt } } : {}) }, p ? `covered by ${p.id} until ${p.expiresAt}` : scope ? `not covered (needs ${scope === 'all' ? 'an' : 'a'} ${scope} pass${irr ? ' with include_irreversible' : ''})` : 'no pass can cover this');
    return 0;
  }
  if (cmd === 'pass-settings') { const s = argv[1] && argv[1].startsWith('{') ? savePassSettings(JSON.parse(argv[1])) : passSettings(); out({ ok: true, ...s }, `max ${s.maxMinutes} min · ${s.timeZone}`); return 0; }
  if (cmd === 'where') { out({ appearance: appearanceFile(), amberx: notesDir() }, `look: ${appearanceFile()}\nAmberX notes: ${notesDir()}`); return 0; }

  const parsed = commandFromArgv(argv);
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
  } else r = await runControl(command, { grants: ['*'], approver: await terminalApproval(command) });
  out(r, formatAnswer(r));
  if (!r.ok && r.code === 'confirmation_required') {
    if (!json) console.log(`repeat to delete: axf ${argv.filter((a) => a !== '--json').map(q).join(' ')} --confirm ${r.confirm}`);
    return 3;
  }
  return r.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 1; });
}

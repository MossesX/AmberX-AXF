#!/usr/bin/env node
/**
 * `axf ctl`: the control registry on the command line (control-registry@1; build
 * full-api-cli-control-of-everything-plus-an-offli, s6). Same entries, same dispatcher, same plans as REST and MCP.
 *
 *   axf ctl list [--owner o] [--type t] [--tag t] [--surface s] [--plugin p] [--q words] [--needs-ai true|false] [--limit n] [--offset n]
 *   axf ctl get <id | alias>                       actions, parameters, allowed values, surfaces, gaps
 *   axf ctl search <words> [--type t] [--owner o]
 *   axf ctl state <id> [--<param> v …]             read the entry's state
 *   axf ctl set <id> <name> <value> | --<param> v  its `set` action (a token set: <name> = the token path)
 *   axf ctl do <id> [<action>] [--<param> v …] [--confirm <token>] [--reason "…"] [--dry]
 *   axf ctl open <id>                              open it (its `open` action, else its console target)
 *   axf ctl resolve "<phrase>" | -- <argv…> [--run]  deterministic first; Claude only when the gate is open
 *   axf ctl export [file]                          the whole index (stdout without a file)
 *   axf ctl completion [bash]                      the shell completion script (completions/axf-ctl.bash)
 *   [--json] [--online | --offline]
 *
 * Where it runs: with AXF_TOKEN set, through the console (AXF_CONSOLE_URL, default https://console.amberxai.com) over
 * REST; without it, or when the console does not answer, offline: reads and resolution come from the offline index
 * (_claude/builds/registry/index.json) and a resolved control@1 command runs through the local control@1 runner (the
 * plugin providing service:control@1; console screens need an open console and say so). Parameters are checked against
 * the registry before anything is sent, online or not. Exit codes: 0 ok · 1 failed / not resolved · 2 usage.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowedWords, findAction, getEntry } from '../../../../framework/core/engines/control-registry.mjs';
import { ROOT } from './collect.mjs';
import { handle, registry } from './rpc.mjs';
import { planRef } from './execute.mjs';

export const SUBCOMMANDS = ['list', 'get', 'search', 'state', 'set', 'do', 'open', 'resolve', 'export', 'completion'];
const CLI_FLAGS = new Set(['json', 'online', 'offline', 'confirm', 'reason', 'dry', 'run']);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** argv → { words, flags, raw } (raw keeps the --name value pairs that are not CLI flags, in order, for the resolver). */
export function parse(argv) {
  const words = []; const flags = {}; const raw = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { words.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--')) { words.push(a); continue; }
    let k = a.slice(2); let v;
    const eq = k.indexOf('=');
    if (eq > 0) { v = k.slice(eq + 1); k = k.slice(0, eq); } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) v = argv[++i]; else v = true;
    if (CLI_FLAGS.has(k)) flags[k] = v; else raw.push(`--${k}`, ...(v === true ? [] : [String(v)]));
  }
  return { words, flags, raw };
}

/* ---------------------------------------------------------------- transports */

const consoleUrl = () => (process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com').replace(/\/+$/, '');

/** One REST call to the console. → the JSON answer, or null when the console is unreachable (the caller goes offline). */
export async function rest(method, path, body, { timeoutMs = 20_000 } = {}) {
  const tok = process.env.AXF_TOKEN;
  if (!tok) return null;
  try {
    const res = await fetch(`${consoleUrl()}${path}`, { method, headers: { authorization: `Bearer ${tok}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 401) return { ok: false, code: 'forbidden', message: 'the console refused AXF_TOKEN (401)' };
    if (res.status >= 500 && res.status !== 501) return null;
    const j = await res.json().catch(() => null);
    return isObj(j) ? (j.ok === undefined ? { ok: res.ok, ...j } : j) : null;
  } catch { return null; }
}

/** The local control@1 runner (the plugin that provides service:control@1, found by capability). */
export function controlRunner(root = ROOT) {
  const dir = join(root, 'apps', 'console-web', 'plugins');
  for (const d of existsSync(dir) ? readdirSync(dir).sort() : []) {
    try { const m = JSON.parse(readFileSync(join(dir, d, 'plugin.json'), 'utf8')); if (m.provides?.includes('service:control@1') && existsSync(join(dir, d, 'control.mjs'))) return join(dir, d, 'control.mjs'); } catch { /* not a plugin */ }
  }
  return '';
}

/** Run a plan here (offline). control@1 commands through the local runner; anything else is handed back. */
export function runLocal(plan, { root = ROOT } = {}) {
  if (plan.via === 'control' || plan.via === 'console') {
    const cli = controlRunner(root);
    if (!cli) return { ok: false, code: 'not_implemented', message: 'no plugin provides control@1 here (the Token control plugin)' };
    try {
      const out = execFileSync('node', [cli, 'run'], { cwd: root, input: JSON.stringify({ command: plan.command, grants: ['*'], by: plan.command.by }), encoding: 'utf8', timeout: 120_000, stdio: ['pipe', 'pipe', 'pipe'] });
      return JSON.parse(out.trim().split('\n').pop() || '{}');
    } catch (e) {
      const out = String(e.stdout ?? '').trim().split('\n').pop();
      try { return JSON.parse(out); } catch { return { ok: false, code: 'unexpected', message: String(e.stderr || e.message).slice(-400) }; }
    }
  }
  if (plan.via === 'none') return { ok: false, code: 'not_implemented', message: plan.why };
  return { ok: true, handoff: plan, message: `this runs on the caller's side (${plan.via}); follow the handoff` };
}

/* ---------------------------------------------------------------- the commands */

/** An argv for the resolver: <id> [<action>] --param v …, CLI flags removed. */
const argvFor = (id, action, raw) => [id, ...(action ? [action] : []), ...raw];

/** Resolve offline first (validation never needs the console), then run online or here. */
async function invoke(words, flags, raw, { action: forced = '' } = {}) {
  const [id, maybeAction] = words;
  if (!id) return { ok: false, code: 'usage', message: 'an entry id is required' };
  const reg = registry();
  const entry = getEntry(reg.index, id);
  if (!entry) return handle({ op: 'get', id });
  let action = forced;
  let extra = words.slice(1);
  if (!action && maybeAction && findAction(entry, maybeAction)) { action = maybeAction; extra = words.slice(2); }
  const res = handle({ op: 'resolve', input: [entry.id, ...(action ? [action] : []), ...extra, ...raw], confirm: flags.confirm ?? '', reason: flags.reason ?? '', by: 'cli' });
  if (!res.ok) return res;
  if (flags.dry) return { ...res, dry: true };
  const online = flags.offline ? null : await rest('POST', `/api/control/${res.entry}/${res.action}`, { params: res.params, ...(flags.confirm ? { confirm: flags.confirm } : {}), ...(flags.reason ? { reason: flags.reason } : {}) });
  if (online) return { ...online, via: 'console' };
  if (flags.online) return { ok: false, code: 'unexpected', message: `the console at ${consoleUrl()} did not answer${process.env.AXF_TOKEN ? '' : ' (AXF_TOKEN is not set)'}` };
  return { ...res, result: runLocal(res.plan), via: 'offline' };
}

async function state(words, flags, raw) {
  const id = words[0];
  if (!id) return { ok: false, code: 'usage', message: 'usage: axf ctl state <id>' };
  const params = {};
  for (let i = 0; i < raw.length; i++) if (raw[i].startsWith('--')) params[raw[i].slice(2)] = raw[i + 1] && !raw[i + 1].startsWith('--') ? raw[++i] : true;
  const entry = getEntry(registry().index, id);
  if (!entry) return handle({ op: 'get', id });
  const q = new URLSearchParams(params).toString();
  const online = flags.offline ? null : await rest('GET', `/api/control/${entry.id}/state${q ? `?${q}` : ''}`);
  if (online) return { ...online, via: 'console' };
  const s = handle({ op: 'state', id: entry.id, params, by: 'cli' });
  if (!s.ok) return s;
  const result = runLocal(s.plan);
  return { ok: !!result.ok, entry: s.entry, read: s.read, fields: s.fields, state: result, via: 'offline' };
}

/** `set <id> <name> <value>`: a token set's `set` takes path + value; any other `set` takes <name> = <value>. */
function setArgs(entry, words, raw) {
  const a = entry.actions.find((x) => x.id === 'set');
  if (!a) return { error: `${entry.id} has no set action (it has: ${entry.actions.map((x) => x.id).join(', ')})` };
  const [, name, value] = words;
  if (name === undefined) return { raw };
  const takesPath = (a.params ?? []).some((p) => p.name === 'path');
  if (takesPath) return { raw: ['--path', name, ...(value !== undefined ? ['--value', value] : []), ...raw] };
  return { raw: [`--${name}`, ...(value !== undefined ? [value] : []), ...raw] };
}

async function open(words, flags) {
  const entry = getEntry(registry().index, words[0] ?? '');
  if (!entry) return handle({ op: 'get', id: words[0] ?? '' });
  if (entry.actions.some((a) => a.id === 'open')) return invoke([entry.id], flags, [], { action: 'open' });
  if (!entry.open?.target) return { ok: false, code: 'not_found', message: `${entry.id} has nothing to open` };
  const kindRef = { screen: 'view', dialog: 'dialog', settings: 'settings', action: 'action', intent: 'intent', url: 'url' }[entry.open.kind ?? 'screen'];
  const plan = planRef(`${kindRef}:${entry.open.target}`, {}, { effect: 'navigate', by: 'cli' });
  if (!flags.offline && plan.via === 'console') { const r = await rest('POST', '/api/console', plan.command); if (r) return { ...r, via: 'console' }; }
  return { ok: true, entry: entry.id, plan, result: runLocal(plan), via: 'offline' };
}

async function resolveCmd(words, flags, raw) {
  const input = words.length === 1 && !raw.length ? words[0] : words.length > 1 && /^[a-z0-9-]+\/(page|app|plugin|tool|behavior|display|setting)\//.test(words[0]) ? [...words, ...raw] : words.length ? (raw.length ? [...words, ...raw] : words.join(' ')) : '';
  if (!input) return { ok: false, code: 'usage', message: 'usage: axf ctl resolve "<phrase>" [--run]' };
  const online = flags.offline ? null : await rest('POST', '/api/control/resolve', { input, run: !!flags.run, ...(flags.confirm ? { confirm: flags.confirm } : {}), ...(flags.reason ? { reason: flags.reason } : {}) });
  if (online) return { ...online, via: 'console' };
  const res = handle({ op: 'resolve', input, by: 'cli', confirm: flags.confirm ?? '', reason: flags.reason ?? '' });
  delete res.brief; // offline there is no console model to ask
  if (!res.ok || !flags.run) return { ...res, via: 'offline' };
  return { ...res, result: runLocal(res.plan), via: 'offline' };
}

/* ---------------------------------------------------------------- completion (generated from the registry) */

/**
 * Completion candidates for the words typed so far (`axf ctl __complete <words…>`): subcommands, then entry ids and
 * aliases, then the entry's actions, then `--param` names of that action, then the parameter's allowed values.
 */
export function complete(words) {
  const reg = registry();
  const [sub, id, ...rest] = words;
  const cur = words.length ? words[words.length - 1] : '';
  const pre = (list) => [...new Set(list)].filter((x) => x.startsWith(cur)).sort();
  if (words.length <= 1) return pre(SUBCOMMANDS);
  if (sub === 'completion') return pre(['bash']);
  if (['list'].includes(sub)) {
    const prev = words[words.length - 2];
    if (prev === '--type') return pre(['page', 'app', 'plugin', 'tool', 'behavior', 'display', 'setting']);
    if (prev === '--owner') return pre(reg.owners().map((o) => o.id));
    if (prev === '--surface') return pre(['rest', 'mcp', 'cli', 'voice', 'deepLink']);
    return pre(['--owner', '--type', '--tag', '--surface', '--plugin', '--q', '--needs-ai', '--limit', '--offset', '--json']);
  }
  if (!['get', 'state', 'set', 'do', 'open'].includes(sub)) return [];
  if (words.length === 2) return pre(reg.entries.flatMap((e) => [e.id, ...(e.aliases ?? [])]));
  const entry = getEntry(reg.index, id);
  if (!entry) return [];
  const actionId = sub === 'set' ? 'set' : sub === 'do' && rest[0] && !rest[0].startsWith('--') ? rest[0] : sub === 'state' ? '' : sub === 'open' ? 'open' : '';
  if (sub === 'do' && words.length === 3) return pre(entry.actions.map((a) => a.id));
  const action = entry.actions.find((a) => a.id === actionId);
  const params = action?.params ?? (sub === 'state' ? entry.state?.fields ?? [] : []);
  const prev = words[words.length - 2];
  const fields = entry.state?.fields ?? [];
  if (prev === '--path' && fields.length) return pre(fields.map((f) => f.name));
  if (prev === '--value' || (sub === 'set' && words.length === 4)) {
    const at = words.indexOf('--path'); const name = at >= 0 ? words[at + 1] : sub === 'set' ? words[2] : '';
    const f = fields.find((x) => x.name === name);
    if (f?.enum) return pre(f.enum.map(String));
    if (f?.type === 'boolean') return pre(['on', 'off']);
    if (f) return [];
  }
  if (prev?.startsWith('--')) {
    const p = params.find((x) => `--${x.name}` === prev);
    if (p?.enum) return pre(p.enum.map(String));
    if (p?.type === 'boolean') return pre(['on', 'off']);
    if (p) return [];
  }
  if (sub === 'set' && words.length === 3) { const pathP = params.find((p) => p.name === 'path'); if (pathP?.enum) return pre(pathP.enum.map(String)); if (fields.length) return pre(fields.map((f) => f.name)); }
  return pre([...params.map((p) => `--${p.name}`), ...(action?.confirm ? ['--confirm'] : []), '--reason', '--dry', '--json', '--offline', '--online']);
}

/** The bash completion script (also written to completions/axf-ctl.bash). */
export const BASH_COMPLETION = `# axf ctl completion (control-registry@1): candidates come from the registry (entry ids, actions, parameters and
# their allowed values), read from the offline index by \`axf ctl __complete\`. Source this file, or:
#   eval "$(node framework/cli/axf.mjs ctl completion bash)"
_axf_ctl_complete() {
  local i words=()
  for ((i = 2; i <= COMP_CWORD; i++)); do words+=("\${COMP_WORDS[i]}"); done
  [[ "\${COMP_WORDS[1]}" == "ctl" ]] || return 0
  local IFS=$'\\n'
  COMPREPLY=($(node "\${AXF_ROOT:-.}/framework/cli/axf.mjs" ctl __complete "\${words[@]}" 2>/dev/null))
}
complete -o default -F _axf_ctl_complete axf
_axf_ctl_bin_complete() {
  local i words=()
  for ((i = 1; i <= COMP_CWORD; i++)); do words+=("\${COMP_WORDS[i]}"); done
  local IFS=$'\\n'
  COMPREPLY=($(node "\${AXF_ROOT:-.}/bin/axf-ctl.mjs" __complete "\${words[@]}" 2>/dev/null))
}
complete -o default -F _axf_ctl_bin_complete axf-ctl axf-ctl.mjs
`;

/* ---------------------------------------------------------------- output */

function text(sub, r) {
  if (!r.ok) {
    const lines = [`✗ ${r.code ?? 'failed'}: ${r.message ?? ''}`];
    for (const e of r.errors ?? []) lines.push(`  ✗ ${e}`);
    for (const c of r.candidates ?? []) lines.push(`  ? ${c.id}  ${c.label ?? ''}${c.actions ? `  [${c.actions.join(', ')}]` : ''}`);
    if (r.gap) lines.push(`  gap: ${r.gap.why}${r.gap.declare ? `\n       → ${r.gap.declare}` : ''}`);
    if (r.confirm || r.code === 'confirmation_required') lines.push(`  confirm: repeat with --confirm ${r.confirm ?? r.token ?? '<token>'}`);
    if (r.ai) lines.push(`  claude: ${r.ai.available ? 'available' : 'not available'} · ${r.ai.why ?? ''}`);
    return lines.join('\n');
  }
  if (sub === 'list') return `${r.items.map((e) => `${e.type.padEnd(9)} ${e.id.padEnd(60)} ${e.label}`).join('\n')}\n${r.items.length} of ${r.total}`;
  if (sub === 'search') return r.items.map((h) => `${String(h.score.toFixed(1)).padStart(6)}  ${h.type.padEnd(9)} ${h.id.padEnd(60)} ${h.label}`).join('\n') || 'nothing matches';
  if (sub === 'get') return r.text ?? JSON.stringify(r.entry, null, 2);
  if (sub === 'state') return `${r.entry} · ${r.read}${r.note ? ` (${r.note})` : ''} · ${r.via}\n${JSON.stringify(r.state, null, 2)}`;
  const res = r.result;
  const head = r.entry ? `${r.entry} · ${r.action}${Object.keys(r.params ?? {}).length ? ` ${JSON.stringify(r.params)}` : ''}${r.how?.kind ? `  (${r.how.kind}${r.ai?.fallback ? ', via Claude' : ''})` : ''}` : '';
  if (r.dry || (sub === 'resolve' && !res)) return `${head}\n  plan: ${JSON.stringify(r.plan)}`;
  return `${head}${head ? '\n' : ''}  ${res?.ok === false ? `✗ ${res.code}: ${res.message}` : '✓'} ${r.via ?? ''}${res?.handoff ? `\n  handoff: ${JSON.stringify(res.handoff)}` : ''}${res && res.ok !== false && !res.handoff ? `\n${JSON.stringify(res, null, 2).slice(0, 4000)}` : ''}`;
}

export async function main(argv) {
  const [sub, ...rest] = argv;
  if (sub === '__complete') { process.stdout.write(`${complete(rest).join('\n')}\n`); return 0; }
  const { words, flags, raw } = parse(rest);
  const json = flags.json === true;
  const emit = (r) => { process.stdout.write(`${json ? JSON.stringify(r) : text(sub, r)}\n`); const failed = !r.ok || r.result?.ok === false; return failed ? (r.code === 'usage' ? 2 : 1) : 0; };
  const filter = () => { const f = {}; for (let i = 0; i < raw.length; i += 1) if (raw[i].startsWith('--')) { const k = raw[i].slice(2); const v = raw[i + 1] && !raw[i + 1].startsWith('--') ? raw[++i] : 'true'; f[k === 'needs-ai' ? 'needsAI' : k] = v; } return f; };
  switch (sub) {
    case 'list': {
      const f = { ...filter(), ...(words.length ? { q: words.join(' ') } : {}) };
      const online = flags.offline || !process.env.AXF_TOKEN ? null : await rest('GET', `/api/registry?${new URLSearchParams(f)}`);
      return emit(online ?? handle({ op: 'list', filter: f }));
    }
    case 'get': if (!words[0]) return emit({ ok: false, code: 'usage', message: 'usage: axf ctl get <id | alias>' }); return emit(handle({ op: 'get', id: words[0] }));
    case 'search': if (!words.length) return emit({ ok: false, code: 'usage', message: 'usage: axf ctl search <words>' }); return emit(handle({ op: 'search', q: words.join(' '), ...filter() }));
    case 'state': return emit(await state(words, flags, raw));
    case 'set': {
      const entry = getEntry(registry().index, words[0] ?? '');
      if (!entry) return emit(words[0] ? handle({ op: 'get', id: words[0] }) : { ok: false, code: 'usage', message: 'usage: axf ctl set <id> <name> <value>' });
      const s = setArgs(entry, words, raw);
      if (s.error) return emit({ ok: false, code: 'validation', message: s.error });
      return emit(await invoke([entry.id], flags, s.raw, { action: 'set' }));
    }
    case 'do': return emit(await invoke(words, flags, raw));
    case 'open': return emit(await open(words, flags));
    case 'resolve': return emit(await resolveCmd(words, flags, raw));
    case 'export': {
      const r = handle({ op: 'export' });
      const body = `${JSON.stringify(r.index)}\n`;
      if (words[0]) { writeFileSync(words[0], body); process.stdout.write(json ? `${JSON.stringify({ ok: true, file: words[0], hash: r.index.hash, entries: r.index.entries.length })}\n` : `exported ${r.index.entries.length} entries (hash ${r.index.hash}) to ${words[0]}\n`); return 0; }
      process.stdout.write(body); return 0;
    }
    case 'completion': process.stdout.write(BASH_COMPLETION); return 0;
    default:
      process.stderr.write(`usage: axf ctl ${SUBCOMMANDS.join(' | ')}  (axf ctl get <id> shows an entry's actions, parameters and allowed values)\n`);
      return 2;
  }
}

/** Every allowed-value line of an action, for help text. */
export const paramHelp = (action) => (action.params ?? []).map((p) => `--${p.name}${p.required ? '' : '?'}  ${allowedWords(p)}`);

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));

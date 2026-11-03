#!/usr/bin/env node
/**
 * Plugin commands runner + CLI (plugin-commands@1, the `plugins` domain of control@1; framework/spec/CONTROL.md).
 * Reads every plugin's files (plugin.json, server/*.py, web sources, data folder) and builds the registry with
 * framework/core/engines/plugin-commands.mjs, then gates and runs one command:
 *   - `info` and the data folder reads (`data`, `data-file`) run here;
 *   - a route command answers `dispatch: { kind: 'route', method, path, query, body }`: the console server runs it
 *     in-process (server/__init__.py), so a plugin's own auth and checks still apply;
 *   - an action answers `dispatch: { kind: 'action', … }`: the console server sends it to the open console through
 *     the Console commands plugin (console-commands@1).
 *
 *   node commands.mjs registry [--json]            the whole registry
 *   node commands.mjs plan                         one control@1 command as JSON on stdin ({command, grants?, by?, enabled?, registry?})
 *   node commands.mjs bundle                       {registry, tools} for {enabled} on stdin (the console server)
 *   node commands.mjs finish                       the answer of a dispatched command ({command, outcome} on stdin)
 *   node commands.mjs check [folder…] [--json]     coverage (what the lifecycle check runs)
 *   node commands.mjs tools | routes | cli         the projections
 *   node commands.mjs plugins [plugin]             every plugin and its commands (or one plugin's help)
 *   node commands.mjs <plugin> <command> [--field value]… [--json] [--confirm token] [--remote url]
 *
 * The CLI (`axf <plugin> <command>`, `axf plugins`) runs reads of `info` and the data folder here and sends the rest to
 * the console (AXF_CONSOLE_URL, default https://console.amberxai.com; AXF_TOKEN) as one control@1 command.
 * Exit codes: 0 ok · 1 failed · 2 usage · 3 confirmation_required.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTROL_WIRE, controlConfirmToken, controlConfirmValid, controlFailure, controlGate, controlGranted, controlResult, normalizeControl, CONTROL_CONFIRM_TTL_MS,
} from '../../../../framework/core/engines/control-rules.mjs';
import {
  pluginCommandCli, pluginCommandCoverage, pluginCommandRoutes, pluginCommandTools, pluginHelp, pluginInputErrors,
  pluginRouteRequest, resolvePluginCommand, commandToolName,
} from '../../../../framework/core/engines/plugin-commands.mjs';
import { registry } from '../../../../framework/cli/plugin-commands.mjs';

export { registry };

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(process.env.AXF_ROOT || join(HERE, '../../../..'));
export const FOLDER = 'plugin-commands';
export const DATA_DIR = process.env.AXF_PLUGIN_COMMANDS_DATA_DIR || join(ROOT, '.axf-console', 'plugins', FOLDER);
const FILE_MAX = 256 * 1024;
const LIST_MAX = 500;
/** Files a data read never opens, and keys whose values it never shows. */
const SECRET_FILE = /(^|[/\\._-])(salt|secret|secrets|token|tokens|key|keys|credential|credentials|password|passwd|\.env|private|id_rsa|vault)([/\\._-]|$)|\.(pem|key|p12|pfx|der|crt|db|sqlite3?|wal|shm)$/i;
const SECRET_KEY = /(token|secret|password|passwd|apikey|api_key|privatekey|private_key|authorization|cookie|session|credential|salt|bearer|refresh)/i;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };

function* files(dir, test, depth = 0) {
  if (depth > 4 || !existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p, test, depth + 1);
    else if (test(e.name)) yield p;
  }
}

/* ------------------------------------------------------------------ salt + audit */

/** The confirm salt: AXF_PLUGIN_COMMANDS_SALT, else a random one in the data folder (never in the repo). */
export function confirmSalt() {
  if (process.env.AXF_PLUGIN_COMMANDS_SALT) return process.env.AXF_PLUGIN_COMMANDS_SALT;
  const f = join(DATA_DIR, 'salt');
  try { const s = readFileSync(f, 'utf8').trim(); if (s) return s; } catch { /* first run */ }
  const s = randomBytes(24).toString('hex');
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(f, s, { mode: 0o600 });
  return s;
}

export function audit(entry) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
    appendFileSync(join(DATA_DIR, 'audit.jsonl'), `${line.length > 4000 ? JSON.stringify({ ...entry, input: '[large]', at: new Date().toISOString() }) : line}\n`);
  } catch { /* never blocks a command */ }
}

export function readAudit(limit = 50) {
  const f = join(DATA_DIR, 'audit.jsonl');
  if (!existsSync(f)) return [];
  return read(f).trim().split('\n').filter(Boolean).slice(-limit).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/* ------------------------------------------------------------------ the local reads */

/** Values under secret-looking keys replaced, recursively. */
export function redact(v, depth = 0) {
  if (depth > 12) return v;
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  if (!isObj(v)) return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEY.test(k) && (typeof x === 'string' || typeof x === 'number') && String(x).length ? '[redacted]' : redact(x, depth + 1)]));
}

/** A plugin's data folder (relative to the repo root, the hub data root when the console runs with one). */
export function dataDirOf(entry) {
  const rel = entry.dataDir ?? '';
  if (!rel || rel.includes('..')) return null;
  return resolve(process.env.AXF_PLUGIN_DATA_ROOT || ROOT, rel);
}

function dataList(dir, sub = '') {
  const start = resolve(dir, sub || '.');
  if (!start.startsWith(dir)) throw Object.assign(new Error('dir must stay inside the data folder'), { code: CONTROL_WIRE.VALIDATION });
  if (!existsSync(start)) return { items: [], total: 0, dir: relative(ROOT, dir) };
  const items = [];
  for (const f of files(start, () => true)) {
    const rel = relative(dir, f).split(sep).join('/');
    if (items.length >= LIST_MAX) break;
    const st = statSync(f);
    items.push({ file: rel, size: st.size, changed: st.mtime.toISOString(), ...(SECRET_FILE.test(rel) ? { private: true } : {}) });
  }
  return { items, total: items.length, dir: relative(ROOT, dir) };
}

function dataFile(dir, file) {
  const f = resolve(dir, String(file ?? ''));
  if (!file || !f.startsWith(dir + sep)) throw Object.assign(new Error('file must be a path inside the data folder (data lists them)'), { code: CONTROL_WIRE.VALIDATION });
  if (SECRET_FILE.test(relative(dir, f))) throw Object.assign(new Error(`${file} holds keys or secrets and is never read through control@1`), { code: CONTROL_WIRE.DENIED });
  if (!existsSync(f) || !statSync(f).isFile()) throw Object.assign(new Error(`no file ${file} in the data folder`), { code: CONTROL_WIRE.NOT_FOUND });
  const st = statSync(f);
  const buf = readFileSync(f).subarray(0, FILE_MAX);
  const truncated = st.size > FILE_MAX;
  if (buf.includes(0)) return { file, size: st.size, changed: st.mtime.toISOString(), binary: true };
  const text = buf.toString('utf8');
  if (/\.(json)$/i.test(f) && !truncated) { try { return { file, size: st.size, changed: st.mtime.toISOString(), value: redact(JSON.parse(text)) }; } catch { /* not JSON after all */ } }
  if (/\.jsonl$/i.test(f)) {
    const lines = text.split('\n').filter(Boolean).slice(-200).map((l) => { try { return redact(JSON.parse(l)); } catch { return null; } }).filter(Boolean);
    return { file, size: st.size, changed: st.mtime.toISOString(), lines, ...(truncated ? { truncated: true } : {}) };
  }
  return { file, size: st.size, changed: st.mtime.toISOString(), text: text.replace(/((?:token|secret|password|key)\s*[=:]\s*)\S+/gi, '$1[redacted]'), ...(truncated ? { truncated: true } : {}) };
}

/* ------------------------------------------------------------------ gate + plan */

class PluginError extends Error { constructor(code, message, extra = {}) { super(message); this.code = code; this.extra = extra; } }

const listItem = (p, c) => ({ id: `${p.folder}/${c.id}`, plugin: p.folder, app: p.app, name: p.name, command: c.id, title: c.title, description: c.description, kind: c.kind, effect: c.effect, confirm: c.confirm, run: c.run.route ? 'route' : c.run.action ? 'action' : c.run.data ? 'data' : 'info', tool: p.app === 'console-web' ? commandToolName(p.folder, c.id) : null, enabled: p.enabled !== false, ...(c.context ? { context: true } : {}) });

/**
 * Gate and plan one plugins.* command. Answers the control@1 envelope for list / get / local reads and failures, or
 * `{ ok: true, dispatch, command, effect }` for the console server to run (route in-process, action in the open console).
 */
export function plan(raw, { grants = ['*'], by = '', enabled = null, now = Date.now(), reg = null } = {}) {
  const c = normalizeControl(raw);
  if (!c.by && by) c.by = by;
  const gate = controlGate(c, grants, { salt: confirmSalt(), now });
  const fail = (code, message, extra = {}) => controlFailure(code, message, { op: c.op, target: c.target, ...(c.path ? { path: c.path } : {}), ...extra });
  if (!gate.ok) { const { ok: _o, code, message, ...extra } = gate; return fail(code, message, extra); }
  if (!String(c.target).startsWith('plugins.')) return fail(CONTROL_WIRE.NOT_IMPLEMENTED, `${c.target} is not a plugins target`);
  const r = reg ?? registry({ enabled });
  const reads = c.target === 'plugins.reads';
  try {
    if (c.op === 'list') {
      const s = isObj(c.select) ? c.select : {};
      const q = String(s.q ?? '').toLowerCase().trim();
      let items = r.plugins.flatMap((p) => p.commands.filter((x) => (reads ? x.kind === 'read' : x.kind === 'command')).map((x) => listItem(p, x)));
      if (s.plugin) items = items.filter((x) => x.plugin === s.plugin);
      if (s.app) items = items.filter((x) => x.app === s.app);
      if (s.effect) items = items.filter((x) => x.effect === s.effect);
      if (q) items = items.filter((x) => `${x.id} ${x.title} ${x.description} ${x.name}`.toLowerCase().includes(q));
      const total = items.length;
      return controlResult(c, { items: items.slice(0, Math.max(1, Math.min(Number(s.limit) || LIST_MAX, LIST_MAX))), total });
    }
    const hit = resolvePluginCommand(r, c.path);
    if (!hit) {
      const [folder] = String(c.path).split('/');
      const p = r.plugins.find((x) => x.folder === folder);
      throw new PluginError(CONTROL_WIRE.NOT_FOUND, p ? `${p.name} has no ${reads ? 'read' : 'command'} ${c.path.split('/')[1] ?? ''} (it has ${p.commands.filter((x) => (reads ? x.kind === 'read' : x.kind === 'command')).map((x) => x.id).join(', ') || 'none'})` : `no plugin ${folder} (plugins.commands list names them)`);
    }
    const { plugin, command: cmd } = hit;
    if (reads !== (cmd.kind === 'read')) throw new PluginError(CONTROL_WIRE.NOT_FOUND, `${c.path} is a ${cmd.kind}: use ${cmd.kind === 'read' ? 'plugins.reads act read' : 'plugins.commands act run'}`);
    if (c.op === 'get') return controlResult(c, { item: { ...listItem(plugin, cmd), input: cmd.input, output: cmd.output, source: cmd.source, rest: pluginCommandRoutes({ plugins: [{ ...plugin, commands: [cmd] }] })[0] ?? null, cli: pluginCommandCli({ plugins: [{ ...plugin, commands: [cmd] }] }).commands[0]?.usage ?? null } });
    // act
    if (plugin.enabled === false) throw new PluginError(CONTROL_WIRE.NOT_IMPLEMENTED, `${plugin.name} is turned off (Settings → Plugins)`);
    if (plugin.app !== 'console-web') throw new PluginError(CONTROL_WIRE.NOT_IMPLEMENTED, `${plugin.name} runs in ${plugin.app}, not the console: its commands are listed here and run there`);
    const input = isObj(c.input) ? c.input : {};
    const errs = pluginInputErrors(cmd, input);
    if (errs.length) throw new PluginError(CONTROL_WIRE.VALIDATION, errs.join('; '), { errors: errs });
    // the command's own effect on top of the gate (a read needs read, a deleting command delete + a confirm token)
    const need = `control.plugins.${{ read: 'read', write: 'write', navigate: 'write', destructive: 'delete' }[cmd.effect]}`;
    if (!controlGranted(grants, need)) throw new PluginError(CONTROL_WIRE.DENIED, `${c.path} needs ${need}`, { requires: need });
    if (cmd.confirm && !controlConfirmValid(c, c.confirm, confirmSalt(), now)) {
      return fail(CONTROL_WIRE.CONFIRMATION_REQUIRED, `${plugin.name}: ${cmd.title} ${cmd.effect === 'destructive' ? 'deletes or resets' : 'needs a confirm'}; send the same command again with this confirm token within ${CONTROL_CONFIRM_TTL_MS / 60000} minutes`, { requires: need, effect: cmd.effect, confirm: controlConfirmToken(c, confirmSalt(), now), ttlMs: CONTROL_CONFIRM_TTL_MS });
    }
    if (cmd.run.info) return controlResult(c, { value: { folder: plugin.folder, app: plugin.app, id: plugin.id, name: plugin.name, version: plugin.version, description: plugin.description, provides: plugin.provides, needs: plugin.needs, optional: plugin.optional, dataDir: plugin.dataDir, commands: plugin.commands.map((x) => listItem(plugin, x)), skipped: plugin.skipped } });
    if (cmd.run.data) {
      const dir = dataDirOf(plugin);
      if (!dir) throw new PluginError(CONTROL_WIRE.NOT_FOUND, `${plugin.name} has no data folder`);
      return controlResult(c, cmd.run.data === 'list' ? dataList(dir, input.dir) : { value: dataFile(dir, input.file) });
    }
    const dispatch = cmd.run.route
      ? { kind: 'route', ...pluginRouteRequest(plugin.folder, cmd, input) }
      : { kind: 'action', action: cmd.run.action, args: input.args ?? null, to: input.to ?? 'recent' };
    return { ok: true, dispatch, command: c, effect: cmd.effect, plugin: plugin.folder, name: plugin.name, title: cmd.title };
  } catch (e) {
    if (e instanceof PluginError) return fail(e.code, e.message, e.extra);
    if (e?.code && Object.values(CONTROL_WIRE).includes(e.code)) return fail(e.code, e.message);
    return fail(CONTROL_WIRE.UNEXPECTED, e?.message ?? String(e));
  }
}

/** The answer of a dispatched command, as a control@1 envelope (the console server calls this after running it). */
export function finish(command, outcome) {
  const c = normalizeControl(command);
  const ok = typeof outcome.ok === 'boolean' ? outcome.ok : outcome.status === undefined || (outcome.status >= 200 && outcome.status < 300);
  if (c.target === 'plugins.commands') audit({ by: c.by || 'unknown', reason: c.reason ?? '', path: c.path, input: c.input, status: outcome.status ?? null, ok });
  if (!ok) {
    const code = outcome.status === 401 || outcome.status === 403 ? CONTROL_WIRE.DENIED : outcome.status === 404 ? CONTROL_WIRE.NOT_FOUND : outcome.status === 400 || outcome.status === 422 ? CONTROL_WIRE.VALIDATION : outcome.code ?? CONTROL_WIRE.UNEXPECTED;
    return controlFailure(code, outcome.message || `the plugin answered ${outcome.status}`, { op: c.op, target: c.target, path: c.path, status: outcome.status, result: outcome.result });
  }
  return controlResult(c, c.target === 'plugins.reads' ? { value: outcome.result } : { changed: true, result: outcome.result, ...(outcome.delivered ? { delivered: outcome.delivered } : {}) }, { by: c.by || 'unknown', reason: c.reason ?? '', at: new Date().toISOString() });
}

/* ------------------------------------------------------------------ CLI */

function cliFlags(argv) {
  const out = { _: [], input: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--') || a === '--') { out._.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    const boolFlag = ['json', 'help', 'local'].includes(k);
    const v = inline !== undefined ? inline : !boolFlag && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    if (['json', 'help', 'confirm', 'remote', 'by', 'reason', 'local', 'to'].includes(k) && k !== 'to') out[k] = v;
    else { let x = v; if (typeof v === 'string') { try { x = JSON.parse(v); } catch { x = v; } } out.input[k] = x; }
  }
  return out;
}

async function remote(command, url) {
  const base = (typeof url === 'string' && url) || process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com';
  const tok = process.env.AXF_TOKEN || '';
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/control`, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(command) });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return controlFailure(CONTROL_WIRE.UNEXPECTED, `${res.status}: ${text.slice(0, 300)}`); }
  } catch (e) {
    return controlFailure(CONTROL_WIRE.NOT_IMPLEMENTED, `can't reach the console at ${base} (${e?.message ?? e}); set AXF_CONSOLE_URL and AXF_TOKEN`);
  }
}

function show(r, json) {
  if (json) { console.log(JSON.stringify(r, null, 2)); return; }
  if (!r.ok) {
    console.error(`✗ ${r.code}: ${r.message}`);
    if (r.code === 'confirmation_required') console.error(`  run it again with --confirm ${r.confirm}`);
    return;
  }
  const { $axf: _a, ok: _o, op: _p, target: _t, ...rest } = r;
  console.log(JSON.stringify(rest, null, 2));
}

export async function main(argv) {
  const f = cliFlags(argv);
  const [cmd, ...rest] = f._;
  const out = (o, text) => console.log(f.json ? JSON.stringify(o, null, 2) : text);
  if (!cmd || cmd === 'help' || (cmd === 'plugins' && f.help)) {
    console.log(['Plugin commands (control@1 plugins domain): every plugin\'s commands and reads.', ...pluginCommandCli({ plugins: [] }).usage.map((u) => `  ${u}`), '  axf plugin-commands registry | check [folder…] | tools | routes | cli   (--json)', '', 'Reads of info and the data folder run here; the rest go to the console (AXF_CONSOLE_URL, AXF_TOKEN).'].join('\n'));
    return 0;
  }
  if (cmd === 'registry') { out(registry(), JSON.stringify(registry(), null, 2)); return 0; }
  if (cmd === 'tools') { const t = pluginCommandTools(registry()); out(t, t.map((x) => `${x.name.padEnd(48)} ${x.annotations.readOnlyHint ? 'read' : x.annotations.destructiveHint ? 'destructive' : 'write'}`).join('\n')); return 0; }
  if (cmd === 'routes') { const t = pluginCommandRoutes(registry()); out(t, t.map((x) => `${x.method.padEnd(6)} ${x.path}`).join('\n')); return 0; }
  if (cmd === 'cli') { const t = pluginCommandCli(registry()); out(t, t.commands.map((x) => x.usage).join('\n')); return 0; }
  if (cmd === 'audit') { out(readAudit(Number(rest[0]) || 50), readAudit(Number(rest[0]) || 50).map((a) => `${a.at} ${a.by} ${a.path} ${a.ok ? 'ok' : `failed ${a.status}`}`).join('\n')); return 0; }
  if (cmd === 'plan') {
    const body = JSON.parse(read('/dev/stdin') || '{}');
    console.log(JSON.stringify(plan(body.command ?? {}, { grants: body.grants ?? ['*'], by: body.by ?? '', enabled: body.enabled ?? null, reg: body.registry ?? null })));
    return 0;
  }
  if (cmd === 'bundle') { const body = JSON.parse(read('/dev/stdin') || '{}'); const reg = registry({ enabled: body.enabled ?? null }); console.log(JSON.stringify({ registry: reg, tools: pluginCommandTools(reg) })); return 0; }
  if (cmd === 'finish') { const body = JSON.parse(read('/dev/stdin') || '{}'); console.log(JSON.stringify(finish(body.command ?? {}, body.outcome ?? {}))); return 0; }
  if (cmd === 'check') {
    const reg = registry({ folders: rest.length ? rest : null, apps: ['console-web'] });
    const res = reg.plugins.map((p) => ({ folder: p.folder, ...pluginCommandCoverage(p) }));
    if (f.json) out(res, '');
    else for (const x of res) console.log(`${x.ok ? '✓' : '✗'} ${x.folder.padEnd(24)} ${x.reads} reads · ${x.commands} commands${x.errors.length ? `\n${x.errors.map((e) => `    ✗ ${e}`).join('\n')}` : ''}`);
    return res.every((x) => x.ok) ? 0 : 1;
  }
  if (cmd === 'plugins') {
    const reg = registry();
    if (rest[0]) { const p = reg.plugins.find((x) => x.folder === rest[0]); if (!p) { console.error(`no plugin ${rest[0]}`); return 2; } out(p, pluginHelp(p)); return 0; }
    out(reg.plugins.map((p) => ({ folder: p.folder, app: p.app, name: p.name, commands: p.commands.length })), reg.plugins.map((p) => `${p.app === 'console-web' ? '' : `${p.app}:`}${p.folder.padEnd(28)} ${String(p.commands.filter((c) => c.kind === 'read').length).padStart(3)} reads ${String(p.commands.filter((c) => c.kind === 'command').length).padStart(3)} commands  ${p.name}`).join('\n'));
    return 0;
  }
  // axf <plugin> [<command>] [--field value]…
  const reg = registry();
  const folder = cmd === 'plugin' ? rest.shift() : cmd;
  const p = reg.plugins.find((x) => x.folder === folder && x.app === 'console-web') ?? reg.plugins.find((x) => x.folder === folder);
  if (!p) { console.error(`no plugin ${folder} (axf plugins lists them)`); return 2; }
  const id = rest[0];
  if (!id || f.help && !id) { console.log(pluginHelp(p)); return 0; }
  const c = p.commands.find((x) => x.id === id);
  if (!c) { console.error(`${p.name} has no command ${id}\n\n${pluginHelp(p)}`); return 2; }
  if (f.help) { console.log(`${c.title}\n${c.description}\n\n${pluginCommandCli({ plugins: [{ ...p, commands: [c] }] }).commands[0].usage}\ninput: ${JSON.stringify(c.input, null, 2)}`); return 0; }
  const command = { op: 'act', target: c.kind === 'read' ? 'plugins.reads' : 'plugins.commands', path: `${p.folder}/${c.id}`, action: c.kind === 'read' ? 'read' : 'run', input: f.input, by: typeof f.by === 'string' ? f.by : 'cli', ...(typeof f.reason === 'string' ? { reason: f.reason } : {}), ...(typeof f.confirm === 'string' ? { confirm: f.confirm } : {}) };
  let r;
  if ((c.run.info || c.run.data) && !f.remote) r = plan(command, { reg });
  else r = await remote(command, f.remote);
  show(r, f.json);
  return r.ok ? 0 : r.code === 'confirmation_required' ? 3 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e?.message ?? e); process.exitCode = 1; });
}

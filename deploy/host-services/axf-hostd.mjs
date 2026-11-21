#!/usr/bin/env node
/**
 * axf-hostd — the host runner for host-service@1 (framework/spec/HOST-SERVICES.md). One small Node daemon per service,
 * started by the systemd template deploy/host-services/axf-host@.service (rendered to axf-<id>.service by the installer):
 *
 *   node deploy/host-services/axf-hostd.mjs <id>              serve <id>: load its manifest, run its worker's loop, serve
 *                                                             the API on /run/axf-host/<id>.sock, heartbeat, log to journald
 *   node deploy/host-services/axf-hostd.mjs <id> --once       one tick of the worker, print the run record, exit
 *   node deploy/host-services/axf-hostd.mjs <id> action <a> [--args '{…}'] [--confirm]
 *                                                             run one worker action in this process (ticks, tests)
 *   node deploy/host-services/axf-hostd.mjs --check           validate every manifest and worker, print the list, exit
 *
 * With <id> = host-api it is the host API: the one daemon the console talks to, on /run/axf-host/api.sock and on
 * loopback 127.0.0.1:7788 (+ AXF_HOST_BIND, e.g. the docker bridge address). It knows every manifest, asks systemd about
 * units, forwards health / actions / settings to each service's socket, keeps the mode file and runs rollbacks.
 *
 * Manifests: deploy/host-services/services/<id>.json (and, for older parts, deploy/<dir>/host-service.json).
 * Workers:   the manifest's `runner`, an ES module exporting any of
 *              intervalSec                      loop period (else the setting `intervalSec`, else health.intervalSec)
 *              tick(ctx)        → { result?, message?, effects? }   one pass of the loop; ctx.dryRun in shadow mode
 *              health(ctx)      → { ok, message? }                  extra health on top of the loop's own
 *              actions: { <id>: (args, ctx) → result }              the manifest's declared actions
 *              start(ctx) / stop(ctx)                               once at start / on SIGTERM
 *            ctx = { id, manifest, mode, dryRun, settings, root, data, dataDir, log, sudo, exec, readJson, writeJson }.
 *
 * Env: AXF_HOST_ROOT (checkout, default this repo), AXF_HOST_DATA (the shared _data folder, default <root>/_data),
 *      AXF_HOST_SOCKET_DIR (default /run/axf-host), AXF_HOST_TOKEN (loopback bearer), AXF_HOST_PORT (host-api loopback
 *      port, default 7788; another service binds loopback only when this is set for it), AXF_HOST_BIND (extra
 *      comma-separated listen addresses for host-api), AXF_HOST_SYSTEMCTL / AXF_HOST_JOURNALCTL / AXF_HOST_SUDO (tests),
 *      AXF_HOST_MODE (forces off | shadow | host, tests and the dry-run drill).
 * Logs: one JSON line per event on stdout, prefixed with the syslog level (<3> error, <4> warn, <6> info) so journald
 * keeps the priority (SyslogLevelPrefix=true in the unit). Read them with `journalctl -u axf-<id>`.
 */
import { createServer, request as httpRequest } from 'node:http';
import { execFile } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { appendJsonlSync, readJsonSync, writeJsonSync } from '../../framework/core/data-files.mjs';
import * as H from '../../framework/core/host-services.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(process.env.AXF_HOST_ROOT || join(HERE, '../..'));
export const DATA = resolve(process.env.AXF_HOST_DATA || join(ROOT, '_data'));
export const SOCKET_DIR = process.env.AXF_HOST_SOCKET_DIR || H.DEFAULTS.socketDir;
export const SERVICES_DIR = join(ROOT, 'deploy/host-services/services');
const TOKEN = (process.env.AXF_HOST_TOKEN || '').trim();
// Everything this process runs (workers, the framework CLIs they import) knows it is the host side: the mode guard
// (framework/cli/host-mode.mjs) lets the host copy run, the console's copy is the one that steps aside.
process.env.AXF_HOST_SIDE = '1';
if (process.env.AXHUB_PROJECTS_DIR === '') delete process.env.AXHUB_PROJECTS_DIR;
const VERSION = 1;
const now = () => new Date().toISOString();

// ------------------------------------------------------------------ logging (journald)

const LEVEL = { error: 3, warn: 4, info: 6, debug: 7 };
let LOG_ID = 'axf-hostd';
export function log(level, msg, extra = {}) {
  const line = JSON.stringify({ at: now(), service: LOG_ID, level, msg, ...extra });
  process.stdout.write(`<${LEVEL[level] ?? 6}>${line}\n`);
}

// ------------------------------------------------------------------ files

/** `_data/…` paths in manifests resolve against AXF_HOST_DATA (the shared data folder); anything else against the checkout. */
export function dataPath(rel) {
  const r = String(rel || '');
  return r.startsWith('_data/') ? join(DATA, r.slice('_data/'.length)) : r === '_data' ? DATA : join(ROOT, r);
}
// State goes through the data layer (data-store@1, no-json-data@1): a path its map does not name is a plain local
// file, which is what the host services need (they must keep their state while Docker and axf-data are down). When the
// host-services folder is mapped, its namespace stays local or shadow for the same reason, never cutover.
export function readJson(p, fallback = null) { return readJsonSync(p, fallback); }
export function writeJson(p, v) { writeJsonSync(p, v); }
const appendLine = (p, v) => appendJsonlSync(p, v);
const MODE_FILE = () => dataPath(H.DEFAULTS.modeFile);
const HISTORY_FILE = () => dataPath(`${H.DEFAULTS.stateDir}/history.jsonl`);

// ------------------------------------------------------------------ manifests

/** Every manifest on disk: deploy/host-services/services/*.json, then deploy/<dir>/host-service.json. Sound ones normalised. */
export function loadManifests(root = ROOT) {
  const raw = [];
  const bad = [];
  const add = (file) => {
    const m = readJson(file, undefined);
    if (m === undefined) { bad.push({ file, error: 'not JSON' }); return; }
    const errs = H.manifestErrors(m, relative(root, file));
    if (errs.length) { bad.push({ file, id: typeof m?.id === 'string' ? m.id : '', error: errs.join('; ') }); return; }
    raw.push(m);
  };
  const dir = join(root, 'deploy/host-services/services');
  if (existsSync(dir)) for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) add(join(dir, f));
  for (const d of readdirSync(join(root, 'deploy'), { withFileTypes: true })) if (d.isDirectory() && existsSync(join(root, 'deploy', d.name, 'host-service.json'))) add(join(root, 'deploy', d.name, 'host-service.json'));
  const set = H.normManifests(raw);
  return { manifests: set.manifests, errors: [...set.errors, ...bad.map((b) => `${b.file}: ${b.error}`)], bad };
}

// ------------------------------------------------------------------ settings, mode

export function settingsOf(m) {
  const saved = readJson(dataPath(`${m.dataDir}/settings.json`), {}) || {};
  const out = {};
  for (const [k, d] of Object.entries(m.settings)) out[k] = saved[k] !== undefined && !H.valueError(d, saved[k]) ? saved[k] : d.default;
  return out;
}
export function putSettings(m, set) {
  if (!set || typeof set !== 'object' || Array.isArray(set)) throw new H.HostServiceError('invalid_body', 'set must be an object', { service: m.id });
  for (const [k, v] of Object.entries(set)) {
    const d = m.settings[k];
    if (!d) throw new H.HostServiceError('unknown_setting', `${m.id} has no setting ${k}`, { service: m.id });
    const e = H.valueError(d, v);
    if (e) throw new H.HostServiceError('invalid_body', `${k}: ${e}`, { service: m.id });
  }
  const file = dataPath(`${m.dataDir}/settings.json`);
  const merged = { ...(readJson(file, {}) || {}), ...set }; // per key, last save wins
  writeJson(file, merged);
  return settingsOf(m);
}
export function readModeState() {
  const v = readJson(MODE_FILE(), null);
  try { return v ? H.normModeState(v, now()) : H.initialModeState(now()); } catch { return H.initialModeState(now()); }
}
/** off | shadow | host for this runner: AXF_HOST_MODE wins (drills), else the mode file. */
export function runMode(id) {
  const forced = process.env.AXF_HOST_MODE;
  if (forced === 'off' || forced === 'shadow' || forced === 'host') return forced;
  const m = H.modeOf(readModeState(), id);
  return m === 'container' ? 'off' : m;
}
const toModeName = (rm) => (rm === 'off' ? 'container' : rm);

// ------------------------------------------------------------------ commands (sudo whitelist)

const SUDO = process.env.AXF_HOST_SUDO || '/usr/bin/sudo';
/** Does `line` match one whitelist entry (exact, or a prefix when the entry ends in ` *`)? */
export function allowed(manifest, raw) {
  // Manifests name the production checkout (/opt/axf); a checkout elsewhere (tests, a second clone) maps onto it.
  const line = ROOT !== '/opt/axf' ? raw.split(ROOT).join('/opt/axf') : raw;
  const glob = (cmd) => new RegExp(`^${cmd.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return manifest.sudo.some((s) => line === s.cmd || (s.cmd.includes('*') && (glob(s.cmd).test(line) || (s.cmd.endsWith(' *') && line === s.cmd.slice(0, -2)))));
}
function run(file, args, { timeoutMs = 120000, input } = {}) {
  return new Promise((res) => {
    const child = execFile(file, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      res({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err && !Number.isInteger(err.code) ? String(err.code || err.message) : '' });
    });
    if (input !== undefined) { child.stdin.end(input); }
  });
}
/** Run a whitelisted command as root through `sudo -n`. Anything not in the manifest's sudo list is forbidden_command. */
export function makeSudo(manifest) {
  return async (argv, opts = {}) => {
    const line = argv.join(' ');
    if (!argv[0]?.startsWith('/') || !allowed(manifest, line)) {
      log('warn', 'forbidden command', { asked: line });
      throw new H.HostServiceError('forbidden_command', `${manifest.id} may not run: ${line}`, { service: manifest.id });
    }
    const r = await run(SUDO, ['-n', ...argv], opts);
    log(r.ok ? 'info' : 'warn', 'sudo', { cmd: line, code: r.code });
    return r;
  };
}
/** Run an unprivileged program as the service user. */
export const exec = (file, args = [], opts = {}) => run(file, args, opts);

// ------------------------------------------------------------------ http helpers

function send(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}
function sendError(res, e, requestId) {
  const err = e instanceof H.HostServiceError ? e : new H.HostServiceError('internal', `${e?.message || e} (request ${requestId})`, { requestId });
  if (err.code === 'internal') log('error', 'internal', { requestId, error: String(e?.stack || e).slice(0, 2000) });
  send(res, err.status, err.frame());
}
function readBody(req, limit = 1024 * 1024) {
  return new Promise((res, rej) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > limit) { rej(new H.HostServiceError('invalid_body', 'body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      if (!s.trim()) return res({});
      try { const v = JSON.parse(s); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(); res(v); } catch { rej(new H.HostServiceError('invalid_body', 'the body is not a JSON object')); }
    });
    req.on('error', rej);
  });
}
/** Call a service socket: { status, body } or { error }. */
export function callSocket(socketPath, method, path, body, timeoutMs = 5000) {
  return new Promise((res) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ socketPath, method, path, headers: { accept: 'application/json', ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) }, timeout: timeoutMs }, (r) => {
      const chunks = []; r.on('data', (c) => chunks.push(c));
      r.on('end', () => { const s = Buffer.concat(chunks).toString('utf8'); let b = s; try { b = JSON.parse(s); } catch { /* text */ } res({ status: r.statusCode, body: b }); });
    });
    req.on('timeout', () => { req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); });
    req.on('error', (error) => res({ error }));
    if (data) req.write(data);
    req.end();
  });
}
function listen(server, where) {
  return new Promise((res, rej) => {
    server.once('error', rej);
    if (where.socket) {
      mkdirSync(dirname(where.socket), { recursive: true });
      if (existsSync(where.socket)) unlinkSync(where.socket);
      server.listen(where.socket, () => { try { chmodSync(where.socket, 0o660); } catch { /* not ours */ } res(); });
    } else server.listen(where.port, where.host, res);
  });
}

// ------------------------------------------------------------------ one service (daemon with a worker loop)

export async function loadWorker(m, root = ROOT) {
  if (m.id === H.DEFAULTS.hostApiId) return {};
  const file = join(root, m.runner);
  if (!existsSync(file)) throw new H.HostServiceError('invalid_manifest', `${m.id}: runner ${m.runner} is missing`, { service: m.id });
  const mod = await import(pathToFileURL(file).href);
  return mod.default && typeof mod.default === 'object' ? { ...mod, ...mod.default } : mod;
}

export function makeCtx(m, extra = {}) {
  const rm = runMode(m.id);
  return {
    id: m.id, manifest: m, mode: rm, dryRun: rm === 'shadow', settings: settingsOf(m), root: ROOT, data: DATA, dataDir: dataPath(m.dataDir),
    log: (level, msg, x) => log(level, msg, x), sudo: makeSudo(m), exec, readJson, writeJson, dataPath, ...extra,
  };
}

/** One pass of the worker loop, honouring the mode: off → skipped, shadow → dry run logged to shadow.jsonl, host → real. */
export async function tickOnce(m, worker, { record = true } = {}) {
  const ctx = makeCtx(m);
  const t0 = Date.now();
  let out;
  if (ctx.mode === 'off') out = { result: 'skipped', message: 'mode container: the console runs this part' };
  else if (typeof worker.tick !== 'function') out = { result: 'skipped', message: 'no loop: actions only' };
  else {
    try {
      const r = (await worker.tick(ctx)) || {};
      out = { result: H.RUN_RESULTS.includes(r.result) ? r.result : 'ok', message: String(r.message || ''), effects: Array.isArray(r.effects) ? r.effects : [] };
    } catch (e) { out = { result: 'error', message: String(e?.message || e).slice(0, 600) }; }
  }
  const runRec = { at: now(), result: out.result, durationMs: Date.now() - t0, message: out.message, mode: toModeName(ctx.mode), ...(out.effects ? { effects: out.effects } : {}) };
  if (record) {
    writeJson(dataPath(`${m.dataDir}/state.json`), runRec);
    if (ctx.mode === 'shadow') {
      appendLine(dataPath(`${m.dataDir}/shadow.jsonl`), { side: 'host', ...runRec });
      // a clean dry run counts towards the cut-over guard (minRuns); drift is counted when the console reports its run
      if (out.result === 'ok') { try { writeJson(MODE_FILE(), H.recordShadowRun(readModeState(), m.id, { at: runRec.at })); } catch (e) { log('warn', 'shadow run not counted', { error: String(e?.message || e) }); } }
    }
  }
  log(out.result === 'error' ? 'warn' : 'info', 'tick', { result: out.result, durationMs: runRec.durationMs, mode: runRec.mode, message: out.message });
  return runRec;
}

const busy = new Set();
/** Run one declared action (checks args, confirm and mode first; one at a time per action). */
export async function runAction(m, worker, actionId, body = {}) {
  const ctx = makeCtx(m);
  const errs = H.actionCallErrors(m, actionId, { args: body.args || {}, confirm: body.confirm ? 'yes' : '', mode: toModeName(ctx.mode) });
  if (errs.length) throw errs[0];
  const fn = worker.actions?.[actionId];
  if (typeof fn !== 'function') throw new H.HostServiceError('unknown_action', `${m.id}: the worker has no ${actionId}`, { service: m.id, action: actionId });
  if (busy.has(actionId)) throw new H.HostServiceError('busy', `${actionId} is already running`, { service: m.id, action: actionId, retryAfterMs: 5000 });
  const a = m.actions.find((x) => x.id === actionId);
  busy.add(actionId);
  const t0 = Date.now();
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve(fn(body.args || {}, ctx)),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new H.HostServiceError('timeout', `${actionId} took longer than ${a.timeoutMs} ms`, { service: m.id, action: actionId })), a.timeoutMs); }),
    ]);
    const out = { ok: true, result: result ?? null, at: now(), durationMs: Date.now() - t0, dryRun: ctx.dryRun };
    appendLine(HISTORY_FILE(), { at: out.at, service: m.id, kind: 'action', action: actionId, by: body.by || '', reason: body.reason || null, ok: true, durationMs: out.durationMs });
    log('info', 'action', { action: actionId, by: body.by || '', durationMs: out.durationMs });
    return out;
  } catch (e) {
    appendLine(HISTORY_FILE(), { at: now(), service: m.id, kind: 'action', action: actionId, by: body.by || '', ok: false, error: e?.code || 'internal' });
    throw e;
  } finally { clearTimeout(timer); busy.delete(actionId); }
}

function heartbeat(m, extra = {}) {
  const hb = { at: now(), pid: process.pid, mode: toModeName(runMode(m.id)), version: VERSION, ...extra };
  writeJson(dataPath(`${m.dataDir}/heartbeat.json`), hb);
  return hb;
}

async function serviceHealth(m, worker) {
  const last = readJson(dataPath(`${m.dataDir}/state.json`), null);
  let extra = {};
  if (typeof worker.health === 'function') { try { extra = (await worker.health(makeCtx(m))) || {}; } catch (e) { extra = { ok: false, message: String(e?.message || e) }; } }
  const ok = extra.ok !== false && (!last || last.result !== 'error');
  return { ok, service: m.id, at: now(), pid: process.pid, mode: toModeName(runMode(m.id)), lastRun: last, message: extra.message || (last?.result === 'error' ? `last run: ${last.message}` : '') };
}

/** Routes one service serves on its socket (the host API forwards to these with the same bodies). */
function serviceHandler(m, worker) {
  return async (req, res) => {
    const requestId = randomUUID().slice(0, 8);
    try {
      const url = new URL(req.url, 'http://local');
      const p = url.pathname.replace(/^\/v1(?=\/)/, '');
      if (req.method === 'GET' && p === '/health') return send(res, 200, await serviceHealth(m, worker));
      if (req.method === 'GET' && p === '/state') return send(res, 200, { lastRun: readJson(dataPath(`${m.dataDir}/state.json`), null), heartbeat: readJson(dataPath(`${m.dataDir}/heartbeat.json`), null) });
      if (req.method === 'GET' && p === '/settings') return send(res, 200, { settings: settingsOf(m), declared: m.settings });
      if (req.method === 'PUT' && p === '/settings') { const b = await readBody(req); const s = putSettings(m, b.set); appendLine(HISTORY_FILE(), { at: now(), service: m.id, kind: 'settings', keys: Object.keys(b.set || {}), by: b.by || '' }); return send(res, 200, { ok: true, settings: s }); }
      const am = /^\/actions\/([a-z0-9-]+)$/.exec(p);
      if (req.method === 'POST' && am) return send(res, 200, await runAction(m, worker, am[1], await readBody(req)));
      if (req.method === 'POST' && p === '/tick') return send(res, 200, await tickOnce(m, worker));
      throw new H.HostServiceError('unknown_action', `no route ${req.method} ${url.pathname}`, { service: m.id });
    } catch (e) { sendError(res, e, requestId); }
  };
}

function authOk(req, isLoopback) {
  if (!isLoopback) return true; // the socket is authorised by its file mode (axf-host group)
  if (!TOKEN) return false;
  return (req.headers.authorization || '') === `Bearer ${TOKEN}`;
}

export async function serveService(id) {
  const { manifests, errors } = loadManifests();
  const m = manifests.find((x) => x.id === id);
  if (!m) throw new H.HostServiceError('unknown_service', `no manifest for ${id}${errors.length ? ` (${errors.join('; ')})` : ''}`, { service: id });
  LOG_ID = m.id;
  if (m.id === H.DEFAULTS.hostApiId) return serveHostApi(m);
  const worker = await loadWorker(m);
  const handler = serviceHandler(m, worker);
  const socket = process.env.AXF_HOST_SOCKET_DIR ? join(SOCKET_DIR, `${m.id}.sock`) : m.socket;
  const sock = createServer(handler);
  await listen(sock, { socket });
  const servers = [sock];
  if (process.env.AXF_HOST_PORT) {
    const lb = createServer((req, res) => (req.url.endsWith('/health') || authOk(req, true) ? handler(req, res) : sendError(res, new H.HostServiceError('unauthorized', 'bearer token required'), '')));
    await listen(lb, { host: H.DEFAULTS.loopbackHost, port: Number(process.env.AXF_HOST_PORT) });
    servers.push(lb);
  }
  if (typeof worker.start === 'function') await worker.start(makeCtx(m));
  log('info', 'started', { socket, mode: toModeName(runMode(m.id)), runner: m.runner });
  const every = () => Math.max(5, Number(settingsOf(m).intervalSec || worker.intervalSec || m.health.intervalSec)) * 1000;
  let stopping = false;
  let timer;
  const loop = async () => {
    if (stopping) return;
    try { await tickOnce(m, worker); } catch (e) { log('error', 'tick crashed', { error: String(e?.stack || e).slice(0, 2000) }); }
    try { heartbeat(m); } catch (e) { log('warn', 'heartbeat not written', { error: String(e?.message || e) }); }
    if (!stopping) timer = setTimeout(loop, every());
  };
  heartbeat(m, { started: true });
  timer = setTimeout(loop, 250);
  const hb = setInterval(() => { try { heartbeat(m); } catch { /* logged on the next loop */ } }, Math.min(30000, every()));
  const stop = async (sig) => {
    if (stopping) return; stopping = true;
    clearTimeout(timer); clearInterval(hb);
    log('info', 'stopping', { signal: sig });
    try { if (typeof worker.stop === 'function') await worker.stop(makeCtx(m)); } catch (e) { log('warn', 'worker stop failed', { error: String(e?.message || e) }); }
    for (const s of servers) s.close();
    try { unlinkSync(socket); } catch { /* gone */ }
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGHUP', () => log('info', 'SIGHUP: settings and mode are read on every tick'));
  return { manifest: m, servers, stop };
}

// ------------------------------------------------------------------ host API

/** `show` and the journal read run unprivileged (overridable for tests); writes always go through sudo with the real paths. */
const SYSTEMCTL = process.env.AXF_HOST_SYSTEMCTL || '/usr/bin/systemctl';
const JOURNALCTL = process.env.AXF_HOST_JOURNALCTL || '/usr/bin/journalctl';
const SYSTEMCTL_ROOT = '/usr/bin/systemctl';
const JOURNALCTL_ROOT = '/usr/bin/journalctl';

/** systemd facts for one unit (no root needed for `show`). */
export async function unitFacts(unit) {
  const r = await exec(SYSTEMCTL, ['show', unit, '-p', 'ActiveState,MainPID,NRestarts,ActiveEnterTimestamp,UnitFileState,LoadState,Result,ExecMainExitTimestamp,ExecMainStatus'], { timeoutMs: 5000 });
  const kv = Object.fromEntries(r.stdout.split('\n').filter(Boolean).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
  const t = Date.parse(kv.ActiveEnterTimestamp || '');
  return {
    unitState: H.UNIT_STATES.includes(kv.ActiveState) ? kv.ActiveState : 'unknown', loaded: kv.LoadState === 'loaded',
    enabled: kv.UnitFileState === 'enabled', pid: Number(kv.MainPID) || 0, restarts: Number(kv.NRestarts) || 0,
    activeSince: Number.isFinite(t) ? new Date(t).toISOString() : null,
    // A oneshot's last run, for adopted ticks that write no state.json (the lander, watchdog layer 3, the build limit).
    lastRun: Number.isFinite(Date.parse(kv.ExecMainExitTimestamp || '')) ? { at: new Date(Date.parse(kv.ExecMainExitTimestamp)).toISOString(), result: kv.Result === 'success' && (kv.ExecMainStatus || '0') === '0' ? 'ok' : kv.Result === 'timeout' ? 'timeout' : 'error', durationMs: 0, message: kv.Result && kv.Result !== 'success' ? `systemd: ${kv.Result}, exit ${kv.ExecMainStatus}` : '' } : null,
  };
}

/**
 * Facts for a tick cron starts (an adopted schedule): the cron file stands in for the timer, the log's last write for
 * the last run. Cron keeps no result, so a run that fails but still writes its log reads as ok: the owner's own health
 * check covers what the run did; this one covers "is it still scheduled and still running".
 */
export function cronFacts(m, { cronDir = process.env.AXF_HOST_CRON_DIR || H.CRON_DIR } = {}) {
  const present = existsSync(join(cronDir, m.cron));
  let lastRun = null;
  try { lastRun = { at: statSync(m.log).mtime.toISOString(), result: 'ok', durationMs: 0, message: '' }; } catch { /* no log yet */ }
  return { unitState: 'inactive', timerState: present ? 'active' : 'inactive', enabled: present, lastRun, mode: 'host' };
}

/** Drills only (deploy/dryrun/host-services-rollback.sh): shorter cut-over guards. Never set on the VPS. */
function guardOverrides() {
  const o = {};
  if (process.env.AXF_HOST_MIN_SHADOW_MS) o.minShadowMs = Number(process.env.AXF_HOST_MIN_SHADOW_MS);
  if (process.env.AXF_HOST_MIN_RUNS) o.minRuns = Number(process.env.AXF_HOST_MIN_RUNS);
  return o;
}

export function makeHostApi(apiManifest, { manifestsFn = () => loadManifests(), facts = unitFacts } = {}) {
  let set = manifestsFn();
  const sudo = makeSudo(apiManifest);
  const prevFile = dataPath(`${H.DEFAULTS.stateDir}/states.json`);
  const find = (id) => set.manifests.find((m) => m.id === id) || (() => { throw new H.HostServiceError('unknown_service', `no service ${id}`, { service: id }); })();
  const socketOf = (m) => (process.env.AXF_HOST_SOCKET_DIR ? join(SOCKET_DIR, `${m.id}.sock`) : m.socket);
  const record = (v) => appendLine(HISTORY_FILE(), { at: now(), ...v });

  async function stateOf(m, prev) {
    const modeState = readModeState();
    if (m.id === H.DEFAULTS.hostApiId) return H.serviceState(m, { unitState: 'active', health: { ok: true, at: now() }, mode: 'host', pid: process.pid, enabled: true }, prev, now());
    if (m.cron) return H.serviceState(m, cronFacts(m), prev, now());
    const f = await facts(m.unit);
    const timer = m.kind === 'tick' ? await facts(m.timer) : null;
    let health = null;
    let lastRun = readJson(dataPath(`${m.dataDir}/state.json`), null) || f.lastRun || null;
    if (m.kind === 'daemon' && f.unitState === 'active') {
      const t0 = Date.now();
      const r = await callSocket(socketOf(m), 'GET', '/v1/health', undefined, m.health.timeoutMs);
      const err = H.toHostError(r, { service: m.id });
      health = err ? { ok: false, at: now(), message: err.message, code: r.error ? 'host_service_down' : err.code } : { ok: r.body?.ok !== false, at: now(), message: r.body?.message || '', latencyMs: Date.now() - t0 };
      if (!err && r.body?.lastRun) lastRun = r.body.lastRun;
    }
    const { lastRun: _sysRun, loaded: _loaded, ...unitOnly } = f;
    const st = H.serviceState(m, { ...unitOnly, timerState: timer?.unitState, health, lastRun, mode: H.modeOf(modeState, m.id) }, prev, now());
    return { ...st, heartbeat: readJson(dataPath(`${m.dataDir}/heartbeat.json`), null) };
  }
  async function states() {
    const prev = new Map((readJson(prevFile, []) || []).map((s) => [s.id, s]));
    const out = [];
    for (const m of set.manifests) out.push(await stateOf(m, prev.get(m.id) || null));
    for (const b of set.bad || []) if (b.id) out.push({ ...H.serviceState({ $axf: H.MANIFEST_FRAME, id: b.id, title: b.id, kind: 'daemon', unit: `axf-${b.id}.service`, plugin: 'console', runner: 'invalid' }, { manifestError: b.error, mode: 'host' }, prev.get(b.id) || null, now()) });
    try { writeJson(prevFile, out.map(({ id, status, since, restarts, mode }) => ({ id, status, since, restarts, mode }))); } catch (e) { log('warn', 'states not saved', { error: String(e?.message || e) }); }
    return out;
  }
  async function unitVerb(m, verb) {
    if (!H.UNIT_ACTIONS.includes(verb)) throw new H.HostServiceError('unknown_action', `unit verb ${verb}`, { service: m.id });
    const errs = H.actionCallErrors(m, verb); if (errs.length) throw errs[0];
    const unit = verb === 'start' && m.kind === 'tick' ? m.timer : m.unit;
    const r = await sudo([SYSTEMCTL_ROOT, verb === 'run' ? 'start' : verb, unit], { timeoutMs: 60000 });
    if (!r.ok) throw new H.HostServiceError('internal', `systemctl ${verb} ${unit}: ${(r.stderr || r.error).trim().slice(0, 300)}`, { service: m.id, unit });
    return { ok: true, unit, state: (await facts(unit)).unitState };
  }
  async function forward(m, method, path, body, timeoutMs) {
    if (m.kind !== 'daemon') throw new H.HostServiceError('unknown_action', `${m.id} is a tick: run it with unit/run`, { service: m.id });
    const r = await callSocket(socketOf(m), method, `/v1${path}`, body, timeoutMs);
    if (r.error) throw new H.HostServiceError('host_service_down', `${m.id} does not answer on ${socketOf(m)}: ${r.error.code || r.error.message}`, { service: m.id });
    const err = H.toHostError(r, { service: m.id });
    if (err) throw err;
    return r.body;
  }
  async function logs(m, lines = 200) {
    const n = Math.min(H.LIMITS.logLinesMax, Math.max(1, Number(lines) || 200));
    if (m.cron) {
      let text = '';
      try { const size = statSync(m.log).size; const fd = openSync(m.log, 'r'); const len = Math.min(size, 256 * 1024); const buf = Buffer.alloc(len); readSync(fd, buf, 0, len, size - len); closeSync(fd); text = buf.toString('utf8'); } catch { /* no log yet */ }
      return { lines: text.split('\n').filter(Boolean).slice(-n).map((line) => ({ at: '', line })) };
    }
    let r = await exec(JOURNALCTL, ['-u', m.unit, '-n', String(n), '-o', 'short-iso', '--no-pager'], { timeoutMs: 10000 });
    if (!r.ok) r = await sudo([JOURNALCTL_ROOT, '-u', m.unit, '-n', '500', '-o', 'short-iso', '--no-pager'], { timeoutMs: 10000 }); // fixed form: the whitelist has no wildcard arguments
    return { lines: r.stdout.split('\n').filter((l) => l && !l.startsWith('-- ')).map((l) => { const i = l.indexOf(' '); return { at: l.slice(0, i), line: l.slice(i + 1) }; }) };
  }
  async function setMode(id, body) {
    const to = body.to;
    const m = find(id);
    const cur = readModeState();
    const st = await stateOf(m, null);
    const f = await facts(m.unit);
    const { state, changes } = H.changeMode(cur, set.manifests, { id, to, at: now(), by: body.by || 'svc:host-api', why: body.why || body.reason?.title || '', ctx: { state: st, unitInstalled: f.loaded !== false, hostApiUp: true, acceptDrift: body.acceptDrift, ...guardOverrides() } });
    writeJson(MODE_FILE(), state);
    record({ service: id, kind: 'mode', changes, by: body.by || '', reason: body.reason || null });
    // Units follow the mode: shadow and host run the unit, container stops it.
    const plan = H.modePlan(m, to);
    if (plan.unitEnabled) await sudo([SYSTEMCTL_ROOT, 'start', m.kind === 'tick' ? m.timer : m.unit], { timeoutMs: 60000 }).catch(() => null);
    else await sudo([SYSTEMCTL_ROOT, 'stop', m.unit], { timeoutMs: 60000 }).catch(() => null);
    return { ok: true, mode: H.modeOf(state, id), changes };
  }
  async function rollback(id, body) {
    const m = find(id);
    if (m.adopted) throw new H.HostServiceError('unknown_action', `${m.id} is adopted: it already runs on the host, there is no console copy to roll back to`, { service: m.id, action: 'rollback' });
    const to = body.to === 'shadow' ? 'shadow' : 'container';
    const plan = H.rollbackSteps(m, { to, by: body.by || 'svc:host-api', why: body.why || '' });
    const cur = readModeState();
    const done = [];
    if (H.modeOf(cur, id) === 'host' || (to === 'container' && H.modeOf(cur, id) === 'shadow')) {
      const { state, changes } = H.changeMode(cur, set.manifests, { id, to, at: now(), by: body.by || 'svc:host-api', why: body.why || '' });
      writeJson(MODE_FILE(), state); done.push({ step: 1, do: 'mode', ok: true, changes });
    } else done.push({ step: 1, do: 'mode', ok: true, note: `already ${H.modeOf(cur, id)}` });
    if (to === 'container') {
      const steps = m.kind === 'tick' ? [[SYSTEMCTL_ROOT, 'stop', m.timer], [SYSTEMCTL_ROOT, 'stop', m.unit]] : [[SYSTEMCTL_ROOT, 'stop', m.unit]];
      for (const s of steps) { const r = await sudo(s, { timeoutMs: 60000 }).catch((e) => ({ ok: false, stderr: e.message })); done.push({ step: 2, do: 'unit', cmd: s.join(' '), ok: r.ok, error: r.ok ? '' : (r.stderr || '').trim().slice(0, 200) }); }
    }
    record({ service: id, kind: 'rollback', to, by: body.by || '', why: body.why || '', reason: body.reason || null });
    return { ok: done.every((d) => d.ok), to, steps: done, plan: plan.steps };
  }
  function shadowLog(m) {
    const lines = (() => { try { return readFileSync(dataPath(`${m.dataDir}/shadow.jsonl`), 'utf8').split('\n').filter(Boolean).slice(-200).map((l) => JSON.parse(l)); } catch { return []; } })();
    return { runs: lines.filter((l) => l.side), drift: lines.filter((l) => l.$axf === H.DRIFT_FRAME) };
  }
  function shadowReport(m, body) {
    const host = readJson(dataPath(`${m.dataDir}/state.json`), null);
    const container = { at: body.at || now(), result: body.result, effects: body.effects || [], ...(body.error ? { error: body.error } : {}) };
    appendLine(dataPath(`${m.dataDir}/shadow.jsonl`), { side: 'container', ...container });
    const hostRun = host && host.mode === 'shadow' ? host : null;
    const drift = H.shadowDrift(m.id, hostRun, container, now());
    if (drift) {
      appendLine(dataPath(`${m.dataDir}/shadow.jsonl`), drift);
      writeJson(MODE_FILE(), H.recordShadowRun(readModeState(), m.id, { at: now(), drift })); // clean runs are counted by the host runner itself
    }
    return { ok: true, drift };
  }

  async function handle(req, res, isLoopback) {
    const requestId = randomUUID().slice(0, 8);
    try {
      const url = new URL(req.url, 'http://local');
      const p = url.pathname;
      if (req.method === 'GET' && (p === '/v1/health' || p === '/health')) return send(res, 200, { ok: true, service: H.DEFAULTS.hostApiId, at: now(), version: VERSION, services: set.manifests.length, errors: set.errors.length });
      if (!authOk(req, isLoopback)) throw new H.HostServiceError('unauthorized', 'bearer token required on loopback', { service: H.DEFAULTS.hostApiId });
      if (!p.startsWith('/v1/')) throw new H.HostServiceError('unknown_action', `no route ${p}`);
      const parts = p.slice(4).split('/').filter(Boolean);
      const M = req.method;
      if (M === 'GET' && parts.length === 1 && parts[0] === 'services') { const st = await states(); return send(res, 200, { $axf: H.LIST_FRAME, at: now(), services: st.map((s) => ({ ...s, manifest: set.manifests.find((m) => m.id === s.id) || null })), errors: set.errors }); }
      if (M === 'GET' && parts.length === 1 && parts[0] === 'mode') return send(res, 200, readModeState());
      if (M === 'POST' && parts.length === 1 && parts[0] === 'reload') { set = manifestsFn(); return send(res, 200, { ok: true, services: set.manifests.length, errors: set.errors }); }
      if (parts[0] !== 'services' || !parts[1]) throw new H.HostServiceError('unknown_action', `no route ${M} ${p}`);
      const m = find(parts[1]);
      const rest = parts.slice(2);
      const sub = rest[0] || '';
      if (M === 'GET' && !sub) { const prev = (readJson(prevFile, []) || []).find((s) => s.id === m.id) || null; return send(res, 200, { ...(await stateOf(m, prev)), manifest: m }); }
      if (M === 'GET' && sub === 'health') return send(res, 200, m.kind === 'daemon' && m.id !== H.DEFAULTS.hostApiId ? await forward(m, 'GET', '/health', undefined, m.health.timeoutMs) : { ok: true, lastRun: readJson(dataPath(`${m.dataDir}/state.json`), null) });
      if (M === 'POST' && sub === 'unit' && rest[1]) { const b = await readBody(req); const out = await unitVerb(m, rest[1]); record({ service: m.id, kind: 'unit', verb: rest[1], by: b.by || '', reason: b.reason || null }); return send(res, 200, out); }
      if (M === 'POST' && sub === 'actions' && rest[1]) {
        const b = await readBody(req);
        if (m.id === H.DEFAULTS.hostApiId && rest[1] === 'reload') { set = manifestsFn(); return send(res, 200, { ok: true, result: { services: set.manifests.length, errors: set.errors }, at: now(), durationMs: 0 }); }
        const errs = H.actionCallErrors(m, rest[1], { args: b.args || {}, confirm: b.confirm ? 'yes' : '', mode: H.modeOf(readModeState(), m.id) });
        if (errs.length) throw errs[0];
        const a = m.actions.find((x) => x.id === rest[1]);
        return send(res, 200, await forward(m, 'POST', `/actions/${rest[1]}`, b, (a?.timeoutMs || 60000) + 2000));
      }
      if (sub === 'settings' && M === 'GET') return send(res, 200, { settings: settingsOf(m), declared: m.settings });
      if (sub === 'settings' && M === 'PUT') { const b = await readBody(req); const s = putSettings(m, b.set); record({ service: m.id, kind: 'settings', keys: Object.keys(b.set || {}), by: b.by || '', reason: b.reason || null }); return send(res, 200, { ok: true, settings: s }); }
      if (sub === 'logs' && M === 'GET') return send(res, 200, await logs(m, url.searchParams.get('lines')));
      if (sub === 'mode' && M === 'GET') { const st = readModeState(); return send(res, 200, { id: m.id, mode: H.modeOf(st, m.id), entry: st.services[m.id] || null, plan: H.modePlan(m, H.modeOf(st, m.id)) }); }
      if (sub === 'mode' && M === 'PUT') return send(res, 200, await setMode(m.id, await readBody(req)));
      if (sub === 'shadow' && M === 'GET') return send(res, 200, shadowLog(m));
      if (sub === 'shadow' && M === 'POST') return send(res, 200, shadowReport(m, await readBody(req)));
      if (sub === 'rollback' && M === 'POST') return send(res, 200, await rollback(m.id, await readBody(req)));
      throw new H.HostServiceError('unknown_action', `no route ${M} ${p}`, { service: m.id });
    } catch (e) { sendError(res, e, requestId); }
  }
  return { handle, states, reload: () => { set = manifestsFn(); return set; }, get set() { return set; } };
}

async function serveHostApi(m) {
  const api = makeHostApi(m);
  const socket = process.env.AXF_HOST_SOCKET_DIR ? join(SOCKET_DIR, 'api.sock') : m.socket;
  const servers = [];
  const sock = createServer((req, res) => api.handle(req, res, false));
  await listen(sock, { socket }); servers.push(sock);
  const port = Number(process.env.AXF_HOST_PORT || H.DEFAULTS.loopbackPort);
  const hosts = [H.DEFAULTS.loopbackHost, ...String(process.env.AXF_HOST_BIND || '').split(',').map((s) => s.trim()).filter(Boolean)];
  for (const host of hosts) {
    const s = createServer((req, res) => api.handle(req, res, true));
    try { await listen(s, { host, port }); servers.push(s); } catch (e) { log('warn', 'loopback listener not started', { host, port, error: String(e?.message || e) }); }
  }
  if (!TOKEN) log('warn', `${H.DEFAULTS.envToken} is not set: the loopback listener refuses every call but /v1/health`);
  log('info', 'started', { socket, port, hosts, services: api.set.manifests.length, errors: api.set.errors });
  const hb = setInterval(() => { try { heartbeat(m); } catch { /* data dir not writable yet */ } }, 30000);
  try { heartbeat(m, { started: true }); } catch { /* logged below on first failure */ }
  process.on('SIGHUP', () => { const s = api.reload(); log('info', 'manifests reloaded', { services: s.manifests.length, errors: s.errors }); });
  const stop = (sig) => { clearInterval(hb); log('info', 'stopping', { signal: sig }); for (const s of servers) s.close(); try { unlinkSync(socket); } catch { /* gone */ } process.exit(0); };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  return { manifest: m, servers, api, stop };
}

// ------------------------------------------------------------------ CLI

async function main(argv) {
  const args = argv.slice(2);
  if (args[0] === '--check' || args[0] === 'check') {
    const { manifests, errors } = loadManifests();
    const out = [];
    for (const m of manifests) {
      let worker = 'ok';
      if (m.adopted) { out.push({ id: m.id, kind: m.kind, unit: m.unit, plugin: m.plugin, runner: m.runner, worker: 'adopted' }); continue; }
      try { const w = await loadWorker(m); for (const a of m.actions) if (m.id !== H.DEFAULTS.hostApiId && typeof w.actions?.[a.id] !== 'function') { worker = `no action ${a.id}`; errors.push(`${m.id}: worker has no action ${a.id}`); } } catch (e) { worker = e.message; errors.push(e.message); }
      out.push({ id: m.id, kind: m.kind, unit: m.unit, plugin: m.plugin, runner: m.runner, worker });
    }
    console.log(JSON.stringify({ ok: !errors.length, services: out, errors }, null, 2));
    process.exit(errors.length ? 1 : 0);
  }
  if (args[0] === '--plan') {
    // The installer's view: one tab-separated line per service: id, unit, NoNewPrivileges (yes = no sudo lines),
    // render (yes = the unit comes from axf-host@.service; adopted = its own installer owns it, nothing to install), kind.
    const { manifests, errors } = loadManifests();
    if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
    const only = args[1] ? new Set(['host-api', ...args[1].split(',').filter(Boolean)]) : null;
    if (only) for (const x of only) if (!manifests.some((m) => m.id === x)) { console.error(`unknown service ${x}`); process.exit(1); }
    const order = H.cutoverOrder(manifests).map((r) => r.id);
    for (const id of order) {
      const m = manifests.find((x) => x.id === id);
      if (only && !only.has(m.id)) continue;
      const render = m.kind === 'daemon' && (m.id === H.DEFAULTS.hostApiId || m.runner.startsWith('deploy/host-services/workers/'));
      console.log([m.id, m.unit, m.sudo.length ? 'no' : 'yes', m.adopted ? 'adopted' : render ? 'yes' : 'no', m.kind].join('\t'));
    }
    return;
  }
  const id = args[0];
  if (!id || !new RegExp(H.ID_PATTERN).test(id)) { console.error('usage: axf-hostd.mjs <id> [--once | action <action> [--args json] [--confirm]] | --check'); process.exit(2); }
  if (args[1] === '--once' || args[1] === 'action') {
    const { manifests } = loadManifests();
    const m = manifests.find((x) => x.id === id);
    if (!m) { console.error(`unknown_service: ${id}`); process.exit(2); }
    LOG_ID = m.id;
    const w = await loadWorker(m);
    try {
      if (args[1] === '--once') { console.log(JSON.stringify(await tickOnce(m, w))); return; }
      const ai = args.indexOf('--args');
      console.log(JSON.stringify(await runAction(m, w, args[2], { args: ai > 0 ? JSON.parse(args[ai + 1]) : {}, confirm: args.includes('--confirm'), by: 'svc:cli' })));
    } catch (e) { const a = H.consoleAnswer(e); console.error(a.cli.line); process.exit(a.cli.exit); }
    return;
  }
  try { await serveService(id); } catch (e) { log('error', 'cannot start', { error: String(e?.message || e), code: e?.code }); process.exit(1); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv);

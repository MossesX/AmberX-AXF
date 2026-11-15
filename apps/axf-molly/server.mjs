#!/usr/bin/env node
/**
 * server.mjs — the AXF Molly container's process (axf-molly@1): one HTTP API on the internal Docker network and the job
 * loop that runs the orchestrator's dispatcher tick, the reconciler, the auto-lander / merge queue and the Shipped
 * features sender. No UI: the console's screens, axHub's tools, the CLI and voice all call the same /v1 routes
 * (framework/core/axf-molly.mjs TOOLS).
 *
 *   GET  /v1/health                   no token: { ok, side, owner, acting, uptimeMs }
 *   GET|POST /v1/<tool path>          Bearer AXF_MOLLY_TOKEN; a POST body carries the tool's named arguments and, for a
 *                                     change, `reason: { title, description }` (axHub's rule; recorded in the job log)
 *   answers { ok, tool, result } or { ok: false, error, code }
 *
 * The loop (CADENCE): tick every minute, lander every 3 minutes, reconcile every 10 minutes, lease renewal every minute.
 * While the console side owns the lease (shadow) every job runs its dry form and the difference to what the console side
 * did is appended to the shadow log; once axf-molly owns (cutover) the jobs act and the lease is renewed each minute. A
 * container that dies stops renewing: the lease expires and the host crons act again by themselves.
 *
 * Env: AXF_MOLLY_TOKEN (required unless AXF_MOLLY_TOKEN_FILE), PORT (7510), AXF_MOLLY_SIDE=axf-molly (set by the image),
 * AXF_MOLLY_LOOP=off (API only: tests), AXF_MOLLY_BRIDGE (socket path), AXF_CONSOLE_URL (+ AXF_TOKEN: alerts to the
 * console over the network), AXF_DATA_URL (+ AXF_DATA_TOKEN: the lease and shadow log through axf-data).
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../../framework/core/axf-molly.mjs';
import * as molly from './molly.mjs';

const nowIso = () => new Date().toISOString();
const str = (v, max = 600) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const STARTED = Date.now();
const VERSION = (() => { try { return JSON.parse(readFileSync(join(molly.REPO_ROOT, 'apps/axf-molly/package.json'), 'utf8')).version || ''; } catch { return ''; } })();

function tokenOf(env = process.env) {
  if (env.AXF_MOLLY_TOKEN) return env.AXF_MOLLY_TOKEN;
  if (env.AXF_MOLLY_TOKEN_FILE && existsSync(env.AXF_MOLLY_TOKEN_FILE)) return readFileSync(env.AXF_MOLLY_TOKEN_FILE, 'utf8').trim();
  return '';
}

// ------------------------------------------------------------------ the API

function readBody(req) {
  return new Promise((res, rej) => {
    let data = ''; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 1_000_000) { rej(Object.assign(new Error('body too large'), { code: 413 })); req.destroy(); return; } data += c; });
    req.on('end', () => { if (!data.trim()) return res({}); try { res(JSON.parse(data)); } catch { rej(Object.assign(new Error('body is not JSON'), { code: 400 })); } });
    req.on('error', rej);
  });
}

export function handle({ method, path, headers = {}, body = {}, env = process.env, run = molly.runTool }) {
  if (method === 'GET' && path.replace(/\?.*$/, '') === '/v1/health') { const s = molly.status(env); return { status: 200, json: { ok: true, $axf: 'molly-health@1', side: s.side, owner: s.owner, acting: s.acting, uptimeMs: Date.now() - STARTED, version: VERSION } }; }
  const want = tokenOf(env);
  const given = str(headers.authorization || headers.Authorization, 400).replace(/^Bearer\s+/i, '');
  if (!want || given !== want) return { status: 401, json: { ok: false, error: want ? 'bad token' : 'the container has no AXF_MOLLY_TOKEN', code: 401 } };
  const r = M.routeTool(method, path);
  if (!r) return { status: 404, json: { ok: false, error: `no tool at ${method} ${path.replace(/\?.*$/, '')}`, code: 404 } };
  const t = M.toolFor(r.tool);
  const query = Object.fromEntries(new URL(`http://x${path}`).searchParams.entries());
  const params = { ...query, ...(body && typeof body === 'object' ? body : {}), ...r.params };
  const reason = params.reason && typeof params.reason === 'object' ? params.reason : null;
  delete params.reason;
  if (t.mutates && reason === null && env.AXF_MOLLY_REASON === 'required') return { status: 400, json: { ok: false, error: 'a change carries reason: { title, description }', code: 400 } };
  const by = str(headers['x-axf-actor'] || headers['X-Axf-Actor'], 80) || 'api';
  const result = run(r.tool, { ...params, ...(reason && t.cli[0] === 'molly' && !params.reason ? { reason: reason.description || reason.title } : {}) }, { env, by });
  if (result?.ok === false) return { status: result.code === 409 ? 409 : result.code === 2 ? 400 : 500, json: { ok: false, tool: r.tool, error: result.error || 'failed', code: result.code || 500 } };
  return { status: 200, json: { ok: true, tool: r.tool, result } };
}

export function serve({ port = Number(process.env.PORT) || M.PORT, env = process.env } = {}) {
  const server = createServer(async (req, res) => {
    const send = (status, json) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(`${JSON.stringify(json)}\n`); };
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const r = handle({ method: req.method, path: req.url || '/', headers: req.headers, body, env });
      send(r.status, r.json);
    } catch (e) { send(e.code === 413 ? 413 : e.code === 400 ? 400 : 500, { ok: false, error: str(e.message, 400), code: e.code || 500 }); }
  });
  server.listen(port, '0.0.0.0');
  return server;
}

// ------------------------------------------------------------------ the loop

const jobs = { tick: { at: '', line: '' }, lander: { at: '', line: '' }, reconcile: { at: '', line: '' }, lease: { at: '', line: '' } };
const busy = new Set();
const log = (o) => console.log(JSON.stringify({ at: nowIso(), ...o }));

function record(name, { ok, line = '', error = '', extra = {} }) { jobs[name] = { at: nowIso(), ok, line: str(line, 300), ...(error ? { error: str(error, 300) } : {}), ...extra }; molly.writeStatus({ jobs, version: VERSION, bridge: { socket: process.env.AXF_MOLLY_BRIDGE || M.BRIDGE_SOCKET, ok: bridgeOk } }); log({ job: name, ok, line: str(line, 300), ...(error ? { error: str(error, 300) } : {}) }); }

let bridgeOk = null;
async function pingBridge() {
  try { const { bridge } = await import('./bridge-client.mjs'); const r = await bridge('bridge.ping', [], { timeout: 5000 }); bridgeOk = !!r.ok; } catch { bridgeOk = false; }
}

/** The dispatcher: a real tick when axf-molly owns, else a shadow tick compared with the console side's last state. */
function jobTick(env) {
  if (molly.acts(env)) {
    const r = molly.runTool('orchestrator.tick', {}, { env, by: 'molly' });
    return record('tick', { ok: r.ok !== false, line: r.ok === false ? '' : `launched ${(r.launched ?? []).map((l) => l.id).join(', ') || 'none'} · ended ${(r.ended ?? []).map((e) => `${e.id} ${e.outcome}`).join(', ') || 'none'}`, error: r.error });
  }
  // force passes this process's own gate; pipeline.mjs tick() sees the lease and runs its shadow form (plan only, no writes)
  const mine = molly.runTool('orchestrator.tick', { force: true }, { env, by: 'molly' });
  const theirs = molly.readJson(join(molly.pipeDir(env), 'state.json'), {}) ?? {};
  if (mine.ok === false) return record('tick', { ok: false, error: mine.error });
  const d = M.diffPlans(mine.plan ?? {}, theirs.plan ?? {});
  molly.shadowLog(M.diffEntry('tick', { diffs: d.diffs, mine: { launches: (mine.plan?.launches ?? []).length, waits: (mine.plan?.waits ?? []).length, queue: (mine.plan?.queue ?? []).length }, theirs: { at: theirs.at || '', launches: (theirs.plan?.launches ?? []).length, waits: (theirs.plan?.waits ?? []).length, queue: (theirs.plan?.queue ?? []).length } }), env);
  return record('tick', { ok: true, line: `shadow: ${d.same ? 'same plan as the console side' : `${d.diffs.length} difference(s)`}` });
}

/** The lander: one real round when axf-molly owns, else a dry round compared with the console side's land.json. */
function jobLander(env) {
  if (molly.acts(env)) {
    const r = molly.runTool('lander.run', {}, { env, by: 'molly' });
    return record('lander', { ok: r.ok !== false, line: r.ok === false ? '' : `${(r.items ?? []).length} candidate(s) · on ${r.on !== false}`, error: r.error });
  }
  const r = molly.runTool('lander.status', {}, { env, by: 'molly' });
  if (r.ok === false) return record('lander', { ok: false, error: r.error });
  const items = (r.items ?? []).map((i) => ({ id: i.build || i.id, state: `${i.state || ''}${i.reason ? `:${i.reason}` : ''}` }));
  molly.shadowLog(M.diffEntry('lander', { mine: { items: items.length, on: r.on }, theirs: { at: r.at || '' }, note: 'dry: the lander state as the console side wrote it (axf-molly runs the same round once it owns)' }), env);
  return record('lander', { ok: true, line: `shadow: ${items.length} waiting` });
}

/** The reconciler: GitHub's view into the store (apply when owner, dry otherwise). */
function jobReconcile(env) {
  const apply = molly.acts(env);
  const r = spawnSync(process.execPath, [join(molly.REPO_ROOT, 'framework/cli/builds-reconcile.mjs'), ...(apply ? ['--apply', '--brief'] : []), '--json'], { cwd: molly.REPO_ROOT, encoding: 'utf8', timeout: 300e3, env });
  let j = null; try { j = JSON.parse((r.stdout || '').trim().split('\n').filter(Boolean).at(-1) || 'null'); } catch { j = null; }
  if (r.status !== 0) return record('reconcile', { ok: false, error: (r.stderr || r.stdout || `exit ${r.status}`).trim().slice(-300) });
  const changes = Array.isArray(j?.changes) ? j.changes.length : Array.isArray(j?.plan) ? j.plan.length : 0;
  if (!apply) molly.shadowLog(M.diffEntry('reconcile', { mine: { changes }, note: 'dry run' }), env);
  return record('reconcile', { ok: true, line: `${apply ? 'applied' : 'dry'}: ${changes} change(s)` });
}
function jobLease(env) {
  const lease = molly.readLease(env);
  if (lease.mode === 'cutover' && lease.owner === 'axf-molly') {
    try { molly.setMode('renew', { env }); return record('lease', { ok: true, line: `renewed until ${molly.readLease(env).until}` }); }
    catch (e) { return record('lease', { ok: false, error: e.message }); }
  }
  return record('lease', { ok: true, line: `${M.leaseOwner(lease)} owns (${lease.mode})` });
}

function every(name, seconds, fn, env) {
  const run = () => { if (busy.has(name)) return; busy.add(name); try { fn(env); } catch (e) { record(name, { ok: false, error: e.message }); } finally { busy.delete(name); } };
  setTimeout(run, 3000 + Math.floor(Math.random() * 2000));
  return setInterval(run, seconds * 1000);
}

export async function loop({ env = process.env } = {}) {
  await pingBridge(); setInterval(pingBridge, 300e3);
  if (!existsSync(molly.files(env).lease)) molly.writeLease(M.initialLease(nowIso(), 'axf-molly'), env);
  every('tick', M.CADENCE.tick, jobTick, env);
  every('lander', M.CADENCE.lander, jobLander, env);
  every('reconcile', M.CADENCE.reconcile, jobReconcile, env);
  every('lease', M.CADENCE.lease, jobLease, env);
  log({ event: 'loop-started', side: molly.side(env), owner: molly.owner(env), bridge: bridgeOk, data: env.AXF_DATA_URL ? 'axf-data' : 'files' });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const env = process.env;
  if (env.AXF_MOLLY_SIDE !== 'axf-molly') console.error('warning: AXF_MOLLY_SIDE is not axf-molly; the lease gate treats this process as the console side');
  const server = serve({ env });
  log({ event: 'listening', port: Number(env.PORT) || M.PORT, version: VERSION });
  if (env.AXF_MOLLY_LOOP !== 'off') loop({ env }).catch((e) => { log({ event: 'loop-failed', error: e.message }); process.exitCode = 1; });
  const stop = () => { log({ event: 'stopping' }); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}

#!/usr/bin/env node
/**
 * molly.mjs — AXF Molly's CLI and library (axf-molly@1, framework/core/axf-molly.mjs; spec framework/spec/AXF-MOLLY.md).
 * Brett, Nov 15 2026: "Molly's gonna run the orchestrator from now on, so let's name it AXF Molly."
 *
 * The same commands run inside the container (apps/axf-molly/server.mjs calls runTool), on the VPS host (the crons gate
 * on `owner`), and from any checkout. Every tool in TOOLS is reachable here, over the container's HTTP API, through
 * axHub's `axf-molly.*` tools and by voice: one list, four doors.
 *
 *   node apps/axf-molly/molly.mjs status [--json]            who acts (console side or axf-molly), the lease, the shadow log, the jobs
 *   … owner [console|axf-molly]                               prints the owner; with a side, exit 0 when that side owns (the host crons gate on it)
 *   … cutover --reason "…" [--ttl <min>] [--by who]           axf-molly takes the work under a lease (undo at any time)
 *   … renew                                                   push the lease out again (the container does this every minute)
 *   … undo [--reason "…"] [--by who]                          back to shadow at once: the console side acts from the next tick
 *   … shadow [--tail n] [--json]                              the shadow diff log (molly-shadow-diff@1)
 *   … tool <name> [key=value…] [--json]                       run one tool by its name (orchestrator.queue id=my-build)
 *   … tools [--json]                                          every tool, its HTTP route and what it says
 *   … retire [--json]                                         what the old standalone Molly app left on this host (listed, never deleted)
 *   … axhub-service [--json]                                  the downstream record axHub registers (axhub-downstream@1)
 *   … drill [--json]                                          the console-down drill (apps/axf-molly/drill.mjs)
 *
 * Files: <pipeline dir>/molly/ (AXF_MOLLY_DIR): lease.json (molly-lease@1), shadow.jsonl (molly-shadow-diff@1), status.json.
 * The pipeline dir is the hub mount both the host and the containers see (pipeline.mjs pipeDir). When the data-store@1
 * client is present and AXF_DATA_URL is set, the lease and the shadow log go through axf-data (keys builds/molly/lease.json
 * and the journal builds/molly/shadow) and the files are a mirror.
 * Env: AXF_MOLLY_SIDE (console | axf-molly, which side this process is), AXF_MOLLY_URL (+ AXF_MOLLY_TOKEN: a CLI outside
 * the container talks to it over HTTP instead of running the tool locally), AXF_REPO_ROOT (the checkout the tools run in).
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../../framework/core/axf-molly.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = process.env.AXF_REPO_ROOT || resolve(HERE, '..', '..');
const PIPELINE = join(REPO_ROOT, 'apps/console-web/plugins/build-orchestrator/pipeline.mjs');
const ORCHESTRATOR = join(REPO_ROOT, 'apps/console-web/plugins/build-orchestrator/orchestrator.mjs');
const LAND = join(REPO_ROOT, 'apps/console-web/plugins/push-banner/land/land.mjs');
const MERGE_QUEUE = join(REPO_ROOT, 'apps/console-web/plugins/push-banner/land/merge-queue.mjs');
const SHIPPED = join(REPO_ROOT, 'framework/cli/shipped.mjs');
const RECONCILE = join(REPO_ROOT, 'framework/cli/builds-reconcile.mjs');
const GATE = join(REPO_ROOT, 'apps/console-web/plugins/gate-rules/gate.mjs');

const nowIso = () => new Date().toISOString();
const str = (v, max = 600) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
export const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
export function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(v, null, 1)}\n`); renameSync(tmp, f); }

// ------------------------------------------------------------------ where things are

export function pipeDir(env = process.env) {
  if (env.AXF_PIPELINE_DIR) return env.AXF_PIPELINE_DIR;
  const hub = join(env.AXHUB_PROJECTS_DIR || '/projects', 'amberx-axf', '_data');
  return existsSync(hub) ? join(hub, 'pipeline') : join(env.HOME || '/root', '.axf', 'pipeline');
}
export const mollyDir = (env = process.env) => env.AXF_MOLLY_DIR || join(pipeDir(env), 'molly');
export const files = (env = process.env) => { const d = mollyDir(env); return { dir: d, lease: join(d, 'lease.json'), shadow: join(d, 'shadow.jsonl'), status: join(d, 'status.json') }; };
export const side = (env = process.env) => (M.SIDES.includes(env.AXF_MOLLY_SIDE) ? env.AXF_MOLLY_SIDE : 'console');

// ------------------------------------------------------------------ the data store (data-store@1 when present)

let storePromise = null;
/** The data-store@1 client over axf-data when the module and AXF_DATA_URL exist; null = files only (today). */
export async function dataStore(env = process.env) {
  if (storePromise) return storePromise;
  storePromise = (async () => {
    if (!env.AXF_DATA_URL) return null;
    try {
      const ds = await import('../../framework/core/data-store.mjs');
      return ds.createDataStore({ backend: ds.httpBackend({ url: env.AXF_DATA_URL, token: () => env.AXF_DATA_TOKEN || '', actor: `svc:${M.SERVICE}` }), by: `svc:${M.SERVICE}` });
    } catch { return null; }
  })();
  return storePromise;
}
const LEASE_KEY = 'builds/molly/lease.json';
const SHADOW_KEY = 'builds/molly/shadow';

// ------------------------------------------------------------------ the lease

export function readLease(env = process.env) { return M.normLease(readJson(files(env).lease)); }
export function writeLease(lease, env = process.env) {
  writeJson(files(env).lease, lease);
  dataStore(env).then((ds) => ds && ds.update(LEASE_KEY, () => lease, { create: true }).catch(() => null));
  return lease;
}
export const owner = (env = process.env) => M.leaseOwner(readLease(env));
export const acts = (env = process.env, s = side(env)) => M.canAct(readLease(env), s);

export function setMode(action, { reason = '', by = process.env.AXF_ACTOR || 'cli', ttlMin = M.LEASE_TTL_MIN, env = process.env } = {}) {
  const at = nowIso(); const cur = readLease(env);
  const r = action === 'cutover' ? M.cutover(cur, { at, by, reason, ttlMin }) : action === 'undo' ? M.undo(cur, { at, by, reason: reason || 'undo' }) : action === 'renew' ? M.renew(cur, { at, ttlMin }) : { lease: cur, error: `unknown mode action ${action}` };
  if (r.error) throw Object.assign(new Error(r.error), { code: 2 });
  writeLease(r.lease, env);
  if (action !== 'renew') shadowLog(M.diffEntry('mode', { at, note: `${action} by ${by}: ${reason || '-'} → ${r.lease.owner} owns (${r.lease.mode})` }), env);
  return r.lease;
}

// ------------------------------------------------------------------ the shadow log

export function shadowLog(entry, env = process.env) {
  const f = files(env);
  try { mkdirSync(f.dir, { recursive: true }); appendFileSync(f.shadow, `${JSON.stringify(entry)}\n`); } catch { /* the log is a courtesy */ }
  dataStore(env).then((ds) => ds && ds.append(SHADOW_KEY, [entry]).catch(() => null));
  return entry;
}
export function readShadow({ tail = 200, env = process.env } = {}) {
  const text = existsSync(files(env).shadow) ? readFileSync(files(env).shadow, 'utf8') : '';
  const lines = text.split('\n').filter(Boolean);
  return lines.slice(-Math.max(1, Math.min(5000, tail))).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
export const shadowSummary = (env = process.env) => M.shadowSummary(readShadow({ tail: 2000, env }));

// ------------------------------------------------------------------ status

export function status(env = process.env) {
  const st = readJson(files(env).status, {}) ?? {};
  return M.statusFrame({ at: nowIso(), lease: readLease(env), side: side(env), shadow: shadowSummary(env), jobs: st.jobs ?? {}, data: { url: env.AXF_DATA_URL || '', mode: env.AXF_DATA_URL ? 'axf-data' : 'files', dir: files(env).dir }, bridge: st.bridge ?? { socket: env.AXF_MOLLY_BRIDGE || M.BRIDGE_SOCKET }, version: st.version || '' });
}
export function writeStatus(patch, env = process.env) { const cur = readJson(files(env).status, {}) ?? {}; const next = { ...cur, ...patch, at: nowIso() }; writeJson(files(env).status, next); return next; }

// ------------------------------------------------------------------ tools

const SCRIPTS = { pipeline: PIPELINE, orchestrator: ORCHESTRATOR, land: LAND, 'merge-queue': MERGE_QUEUE, shipped: SHIPPED, reconcile: RECONCILE, gate: GATE };
/** Named arguments that travel as --flags; everything else is positional in the tool's `args` order. */
const FLAGS = new Set(['detail', 'said', 'priority', 'why', 'provider', 'reason', 'since', 'q', 'max', 'source', 'enabled', 'severity', 'settings', 'tail', 'ttlMin', 'by']);
const BOOL_FLAGS = new Set(['queue']);

/** The argv for one tool: `cli` + positionals + flags. orchestrator.request takes `route` as a flag; orchestrator.route takes it positionally. */
export function cliArgs(name, params = {}) {
  const t = M.toolFor(name);
  if (!t) throw Object.assign(new Error(`unknown tool ${name}`), { code: 2 });
  const [, ...rest] = t.cli;
  const pos = []; const flags = [];
  for (const a of t.args) {
    const key = a.replace(/\?$/, ''); const v = params[key];
    if (v == null || v === '') { if (!a.endsWith('?')) throw Object.assign(new Error(`${name}: missing ${key}`), { code: 2 }); continue; }
    if (BOOL_FLAGS.has(key)) { if (v === true || v === 'true' || v === 'on' || v === '1') flags.push(`--${key}`); continue; }
    if (FLAGS.has(key) || (key === 'route' && name === 'orchestrator.request') || (key === 'title' && name === 'orchestrator.request')) flags.push(`--${key === 'ttlMin' ? 'ttl' : key}`, typeof v === 'object' ? JSON.stringify(v) : String(v));
    else pos.push(String(v));
  }
  return [...rest, ...pos, ...flags];
}

/** Run one tool here (the container, or a checkout on the host). Returns the tool's JSON answer. */
export function runTool(name, params = {}, { env = process.env, by = env.AXF_ACTOR || 'molly', timeout = 600e3 } = {}) {
  const t = M.toolFor(name);
  if (!t) return { ok: false, error: `unknown tool ${name}`, code: 2 };
  const s = side(env);
  if (t.exclusive && !acts(env, s) && params.force !== true) return { ok: false, error: `refused: ${M.actingWhy(readLease(env), s)}`, code: 409 };
  if (t.cli[0] === 'molly') return runOwn(name, params, { env, by });
  if (t.cli[0] === 'gate' && !existsSync(GATE)) return gateFallback(name, params, env);
  const script = SCRIPTS[t.cli[0]];
  const args = cliArgs(name, params);
  const r = spawnSync(process.execPath, [script, ...args, '--json'], { cwd: REPO_ROOT, encoding: 'utf8', timeout, env: { ...env, AXF_ACTOR: by } });
  const out = (r.stdout || '').trim().split('\n').filter(Boolean);
  let res;
  try { res = JSON.parse(out.at(-1) || ''); } catch { res = { ok: r.status === 0, text: (r.stdout || '').trim().slice(-2000), error: r.status === 0 ? '' : (r.stderr || r.stdout || `exit ${r.status}`).trim().slice(-600) }; }
  if (r.status !== 0 && res.ok !== false) res = { ...res, ok: false, error: res.error || (r.stderr || '').trim().slice(-600) || `exit ${r.status}` };
  return res;
}

function runOwn(name, params, { env, by }) {
  switch (name) {
    case 'molly.status': return { ok: true, ...status(env) };
    case 'molly.shadow': return { ok: true, entries: readShadow({ tail: Number(params.tail) || 100, env }), summary: shadowSummary(env) };
    case 'molly.cutover': return { ok: true, lease: setMode('cutover', { reason: str(params.reason), by, ttlMin: Number(params.ttlMin) || M.LEASE_TTL_MIN, env }) };
    case 'molly.undo': return { ok: true, lease: setMode('undo', { reason: str(params.reason), by, env }) };
    case 'molly.renew': return { ok: true, lease: setMode('renew', { env }) };
    default: return { ok: false, error: `unknown tool ${name}`, code: 2 };
  }
}

/**
 * Gate tools before the gate plugin (gate-rules-plugin-in-the-console) lands: the rule set is read from the lander's
 * config (push banner config.json) through framework/core/gate-rules.mjs `migrate` when that engine is present, else
 * the raw switches; `gate.set` writes the one switch it knows today (the merge queue on/off).
 */
function gateFallback(name, params, env) {
  const cfgFile = join(env.AXF_PUSH_BANNER_DIR || join(env.AXF_CONSOLE_ROOT || REPO_ROOT, '.axf-console/plugins/push-banner'), 'config.json');
  const cfg = readJson(cfgFile, {}) ?? {};
  if (name === 'gate.rules') return { ok: true, source: 'push-banner-config@1', rules: [{ id: 'merge-queue', kind: 'custom', enabled: cfg.mergeQueue !== false, severity: 'block', settings: { mode: cfg.queueMode || 'batch', batchSize: cfg.batchSize ?? 8 }, owner: 'console' }, { id: 'ui-review', kind: 'ui-review', enabled: cfg.landWaitUi !== false, severity: 'block', owner: 'console' }, { id: 'auto-land', kind: 'custom', enabled: cfg.autoLand === true, severity: 'info', owner: 'console' }] };
  if (name === 'gate.state') return runTool('lander.status', {}, { env });
  if (name === 'gate.set') {
    if (params.rule === 'merge-queue' && params.enabled != null) return runTool(['true', 'on', '1', true].includes(params.enabled) ? 'lander.on' : 'lander.off', {}, { env });
    return { ok: false, error: `gate.set: rule "${params.rule}" is not settable until the gate plugin lands (only merge-queue on/off today)`, code: 2 };
  }
  return { ok: false, error: `unknown tool ${name}`, code: 2 };
}

/** A tool over the container's HTTP API (a CLI outside the container with AXF_MOLLY_URL). */
export async function callTool(name, params = {}, { env = process.env } = {}) {
  const t = M.toolFor(name);
  if (!t) return { ok: false, error: `unknown tool ${name}`, code: 2 };
  let path = t.path;
  const body = {};
  for (const [k, v] of Object.entries(params)) { if (path.includes(`{${k}}`)) path = path.replace(`{${k}}`, encodeURIComponent(String(v))); else body[k] = v; }
  const url = `${env.AXF_MOLLY_URL.replace(/\/$/, '')}/v1${path}${t.method === 'GET' && Object.keys(body).length ? `?${new URLSearchParams(Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)])))}` : ''}`;
  const r = await fetch(url, { method: t.method, headers: { Authorization: `Bearer ${env.AXF_MOLLY_TOKEN || ''}`, 'Content-Type': 'application/json' }, body: t.method === 'POST' ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({ ok: false, error: `axf-molly answered ${r.status}` }));
  return j.result && j.ok !== undefined ? { ok: j.ok, ...j.result } : j;
}

// ------------------------------------------------------------------ the old standalone Molly app (retirement list)

export function retireList(env = process.env) {
  const sh = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 20e3 }); return r.status === 0 ? (r.stdout || '').trim() : ''; };
  const containers = sh('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Image}}\t{{.Status}}']).split('\n').filter((l) => /^molly\t/.test(l)).map((l) => l.replace(/\t/g, ' '));
  const images = sh('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}']).split('\n').filter((l) => l === M.OLD_MOLLY.image);
  const found = { containers, images, crons: existsSync(M.OLD_MOLLY.cron) ? [M.OLD_MOLLY.cron] : [], files: existsSync(M.OLD_MOLLY.script) ? [M.OLD_MOLLY.script] : [], dirs: existsSync(M.OLD_MOLLY.dir) ? [M.OLD_MOLLY.dir] : [], domains: containers.length ? [`${M.OLD_MOLLY.domain} (Traefik router on the molly container)`] : [] };
  const names = sh('docker', ['ps', '-a', '--format', '{{.Names}}']).split('\n').filter(Boolean);
  return { clash: M.nameClash(names), found, lines: M.retirementList(found), app: `${M.OLD_MOLLY.app} (the standalone app in this repo; retire with its Dockerfile once the domain is gone)`, note: 'Listed for retirement. Nothing here is deleted by code: Brett decides, then `docker rm molly`, `docker rmi molly:latest`, remove the cron and script, archive /opt/molly, drop the domain in Coolify.' };
}

// ------------------------------------------------------------------ CLI

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const flag = (n, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const [cmd = 'status', ...rest] = args;
  const by = flag('by', process.env.AXF_ACTOR || 'cli');
  if (cmd === 'status') {
    const s = status();
    return out({ ok: true, ...s }, [`AXF Molly · ${s.at} · this side: ${s.side} · owner: ${s.owner} · ${s.acting ? 'acting' : 'computing only'}`, `  ${s.why}`, `  lease rev ${s.lease.rev} · ${s.lease.mode}${s.lease.until ? ` until ${s.lease.until}` : ''} · by ${s.lease.by || '-'}: ${s.lease.reason || '-'}`,
      `  shadow log: ${s.shadow.lines} lines, ${s.shadow.differing} differ, clean for ${s.shadow.cleanForMin} min${s.shadow.readyForCutover ? ' · ready for cutover' : ''}`, `  data: ${s.data.mode}${s.data.url ? ` ${s.data.url}` : ''} · ${s.data.dir}`,
      ...Object.entries(s.jobs).map(([k, v]) => `  job ${k}: ${v.at || '-'} ${v.ok === false ? `FAILED ${v.error || ''}` : v.line || ''}`)].join('\n'));
  }
  if (cmd === 'owner') {
    const o = owner();
    if (rest[0]) { if (!M.SIDES.includes(rest[0])) throw Object.assign(new Error(`side is one of ${M.SIDES.join(', ')}`), { code: 2 }); process.exitCode = o === rest[0] ? 0 : 3; }
    return out({ ok: true, owner: o, side: side(), acts: acts() }, o);
  }
  if (cmd === 'cutover' || cmd === 'undo' || cmd === 'renew') {
    const lease = setMode(cmd, { reason: flag('reason'), by, ttlMin: Number(flag('ttl')) || M.LEASE_TTL_MIN });
    return out({ ok: true, lease }, `${cmd}: ${lease.owner} owns (${lease.mode}${lease.until ? ` until ${lease.until}` : ''})`);
  }
  if (cmd === 'shadow') { const entries = readShadow({ tail: Number(flag('tail')) || 50 }); return out({ ok: true, entries, summary: shadowSummary() }, entries.map((e) => `${e.at} ${e.kind} ${e.same ? 'same' : `${e.count} differ`}${e.note ? ` · ${e.note}` : ''}${e.diffs?.length ? `\n${e.diffs.map((d) => `    ${d.what} ${d.id}: mine ${d.mine} · theirs ${d.theirs}`).join('\n')}` : ''}`).join('\n') || 'empty'); }
  if (cmd === 'tools') { const list = M.toolNames().map((n) => ({ name: n, ...M.TOOLS[n] })); return out({ ok: true, tools: list }, list.map((t) => `${t.name.padEnd(26)} ${t.method.padEnd(4)} /v1${t.path.padEnd(38)} ${t.exclusive ? 'owner-only ' : t.mutates ? 'mutates    ' : 'read       '} ${t.says}`).join('\n')); }
  if (cmd === 'tool') {
    const name = rest[0]; const params = Object.fromEntries(rest.slice(1).filter((a) => a.includes('=') && !a.startsWith('--')).map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
    const r = process.env.AXF_MOLLY_URL && side() !== 'axf-molly' ? await callTool(name, params) : runTool(name, params, { by });
    if (r.ok === false) throw Object.assign(new Error(r.error || 'failed'), { code: r.code || 1 });
    return out(r, JSON.stringify(r, null, 1));
  }
  if (cmd === 'retire') { const r = retireList(); return out({ ok: true, ...r }, [`axf-molly name clash: ${r.clash.clash ? 'YES' : 'no'}${r.clash.near.length ? ` (near: ${r.clash.near.join(', ')})` : ''}`, 'Old standalone Molly, listed for retirement (nothing deleted):', ...r.lines.map((l) => `  ${l}`), `  app: ${r.app}`, r.note].join('\n')); }
  if (cmd === 'axhub-service') { const s = M.axhubService({ url: process.env.AXF_MOLLY_URL || `http://${M.SERVICE}:${M.PORT}` }); return out(s, JSON.stringify(s, null, 1)); }
  if (cmd === 'drill') { const { drill } = await import('./drill.mjs'); const r = await drill({ json }); return out(r, r.lines.join('\n')); }
  throw Object.assign(new Error('usage: molly.mjs status | owner [side] | cutover --reason … [--ttl min] | renew | undo [--reason …] | shadow [--tail n] | tools | tool <name> [k=v…] | retire | axhub-service | drill'), { code: 2 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = e.code === 2 ? 2 : e.code === 409 ? 3 : 1;
  });
}

#!/usr/bin/env node
/**
 * Console server load test: what the background loops cost, idle and under load, on a sandboxed copy of the real
 * server (sandbox.mjs) or, read-only, on the live console container.
 *
 *   node scripts/suite/server-load.mjs --root <checkout copy> [--label before] [--out <dir>] [--idle 60] [--clients 3]
 *   node scripts/suite/server-load.mjs --live axf-console [--idle 60]      (samples only: sends nothing)
 *
 * Phases (sandbox): startup (the first 45 s after the server answers), idle (no client), clients (N headless
 * consoles open on the server's own page, as Brett's tabs would be), burst (every parameterless GET route of
 * /openapi.json, 16 at a time, three rounds), then idle again (does the load stop once the clients go).
 * Each phase reports the container's CPU (cgroup usage: the server and every process it starts), the processes the
 * server itself starts (subprocess.Popen, counted by sbx_app.py with the command and the starting thread), tasks
 * started (the pid counter of the container's pid namespace: processes and threads, grandchildren included) and per
 * Python thread CPU with the line it sits on.
 * Writes <out>/server-load-<label>.json and prints a summary; exits 1 when a limit below is broken.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { up, down } from './sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '../..');
const args = process.argv.slice(2);
const opt = (k, d = '') => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const LABEL = opt('label', 'before');
const OUT = opt('out', '/tmp/axf-suite/out');
const IDLE_S = Number(opt('idle', '60'));
const CLIENTS = Number(opt('clients', '3'));
const LIVE = opt('live');

/** The limits a healthy console server keeps (CPU in % of one core, averaged over the phase). */
export const LIMITS = { idleCpu: 10, clientsCpu: 25, idleSpawnsPerMin: 30, clientsSpawnsPerMin: 60, burstP95Ms: 5000, burstErrors5xx: 0, threadBusy: 20 };

const exec = (name, sh) => execFileSync('docker', ['exec', name, 'sh', '-c', sh], { encoding: 'utf8', timeout: 20_000 }).trim();

/** cgroup CPU microseconds and the newest pid in the container. */
function probe(name) {
  const [usage, lastPid, procs] = exec(name, "awk '/^usage_usec/{print $2}' /sys/fs/cgroup/cpu.stat; awk '{print $5}' /proc/loadavg; ls -d /proc/[0-9]* | wc -l").split('\n');
  return { t: Date.now(), usec: Number(usage), pid: Number(lastPid), procs: Number(procs) };
}

async function spawns(url) {
  try { return (await (await fetch(`${url}/__suite/spawns`, { signal: AbortSignal.timeout(10_000) })).json()).spawns; } catch { return null; }
}

async function threads(url) {
  try { return (await (await fetch(`${url}/__suite/threads`, { signal: AbortSignal.timeout(10_000) })).json()).threads; } catch { return null; }
}

/** Sample a phase: CPU %, processes started, the busiest Python threads and the child processes seen. */
async function phase(name, container, url, seconds, during = async () => {}) {
  const t0 = url ? await threads(url) : null;
  if (url) await spawns(url); // reset the counter
  const a = probe(container);
  const windows = [];
  const children = new Map();
  let prev = a;
  const work = during();
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    await sleep(Math.min(5000, Math.max(200, end - Date.now())));
    const p = probe(container);
    windows.push({ s: Math.round((p.t - a.t) / 1000), cpu: +(((p.usec - prev.usec) / 1000 / (p.t - prev.t)) * 100).toFixed(1), tasks: Math.max(0, p.pid - prev.pid), procs: p.procs });
    try {
      for (const line of exec(container, 'ps -eo etimes=,args= | grep -v -e "ps -eo" -e "sh -c awk" -e "^ *[0-9]* sh -c ps"').split('\n')) {
        const m = line.trim().match(/^(\d+)\s+(.*)$/);
        if (!m || /uvicorn|tini|^sh -c cd/.test(m[2])) continue;
        const key = m[2].replace(/\s+/g, ' ').slice(0, 160);
        children.set(key, (children.get(key) ?? 0) + 1);
      }
    } catch { /* container busy */ }
    prev = p;
  }
  await work;
  const b = probe(container);
  const t1 = url ? await threads(url) : null;
  const started = url ? await spawns(url) : null;
  const ms = b.t - a.t;
  const busy = [];
  if (t0 && t1) {
    const before = new Map(t0.map((t) => [t.tid, t.cpu]));
    for (const t of t1) {
      const used = t.cpu - (before.get(t.tid) ?? 0);
      busy.push({ name: t.name, cpuPct: +((used * 1000 / ms) * 100).toFixed(1), where: t.where });
    }
    busy.sort((x, y) => y.cpuPct - x.cpuPct);
  }
  const res = {
    phase: name, seconds: Math.round(ms / 1000),
    cpuPct: +(((b.usec - a.usec) / 1000 / ms) * 100).toFixed(1),
    peakWindowCpuPct: Math.max(0, ...windows.map((w) => w.cpu)),
    tasks: Math.max(0, b.pid - a.pid), tasksPerMin: +((Math.max(0, b.pid - a.pid) * 60000) / ms).toFixed(1),
    spawned: started ? Object.values(started).reduce((x, y) => x + y, 0) : null,
    spawnsPerMin: started ? +((Object.values(started).reduce((x, y) => x + y, 0) * 60000) / ms).toFixed(1) : null,
    windows, threads: busy.slice(0, 8),
    ...(started ? { spawnedBy: Object.entries(started).slice(0, 15).map(([cmd, n]) => ({ cmd, n, perMin: +((n * 60000) / ms).toFixed(1) })) } : {}),
    children: [...children.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([cmd, seen]) => ({ cmd, seen })),
  };
  console.log(`  ${name.padEnd(10)} ${String(res.cpuPct).padStart(6)} % cpu (peak 5 s ${res.peakWindowCpuPct} %) · ${res.spawned ?? '?'} processes started (${res.spawnsPerMin ?? '?'}/min, ${res.tasks} tasks incl. threads and grandchildren)${busy[0] ? ` · busiest thread ${busy[0].name} ${busy[0].cpuPct} %` : ''}`);
  for (const x of res.spawnedBy?.slice(0, 4) ?? []) console.log(`               ${String(x.n).padStart(5)}× ${x.cmd}`);
  return res;
}

/** Parameterless GET routes of the server, from its OpenAPI document. */
async function getRoutes(url) {
  const doc = await (await fetch(`${url}/openapi.json`, { signal: AbortSignal.timeout(30_000) })).json();
  return Object.entries(doc.paths ?? {}).filter(([p, ops]) => ops.get && !p.includes('{') && !/stream|events|terminal|\/ws|sse|download|export|backup|logs\/follow/i.test(p)).map(([p]) => p).sort();
}

async function burst(url, routes, rounds = 3, conc = 16) {
  const results = [];
  const queue = [];
  for (let r = 0; r < rounds; r++) queue.push(...routes);
  const one = async (p) => {
    const t = performance.now();
    try {
      const res = await fetch(`${url}${p}`, { signal: AbortSignal.timeout(30_000) });
      await res.arrayBuffer();
      results.push({ p, ms: performance.now() - t, status: res.status });
    } catch (e) { results.push({ p, ms: performance.now() - t, status: e.name === 'TimeoutError' ? 'timeout' : 'error' }); }
  };
  const workers = Array.from({ length: conc }, async () => { while (queue.length) await one(queue.shift()); });
  await Promise.all(workers);
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const q = (f) => Math.round(ms[Math.min(ms.length - 1, Math.floor(f * ms.length))] ?? 0);
  const slow = {};
  for (const r of results) slow[r.p] = Math.max(slow[r.p] ?? 0, Math.round(r.ms));
  return {
    requests: results.length, routes: routes.length, p50: q(0.5), p95: q(0.95), max: q(1),
    errors5xx: results.filter((r) => typeof r.status === 'number' && r.status >= 500).map((r) => `${r.p} ${r.status}`).filter((x, i, a) => a.indexOf(x) === i),
    timeouts: results.filter((r) => r.status === 'timeout' || r.status === 'error').map((r) => `${r.p} ${r.status}`).filter((x, i, a) => a.indexOf(x) === i),
    slowest: Object.entries(slow).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([p, m]) => ({ p, ms: m })),
  };
}

function loadPlaywright() {
  for (const base of [APP, join(APP, '../..'), process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { return createRequire(join(base, 'x.js'))('playwright'); } catch { /* next */ } }
  return null;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const report = { label: LABEL, at: new Date().toISOString(), limits: LIMITS, phases: [], failures: [] };
  if (LIVE) {
    console.log(`live ${LIVE} (read-only sampling)`);
    report.phases.push(await phase('live-idle', LIVE, '', IDLE_S));
    writeFileSync(join(OUT, `server-load-${LABEL}.json`), JSON.stringify(report, null, 2));
    return;
  }
  const name = `axf-suite-load-${LABEL}`;
  const { url } = await up({ root: opt('root'), name });
  report.url = url;
  console.log(`sandbox ${name} on ${url}`);
  try {
    report.phases.push(await phase('startup', name, url, 45));
    const idle = await phase('idle', name, url, IDLE_S);
    report.phases.push(idle);
    const pw = loadPlaywright();
    let clients = null;
    if (pw && CLIENTS > 0) {
      const browser = await pw.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
      clients = await phase(`clients×${CLIENTS}`, name, url, IDLE_S, async () => {
        const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        for (let i = 0; i < CLIENTS; i++) { const p = await ctx.newPage(); void p.goto(`${url}/`).catch(() => undefined); await sleep(1500); }
        await sleep(Math.max(0, IDLE_S * 1000 - CLIENTS * 1500 - 2000));
        await ctx.close();
      });
      await browser.close();
      report.phases.push(clients);
    }
    const routes = await getRoutes(url);
    let b;
    const bp = await phase('burst', name, url, 5, async () => { b = await burst(url, routes); });
    bp.burst = b;
    report.phases.push(bp);
    console.log(`  burst      ${b.requests} GETs over ${b.routes} routes: p50 ${b.p50} ms · p95 ${b.p95} ms · max ${b.max} ms · ${b.errors5xx.length} 5xx · ${b.timeouts.length} timeouts`);
    const after = await phase('idle-after', name, url, Math.min(IDLE_S, 45));
    report.phases.push(after);
    // limits
    const fail = (what) => { report.failures.push(what); console.log(`  ✗ ${what}`); };
    if (idle.cpuPct > LIMITS.idleCpu) fail(`idle CPU ${idle.cpuPct} % > ${LIMITS.idleCpu} %`);
    if (idle.spawnsPerMin > LIMITS.idleSpawnsPerMin) fail(`idle starts ${idle.spawnsPerMin} processes/min > ${LIMITS.idleSpawnsPerMin}`);
    if (clients && clients.cpuPct > LIMITS.clientsCpu) fail(`${CLIENTS} open consoles cost ${clients.cpuPct} % CPU > ${LIMITS.clientsCpu} %`);
    if (clients && clients.spawnsPerMin > LIMITS.clientsSpawnsPerMin) fail(`${CLIENTS} open consoles make the server start ${clients.spawnsPerMin} processes/min > ${LIMITS.clientsSpawnsPerMin} (${clients.spawnedBy.slice(0, 3).map((x) => `${x.n}× ${x.cmd}`).join('; ')})`);
    if (after.cpuPct > LIMITS.idleCpu) fail(`CPU stays at ${after.cpuPct} % after the load stopped (> ${LIMITS.idleCpu} %)`);
    if (b.p95 > LIMITS.burstP95Ms) fail(`burst p95 ${b.p95} ms > ${LIMITS.burstP95Ms} ms`);
    if (b.errors5xx.length > LIMITS.burstErrors5xx) fail(`burst 5xx: ${b.errors5xx.slice(0, 8).join(', ')}`);
    if (b.timeouts.length) fail(`burst timeouts: ${b.timeouts.slice(0, 8).join(', ')}`);
    for (const p of [idle, after]) for (const t of p.threads) if (t.cpuPct > LIMITS.threadBusy) fail(`thread ${t.name} busy ${t.cpuPct} % while ${p.phase} (${t.where})`);
    const logs = spawnSync('docker', ['logs', '--tail', '400', name], { encoding: 'utf8' });
    report.serverErrors = `${logs.stdout}${logs.stderr}`.split('\n').filter((l) => /Traceback|ERROR|Exception/.test(l)).slice(0, 40);
  } finally {
    writeFileSync(join(OUT, `server-load-${LABEL}.json`), JSON.stringify(report, null, 2));
    if (!args.includes('--keep')) down(name);
  }
  console.log(report.failures.length ? `server load (${LABEL}): ${report.failures.length} limit(s) broken` : `server load (${LABEL}): all limits kept`);
  process.exitCode = report.failures.length ? 1 : 0;
}

await main();

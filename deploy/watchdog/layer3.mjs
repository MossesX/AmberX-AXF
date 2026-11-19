#!/usr/bin/env node
/**
 * Pipeline 2.0 watchdog, layer 3 (pipeline-watchdog@2): watches the watchers. Runs on a systemd timer every 2 minutes
 * (deploy/watchdog/cron.mjs), so it does not share a scheduler with what it checks.
 *
 * Checks, each healed with no human:
 *   cron        the cron daemon runs                       → systemctl restart cron
 *   schedules   the 2.0 cron files are present and current  → cron.mjs install (also removes the retired ones)
 *   layer2      the layer-2 heartbeat is under 3 min old    → a hung layer-2 process is killed, then one pass is run here
 *   tick        the orchestrator tick ran in the last 5 min  → a hung tick is killed, then one tick is run here
 * A check still failing after its heal is retried on the next run; only when it has failed `alertAfter` runs in a row
 * does Brett get ONE alert (re-sent at most every 6 hours) with the exact steps. Every heal is a line in actions.jsonl
 * (by: watchdog); layer 3 writes its own heartbeat (l3-heartbeat.json), which layer 2 checks in turn.
 *
 *   node deploy/watchdog/layer3.mjs run [--json] · check [--json] (no heals)
 * Tick heartbeat: AXF_ORCH_TICK_HEARTBEAT, else <pipeline dir>/orchestrator-tick.json ({ at }), else the mtime of
 * /var/log/axf-orchestrator-tick.log. Tests: AXF_WATCHDOG2_L3_FACTS (JSON facts instead of probing), AXF_WATCHDOG2_DRY_EXEC=1.
 */
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, files, logAction, pipeDir, readJson, sendAlert, writeJson } from './layer2.mjs';
import * as cron from './cron.mjs';

const SELF = fileURLToPath(import.meta.url);
export const STALE_MIN = Object.freeze({ layer2: 3, tick: 5 });
export const HUNG_MIN = Object.freeze({ layer2: 6, tick: 12 });
export const ALERT_AFTER = 3;
export const REALERT_MS = 6 * 3600_000;
const l3File = (env) => join(files(env).dir, 'l3-heartbeat.json');
export const l3Heartbeat = (env = process.env) => readJson(l3File(env), null);

function ageMinOf(at, now) { const t = Date.parse(at || ''); return Number.isFinite(t) ? (now - t) / 60000 : null; }
function mtimeAt(f) { try { return new Date(statSync(f).mtimeMs).toISOString(); } catch { return ''; } }
export const tickHeartbeat = (env = process.env) => env.AXF_ORCH_TICK_HEARTBEAT || join(pipeDir(env), 'orchestrator-tick.json');

/** Processes running a script, with their age in minutes (ps etimes). */
export function procs(pattern) {
  const r = spawnSync('ps', ['-eo', 'pid=,etimes=,args='], { encoding: 'utf8', timeout: 10000 });
  return String(r.stdout || '').split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .filter((m) => m[3].includes(pattern) && !m[3].includes('layer3.mjs') && Number(m[1]) !== process.pid)
    .map((m) => ({ pid: Number(m[1]), ageMin: Number(m[2]) / 60, args: m[3].slice(0, 200) }));
}

/** Everything layer 3 looks at, gathered once. */
export function facts(env = process.env, now = Date.now()) {
  if (env.AXF_WATCHDOG2_L3_FACTS) return JSON.parse(env.AXF_WATCHDOG2_L3_FACTS);
  const hb = readJson(files(env).heartbeat, null);
  const tickAt = readJson(tickHeartbeat(env), null)?.at || mtimeAt('/var/log/axf-orchestrator-tick.log');
  const cronUp = spawnSync('sh', ['-c', 'pgrep -x cron >/dev/null || pgrep -x crond >/dev/null'], { timeout: 10000 }).status === 0;
  let sched = { ok: true };
  try { sched = cron.status({ env }); } catch (e) { sched = { ok: false, error: String(e.message || e) }; }
  return {
    cronUp,
    schedules: sched,
    layer2AgeMin: ageMinOf(hb?.at, now),
    tickAgeMin: ageMinOf(tickAt, now),
    // until the orchestrator has a `tick` command (p2-status-core) there is no tick to watch
    tickScript: (() => { try { return /['"]tick['"]/.test(readFileSync(join(REPO, cron.ORCH_TICK), 'utf8')); } catch { return false; } })(),
    layer2Procs: procs('deploy/watchdog/layer2.mjs'),
    tickProcs: procs(`${cron.ORCH_TICK} tick`),
  };
}

/** Pure: which checks fail. */
export function problems(f) {
  const out = [];
  if (!f.cronUp) out.push({ id: 'cron', why: 'the cron daemon is not running' });
  if (!f.schedules?.ok) out.push({ id: 'schedules', why: `schedules not as installed: ${JSON.stringify(f.schedules?.files ?? f.schedules?.error ?? {})}${f.schedules?.retiredPresent?.length ? `, retired back: ${f.schedules.retiredPresent.join(', ')}` : ''}` });
  if (f.layer2AgeMin == null || f.layer2AgeMin > STALE_MIN.layer2) out.push({ id: 'layer2', why: f.layer2AgeMin == null ? 'layer 2 never ran' : `layer 2 last ran ${Math.round(f.layer2AgeMin)} min ago` });
  if (f.tickScript !== false && (f.tickAgeMin == null || f.tickAgeMin > STALE_MIN.tick)) out.push({ id: 'tick', why: f.tickAgeMin == null ? 'the orchestrator tick never ran' : `the orchestrator tick last ran ${Math.round(f.tickAgeMin)} min ago` });
  return out;
}

const dry = (env) => env.AXF_WATCHDOG2_DRY_EXEC === '1';
function sh(argv, env, timeout) {
  if (dry(env)) return { ok: true, dry: true };
  const r = spawnSync(argv[0], argv.slice(1), { cwd: REPO, env: { ...env, AXF_ACTOR: 'watchdog' }, encoding: 'utf8', timeout });
  return { ok: r.status === 0, code: r.status, tail: `${r.stdout || ''}${r.stderr || ''}`.trim().slice(-300) };
}
function killHung(list, hungMin, env) {
  const killed = [];
  for (const p of list) if (p.ageMin > hungMin) { if (!dry(env)) { try { process.kill(p.pid, 'SIGTERM'); } catch { /* gone */ } } killed.push(p.pid); }
  return killed;
}

/** Heal one problem; returns what was done. */
export function heal(p, f, env = process.env) {
  switch (p.id) {
    case 'cron': { const r = sh(['systemctl', 'restart', 'cron'], env, 60000); return { did: 'restarted the cron daemon', ok: r.ok }; }
    case 'schedules': { if (dry(env)) return { did: 'reinstalled the schedules', ok: true }; try { const r = cron.install({ env }); return { did: `reinstalled the schedules (${[...r.written, ...r.removed.map((x) => `removed ${x}`)].join(', ') || 'no change'})`, ok: true }; } catch (e) { return { did: 'schedule reinstall failed', ok: false, why: String(e.message || e) }; } }
    case 'layer2': {
      const killed = killHung(f.layer2Procs ?? [], HUNG_MIN.layer2, env);
      const r = sh(['flock', '-n', '/run/axf-watchdog-l2.lock', 'timeout', '300', 'node', 'deploy/watchdog/layer2.mjs', 'run'], env, 320000);
      return { did: `${killed.length ? `killed hung layer 2 (pid ${killed.join(', ')}), ` : ''}ran a layer-2 pass`, ok: r.ok, tail: r.tail };
    }
    case 'tick': {
      const killed = killHung(f.tickProcs ?? [], HUNG_MIN.tick, env);
      const r = sh(['flock', '-n', '/run/axf-orchestrator-tick.lock', 'timeout', '600', 'node', cron.ORCH_TICK, 'tick'], env, 620000);
      return { did: `${killed.length ? `killed a hung tick (pid ${killed.join(', ')}), ` : ''}ran the orchestrator tick`, ok: r.ok, tail: r.tail };
    }
    default: return { did: 'nothing', ok: false };
  }
}

export const STEPS = Object.freeze({
  cron: 'ssh to the VPS: systemctl status cron; systemctl restart cron',
  schedules: 'ssh to the VPS: node /opt/axf/deploy/watchdog/cron.mjs install --dir /opt/axf; node /opt/axf/deploy/watchdog/cron.mjs status',
  layer2: 'ssh to the VPS: node /opt/axf/deploy/watchdog/layer2.mjs run (read the error), then tail /var/log/axf-watchdog-l2.log',
  tick: `ssh to the VPS: node /opt/axf/${cron.ORCH_TICK} tick (read the error), then tail /var/log/axf-orchestrator-tick.log`,
});

/** One run: check, heal, re-check, count failures in a row, alert once past ALERT_AFTER. */
export function run({ env = process.env, now = Date.now(), healOn = true } = {}) {
  const st = l3Heartbeat(env) ?? { fails: {}, alerted: {} };
  const f = facts(env, now);
  const found = problems(f);
  const healed = [];
  if (healOn) for (const p of found) { const h = heal(p, f, env); healed.push({ ...p, ...h }); logAction(env, { action: `l3-${p.id}`, ok: h.ok, note: `Watchdog layer 3: ${p.why}: ${h.did}${h.ok ? '' : ' (failed)'}.` }); }
  const after = healOn && found.length ? problems(facts(env, Date.now())) : found;
  const fails = {}; const alerted = { ...(st.alerted ?? {}) };
  for (const p of after) fails[p.id] = (st.fails?.[p.id] ?? 0) + 1;
  for (const k of Object.keys(alerted)) if (!fails[k]) delete alerted[k];
  const alerts = [];
  for (const p of after) {
    if (fails[p.id] < ALERT_AFTER || (alerted[p.id] && now - Date.parse(alerted[p.id]) < REALERT_MS)) continue;
    const a = { source: 'watchdog', key: `watchdog:l3:${p.id}`, severity: 'error', title: `Pipeline watchdog cannot heal: ${p.id}`, body: `${p.why} (${fails[p.id]} runs in a row, self-heal tried each time).\nFix: ${STEPS[p.id]}`, link: 'build-orchestrator.focus:watchdog', meta: { check: p.id } };
    if (healOn) { sendAlert(a, env); alerted[p.id] = new Date(now).toISOString(); logAction(env, { action: 'l3-alert', check: p.id, note: `Watchdog layer 3: alerted Brett: ${p.why}.` }); }
    alerts.push(a);
  }
  if (healOn) writeJson(l3File(env), { $axf: 'watchdog-l3@1', at: new Date().toISOString(), ok: !after.length, fails, alerted, problems: after.map((p) => p.id) });
  return { found, healed, remaining: after, alerts };
}

async function main(argv = process.argv.slice(2)) {
  const cmd = argv[0] || 'check'; const json = argv.includes('--json');
  if (cmd !== 'run' && cmd !== 'check') { console.error('usage: layer3.mjs run|check [--json]'); process.exitCode = 2; return; }
  const r = run({ healOn: cmd === 'run' });
  if (r.remaining.length && cmd === 'check') process.exitCode = 1;
  console.log(json ? JSON.stringify(r, null, 1) : `${new Date().toISOString()} ${r.found.length ? r.found.map((p) => p.why).join('; ') : 'all alive'}${r.healed.length ? `\n${r.healed.map((h) => `  ${h.id}: ${h.did}${h.ok ? '' : ' (failed)'}`).join('\n')}` : ''}${r.remaining.length && cmd === 'run' ? `\n  still failing: ${r.remaining.map((p) => p.id).join(', ')}` : ''}`);
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) main().catch((e) => { console.error(`watchdog layer 3: ${e.message || e}`); process.exitCode = 1; });

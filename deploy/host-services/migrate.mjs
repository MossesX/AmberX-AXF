#!/usr/bin/env node
/**
 * migrate — move the console's server-side parts onto the host one service at a time (host-service-mode@1,
 * framework/spec/HOST-SERVICES.md → Migration), with a verify after every step and a rollback that puts the
 * container's copy back. Runs on the VPS as root (it moves cron files); every mode change goes through the host API,
 * so the guards (shadow first, quiet long enough, enough clean runs, `after` services in host) are the engine's.
 *
 *   node deploy/host-services/migrate.mjs status                     every service: mode, next step, why not yet
 *   node deploy/host-services/migrate.mjs next [--apply]             the next step for each service in cut-over order
 *   node deploy/host-services/migrate.mjs shadow <id>                container → shadow (both run; the host dry-runs and
 *                                                                    the outputs are compared), then verify
 *   node deploy/host-services/migrate.mjs host <id> [--accept-drift a,b]
 *                                                                    shadow → host: cut over, back up and remove the
 *                                                                    cron lines it replaces, start an adopted tick's
 *                                                                    timer, then verify
 *   node deploy/host-services/migrate.mjs verify <id>                check the service against its mode
 *   node deploy/host-services/migrate.mjs rollback <id> [--to shadow] [--why "…"]
 *                                                                    host → container (or shadow): the mode flips first,
 *                                                                    the unit stops, the cron lines come back, verify
 *   … --dry-run                                                      print the plan (modePlan / rollbackSteps), call nothing
 *   … --json                                                         answers as JSON
 *
 * Env: AXF_HOST_DATA (shared data folder: cron backups go to host-services/<id>/cron-backup), AXF_CRON_DIR (default
 * /etc/cron.d), AXF_MIGRATE_WAIT_S (verify timeout, default 180), plus the host-services.mjs endpoints
 * (AXF_HOST_API, AXF_HOST_TOKEN, AXF_CONSOLE_URL).
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from '../../framework/core/host-services.mjs';
import { call } from '../../framework/cli/host-services.mjs';
import { loadManifests, DATA } from './axf-hostd.mjs';

const SELF = fileURLToPath(import.meta.url);
const CRON_DIR = () => process.env.AXF_CRON_DIR || '/etc/cron.d';
const WAIT_S = () => Number(process.env.AXF_MIGRATE_WAIT_S || 180);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;
const BY = 'svc:migrate';

function manifest(id) {
  const m = loadManifests().manifests.find((x) => x.id === id);
  if (!m) throw new H.HostServiceError('unknown_service', `no manifest for ${id}`, { service: id });
  if (m.id === H.DEFAULTS.hostApiId) throw new H.HostServiceError('invalid_body', 'host-api has no mode: it is the host side');
  return m;
}
const backupDir = (m) => join(DATA, 'host-services', m.id, 'cron-backup');
const cronFiles = (m) => m.replaces.filter((r) => r.kind === 'cron').map((r) => r.name);

/** Move the cron lines a service replaces aside (host mode) or back (rollback). Returns what happened per file. */
export function moveCron(m, dir, { dryRun = false } = {}) {
  const out = [];
  for (const name of cronFiles(m)) {
    const live = join(CRON_DIR(), name);
    const saved = join(backupDir(m), name);
    if (dir === 'aside') {
      if (!existsSync(live)) { out.push({ name, did: 'absent' }); continue; }
      if (!dryRun) { mkdirSync(backupDir(m), { recursive: true }); copyFileSync(live, saved); rmSync(live, { force: true }); }
      out.push({ name, did: 'removed', backup: saved });
    } else {
      if (existsSync(live)) { out.push({ name, did: 'present' }); continue; }
      if (!existsSync(saved)) { out.push({ name, did: 'no-backup', hint: 'bash /opt/axf/deploy/install-console.sh writes it again' }); continue; }
      if (!dryRun) copyFileSync(saved, live);
      out.push({ name, did: 'restored', from: saved });
    }
  }
  return out;
}

/** What a service looks like in its mode, checked against the host API (and the cron folder). */
export async function verify(id, { wait = WAIT_S() } = {}) {
  const m = manifest(id);
  const deadline = Date.now() + wait * 1000;
  let last = null;
  for (;;) {
    const st = await call('GET', `/services/${enc(id)}`);
    const mode = st.mode;
    const checks = [];
    const add = (ok, what) => checks.push({ ok: !!ok, what });
    if (mode === 'container') {
      add(['inactive', 'failed', 'unknown'].includes(st.unitState) || m.kind === 'tick', `${m.unit} is not running (${st.unitState})`);
      for (const c of cronFiles(m)) add(existsSync(join(CRON_DIR(), c)), `cron line ${c} is present`);
    } else {
      add(st.status === 'up' || (mode === 'shadow' && st.status === 'degraded' && !st.lastRun), `the host copy is up (${st.status}${st.reason ? `: ${st.reason}` : ''})`);
      if (m.kind === 'daemon') {
        // the service's own answer keeps the mode each run was made in (the state the console reads does not)
        const h = await call('GET', `/services/${enc(id)}/health`).catch(() => ({}));
        const run = h.lastRun || null;
        add(run && run.mode === mode && run.result !== 'error', `a host run in ${mode} mode was recorded (${run ? `${run.mode} ${run.result}` : 'none yet'})`);
      }
      if (mode === 'host') for (const c of cronFiles(m)) add(!existsSync(join(CRON_DIR(), c)), `cron line ${c} is gone`);
      if (mode === 'shadow') for (const c of cronFiles(m)) add(existsSync(join(CRON_DIR(), c)), `cron line ${c} still runs (shadow keeps the container copy)`);
    }
    last = { id, mode, status: st.status, ok: checks.every((c) => c.ok), checks };
    if (last.ok || Date.now() > deadline) return last;
    await sleep(2000);
  }
}

async function setMode(id, to, extra = {}) {
  return call('PUT', `/services/${enc(id)}/mode`, { to, by: BY, why: extra.why || `migrate ${to}`, reason: { title: `${id} → ${to}`, description: 'deploy/host-services/migrate.mjs' }, confirm: true, ...(extra.acceptDrift ? { acceptDrift: extra.acceptDrift } : {}) });
}

export async function toShadow(id, { dryRun = false } = {}) {
  const m = manifest(id);
  if (dryRun) return { id, plan: H.modePlan(m, 'shadow') };
  const r = await setMode(id, 'shadow');
  return { id, changes: r.changes, verify: await verify(id) };
}

export async function toHost(id, { dryRun = false, acceptDrift } = {}) {
  const m = manifest(id);
  if (dryRun) return { id, plan: H.modePlan(m, 'host'), cron: moveCron(m, 'aside', { dryRun: true }) };
  const r = await setMode(id, 'host', { acceptDrift });
  const cron = moveCron(m, 'aside');
  if (m.kind === 'tick') await call('POST', `/services/${enc(id)}/unit/start`, { by: BY, reason: { title: `start ${m.timer}`, description: 'cut-over: the timer replaces the cron line' } });
  return { id, changes: r.changes, cron, verify: await verify(id) };
}

export async function rollback(id, { to = 'container', why = '', dryRun = false } = {}) {
  const m = manifest(id);
  if (dryRun) return { id, steps: H.rollbackSteps(m, { to, by: BY, why }).steps, cron: to === 'container' ? moveCron(m, 'back', { dryRun: true }) : [] };
  const r = await call('POST', `/services/${enc(id)}/rollback`, { to, by: BY, why: why || 'migrate rollback', reason: { title: `Roll back ${id} to ${to}`, description: 'deploy/host-services/migrate.mjs' }, confirm: true });
  const cron = moveCron(m, 'back');
  return { id, to, steps: r.steps, cron, verify: await verify(id, { wait: Math.min(WAIT_S(), 60) }) };
}

export async function status() {
  const doc = await call('GET', '/mode');
  const list = await call('GET', '/services');
  const { manifests } = loadManifests();
  const ctx = Object.fromEntries((list.services || []).map((s) => [s.id, { state: s, hostApiUp: true, unitInstalled: s.unitState !== 'unknown', now: new Date().toISOString() }]));
  return { mode: doc, next: H.migrationNext(H.normModeState(doc, new Date().toISOString()), manifests, ctx), lines: H.modeSummary(H.normModeState(doc, new Date().toISOString()), manifests) };
}

async function main(argv) {
  const json = argv.includes('--json');
  const dryRun = argv.includes('--dry-run');
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const pos = argv.filter((a, i) => !a.startsWith('--') && !['--to', '--why', '--accept-drift'].includes(argv[i - 1]));
  const [cmd = 'status', id = ''] = pos;
  const need = () => { if (!id) throw new H.HostServiceError('invalid_body', `usage: migrate.mjs ${cmd} <id>`); };
  let out;
  switch (cmd) {
    case 'status': out = await status(); if (!json) { console.log(out.lines.join('\n')); for (const n of out.next) if (n.next !== 'done') console.log(`  next ${n.id}: ${n.next}${n.reason ? ` (${n.reason})` : ''}`); return; } break;
    case 'next': {
      const s = await status();
      out = [];
      for (const n of s.next) {
        if (n.next === 'shadow' || n.next === 'host') out.push(argv.includes('--apply') ? await (n.next === 'shadow' ? toShadow(n.id, { dryRun }) : toHost(n.id, { dryRun })) : { id: n.id, next: n.next });
        else out.push({ id: n.id, next: n.next, reason: n.reason });
      }
      break;
    }
    case 'shadow': need(); out = await toShadow(id, { dryRun }); break;
    case 'host': need(); out = await toHost(id, { dryRun, acceptDrift: opt('--accept-drift') ? opt('--accept-drift').split(',') : undefined }); break;
    case 'verify': need(); out = await verify(id, { wait: Number(opt('--wait') || 0) }); break;
    case 'rollback': need(); out = await rollback(id, { to: opt('--to') === 'shadow' ? 'shadow' : 'container', why: opt('--why') || '', dryRun }); break;
    default: throw new H.HostServiceError('invalid_body', `unknown command ${cmd} (status, next, shadow, host, verify, rollback)`);
  }
  console.log(JSON.stringify(out, null, json ? 2 : 1));
  if (out && out.verify && !out.verify.ok) process.exitCode = 6;
  if (out && cmd === 'verify' && !out.ok) process.exitCode = 6;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  main(process.argv.slice(2)).catch((e) => {
    const a = H.consoleAnswer(e instanceof H.HostServiceError ? e : new H.HostServiceError('internal', e?.message || String(e)));
    console.error(a.cli.line);
    process.exit(a.cli.exit);
  });
}

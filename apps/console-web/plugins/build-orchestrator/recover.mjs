#!/usr/bin/env node
/**
 * recover.mjs — the orchestrator fixes stuck builds by itself (build auto-recover-stuck-builds, Nov 13 2026, Brett: "if
 * anything stops working, the server/orchestrator fixes it automatically with no one asking").
 *
 * The executor for build-recovery@1 (framework/core/build-recovery.mjs). One run:
 *   1. reads what really runs (framework/cli/session-liveness.mjs: running builds × PIDs, heartbeats, tmux, exit records,
 *      agent slots) and asks plan() what to do;
 *   2. applies every action through the builds store under its lock (one write, journalled, published to main at once
 *      through builds-live.mjs): the stuck step back to todo (its note cleared), the build back to Queued with a recovery
 *      note, the retry counter and backoff on its `recovery` record, its leaked agent slot released; at the cap the build
 *      is parked in Pending with the reason; a hung session (stale heartbeat) is ended first;
 *   3. writes one line per action to the recovery log (recovery.jsonl) and the run to recovery-state.json, both in the
 *      pipeline's data folder, and sends the FYI per fix (notify, below).
 * --dry-run plans and prints, changes nothing.
 *
 * Settings (Claude settings, group builds, keys builds.recovery.*): enabled (on), maxRetries (3), staleHeartbeatMin (20),
 * backoffMin ("1,5,15"), fyi (on). Off = the tick plans nothing (a manual `run` still works and says it is off).
 *
 *   node apps/console-web/plugins/build-orchestrator/recover.mjs status [--json]         settings, last run, latest events, parked builds
 *   … run [--dry-run] [--json]                 one recovery round now
 *   … retry <build> [--by who]                 put a stuck, failed or parked build back in the Queue now (the counter starts over)
 *   … park <build> [--why w] [--by who]        stop retrying it: back to Pending with the reason
 *   … settings [--json] | settings set k=v…     the Recovery settings (enabled, maxRetries, staleHeartbeatMin, backoffMin, fyi)
 *
 * Exit 0 ok, 1 the run failed, 2 usage / unknown build.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../../../../framework/core/build-recovery.mjs';
import * as BP from '../../../../framework/core/build-pipeline.mjs';
import * as storeCore from '../../../../framework/plan/builds-store-core.mjs';
import { loadStore, withStore } from '../../../../framework/cli/builds-store.mjs';
import * as slots from '../../../../framework/cli/agent-slots.mjs';
import { liveness, planArgs } from '../../../../framework/cli/session-liveness.mjs';
import { settingsFile as claudeSettingsFile } from '../../../../framework/cli/upgrade-policy.mjs';

const nowIso = () => new Date().toISOString();
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(v, null, 1)}\n`); renameSync(tmp, f); }

// ------------------------------------------------------------------ files (the pipeline's data folder, shared with the console container)

export function dataDir(env = process.env) {
  if (env.AXF_PIPELINE_DIR) return env.AXF_PIPELINE_DIR;
  const hub = join(env.AXHUB_PROJECTS_DIR || '/projects', 'amberx-axf', '_data');
  return existsSync(hub) ? join(hub, 'pipeline') : join(homedir(), '.axf', 'pipeline');
}
export const files = (env = process.env) => { const d = dataDir(env); return { dir: d, state: join(d, 'recovery-state.json'), log: join(d, 'recovery.jsonl'), lock: join(d, 'recovery.lock') }; };
export const DATA_FILES = ['recovery-state.json', 'recovery.jsonl', 'recovery.lock'];
const LOG_KEEP_BYTES = 512 * 1024;
function logLine(o, env = process.env) {
  try {
    const f = files(env).log; mkdirSync(dirname(f), { recursive: true });
    try { if (statSync(f).size > LOG_KEEP_BYTES) { const t = readFileSync(f, 'utf8').split('\n'); writeFileSync(f, t.slice(Math.floor(t.length / 2)).join('\n')); } } catch { /* new file */ }
    appendFileSync(f, `${JSON.stringify({ at: nowIso(), ...o })}\n`);
  } catch { /* the log is a courtesy: the events also live on each build's recovery record */ }
}
export function readLog({ limit = 200, env = process.env } = {}) {
  let t = ''; try { t = readFileSync(files(env).log, 'utf8'); } catch { return []; }
  return t.split('\n').flatMap((l) => { if (!l.trim()) return []; try { return [JSON.parse(l)]; } catch { return []; } }).slice(-limit).reverse();
}

// ------------------------------------------------------------------ settings (Claude settings builds.recovery.*)

export const SETTINGS = Object.freeze({
  enabled: { key: 'builds.recovery.enabled', kind: 'toggle', default: true },
  maxRetries: { key: 'builds.recovery.maxRetries', kind: 'number', default: R.MAX_ATTEMPTS, min: 0, max: 10 },
  staleHeartbeatMin: { key: 'builds.recovery.staleHeartbeatMin', kind: 'number', default: R.STALE_HEARTBEAT_MS / 60e3, min: 5, max: 240 },
  backoffMin: { key: 'builds.recovery.backoffMin', kind: 'text', default: R.BACKOFF_MS.map((m) => m / 60e3).join(',') },
  fyi: { key: 'builds.recovery.fyi', kind: 'toggle', default: true },
});
const parseBackoff = (v) => { const l = String(v ?? '').split(/[\s,]+/).filter(Boolean).map(Number); return l.length && l.length <= 10 && l.every((n) => Number.isFinite(n) && n >= 0 && n <= 1440) ? l : null; };
function coerce(spec, v) {
  if (spec.kind === 'toggle') { if (typeof v === 'boolean') return v; const t = String(v).trim().toLowerCase(); return ['true', 'on', 'yes', '1'].includes(t) ? true : ['false', 'off', 'no', '0'].includes(t) ? false : undefined; }
  if (spec.kind === 'number') { const n = Number(v); return v !== '' && Number.isInteger(n) && n >= spec.min && n <= spec.max ? n : undefined; }
  if (spec.kind === 'text') { const l = parseBackoff(v); return l ? l.join(',') : undefined; }
  return undefined;
}
export function loadRecoverySettings(env = process.env) {
  const values = readJson(claudeSettingsFile(env))?.values ?? {};
  const out = {};
  for (const [name, spec] of Object.entries(SETTINGS)) { const v = values[spec.key] === undefined ? undefined : coerce(spec, values[spec.key]); out[name] = v === undefined ? spec.default : v; }
  return out;
}
/** Change Recovery settings (names or full keys). Refuses the whole patch on the first bad value. Written to the Claude settings document. */
export function saveRecoverySettings(patch, { by = process.env.AXF_ACTOR || 'cli', env = process.env } = {}) {
  const changes = {};
  for (const [k, raw] of Object.entries(patch ?? {})) {
    const name = Object.keys(SETTINGS).find((n) => n === k || SETTINGS[n].key === k);
    if (!name) throw Object.assign(new Error(`no Recovery setting ${k} (${Object.keys(SETTINGS).join(', ')})`), { code: 2 });
    const v = coerce(SETTINGS[name], raw);
    if (v === undefined) throw Object.assign(new Error(`${name}: ${JSON.stringify(raw)} is not valid${SETTINGS[name].kind === 'number' ? ` (${SETTINGS[name].min}-${SETTINGS[name].max})` : SETTINGS[name].kind === 'text' ? ' (minutes, comma separated, e.g. 1,5,15)' : ' (on / off)'}`), { code: 2 });
    changes[SETTINGS[name].key] = v;
  }
  if (!Object.keys(changes).length) return loadRecoverySettings(env);
  const f = claudeSettingsFile(env);
  const doc = readJson(f) ?? {};
  const at = nowIso();
  const next = { $axf: 'claude-settings@1', ...doc, updatedAt: at, values: { ...(doc.values ?? {}), ...changes }, changed: { ...(doc.changed ?? {}) } };
  for (const k of Object.keys(changes)) next.changed[k] = { at, by: str(by, 80), via: 'session' };
  writeJson(f, next);
  logLine({ event: 'settings', by: str(by, 80), changes }, env);
  return loadRecoverySettings(env);
}
/** The plan() policy for these settings. */
export const policyOf = (s) => ({ ...R.POLICY, maxAttempts: s.maxRetries, staleHeartbeatMs: s.staleHeartbeatMin * 60e3, backoffMs: (parseBackoff(s.backoffMin) ?? R.BACKOFF_MS.map((m) => m / 60e3)).map((m) => m * 60e3) });

// ------------------------------------------------------------------ side effects (replaceable in tests)

const tmuxKill = (name) => { if (!name || process.env.AXF_SLOTS_TMUX === 'off') return false; const r = spawnSync('tmux', ['kill-session', '-t', `=${name}`], { encoding: 'utf8' }); return !r.error && r.status === 0; };
const releaseSlot = (id) => { try { return !!slots.release(id, null); } catch { return false; } };

/** One recovery at a time (the tick, the console button and the systems-check fix may all ask at once); stale after 2 min. */
function withRunLock(fn, env = process.env) {
  const f = files(env); mkdirSync(f.dir, { recursive: true });
  try { mkdirSync(f.lock); } catch {
    let age = 0; try { age = Date.now() - statSync(f.lock).mtimeMs; } catch { /* gone meanwhile */ }
    if (age < 120e3) return { busy: true };
    rmSync(f.lock, { recursive: true, force: true }); mkdirSync(f.lock);
  }
  try { return fn(); } finally { rmSync(f.lock, { recursive: true, force: true }); }
}

// ------------------------------------------------------------------ applying an action to a build record (pure on the copy)

const openStep = (b) => (b.steps ?? []).find((s) => s && !s.done && !s.skip) ?? null;

/** Apply one plan() action to the build record `b` (a copy inside withStore). Returns false when the build moved on. */
export function applyToBuild(b, a, policy = R.POLICY, now = nowIso()) {
  if (!b || a.action === 'release-slot') return false;
  // the plan was made a moment ago: only act on a build still in the state it saw
  if (!['running', 'waiting', 'failed'].includes(b.status)) return false;
  const step = openStep(b);
  if (step) { Object.assign(step, R.STEP_RESET, { done: false, doneAt: '', updatedAt: now }); }
  const p = b.pipeline ?? {};
  const cleared = { session: '', slot: '', account: '', launchedAt: '', dispatchedAt: '' };
  if (a.action === 'park') {
    b.status = 'pending';
    b.pipeline = BP.normPipeline({ ...p, ...cleared, queuedAt: '', queuedBy: '', note: `parked by auto-recovery after ${a.attempt} retries: ${a.state}${a.exit == null ? '' : ` (exit ${a.exit})`}` }) ?? undefined;
  } else {
    b.status = 'queued';
    b.pipeline = BP.normPipeline({ ...p, ...cleared, queuedAt: now, queuedBy: 'auto-recovery', note: `auto-recovery try ${a.attempt} of ${a.max}: ${a.state}${a.exit == null ? '' : ` (exit ${a.exit})`}${a.delayMs ? `, next launch after ${a.nextAt}` : ''}` }) ?? undefined;
  }
  if (!b.pipeline) delete b.pipeline;
  b.recovery = R.applyToRecovery(b.recovery, a, policy);
  b.notes.push({ text: a.line, at: now });
  b.builtAt = '';
  b.updatedAt = now;
  return true;
}

// ------------------------------------------------------------------ the run

/**
 * One recovery round. opts: dryRun, by, env, now, facts (session-liveness facts for tests), settings (instead of the
 * Claude settings), force (run even when auto-recover is off), kill(name), release(slotId), notify(action, build).
 * Returns { at, ran, dryRun, enabled, actions, applied, skipped, errors, busy? }.
 */
export function run(opts = {}) {
  const env = opts.env ?? process.env;
  const settings = opts.settings ?? loadRecoverySettings(env);
  const at = new Date(opts.now ?? Date.now()).toISOString();
  const base = { $axf: 'recovery-run@1', at, by: str(opts.by || 'cli', 80), dryRun: !!opts.dryRun, enabled: settings.enabled, ran: false, actions: [], applied: [], skipped: [], errors: [] };
  if (!settings.enabled && !opts.force) return { ...base, why: 'auto-recovery is off (Recovery settings)' };
  const go = () => {
    const policy = policyOf(settings);
    const l = liveness({ ...(opts.facts ?? {}), now: opts.now ?? Date.now() });
    const t = Date.parse(at);
    const liveNames = new Set(l.sessions.filter((s) => s.alive).map((s) => s.name));
    const young = (id) => { const s = l.slots.running.find((x) => x.id === id); return !!s && t - Date.parse(s.startedAt || s.enqueuedAt || 0) < policy.graceMs; };
    // a slot whose session still runs, or that was taken a moment ago, is not leaked: its build record is only behind
    // (the dispatcher takes the slot before it marks the build running); never free a slot under a live session
    const actions = R.plan(...planArgs(l), policy).filter((a) => a.action !== 'release-slot' || (!liveNames.has(a.session) && !young(a.slot)));
    const out = { ...base, ran: true, actions };
    if (opts.dryRun || !actions.length) return out;
    const kill = opts.kill ?? tmuxKill; const release = opts.release ?? releaseSlot;
    // a hung session is ended before its build is requeued, so two sessions never work one branch
    for (const a of actions) if (a.kill) { try { kill(a.kill); } catch (e) { out.errors.push({ build: a.build, error: `kill ${a.kill}: ${str(e.message, 200)}` }); } }
    const buildActs = actions.filter((a) => a.action !== 'release-slot');
    if (buildActs.length) {
      try {
        withStore((s) => {
          for (const a of buildActs) {
            const b = storeCore.findBuild(s, a.build);
            if (applyToBuild(b, a, policy, at)) out.applied.push(a); else out.skipped.push({ build: a.build, action: a.action, why: 'the build moved on since the plan' });
          }
          return s;
        }, { by: 'auto-recovery', action: 'recovery:run', note: buildActs.map((a) => `${a.build}:${a.action}`).join(', ').slice(0, 300) });
      } catch (e) { out.errors.push({ error: `builds store: ${str(e.message, 300)}` }); }
    }
    // slots: a leaked one, and the slot a requeued build held (its session is gone)
    for (const a of actions) {
      const done = a.action === 'release-slot' || out.applied.includes(a);
      if (!done || !a.slot) continue;
      const ok = release(a.slot);
      if (a.action === 'release-slot') (ok ? out.applied : out.skipped).push(ok ? a : { build: a.build, action: a.action, why: `slot ${a.slot} already gone` });
    }
    for (const a of out.applied) {
      logLine({ event: 'recovered', ...a.event, line: a.line, nextAt: a.nextAt, kill: a.kill || undefined }, env);
      try { (opts.notify ?? notify)(a, { settings, env }); } catch (e) { out.errors.push({ build: a.build, error: `notify: ${str(e.message, 200)}` }); }
    }
    return out;
  };
  const r = withRunLock(() => { try { return go(); } catch (e) { return { ...base, ran: true, errors: [{ error: str(e.message, 300) }] }; } }, env);
  if (r.busy) return { ...base, busy: true, why: 'another recovery round is running' };
  if (!opts.dryRun) {
    writeJson(files(env).state, { $axf: 'recovery-state@1', lastRun: { at: r.at, by: r.by, actions: r.actions.length, applied: r.applied.map((a) => ({ build: a.build, action: a.action, state: a.state, exit: a.exit, attempt: a.attempt })), skipped: r.skipped, errors: r.errors }, ok: !r.errors.length });
    if (r.errors.length) logLine({ event: 'run-failed', errors: r.errors }, env);
  }
  return r;
}

// ------------------------------------------------------------------ FYI per fix (filled in by the notify step)

export function notify() { return null; }

// ------------------------------------------------------------------ CLI

const flags = (argv) => { const o = { _: [] }; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) o[k] = true; else { o[k] = v; i++; } } else o._.push(a); } return o; };

function printRun(r) {
  if (!r.ran) return console.log(r.why || 'nothing ran');
  if (!r.actions.length) return console.log(`${r.dryRun ? 'dry run: ' : ''}nothing stuck`);
  for (const a of r.actions) console.log(`${r.dryRun ? 'would ' : ''}${a.action.padEnd(12)} ${a.build} · ${a.state}${a.exit == null ? '' : ` exit ${a.exit}`}${a.attempt ? ` · try ${a.attempt}/${a.max}` : ''} · ${a.line}`);
  for (const s of r.skipped) console.log(`skipped      ${s.build} · ${s.why}`);
  for (const e of r.errors) console.log(`error        ${e.build || ''} ${e.error}`);
}

async function main(argv) {
  const [cmd = 'status', ...rest] = argv;
  const f = flags(rest);
  const json = (v) => console.log(JSON.stringify(v, null, 2));
  switch (cmd) {
    case 'run': {
      const r = run({ dryRun: !!(f['dry-run'] || f.dry), by: f.by || process.env.AXF_ACTOR || 'cli', force: !!f.force });
      if (f.json) json(r); else printRun(r);
      if (r.errors.length) process.exitCode = 1;
      return;
    }
    case 'settings': {
      if (f._[0] === 'set') { const patch = Object.fromEntries(f._.slice(1).map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; })); const s = saveRecoverySettings(patch, { by: f.by || 'cli' }); return f.json ? json(s) : console.log(JSON.stringify(s)); }
      const s = loadRecoverySettings();
      return f.json ? json(s) : console.log(Object.entries(s).map(([k, v]) => `${k} = ${v}`).join('\n'));
    }
    case 'status': {
      const st = readJson(files().state, null);
      const s = loadRecoverySettings();
      if (f.json) return json({ settings: s, state: st, events: readLog({ limit: 50 }) });
      console.log(`auto-recovery ${s.enabled ? 'on' : 'off'} · max ${s.maxRetries} retries · stale after ${s.staleHeartbeatMin} min · backoff ${s.backoffMin} min · FYI ${s.fyi ? 'on' : 'off'}`);
      console.log(st?.lastRun ? `last run ${st.lastRun.at}: ${st.lastRun.applied.length} fixed${st.lastRun.errors.length ? `, ${st.lastRun.errors.length} error(s)` : ''}` : 'no run yet');
      for (const e of readLog({ limit: 10 }).filter((x) => x.event === 'recovered')) console.log(`  ${e.at} ${e.action} ${e.build} · ${e.line}`);
      return;
    }
    default: throw Object.assign(new Error(`unknown command ${cmd} (status, run, retry, park, settings)`), { code: 2 });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((e) => { console.error(`recover: ${e.message}`); process.exitCode = e.code === 2 ? 2 : 1; });
}

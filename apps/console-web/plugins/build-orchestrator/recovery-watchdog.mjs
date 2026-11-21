#!/usr/bin/env node
/**
 * watchdog.mjs — the orchestrator's build watchdog (build-watchdog@1, IO side of framework/core/build-watchdog.mjs).
 *
 * Brett, Nov 13 2026: "if anything stops working, the server/orchestrator fixes it automatically with no one asking.
 * Detect builds marked running with no live session (e.g. killed exit 143, failed exit 1), reset and requeue them, retry
 * failed sessions, keep every slot filled, and send an FYI to the phone for each fix. Never wait for Brett to notice."
 *
 * One pass: read the builds store, take every build marked Building (isMarkedRunning), probe what is alive for it on this
 * host (framework/cli/agent-slots.mjs alive: pid, tmux, heartbeat, the run-status file) plus the evidence the headless
 * wrapper left on the build (pipeline.runEnd, the session-end event), and let the decision table say what to do.
 *
 * CLI: also `axf watchdog status|scan|run|set|settings|recoveries|requeue` (plugin.json "cli" names this file).
 *   node apps/console-web/plugins/build-orchestrator/recovery-watchdog.mjs scan [--json]     dry run: every stuck build, its cause and
 *                                                                                   the planned action; nothing changes
 *   … run [--build id] [--json]    one pass that applies the recoveries: a hung session is killed first, the build's agent
 *                                  slots, worker claim and build lock are released, the step it was on is reset, the build
 *                                  goes back to the Queue (or Pending on give-up) through pipeline.mjs setPipeline with a
 *                                  recoveries[] entry in the same store write (journal action watchdog-recover, live on
 *                                  main through builds-live). Idempotent: a per-build lock, and a build recovered less than
 *                                  cooldownMin ago is left for the next pass.
 * Retries (Brett: "retry failed sessions"): a crash or kill is retried up to maxRetries (default 3) since the build last
 * ticked a step; the count is the build's own recoveries[] (never memory), so it survives restarts and other hosts. A
 * usage limit or dead login marks that account out (claude-workers markLimit) and plans the retry on the next worker
 * (claude-workers route, every tried account excluded: pipeline.tried / planned). Past the cap, or every account tried:
 * the build goes to Pending with the reason as its note, in the Errors tab, with a banner item and an alert.
 *
 *   … status [--json]              on/off, cron installed, last pass and its age (stale after 3 min), the last scan the host
 *                                  saw, recent fixes, builds it gave up on
 *   … settings [--json] · set key=value… [--by who] | set --patch '{…}'   the Watchdog settings (keys: SETTING_KEYS)
 *   … recoveries <build> [--json]  a build's recoveries[] (oldest first) and the retries it has used
 *   … requeue [<id>…]              Fix (requeue): builds it gave up on back to the Queue with a fresh retry count
 *   … cron                         what the axf-watchdog cron runs every minute: a pass when the watchdog is on and
 *                                  intervalMin has gone by since the last one, or when the console asked for one (request)
 *   … request [--by who]           ask the host for a pass now (the console container can't see tmux: the next cron pass runs it)
 *   … install-cron [--dir repo] · remove-cron    /etc/cron.d/axf-watchdog (AXF_WATCHDOG_CRON): every minute, under flock
 *                                  /run/axf-watchdog.lock; the line removes its own file once the plugin folder is gone.
 *                                  install.mjs / uninstall.mjs and deploy/install-console.sh call these.
 *
 * Every slot filled (Brett: "keep every slot filled"): after the recoveries, every pass runs the dispatcher tick
 * (pipeline.mjs tick, under its lock) while agent slots are free and Queue work waits, at most FILL_ROUNDS rounds. Slots
 * still idle with the Queue non-empty after that are a pass-level recovery with cause 'idle-slots' (action 'tick'; the
 * next tick runs the dispatcher's self-check), kept in build-watchdog.json and sent with the pass's FYI.
 *
 * Phone FYI (Brett: "send an FYI to the phone for each fix"): every fix goes to the console's alerts API as source
 * `watchdog` (notify.json types: watchdog.fix, an FYI pushed to AmberX at normal priority, since low never leaves the
 * banner; watchdog.gave-up, an alert at high priority), which axf.notify@1 (notify-control) gates and pushes to the AmberX
 * app with build, cause, action and attempt. fyi 'batch' (default): one push per pass for all its fixes; 'each': one per
 * fix. A give-up is always its own alert. Each sent fix gets `notified` (ISO) on its recovery record.
 *
 * Files: <pipeline dir>/build-watchdog.json (watchdog-state@1: last pass, recent fixes), next to the dispatcher's state.
 * Environment for tests: AXF_WATCHDOG_SETTINGS (a JSON patch over the settings), AXF_WATCHDOG_ACCOUNTS (comma list of usable
 * accounts instead of deploy/claude-workers.mjs status), AXF_WATCHDOG_PROBE (a JSON map build → probe instead of the host).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as W from '../../../../framework/core/build-watchdog.mjs';
import { loadStore } from '../../../../framework/cli/builds-store.mjs';
import * as slots from '../../../../framework/cli/agent-slots.mjs';
import * as buildLock from '../../../../framework/cli/build-lock.mjs';
import { hitOf, markLimit, release as workersRelease, route as workersRoute, status as workersStatus } from '../../../../deploy/claude-workers.mjs';
import { endRun, makeConsole, pipeDir, pipelineLock, queue as pipelineQueue, requestSelfCheck, setPipeline, slotsNow, tick, worktreeOf } from './pipeline.mjs';
import * as BP from '../../../../framework/core/build-pipeline.mjs';
import { withStore } from '../../../../framework/cli/builds-store.mjs';

const SELF = fileURLToPath(import.meta.url);
const HERE = dirname(SELF);
export const SCHEMA_STATE = 'watchdog-state@1';
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const headlessDir = (env = process.env) => env.AXF_HEADLESS_DIR || '/var/tmp/axf-headless';

export const stateFile = (env = process.env) => join(pipeDir(env), 'build-watchdog.json');
export const loadState = (env = process.env) => ({ $axf: SCHEMA_STATE, lastPass: '', lastFix: '', passes: 0, recent: [], ...(readJson(stateFile(env), {}) ?? {}) });
function saveState(s, env = process.env) {
  const f = stateFile(env); mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify({ ...s, $axf: SCHEMA_STATE }, null, 1)}\n`); renameSync(tmp, f);
}
const KEEP_RECENT = 50;

/**
 * The plugin's own settings on top of build-watchdog@1's { enabled, staleMin, graceMin, maxRetries }:
 *   intervalMin        minutes between cron passes (1)          cooldownMin   a recovered build is left alone this long (5)
 *   retryOtherAccount  a usage limit / dead login moves the retry to the next worker (true)
 *   fyi                'batch' (one phone push per pass) | 'each' (one per fix)
 */
export const EXTRA_DEFAULTS = Object.freeze({ intervalMin: 1, cooldownMin: 5, retryOtherAccount: true, fyi: 'batch' });
const EXTRA_RANGES = { intervalMin: [1, 60], cooldownMin: [0, 120] };
export function normSettings(raw = {}) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const num = (k) => { const n = Number(o[k]); const [lo, hi] = EXTRA_RANGES[k]; return o[k] == null || o[k] === '' || !Number.isFinite(n) ? EXTRA_DEFAULTS[k] : Math.min(hi, Math.max(lo, Math.round(n))); };
  const bool = (v, d) => (v === true || v === 'true' || v === 'on' ? true : v === false || v === 'false' || v === 'off' ? false : d);
  return { ...W.normSettings({ ...o, enabled: bool(o.enabled, true) }), intervalMin: num('intervalMin'), cooldownMin: num('cooldownMin'), retryOtherAccount: bool(o.retryOtherAccount, true), fyi: o.fyi === 'each' ? 'each' : 'batch' };
}
export const settingsFile = (env = process.env) => join(pipeDir(env), 'build-watchdog-settings.json');
/** The keys Settings → Plugins → Build orchestrator → Watchdog edits (and `set`, PUT watchdog/settings, MCP, voice). */
export const SETTING_KEYS = ['enabled', 'intervalMin', 'staleMin', 'graceMin', 'maxRetries', 'retryOtherAccount', 'fyi', 'cooldownMin'];
/** Save a patch of SETTING_KEYS (unknown keys are refused), normalized; returns the saved settings. */
export function saveSettings(patch = {}, { by = process.env.AXF_ACTOR || 'cli', env = process.env } = {}) {
  const bad = Object.keys(patch).filter((k) => !SETTING_KEYS.includes(k));
  if (bad.length) throw Object.assign(new Error(`unknown setting ${bad.join(', ')} (keys: ${SETTING_KEYS.join(', ')})`), { code: 2 });
  const prev = readJson(settingsFile(env), {}) ?? {};
  const next = normSettings({ ...prev, ...patch });
  const f = settingsFile(env); mkdirSync(dirname(f), { recursive: true });
  writeFileSync(`${f}.${process.pid}.tmp`, `${JSON.stringify({ $axf: 'build-watchdog-settings@1', ...next, setBy: str(by, 80), setAt: new Date().toISOString() }, null, 1)}\n`);
  renameSync(`${f}.${process.pid}.tmp`, f);
  return loadSettings(env);
}
/** The watchdog settings: defaults, then the saved settings, then AXF_WATCHDOG_SETTINGS (tests). */
export function loadSettings(env = process.env) {
  let patch = {};
  try { patch = env.AXF_WATCHDOG_SETTINGS ? JSON.parse(env.AXF_WATCHDOG_SETTINGS) : {}; } catch { /* a bad patch is ignored */ }
  return normSettings({ ...(readJson(settingsFile(env), {}) ?? {}), ...patch });
}

/** Accounts a retry may go to (claude-workers: every account that takes jobs). [] = unknown (the table then never gives up on accounts). */
export function usableAccounts(env = process.env) {
  if (env.AXF_WATCHDOG_ACCOUNTS != null) return env.AXF_WATCHDOG_ACCOUNTS.split(',').map((s) => s.trim()).filter(Boolean);
  try { return workersStatus(env).accounts.filter((a) => a.takesJobs).map((a) => a.name); } catch { return []; }
}

function sessionEnd(b, env) {
  const ses = b.pipeline?.session; if (!ses) return null;
  let t = ''; try { t = readFileSync(join(headlessDir(env), 'events.jsonl'), 'utf8'); } catch { return null; }
  const since = Date.parse(b.pipeline.launchedAt || 0) - 5000;
  let end = null;
  for (const l of t.split('\n')) {
    if (!l.includes('"session-end"') || !l.includes(ses)) continue;
    try { const e = JSON.parse(l); if (e.event === 'session-end' && e.session === ses && Date.parse(e.at || 0) >= since) end = e; } catch { /* skip */ }
  }
  return end;
}
function tailOf(file, bytes = 16384) {
  try { const t = readFileSync(file, 'utf8'); return t.slice(-bytes); } catch { return ''; }
}

/**
 * The probe for one build: what the host sees (agent-slots alive) merged with the evidence on the build (pipeline.runEnd,
 * newer than its launch) and the session-end event. An exit on either is the exit; a usage / login stop on either is the limit.
 */
export function probeBuild(b, env = process.env) {
  let fake = null; try { fake = env.AXF_WATCHDOG_PROBE ? JSON.parse(env.AXF_WATCHDOG_PROBE) : null; } catch { /* ignored */ }
  if (fake && fake[b.id]) return W.normProbe(fake[b.id]);
  const p = b.pipeline ?? {};
  const since = p.launchedAt || p.dispatchedAt || '';
  const a = slots.alive(b.id, { dir: worktreeOf(b.id, env), since });
  const re = p.runEnd && (!since || p.runEnd.at > since) ? p.runEnd : null;
  const ev = sessionEnd(b, env);
  const exit = re?.exit ?? a.exit ?? (ev && Number.isInteger(ev.exit) ? ev.exit : null);
  const exitKind = re?.kind || a.exitKind || (ev?.kind && W.EXIT_KINDS.includes(ev.kind) ? ev.kind : '');
  let limit = re?.limit || a.limit || '';
  if (!limit && exit != null && exit !== 0 && ev?.log) limit = hitOf(tailOf(ev.log), exit) || '';
  return { ...W.normProbe({ pid: a.pid, tmux: a.tmux, lastSeenAt: a.lastSeenAt, exit, exitKind, limit, at: a.at }), sessions: a.sessions, pids: a.pids, slots: a.slots, heartbeat: a.heartbeat };
}

/**
 * The build as the table counts its retries: a give-up hands the build to Brett, and his requeue starts a fresh count,
 * so only the recoveries after its newest give-up count (the records themselves stay on the build).
 */
export function sinceGiveUp(b) {
  const r = b.recoveries ?? []; const i = r.map((x) => x.action).lastIndexOf('give-up');
  return i < 0 ? b : { ...b, recoveries: r.slice(i + 1) };
}

/** Builds the watchdog gave up on that still wait in Pending (the banner item, Fix = requeue). */
export function gaveUp(store = loadStore()) {
  return store.builds.filter((b) => !b.deleted && b.status === 'pending' && (b.recoveries ?? []).at(-1)?.action === 'give-up')
    .map((b) => { const r = b.recoveries.at(-1); return { id: b.id, title: str(b.title, 120), at: r.at, cause: r.cause, exit: r.exit, attempt: r.attempt, step: r.step, note: r.note }; });
}

/** Fix (requeue): a gave-up build back to the Queue (pipeline.mjs queue), with a fresh retry count. */
export function requeueGaveUp(ids = [], { by = process.env.AXF_ACTOR || 'watchdog-fix' } = {}) {
  const want = gaveUp(); const pick = ids.length ? want.filter((g) => ids.includes(g.id)) : want;
  const done = []; const failed = [];
  for (const g of pick) { try { pipelineQueue(g.id, { by }); done.push(g.id); } catch (e) { failed.push({ id: g.id, error: str(e.message, 200) }); } }
  return { requeued: done, failed, notGaveUp: ids.filter((i) => !want.some((g) => g.id === i)) };
}

/**
 * The dry run: every build marked Building, probed and decided. Returns { at, settings, builds: [{ id, title, status,
 * probe, decision }], stuck: [...the stuck ones] }. Nothing changes.
 */
export function scan({ env = process.env, store = loadStore(), settings = loadSettings(env), accounts = null } = {}) {
  const at = new Date().toISOString();
  // retry on another account off: no account list, so an account stop never gives up on accounts (plain retries)
  const usable = accounts ?? (settings.retryOtherAccount ? usableAccounts(env) : []);
  const builds = [];
  for (const b of store.builds) {
    if (!W.isMarkedRunning(b)) continue;
    let probe;
    try { probe = probeBuild(b, env); } catch (e) { probe = { ...W.normProbe({}, at), error: str(e.message, 200) }; }
    const decision = W.decide(sinceGiveUp(b), probe, settings, { accounts: usable, now: probe.at || at });
    builds.push({ id: b.id, title: str(b.title, 120), status: b.status, account: b.pipeline?.account ?? '', session: b.pipeline?.session ?? '', launchedAt: b.pipeline?.launchedAt ?? '', probe, decision });
  }
  return { $axf: 'watchdog-scan@1', at, settings, accounts: usable, builds, stuck: builds.filter((x) => x.decision.stuck) };
}

// ------------------------------------------------------------------ run: apply the recoveries

/** A per-build lock (mkdir, stale after 5 min): two passes never recover the same build at once. */
function lockBuild(id, env) {
  const d = join(pipeDir(env), 'build-watchdog-locks'); mkdirSync(d, { recursive: true });
  const f = join(d, `${id}.lock`);
  try { mkdirSync(f); } catch {
    let age = 0; try { age = Date.now() - statSync(f).mtimeMs; } catch { /* gone */ }
    if (age < 5 * 60e3) return null;
    try { rmSync(f, { recursive: true, force: true }); mkdirSync(f); } catch { return null; }
  }
  return () => { try { rmSync(f, { recursive: true, force: true }); } catch { /* gone */ } };
}

/** Recovered less than cooldownMin ago (the build's newest recovery): left for a later pass. */
export function cooling(b, settings, now = Date.now()) {
  const last = (b.recoveries ?? []).at(-1);
  return !!last && now - Date.parse(last.at) < settings.cooldownMin * 60e3;
}

function killSession(probe) {
  for (const s of probe.sessions ?? []) spawnSync('tmux', ['kill-session', '-t', `=${s}`]);
  for (const pid of probe.pids ?? []) { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
}

/** Free what the dead run held: its agent slots, its worker claim, its build lock. */
function releaseHeld(b, probe, env) {
  const freed = [];
  for (const sl of probe.slots ?? []) { try { if (slots.release(sl.id, probe.exit)) freed.push(sl.id); } catch { /* store gone */ } }
  if (b.pipeline?.slot && !freed.includes(b.pipeline.slot)) { try { if (slots.release(b.pipeline.slot, probe.exit)) freed.push(b.pipeline.slot); } catch { /* gone */ } }
  if (b.pipeline?.session) { try { workersRelease(b.pipeline.session, env); } catch { /* no claim */ } }
  try { buildLock.release(b.id, { dir: worktreeOf(b.id, env) }); } catch { /* no lock */ }
  return freed;
}

/**
 * Apply one decision. Returns the recovery record written (with `freed` slots), or null when nothing was done.
 * exit-clean (requeue): the dispatcher's own exit transition runs (pipeline endRun), then the record is added.
 */
export function recover(b, d, probe, { env = process.env, settings = loadSettings(env), now = new Date().toISOString() } = {}) {
  if (!d || d.action === 'none') return null;
  if (d.action === 'kill-retry') killSession(probe);
  // the session ended but its tmux still waits out its close countdown: close it now, or the dispatcher's launch gate
  // (build-lock@1) would see it alive and adopt the dead session as running again (nothing runs claude in it; logs stay)
  else if (probe.pid !== true && (probe.sessions ?? []).length) killSession({ sessions: probe.sessions, pids: [] });
  const freed = releaseHeld(b, probe, env);
  // a usage limit / dead login: the account is out (claude-workers markLimit, so the dispatcher skips it) and the retry is
  // planned on the next worker (claude-workers route, excluding every account this build already tried)
  let next = '';
  if (d.action === 'retry-other-account' && settings.retryOtherAccount) {
    if (d.account) { try { markLimit(d.account, { kind: d.cause === 'auth-failed' ? 'auth' : 'usage', text: d.note }, env); } catch { /* no workers state (tests) */ } }
    next = nextWorker(d.excludeAccounts, env);
  }
  const rec = W.recoveryRecord(b, next ? { ...d, note: str(`${d.note} Next: ${next}.`, 400) } : d, { now, session: b.pipeline?.session ?? '' });
  const add = (x, at) => {
    x.recoveries = W.normRecoveries([...(x.recoveries ?? []), rec]);
    if (d.resetStep && d.step) { const st = x.steps.find((s) => s.id === d.step); if (st && !st.done) { st.note = str(`Reset by the watchdog (${d.cause}, attempt ${d.attempt}) ${at}`, 1000); st.updatedAt = at; } }
  };
  if (d.action === 'requeue') {
    endRun(b, { exit: 0, kind: 'phase-done', phase: d.phase, env });
    setPipeline(b.id, {}, { by: 'watchdog', action: W.JOURNAL_ACTION, note: W.recoveryLine(rec, b), mutate: add });
    return { ...rec, freed };
  }
  const p = b.pipeline ?? {};
  const giveUp = d.action === 'give-up';
  const patch = {
    session: '', slot: '', note: d.note,
    crashes: W.RETRY_ACTIONS.includes(d.action) || giveUp ? (p.crashes ?? 0) + 1 : p.crashes ?? 0,
    lastRun: { at: now, exit: d.exit, outcome: giveUp ? 'failed' : 'requeued', reason: giveUp ? 'crash-limit' : 'crash', stepsLeft: (b.steps ?? []).filter((s) => !s.done && !s.skip).length, account: p.account ?? '', session: p.session ?? '', phase: d.phase },
    ...(d.excludeAccounts.length && settings.retryOtherAccount ? { tried: d.excludeAccounts } : {}),
    ...(next ? { planned: { model: (b.steps ?? []).find((s) => !s.done && !s.skip)?.model ?? '', account: next, kind: 'subscription', at: now, why: `watchdog: ${d.account || 'its account'} ${d.cause === 'auth-failed' ? 'lost its login' : 'hit its limit'}, retry on ${next}` } } : {}),
    ...(giveUp ? { queuedAt: '' } : {}),
  };
  setPipeline(b.id, patch, { status: d.status, by: 'watchdog', action: W.JOURNAL_ACTION, note: W.recoveryLine(rec, b), mutate: add });
  return { ...rec, freed, ...(next ? { next } : {}) };
}

/** The worker a retry goes to (deploy/claude-workers.mjs route), never one in `exclude`; '' = none free now (the dispatcher picks later). */
export function nextWorker(exclude = [], env = process.env) {
  if (env.AXF_WATCHDOG_ACCOUNTS != null) return env.AXF_WATCHDOG_ACCOUNTS.split(',').map((x) => x.trim()).find((a) => a && !exclude.includes(a)) ?? '';
  try { return workersRoute({ exclude }, env) || ''; } catch { return ''; }
}

/** Retries the build has used since it last made progress (kept on the build: its recoveries[]). */
export const retriesOf = (b) => W.attemptOf(b) - 1;

// ------------------------------------------------------------------ keep every slot filled

const FILL_ROUNDS = 3;
/** Queue work the dispatcher may start: queued, not on hold, steps left. */
export const queueWork = (store) => store.builds.filter((b) => b.flow !== 'pipeline-2' && b.status === 'queued' && !b.deleted && !b.hidden && !BP.isHeld(b) && !W.isMarkedRunning(b) && BP.openSteps(b).length);

/**
 * One dispatcher tick: in-process when this process already holds the dispatcher's lock (AXF_PIPELINE_LOCKED=1, tests),
 * else `pipeline.mjs tick --json` under flock -n of that lock (busy = the cron tick is filling the slots right now).
 * Returns { ran, launched: [id…], busy?, error? }.
 */
export function runTick(env = process.env) {
  if (env.AXF_WATCHDOG_TICK === 'off') return { ran: false, launched: [], why: 'off' };
  try {
    if (env.AXF_PIPELINE_LOCKED === '1' || spawnSync('flock', ['-V']).status !== 0) {
      const r = tick({ env }); return { ran: true, launched: r.launched.map((l) => l.id) };
    }
    const r = spawnSync('flock', ['-n', pipelineLock(env), process.execPath, join(HERE, 'pipeline.mjs'), 'tick', '--json'], { encoding: 'utf8', timeout: 300e3, env: { ...env, AXF_PIPELINE_LOCKED: '1' } });
    if (r.status === 1 && !r.stdout) return { ran: false, launched: [], busy: true };
    let j = null; try { j = JSON.parse(r.stdout); } catch { /* not json */ }
    return j ? { ran: true, launched: (j.launched ?? []).map((l) => l.id) } : { ran: false, launched: [], error: str(r.stderr || r.stdout, 300) };
  } catch (e) { return { ran: false, launched: [], error: str(e.message, 300) }; }
}

/**
 * Fill the free slots: tick while slots are free and Queue work waits (at most FILL_ROUNDS). Returns { rounds, launched,
 * idle: null | { at, cause: 'idle-slots', action: 'tick', free, queued, note } }.
 */
export function fillSlots({ env = process.env, slotsOf = slotsNow, storeOf = loadStore, tickOf = runTick } = {}) {
  const launched = []; let rounds = 0; let last = null;
  for (; rounds < FILL_ROUNDS; rounds += 1) {
    const sl = slotsOf(); const work = queueWork(storeOf());
    if (sl.unavailable || !(sl.free > 0) || !work.length) break;
    last = tickOf(env);
    launched.push(...last.launched);
    if (!last.ran || !last.launched.length) { rounds += 1; break; }
  }
  const sl = slotsOf(); const work = queueWork(storeOf());
  let idle = null;
  if (!sl.unavailable && sl.free > 0 && work.length && !launched.length && !last?.busy) {
    idle = { at: new Date().toISOString(), buildId: '', cause: 'idle-slots', action: 'tick', attempt: 0, notified: '', free: sl.free, queued: work.length,
      note: `${sl.free} slot(s) idle while ${work.length} build(s) wait in the Queue (${work.slice(0, 3).map((b) => b.id).join(', ')}): ticked the dispatcher${last?.error ? ` (it failed: ${last.error})` : ''} and asked for its self-check.` };
    try { requestSelfCheck({ by: 'watchdog', reason: 'idle slots with Queue work' }); } catch { /* the next tick still runs */ }
  }
  return { rounds, launched, idle };
}

/**
 * One watchdog pass: scan, then recover every stuck build (per-build lock, cooldown). Writes build-watchdog.json (last pass,
 * recent fixes). Returns { at, fixes: [record…], skipped: [{ id, why }], scan }.
 */
export function run({ env = process.env, only = '', settings = loadSettings(env), fill: fillOpts = {} } = {}) {
  const sc = scan({ env, settings });
  const fixes = []; const skipped = []; const errors = [];
  const store = loadStore();
  for (const x of sc.stuck) {
    if (only && x.id !== only) continue;
    if (x.decision.action === 'none') { skipped.push({ id: x.id, why: x.decision.note }); continue; }
    const b = store.builds.find((y) => y.id === x.id);
    if (!b) continue;
    if (cooling(b, settings)) { skipped.push({ id: x.id, why: `recovered less than ${settings.cooldownMin} min ago` }); continue; }
    const unlock = lockBuild(x.id, env);
    if (!unlock) { skipped.push({ id: x.id, why: 'another pass holds its lock' }); continue; }
    try {
      // re-read under the lock: another pass (or the dispatcher) may have moved it on already
      const fresh = loadStore().builds.find((y) => y.id === x.id);
      if (!fresh || !W.isMarkedRunning(fresh) || (fresh.pipeline?.session ?? '') !== (x.session ?? '')) { skipped.push({ id: x.id, why: 'moved on since the scan' }); continue; }
      const r = recover(fresh, x.decision, x.probe, { env, settings });
      if (r) fixes.push({ ...r, title: x.title });
    } catch (e) { errors.push({ id: x.id, error: str(e.message, 300) }); } finally { unlock(); }
  }
  // keep every slot filled: after the recoveries (and on every pass, recoveries or not)
  const fill = settings.enabled ? fillSlots({ env, ...fillOpts }) : { rounds: 0, launched: [], idle: null };
  const at = new Date().toISOString();
  // the phone hears about every fix (batched per pass, or one per fix), the idle-slots fix included
  const toSend = [...fixes, ...(fill.idle ? [fill.idle] : [])];
  if (toSend.length) { try { notifyFixes(toSend, { env, settings, at }); } catch (e) { errors.push({ id: '', error: `notify: ${str(e.message, 200)}` }); } }
  const st = loadState(env);
  saveState({ ...st, lastPass: at, passes: (st.passes ?? 0) + 1, ...(fixes.length ? { lastFix: at } : {}), lastStuck: sc.stuck.length, lastRunning: sc.builds.length,
    recent: [...(st.recent ?? []), ...fixes.map((f) => ({ at: f.at, buildId: f.buildId, title: f.title, step: f.step, cause: f.cause, exit: f.exit, action: f.action, attempt: f.attempt, account: f.account, notified: f.notified, note: f.note })), ...(fill.idle ? [fill.idle] : [])].slice(-KEEP_RECENT),
    lastFill: { at, rounds: fill.rounds, launched: fill.launched, idle: !!fill.idle }, errors,
    // what the host saw (the console container can't probe tmux or pids: it shows this)
    lastScan: { at: sc.at, builds: sc.builds.map((x) => ({ id: x.id, title: x.title, status: x.status, account: x.account, session: x.session, launchedAt: x.launchedAt,
      probe: { pid: x.probe.pid, tmux: x.probe.tmux, lastSeenAt: x.probe.lastSeenAt, exit: x.probe.exit, exitKind: x.probe.exitKind, limit: x.probe.limit },
      cause: x.decision.cause, stuck: x.decision.stuck, action: x.decision.action, attempt: x.decision.attempt, note: x.decision.note })) } }, env);
  // retired by itself: with no builds@1 build marked running and none in the Queue the pass has nothing to watch
  // (Pipeline 2.0 builds are watched by the one Pipeline 2.0 watchdog, deploy/watchdog)
  return { $axf: 'watchdog-pass@1', at, fixes, skipped, errors, fill, scan: sc, retired: !sc.builds.length && !queueWork(store).length };
}

const line = (x) => `${x.id}: ${x.decision.cause}${x.decision.exit != null ? ` (exit ${x.decision.exit})` : ''} → ${x.decision.action}${x.decision.attempt ? ` · attempt ${x.decision.attempt}` : ''} · ${x.decision.note}`;

// ------------------------------------------------------------------ status (health, REST, MCP, CLI, voice)

export const STALE_PASS_MIN = 3;
/**
 * What the watchdog is doing: { settings, cron, lastPass, ageMin, stale, passes, lastFix, lastScan, recent, gaveUp,
 * pending request }. `stale` = on and no pass for STALE_PASS_MIN minutes (the systems check's red).
 */
export function status({ env = process.env, now = Date.now() } = {}) {
  const st = loadState(env); const settings = loadSettings(env);
  const last = st.lastPass ? Date.parse(st.lastPass) : NaN;
  const ageMin = Number.isFinite(last) && last > 0 ? Math.round((now - last) / 6e3) / 10 : null;
  let gave = []; try { gave = gaveUp(); } catch { /* no store */ }
  return { $axf: 'watchdog-status@1', ok: true, at: new Date(now).toISOString(), settings, cron: { file: cronFile(env), installed: cronInstalled(env) },
    lastPass: st.lastPass || '', ageMin, stale: settings.enabled && (ageMin == null || ageMin > STALE_PASS_MIN), passes: st.passes ?? 0, lastFix: st.lastFix || '',
    lastScan: st.lastScan ?? null, lastFill: st.lastFill ?? null, recent: (st.recent ?? []).slice(-20).reverse(), gaveUp: gave, request: readJson(requestFile(env)), errors: st.errors ?? [] };
}

// ------------------------------------------------------------------ phone FYI (axf.notify@1)

export const ALERT_SOURCE = 'watchdog';
/** The deep link (a console action: alerts dispatch their link): the Watchdog tab, `?build=<id>` for one build. */
export const ALERT_LINK = 'build-orchestrator.focus:watchdog';
const fixLine = (f) => `${f.title || f.buildId || 'Slots'}: ${f.cause}${f.exit != null ? ` (exit ${f.exit})` : ''} → ${f.action}${f.attempt ? `, attempt ${f.attempt}` : ''}${f.next ? `, next ${f.next}` : ''}`;

/** The alerts for one pass's fixes: batched FYI (or one per fix) + one alert per give-up. */
export function alertsFor(fixes, { fyi = 'batch', at = new Date().toISOString() } = {}) {
  const meta = (f) => ({ kind: f.action === 'give-up' ? 'gave-up' : 'fix', build: f.buildId || '', cause: f.cause, action: f.action, attempt: f.attempt, account: f.account || '', step: f.step || '' });
  const gave = fixes.filter((f) => f.action === 'give-up'); const fixed = fixes.filter((f) => f.action !== 'give-up');
  const out = gave.map((f) => ({ source: ALERT_SOURCE, key: `watchdog:gave-up:${f.buildId}`, severity: 'error', link: `${ALERT_LINK}?build=${encodeURIComponent(f.buildId)}`,
    title: `Watchdog gave up: ${str(f.title || f.buildId, 100)}`, body: str(`${f.note}\nFix: requeue it from the systems check banner or Build orchestrator → Watchdog.`, 1500), meta: meta(f), fixes: [f] }));
  if (!fixed.length) return out;
  if (fyi === 'each') return [...fixed.map((f) => ({ source: ALERT_SOURCE, key: `watchdog:fix:${f.buildId || 'slots'}:${f.at}`, severity: 'info', link: f.buildId ? `${ALERT_LINK}?build=${encodeURIComponent(f.buildId)}` : ALERT_LINK,
    title: `Watchdog fixed: ${str(f.title || f.buildId || 'idle slots', 100)}`, body: str(`${fixLine(f)}\n${f.note}`, 1500), meta: meta(f), fixes: [f] })), ...out];
  return [{ source: ALERT_SOURCE, key: `watchdog:fix:${at}`, severity: 'info', link: ALERT_LINK,
    title: fixed.length === 1 ? `Watchdog fixed: ${str(fixed[0].title || fixed[0].buildId || 'idle slots', 100)}` : (() => { const n = fixed.filter((f) => f.buildId).length; return `Watchdog fixed ${n} build${n === 1 ? '' : 's'}${n < fixed.length ? ' and filled idle slots' : ''}`; })(),
    body: str(fixed.map((f) => `${fixLine(f)}${fixed.length === 1 ? `\n${f.note}` : ''}`).join('\n'), 1500),
    meta: { kind: 'fix', builds: fixed.map((f) => f.buildId).filter(Boolean), causes: fixed.map((f) => f.cause), count: fixed.length }, fixes: fixed }, ...out];
}

/** Send one alert: the console's alerts API (docker exec on the host), or AXF_WATCHDOG_NOTIFY_LOG (tests: one JSON line each). */
export function sendAlert(a, env = process.env) {
  const { fixes, ...alert } = a;
  if (env.AXF_WATCHDOG_NOTIFY_LOG) { try { writeFileSync(env.AXF_WATCHDOG_NOTIFY_LOG, `${JSON.stringify(alert)}\n`, { flag: 'a' }); return true; } catch { return false; } }
  try { return makeConsole(env)('POST', '/api/alerts', alert) != null; } catch { return false; }
}

/** Send the pass's alerts and mark every fix that went out `notified` (its recovery record on the build too). */
export function notifyFixes(fixes, { env = process.env, settings = loadSettings(env), at = new Date().toISOString() } = {}) {
  const sent = [];
  for (const a of alertsFor(fixes, { fyi: settings.fyi, at })) {
    if (!sendAlert(a, env)) continue;
    for (const f of a.fixes) { f.notified = at; sent.push(f); }
  }
  const onBuilds = sent.filter((f) => f.buildId);
  if (onBuilds.length) {
    try {
      withStore((s) => {
        for (const f of onBuilds) { const r = (s.builds.find((b) => b.id === f.buildId)?.recoveries ?? []).find((x) => x.at === f.at && x.action === f.action); if (r) r.notified = at; }
        return s;
      }, { by: 'watchdog', action: W.JOURNAL_ACTION, note: `notified ${onBuilds.map((f) => f.buildId).join(', ')}`.slice(0, 300) });
    } catch { /* the push went out; the record says so next time */ }
  }
  return { alerts: sent.length, notified: at };
}

// ------------------------------------------------------------------ schedule: the axf-watchdog cron

export const CRON_NAME = 'axf-watchdog';
export const cronFile = (env = process.env) => env.AXF_WATCHDOG_CRON || `/etc/cron.d/${CRON_NAME}`;
export const requestFile = (env = process.env) => join(pipeDir(env), 'build-watchdog-request.json');
export const CRON_LOG = '/var/log/axf-watchdog.log';

/** The cron file: every minute, one pass at a time (flock), removes itself when the plugin is gone. */
export function cronText(dir = resolve(HERE, '../../../..'), env = process.env) {
  const w = join(dir, 'apps/console-web/plugins/build-orchestrator/recovery-watchdog.mjs');
  return [
    '# AXF build watchdog (apps/console-web/plugins/build-orchestrator/recovery-watchdog.mjs, build-watchdog@1). Removes itself when the plugin is gone.',
    'SHELL=/bin/sh', 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', '',
    `* * * * * root if [ -f "${w}" ]; then cd "${dir}" && flock -n /run/axf-watchdog.lock timeout 300 node "${w}" cron >> ${CRON_LOG} 2>&1; else rm -f ${cronFile(env)}; fi`, '',
  ].join('\n');
}
/** Write the cron file (0644, as cron requires). { ok, file, skipped? } — skipped where there is no cron.d to write (a container, CI). */
export function installCron({ dir, env = process.env } = {}) {
  const f = cronFile(env);
  if (!existsSync(dirname(f))) return { ok: true, file: f, skipped: `${dirname(f)} does not exist here (not the VPS host)` };
  try { writeFileSync(`${f}.tmp`, cronText(dir, env), { mode: 0o644 }); renameSync(`${f}.tmp`, f); return { ok: true, file: f }; }
  catch (e) { return { ok: false, file: f, error: str(e.message, 200) }; }
}
export function removeCron(env = process.env) {
  const f = cronFile(env);
  try { const had = existsSync(f); rmSync(f, { force: true }); return { ok: true, file: f, removed: had }; } catch (e) { return { ok: false, file: f, error: str(e.message, 200) }; }
}
export const cronInstalled = (env = process.env) => existsSync(cronFile(env));

/** Ask the host for a pass (the console and voice): the next cron pass runs it, within a minute. */
export function requestRun({ by = process.env.AXF_ACTOR || 'console', build = '', env = process.env } = {}) {
  const r = { at: new Date().toISOString(), by: str(by, 80), build: str(build, 80) };
  mkdirSync(dirname(requestFile(env)), { recursive: true });
  writeFileSync(requestFile(env), `${JSON.stringify(r)}\n`);
  return r;
}

/** The cron's pass: due when on and intervalMin has passed, or asked for. Returns the pass, or { ran: false, why }. */
export function cronPass({ env = process.env, now = Date.now() } = {}) {
  const settings = loadSettings(env);
  const asked = readJson(requestFile(env));
  const last = Date.parse(loadState(env).lastPass || 0) || 0;
  if (!asked && !settings.enabled) return { ran: false, why: 'the watchdog is off (Settings → Plugins → Build orchestrator → Watchdog)' };
  if (!asked && now - last < settings.intervalMin * 60e3 - 5e3) return { ran: false, why: `next pass due ${new Date(last + settings.intervalMin * 60e3).toISOString()}` };
  try { rmSync(requestFile(env), { force: true }); } catch { /* gone */ }
  return { ran: true, asked: asked ?? null, ...run({ env, settings: asked && !settings.enabled ? { ...settings, enabled: true } : settings, only: asked?.build || '' }) };
}

// ------------------------------------------------------------------ CLI

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) out[k] = true; else { out[k] = v; i += 1; } } else out._.push(a);
  }
  return out;
}

/** The words `axf watchdog <word>` runs (plugin.json "cli": { "watchdog": "watchdog.mjs" }). */
export const cliWords = ['status', 'scan', 'run', 'set', 'settings', 'recoveries', 'requeue', 'request'];

export async function main(argv = process.argv.slice(2)) {
  const [cmd = 'scan', ...rest] = argv;
  const f = flags(rest);
  const out = (o, text) => console.log(f.json ? JSON.stringify(o, null, 1) : text);
  if (cmd === 'scan') {
    const r = scan();
    return out(r, r.builds.length ? [`${r.builds.length} marked running · ${r.stuck.length} stuck${r.settings.enabled ? '' : ' · watchdog off'}`, ...r.builds.map((x) => `  ${x.decision.stuck ? '!' : ' '} ${line(x)}`)].join('\n') : 'nothing marked running');
  }
  if (cmd === 'run') {
    const r = run({ only: typeof f.build === 'string' ? f.build : '' });
    if (r.errors.length) process.exitCode = 1;
    return out(r, [`pass ${r.at}: ${r.scan.builds.length} marked running · ${r.fixes.length} fixed · ${r.skipped.length} left${r.errors.length ? ` · ${r.errors.length} failed` : ''}`,
      ...(r.fill.launched.length ? [`  filled slots: started ${r.fill.launched.join(', ')}`] : []), ...(r.fill.idle ? [`  idle-slots: ${r.fill.idle.note}`] : []),
      ...r.fixes.map((x) => `  fixed ${x.buildId}: ${x.cause} → ${x.action}${x.attempt ? ` (attempt ${x.attempt})` : ''}`), ...r.skipped.map((x) => `  left ${x.id}: ${x.why}`), ...r.errors.map((x) => `  failed ${x.id}: ${x.error}`)].join('\n'));
  }
  if (cmd === 'status') {
    const r = status();
    return out(r, [`watchdog ${r.settings.enabled ? 'on' : 'off'} · cron ${r.cron.installed ? 'installed' : 'missing'} · last pass ${r.lastPass || 'never'}${r.ageMin != null ? ` (${r.ageMin} min ago)` : ''}${r.stale ? ' · STALE' : ''} · ${r.passes} passes`,
      ...(r.lastScan ? [`last scan: ${r.lastScan.builds.length} running, ${r.lastScan.builds.filter((b) => b.stuck).length} stuck`] : []),
      ...r.gaveUp.map((g) => `  gave up: ${g.id} (${g.cause}, attempt ${g.attempt})`), ...r.recent.slice(0, 10).map((x) => `  ${x.at} ${x.buildId || 'slots'}: ${x.cause} → ${x.action}${x.attempt ? ` #${x.attempt}` : ''}${x.notified ? ' · told the phone' : ''}`)].join('\n'));
  }
  if (cmd === 'settings') return out({ ok: true, settings: loadSettings(), keys: SETTING_KEYS, defaults: { ...W.DEFAULTS, ...EXTRA_DEFAULTS } }, JSON.stringify(loadSettings(), null, 1));
  if (cmd === 'set') {
    const patch = typeof f.patch === 'string' ? JSON.parse(f.patch) : Object.fromEntries(f._.map((kv) => { const i = kv.indexOf('='); if (i < 1) throw Object.assign(new Error(`set key=value (keys: ${SETTING_KEYS.join(', ')})`), { code: 2 }); return [kv.slice(0, i), kv.slice(i + 1)]; }));
    const r = saveSettings(patch, { by: typeof f.by === 'string' ? f.by : undefined });
    return out({ ok: true, settings: r }, `saved: ${Object.keys(patch).map((k) => `${k}=${r[k]}`).join(' · ')}`);
  }
  if (cmd === 'recoveries') {
    const id = f._[0]; if (!id) throw Object.assign(new Error('recoveries <build>'), { code: 2 });
    const b = loadStore().builds.find((x) => x.id === id || (x.aliases ?? []).includes(id));
    if (!b) throw Object.assign(new Error(`no build "${id}"`), { code: 2 });
    const list = W.normRecoveries(b.recoveries);
    return out({ ok: true, build: b.id, status: b.status, retries: retriesOf(sinceGiveUp(b)), recoveries: list }, list.length ? list.map((r) => `${r.at} ${r.cause} → ${r.action}${r.attempt ? ` #${r.attempt}` : ''}${r.notified ? ' · told the phone' : ''} · ${r.note}`).join('\n') : `${b.id}: no recoveries`);
  }
  if (cmd === 'requeue') { const r = requeueGaveUp(f._); if (r.failed.length) process.exitCode = 1; return out({ ok: !r.failed.length, ...r }, `requeued ${r.requeued.join(', ') || 'nothing'}${r.failed.length ? ` · failed ${r.failed.map((x) => `${x.id}: ${x.error}`).join('; ')}` : ''}`); }
  if (cmd === 'cron') {
    const r = cronPass();
    if (!r.ran) return f.json ? out(r, '') : undefined; // quiet when not due: the cron log stays readable
    return out(r, `${r.at} pass${r.asked ? ` (asked by ${r.asked.by})` : ''}: ${r.scan.builds.length} running · ${r.fixes.length} fixed${r.fixes.map((x) => ` · ${x.buildId} ${x.cause}→${x.action}`).join('')}${r.fill.launched.length ? ` · started ${r.fill.launched.join(', ')}` : ''}${r.fill.idle ? ' · idle-slots' : ''}${r.errors.length ? ` · ${r.errors.length} failed` : ''}`);
  }
  if (cmd === 'request') { const r = requestRun({ by: typeof f.by === 'string' ? f.by : undefined, build: typeof f.build === 'string' ? f.build : '' }); return out({ ok: true, ...r }, `asked the host for a watchdog pass (${r.at}): the next cron minute runs it`); }
  if (cmd === 'install-cron') { const r = installCron({ dir: typeof f.dir === 'string' ? f.dir : undefined }); if (!r.ok) process.exitCode = 1; return out(r, r.ok ? (r.skipped ? `cron not installed: ${r.skipped}` : `installed ${r.file}`) : `cron not installed: ${r.error}`); }
  if (cmd === 'remove-cron') { const r = removeCron(); if (!r.ok) process.exitCode = 1; return out(r, r.ok ? (r.removed ? `removed ${r.file}` : `${r.file} was not there`) : `not removed: ${r.error}`); }
  throw Object.assign(new Error(`unknown command ${cmd} (status, scan, run, settings, set, recoveries, requeue, cron, request, install-cron, remove-cron)`), { code: 2 });
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  main().catch((e) => { if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(`watchdog: ${e.message}`); process.exitCode = e.code === 2 ? 2 : 1; });
}

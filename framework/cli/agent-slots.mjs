#!/usr/bin/env node
/**
 * agent-slots.mjs — agent-slots@1: a configurable cap on how many headless Claude sessions run at once on the VPS,
 * with a queue for the rest (Brett, Nov 1 2026: "16 GB of RAM… I want a configurable cap; extras wait in line").
 *
 * Everything that starts `claude -p` (deploy/claude-headless.sh, the agent swarm runner, orchestrator launches through
 * that script, axHub vps.build_start) asks here first. A start that fits takes a slot at once; one that doesn't joins
 * the queue (FIFO within its priority: boss, urgent, high, normal, low) and starts by itself when a slot frees and memory
 * allows. Sessions that finished and only wait to close don't count, and are closed after `closeFinishedAfterSec`
 * (their logs stay). Heavy steps (pnpm/vite builds, docker node:22 test runs, Playwright) take a second, smaller lock
 * (`heavy -- <cmd>`).
 *
 * One store, shared by the host and the console container: <dir>/settings.json (hot-reloaded: read on every call),
 * <dir>/state.json (running, queue, heavy, guard trips, swap), written under a mkdir lock. <dir> = $AXF_SLOTS_DIR, else
 * /projects/amberx-axf/_data/agent-slots where the hub is mounted, else ~/.axf/agent-slots. Liveness (pid, tmux) is
 * only judged on the host that started an entry, so the console never drops the VPS's sessions.
 *
 *   node framework/cli/agent-slots.mjs status [--json]           slots used / cap, the queue, heavy lock, memory
 *   … enqueue --name n [--kind headless|swarm] [--priority boss|urgent|high|normal|low] [--build id] [--pid N] [--cwd d] [--agent id] [--json|--sh]
 *   … wait <id> [--pid N]          block until the entry starts (exit 0) or is cancelled (exit 4)
 *   … claim <id>                   one try: exit 0 started, 3 still waiting, 4 gone
 *   … bind <id> --pid N [--session s] · finish <id> [--exit N] · release <id>
 *   … run-end [<slot>] --build b --exit N [--signal s] [--kind k] [--limit usage|auth] [--account a] [--session s]
 *                                  how a run ended: <dir>/runs/<build>.json (run-status@1) + the slot's exit (watchdog evidence)
 *   … alive <build> [--dir worktree] [--since iso] [--json]   liveness probe for the watchdog (build-watchdog@1 probe):
 *                                  pid (a claude process in its worktree / with its AXF_BUILD_ID), tmux (axf-<build>*), the
 *                                  heartbeat (newest of its log, its meter, its build lock), the exit recorded since --since
 *   … reap [--json]                free orphan slots: entries whose process is gone (no pid, no tmux, or a pane with no claude)
 *   … cancel <id> · up <id>        queue actions (the console's Builds page)
 *   … data status|cutover|local [--apply] [--json]   the state on axf-data's agent_slots table (data-store@1 key mode)
 *   … reprioritise <build> <level> a build's priority changed: its waiting entries follow it (Move up still wins)
 *   … settings [--json] · set key=value… | set --json '{…}' · get <key>
 *   … heavy [--label l] -- <cmd…>  run a heavy step under the test/build lock
 *   … sweep                        close finished tmux sessions, count unregistered axf-* ones
 *
 * Hard limit (build-limit@1, Nov 12 2026): framework/cli/build-limit.mjs counts what really runs on the host and refuses
 * the N+1st build whatever this queue thinks. Here maxAgents is capped at that limit (settings keep the value asked for
 * as maxAgentsSet), status carries `hard` { max, live, free } and `free` is the smaller of the two. Heavy steps run in
 * axf-builds.slice (systemd-run --scope) with the docker shim first on PATH (--cpus / --memory on test containers).
 * Only Queued builds take slots (Brett, Nov 12 2026): a waiting entry whose build is no longer Queued / Running (moved
 * back to Pending, built, failed…) is dropped instead of started (framework/cli/dispatch-gate.mjs buildMayTakeSlot).
 */

/*
 * Emergency slots (Brett, Nov 20 2026): a second pool beside the cap. An entry of a build that holds an emergency grant
 * (build-limit.mjs grantEmergency: Brett's signed-in console only) queues and starts in the emergency pool
 * (`emergencySlots` places, default 2): it never waits behind the ordinary line and never takes one of its slots, and
 * ordinary entries never take an emergency place. Status carries `emergency` { used, cap, free, queued }.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emergencyIds, loadLimit, poolOf, scopePrefix, usage as hardUsage } from './build-limit.mjs';
import { buildMayTakeSlot } from './dispatch-gate.mjs';
import { claudePids, readLock, sessionOf, tmuxSessions as buildTmux } from './build-lock.mjs';
import * as dataFiles from '../core/data-files.mjs';

export const LEVELS = ['boss', 'urgent', 'high', 'normal', 'low'];
export const DEFAULTS = {
  maxAgents: 6,
  maxHeavy: 3,
  minFreeGb: 2,
  closeFinishedAfterSec: 120,
  pollSec: 10,
  /** First match wins (regex on the session name); an explicit --priority beats every rule. */
  priorityRules: [
    { match: '^(boss|brett)([^a-z]|$)', level: 'boss' },
    { match: '^(urgent|hotfix)([^a-z]|$)', level: 'urgent' },
  ],
  /** Systems check: warn when the memory guard held starts this many times in an hour, or swap stayed in use this long. */
  guardWarnTrips: 5,
  swapWarnMb: 256,
  swapWarnMin: 30,
};
const LIMITS = { maxAgents: [1, 64], maxHeavy: [1, 32], minFreeGb: [0, 64], closeFinishedAfterSec: [0, 86400], pollSec: [2, 300], guardWarnTrips: [1, 1000], swapWarnMb: [0, 65536], swapWarnMin: [1, 1440] };
const GRACE_MS = 120_000;      // a slot just taken counts even before its session is bound
const KEEP_DONE = 50;
const GIB = 1024 ** 3;

/* ---------------- pure core ---------------- */

export function normSettings(raw = {}) {
  const s = { $axf: 'agent-slots-settings@1', ...DEFAULTS };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(raw?.[k]);
    if (raw?.[k] !== undefined && raw[k] !== '' && Number.isFinite(v)) s[k] = Math.min(hi, Math.max(lo, k === 'minFreeGb' ? Math.round(v * 10) / 10 : Math.round(v)));
  }
  if (Array.isArray(raw?.priorityRules)) {
    s.priorityRules = raw.priorityRules
      .filter((r) => r && typeof r.match === 'string' && r.match.length <= 200 && LEVELS.includes(r.level) && validRe(r.match))
      .slice(0, 20).map((r) => ({ match: r.match, level: r.level }));
  }
  return s;
}
const validRe = (src) => { try { new RegExp(src, 'i'); return true; } catch { return false; } };

export function levelFor(name, explicit, settings = DEFAULTS) {
  if (LEVELS.includes(explicit)) return explicit;
  for (const r of settings.priorityRules ?? []) if (validRe(r.match) && new RegExp(r.match, 'i').test(name ?? '')) return r.level;
  return 'normal';
}

export const emptyState = () => ({ $axf: 'agent-slots@1', seq: 0, running: [], queue: [], heavy: [], done: [], guard: { trips: [] }, swap: { since: null, mb: 0 }, updatedAt: '' });

export function normState(raw) {
  const s = { ...emptyState(), ...(raw && typeof raw === 'object' ? raw : {}) };
  for (const k of ['running', 'queue', 'heavy', 'done']) s[k] = Array.isArray(s[k]) ? s[k].filter((x) => x && typeof x.id === 'string') : [];
  s.guard = { trips: Array.isArray(s.guard?.trips) ? s.guard.trips.filter(Number.isFinite).slice(-200) : [] };
  s.swap = { since: Number.isFinite(s.swap?.since) ? s.swap.since : null, mb: Number(s.swap?.mb) || 0 };
  s.seq = Number.isFinite(s.seq) ? s.seq : 0;
  return s;
}

/** Waiting entries in start order: priority level, then their place in line. */
export function ordered(queue) {
  return queue.filter((q) => q.state === 'waiting')
    .sort((a, b) => LEVELS.indexOf(a.priority) - LEVELS.indexOf(b.priority) || a.seq - b.seq);
}

/**
 * The pool an entry (waiting or running) belongs to: `emergency` when its build holds an emergency grant
 * (settings.emergencyBuilds, from build-limit.mjs), else `builds`. Worked out from the grants on every call, never
 * trusted from the entry, so a grant that is taken back moves the entry to the ordinary pool at once.
 */
export function poolOfEntry(e, settings = DEFAULTS) {
  const ids = settings?.emergencyBuilds ?? [];
  if (!ids.length || !e) return 'builds';
  return (e.build && ids.includes(e.build)) || poolOf(e.session || e.name, ids) === 'emergency' ? 'emergency' : 'builds';
}
/** The cap of a pool: maxAgents, or emergencySlots for the emergency pool. */
const poolCap = (settings, pool) => (pool === 'emergency' ? Math.max(0, Number(settings.emergencySlots) || 0) : settings.maxAgents);

/**
 * Sessions holding a slot (finished ones only wait to close and don't count). With `settings`: the ones of one pool
 * (`builds` unless `pool` says emergency); without: every pool together.
 */
export const holding = (state, settings = null, pool = 'builds') => state.running.filter((r) => (r.state === 'running' || r.state === 'starting') && (!settings || poolOfEntry(r, settings) === pool));

/**
 * May queue entry <id> start now? { go, position (1-based), reason: '' | 'cap' | 'memory' | 'gone', free, pool }.
 * Each pool has its own line and its own cap: the first `free` entries of the entry's pool may start. The memory
 * guard holds everyone, emergency entries too, while available memory is under the floor (it protects the host).
 */
export function decide(state, settings, id, memAvailBytes = null) {
  const all = ordered(state.queue);
  const me = all.find((q) => q.id === id);
  if (!me) return { go: false, position: 0, reason: 'gone', free: 0 };
  const pool = poolOfEntry(me, settings);
  const line = all.filter((q) => poolOfEntry(q, settings) === pool);
  const i = line.findIndex((q) => q.id === id);
  const free = Math.max(0, poolCap(settings, pool) - holding(state, settings, pool).length);
  if (i >= free) return { go: false, position: i + 1, reason: 'cap', free };
  if (memAvailBytes != null && settings.minFreeGb > 0 && memAvailBytes < settings.minFreeGb * GIB) return { go: false, position: i + 1, reason: 'memory', free };
  return { go: true, position: i + 1, reason: '', free };
}

/** Moves a waiting entry one place up the line; past the entry ahead of it, it takes that entry's priority. */
export function moveUp(state, id) {
  const line = ordered(state.queue);
  const i = line.findIndex((q) => q.id === id);
  if (i < 0) throw new Error(`${id} isn't waiting in the queue`);
  if (i === 0) return false;
  const e = line[i]; const ahead = line[i - 1];
  e.priority = ahead.priority;
  e.moved = true; // Brett's move outranks the build's priority: reprioritise() leaves this entry where he put it
  line.splice(i, 1); line.splice(i - 1, 0, e);
  line.forEach((q, n) => { q.seq = n + 1; });
  return true;
}

/** A build's priority changed: its entries take the new level, except a waiting entry Brett moved by hand. Returns how many moved. */
export function applyPriority(state, build, level) {
  if (!LEVELS.includes(level)) throw new Error(`unknown level ${level}`);
  const mine = (e) => e.build === build || e.name === build;
  let n = 0;
  for (const q of state.queue) if (mine(q) && !q.moved && q.priority !== level) { q.priority = level; n++; }
  for (const r of state.running) if (mine(r)) r.priority = level;
  return n;
}

export function summary(state, settings, mem = {}, now = Date.now()) {
  const all = ordered(state.queue);
  const line = all.filter((q) => poolOfEntry(q, settings) === 'builds');
  const used = holding(state, settings).length;
  const eUsed = holding(state, settings, 'emergency').length; const eCap = poolCap(settings, 'emergency');
  const tag = (e) => (poolOfEntry(e, settings) === 'emergency' ? { ...e, pool: 'emergency' } : e);
  const eLine = all.filter((q) => poolOfEntry(q, settings) === 'emergency');
  return {
    $axf: 'agent-slots-status@1',
    used, cap: settings.maxAgents, free: Math.max(0, settings.maxAgents - used),
    queued: line.length,
    /** The emergency pool, counted apart: never part of used / cap / free above. */
    emergency: { used: eUsed, cap: eCap, free: Math.max(0, eCap - eUsed), queued: eLine.length },
    heavy: { used: state.heavy.length, cap: settings.maxHeavy, items: state.heavy },
    running: state.running.map(tag),
    queue: [...eLine.map((q, n) => ({ ...q, pool: 'emergency', position: n + 1 })), ...line.map((q, n) => ({ ...q, position: n + 1 }))],
    done: state.done.slice(-20),
    memory: { availGb: mem.avail != null ? Math.round((mem.avail / GIB) * 10) / 10 : null, swapMb: mem.swapMb ?? null, floorGb: settings.minFreeGb },
    guard: { tripsLastHour: state.guard.trips.filter((t) => now - t < 3600_000).length, lastTripAt: state.guard.trips.at(-1) ?? null },
    swap: state.swap,
    settings,
    updatedAt: state.updatedAt,
  };
}

/* ---------------- store ---------------- */

export function slotsDir() {
  if (process.env.AXF_SLOTS_DIR) return process.env.AXF_SLOTS_DIR;
  if (existsSync('/projects/amberx-axf/_data')) return '/projects/amberx-axf/_data/agent-slots';
  return join(homedir(), '.axf', 'agent-slots');
}
const files = () => { const d = slotsDir(); return { dir: d, settings: join(d, 'settings.json'), state: join(d, 'state.json'), lock: join(d, 'state.lock') }; };
const readJson = (f, dflt) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return dflt; } };
function writeJson(f, v) { const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(v, null, 2)}\n`); renameSync(tmp, f); }

/** Read fresh on every call: a change in the console applies to the next check, nothing to restart. */
export function loadSettings() {
  const s = normSettings(readJson(files().settings, {}));
  let hard = null; try { const l = loadLimit(); hard = l.maxBuilds; s.emergencySlots = l.emergencySlots; s.emergencyBuilds = emergencyIds(); } catch { /* no limit file: defaults */ }
  if (hard != null) { s.hardMax = hard; if (s.maxAgents > hard) { s.maxAgentsSet = s.maxAgents; s.maxAgents = hard; } }
  s.emergencySlots ??= 0; s.emergencyBuilds ??= [];
  return s;
}

/** Adds the hard limit's live count to a status: `hard` { max, live, free, source, at }; `free` = the smaller. */
export function withHard(sum, facts = {}) {
  if (facts.hard === false || process.env.AXF_BUILD_LIMIT === 'off') return sum;
  try {
    const h = facts.hard ?? hardUsage();
    sum.hard = { max: h.max, live: h.live, free: h.free, source: h.source, at: h.at, items: h.items ?? [] };
    if (h.free != null) sum.free = Math.min(sum.free, h.free);
    if (h.emergency) { sum.hard.emergency = h.emergency; if (h.emergency.free != null && sum.emergency) sum.emergency.free = Math.min(sum.emergency.free, h.emergency.free); }
  } catch (e) { sum.hard = { error: String(e.message).slice(0, 200) }; }
  return sum;
}
export function saveSettings(patch) {
  const f = files(); mkdirSync(f.dir, { recursive: true });
  const next = normSettings({ ...readJson(f.settings, {}), ...patch });
  writeJson(f.settings, next);
  return next;
}
/**
 * data-store@1 (s4.1 of urgent-all-data-to-postgres-builds-store): the state is the key `console/agent-slots/state.json`
 * and follows its mode. local = the file under the mkdir lock, as before; shadow = the file, then the same document on
 * axf-data (a failure is a drift line); cutover = axf-data's `agent_slots` table only: read with its etag, change, put
 * if it is still that etag, else read again (the rev check replaces the mkdir lock; up to 8 tries); rollback = writes
 * refused. The cut: `agent-slots.mjs data cutover --apply` (copy and verify under the lock, then flip the key).
 */
const stateKey = () => dataFiles.keyFor(files().state);
export const stateMode = () => { const k = stateKey(); return k ? dataFiles.modeOf(k) : 'local'; };
const remoteState = () => ['cutover', 'rollback'].includes(stateMode());
function readRemoteState() { const r = dataFiles.callSync({ op: 'get', key: stateKey() }); return r ? { data: r.data, etag: r.etag } : { data: null, etag: '' }; }
export const loadState = () => normState(remoteState() ? readRemoteState().data : readJson(files().state, null));
export class SlotsConflict extends Error {}
function withRemoteState(fn) {
  if (stateMode() === 'rollback') { const e = new Error('agent-slots: the slots state is rolling back: writes wait until it is local again'); e.code = 'read_only'; throw e; }
  for (let i = 0; ; i += 1) {
    const cur = readRemoteState();
    const st = normState(cur.data);
    const out = fn(st);
    st.updatedAt = new Date().toISOString();
    try { dataFiles.callSync({ op: 'put', key: stateKey(), data: st, ...(cur.etag ? { ifMatch: cur.etag } : { create: true }) }); return out; }
    catch (e) { if (!['conflict', 'exists'].includes(e.code) || i >= 7) throw e; sleepSync(20 + Math.floor(Math.random() * 80)); }
  }
}
function shadowState(st) {
  const key = stateKey(); if (!key || stateMode() !== 'shadow') return;
  try { const cur = dataFiles.callSync({ op: 'get', key }); dataFiles.callSync({ op: 'put', key, data: st, ...(cur ? { ifMatch: cur.etag } : { create: true }) }); }
  catch (e) { dataFiles.logDrift('write', key, 'write-failed', null, null, `${e.code || 'error'}: ${e.message}`); }
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** One writer at a time across the host and the container (mkdir is atomic on the shared folder); stale after 15 s. */
export function withState(fn) {
  if (remoteState()) return withRemoteState(fn);
  return withStateLock((st) => fn(st));
}
/** The local path: the mkdir lock, the file (and the shadow copy). Also what the cut holds while it copies and flips. */
function withStateLock(fn, { write = true } = {}) {
  const f = files(); mkdirSync(f.dir, { recursive: true });
  const until = Date.now() + 15_000;
  for (;;) {
    try { mkdirSync(f.lock); break; } catch {
      try { if (Date.now() - statSync(f.lock).mtimeMs > 15_000) { rmSync(f.lock, { recursive: true, force: true }); continue; } } catch { continue; }
      if (Date.now() > until) throw new Error(`agent-slots: ${f.lock} is held; remove it if no slots command is running`);
      sleepSync(40);
    }
  }
  try {
    const st = normState(readJson(f.state, null));
    const out = fn(st);
    if (!write) return out;
    st.updatedAt = new Date().toISOString();
    writeJson(f.state, st);
    shadowState(st);
    return out;
  } finally { rmSync(f.lock, { recursive: true, force: true }); }
}

/**
 * The cut (`data status | cutover [--apply] | local [--apply]`): under the mkdir lock (no local writer meanwhile) the
 * file is put on axf-data, read back and compared (canonical document, entries per list), then the key flips to cutover.
 * `local --apply` writes axf-data's document back to the file and flips the key to local. Both publish the mode
 * document. Safe to flip only once every writer of the slots (host CLI, console container, cron) runs this code.
 */
export async function dataCut(cmd, { apply = false, by = 'svc:cli' } = {}) {
  const key = stateKey(); if (!key) throw new Error(`the slots folder ${files().dir} is not a data-store@1 path (AXF_SLOTS_DIR?)`);
  const { canonical } = await import('../core/data-store.mjs');
  const MODE = await import('../core/data-store-mode.mjs');
  const dm = await import('./data-mode.mjs');
  const ns = dataFiles.nsIdOf(key); const path = key.slice(ns.length + 1);
  const counts = (d) => Object.fromEntries(['running', 'queue', 'heavy', 'done'].map((k) => [k, normState(d)[k].length]));
  const report = { $axf: 'agent-slots-cut@1', cmd, apply, key, mode: stateMode(), ok: false, local: null, remote: null, flipped: [], problems: [] };
  let changes = []; let state = null;
  withStateLock((localSt) => {
    const remote = (() => { try { return dataFiles.callSync({ op: 'get', key }); } catch (e) { report.problems.push(`axf-data: ${e.code || 'error'}: ${e.message}`); return undefined; } })();
    if (remote === undefined) return;
    report.local = counts(localSt); report.remote = remote ? counts(remote.data) : null;
    if (cmd === 'status') { report.equal = !!remote && canonical(remote.data) === canonical(localSt); report.ok = true; return; }
    if (cmd === 'cutover') {
      if (apply) dataFiles.callSync({ op: 'put', key, data: localSt, ...(remote ? { ifMatch: remote.etag } : { create: true }) });
      const back = apply ? dataFiles.callSync({ op: 'get', key }) : remote;
      report.equal = !!back && canonical(back.data) === canonical(localSt);
      if (apply && !report.equal) report.problems.push('the document read back from axf-data differs from the file');
      report.ok = !report.problems.length;
      if (!apply || !report.ok) return;
      state = dm.readState();
      const r = MODE.transitionKey(state, { ns, path, to: 'cutover', at: new Date().toISOString(), by, verified: { at: new Date().toISOString(), how: 'agent-slots data cutover: document equal, entries per list equal', counts: report.local } });
      state = r.state; changes = r.changes; dm.writeState(state);
    } else if (cmd === 'local') {
      if (!remote) { report.problems.push('no slots state on axf-data'); return; }
      if (apply) writeJson(files().state, normState(remote.data));
      report.ok = true;
      if (!apply) return;
      state = dm.readState();
      const r = MODE.transitionKey(state, { ns, path, to: 'local', at: new Date().toISOString(), by });
      state = r.state; changes = r.changes; dm.writeState(state);
    }
  }, { write: false });
  report.flipped = changes.map((c) => `${c.ns}/${c.key}: ${c.from} → ${c.to}`);
  if (changes.length) { try { await dm.publish(dataFiles.remoteStore(), state, changes, by); report.published = true; } catch (e) { report.publishError = `${e.code || 'error'}: ${e.message}`; } }
  report.mode = stateMode();
  return report;
}

/* ---------------- host facts ---------------- */

export function memInfo() {
  if (process.env.AXF_SLOTS_MEM_GB) return { avail: Number(process.env.AXF_SLOTS_MEM_GB) * GIB, swapMb: Number(process.env.AXF_SLOTS_SWAP_MB ?? 0) };
  try {
    const t = readFileSync('/proc/meminfo', 'utf8');
    const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(t)?.[1] ?? NaN) * 1024;
    const swap = kb('SwapTotal') - kb('SwapFree');
    return { avail: Number.isFinite(kb('MemAvailable')) ? kb('MemAvailable') : null, swapMb: Number.isFinite(swap) ? Math.round(swap / 1024 ** 2) : null };
  } catch { return { avail: null, swapMb: null }; }
}

const HOST = () => process.env.AXF_SLOTS_HOST || hostname();
const pidAlive = (pid) => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const tmuxOff = () => process.env.AXF_SLOTS_TMUX === 'off';

/** axf-* tmux sessions here: name → { pid, created }; null without tmux. */
export function tmuxSessions() {
  if (tmuxOff()) return null;
  // A printable separator: tmux 3.4 prints control characters in -F output as `_`, so a tab joined the fields into one
  // bogus name (`axf-x_1234_1793…`) that was then adopted as a running agent and held a slot forever.
  const r = spawnSync('tmux', ['list-panes', '-a', '-F', '#{session_name}|#{pane_pid}|#{session_created}'], { encoding: 'utf8' });
  if (r.error) return null;
  const out = new Map();
  for (const ln of (r.stdout || '').split('\n')) {
    const [name, pid, created] = ln.split('|');
    if ((name ?? '').startsWith(process.env.AXF_SLOTS_PREFIX || 'axf-') && !out.has(name)) out.set(name, { pid: Number(pid), created: Number(created) * 1000 });
  }
  return out;
}
const tmuxFinished = (name) => /── finished \(exit/.test(spawnSync('tmux', ['capture-pane', '-p', '-t', `=${name}`, '-S', '-40'], { encoding: 'utf8' }).stdout || '');
/** Is a `claude` process running under this pane process? A session that only waits to close has none. */
export function paneHasClaude(pid) {
  const r = spawnSync('ps', ['-e', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8' });
  if (r.error) return true; // can't tell: assume live rather than kill work
  const kids = new Map(); const comm = new Map();
  for (const ln of (r.stdout || '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(ln); if (!m) continue;
    comm.set(+m[1], m[3].trim()); (kids.get(+m[2]) ?? kids.set(+m[2], []).get(+m[2])).push(+m[1]);
  }
  const stack = [pid]; const seen = new Set();
  while (stack.length) {
    const p = stack.pop(); if (seen.has(p)) continue; seen.add(p);
    if (p !== pid && /^claude/.test(comm.get(p) ?? '')) return true;
    stack.push(...(kids.get(p) ?? []));
  }
  return false;
}
const tmuxKill = (name) => spawnSync('tmux', ['kill-session', '-t', `=${name}`]);

/**
 * Drops entries whose process is gone (only for entries this host started), records memory/swap facts. `facts` lets
 * tests pass { alive(entry), now, mem }.
 */
export function prune(st, settings, facts = {}) {
  const now = facts.now ?? Date.now();
  const host = HOST();
  const tm = facts.tmux !== undefined ? facts.tmux : tmuxSessions();
  const alive = facts.alive ?? ((e) => (e.session && tm ? tm.has(e.session) : pidAlive(e.pid)));
  const mine = (e) => (e.host ?? host) === host;
  const young = (e) => now - Date.parse(e.startedAt || e.enqueuedAt || 0) < GRACE_MS;
  // an adopted (legacy) entry exists only because tmux listed its session: once tmux no longer has it, it's gone at once,
  // young or not (a quick run adopted by a sweep before it bound its slot would otherwise hold the cap for the grace time)
  const vanished = (e) => e.kind === 'legacy' && e.session && tm && !tm.has(e.session);
  const gone = [];
  st.running = st.running.filter((e) => {
    if (!mine(e) || ((young(e) && !vanished(e)) || alive(e))) return true;
    gone.push({ ...e, state: e.state === 'finished' ? 'closed' : 'gone', closedAt: new Date(now).toISOString() });
    return false;
  });
  st.queue = st.queue.filter((q) => q.state === 'waiting' && (!mine(q) || young(q) || alive(q)));
  st.heavy = st.heavy.filter((h) => !mine(h) || young(h) || alive(h));
  st.done = [...st.done, ...gone].slice(-KEEP_DONE);
  const mem = facts.mem ?? memInfo();
  if (mem.swapMb != null) {
    const over = mem.swapMb > settings.swapWarnMb;
    st.swap = { since: over ? (st.swap.since ?? now) : null, mb: mem.swapMb };
  }
  return mem;
}

const newId = (st, kind) => `${kind === 'swarm' ? 'sw' : 'hl'}-${Date.now().toString(36)}-${(++st.seq).toString(36)}`;
const clip = (v, n = 120) => String(v ?? '').slice(0, n);

/** Joins the queue and starts at once when it fits. Returns { id, started, position, reason }. */
export function enqueue(opts = {}, facts = {}) {
  const settings = loadSettings();
  return withState((st) => {
    const mem = prune(st, settings, facts);
    const id = newId(st, opts.kind);
    const nowIso = new Date(facts.now ?? Date.now()).toISOString();
    st.queue.push({ id, name: clip(opts.name || 'run', 60), kind: opts.kind === 'swarm' ? 'swarm' : 'headless', priority: levelFor(opts.name, opts.priority, settings), ...(opts.build ? { build: clip(opts.build, 80) } : {}),
      seq: st.seq, state: 'waiting', enqueuedAt: nowIso, pid: Number(opts.pid) || process.ppid, host: HOST(), cwd: clip(opts.cwd ?? process.cwd(), 300), agent: clip(opts.agent, 60), by: clip(opts.by || process.env.AXF_SURFACE || '', 40) });
    return { id, ...tryStart(st, settings, id, mem.avail, facts) };
  });
}

function tryStart(st, settings, id, avail, facts = {}) {
  const now = facts.now ?? Date.now();
  // only Queued builds take slots: an entry whose build went back to Pending (or ended) leaves the queue, never starts
  const q0 = st.queue.find((x) => x.id === id);
  const mayTake = facts.mayTake ?? ((b) => (process.env.AXF_SLOTS_BUILD_CHECK === 'off' ? true : buildMayTakeSlot(b)));
  if (q0?.build && !mayTake(q0.build)) {
    st.queue = st.queue.filter((x) => x.id !== id);
    st.done = [...st.done, { ...q0, state: 'cancelled', cancelledBy: 'not-queued', closedAt: new Date(now).toISOString() }].slice(-KEEP_DONE);
    return { started: false, gone: true, position: 0, reason: 'notqueued', used: holding(st, settings).length, cap: settings.maxAgents };
  }
  const d = decide(st, settings, id, avail);
  const pool = poolOfEntry(q0, settings); const cap = poolCap(settings, pool);
  if (d.reason === 'memory' && now - (st.guard.trips.at(-1) ?? 0) > 60_000) st.guard.trips.push(now);
  if (!d.go) return { started: false, position: d.position, reason: d.reason, used: holding(st, settings, pool).length, cap };
  const q = st.queue.find((x) => x.id === id);
  st.queue = st.queue.filter((x) => x.id !== id);
  st.running.push({ id, name: q.name, kind: q.kind, priority: q.priority, ...(q.build ? { build: q.build } : {}), ...(pool === 'emergency' ? { pool } : {}), state: 'starting', host: q.host, pid: q.pid, session: '', cwd: q.cwd, agent: q.agent, by: q.by,
    enqueuedAt: q.enqueuedAt, startedAt: new Date(now).toISOString(), waitedMs: now - Date.parse(q.enqueuedAt) });
  return { started: true, position: 0, reason: '', used: holding(st, settings, pool).length, cap };
}

/** One try for a waiting entry: { started } | { started:false, position, reason } | { gone:true }. */
export function claim(id, opts = {}, facts = {}) {
  const settings = loadSettings();
  return withState((st) => {
    if (st.running.some((r) => r.id === id)) return { started: true, already: true };
    const q = st.queue.find((x) => x.id === id);
    if (q && opts.pid) q.pid = Number(opts.pid);
    const mem = prune(st, settings, facts);
    if (!st.queue.some((x) => x.id === id)) return { started: false, gone: true };
    return tryStart(st, settings, id, mem.avail, facts);
  });
}

export const bind = (id, { pid, session } = {}) => withState((st) => {
  const r = st.running.find((x) => x.id === id);
  if (!r) return false;
  if (pid) r.pid = Number(pid);
  if (session) r.session = clip(session, 80);
  r.state = 'running';
  return true;
});

export const finish = (id, exit = null) => withState((st) => {
  const r = st.running.find((x) => x.id === id);
  if (!r) return false;
  r.state = 'finished'; r.finishedAt = new Date().toISOString(); r.exit = exit == null ? null : Number(exit);
  return true;
});

export const release = (id, exit = null) => withState((st) => {
  const r = st.running.find((x) => x.id === id);
  st.running = st.running.filter((x) => x.id !== id);
  if (r) st.done = [...st.done, { ...r, state: 'closed', exit: exit == null ? r.exit ?? null : Number(exit), closedAt: new Date().toISOString() }].slice(-KEEP_DONE);
  return Boolean(r);
});

/** <dir>/runs/<build>.json: how the newest run of a build ended (run-status@1), read by the watchdog. */
export const runStatusFile = (build) => join(slotsDir(), 'runs', `${String(build).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80)}.json`);
export function readRunStatus(build) { return build ? readJson(runStatusFile(build), null) : null; }
export function writeRunStatus(slot, o = {}) {
  const exit = o.exit === '' || o.exit == null || o.exit === true ? null : Number(o.exit);
  const rec = { $axf: 'run-status@1', build: clip(o.build, 80), slot: clip(slot, 60), session: clip(o.session, 120), exit: Number.isInteger(exit) ? exit : null,
    signal: clip(o.signal, 8), kind: clip(o.kind, 20), limit: ['usage', 'auth'].includes(o.limit) ? o.limit : '', account: clip(o.account, 40), host: HOST(), pid: Number(o.pid) || null, endedAt: new Date().toISOString() };
  if (rec.build) { mkdirSync(join(slotsDir(), 'runs'), { recursive: true }); writeJson(runStatusFile(rec.build), rec); }
  if (slot) withState((st) => { const r = st.running.find((x) => x.id === slot); if (r) { r.exit = rec.exit; r.signal = rec.signal; r.endedAt = rec.endedAt; } });
  return rec;
}

/* ---------------- liveness (build-watchdog@1) ---------------- */

const mtimeIso = (f) => { try { return statSync(f).mtime.toISOString(); } catch { return ''; } };
const newest = (xs) => xs.filter(Boolean).sort().pop() ?? '';
const worktreesRoot = () => process.env.AXF_PIPELINE_WORKTREES || '/root/axf-builds';
const headlessDir = () => process.env.AXF_HEADLESS_DIR || '/var/tmp/axf-headless';

/**
 * Is anything alive for this build? A build-watchdog@1 probe plus what it saw:
 *   { build, at, pid, tmux, lastSeenAt, exit, exitKind, limit, pids, sessions, slots, heartbeat: {log, meter, lock}, runStatus, dir }
 * pid / tmux are null when they can't be judged here (AXF_SLOTS_TMUX=off, no /proc). `since` (ISO, the launch time):
 * an exit recorded before it belongs to an older run and is ignored. `facts` lets tests pass { pids, sessions, now }.
 */
export function alive(build, { dir = '', since = '', facts = {} } = {}) {
  const st = loadState();
  const slots = st.running.filter((r) => r.build === build || (r.session && sessionOf(build, r.session)));
  const wt = dir || slots.find((r) => r.cwd)?.cwd || join(worktreesRoot(), build);
  const sessions = facts.sessions ?? (tmuxOff() ? null : buildTmux(build));
  const pids = facts.pids ?? (existsSync('/proc') && process.env.AXF_BUILD_LOCK_PIDS !== 'off' ? claudePids(build, existsSync(wt) ? wt : '') : null);
  const logs = existsSync(wt) ? [join(wt, `${build}.log`), join(wt, '.axf-headless.log')].map(mtimeIso) : [];
  const meters = (sessions ?? []).concat(slots.map((r) => r.session).filter(Boolean)).map((n) => mtimeIso(join(headlessDir(), `${n}.meter.json`)));
  const lock = existsSync(wt) ? readLock(wt) : null;
  const hb = { log: newest(logs), meter: newest(meters), lock: lock?.build === build ? (lock.beat || lock.at || '') : '' };
  const rs = readRunStatus(build);
  const fresh = rs && (!since || String(rs.endedAt) > since) ? rs : null;
  const kindOf = (k) => (['phase-done', 'crash', 'stopped'].includes(k) ? k : '');
  return {
    $axf: 'build-liveness@1', build, at: new Date(facts.now ?? Date.now()).toISOString(), dir: existsSync(wt) ? wt : '',
    pid: pids == null ? null : pids.length > 0, tmux: sessions == null ? null : sessions.length > 0,
    // the session's own output says it is working; the lock beat is the dispatcher's and only counts when nothing else wrote
    lastSeenAt: newest([hb.log, hb.meter]) || hb.lock,
    exit: fresh ? fresh.exit : null, exitKind: fresh ? kindOf(fresh.kind) : '', limit: fresh?.limit ?? '',
    pids: pids ?? [], sessions: sessions ?? [], slots: slots.map((r) => ({ id: r.id, state: r.state, session: r.session, pid: r.pid, exit: r.exit ?? null })), heartbeat: hb, runStatus: rs,
  };
}

/**
 * Orphan slot reaping: running entries this host started, past the start grace, whose process is gone (pid dead and no
 * tmux session) or whose tmux pane has no claude left while the entry still says running (crashed, never finished). Freed
 * at once (state 'reaped' in done). Returns { reaped: [{ id, build, session, why }] }.
 */
export function reap(facts = {}) {
  const now = facts.now ?? Date.now();
  const tm = facts.tmux !== undefined ? facts.tmux : tmuxSessions();
  const hasClaude = facts.hasClaude ?? paneHasClaude;
  const isAlive = facts.pidAlive ?? pidAlive;
  const reaped = [];
  withState((st) => {
    st.running = st.running.filter((r) => {
      if ((r.host ?? HOST()) !== HOST() || now - Date.parse(r.startedAt || r.enqueuedAt || 0) < GRACE_MS) return true;
      const inTmux = !!(r.session && tm && tm.has(r.session));
      let why = '';
      if (!inTmux && !isAlive(r.pid)) why = 'process gone';
      else if (inTmux && r.state === 'running' && !hasClaude(tm.get(r.session).pid)) why = 'no claude left in its session';
      if (!why) return true;
      reaped.push({ id: r.id, build: r.build ?? '', session: r.session ?? '', why });
      st.done = [...st.done, { ...r, state: 'reaped', why, closedAt: new Date(now).toISOString() }].slice(-KEEP_DONE);
      return false;
    });
  });
  return { reaped };
}

export const cancel = (id, by = '') => withState((st) => {
  const q = st.queue.find((x) => x.id === id && x.state === 'waiting');
  if (!q) throw new Error(`${id} isn't waiting in the queue`);
  st.queue = st.queue.filter((x) => x !== q);
  st.done = [...st.done, { ...q, state: 'cancelled', cancelledBy: clip(by, 40), closedAt: new Date().toISOString() }].slice(-KEEP_DONE);
  return true;
});

export const up = (id) => withState((st) => moveUp(st, id));
export const reprioritise = (build, level) => withState((st) => applyPriority(st, build, level));

/** Blocks until the entry starts (true) or leaves the queue (false). onWait(info) is told the position on each poll. */
export async function waitFor(id, opts = {}) {
  for (;;) {
    const r = claim(id, opts);
    if (r.started) return true;
    if (r.gone) return false;
    opts.onWait?.(r);
    await new Promise((res) => setTimeout(res, (opts.pollMs ?? loadSettings().pollSec * 1000)));
  }
}

/** For node callers (the swarm runner): wait for a slot, run fn, give the slot back. Without a store it just runs. */
export async function withSlot(opts, fn) {
  let id = '';
  try {
    const r = enqueue({ ...opts, pid: process.pid });
    id = r.id;
    if (!r.started) { opts.onQueued?.(r); if (!(await waitFor(id, { pid: process.pid, pollMs: opts.pollMs }))) throw new Error(`${opts.name}: cancelled while waiting for a slot`); }
    bind(id, { pid: process.pid });
  } catch (e) { if (/cancelled/.test(e.message)) throw e; id = ''; }
  try { return await fn(); } finally { if (id) try { release(id); } catch { /* store gone */ } }
}

/** Heavy-step lock (pnpm/vite builds, docker test runs, Playwright): at most maxHeavy at once. */
let heavySeq = 0;
export async function withHeavy(label, fn, opts = {}) {
  // unique per call: two calls in one process within the same millisecond must not share an id, or the first to finish
  // releases both slots (seen in CI as a peak of 3 under a cap of 2)
  heavySeq += 1;
  const id = `hv-${process.pid}-${Date.now().toString(36)}-${heavySeq.toString(36)}`;
  for (let first = true; ; first = false) {
    const settings = loadSettings();
    const got = withState((st) => {
      prune(st, settings, opts.facts);
      if (st.heavy.length >= settings.maxHeavy) return false;
      st.heavy.push({ id, label: clip(label, 80), pid: opts.pid ?? process.pid, host: HOST(), startedAt: new Date().toISOString() });
      return true;
    });
    if (got) break;
    if (first) opts.onWait?.();
    await new Promise((res) => setTimeout(res, opts.pollMs ?? 3000));
  }
  try { return await fn(); } finally { withState((st) => { st.heavy = st.heavy.filter((h) => h.id !== id); }); }
}

/**
 * Host housekeeping: finished registered sessions past their grace are closed; unregistered axf-* sessions (started
 * before the cap, or by hand) count as running until they show the finished line, then they're closed too.
 */
export function sweep(facts = {}) {
  const settings = loadSettings();
  const tm = facts.tmux !== undefined ? facts.tmux : tmuxSessions();
  if (!tm) return { closed: [], adopted: [] };
  const now = facts.now ?? Date.now();
  const finished = facts.finished ?? tmuxFinished;
  const kill = facts.kill ?? tmuxKill;
  const hasClaude = facts.hasClaude ?? paneHasClaude;
  const closed = []; const adopted = [];
  withState((st) => {
    const known = new Set(st.running.map((r) => r.session).filter(Boolean));
    for (const r of st.running) {
      if (r.state === 'finished' && r.session && tm.has(r.session) && now - Date.parse(r.finishedAt) >= settings.closeFinishedAfterSec * 1000) { kill(r.session); closed.push(r.session); }
      if (r.kind === 'legacy' && r.state === 'running' && tm.has(r.session) && (finished(r.session) || (now - Date.parse(r.startedAt) > GRACE_MS && !hasClaude(tm.get(r.session).pid)))) { kill(r.session); closed.push(r.session); }
    }
    for (const [name, info] of tm) {
      if (known.has(name)) continue;
      if (finished(name)) { kill(name); closed.push(name); continue; }
      // a session with no live claude -p (finished, line scrolled off or crashed) is not busy: never adopt it
      if (now - (info.created || now) > GRACE_MS && !hasClaude(info.pid)) { kill(name); closed.push(name); continue; }
      st.running.push({ id: `lg-${name}`, name: name.replace(/^axf-/, ''), kind: 'legacy', priority: 'normal', state: 'running', host: HOST(), pid: info.pid, session: name, cwd: '', agent: '', by: '',
        enqueuedAt: new Date(info.created || now).toISOString(), startedAt: new Date(info.created || now).toISOString(), waitedMs: 0 });
      adopted.push(name);
    }
    const left = new Map([...tm].filter(([n]) => !closed.includes(n)));
    prune(st, settings, { ...facts, tmux: left });
  });
  return { closed, adopted };
}

export function status(facts = {}) {
  const settings = loadSettings();
  let mem = {};
  const st = withState((s) => { mem = prune(s, settings, facts); return s; });
  return withHard(summary(st, settings, mem, facts.now), facts);
}

/* ---------------- CLI ---------------- */

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out['--'] = argv.slice(i + 1); break; }
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) out[k] = true; else { out[k] = v; i++; } }
    else out._.push(a);
  }
  return out;
}

const ago = (iso) => { const s = Math.round((Date.now() - Date.parse(iso)) / 1000); return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`; };

async function cli(argv) {
  const [cmd = 'status', ...rest] = argv;
  const f = flags(rest);
  const json = (v) => console.log(JSON.stringify(v, null, f.json ? 2 : 0));
  switch (cmd) {
    case 'data': {
      const sub = ['status', 'cutover', 'local'].includes(rest[0]) ? rest[0] : 'status';
      const r = await dataCut(sub, { apply: !!f.apply, by: typeof f.by === 'string' ? f.by : 'svc:cli' });
      if (f.json) json(r);
      else {
        console.log(`agent-slots data ${sub}: ${r.ok ? (r.apply ? 'done' : 'ready') : 'NOT ok'} · key ${r.key} · mode ${r.mode}${r.equal !== undefined ? ` · ${r.equal ? 'equal' : 'differs'}` : ''}`);
        console.log(`  local ${JSON.stringify(r.local)}  remote ${JSON.stringify(r.remote)}`);
        for (const x of r.problems) console.log(`  ✗ ${x}`);
        for (const x of r.flipped) console.log(`  → ${x}`);
        if (r.publishError) console.log(`  (mode document not published to axf-data: ${r.publishError}; the local mode file is what every client reads)`);
      }
      if (!r.ok) process.exitCode = 1;
      return;
    }
    case 'status': {
      if (!f['no-sweep']) sweep();
      const s = status();
      if (f.json) return json(s);
      console.log(`slots ${s.used}/${s.cap} · emergency ${s.emergency.used}/${s.emergency.cap}${s.hard?.max ? ` · hard limit ${s.hard.live ?? '?'}/${s.hard.max} running on the VPS` : ''} · ${s.queued} queued · heavy ${s.heavy.used}/${s.heavy.cap} · memory ${s.memory.availGb ?? '?'} GB free (floor ${s.memory.floorGb})${s.memory.swapMb ? ` · swap ${s.memory.swapMb} MB` : ''}`);
      for (const r of s.running) console.log(`  ${r.state.padEnd(9)} ${r.name} (${r.kind}, ${r.pool === 'emergency' ? 'emergency' : r.priority}) ${r.session || `pid ${r.pid}`} · ${ago(r.startedAt)}`);
      for (const q of s.queue) console.log(`  #${q.position} waiting ${q.name} (${q.pool === 'emergency' ? 'emergency' : q.priority}) since ${ago(q.enqueuedAt)} · ${q.id}`);
      return;
    }
    case 'enqueue': {
      const r = enqueue({ name: f.name, kind: f.kind, priority: f.priority, build: f.build, pid: f.pid, cwd: f.cwd, agent: f.agent, by: f.by });
      if (f.sh) return console.log(`slot_id=${r.id} slot_started=${r.started ? 1 : 0} slot_pos=${r.position} slot_reason=${r.reason || 'none'}`);
      return f.json ? json(r) : console.log(r.started ? `started ${r.id}` : `queued at position ${r.position} (${r.id}${r.reason === 'memory' ? ', waiting for memory' : ''})`);
    }
    case 'claim': {
      const r = claim(f._[0], { pid: f.pid });
      if (f.json) json(r); else console.log(r.started ? 'started' : r.gone ? 'gone' : `queued at position ${r.position}`);
      process.exitCode = r.started ? 0 : r.gone ? 4 : 3; return;
    }
    case 'wait': {
      let last = 0;
      const ok = await waitFor(f._[0], { pid: f.pid, onWait: (r) => { if (r.position !== last) { last = r.position; console.log(`queued at position ${r.position}${r.reason === 'memory' ? ' (waiting for memory)' : ''}`); } } });
      process.exitCode = ok ? 0 : 4; return;
    }
    case 'bind': return void (bind(f._[0], { pid: f.pid, session: f.session }) || (process.exitCode = 4));
    case 'finish': return void (finish(f._[0], f.exit) || (process.exitCode = 4));
    case 'release': return void (release(f._[0], f.exit) || (process.exitCode = 4));
    case 'run-end': return json(writeRunStatus(f._[0] ?? '', { build: f.build, exit: f.exit, signal: f.signal, kind: f.kind, limit: f.limit, account: f.account, session: f.session, pid: f.pid }));
    case 'alive': {
      if (!f._[0]) throw new Error('alive <build> [--dir worktree] [--since iso]');
      const a = alive(f._[0], { dir: typeof f.dir === 'string' ? f.dir : '', since: typeof f.since === 'string' ? f.since : '' });
      return json(a);
    }
    case 'reap': return json(reap());
    case 'cancel': cancel(f._[0], f.by); return console.log(`cancelled ${f._[0]}`);
    case 'up': return console.log(up(f._[0]) ? `moved ${f._[0]} up` : `${f._[0]} is already first`);
    case 'reprioritise': return console.log(`${reprioritise(f._[0], f._[1])} waiting entr(ies) of ${f._[0]} now ${f._[1]}`);
    case 'settings': return f.json ? json(loadSettings()) : console.log(JSON.stringify(loadSettings(), null, 2));
    case 'get': return console.log(String(loadSettings()[f._[0]] ?? ''));
    case 'set': {
      const patch = typeof f.json === 'string' ? JSON.parse(f.json) : Object.fromEntries(f._.map((kv) => kv.split('=')).map(([k, v]) => [k, v]));
      return console.log(JSON.stringify(saveSettings(patch)));
    }
    case 'heavy': {
      const cmdv = f['--'] ?? [];
      if (!cmdv.length) throw new Error('heavy -- <command…>');
      // in axf-builds.slice (CPU / memory caps for every build), docker test runs through the limits shim
      const shim = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'deploy', 'build-limit');
      const env = existsSync(join(shim, 'docker')) && process.env.AXF_BUILD_SLICE !== 'off' ? { ...process.env, PATH: `${shim}:${process.env.PATH ?? ''}` } : process.env;
      const full = [...scopePrefix('axf-heavy'), ...cmdv];
      const code = await withHeavy(f.label || cmdv.join(' '), () => new Promise((res) => {
        const c = spawn(full[0], full.slice(1), { stdio: 'inherit', env });
        c.on('error', (e) => { console.error(e.message); res(127); });
        c.on('close', (n) => res(n ?? 1));
      }), { onWait: () => console.error(`agent-slots: waiting for a test/build slot (max ${loadSettings().maxHeavy} at once)…`) });
      process.exitCode = code; return;
    }
    case 'sweep': return json(sweep());
    default: throw new Error(`unknown command ${cmd} (status, enqueue, wait, claim, bind, finish, release, run-end, alive, reap, cancel, up, reprioritise, settings, set, get, heavy, sweep)`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli(process.argv.slice(2)).catch((e) => { console.error(`agent-slots: ${e.message}`); process.exitCode = 2; });
}

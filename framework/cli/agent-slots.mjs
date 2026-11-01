#!/usr/bin/env node
/**
 * agent-slots.mjs — agent-slots@1: a configurable cap on how many headless Claude sessions run at once on the VPS,
 * with a queue for the rest (Brett, Nov 1 2026: "16 GB of RAM… I want a configurable cap; extras wait in line").
 *
 * Everything that starts `claude -p` (deploy/claude-headless.sh, the agent swarm runner, orchestrator launches through
 * that script, axHub vps.build_start) asks here first. A start that fits takes a slot at once; one that doesn't joins
 * the queue (FIFO within its priority: boss, urgent, normal, low) and starts by itself when a slot frees and memory
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
 *   … enqueue --name n [--kind headless|swarm] [--priority boss|urgent|normal|low] [--pid N] [--cwd d] [--agent id] [--json|--sh]
 *   … wait <id> [--pid N]          block until the entry starts (exit 0) or is cancelled (exit 4)
 *   … claim <id>                   one try: exit 0 started, 3 still waiting, 4 gone
 *   … bind <id> --pid N [--session s] · finish <id> [--exit N] · release <id>
 *   … cancel <id> · up <id>        queue actions (the console's Builds page)
 *   … settings [--json] · set key=value… | set --json '{…}' · get <key>
 *   … heavy [--label l] -- <cmd…>  run a heavy step under the test/build lock
 *   … sweep                        close finished tmux sessions, count unregistered axf-* ones
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const LEVELS = ['boss', 'urgent', 'normal', 'low'];
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

/** Sessions holding a slot (finished ones only wait to close and don't count). */
export const holding = (state) => state.running.filter((r) => r.state === 'running' || r.state === 'starting');

/**
 * May queue entry <id> start now? { go, position (1-based), reason: '' | 'cap' | 'memory' | 'gone', free }.
 * The first `free` entries in line may start; the memory guard holds everyone while available memory is under the floor.
 */
export function decide(state, settings, id, memAvailBytes = null) {
  const line = ordered(state.queue);
  const i = line.findIndex((q) => q.id === id);
  if (i < 0) return { go: false, position: 0, reason: 'gone', free: 0 };
  const free = Math.max(0, settings.maxAgents - holding(state).length);
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
  line.splice(i, 1); line.splice(i - 1, 0, e);
  line.forEach((q, n) => { q.seq = n + 1; });
  return true;
}

export function summary(state, settings, mem = {}, now = Date.now()) {
  const line = ordered(state.queue);
  const used = holding(state).length;
  return {
    $axf: 'agent-slots-status@1',
    used, cap: settings.maxAgents, free: Math.max(0, settings.maxAgents - used),
    queued: line.length,
    heavy: { used: state.heavy.length, cap: settings.maxHeavy, items: state.heavy },
    running: state.running,
    queue: line.map((q, n) => ({ ...q, position: n + 1 })),
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
export const loadSettings = () => normSettings(readJson(files().settings, {}));
export function saveSettings(patch) {
  const f = files(); mkdirSync(f.dir, { recursive: true });
  const next = normSettings({ ...readJson(f.settings, {}), ...patch });
  writeJson(f.settings, next);
  return next;
}
export const loadState = () => normState(readJson(files().state, null));

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** One writer at a time across the host and the container (mkdir is atomic on the shared folder); stale after 15 s. */
export function withState(fn) {
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
    const st = loadState();
    const out = fn(st);
    st.updatedAt = new Date().toISOString();
    writeJson(f.state, st);
    return out;
  } finally { rmSync(f.lock, { recursive: true, force: true }); }
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
  const r = spawnSync('tmux', ['list-panes', '-a', '-F', '#{session_name}\t#{pane_pid}\t#{session_created}'], { encoding: 'utf8' });
  if (r.error) return null;
  const out = new Map();
  for (const ln of (r.stdout || '').split('\n')) {
    const [name, pid, created] = ln.split('\t');
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
  const gone = [];
  st.running = st.running.filter((e) => {
    if (!mine(e) || young(e) || alive(e)) return true;
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
    st.queue.push({ id, name: clip(opts.name || 'run', 60), kind: opts.kind === 'swarm' ? 'swarm' : 'headless', priority: levelFor(opts.name, opts.priority, settings),
      seq: st.seq, state: 'waiting', enqueuedAt: nowIso, pid: Number(opts.pid) || process.ppid, host: HOST(), cwd: clip(opts.cwd ?? process.cwd(), 300), agent: clip(opts.agent, 60), by: clip(opts.by || process.env.AXF_SURFACE || '', 40) });
    return { id, ...tryStart(st, settings, id, mem.avail, facts) };
  });
}

function tryStart(st, settings, id, avail, facts = {}) {
  const now = facts.now ?? Date.now();
  const d = decide(st, settings, id, avail);
  if (d.reason === 'memory' && now - (st.guard.trips.at(-1) ?? 0) > 60_000) st.guard.trips.push(now);
  if (!d.go) return { started: false, position: d.position, reason: d.reason, used: holding(st).length, cap: settings.maxAgents };
  const q = st.queue.find((x) => x.id === id);
  st.queue = st.queue.filter((x) => x.id !== id);
  st.running.push({ id, name: q.name, kind: q.kind, priority: q.priority, state: 'starting', host: q.host, pid: q.pid, session: '', cwd: q.cwd, agent: q.agent, by: q.by,
    enqueuedAt: q.enqueuedAt, startedAt: new Date(now).toISOString(), waitedMs: now - Date.parse(q.enqueuedAt) });
  return { started: true, position: 0, reason: '', used: holding(st).length, cap: settings.maxAgents };
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

export const cancel = (id, by = '') => withState((st) => {
  const q = st.queue.find((x) => x.id === id && x.state === 'waiting');
  if (!q) throw new Error(`${id} isn't waiting in the queue`);
  st.queue = st.queue.filter((x) => x !== q);
  st.done = [...st.done, { ...q, state: 'cancelled', cancelledBy: clip(by, 40), closedAt: new Date().toISOString() }].slice(-KEEP_DONE);
  return true;
});

export const up = (id) => withState((st) => moveUp(st, id));

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
export async function withHeavy(label, fn, opts = {}) {
  const id = `hv-${process.pid}-${Date.now().toString(36)}`;
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
  return summary(st, settings, mem, facts.now);
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
    case 'status': {
      if (!f['no-sweep']) sweep();
      const s = status();
      if (f.json) return json(s);
      console.log(`slots ${s.used}/${s.cap} · ${s.queued} queued · heavy ${s.heavy.used}/${s.heavy.cap} · memory ${s.memory.availGb ?? '?'} GB free (floor ${s.memory.floorGb})${s.memory.swapMb ? ` · swap ${s.memory.swapMb} MB` : ''}`);
      for (const r of s.running) console.log(`  ${r.state.padEnd(9)} ${r.name} (${r.kind}, ${r.priority}) ${r.session || `pid ${r.pid}`} · ${ago(r.startedAt)}`);
      for (const q of s.queue) console.log(`  #${q.position} waiting ${q.name} (${q.priority}) since ${ago(q.enqueuedAt)} · ${q.id}`);
      return;
    }
    case 'enqueue': {
      const r = enqueue({ name: f.name, kind: f.kind, priority: f.priority, pid: f.pid, cwd: f.cwd, agent: f.agent, by: f.by });
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
    case 'cancel': cancel(f._[0], f.by); return console.log(`cancelled ${f._[0]}`);
    case 'up': return console.log(up(f._[0]) ? `moved ${f._[0]} up` : `${f._[0]} is already first`);
    case 'settings': return f.json ? json(loadSettings()) : console.log(JSON.stringify(loadSettings(), null, 2));
    case 'get': return console.log(String(loadSettings()[f._[0]] ?? ''));
    case 'set': {
      const patch = typeof f.json === 'string' ? JSON.parse(f.json) : Object.fromEntries(f._.map((kv) => kv.split('=')).map(([k, v]) => [k, v]));
      return console.log(JSON.stringify(saveSettings(patch)));
    }
    case 'heavy': {
      const cmdv = f['--'] ?? [];
      if (!cmdv.length) throw new Error('heavy -- <command…>');
      const code = await withHeavy(f.label || cmdv.join(' '), () => new Promise((res) => {
        const c = spawn(cmdv[0], cmdv.slice(1), { stdio: 'inherit' });
        c.on('error', (e) => { console.error(e.message); res(127); });
        c.on('close', (n) => res(n ?? 1));
      }), { onWait: () => console.error(`agent-slots: waiting for a test/build slot (max ${loadSettings().maxHeavy} at once)…`) });
      process.exitCode = code; return;
    }
    case 'sweep': return json(sweep());
    default: throw new Error(`unknown command ${cmd} (status, enqueue, wait, claim, bind, finish, release, cancel, up, settings, set, get, heavy, sweep)`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli(process.argv.slice(2)).catch((e) => { console.error(`agent-slots: ${e.message}`); process.exitCode = 2; });
}

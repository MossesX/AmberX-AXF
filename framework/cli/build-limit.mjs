#!/usr/bin/env node
/**
 * build-limit.mjs — build-limit@1: the VPS's hard limit on headless builds (Brett, Nov 12 2026: "the VPS nearly
 * overloaded (15+ build processes with a cap of 10). Add a HARD limit enforced by the VPS itself, not by Claude or the
 * dispatcher").
 *
 * The soft cap (agent-slots.mjs) books slots and queues; it trusts its own bookkeeping, so launches that bypassed it
 * (AXF_SLOTS=off, a stale state file, a stray `claude -p`) went over. This limit counts what really runs on the host:
 *   - every axf-* tmux session with a live `claude -p` in its pane tree, and every other `claude -p` process tree;
 *   - launches admitted in the last `reserveSec` that have not shown up yet (so two launches can't both take the last place);
 *   - at launch time only, axf-* sessions still setting up (created < `setupSec` ago, not finished, no claude yet).
 * The count and the reservation are taken under one lock (an atomic mkdir in the shared store), so N+1 can never pass.
 *
 * Gates (every path that starts a headless build):
 *   - deploy/claude-headless.sh, before it books a slot: `admit --mode launch` refuses (exit 3) once N run.
 *   - deploy/claude-headless.sh inside tmux, right before `claude -p`, and the agent swarm runner: `admit --mode run --wait`
 *     holds the start until a place is free, whatever the queue thinks.
 *   - the orchestrator's dispatcher and the soft cap read free places from here (agent-slots caps maxAgents at N).
 *
 * Resources (systemd, root on the host): every build process lives in axf-builds.slice (CPUQuota, MemoryMax, MemoryHigh,
 * TasksMax). The inner run re-execs itself into a scope in the slice; `enforce` (a systemd timer, every 30 s) adopts any
 * axf-* pane tree or `claude -p` tree still outside it, and gives docker test containers (node:*, Playwright) --cpus /
 * --memory with `docker update`. Build sessions get a `docker` shim (deploy/build-limit/docker) that adds --cpus,
 * --memory and --cgroup-parent=axf-builds.slice to `docker run` of those images.
 *
 * One config file: <agent-slots dir>/build-limit.json (shared by the host and the console container). Set by Brett only:
 * his signed-in console (Settings → Plugins → Agent cap) or this CLI at a terminal (`set` refuses without a TTY, so a
 * headless session can't raise it). Every change is journalled in build-limit.log.jsonl.
 *
 *   node framework/cli/build-limit.mjs status [--json]                       limit, live usage, what counts, resources
 *   … admit --mode launch|run [--session s] [--pid N] [--name n] [--wait [sec]] [--json]   exit 0 admitted (prints res=<id>) · 3 refused
 *   … release <res-id>                                                      drop a reservation (a launch that queued instead)
 *   … set key=value… [--by brett]                                           Brett at a terminal (or the console after its owner check)
 *   … enforce [--json]                                                      root on the host: slice, adopt strays, docker limits, snapshot
 *   … docker-args <image>                                                   the args the docker shim adds for that image (empty = none)
 *   … slice-unit                                                            the axf-builds.slice unit for the current config
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, homedir, hostname, totalmem } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Standalone on purpose (node built-ins only): deploy/install-build-limit.sh copies this file to /usr/local/lib/axf so
// the VPS enforces the limit even from a checkout that doesn't have it yet. The two helpers below mirror agent-slots.mjs.

/** The agent-slots store (same rule as agent-slots.mjs slotsDir()). */
export function slotsDir() {
  if (process.env.AXF_SLOTS_DIR) return process.env.AXF_SLOTS_DIR;
  if (existsSync('/projects/amberx-axf/_data')) return '/projects/amberx-axf/_data/agent-slots';
  return join(homedir(), '.axf', 'agent-slots');
}

/** axf-* tmux sessions here: name → { pid, created }; null without tmux (same as agent-slots.mjs tmuxSessions()). */
export function tmuxSessions() {
  if (process.env.AXF_SLOTS_TMUX === 'off') return null;
  const r = spawnSync('tmux', ['list-panes', '-a', '-F', '#{session_name}|#{pane_pid}|#{session_created}'], { encoding: 'utf8' });
  if (r.error) return null;
  const out = new Map();
  for (const ln of (r.stdout || '').split('\n')) {
    const [name, pid, created] = ln.split('|');
    if ((name ?? '').startsWith(process.env.AXF_SLOTS_PREFIX || 'axf-') && !out.has(name)) out.set(name, { pid: Number(pid), created: Number(created) * 1000 });
  }
  return out;
}

export const SCHEMA = 'build-limit@1';
export const SLICE = 'axf-builds.slice';
const GIB = 1024 ** 3;
const NCPU = Math.max(1, cpus().length || 1);
const RAM_GB = Math.max(1, Math.round(totalmem() / GIB));

export const DEFAULTS = Object.freeze({
  maxBuilds: 8,
  /** axf-builds.slice: CPU for all builds together (100 = one core), memory ceiling and soft ceiling, process count. */
  cpuQuotaPct: Math.max(100, (NCPU - 2) * 100),
  memoryMaxGb: Math.max(2, Math.round(RAM_GB * 0.6)),
  memoryHighGb: Math.max(1, Math.round(RAM_GB * 0.55)),
  tasksMax: 4096,
  /** Each docker test container (images matching dockerImages). */
  dockerCpus: 2,
  dockerMemoryGb: 4,
  dockerImages: '^(docker\\.io/)?(library/)?node(:|@|$)|^mcr\\.microsoft\\.com/playwright',
  /** An admitted launch counts this long before its session shows up; a session still setting up counts this long at launch. */
  reserveSec: 180,
  setupSec: 600,
});
const LIMITS = { maxBuilds: [1, 64], cpuQuotaPct: [50, 100 * 256], memoryMaxGb: [1, 1024], memoryHighGb: [1, 1024], tasksMax: [64, 1_000_000], dockerCpus: [0.25, 64], dockerMemoryGb: [0.25, 256], reserveSec: [10, 3600], setupSec: [30, 7200] };
export const SETTABLE = [...Object.keys(LIMITS), 'dockerImages'];

/* ---------------- pure core ---------------- */

const validRe = (s) => { try { new RegExp(s); return true; } catch { return false; } };

export function normLimit(raw = {}) {
  const s = { $axf: SCHEMA, ...DEFAULTS };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(raw?.[k]);
    if (raw?.[k] !== undefined && raw[k] !== '' && raw[k] !== null && Number.isFinite(v)) s[k] = Math.min(hi, Math.max(lo, /Cpus|Gb$/.test(k) ? Math.round(v * 4) / 4 : Math.round(v)));
  }
  if (typeof raw?.dockerImages === 'string' && raw.dockerImages.length <= 300 && validRe(raw.dockerImages)) s.dockerImages = raw.dockerImages;
  if (s.memoryHighGb > s.memoryMaxGb) s.memoryHighGb = s.memoryMaxGb;
  for (const k of ['setBy', 'setAt']) if (typeof raw?.[k] === 'string') s[k] = raw[k].slice(0, 80);
  return s;
}

const hasPrintFlag = (argv) => argv.slice(1).some((a) => a === '-p' || a === '--print');
/** A headless claude: the claude binary (or a script named claude) started with -p / --print. */
export function isHeadlessClaude(p) {
  const argv = p.argv ?? [];
  const base = (s) => String(s ?? '').split('/').pop();
  if (base(argv[0]) === 'claude') return hasPrintFlag(argv);
  // a `#!/bin/sh` script named claude: argv = [sh, /path/claude, -p, …]
  if (/^(ba|da)?sh$|^node$/.test(base(argv[0])) && base(argv[1]) === 'claude') return hasPrintFlag(argv.slice(1));
  return false;
}

/**
 * What counts against the limit. facts: { procs: [{ pid, ppid, argv, cwd }], tmux: Map(name → { pid, created }) | null,
 * finished(name) → bool, reservations: [...], now, alive(pid) → bool }. opts: { mode: 'launch' | 'run', self: session or
 * reservation id to leave out, only: RegExp on "<session> <cwd>" (tests) }.
 * Returns { live, items: [{ kind: session|claude|setup|reserved, name, pid, since? }], keep: reservations still open }.
 */
export function countLive(facts, limit, opts = {}) {
  const now = facts.now ?? Date.now();
  const procs = facts.procs ?? [];
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const tm = facts.tmux ?? new Map();
  const paneOf = new Map([...tm].map(([name, info]) => [info.pid, name]));
  const alive = facts.alive ?? ((pid) => byPid.has(pid));
  const only = opts.only ?? null;
  const ancestors = (pid) => { const out = []; let p = byPid.get(pid)?.ppid; for (let i = 0; p && p > 1 && i < 200; i++) { out.push(p); p = byPid.get(p)?.ppid; } return out; };
  const headless = procs.filter(isHeadlessClaude);
  const headSet = new Set(headless.map((p) => p.pid));
  const items = []; const counted = new Set(); const coveredPids = new Set();
  for (const c of headless) {
    const up = ancestors(c.pid);
    if (up.some((a) => headSet.has(a))) continue; // a claude under another one: the outer one counts
    up.forEach((a) => coveredPids.add(a)); coveredPids.add(c.pid);
    const pane = up.map((a) => paneOf.get(a)).find(Boolean) ?? (paneOf.get(c.pid) || '');
    if (only && !only.test(`${pane} ${c.cwd ?? ''}`)) continue;
    if (pane) { if (counted.has(pane)) continue; counted.add(pane); if (pane === opts.self) continue; items.push({ kind: 'session', name: pane, pid: c.pid }); }
    else items.push({ kind: 'claude', name: `pid ${c.pid}${c.cwd ? ` in ${c.cwd}` : ''}`, pid: c.pid });
  }
  if (opts.mode === 'launch') {
    for (const [name, info] of tm) {
      if (counted.has(name) || name === opts.self || (only && !only.test(`${name} `))) continue;
      if (info.created && now - info.created < limit.setupSec * 1000 && !(facts.finished?.(name))) { counted.add(name); items.push({ kind: 'setup', name, pid: info.pid, since: new Date(info.created).toISOString() }); }
    }
  }
  const keep = [];
  for (const r of facts.reservations ?? []) {
    if (!r || now - Date.parse(r.at || 0) > limit.reserveSec * 1000) continue;
    if (r.mode === 'launch' && r.session && [...tm.keys()].some((n) => n.startsWith(r.session))) continue; // its session exists: counted as setup/session
    if (r.mode !== 'launch' && (!alive(r.pid) || coveredPids.has(r.pid))) continue; // gone, or its claude runs and counts
    keep.push(r);
    if (r.id === opts.self || (r.session && r.session === opts.self) || (only && !only.test(`${r.session ?? ''} ${r.cwd ?? ''}`))) continue;
    items.push({ kind: 'reserved', name: r.session || r.name || r.id, pid: r.pid, since: r.at });
  }
  return { live: items.length, items, keep };
}

/** The decision: may one more start? */
export function decide(count, limit) {
  const free = Math.max(0, limit.maxBuilds - count.live);
  return { ok: free > 0, live: count.live, max: limit.maxBuilds, free };
}

/** The axf-builds.slice unit for a config. */
export function sliceUnit(l) {
  return [
    '# Written by framework/cli/build-limit.mjs (build-limit@1) from <agent-slots dir>/build-limit.json. Edits are overwritten.',
    '[Unit]', 'Description=AXF headless builds (claude -p, typechecks, tests, docker test runs)', 'Before=slices.target', '',
    '[Slice]', `CPUQuota=${l.cpuQuotaPct}%`, `MemoryHigh=${l.memoryHighGb}G`, `MemoryMax=${l.memoryMaxGb}G`, 'MemorySwapMax=2G', `TasksMax=${l.tasksMax}`, '',
  ].join('\n');
}

/** What the docker shim adds to `docker run <image>`: [] when the image isn't a test image. */
export function dockerArgs(image, l, { slice = true } = {}) {
  if (!image || !validRe(l.dockerImages) || !new RegExp(l.dockerImages).test(image)) return [];
  return [`--cpus=${l.dockerCpus}`, `--memory=${l.dockerMemoryGb}g`, `--memory-swap=${l.dockerMemoryGb}g`, ...(slice ? [`--cgroup-parent=${SLICE}`] : [])];
}

/* ---------------- store ---------------- */

const files = () => { const d = slotsDir(); return { dir: d, config: join(d, 'build-limit.json'), res: join(d, 'build-limit-res.json'), live: join(d, 'build-limit-live.json'), journal: join(d, 'build-limit.log.jsonl'), lock: join(d, 'build-limit.lock') }; };
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(v, null, 2)}\n`); renameSync(tmp, f); }

/** Read fresh on every call (the console's change applies to the next launch). */
export const loadLimit = () => normLimit(readJson(files().config, {}));

/**
 * Brett only: `owner` must be true (the console's owner check, or a person at a terminal). Returns the new config.
 */
export function saveLimit(patch, { by = '', owner = false } = {}) {
  if (!owner) throw Object.assign(new Error('only Brett sets the hard build limit (his signed-in console, or this CLI at a terminal)'), { code: 3 });
  const f = files(); mkdirSync(f.dir, { recursive: true });
  const before = loadLimit();
  const clean = Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => SETTABLE.includes(k)));
  if (!Object.keys(clean).length) throw Object.assign(new Error(`nothing to set (keys: ${SETTABLE.join(', ')})`), { code: 2 });
  const next = normLimit({ ...readJson(f.config, {}), ...clean, setBy: String(by || 'brett').slice(0, 80), setAt: new Date().toISOString() });
  writeJson(f.config, next);
  const changed = Object.fromEntries(SETTABLE.filter((k) => before[k] !== next[k]).map((k) => [k, [before[k], next[k]]]));
  try { appendFileSync(f.journal, `${JSON.stringify({ at: next.setAt, by: next.setBy, changed })}\n`); } catch { /* journal is best effort */ }
  return next;
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** The launch lock: one count-and-reserve at a time across the host and the container (atomic mkdir; stale after 15 s). */
export function withLock(fn) {
  const f = files(); mkdirSync(f.dir, { recursive: true });
  const until = Date.now() + 20_000;
  for (;;) {
    try { mkdirSync(f.lock); break; } catch {
      try { if (Date.now() - statSync(f.lock).mtimeMs > 15_000) { rmSync(f.lock, { recursive: true, force: true }); continue; } } catch { continue; }
      if (Date.now() > until) throw new Error(`build-limit: ${f.lock} is held; remove it if no build-limit command is running`);
      sleepSync(30);
    }
  }
  try { return fn(f); } finally { rmSync(f.lock, { recursive: true, force: true }); }
}

/* ---------------- host facts ---------------- */

const scanOff = () => process.env.AXF_BUILD_LIMIT_SCAN === 'off';
/** Every process here: { pid, ppid, argv, cwd } (argv/cwd only for claude candidates); null when ps isn't there. */
export function procList() {
  if (scanOff()) return null;
  const r = spawnSync('ps', ['-e', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  const out = [];
  for (const ln of (r.stdout || '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(ln); if (!m) continue;
    const p = { pid: +m[1], ppid: +m[2], comm: m[3].trim() };
    if (/^(claude|sh|bash|dash|node)$/.test(p.comm)) {
      try { p.argv = readFileSync(`/proc/${p.pid}/cmdline`, 'utf8').split('\0').filter(Boolean); } catch { p.argv = []; }
      if (isHeadlessClaude(p)) { try { p.cwd = readlinkSync(`/proc/${p.pid}/cwd`); } catch { p.cwd = ''; } }
    }
    out.push(p);
  }
  return out;
}
const tmuxFinished = (name) => /── finished \(exit/.test(spawnSync('tmux', ['capture-pane', '-p', '-t', `=${name}`, '-S', '-40'], { encoding: 'utf8' }).stdout || '');
const pidAlive = (pid) => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const onlyRe = () => (process.env.AXF_BUILD_LIMIT_ONLY && validRe(process.env.AXF_BUILD_LIMIT_ONLY) ? new RegExp(process.env.AXF_BUILD_LIMIT_ONLY) : null);

/** Host facts, or null when this side can't see the host's processes (the console container): use the snapshot then. */
export function hostFacts() {
  const procs = procList();
  if (!procs) return null;
  const tm = tmuxSessions() ?? new Map();
  const memo = new Map();
  return { procs, tmux: tm, finished: (n) => (memo.has(n) ? memo.get(n) : memo.set(n, tmuxFinished(n)).get(n)), alive: pidAlive, now: Date.now() };
}

const SNAP_FRESH_MS = 90_000;
function snapshot(f, limit, count, now = Date.now()) {
  const v = { $axf: 'build-limit-live@1', at: new Date(now).toISOString(), host: hostname(), live: count.live, max: limit.maxBuilds, items: count.items, slice: sliceStats() };
  try { writeJson(f.live, v); } catch { /* read-only store */ }
  return v;
}

/** Live usage: counted here when this side sees the host, else the host's last snapshot (stale after 90 s). */
export function usage({ facts = null, mode = 'launch' } = {}) {
  const limit = loadLimit();
  const fx = facts ?? hostFacts();
  if (fx) {
    return withLock((f) => {
      const res = readJson(f.res, { reservations: [] }).reservations ?? [];
      const count = countLive({ ...fx, reservations: res }, limit, { mode, only: onlyRe() });
      writeJson(f.res, { reservations: count.keep });
      const snap = snapshot(f, limit, count, fx.now);
      return { ...decide(count, limit), items: count.items, at: snap.at, source: 'host', limit };
    });
  }
  const snap = readJson(files().live, null);
  const fresh = snap && Date.now() - Date.parse(snap.at || 0) < SNAP_FRESH_MS;
  const live = fresh ? Number(snap.live) || 0 : null;
  return { ok: live == null ? true : live < limit.maxBuilds, live, max: limit.maxBuilds, free: live == null ? null : Math.max(0, limit.maxBuilds - live), items: snap?.items ?? [], at: snap?.at ?? null, source: fresh ? 'snapshot' : 'unknown', limit, slice: snap?.slice ?? null };
}

/**
 * The gate. Counts and reserves under the lock: admitted = { ok: true, id }, refused = { ok: false, … }.
 * mode 'launch' (the launcher, before anything starts) or 'run' (right before claude -p; `self` = this session).
 */
export function admit({ mode = 'launch', session = '', name = '', pid = process.ppid, cwd = process.cwd(), facts = null } = {}) {
  const limit = loadLimit();
  const fx = facts ?? hostFacts();
  return withLock((f) => {
    const res = readJson(f.res, { reservations: [] }).reservations ?? [];
    let count;
    if (fx) count = countLive({ ...fx, reservations: res }, limit, { mode, self: session || undefined, only: onlyRe() });
    else { // the container: the host's snapshot plus what was admitted since it was taken
      const snap = readJson(f.live, null);
      const since = Date.parse(snap?.at || 0);
      const extra = res.filter((r) => Date.parse(r.at) > since && Date.now() - Date.parse(r.at) < limit.reserveSec * 1000);
      const base = snap && Date.now() - since < SNAP_FRESH_MS ? snap.items ?? [] : [];
      count = { live: base.length + extra.length, items: [...base, ...extra.map((r) => ({ kind: 'reserved', name: r.session || r.id, pid: r.pid, since: r.at }))], keep: res.filter((r) => Date.now() - Date.parse(r.at) < limit.reserveSec * 1000) };
    }
    const d = decide(count, limit);
    let id = '';
    if (d.ok) {
      id = `bl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      count.keep.push({ id, mode, session: String(session).slice(0, 100), name: String(name || session).slice(0, 100), pid: Number(pid) || 0, cwd: String(cwd).slice(0, 300), at: new Date().toISOString(), host: hostname() });
    }
    writeJson(f.res, { reservations: count.keep });
    if (fx) snapshot(f, limit, { live: d.ok ? count.live + 1 : count.live, items: d.ok ? [...count.items, { kind: 'reserved', name: session || name || id, pid: Number(pid) || 0, since: new Date().toISOString() }] : count.items });
    return { ...d, id, mode, items: count.items };
  });
}

export const release = (id) => withLock((f) => {
  const res = readJson(f.res, { reservations: [] }).reservations ?? [];
  writeJson(f.res, { reservations: res.filter((r) => r.id !== id) });
  return res.some((r) => r.id === id);
});

/** Waits for a place (mode run): polls every pollMs until admitted or `timeoutMs` passes. */
export async function admitWait(opts = {}, { pollMs = 10_000, timeoutMs = 24 * 3600e3, onWait } = {}) {
  const until = Date.now() + timeoutMs;
  for (let first = true; ; first = false) {
    const r = admit(opts);
    if (r.ok || Date.now() > until) return r;
    if (first) onWait?.(r);
    await new Promise((res) => setTimeout(res, pollMs));
  }
}

/* ---------------- systemd / docker (root on the host) ---------------- */

const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 20_000, ...o });
export const inSlice = (pid = 'self') => { try { return readFileSync(`/proc/${pid}/cgroup`, 'utf8').includes(`/${SLICE}/`); } catch { return false; } };
const SLICE_FILE = `/etc/systemd/system/${SLICE}`;
export const sliceReady = () => existsSync(SLICE_FILE) && !run('systemctl', ['is-active', '--quiet', SLICE]).status;

/**
 * `systemd-run --scope` prefix that puts a command in the slice, or [] when it can't (no systemd, not root, already in).
 * Probed once per process.
 */
let scopeOk = null;
export function scopePrefix(unit = '') {
  if (process.env.AXF_BUILD_SLICE === 'off' || inSlice() || !existsSync(SLICE_FILE)) return [];
  if (scopeOk == null) scopeOk = !run('systemd-run', ['--scope', '--quiet', '--collect', `--slice=${SLICE}`, '--', 'true']).status;
  if (!scopeOk) return [];
  return ['systemd-run', '--scope', '--quiet', '--collect', `--slice=${SLICE}`, ...(unit ? [`--unit=${unit.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 80)}-${process.pid}`] : []), '--'];
}

function descendants(procs, root) {
  const kids = new Map();
  for (const p of procs) (kids.get(p.ppid) ?? kids.set(p.ppid, []).get(p.ppid)).push(p.pid);
  const out = []; const stack = [root]; const seen = new Set();
  while (stack.length) { const p = stack.pop(); if (seen.has(p)) continue; seen.add(p); out.push(p); stack.push(...(kids.get(p) ?? [])); }
  return out;
}

/** Moves a process tree into a new scope in the slice (systemd's StartTransientUnit with PIDs). */
export function adopt(name, pids, retry = true) {
  const live = pids.filter((p) => pidAlive(p) && !inSlice(p));
  if (!live.length) return { ok: true, moved: 0 };
  const unit = `axf-adopt-${String(name).replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 60)}-${Date.now().toString(36)}.scope`;
  const r = run('busctl', ['call', 'org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'StartTransientUnit', 'ssa(sv)a(sa(sv))',
    unit, 'fail', '2', 'PIDs', 'au', String(live.length), ...live.map(String), 'Slice', 's', SLICE, '0']);
  if (r.status !== 0 && retry) return adopt(name, live, false); // a pid that ended in between fails the whole call: once more without it
  return { ok: r.status === 0, moved: r.status === 0 ? live.length : 0, error: r.status === 0 ? '' : (r.stderr || '').trim().slice(0, 200) };
}

/** Writes and starts the slice when the config changed (CPUQuota / MemoryMax / …). Returns 'unchanged' | 'applied' | error. */
export function applySlice(limit = loadLimit()) {
  const want = sliceUnit(limit);
  let have = ''; try { have = readFileSync(SLICE_FILE, 'utf8'); } catch { /* first time */ }
  if (have === want && sliceReady()) return 'unchanged';
  try { writeFileSync(SLICE_FILE, want); } catch (e) { return `can't write ${SLICE_FILE}: ${e.code}`; }
  run('systemctl', ['daemon-reload']);
  const st = run('systemctl', ['start', SLICE]);
  if (st.status) return `systemctl start ${SLICE}: ${(st.stderr || '').trim().slice(0, 200)}`;
  // a running slice takes new limits at once
  run('systemctl', ['set-property', '--runtime', SLICE, `CPUQuota=${limit.cpuQuotaPct}%`, `MemoryHigh=${limit.memoryHighGb}G`, `MemoryMax=${limit.memoryMaxGb}G`, `TasksMax=${limit.tasksMax}`]);
  return 'applied';
}

/**
 * Is this container a throwaway test run (and not a service that happens to use a node image)? A test run is started
 * with --rm, or from a build (the shim's cgroup parent); anything with a restart policy is a service and never touched.
 */
export function isTestRun({ autoRemove, restart, cgroupParent }) {
  if (restart && restart !== 'no') return false;
  return autoRemove === true || String(cgroupParent || '').includes(SLICE);
}

/** docker test containers (dockerImages, isTestRun) running without the limits get them (docker update works on a running container). */
export function dockerLimits(limit = loadLimit()) {
  const ps = run('docker', ['ps', '--format', '{{.ID}}|{{.Image}}|{{.Names}}']);
  if (ps.error || ps.status) return { checked: 0, updated: [], error: ps.error ? 'no docker' : (ps.stderr || '').trim().slice(0, 200) };
  const re = new RegExp(limit.dockerImages);
  const updated = []; let checked = 0;
  const wantCpu = Math.round(limit.dockerCpus * 1e9); const wantMem = Math.round(limit.dockerMemoryGb * GIB);
  for (const ln of ps.stdout.split('\n').filter(Boolean)) {
    const [id, image, name] = ln.split('|');
    if (!re.test(image)) continue;
    checked++;
    const ins = run('docker', ['inspect', '-f', '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}} {{.HostConfig.AutoRemove}} {{.HostConfig.RestartPolicy.Name}} {{.HostConfig.CgroupParent}}', id]);
    const [cpuS, memS, autoRemove, restart = '', cgroupParent = ''] = (ins.stdout || '').trim().split(' ');
    if (!isTestRun({ autoRemove: autoRemove === 'true', restart, cgroupParent })) continue;
    const cpu = Number(cpuS); const mem = Number(memS);
    if (cpu > 0 && cpu <= wantCpu && mem > 0 && mem <= wantMem) continue;
    const u = run('docker', ['update', `--cpus=${limit.dockerCpus}`, `--memory=${limit.dockerMemoryGb}g`, `--memory-swap=${limit.dockerMemoryGb}g`, id]);
    updated.push({ id, image, name, ok: u.status === 0, ...(u.status ? { error: (u.stderr || '').trim().slice(0, 200) } : {}) });
  }
  return { checked, updated };
}

/** The timer's job: slice up to date, stray build trees adopted, docker test containers limited, a fresh snapshot. */
export function enforce() {
  const limit = loadLimit();
  const out = { at: new Date().toISOString(), slice: 'skipped', adopted: [], docker: null, usage: null };
  const root = typeof process.getuid === 'function' && process.getuid() === 0;
  if (root && existsSync('/run/systemd/system')) out.slice = applySlice(limit);
  const fx = hostFacts();
  if (fx && root && sliceReady()) {
    const roots = new Map(); const inPanes = new Set();
    for (const [name, info] of fx.tmux) if (info.pid) { roots.set(name, info.pid); descendants(fx.procs, info.pid).forEach((p) => inPanes.add(p)); }
    for (const c of fx.procs.filter(isHeadlessClaude)) if (!inPanes.has(c.pid)) { roots.set(`claude-${c.pid}`, c.pid); descendants(fx.procs, c.pid).forEach((p) => inPanes.add(p)); }
    for (const [name, pid] of roots) {
      const tree = descendants(fx.procs, pid).filter((p) => !inSlice(p));
      if (!tree.length) continue;
      const r = adopt(name, tree);
      out.adopted.push({ name, pids: tree.length, ok: r.ok, ...(r.error ? { error: r.error } : {}) });
    }
  }
  if (root) out.docker = dockerLimits(limit);
  const u = usage({ facts: fx });
  out.usage = { live: u.live, max: u.max, free: u.free, source: u.source };
  return out;
}

/** Slice usage (CPU seconds, memory now / max) for the console, or null. */
export function sliceStats() {
  const dir = '/sys/fs/cgroup/axf.slice/axf-builds.slice';
  try {
    const mem = Number(readFileSync(join(dir, 'memory.current'), 'utf8'));
    const max = readFileSync(join(dir, 'memory.max'), 'utf8').trim();
    const cpu = readFileSync(join(dir, 'cpu.max'), 'utf8').trim().split(' ');
    const tasks = Number(readFileSync(join(dir, 'pids.current'), 'utf8'));
    return { memoryGb: Math.round((mem / GIB) * 10) / 10, memoryMaxGb: max === 'max' ? null : Math.round((Number(max) / GIB) * 10) / 10, cpuQuotaPct: cpu[0] === 'max' ? null : Math.round((Number(cpu[0]) / Number(cpu[1])) * 100), tasks };
  } catch { return null; }
}

export function status() {
  const u = usage();
  const snapStats = sliceStats() ?? u.slice ?? null; // the console container reads the host's numbers from the snapshot
  return { $axf: 'build-limit-status@1', max: u.max, live: u.live, free: u.free, ok: u.ok, source: u.source, at: u.at, items: u.items, limit: u.limit, slice: snapStats ? { name: SLICE, ...snapStats } : { name: SLICE, active: false } };
}

/* ---------------- CLI ---------------- */

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) out[k] = true; else { out[k] = v; i++; } } else out._.push(a);
  }
  return out;
}
const itemLine = (i) => `  ${i.kind.padEnd(8)} ${i.name}${i.pid ? ` (pid ${i.pid})` : ''}`;

async function cli(argv) {
  const [cmd = 'status', ...rest] = argv;
  const f = flags(rest);
  const say = (v, line) => console.log(f.json ? JSON.stringify(v, null, 2) : line);
  switch (cmd) {
    case 'status': {
      const s = status();
      return say(s, [`hard build limit ${s.live ?? '?'}/${s.max} running (${s.free ?? '?'} free, ${s.source})${s.limit.setBy ? ` · set by ${s.limit.setBy} ${s.limit.setAt}` : ' · default'}`,
        `  slice ${SLICE}: CPU ${s.limit.cpuQuotaPct}% · memory max ${s.limit.memoryMaxGb} GB (high ${s.limit.memoryHighGb}) · tasks ${s.limit.tasksMax}${s.slice.memoryGb != null ? ` · now ${s.slice.memoryGb} GB, ${s.slice.tasks} tasks` : ' · not active here'}`,
        `  docker test runs (${s.limit.dockerImages}): ${s.limit.dockerCpus} CPUs, ${s.limit.dockerMemoryGb} GB each`,
        ...s.items.map(itemLine)].join('\n'));
    }
    case 'admit': {
      const mode = f.mode === 'run' ? 'run' : 'launch';
      const opts = { mode, session: typeof f.session === 'string' ? f.session : '', name: typeof f.name === 'string' ? f.name : '', pid: Number(f.pid) || process.ppid };
      const r = f.wait ? await admitWait(opts, { pollMs: (Number(process.env.AXF_BUILD_LIMIT_POLL) || 10) * 1000, timeoutMs: (Number(f.wait) > 0 ? Number(f.wait) : 86400) * 1000,
        onWait: (x) => console.error(`build-limit: hard limit reached (${x.live}/${x.max} builds running): waiting for one to finish…`) }) : admit(opts);
      if (f.json) console.log(JSON.stringify(r));
      else if (r.ok) console.log(`res=${r.id} live=${r.live + 1} max=${r.max}`);
      else console.log(`refused: the VPS hard build limit is reached (${r.live}/${r.max} builds running). Nothing started. Running: ${r.items.map((i) => i.name).join(', ')}. Wait for one to finish, or Brett raises the limit (Settings → Plugins → Agent cap).`);
      process.exitCode = r.ok ? 0 : 3; return;
    }
    case 'release': return console.log(release(f._[0]) ? `released ${f._[0]}` : `${f._[0]} not held`);
    case 'set': {
      const owner = Boolean(f['from-console']) || (process.stdin.isTTY && process.stdout.isTTY);
      const patch = typeof f.json === 'string' ? JSON.parse(f.json) : Object.fromEntries(f._.map((kv) => kv.split('=')).map(([k, ...v]) => [k, v.join('=')]));
      const next = saveLimit(patch, { by: typeof f.by === 'string' ? f.by : 'brett', owner });
      return console.log(JSON.stringify(next));
    }
    case 'enforce': {
      const r = enforce();
      return say(r, `slice ${r.slice} · adopted ${r.adopted.filter((a) => a.ok).length}/${r.adopted.length} trees · docker ${r.docker ? `${r.docker.updated.length} of ${r.docker.checked} limited now` : 'skipped'} · builds ${r.usage.live ?? '?'}/${r.usage.max}`);
    }
    case 'docker-args': return console.log(dockerArgs(f._[0], loadLimit(), { slice: existsSync(SLICE_FILE) }).join('\n'));
    case 'slice-unit': return process.stdout.write(sliceUnit(loadLimit()));
    default: throw Object.assign(new Error(`unknown command ${cmd} (status, admit, release, set, enforce, docker-args, slice-unit)`), { code: 2 });
  }
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  cli(process.argv.slice(2)).catch((e) => { console.error(`build-limit: ${e.message}`); process.exitCode = e.code === 3 ? 3 : 2; });
}

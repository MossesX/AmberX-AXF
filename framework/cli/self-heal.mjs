#!/usr/bin/env node
/**
 * Self-heal for build folders (Brett, Nov 10 2026: "if something breaks, it needs to remove locks. Put it in the code so
 * it doesn't rely on AI"). Plain Node, zero model calls: the dispatcher tick, every launch and every auto-land round run
 * it, and every git call those make goes through healGit(), which clears what blocked it and retries once.
 *
 *   1. Stale git locks: index.lock, HEAD.lock, config.lock, packed-refs.lock, refs/**.lock and per-worktree locks under
 *      the main repo's git dir (default /opt/axf/.git) and every build folder (default /root/axf-builds/*), plus a
 *      worktree `locked` marker whose folder is gone. Removed when no live process has the file open, no live git
 *      process runs in that checkout, and the lock is older than LOCK_AGE_MS (2 minutes).
 *   2. Stray files that block a merge / checkout / pull ("would be overwritten by merge"): logs, .axf-* scratch files
 *      and _claude/builds sync files only. Each is copied to the archive first; tracked ones are restored
 *      (`git checkout --`), untracked ones moved aside. Then the git call runs again. Code files are never touched.
 *   3. Crashed sessions: a build marked running whose tmux session is still there with no live run in it (pane dead,
 *      no claude / claude-headless process) and no session-end event, after the launch grace period: the tmux session
 *      is killed, so the dispatcher's session-end check (checkEnds) records the crash and requeues the build.
 *   4. Every fix is appended to the fix log (<AXF_HEAL_DIR>/fixes.jsonl), noted on the build it belongs to
 *      ("Automatic fix: …") and sent to Brett once per round as an FYI (never an approval): into the console's fix log
 *      when a plugin provides fix-log@1 (it notifies AmberX), else a plain console alert.
 *
 *   node framework/cli/self-heal.mjs run [--dry-run] [--json] [--quiet]   one round: locks + crashed sessions
 *   node framework/cli/self-heal.mjs locks [--dry-run] [--json]            stale locks only
 *   node framework/cli/self-heal.mjs git -C <dir> -- <git args…>           git with the lock / stray-file guard
 *   node framework/cli/self-heal.mjs log [--limit n] [--json]              the fix log, newest last
 *
 * Environment: AXF_HEAL_REPO (/opt/axf), AXF_HEAL_BUILDS (/root/axf-builds), AXF_HEAL_DIR (/var/tmp/axf-heal),
 * AXF_HEAL_ARCHIVE (/root/archive/self-heal), AXF_HEAL_PROC (/proc), AXF_HEAL_LOCK_AGE_MS (120000),
 * AXF_HEAL_CONSOLE (docker container of the console, axf-console; "off" = no alert), AXF_HEAL_NOTES ("off" = no
 * build notes), AXF_HEADLESS_DIR (/var/tmp/axf-headless). Exit 0 ok · 1 failed · 2 usage.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import * as storeCore from '../plan/builds-store-core.mjs';
import { loadStore, withStore } from './builds-store.mjs';

const env = (k, d, e = process.env) => (e[k] === undefined || e[k] === '' ? d : e[k]);
export const LOCK_AGE_MS = 120000;
export const SESSION_GRACE_MS = 10 * 60e3;
const ROOT_LOCKS = ['index.lock', 'HEAD.lock', 'ORIG_HEAD.lock', 'FETCH_HEAD.lock', 'MERGE_HEAD.lock', 'config.lock', 'packed-refs.lock', 'shallow.lock'];
const WT_LOCKS = ['index.lock', 'HEAD.lock', 'ORIG_HEAD.lock', 'MERGE_HEAD.lock', 'config.worktree.lock'];

export function settings(e = process.env) {
  return {
    repo: env('AXF_HEAL_REPO', '/opt/axf', e),
    builds: env('AXF_HEAL_BUILDS', env('AXF_PIPELINE_WORKTREES', '/root/axf-builds', e), e),
    dir: env('AXF_HEAL_DIR', '/var/tmp/axf-heal', e),
    archive: env('AXF_HEAL_ARCHIVE', '/root/archive/self-heal', e),
    proc: env('AXF_HEAL_PROC', '/proc', e),
    lockAgeMs: Number(env('AXF_HEAL_LOCK_AGE_MS', LOCK_AGE_MS, e)),
    console: env('AXF_HEAL_CONSOLE', 'axf-console', e),
    notes: env('AXF_HEAL_NOTES', 'on', e) !== 'off',
    headless: env('AXF_HEADLESS_DIR', '/var/tmp/axf-headless', e),
  };
}

// ------------------------------------------------------------------ where the git dirs are

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const within = (p, root) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

/** A checkout's git dirs: { checkout, gitDir, common }, or null when it isn't one. */
export function gitDirsOf(checkout) {
  const dot = join(checkout, '.git');
  let st; try { st = lstatSync(dot); } catch { return null; }
  if (st.isDirectory()) return { checkout, gitDir: dot, common: dot };
  let text = ''; try { text = readFileSync(dot, 'utf8'); } catch { return null; }
  const m = /^gitdir:\s*(.+)$/m.exec(text); if (!m) return null;
  const gitDir = resolve(checkout, m[1].trim());
  let common = gitDir;
  try { const c = readFileSync(join(gitDir, 'commondir'), 'utf8').trim(); if (c) common = resolve(gitDir, c); } catch { /* not a linked worktree */ }
  return { checkout, gitDir, common };
}

/** The checkouts to look after: the main repo and every build folder. */
export function defaultRoots(s = settings()) {
  const out = [s.repo];
  try { for (const n of readdirSync(s.builds)) { const p = join(s.builds, n); if (isDir(p)) out.push(p); } } catch { /* no build folders */ }
  return out;
}

function walkLocks(dir, out) {
  let ents = []; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of ents) {
    const p = join(dir, d.name);
    if (d.isDirectory()) walkLocks(p, out); else if (d.name.endsWith('.lock')) out.push(p);
  }
}

/**
 * Every git lock under the given checkouts: [{ path, kind, scope: [checkouts a holder would run in], ageMs, worktree }].
 * kind = repo (shared by every worktree) | worktree | ref | worktree-marker (a `locked` file whose folder is gone).
 */
export function findLocks(roots, { now = Date.now() } = {}) {
  const repos = new Map(); // common dir → { checkouts:Set, gitDirs: Map(gitDir → checkout) }
  for (const r of roots) {
    const g = gitDirsOf(r); if (!g) continue;
    const e = repos.get(g.common) ?? { checkouts: new Set(), gitDirs: new Map() }; repos.set(g.common, e);
    e.checkouts.add(g.checkout); e.gitDirs.set(g.gitDir, g.checkout);
  }
  const out = [];
  const add = (path, kind, scope, extra = {}) => { try { out.push({ path, kind, scope, ageMs: now - statSync(path).mtimeMs, ...extra }); } catch { /* gone already */ } };
  for (const [common, e] of repos) {
    // linked worktrees registered in this repo (each has its own index / HEAD)
    const wtRoot = join(common, 'worktrees'); const wts = [];
    let names = []; try { names = readdirSync(wtRoot); } catch { /* none */ }
    for (const n of names) {
      const gd = join(wtRoot, n); if (!isDir(gd)) continue;
      let checkout = ''; try { checkout = dirname(readFileSync(join(gd, 'gitdir'), 'utf8').trim()); } catch { /* broken entry */ }
      wts.push({ gd, checkout });
      if (checkout) e.checkouts.add(checkout);
    }
    const all = [...e.checkouts, dirname(common)];
    for (const f of ROOT_LOCKS) if (existsSync(join(common, f))) add(join(common, f), 'repo', all);
    const refs = []; walkLocks(join(common, 'refs'), refs);
    for (const p of refs) add(p, 'ref', all);
    for (const { gd, checkout } of wts) {
      for (const f of WT_LOCKS) if (existsSync(join(gd, f))) add(join(gd, f), 'worktree', checkout ? [checkout] : all, { worktree: checkout });
      if (existsSync(join(gd, 'locked')) && checkout && !existsSync(checkout)) add(join(gd, 'locked'), 'worktree-marker', [checkout], { worktree: checkout });
    }
  }
  return out;
}

// ------------------------------------------------------------------ who holds a lock (Linux /proc)

/** Live processes: [{ pid, ppid, comm, cmd, cwd, fds: () => [paths] }]. Unreadable ones are skipped. */
export function processes(proc = settings().proc) {
  let pids = []; try { pids = readdirSync(proc).filter((n) => /^\d+$/.test(n)); } catch { return []; }
  const out = [];
  for (const pid of pids) {
    const base = join(proc, pid);
    let stat = ''; try { stat = readFileSync(join(base, 'stat'), 'utf8'); } catch { continue; }
    const close = stat.lastIndexOf(')');
    const comm = stat.slice(stat.indexOf('(') + 1, close);
    const fields = stat.slice(close + 2).split(' ');
    if (fields[0] === 'Z' || fields[0] === 'X') continue; // zombies hold nothing
    let cmd = ''; try { cmd = readFileSync(join(base, 'cmdline'), 'utf8').split('\0').join(' ').trim(); } catch { /* gone */ }
    let cwd = ''; try { cwd = readlinkSync(join(base, 'cwd')); } catch { /* not ours to read */ }
    out.push({ pid: Number(pid), ppid: Number(fields[1]), comm, cmd, cwd, fds: () => { try { return readdirSync(join(base, 'fd')).map((f) => { try { return readlinkSync(join(base, 'fd', f)); } catch { return ''; } }); } catch { return []; } } });
  }
  return out;
}

const isGit = (p) => p.comm === 'git' || /^(\S*\/)?git(\s|$)/.test(p.cmd);

/** Why a lock is in use, or '' when nobody holds it. */
export function holderOf(lock, procs) {
  for (const p of procs) if (p.fds().includes(lock.path)) return `pid ${p.pid} (${p.comm}) has it open`;
  for (const p of procs) if (isGit(p) && p.cwd && lock.scope.some((c) => within(p.cwd, c))) return `git pid ${p.pid} is running in ${p.cwd}`;
  return '';
}

/**
 * Remove stale locks. Returns { removed: [lock], held: [lock + why], young: [lock] }. `procs` can be passed (tests);
 * `minAgeMs` 0 = any age (the retry path, after a git call was just refused).
 */
export function clearStaleLocks({ roots = defaultRoots(), minAgeMs = settings().lockAgeMs, dry = false, procs, now = Date.now() } = {}) {
  const locks = findLocks(roots, { now });
  const res = { removed: [], held: [], young: [] };
  if (!locks.length) return res;
  const ps = procs ?? processes();
  for (const l of locks) {
    if (l.kind !== 'worktree-marker' && l.ageMs < minAgeMs) { res.young.push(l); continue; }
    const why = l.kind === 'worktree-marker' ? '' : holderOf(l, ps);
    if (why) { res.held.push({ ...l, why }); continue; }
    if (!dry) { try { rmSync(l.path, { force: true }); } catch { res.held.push({ ...l, why: 'could not remove' }); continue; } }
    res.removed.push(l);
  }
  return res;
}

// ------------------------------------------------------------------ git errors that self-heal can fix

/** The lock file a git error names, or ''. */
export function lockFromError(text) {
  const t = String(text || '');
  const m = /Unable to create '([^']+\.lock)'/.exec(t) || /could not lock config file ([^:\s]+\.lock)?/.exec(t) || /unable to (?:create|lock) ['"]?([^'"\s:]+\.lock)/i.exec(t);
  return m?.[1] || '';
}

/** Files a git error says block a merge / checkout / pull: { tracked: [], untracked: [] }. */
export function blockersFromError(text) {
  const t = String(text || ''); const out = { tracked: [], untracked: [] };
  const grab = (re, into) => {
    for (const m of t.matchAll(re)) for (const l of m[1].split('\n')) { const p = l.trim(); if (p) into.push(p); }
  };
  grab(/Your local changes to the following files would be overwritten by [a-z -]+:\n([\s\S]*?)\n(?:Please|Aborting)/g, out.tracked);
  grab(/The following untracked working tree files would be (?:overwritten|removed) by [a-z -]+:\n([\s\S]*?)\n(?:Please|Aborting)/g, out.untracked);
  return out;
}

/** Files self-heal may move aside: logs, .axf-* scratch files, _claude/builds sync files. Never code. */
const STRAY = [/\.log$/, /(^|\/)\.axf-[^/]+$/, /^(apps\/[^/]+\/)?_claude\/builds\//, /^(apps\/[^/]+\/)?_claude\/(THREADS|STATUS)\.md$/, /^[^/]+\.jsonl$/];
export const isStray = (p) => STRAY.some((re) => re.test(String(p)));

/** Archive then restore (tracked) / remove (untracked) the stray files in `cwd`. Returns { moved: [], refused: [] }. */
export function clearStrays({ cwd, tracked = [], untracked = [], archive = settings().archive, git = makeGit(), now = new Date() }) {
  const res = { moved: [], refused: [] };
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const to = (p) => join(archive, basename(cwd), stamp, p);
  for (const [list, isTracked] of [[tracked, true], [untracked, false]]) {
    for (const p of list) {
      if (!isStray(p) || p.includes('..') || isAbsolute(p)) { res.refused.push(p); continue; }
      try {
        if (existsSync(join(cwd, p))) { mkdirSync(dirname(to(p)), { recursive: true }); copyFileSync(join(cwd, p), to(p)); }
        if (isTracked) { if (git(['checkout', '--', p], { cwd }).code) { res.refused.push(p); continue; } } else rmSync(join(cwd, p), { force: true });
        res.moved.push(p);
      } catch { res.refused.push(p); }
    }
  }
  return res;
}

export function makeGit(defaultCwd = process.cwd()) {
  return (args, o = {}) => {
    const r = spawnSync('git', args, { cwd: o.cwd || defaultCwd, input: o.input, encoding: 'utf8', timeout: o.timeout || 120000, maxBuffer: 256 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(o.env || {}) } });
    return { code: r.status ?? 1, out: (r.stdout || '').replace(/\s+$/, ''), err: (r.stderr || r.error?.message || '').trim() };
  };
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Run one git call; when it fails on a lock or on stray files, clear them and run it once more. `run(args, o)` returns
 * { code, out, err } (land.mjs, builds-live.mjs and makeGit() all do). The result gets `healed: [fix]` when it acted.
 */
export function healGit(run, args, o = {}, { cwd = o.cwd || process.cwd(), procs, record = recordFixes, archive } = {}) {
  const r = run(args, o);
  if (!r || !r.code) return r;
  const text = `${r.err || ''}\n${r.out || ''}`;
  const fixes = [];
  const lock = lockFromError(text);
  if (lock && existsSync(lock)) {
    // a lock git just refused on: give a live writer a moment, then it must be unheld to go
    let age = Date.now(); try { age -= statSync(lock).mtimeMs; } catch { age = Infinity; }
    if (age < 3000) sleep(3000 - age);
    if (existsSync(lock)) {
      const ps = procs ?? processes();
      const l = { path: lock, kind: 'retry', scope: [cwd] };
      const why = holderOf(l, ps);
      if (!why) { try { rmSync(lock, { force: true }); fixes.push({ kind: 'lock', path: lock, checkout: cwd, why: `git ${args[0]} refused on it` }); } catch { /* leave it */ } }
    }
  }
  const b = blockersFromError(text);
  if (b.tracked.length || b.untracked.length) {
    const c = clearStrays({ cwd, ...b, git: (a, x) => run(a, { ...x, cwd }), ...(archive ? { archive } : {}) });
    if (c.moved.length && !c.refused.length) fixes.push({ kind: 'stray', files: c.moved, checkout: cwd, why: `git ${args[0]} was blocked by them` });
    else if (c.moved.length) fixes.push({ kind: 'stray', files: c.moved, checkout: cwd, why: `git ${args[0]} was blocked; ${c.refused.join(', ')} left alone (not a log or sync file)` });
  }
  if (!fixes.length) return r;
  try { record(fixes, { source: 'git-retry' }); } catch { /* logging never breaks the retry */ }
  const again = run(args, o);
  return { ...again, healed: fixes };
}

/** A git runner with the guard built in: same signature as the runner it wraps. */
export const guardGit = (run, defaults = {}) => (args, o = {}) => healGit(run, args, o, { ...defaults, cwd: o.cwd || defaults.cwd || process.cwd() });

// ------------------------------------------------------------------ crashed sessions

function tmuxPanes(name) {
  const r = spawnSync('tmux', ['list-panes', '-t', `=${name}`, '-F', '#{pane_pid} #{pane_dead}'], { encoding: 'utf8' });
  if (r.error) return null;
  if (r.status !== 0) return [];
  return r.stdout.split('\n').filter(Boolean).map((l) => { const [pid, dead] = l.split(' '); return { pid: Number(pid), dead: dead === '1' }; });
}

/** Does a pane still run a session (claude, or the headless wrapper finishing up)? */
export function paneAlive(panes, procs) {
  const kids = new Map(); for (const p of procs) { const k = kids.get(p.ppid) ?? []; k.push(p); kids.set(p.ppid, k); }
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  for (const pane of panes) {
    if (pane.dead) continue;
    const stack = [byPid.get(pane.pid)].filter(Boolean);
    while (stack.length) { const p = stack.pop(); if (/claude/.test(`${p.comm} ${p.cmd}`)) return true; stack.push(...(kids.get(p.pid) ?? [])); }
  }
  return false;
}

/**
 * Running builds whose session is a shell with nothing in it: [{ id, session, why }]. `builds` = [{ id, status,
 * pipeline: { session, launchedAt } }]; `ended(session, since)` says whether a session-end event was written.
 */
export function findCrashed({ builds, ended = () => false, panes = tmuxPanes, procs, now = Date.now(), graceMs = SESSION_GRACE_MS }) {
  const out = []; let ps = procs;
  for (const b of builds ?? []) {
    const ses = b?.pipeline?.session; if (!ses || !(b.status === 'running' || b.status === 'waiting')) continue;
    const at = Date.parse(b.pipeline.launchedAt || 0) || 0;
    if (now - at < graceMs || ended(ses, at - 5000)) continue;
    const p = panes(ses);
    if (!p || !p.length) continue; // tmux missing (can't tell) or the session is gone (checkEnds handles that)
    ps ??= processes();
    if (paneAlive(p, ps)) continue;
    out.push({ id: b.id, session: ses, why: p.every((x) => x.dead) ? 'its tmux pane is dead' : 'no claude process is left in its tmux session' });
  }
  return out;
}

export function sessionEnded(s = settings()) {
  let lines = []; try { lines = readFileSync(join(s.headless, 'events.jsonl'), 'utf8').split('\n'); } catch { /* none */ }
  const ends = new Map();
  for (const l of lines) { if (!l.includes('session-end')) continue; try { const e = JSON.parse(l); if (e.event === 'session-end') { const a = ends.get(e.session) ?? []; a.push(Date.parse(e.at || 0) || 0); ends.set(e.session, a); } } catch { /* torn line */ } }
  return (ses, since) => (ends.get(ses) ?? []).some((t) => t >= since);
}

/** Kill the empty tmux sessions so the dispatcher's session-end check records the crash and requeues the build. */
export function resetCrashed(crashed, { dry = false } = {}) {
  const out = [];
  for (const c of crashed) {
    if (!dry) spawnSync('tmux', ['kill-session', '-t', `=${c.session}`], { encoding: 'utf8' });
    out.push({ kind: 'session', build: c.id, session: c.session, why: c.why });
  }
  return out;
}

// ------------------------------------------------------------------ reporting: fix log, build notes, FYI

export function describe(f) {
  if (f.kind === 'lock') return `Removed stale git lock ${f.path}${f.why ? ` (${f.why})` : ''}`;
  if (f.kind === 'stray') return `Moved stray files aside in ${f.checkout}: ${f.files.join(', ')} (${f.why}); copies in the self-heal archive`;
  if (f.kind === 'session') return `Reset crashed session ${f.session} of ${f.build} (${f.why}); the dispatcher requeues it`;
  return JSON.stringify(f);
}

/** The build a fix belongs to: the build folder's name under AXF_HEAL_BUILDS, or the build it names. */
export function buildOf(f, s = settings()) {
  if (f.build) return f.build;
  for (const p of [f.checkout, f.worktree, f.path]) if (p && within(p, s.builds)) return p.slice(s.builds.length + 1).split(sep)[0];
  const m = f.path && /\/worktrees\/([^/]+)\//.exec(f.path);
  return m ? m[1] : '';
}

function consolePost(path, body, s) {
  if (s.console === 'off') return null;
  const cmd = `curl -s -m 20 -X POST -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" --data-binary @- "http://127.0.0.1:${process.env.AXF_CONSOLE_PORT || 7090}${path}"`;
  const r = spawnSync('docker', ['exec', '-i', s.console, 'sh', '-c', cmd], { input: JSON.stringify(body), encoding: 'utf8', timeout: 30e3 });
  if (r.error || r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return {}; }
}

const PLUGINS = resolve(dirname(new URL(import.meta.url).pathname), '../../apps/console-web/plugins');
/** The console plugin that provides the fix log (fix-log@1), found by capability (never by folder name), or ''. */
export function fixLogProvider(dir = PLUGINS) {
  let names = []; try { names = readdirSync(dir).sort(); } catch { return ''; }
  for (const n of names) {
    try { const p = JSON.parse(readFileSync(join(dir, n, 'plugin.json'), 'utf8')); if ((p.provides || []).some((c) => /^service:fix-log@/.test(c) || c === 'view:fix-log')) return n; } catch { /* not a plugin */ }
  }
  return '';
}

/** The FYI: into the fix log when a plugin provides it (it notifies the phone itself), else a plain console alert. */
function postAlert(alert, s, fixes = []) {
  const folder = fixLogProvider();
  if (folder && fixes.length) {
    const builds = [...new Set(fixes.map((f) => buildOf(f, s)).filter(Boolean))].join(', ');
    const r = consolePost(`/api/plugins/${folder}/log`, { outcome: 'fixed', text: alert.title.replace(/^Fixed:\s*/, '').slice(0, 400), build: builds, agent: 'self-heal', detail: alert.body }, s);
    if (r?.ok) return true;
  }
  return !!consolePost('/api/alerts', alert, s);
}

function noteBuilds(byBuild) {
  withStore((st) => {
    const now = new Date().toISOString();
    for (const [id, lines] of byBuild) { const b = storeCore.findBuild(st, id); if (b) { b.notes.push({ text: `Automatic fix (self-heal, no AI): ${lines.join(' · ')}`.slice(0, 2000), at: now }); b.updatedAt = now; } }
    return st;
  }, { by: 'self-heal', action: 'self-heal:fix', note: [...byBuild.keys()].join(',') });
}

/** Log fixes: fix log line each, one note per build, one FYI alert per call. Never throws. */
export function recordFixes(fixes, { source = 'round', s = settings(), alert = (a) => postAlert(a, s, fixes), notes = s.notes } = {}) {
  if (!fixes?.length) return { logged: 0 };
  const at = new Date().toISOString();
  try { mkdirSync(s.dir, { recursive: true }); appendFileSync(join(s.dir, 'fixes.jsonl'), fixes.map((f) => `${JSON.stringify({ at, source, build: buildOf(f, s), text: describe(f), ...f })}\n`).join('')); } catch { /* read-only host */ }
  const byBuild = new Map();
  for (const f of fixes) { const id = buildOf(f, s); if (id) byBuild.set(id, [...(byBuild.get(id) ?? []), describe(f)]); }
  if (notes && byBuild.size) { try { noteBuilds(byBuild); } catch { /* the store may be busy; the fix log has it */ } }
  let sent = false;
  try {
    const title = fixes.length === 1 ? `Fixed: ${describe(fixes[0])}` : `Fixed ${fixes.length} things in build folders`;
    sent = !!alert({ source: 'self-heal', severity: 'success', key: `self-heal:${Date.now()}`, title: title.slice(0, 200), body: `FYI, nothing to approve. ${fixes.map(describe).join(' · ')}`.slice(0, 1000) });
  } catch { /* the console may be down; the fix log has it */ }
  return { logged: fixes.length, notedBuilds: [...byBuild.keys()], sent };
}

export function readFixLog({ limit = 50, s = settings() } = {}) {
  let t = ''; try { t = readFileSync(join(s.dir, 'fixes.jsonl'), 'utf8'); } catch { return []; }
  return t.split('\n').filter(Boolean).slice(-limit).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

// ------------------------------------------------------------------ one round

/**
 * One self-heal round: stale locks under every checkout, crashed sessions among `builds` (the caller's running
 * builds; the CLI reads the store). Returns { fixes, held, young, record }.
 */
export function healRound({ roots, builds = [], dry = false, s = settings(), procs, record = recordFixes, ended } = {}) {
  const locks = clearStaleLocks({ roots: roots ?? defaultRoots(s), minAgeMs: s.lockAgeMs, dry, procs });
  const fixes = locks.removed.map((l) => ({ kind: 'lock', path: l.path, checkout: l.worktree || '', why: `${l.kind === 'worktree-marker' ? 'its worktree folder is gone' : `${Math.round(l.ageMs / 1000)}s old, nobody holds it`}` }));
  let crashed = [];
  try { crashed = findCrashed({ builds, ended: ended ?? sessionEnded(s), procs }); } catch { /* no tmux / proc */ }
  fixes.push(...resetCrashed(crashed, { dry }));
  const rec = dry || !fixes.length ? { logged: 0 } : record(fixes, { source: 'round', s });
  return { fixes, held: locks.held, young: locks.young, record: rec, dry };
}

// ------------------------------------------------------------------ CLI

function storeRunning() {
  try { return (loadStore().builds ?? []).filter((b) => b.status === 'running' || b.status === 'waiting'); } catch { return []; }
}

async function main(argv) {
  const has = (f) => argv.includes(f);
  const [cmd] = argv;
  const json = has('--json'); const dry = has('--dry-run');
  if (cmd === 'run' || cmd === 'locks') {
    const r = cmd === 'run' ? healRound({ builds: storeRunning(), dry }) : (() => { const l = clearStaleLocks({ dry }); return { fixes: l.removed.map((x) => ({ kind: 'lock', path: x.path, why: 'stale' })), held: l.held, young: l.young }; })();
    if (cmd === 'locks' && !dry && r.fixes.length) r.record = recordFixes(r.fixes, { source: 'cli' });
    if (json) console.log(JSON.stringify(r, null, 1));
    else if (!has('--quiet') || r.fixes.length) console.log([`${dry ? 'would fix' : 'fixed'} ${r.fixes.length}`, ...r.fixes.map((f) => `  ${describe(f)}`), ...r.held.map((h) => `  left ${h.path}: ${h.why}`)].join('\n'));
    return 0;
  }
  if (cmd === 'git') {
    const i = argv.indexOf('--'); const c = argv.indexOf('-C');
    if (i < 0) { console.error('usage: self-heal.mjs git [-C dir] -- <git args…>'); return 2; }
    const cwd = c >= 0 && c < i ? resolve(argv[c + 1]) : process.cwd();
    const r = healGit(makeGit(cwd), argv.slice(i + 1), { cwd }, { cwd });
    if (r.out) console.log(r.out);
    if (r.err) console.error(r.err);
    return r.code;
  }
  if (cmd === 'log') {
    const n = argv.indexOf('--limit'); const rows = readFixLog({ limit: n >= 0 ? Number(argv[n + 1]) || 50 : 50 });
    if (json) console.log(JSON.stringify({ ok: true, fixes: rows }, null, 1));
    else console.log(rows.map((f) => `${f.at.slice(0, 16).replace('T', ' ')}  ${f.build || '-'}  ${f.text}`).join('\n') || 'no automatic fixes yet');
    return 0;
  }
  console.error('usage: self-heal.mjs run|locks [--dry-run] [--json] [--quiet] · git [-C dir] -- <args…> · log [--limit n] [--json]');
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main(process.argv.slice(2)));

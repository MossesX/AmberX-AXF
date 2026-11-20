#!/usr/bin/env node
/**
 * reaper.mjs — vps-reaper@1: the VPS cleans up its own ghosts (Gizmo, Nov 18 2026: "the VPS must clean up all stale
 * processes itself").
 *
 * One pass looks at what really runs on the host and removes what nothing owns any more:
 *   - `claude -p` processes whose build session is over: the build log ends in its result line ("■ done", or an error
 *     result) and nothing was written since, the build folder is gone, or the build is settled (built, landed…) and has
 *     no tmux session left. Killing a finished session lets its wrapper end the run normally (session-end event, the
 *     dispatcher's exit call, the build's 'after' rules, the lander); an orphan with no wrapper gets the session-end
 *     event written here so the dispatcher closes the run and hands the build to the lander.
 *   - tmux axf-* sessions with no claude left whose run is over (end line on the pane, log ended, build settled or gone).
 *   - agent-slots entries nothing holds: a host that no longer exists (a recreated console container), a pid reused by
 *     another process, a settled build with nothing running; heavy-step locks whose owner is gone. The slots' own
 *     reap / sweep run in the same pass.
 *   - test servers (vite preview, uvicorn, …) listening from a build worktree whose build has no live session, and
 *     orphaned listeners from deleted / /tmp folders.
 *   - test-run ghosts: a `claude -p` (or a test's stand-in script named claude) outside every worktree whose
 *     /tmp/axf-limit-* folder is gone, or that has run from one longer than tmpMaxAgeMin, or whose /tmp cwd was deleted.
 *     The hard build limit counts every headless claude on the host, so these held real build places for 10-15 hours
 *     (Nov 20 2026). The process, what runs under it and its tmux session go.
 *   - stale temp folders: /tmp/axf-limit-* (test runs), /tmp/axf-ctx-* nobody uses, leaked state *.tmp files.
 *
 * Never touched: anything of a build that is genuinely working (its log or meter written within idleMin), this
 * process and its ancestors, processes in another pid namespace (containers), interactive `claude` (no -p), services
 * outside the worktrees and /tmp.
 *
 * Every action is logged (what, why) to <slots dir>/reaper.jsonl, one note per pass goes to AmberX's
 * "Automatic fixes" list, and the phone gets an FYI (notify type pipeline.reaper) when something was killed or freed.
 *
 * Who runs it: cron every 2 minutes (deploy/cron/axf-reaper, installed by deploy/install-console.sh), and reapFirst()
 * before every dispatcher tick and launch, auto-land round, auto-lander pass and merge-queue pass (throttled to one
 * pass per minIntervalSec). Both the VPS cron and the orchestrator run the same check, so either one alone suffices.
 *
 *   node framework/cli/reaper.mjs run [--dry] [--by who] [--json]   one pass (--dry: plan only)
 *   node framework/cli/reaper.mjs plan [--json]                      what a pass would do
 *   node framework/cli/reaper.mjs settings | set key=value…          <slots dir>/reaper.json (hot-reloaded)
 *   node framework/cli/reaper.mjs log [--n 50]                       the newest actions
 *
 * AXF_REAPER=off disables every pass. Hooks (reapFirst) also stay off off the host and under tests (any of
 * AXF_SLOTS_DIR, AXF_HEADLESS_DIR, AXF_PIPELINE_WORKTREES set, or NODE_TEST_CONTEXT).
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'vps-reaper@1';
export const DEFAULTS = {
  enabled: true,
  dryRun: false,
  /** a session whose log ends in its result line, idle this long, is over */
  doneGraceMin: 3,
  /** a build with a log or meter write this recent is working: none of its processes are touched */
  idleMin: 20,
  /** a finished-looking claude -p with background tasks still running (a CI watch…) is waiting on them, up to this long */
  bgMaxMin: 90,
  /** processes / sessions younger than this are left alone (still starting) */
  procGraceMin: 5,
  /** a test server from a build worktree with no live session, running at least this long */
  serverGraceMin: 20,
  /** a listener from a deleted or /tmp folder with no claude above it */
  orphanServerMin: 60,
  /** agent-slots entries of a host that is gone, at least this old */
  foreignGraceMin: 30,
  /** /tmp/axf-limit-* older than this */
  tmpMaxAgeMin: 60,
  /** /tmp/axf-ctx-* older than this and used by no process */
  ctxMaxAgeH: 24,
  /** reapFirst() runs at most once per this many seconds */
  minIntervalSec: 30,
  notify: true,
  notes: true,
};
const LIMITS = { doneGraceMin: [1, 240], bgMaxMin: [10, 1440], idleMin: [5, 1440], procGraceMin: [1, 120], serverGraceMin: [1, 1440], orphanServerMin: [10, 10080], foreignGraceMin: [5, 10080], tmpMaxAgeMin: [10, 10080], ctxMaxAgeH: [1, 720], minIntervalSec: [0, 3600] };
/** Build statuses that never have a session of their own any more. */
export const ENDED = ['built', 'landing', 'landed', 'complete', 'merged', 'done', 'failed', 'cancelled', 'archived'];
export const NOTES_LIST = 'Automatic fixes';
export const ALERT_PREFIX = 'pipeline:reaper';
const MIN = 60e3;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/* ---------------- pure core ---------------- */

export function normSettings(raw = {}) {
  const s = { $axf: 'vps-reaper-settings@1', ...DEFAULTS };
  for (const k of ['enabled', 'dryRun', 'notify', 'notes']) if (raw?.[k] !== undefined) s[k] = raw[k] === true || raw[k] === 'true' || raw[k] === 1 || raw[k] === '1';
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(raw?.[k]);
    if (raw?.[k] !== undefined && raw[k] !== '' && Number.isFinite(v)) s[k] = Math.min(hi, Math.max(lo, Math.round(v)));
  }
  return s;
}

/** The build a tmux session belongs to: axf-<build>[--agent][-HHMMSS]. */
export function buildOfSession(name) {
  const m = /^axf-(.+?)(--[A-Za-z0-9._:-]+?)?(-\d{6})?$/.exec(String(name ?? ''));
  return m ? m[1] : '';
}

/** The build a path belongs to: the first folder under the worktrees root. */
export function buildOfPath(p, root) {
  const r = String(root ?? '').replace(/\/+$/, '');
  const s = String(p ?? '').replace(/ \(deleted\)$/, '');
  if (!r || !s.startsWith(`${r}/`)) return '';
  const seg = s.slice(r.length + 1).split('/')[0];
  return /^[a-z0-9][a-z0-9._-]{0,79}$/.test(seg) ? seg.replace(/\.axhub$/, '') : '';
}

/**
 * How a headless log ends: { ended, kind } where kind is the result's subtype ('done' for a clean end). Ended = the
 * last result line ("■ …", deploy/claude-stream.mjs) has no tool call or new session header after it.
 */
export function logEnding(text) {
  const lines = String(text ?? '').replace(ANSI, '').split('\n');
  let at = -1; let kind = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^■ (\S+)/.exec(lines[i]);
    if (m) { at = i; kind = m[1]; break; }
  }
  if (at < 0) return { ended: false, kind: '' };
  for (let i = at + 1; i < lines.length; i++) if (/^(▸ |# model |# context: )/.test(lines[i])) return { ended: false, kind: '' };
  return { ended: true, kind };
}

/** The build a process works on, from its folder (cwd, else a worktree path in its arguments). */
export const pathBuild = (p, root) => buildOfPath(p.cwd, root) || (p.args ?? []).map((a) => buildOfPath(a, root)).find(Boolean) || '';

export const isClaudePrint = (args = []) => args.some((a) => /(^|\/)claude$/.test(a) || /@anthropic-ai\/claude-code\//.test(a)) && args.some((a) => a === '-p' || a === '--print');
const isClaude = (args = []) => args.some((a) => /(^|\/)claude$/.test(a) || /@anthropic-ai\/claude-code\//.test(a));
const mins = (ms) => `${Math.max(0, Math.round(ms / MIN))} min`;
const short = (args = []) => args.join(' ').replace(/\s+/g, ' ').slice(0, 120);

/**
 * What one pass would do (pure). facts:
 *   now, root (worktrees root), host, self (Set of protected pids), containers (Set of live container hostnames | null),
 *   procs [{ pid, ppid, args, cwd, cwdDeleted, startMs, buildEnv, sessionEnv, sameNs }],
 *   tmux [{ name, createdMs, panePid, paneClaude, finished }],
 *   listeners (Set of pids), builds { id: { status } }, logs { build: { lastWriteMs, ended, kind, folder } },
 *   slots { running, queue, heavy }, ended (Set of sessions with a session-end event), tmp [{ path, kind, mtimeMs, used }]
 * Returns [{ type, … , what, why }] with type kill-proc | kill-tmux | drop-slot | rm | end-event.
 */
export function plan(facts, settings = DEFAULTS) {
  const s = normSettings(settings);
  const { now, root = '', host = '', self = new Set(), containers = null } = facts;
  const procs = facts.procs ?? []; const tmux = facts.tmux ?? []; const listeners = facts.listeners ?? new Set();
  const builds = facts.builds ?? {}; const logs = facts.logs ?? {}; const endedSessions = facts.ended ?? new Set();
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const out = [];
  const seen = new Set();
  const add = (a) => { const k = `${a.type}:${a.pid ?? a.session ?? a.id ?? a.path}`; if (!seen.has(k)) { seen.add(k); out.push(a); } };

  // kills judge a process by the worktree it runs in (never by its environment alone: a process outside every worktree is
  // not judged); liveness counts AXF_BUILD_ID too, so a build is never taken for dead because it runs elsewhere
  const buildOf = (p) => pathBuild(p, root);
  const lastWrite = (b) => logs[b]?.lastWriteMs ?? 0;
  const working = (b) => !!b && now - lastWrite(b) < s.idleMin * MIN;
  const statusOf = (b) => builds[b]?.status ?? '';
  const settled = (b) => ENDED.includes(statusOf(b));
  const folderGone = (b) => !!b && logs[b] && logs[b].folder === false;
  const sessionsOf = (b) => tmux.filter((t) => buildOfSession(t.name) === b);
  const claudesOf = (b) => procs.filter((p) => p.sameNs !== false && isClaude(p.args) && (buildOf(p) === b || p.buildEnv === b));
  const hasClaudeAbove = (p) => { let q = byPid.get(p.ppid); for (let i = 0; q && i < 40; i++, q = byPid.get(q.ppid)) if (isClaude(q.args)) return true; return false; };
  const protectedPid = (pid) => self.has(pid);
  const kids = new Map(); for (const p of procs) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  // what a claude still runs under it (background shells: a CI watch, a test run); a session with any is not idle
  const background = (pid) => { const out = []; const stack = [pid]; while (stack.length && out.length < 50) for (const c of kids.get(stack.pop()) ?? []) { out.push(c); stack.push(c.pid); } return out; };

  // 1. claude -p processes whose session is over
  for (const p of procs) {
    if (p.sameNs === false || protectedPid(p.pid) || !isClaudePrint(p.args) || now - p.startMs < s.procGraceMin * MIN) continue;
    const b = buildOf(p);
    if (!b) continue;
    const L = logs[b] ?? {};
    const idle = now - lastWrite(b);
    const wrapped = sessionsOf(b).length > 0;
    const bg = background(p.pid);
    // a result line with background tasks still running under it: claude waits for them and takes another turn
    if (L.ended && bg.length && idle < s.bgMaxMin * MIN) continue;
    if (L.ended && idle >= s.doneGraceMin * MIN && p.startMs < lastWrite(b)) {
      add({ type: 'kill-proc', pid: p.pid, startMs: p.startMs, build: b, marker: L.kind === 'done' && root ? join(root, b) : '', what: `claude -p for ${b} (pid ${p.pid})`, why: `its log ended ("■ ${L.kind}") ${mins(idle)} ago but the process was still running${bg.length ? ` (its ${bg.length} background task(s) idle too)` : ''}` });
      for (const c of bg) if (!protectedPid(c.pid)) add({ type: 'kill-proc', pid: c.pid, startMs: c.startMs, build: b, what: `background task of ${b} (pid ${c.pid}: ${short(c.args)})`, why: `left under the finished claude -p for ${b}` });
      if (!wrapped && p.sessionEnv && !endedSessions.has(p.sessionEnv)) {
        add({ type: 'end-event', session: p.sessionEnv, build: b, exit: L.kind === 'done' ? 0 : 1, kind: L.kind === 'done' ? 'phase-done' : 'crash', cwd: p.cwd, what: `session-end for ${p.sessionEnv}`, why: 'closed by the reaper: the run had finished, its wrapper was gone' });
      }
      continue;
    }
    if (working(b)) continue;
    if (p.cwdDeleted) { add({ type: 'kill-proc', pid: p.pid, startMs: p.startMs, build: b, what: `claude -p for ${b} (pid ${p.pid})`, why: `its build folder is gone; nothing written for ${mins(idle)}` }); continue; }
    if (settled(b) && !wrapped) add({ type: 'kill-proc', pid: p.pid, startMs: p.startMs, build: b, what: `claude -p for ${b} (pid ${p.pid})`, why: `the build is ${statusOf(b)} and its session ended; nothing written for ${mins(idle)}` });
  }

  // 1b. test-run ghosts: headless claude outside every worktree, left from a /tmp/axf-limit-* test folder (gone, or
  // older than any test run) or from a deleted /tmp folder; it counts against the hard build limit like a real build
  const paneOf = new Map(tmux.map((t) => [t.panePid, t.name]));
  for (const p of procs) {
    if (p.sameNs === false || protectedPid(p.pid) || !isClaudePrint(p.args) || buildOf(p) || now - p.startMs < s.procGraceMin * MIN) continue;
    const age = now - p.startMs;
    let why = '';
    if (p.tmpLimit && p.tmpLimitGone) why = `its test folder ${p.tmpLimit} is gone; running ${mins(age)}`;
    else if (p.tmpLimit && age >= s.tmpMaxAgeMin * MIN) why = `a test run from ${p.tmpLimit} running ${mins(age)} (longer than any test)`;
    else if (!p.tmpLimit && p.cwdDeleted && /^\/(var\/)?tmp\//.test(p.cwd ?? '')) why = `its folder ${p.cwd} was deleted; running ${mins(age)}`;
    if (!why) continue;
    add({ type: 'kill-proc', pid: p.pid, startMs: p.startMs, build: '', what: `test-run claude -p (pid ${p.pid}: ${short(p.args)})`, why });
    for (const c of background(p.pid)) if (!protectedPid(c.pid)) add({ type: 'kill-proc', pid: c.pid, startMs: c.startMs, build: '', what: `task under test-run claude (pid ${c.pid}: ${short(c.args)})`, why: `left under pid ${p.pid}` });
    let q = p; let pane = paneOf.get(p.pid) || '';
    for (let i = 0; !pane && q && i < 40; i++) { q = byPid.get(q.ppid); if (q) pane = paneOf.get(q.pid) || ''; }
    if (pane && !protectedPid(q?.pid)) add({ type: 'kill-tmux', session: pane, build: '', what: `tmux ${pane}`, why: `holds the test-run ghost pid ${p.pid}` });
  }

  // 2. tmux axf-* sessions with no claude left whose run is over
  for (const t of tmux) {
    if (!/^axf-/.test(t.name) || now - (t.createdMs || now) < s.procGraceMin * MIN || t.paneClaude) continue;
    const b = buildOfSession(t.name);
    const L = logs[b] ?? {};
    const idle = now - lastWrite(b);
    let why = '';
    if (t.finished && idle >= s.doneGraceMin * MIN) why = `finished (end line on its pane) ${mins(idle)} ago`;
    else if (L.ended && idle >= s.doneGraceMin * MIN) why = `no claude left and its log ended ("■ ${L.kind}") ${mins(idle)} ago`;
    else if (!working(b) && (settled(b) || folderGone(b))) why = `no claude left; the build is ${folderGone(b) ? 'gone from disk' : statusOf(b)}`;
    if (!why) continue;
    add({ type: 'kill-tmux', session: t.name, build: b, what: `tmux ${t.name}`, why });
    if (L.ended && !endedSessions.has(t.name) && !t.finished) add({ type: 'end-event', session: t.name, build: b, exit: L.kind === 'done' ? 0 : 1, kind: L.kind === 'done' ? 'phase-done' : 'crash', cwd: root ? join(root, b) : '', what: `session-end for ${t.name}`, why: 'closed by the reaper: the run had finished, its wrapper never wrote the end' });
  }

  // 3. agent-slots entries and heavy locks nothing holds
  const sl = facts.slots ?? {};
  const tmuxNames = new Set(tmux.map((t) => t.name));
  const age = (e) => now - Date.parse(e.startedAt || e.enqueuedAt || 0);
  const hostGone = (e) => e.host && e.host !== host && containers && !containers.has(e.host);
  for (const [list, entries] of [['running', sl.running ?? []], ['queue', sl.queue ?? []], ['heavy', sl.heavy ?? []]]) {
    for (const e of entries) {
      const label = `${list === 'heavy' ? 'heavy lock' : list === 'queue' ? 'queued slot' : 'slot'} ${e.name || e.label || e.id}`;
      if (hostGone(e)) { if (age(e) >= s.foreignGraceMin * MIN) add({ type: 'drop-slot', list, id: e.id, build: e.build ?? '', what: `${label} (${e.id})`, why: `its host ${e.host} is gone (held ${mins(age(e))})` }); continue; }
      if ((e.host ?? host) !== host || age(e) < s.procGraceMin * MIN) continue;
      const proc = e.pid ? byPid.get(Number(e.pid)) : null;
      const inTmux = !!(e.session && tmuxNames.has(e.session));
      const since = Date.parse(e.startedAt || e.enqueuedAt || 0);
      if (list === 'heavy') {
        if (!proc) add({ type: 'drop-slot', list, id: e.id, what: `${label} (${e.id})`, why: `its owner (pid ${e.pid}) is gone` });
        else if (proc.startMs > since + 10 * MIN) add({ type: 'drop-slot', list, id: e.id, what: `${label} (${e.id})`, why: `its pid ${e.pid} now belongs to another process` });
        continue;
      }
      if (inTmux) continue;
      const b = e.build || buildOfSession(e.session) || '';
      if (proc && proc.startMs > since + 10 * MIN && !(b && (sessionsOf(b).length || claudesOf(b).length))) { add({ type: 'drop-slot', list, id: e.id, build: b, what: `${label} (${e.id})`, why: `its pid ${e.pid} now belongs to another process; nothing runs for it` }); continue; }
      if (b && settled(b) && !sessionsOf(b).length && !claudesOf(b).length && !working(b)) add({ type: 'drop-slot', list, id: e.id, build: b, what: `${label} (${e.id})`, why: `the build is ${statusOf(b)} and nothing runs for it` });
    }
  }

  // 4. test servers left on ports
  for (const pid of listeners) {
    const p = byPid.get(pid);
    if (!p || p.sameNs === false || protectedPid(pid) || isClaude(p.args)) continue;
    const runFor = now - p.startMs;
    const b = buildOf(p);
    if (b) {
      if (runFor < s.serverGraceMin * MIN || sessionsOf(b).length || claudesOf(b).length || working(b)) continue;
      add({ type: 'kill-proc', pid, startMs: p.startMs, build: b, what: `test server for ${b} (pid ${pid}: ${short(p.args)})`, why: `no live session for ${b}; running ${mins(runFor)}` });
      continue;
    }
    const tmpish = p.cwdDeleted || /^\/tmp\//.test(p.cwd ?? '') || /^\/var\/tmp\//.test(p.cwd ?? '');
    if (!tmpish || runFor < s.orphanServerMin * MIN || hasClaudeAbove(p)) continue;
    add({ type: 'kill-proc', pid, startMs: p.startMs, build: '', what: `test server pid ${pid} (${short(p.args)})`, why: `left from ${p.cwdDeleted ? 'a deleted folder' : p.cwd}, no session above it; running ${mins(runFor)}` });
  }

  // 5. stale temp folders and files
  for (const t of facts.tmp ?? []) {
    const old = now - t.mtimeMs;
    if (t.kind === 'limit' && old >= s.tmpMaxAgeMin * MIN) add({ type: 'rm', path: t.path, what: t.path, why: `test temp folder, untouched ${mins(old)}` });
    else if (t.kind === 'ctx' && !t.used && old >= s.ctxMaxAgeH * 60 * MIN) add({ type: 'rm', path: t.path, what: t.path, why: `headless settings folder no process uses, untouched ${mins(old)}` });
    else if (t.kind === 'state-tmp' && old >= 10 * MIN) add({ type: 'rm', path: t.path, what: t.path, why: `leaked state write, untouched ${mins(old)}` });
  }
  return out;
}

/** A kill or a freed slot (not a temp file): worth a phone FYI. */
export const isKill = (a) => a.type === 'kill-proc' || a.type === 'kill-tmux' || a.type === 'drop-slot';

/** The note / alert text for a pass (pure). */
export function summarize(actions, { at = new Date().toISOString(), by = 'cron' } = {}) {
  const kills = actions.filter(isKill);
  const files = actions.filter((a) => a.type === 'rm');
  const head = [kills.length ? `${kills.length} ghost${kills.length === 1 ? '' : 's'} cleared` : '', files.length ? `${files.length} temp ${files.length === 1 ? 'item' : 'items'} removed` : ''].filter(Boolean).join(', ');
  const line = (a) => `• ${a.what}: ${a.why}${a.error ? ` (failed: ${a.error})` : ''}`;
  const lines = kills.map(line);
  // temp files are many and alike: one line with a few examples, so the note stays readable on a phone
  if (files.length <= 5) lines.push(...files.map(line));
  else lines.push(`• ${files.length} temp items removed, e.g. ${files.slice(0, 3).map((a) => a.what).join(', ')} (all in reaper.jsonl)`);
  const ends = actions.filter((a) => a.type === 'end-event');
  if (ends.length) lines.push(`• handed to the lander: ${ends.map((e) => e.build).join(', ')} (run closed as finished)`);
  return { title: `VPS reaper: ${head || 'nothing to clean'}`, body: lines.join('\n'), at, by, count: kills.length };
}

/* ---------------- host facts ---------------- */

export const worktreesRoot = (env = process.env) => env.AXF_PIPELINE_WORKTREES || '/root/axf-builds';
export const headlessDir = (env = process.env) => env.AXF_HEADLESS_DIR || '/var/tmp/axf-headless';
const readText = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const mtime = (f) => { try { return statSync(f).mtimeMs; } catch { return 0; } };

let clk = 0;
function clockTicks() {
  if (clk) return clk;
  const r = spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' });
  clk = Number(r.stdout) || 100;
  return clk;
}
const bootMs = () => (Number(/^btime (\d+)/m.exec(readText('/proc/stat'))?.[1]) || 0) * 1000;

/** pid → start time (ms epoch), or 0. */
export function procStart(pid, boot = bootMs()) {
  const stat = readText(`/proc/${pid}/stat`);
  const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const ticks = Number(rest[19]);
  return Number.isFinite(ticks) && boot ? boot + (ticks / clockTicks()) * 1000 : 0;
}

/** This process and its ancestors: never touched. */
export function ancestors() {
  const out = new Set([process.pid]); let pid = process.ppid;
  for (let i = 0; i < 64 && pid > 1; i++) {
    out.add(pid);
    pid = Number(/^PPid:\s+(\d+)/m.exec(readText(`/proc/${pid}/status`))?.[1] || 0);
  }
  return out;
}

export function processes() {
  if (!existsSync('/proc')) return [];
  const boot = bootMs();
  let ns = ''; try { ns = readlinkSync('/proc/self/ns/pid'); } catch { /* no ns */ }
  const out = [];
  let ents = []; try { ents = readdirSync('/proc'); } catch { return []; }
  for (const e of ents) {
    if (!/^\d+$/.test(e)) continue;
    const pid = Number(e);
    const args = readText(`/proc/${e}/cmdline`).split('\0').filter(Boolean);
    if (!args.length) continue;
    let cwd = ''; try { cwd = readlinkSync(`/proc/${e}/cwd`); } catch { /* not ours */ }
    let pns = ''; try { pns = readlinkSync(`/proc/${e}/ns/pid`); } catch { /* not ours */ }
    const ppid = Number(/^PPid:\s+(\d+)/m.exec(readText(`/proc/${e}/status`))?.[1] || 0);
    let buildEnv = ''; let sessionEnv = '';
    if (isClaude(args)) {
      const env = readText(`/proc/${e}/environ`).split('\0');
      buildEnv = (env.find((x) => x.startsWith('AXF_BUILD_ID=')) ?? '').slice(13);
      sessionEnv = (env.find((x) => x.startsWith('AXF_SESSION=')) ?? '').slice(12);
    }
    // a test run's folder (/tmp/axf-limit-*): in its cwd or its arguments (a stand-in claude script lives there)
    const tmpLimit = [cwd, ...args].map((a) => /^(\/tmp\/axf-limit-[^/\s]+)/.exec(String(a).replace(/ \(deleted\)$/, ''))?.[1]).find(Boolean) || '';
    out.push({ pid, ppid, args, cwd: cwd.replace(/ \(deleted\)$/, ''), cwdDeleted: / \(deleted\)$/.test(cwd), startMs: procStart(pid, boot), buildEnv, sessionEnv, sameNs: !ns || !pns || ns === pns, ...(tmpLimit ? { tmpLimit, tmpLimitGone: !existsSync(tmpLimit) } : {}) });
  }
  return out;
}

function descendants(procs, pid) {
  const kids = new Map(); for (const p of procs) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  const out = []; const stack = [pid];
  while (stack.length) { for (const c of kids.get(stack.pop()) ?? []) { out.push(c); stack.push(c.pid); } }
  return out;
}

export function tmuxList(procs = []) {
  if (process.env.AXF_SLOTS_TMUX === 'off') return [];
  const r = spawnSync('tmux', ['ls', '-F', '#{session_name}\t#{session_created}\t#{pane_pid}'], { encoding: 'utf8', timeout: 10e3 });
  if (r.error || r.status !== 0) return [];
  return r.stdout.split('\n').filter(Boolean).map((l) => {
    const [name, created, pane] = l.split('\t');
    const panePid = Number(pane) || 0;
    const paneClaude = descendants(procs, panePid).some((p) => isClaude(p.args));
    let finished = false;
    if (/^axf-/.test(name) && !paneClaude) finished = /── finished \(exit/.test(spawnSync('tmux', ['capture-pane', '-p', '-t', `=${name}`, '-S', '-40'], { encoding: 'utf8', timeout: 10e3 }).stdout || '');
    return { name, createdMs: (Number(created) || 0) * 1000, panePid, paneClaude, finished };
  });
}

/** pids listening on a TCP port (ss -ltnp). */
export function listenerPids() {
  const r = spawnSync('ss', ['-ltnpH'], { encoding: 'utf8', timeout: 10e3 });
  if (r.error || r.status !== 0) return new Set();
  return new Set([...r.stdout.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])));
}

/** Hostnames of the live docker containers (a slots entry of a host not here is gone), or null when docker can't say. */
export function containerHosts() {
  const ids = spawnSync('docker', ['ps', '-q'], { encoding: 'utf8', timeout: 15e3 });
  if (ids.error || ids.status !== 0) return null;
  const list = ids.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
  const out = new Set(list);
  if (list.length) {
    const r = spawnSync('docker', ['inspect', '-f', '{{.Config.Hostname}}', ...list], { encoding: 'utf8', timeout: 15e3 });
    for (const h of (r.stdout ?? '').split('\n').map((x) => x.trim()).filter(Boolean)) out.add(h);
  }
  return out;
}

function tailText(f, bytes = 64 * 1024) {
  let fd = null;
  try {
    const size = statSync(f).size;
    const n = Math.min(size, bytes);
    const buf = Buffer.alloc(n);
    fd = openSync(f, 'r');
    readSync(fd, buf, 0, n, size - n);
    return buf.toString('utf8');
  } catch { return ''; } finally { if (fd != null) try { closeSync(fd); } catch { /* closed */ } }
}

/** One build's log facts: newest write of its logs and meters, how its log ends, whether its folder still exists. */
export function logFacts(build, { root = worktreesRoot(), hdir = headlessDir() } = {}) {
  // a build may work in a second worktree of another repo (<build>.axhub): its writes count too
  const dirs = [join(root, build), join(root, `${build}.axhub`)].filter((d) => existsSync(d));
  const folder = dirs.length > 0;
  const files = dirs.flatMap((d) => [join(d, `${build}.log`), join(d, '.axf-headless.log')]);
  let meters = [];
  try { meters = readdirSync(hdir).filter((n) => n.startsWith(`axf-${build}`) && n.endsWith('.meter.json') && buildOfSession(n.replace(/\.meter\.json$/, '')) === build).map((n) => join(hdir, n)); } catch { /* none */ }
  const lastWriteMs = Math.max(0, ...files.map(mtime), ...meters.map(mtime));
  const main = files.filter((f) => existsSync(f)).sort((a, b) => mtime(b) - mtime(a))[0];
  const end = main ? logEnding(tailText(main)) : { ended: false, kind: '' };
  return { lastWriteMs, folder, ...end };
}

function endedSessions(hdir = headlessDir()) {
  const out = new Set();
  for (const l of tailText(join(hdir, 'events.jsonl'), 512 * 1024).split('\n')) {
    if (!l.includes('"session-end"')) continue;
    try { const e = JSON.parse(l); if (e.session) out.add(e.session); } catch { /* partial line */ }
  }
  return out;
}

function tempItems(procs, slotsDirPath, tmp = '/tmp') {
  const out = [];
  const used = (p) => procs.some((x) => x.args.some((a) => a.includes(p)));
  try {
    for (const n of readdirSync(tmp)) {
      if (n.startsWith('axf-limit-')) out.push({ path: join(tmp, n), kind: 'limit', mtimeMs: mtime(join(tmp, n)) });
      else if (n.startsWith('axf-ctx-')) out.push({ path: join(tmp, n), kind: 'ctx', mtimeMs: mtime(join(tmp, n)), used: used(join(tmp, n)) });
    }
  } catch { /* no /tmp */ }
  try { for (const n of readdirSync(slotsDirPath)) if (/\.json\.\d+\.tmp$/.test(n)) out.push({ path: join(slotsDirPath, n), kind: 'state-tmp', mtimeMs: mtime(join(slotsDirPath, n)) }); } catch { /* no dir */ }
  return out;
}

/** Build statuses straight from the store file (read only: loadStore() absorbs foreign writes and can take seconds). */
async function storeStatuses() {
  try {
    const { storeFile } = await import('./builds-store.mjs');
    const builds = readJson(storeFile(), {})?.builds;
    return Object.fromEntries((Array.isArray(builds) ? builds : []).filter((b) => b?.id && !b.deleted).map((b) => [b.id, { status: String(b.status ?? '') }]));
  } catch { return {}; }
}

/** Everything plan() needs, read from the host. */
export async function gather({ env = process.env, now = Date.now() } = {}) {
  const slots = await import('./agent-slots.mjs');
  const root = worktreesRoot(env); const hdir = headlessDir(env);
  const procs = processes();
  const tmux = tmuxList(procs);
  const st = slots.withState((x) => x);
  const builds = await storeStatuses();
  const names = new Set([
    ...procs.map((p) => pathBuild(p, root)),
    ...tmux.map((t) => buildOfSession(t.name)),
    ...st.running.map((r) => r.build || buildOfSession(r.session)),
  ].filter(Boolean));
  const logs = Object.fromEntries([...names].map((b) => [b, logFacts(b, { root, hdir })]));
  return {
    now, root, host: env.AXF_SLOTS_HOST || hostname(), self: ancestors(), containers: containerHosts(),
    procs, tmux, listeners: listenerPids(), builds, logs, slots: { running: st.running, queue: st.queue, heavy: st.heavy },
    ended: endedSessions(hdir), tmp: tempItems(procs, slots.slotsDir(), env.AXF_REAPER_TMP || '/tmp'),
  };
}

/* ---------------- store, apply, report ---------------- */

async function slotsDirOf() { return (await import('./agent-slots.mjs')).slotsDir(); }
const settingsFile = (dir) => join(dir, 'reaper.json');
const stateFile = (dir) => join(dir, 'reaper-state.json');
export const logFile = (dir) => join(dir, 'reaper.jsonl');
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(v, null, 2)}\n`); renameSync(tmp, f); }

export async function loadSettings() { return normSettings(readJson(settingsFile(await slotsDirOf()), {}) ?? {}); }
export async function saveSettings(patch) { const f = settingsFile(await slotsDirOf()); const next = normSettings({ ...(readJson(f, {}) ?? {}), ...patch }); writeJson(f, next); return next; }

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function killProc(a) {
  // the pid must still be the process we judged (not one that took its number since)
  const start = procStart(a.pid);
  if (!start || (a.startMs && Math.abs(start - a.startMs) > 2000)) return 'gone before the kill';
  // a finished run: its wrapper (deploy/claude-headless.sh) reads this and records the end as a clean finish, not a crash
  if (a.marker && existsSync(a.marker)) { try { writeFileSync(join(a.marker, '.axf-reaped.json'), `${JSON.stringify({ $axf: SCHEMA, kind: 'phase-done', pid: a.pid, at: new Date().toISOString(), why: a.why })}\n`); } catch { /* the kill still goes ahead */ } }
  try { process.kill(a.pid, 'SIGTERM'); } catch (e) { return e.code === 'ESRCH' ? '' : e.message; }
  for (let i = 0; i < 100 && pidAlive(a.pid); i++) sleep(100);
  if (pidAlive(a.pid)) { try { process.kill(a.pid, 'SIGKILL'); } catch { /* gone */ } }
  return '';
}

function appendEvent(a, env) {
  const hdir = headlessDir(env);
  mkdirSync(hdir, { recursive: true });
  appendFileSync(join(hdir, 'events.jsonl'), `${JSON.stringify({ event: 'session-end', session: a.session, name: a.build, cwd: a.cwd || '', log: a.cwd ? join(a.cwd, `${a.build}.log`) : '', surface: 'reaper', at: new Date().toISOString(), exit: a.exit, kind: a.kind, by: 'reaper' })}\n`);
}

/** Carry out a plan. Returns the actions with { applied, error }. */
export async function apply(actions, { env = process.env } = {}) {
  const slots = await import('./agent-slots.mjs');
  const drops = actions.filter((a) => a.type === 'drop-slot');
  if (drops.length) {
    slots.withState((st) => {
      for (const a of drops) {
        const e = (st[a.list] ?? []).find((x) => x.id === a.id);
        if (!e) { a.error = 'already gone'; continue; }
        st[a.list] = st[a.list].filter((x) => x !== e);
        if (a.list !== 'heavy') st.done = [...st.done, { ...e, state: 'reaped', why: a.why, closedAt: new Date().toISOString() }].slice(-50);
        a.applied = true;
      }
    });
  }
  for (const a of actions) {
    if (a.type === 'drop-slot') continue;
    try {
      if (a.type === 'kill-proc') a.error = killProc(a);
      else if (a.type === 'kill-tmux') { const r = spawnSync('tmux', ['kill-session', '-t', `=${a.session}`], { encoding: 'utf8', timeout: 10e3 }); a.error = r.status === 0 ? '' : (r.stderr || 'tmux refused').trim().slice(0, 200); }
      else if (a.type === 'rm') rmSync(a.path, { recursive: true, force: true });
      else if (a.type === 'end-event') appendEvent(a, env);
      a.applied = !a.error;
    } catch (e) { a.error = String(e.message).slice(0, 200); a.applied = false; }
  }
  return actions;
}

/** One note per pass on AmberX's "Automatic fixes" list (created when missing). */
async function writeNote(sum) {
  const { runAmberx } = await import('../../apps/console-web/plugins/token-control/lib/amberx.mjs');  // axf-plugin:token-control (no plugin: the note is skipped, the pass goes on)
  const found = runAmberx({ target: 'amberx.lists', op: 'list', select: { q: NOTES_LIST } }).items.find((l) => l.name === NOTES_LIST);
  const list = found?.id ?? runAmberx({ target: 'amberx.lists', op: 'add', value: { name: NOTES_LIST } }).item.id;
  return runAmberx({ target: 'amberx.items', op: 'add', by: 'reaper', value: { list, kind: 'note', title: sum.title.slice(0, 200), text: `${sum.body}\n\n${sum.at} · by ${sum.by}`, tags: ['reaper', 'auto-fix'] } }).item.id;
}

/** The phone FYI: notify type pipeline.reaper (build-orchestrator notify.json), through the console's alerts API. */
function sendAlert(sum, env = process.env) {
  const name = env.AXF_PIPELINE_CONSOLE || 'axf-console';
  if (name === 'off') return false;
  const body = { source: 'pipeline', key: `${ALERT_PREFIX}:${sum.at}`, severity: 'info', title: sum.title, body: sum.body.slice(0, 1500), meta: { kind: 'pipeline.reaper', count: sum.count } };
  const cmd = `curl -s -m 20 -X POST -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" --data-binary @- "http://127.0.0.1:${env.AXF_CONSOLE_PORT || 7090}/api/alerts"`;
  const r = spawnSync('docker', ['exec', '-i', name, 'sh', '-c', cmd], { input: JSON.stringify(body), encoding: 'utf8', timeout: 30e3 });
  return !r.error && r.status === 0;
}

/** Can a pass judge this machine? Only the VPS host (not a container, not CI). */
export function onHost(env = process.env) {
  if (env.AXF_REAPER === 'off') return { ok: false, why: 'AXF_REAPER=off' };
  if (existsSync('/.dockerenv')) return { ok: false, why: 'inside a container: the host runs the reaper' };
  if (!existsSync('/proc')) return { ok: false, why: 'no /proc here' };
  if (!existsSync(worktreesRoot(env))) return { ok: false, why: `no ${worktreesRoot(env)} here (not the VPS)` };
  return { ok: true, why: '' };
}

/**
 * One pass: gather, plan, apply (unless dry), log every action, note + FYI. Returns
 * { ran, at, by, dry, actions, summary, notified, note, why? }.
 */
export async function run({ by = 'cli', dry = false, env = process.env, facts = null, notify = null, note = null } = {}) {
  const at = new Date().toISOString();
  const host = facts ? { ok: true } : onHost(env);
  if (!host.ok) return { ran: false, at, by, why: host.why, actions: [] };
  const settings = await loadSettings();
  if (!settings.enabled) return { ran: false, at, by, why: 'the reaper is off (reaper.json enabled=false)', actions: [] };
  const dir = await slotsDirOf();
  const f = facts ?? await gather({ env });
  const actions = plan(f, settings);
  const isDry = dry || settings.dryRun;
  if (!isDry && actions.length) await apply(actions, { env });
  const done = actions.filter((a) => isDry || a.applied);
  const summary = summarize(done, { at, by });
  const res = { $axf: SCHEMA, ran: true, at, by, dry: isDry, actions, summary, notified: false, note: '' };
  if (!isDry) {
    mkdirSync(dir, { recursive: true });
    for (const a of actions) appendFileSync(logFile(dir), `${JSON.stringify({ at, by, type: a.type, what: a.what, why: a.why, build: a.build ?? '', applied: !!a.applied, ...(a.error ? { error: a.error } : {}) })}\n`);
    if (done.length && settings.notes) { try { res.note = await (note ?? writeNote)(summary); } catch (e) { res.noteError = String(e.message).slice(0, 200); } }
    if (done.some(isKill) && settings.notify) { try { res.notified = !!(notify ?? ((s) => sendAlert(s, env)))(summary); } catch (e) { res.notifyError = String(e.message).slice(0, 200); } }
    writeJson(stateFile(dir), { $axf: 'vps-reaper-state@1', lastRun: at, by, actions: actions.length, kills: done.filter(isKill).length });
  }
  return res;
}

/**
 * The hook every launch, land, merge and dispatcher tick calls first: a pass at most once per minIntervalSec, never
 * throws, off under tests and off the host. Returns the pass or { ran: false, why }.
 */
export async function reapFirst(by = 'hook', { env = process.env } = {}) {
  try {
    if (env.NODE_TEST_CONTEXT || env.AXF_SLOTS_DIR || env.AXF_HEADLESS_DIR || env.AXF_PIPELINE_WORKTREES) return { ran: false, why: 'test environment' };
    const host = onHost(env);
    if (!host.ok) return { ran: false, why: host.why };
    const dir = await slotsDirOf();
    const settings = await loadSettings();
    const last = Date.parse(readJson(stateFile(dir), {})?.lastRun || 0) || 0;
    if (Date.now() - last < settings.minIntervalSec * 1000) return { ran: false, why: 'ran moments ago' };
    return await run({ by, env });
  } catch (e) { return { ran: false, why: `reaper failed: ${String(e.message).slice(0, 200)}` }; }
}

/** Synchronous callers (the dispatcher's tick, launch): the same pass in a child process, waited for. */
export function reapFirstSync(by = 'hook', { env = process.env, timeoutMs = 60e3 } = {}) {
  if (env.NODE_TEST_CONTEXT || env.AXF_SLOTS_DIR || env.AXF_HEADLESS_DIR || env.AXF_PIPELINE_WORKTREES) return { ran: false, why: 'test environment' };
  const host = onHost(env);
  if (!host.ok) return { ran: false, why: host.why };
  const r = spawnSync(process.execPath, [SELF, 'first', '--by', by, '--json'], { encoding: 'utf8', timeout: timeoutMs, env });
  try { return JSON.parse(r.stdout); } catch { return { ran: false, why: `reaper exited ${r.status ?? r.signal}` }; }
}

/* ---------------- CLI ---------------- */

const SELF = fileURLToPath(import.meta.url);

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) out[k] = true; else { out[k] = v; i++; } }
    else out._.push(a);
  }
  return out;
}

function print(res, json) {
  if (json) return console.log(JSON.stringify(res, (k, v) => (v instanceof Set ? [...v] : v)));
  if (!res.ran) return console.log(`reaper: skipped (${res.why})`);
  const verb = res.dry ? 'would' : 'did';
  if (!res.actions.length) return console.log(`${res.at} reaper (${res.by}): nothing to clean`);
  console.log(`${res.at} reaper (${res.by}): ${res.summary.title}${res.dry ? ' (dry run)' : ''}`);
  for (const a of res.actions) console.log(`  ${verb} ${a.type} ${a.what}: ${a.why}${a.error ? ` [failed: ${a.error}]` : ''}`);
  if (res.note) console.log(`  note ${res.note} on "${NOTES_LIST}"`);
  if (res.notified) console.log('  phone FYI sent');
}

async function cli(argv) {
  const [cmd = 'run', ...rest] = argv;
  const f = flags(rest);
  switch (cmd) {
    case 'run': return print(await run({ by: typeof f.by === 'string' ? f.by : 'cli', dry: !!f.dry }), f.json);
    case 'plan': return print(await run({ by: 'plan', dry: true }), f.json);
    case 'first': return print(await reapFirst(typeof f.by === 'string' ? f.by : 'hook'), f.json);
    case 'settings': return console.log(JSON.stringify(await loadSettings(), null, 2));
    case 'set': return console.log(JSON.stringify(await saveSettings(Object.fromEntries(f._.map((kv) => kv.split('='))))));
    case 'log': {
      const n = Number(f.n) || 50;
      const lines = readText(logFile(await slotsDirOf())).split('\n').filter(Boolean).slice(-n);
      return console.log(lines.join('\n') || 'reaper: nothing logged yet');
    }
    default: throw new Error(`unknown command ${cmd} (run, plan, first, settings, set, log)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  cli(process.argv.slice(2)).catch((e) => { console.error(`reaper: ${e.message}`); process.exitCode = 2; });
}

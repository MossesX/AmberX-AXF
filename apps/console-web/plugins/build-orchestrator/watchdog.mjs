#!/usr/bin/env node
/**
 * watchdog.mjs — the running-builds watchdog (IO side of watchdog-core.mjs). Brett, Nov 9 2026: the store showed six
 * builds running while the VPS ran none (dead logins reported as success). Every dispatcher tick (pipeline.mjs tick, cron
 * every minute; at most every watchdogEverySec) it compares each build marked `running` with the VPS: tmux sessions
 * (axf-<id>[--agent]), live `claude -p` processes in the worktree, the log and the headless events, then acts:
 *
 *   finished      every step ticked, nothing runs        → built (complete when merged)
 *   waiting       clean end with steps left              → pending (waits on Brett: UI Review / next step)
 *   phase-done    clean end, next step on another model  → queued (the dispatcher starts the next phase)
 *   auth          the log ends on a dead Claude login    → account off the worker list (claude-workers limit), requeued
 *                                                          when another account has room, else blocked; Brett told to sign in
 *   crashed       no session, no process, quiet          → queued again (max watchdogMaxRetries), then failed
 *   stale         dead with no sign of life for over a day → pending (not relaunched blind; Brett re-queues)
 *   stalled       session alive, no log output for N min → session killed, queued again (same retry limit)
 *   stray         a live session whose build is not marked running → marked running
 *
 * Every action: a build note, a line on stdout (the cron log), a log.jsonl line and an alert (AmberX notification).
 * Last result: <pipeline dir>/watchdog.json (pipeline.mjs status carries it to the console and MCP).
 *
 *   node apps/console-web/plugins/build-orchestrator/watchdog.mjs [check] [--dry] [--force] [--json]
 *   … status [--json]                  the last check
 * Tests: AXF_WATCHDOG_PROC=off (no /proc scan), AXF_SLOTS_TMUX=off (no tmux: the watchdog skips, it can't see reality).
 */
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as W from './watchdog-core.mjs';
import * as P from './pipeline-core.mjs';
import * as BP from '../../../../framework/core/build-pipeline.mjs';
import { modelKey } from '../../../../framework/core/model-policy.mjs';
import { loadStore } from '../../../../framework/cli/builds-store.mjs';
import * as slots from '../../../../framework/cli/agent-slots.mjs';
import { markLimit } from '../../../../deploy/claude-workers.mjs';
import { accountsNow, loadSettings, makeConsole, pipeDir, setPipeline } from './pipeline.mjs';

const nowIso = () => new Date().toISOString();
const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(v, null, 1)}\n`); renameSync(tmp, f); }
export const stateFile = () => join(pipeDir(), 'watchdog.json');
export const loadWatchdog = () => readJson(stateFile(), null);
const logLine = (o) => { try { writeFileSync(join(pipeDir(), 'log.jsonl'), `${JSON.stringify({ at: nowIso(), ...o })}\n`, { flag: 'a' }); } catch { /* courtesy */ } };
const AUTH_HOLD_MS = 24 * 3600e3; // a dead login stays off the worker list until Brett signs it in (sign-in clears it)
const RETRY_WINDOW_MS = 24 * 3600e3;

// ------------------------------------------------------------------ reality

const worktreesRoot = (env = process.env) => env.AXF_PIPELINE_WORKTREES || '/root/axf-builds';
const headlessDir = (env = process.env) => env.AXF_HEADLESS_DIR || '/var/tmp/axf-headless';

function readEvents(env) {
  let t = ''; try { t = readFileSync(join(headlessDir(env), 'events.jsonl'), 'utf8'); } catch { return []; }
  return t.split('\n').flatMap((l) => { if (!l.trim()) return []; try { return [JSON.parse(l)]; } catch { return []; } });
}

/** Live `claude -p` processes: [{ pid, cwd }] (null when /proc can't be read). */
export function claudeProcs(env = process.env) {
  if (env.AXF_WATCHDOG_PROC === 'off') return [];
  let pids; try { pids = readdirSync('/proc').filter((p) => /^\d+$/.test(p)); } catch { return null; }
  const out = [];
  for (const pid of pids) {
    try {
      const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
      if (basename(argv[0] || '') !== 'claude' || !argv.includes('-p')) continue;
      out.push({ pid: Number(pid), cwd: readlinkSync(`/proc/${pid}/cwd`) });
    } catch { /* gone */ }
  }
  return out;
}

/** The last `bytes` of a file and its mtime, or null. */
function logInfo(file, bytes = 6000) {
  try {
    const st = statSync(file); const fd = openSync(file, 'r');
    try { const n = Math.min(bytes, st.size); const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, st.size - n); return { file, mtimeMs: st.mtimeMs, tail: buf.toString('utf8') }; } finally { closeSync(fd); }
  } catch { return null; }
}

/** What the VPS shows for every build: { sessions: Map, procs, events, slotsState } (null when tmux can't be asked). */
export function reality(env = process.env) {
  const tmux = slots.tmuxSessions(); if (!tmux) return null;
  let slotState = { running: [], queue: [] }; try { slotState = slots.loadState(); } catch { /* none */ }
  return { sessions: [...tmux.keys()], procs: claudeProcs(env) ?? [], events: readEvents(env), slotState };
}

/** One build's observation for W.classify. */
export function observe(b, r, env = process.env) {
  const dir = join(worktreesRoot(env), b.id);
  const mine = r.events.filter((e) => e.name === b.id || W.idOfSession(e.session) === b.id);
  const lastStart = mine.filter((e) => e.event === 'session-start').pop() ?? null;
  const endEv = mine.filter((e) => e.event === 'session-end').pop() ?? null;
  const ended = !!endEv && (!lastStart || Date.parse(endEv.at) >= Date.parse(lastStart.at));
  const login = mine.filter((e) => e.event === 'session-login').pop();
  const sessions = W.sessionsOf(b.id, r.sessions);
  const procs = r.procs.filter((p) => p.cwd === dir || p.cwd.startsWith(`${dir}/`)).length;
  const logFile = lastStart?.log || join(dir, `${b.id}.log`);
  const log = logInfo(logFile);
  const stepsLeft = BP.openSteps(b).length;
  const runModel = b.pipeline?.model || lastStart?.model || '';
  const next = BP.nextModel(b);
  const phaseSwitch = !!(stepsLeft && runModel && next && modelKey(next) !== modelKey(runModel));
  const slotQueued = (r.slotState.queue ?? []).some((q) => q.name === b.id) || (r.slotState.running ?? []).some((q) => q.name === b.id && q.state === 'starting');
  const doneAts = b.steps.map((s) => Date.parse(s.doneAt || 0) || 0);
  const lastSignMs = Math.max(Date.parse(b.updatedAt || 0) || 0, Date.parse(b.pipeline?.launchedAt || 0) || 0, ...doneAts);
  return {
    id: b.id, stepsLeft, phaseSwitch, sessions, procs, ended: ended && !procs, slotQueued, log, lastSignMs,
    lastEnd: ended ? { exit: Number.isInteger(endEv.exit) ? endEv.exit : Number(endEv.exit) || 0, at: endEv.at } : null,
    account: b.pipeline?.account || login?.account || endEv?.account || '',
  };
}

// ------------------------------------------------------------------ the check

function killSession(name) { spawnSync('tmux', ['kill-session', '-t', `=${name}`], { encoding: 'utf8' }); }

/**
 * One watchdog round. { dry } = classify and report only; { force } = ignore watchdogEverySec; `alert(kind, d)` = the
 * dispatcher's alert sender (defaults to the console's alerts API). Returns the record saved to watchdog.json.
 */
export function check({ env = process.env, dry = false, force = false, alert = null, print = (l) => console.log(l) } = {}) {
  const settings = loadSettings(env);
  const prev = loadWatchdog() ?? {};
  if (!settings.watchdogOn && !force) return { ...prev, skipped: 'watchdog is off (pipeline setting watchdogOn)' };
  if (!force && prev.at && Date.now() - Date.parse(prev.at) < settings.watchdogEverySec * 1000 - 5000) return { ...prev, skipped: `checked ${Math.round((Date.now() - Date.parse(prev.at)) / 1000)} s ago` };
  const r = reality(env);
  if (!r) return { ...prev, skipped: 'tmux is not reachable here: the watchdog only runs on the VPS host' };
  const send = alert ?? ((kind, d) => { const res = makeConsole(env)('POST', '/api/alerts', P.alertFor(kind, d)); if (env.AXF_PIPELINE_CONSOLE !== 'off' && !res?.ok) print(`watchdog: alert for ${d.id} not delivered: ${JSON.stringify(res?.detail ?? res ?? 'no answer').slice(0, 200)}`); });
  const store = loadStore();
  const builds = store.builds.filter((b) => !b.deleted);
  const running = builds.filter((b) => b.status === 'running');
  const now = Date.now();
  const retries = Object.fromEntries(Object.entries(prev.retries ?? {}).map(([k, v]) => [k, (v ?? []).filter((t) => now - Date.parse(t) < RETRY_WINDOW_MS)]).filter(([, v]) => v.length));
  const findings = []; const actions = []; let real = 0;
  let accounts = null;
  const healthyFor = (bad) => { try { accounts ??= accountsNow(loadStore(), settings); return accounts.some((a) => a.name !== bad && a.usable && a.free > 0); } catch { return false; } };
  for (const b of running) {
    const o = observe(b, r, env);
    const f = W.classify(o, settings, now);
    if (f.kind === 'ok' && (o.procs || (o.sessions.length && !o.ended))) real += 1;
    findings.push({ ...f, account: o.account, sessions: o.sessions, procs: o.procs });
    const a = W.decide(f, { title: b.title, account: o.account, retries: (retries[b.id] ?? []).length, maxRetries: settings.watchdogMaxRetries, healthy: f.kind === 'auth' ? healthyFor(o.account) : true, mergedAt: b.mergedAt, sessions: o.sessions });
    if (a) actions.push({ ...a, account: o.account, title: b.title, stepsLeft: o.stepsLeft });
  }
  // the reverse: live build sessions the store doesn't show as running
  const liveSessions = r.sessions.filter((s) => W.idOfSession(s)).map((s) => ({ session: s, id: W.idOfSession(s) }))
    .filter((s) => { const ob = observe({ id: s.id, steps: [], pipeline: null }, r, env); return ob.procs > 0 || !ob.ended; });
  for (const s of W.strays(liveSessions, builds)) {
    actions.push({ id: s.id, kind: 'stray', status: 'running', retry: false, kill: [], markAuth: '', title: builds.find((b) => b.id === s.id)?.title ?? s.id,
      note: `Watchdog: session ${s.session} is live but the build was ${s.was}: marked running.`, alert: { severity: 'info', title: `Running again: ${s.id}`, body: `Session ${s.session} is live; the build said ${s.was}.` } });
  }
  const done = [];
  for (const a of actions) {
    const line = `watchdog: ${a.id}: ${a.kind} → ${a.status}${a.kill.length ? ` (killed ${a.kill.join(', ')})` : ''}${a.markAuth ? ` (${a.markAuth} off the worker list)` : ''}`;
    if (dry) { print(`(dry) ${line}`); done.push({ ...a, dry: true }); continue; }
    try {
      for (const s of a.kill) killSession(s);
      if (a.markAuth) { try { markLimit(a.markAuth, { kind: 'auth', until: Date.now() + AUTH_HOLD_MS }); } catch (e) { print(`watchdog: could not mark ${a.markAuth}: ${e.message}`); } }
      const patch = a.status === 'queued' ? { session: '', slot: '', queuedAt: nowIso(), queuedBy: 'watchdog', note: `watchdog: ${a.kind}` } : a.status === 'running' ? { note: '' } : { session: '', slot: '', note: `watchdog: ${a.kind}` };
      // back to Pending = handed to Brett: "Launch builds without asking" must not queue it again by itself
      if (a.status === 'pending') patch.lastRun = { at: nowIso(), exit: null, outcome: 'returned', stepsLeft: a.stepsLeft ?? 0, account: a.account || '', session: '' };
      setPipeline(a.id, patch, { status: a.status, note: a.note, by: 'watchdog', action: `watchdog:${a.kind}` });
      if (a.retry) retries[a.id] = [...(retries[a.id] ?? []), nowIso()];
      try { send('watchdog', { id: a.id, account: a.account, severity: a.alert.severity, title: a.alert.title, body: a.alert.body }); } catch { /* the alert is best effort */ }
      print(line); logLine({ event: 'watchdog', build: a.id, kind: a.kind, status: a.status, account: a.account || '' });
      done.push({ id: a.id, kind: a.kind, status: a.status, at: nowIso(), note: a.note.slice(0, 300) });
    } catch (e) { print(`watchdog: ${a.id}: ${a.kind}: could not act: ${e.message}`); done.push({ id: a.id, kind: a.kind, status: 'error', at: nowIso(), note: String(e.message).slice(0, 300) }); }
  }
  const out = { $axf: 'pipeline-watchdog@1', at: nowIso(), dry, marked: running.length, real, findings, actions: done,
    recent: [...(prev.recent ?? []), ...(dry ? [] : done)].slice(-40), retries, settings: { on: settings.watchdogOn, everySec: settings.watchdogEverySec, stallMin: settings.watchdogStallMin, maxRetries: settings.watchdogMaxRetries } };
  out.summary = W.summaryLine(out);
  if (!dry) writeJson(stateFile(), out);
  return out;
}

// ------------------------------------------------------------------ CLI

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2); const json = argv.includes('--json');
  const [cmd = 'check'] = argv.filter((a) => !a.startsWith('--'));
  try {
    if (cmd === 'status') { const s = loadWatchdog(); console.log(json ? JSON.stringify({ ok: true, watchdog: s }) : s ? `${s.at} · ${s.summary}` : 'the watchdog has not run yet'); }
    else if (cmd === 'check') {
      const r = check({ dry: argv.includes('--dry'), force: argv.includes('--force'), print: json ? () => {} : (l) => console.log(l) });
      if (json) console.log(JSON.stringify({ ok: true, watchdog: r }));
      else { console.log(r.skipped ? `watchdog skipped: ${r.skipped}` : `watchdog ${r.at}: ${r.summary}`); for (const f of r.skipped ? [] : r.findings) console.log(`  ${f.id}: ${f.kind} · ${f.why}`); }
    } else { console.error('usage: watchdog.mjs [check] [--dry] [--force] [--json] | status [--json]'); process.exit(2); }
  } catch (e) { console.error(`watchdog: ${e.message}`); process.exit(1); }
}

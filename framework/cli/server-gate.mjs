#!/usr/bin/env node
/**
 * server-gate — one session per build, one session per build worktree, on the VPS (Nov 12 2026: two sessions of the
 * same build ran side by side in one worktree and wrote over each other's work).
 *
 * The lock. Every VPS launch path (deploy/claude-headless.sh: the direct start, the agent-slots queue waiter, the
 * look-approval waiter, the tmux inner run) asks this gate before a build session starts. A build launch takes two
 * exclusive locks: one on the build ID, one on its worktree. A second launch while the first one's session is alive
 * (its tmux session, or the process holding the lock while it waits for a slot or a look approval) is refused (exit 3),
 * written to the gate log and sent to AmberX as an FYI. A lock whose holder is gone is stale and is taken over.
 * Runs started by one launch (the waiters, the inner run) carry the launch's owner tag (AXF_GATE_OWNER, passed as
 * --owner on acquire; a fresh launch never inherits one) and pass.
 * Non-build sessions (a walkthrough, a chat, a UI shot job) take no lock.
 *
 * The gate log (server-gate-log@1). Every time a server gate is hit (a duplicate launch refused, a duplicate session
 * reaped, the agent-slot limit, the orchestrator-ID (dispatch) gate, the main gate) one line goes to
 * <pipeline folder>/server-gate-log.jsonl: time, gate, build, who/what tried it, what the gate did. It lives on the
 * server (the hub's data folder, the same one the console reads), survives restarts and is trimmed to LOG_KEEP lines.
 *
 *   node framework/cli/server-gate.mjs acquire [--build <id>] [--name <session>] [--brief <file>] [--worktree <dir>]
 *                                              [--pid <n>] [--session <tmux>] [--by <who>] [--json]   exit 0 ok · 3 refused
 *   … hold    (same options)       the launch's own later run (waiter, inner): refresh pid / session on its locks
 *   … release (same options)       the session ended: drop its locks (only the owner's)
 *   … status [--json]              locks on file, with whether each holder is alive
 *   … sessions <build> [--json]    the live tmux sessions of one build (oldest first)
 *   … reap [--dry] [--json]        every build with more than one live session: keep the oldest, end the rest
 *   … log [--gate <g>] [--build <id>] [--limit n] [--json]      the gate log, newest first
 *   … record --gate <g> [--build <id> | --name <session> --brief <file>] [--by <who>] --action <what> [--detail <text>]
 *   … gates [--json]               the gate kinds and their counts
 *   … banner [--place own|bar|off|<banner id>] [--json]   where the console shows the gate log widget (read / set)
 *
 * Env: AXF_GATE_DIR (else the pipeline folder: AXF_PIPELINE_DIR, the hub's _data/pipeline, ~/.axf/pipeline),
 * AXF_GATE_OWNER (set by the launcher), AXF_GATE_ALERTS=off (no FYI), AXF_GATE_TMUX=off (no tmux: tests),
 * AXF_GATE_SESSIONS=<file> (a JSON list of sessions instead of tmux: tests).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA_LOCK = 'server-gate-lock@1';
export const SCHEMA_LOG = 'server-gate-log@1';
export const GATES = Object.freeze(['duplicate-launch', 'duplicate-reaped', 'slot-limit', 'dispatch', 'main']);
export const GATE_LABEL = Object.freeze({
  'duplicate-launch': 'Duplicate launch refused',
  'duplicate-reaped': 'Duplicate session reaped',
  'slot-limit': 'Slot limit',
  dispatch: 'Orchestrator-ID gate',
  main: 'Main gate',
});
export const LOG_KEEP = 5000;
/** A lock younger than this is held even when its holder can't be seen yet (the launcher is between steps). */
export const FRESH_MS = 60e3;
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const nowIso = () => new Date().toISOString();

export function gateDir(env = process.env) {
  if (env.AXF_GATE_DIR) return env.AXF_GATE_DIR;
  if (env.AXF_PIPELINE_DIR) return env.AXF_PIPELINE_DIR;
  const hub = join(env.AXHUB_PROJECTS_DIR || '/projects', 'amberx-axf', '_data');
  return existsSync(hub) ? join(hub, 'pipeline') : join(homedir(), '.axf', 'pipeline');
}
export const logFile = (env = process.env) => join(gateDir(env), 'server-gate-log.jsonl');
const lockDir = (env) => join(gateDir(env), 'session-locks');
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

/** The worktree's canonical path (symlinks resolved), '' when none. */
export function worktreeKey(dir) {
  if (!dir) return '';
  try { return realpathSync(dir); } catch { return resolve(dir); }
}
const lockFiles = (build, worktree, env) => {
  const d = lockDir(env);
  return [
    ...(build ? [{ kind: 'build', key: build, file: join(d, `build-${build}.json`) }] : []),
    ...(worktree ? [{ kind: 'worktree', key: worktree, file: join(d, `worktree-${createHash('sha1').update(worktree).digest('hex').slice(0, 16)}.json`) }] : []),
  ];
};

// ------------------------------------------------------------------ who is alive

export function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 1) return false;
  try { process.kill(n, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Every tmux session: [{ name, cwd, created (epoch s), build }] ([] when tmux is off or missing). */
export function listSessions(env = process.env) {
  if (env.AXF_GATE_SESSIONS) { const j = readJson(env.AXF_GATE_SESSIONS); return Array.isArray(j) ? j.filter((s) => s && !s.ended) : []; }
  if (env.AXF_GATE_TMUX === 'off' || env.AXF_SLOTS_TMUX === 'off') return [];
  const r = spawnSync('tmux', ['list-sessions', '-F', '#{session_name}\t#{@axf_cwd}\t#{session_created}\t#{@axf_build}\t#{@axf_ended}'], { encoding: 'utf8', timeout: 10e3 });
  if (r.error || r.status !== 0) return [];
  // a session whose run ended (it waits a minute or two before it closes) is not a live session of its build
  return r.stdout.split('\n').filter(Boolean).map((l) => { const [name, cwd, created, build, ended] = l.split('\t'); return { name, cwd: cwd || '', created: Number(created) || 0, build: build || '', ended: Boolean(ended) }; }).filter((s) => !s.ended);
}

/** The session name slug claude-headless.sh makes from --name. */
export const slugOf = (name) => String(name || 'run').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'run';

/** Pure: does tmux session `s` belong to build `id` (or run in `worktree`)? */
export function sessionOfBuild(s, id, worktree = '') {
  if (!s?.name) return false;
  if (id && s.build === id) return true;
  if (worktree && s.cwd && worktreeKey(s.cwd) === worktree) return true;
  if (!id) return false;
  const base = `axf-${slugOf(id)}`;
  return s.name === base || new RegExp(`^${base.replace(/[.]/g, '\\.')}(-\\d{6}|--.+)$`).test(s.name);
}

/** The live sessions of one build, oldest first. */
export function sessionsOf(id, { worktree = '', sessions = null, env = process.env } = {}) {
  const all = sessions ?? listSessions(env);
  return all.filter((s) => sessionOfBuild(s, id, worktree)).sort((a, b) => (a.created - b.created) || a.name.localeCompare(b.name));
}

/** Pure: is a lock's holder alive? */
export function holderAlive(rec, { sessions = [], alive = pidAlive, now = Date.now() } = {}) {
  if (!rec) return false;
  if (rec.session && sessions.some((s) => s.name === rec.session)) return true;
  if (rec.pid && alive(rec.pid)) return true;
  return now - Date.parse(rec.at || 0) < FRESH_MS;
}

// ------------------------------------------------------------------ the lock

function writeExclusive(file, rec) {
  mkdirSync(dirname(file), { recursive: true });
  try { const fd = openSync(file, 'wx', 0o644); writeFileSync(fd, `${JSON.stringify(rec, null, 1)}\n`); closeSync(fd); return true; }
  catch (e) { if (e.code === 'EEXIST') return false; throw e; }
}
function rewrite(file, rec) { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(rec, null, 1)}\n`); renameSync(tmp, file); }

/**
 * Take the build's and the worktree's locks. { ok, build, worktree, owner, why, holder? }.
 * `owner` = the launch's tag (the same launch's waiters and inner run pass with it).
 */
export function acquire({ build = '', worktree = '', pid = 0, session = '', by = '', owner = '', env = process.env, sessions = null, alive = pidAlive, now = Date.now(), log = true } = {}) {
  const wt = worktreeKey(worktree);
  if (build && !ID_RE.test(build)) throw Object.assign(new Error(`not a build id: ${build}`), { code: 2 });
  if (!build) return { ok: true, build: '', worktree: wt, owner, why: 'not a build launch: no lock needed' };
  const tag = owner || `g_${randomBytes(9).toString('hex')}`;
  const live = sessions ?? listSessions(env);
  const rec = { $axf: SCHEMA_LOCK, build, worktree: wt, owner: tag, pid: Number(pid) || 0, session: str(session, 120), by: str(by, 120), at: new Date(now).toISOString() };
  const taken = [];
  const refuse = (holder, why) => {
    for (const f of taken) rmSync(f, { force: true });
    if (log) {
      record({ gate: 'duplicate-launch', build, by, action: 'refused the launch', detail: why, worktree: wt, session: holder?.session || '' }, { env, now });
      fyi({ title: `Duplicate launch refused: ${build}`, body: why, build }, env);
    }
    return { ok: false, build, worktree: wt, owner: tag, why, holder };
  };
  // a live session of this build that predates the lock (or was started around it) also counts
  if (!owner) {
    const s = sessionsOf(build, { worktree: wt, sessions: live, env });
    if (s.length) return refuse({ session: s[0].name }, `refused: ${build} already has a live session (${s.map((x) => x.name).join(', ')}). One session per build: the second launch was not started.`);
  }
  for (const l of lockFiles(build, wt, env)) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (writeExclusive(l.file, rec)) { taken.push(l.file); break; }
      const cur = readJson(l.file);
      if (cur && owner && cur.owner === owner) { rewrite(l.file, { ...cur, ...rec, at: cur.at || rec.at }); break; }
      if (cur && holderAlive(cur, { sessions: live, alive, now })) {
        const what = l.kind === 'build' ? `${build} is already running` : `worktree ${wt} is in use by ${cur.build}`;
        return refuse(cur, `refused: ${what} (${cur.session ? `session ${cur.session}` : `pid ${cur.pid || '?'}`}, since ${cur.at}, by ${cur.by || '?'}). One session per build and per worktree: the second launch was not started.`);
      }
      rmSync(l.file, { force: true }); // stale: its holder is gone
      if (attempt === 1) return refuse(cur, `refused: could not take the ${l.kind} lock for ${build}`);
    }
  }
  return { ok: true, build, worktree: wt, owner: tag, why: `${build}: lock taken${owner ? ' (same launch)' : ''}` };
}

/** The launch's later run (waiter, inner run): refresh pid / session on the locks it owns. */
export function hold({ build = '', worktree = '', pid = 0, session = '', owner = '', env = process.env } = {}) {
  const wt = worktreeKey(worktree); const out = [];
  if (!build || !owner) return { ok: true, held: out };
  for (const l of lockFiles(build, wt, env)) {
    const cur = readJson(l.file);
    if (!cur || cur.owner !== owner) continue;
    rewrite(l.file, { ...cur, ...(pid ? { pid: Number(pid) } : {}), ...(session ? { session: str(session, 120) } : {}) });
    out.push(l.kind);
  }
  return { ok: true, held: out };
}

/** The session ended: drop the locks this owner holds. */
export function release({ build = '', worktree = '', owner = '', env = process.env } = {}) {
  const wt = worktreeKey(worktree); const out = [];
  if (!build || !owner) return { ok: true, released: out };
  for (const l of lockFiles(build, wt, env)) {
    const cur = readJson(l.file);
    if (cur && cur.owner === owner) { rmSync(l.file, { force: true }); out.push(l.kind); }
  }
  return { ok: true, released: out };
}

/** Every lock on file, with whether its holder is alive. */
export function status({ env = process.env, sessions = null } = {}) {
  const live = sessions ?? listSessions(env);
  let names = []; try { names = readdirSync(lockDir(env)).filter((f) => f.endsWith('.json')); } catch { /* none */ }
  return names.map((f) => { const r = readJson(join(lockDir(env), f)); return r ? { file: f, build: r.build, worktree: r.worktree, session: r.session, pid: r.pid, by: r.by, at: r.at, alive: holderAlive(r, { sessions: live }) } : null; }).filter(Boolean);
}

// ------------------------------------------------------------------ duplicate sessions

/** Pure: the duplicates to end: per build with more than one live session, every one but the oldest. */
export function duplicates(sessions, builds) {
  const out = [];
  for (const id of builds) {
    const s = sessionsOf(id, { sessions });
    if (s.length > 1) out.push({ build: id, keep: s[0].name, end: s.slice(1).map((x) => x.name) });
  }
  return out;
}

/**
 * End every duplicate session (keep the oldest per build). `builds` = the build ids to look at (default: every build
 * named in a session's @axf_build, plus every build lock on file). Logs each reap and sends one FYI.
 */
export function reap({ builds = null, dry = false, by = 'watchdog', env = process.env, sessions = null, kill = killSession } = {}) {
  const live = sessions ?? listSessions(env);
  const ids = builds ?? [...new Set([...live.map((s) => s.build).filter(Boolean), ...status({ env, sessions: live }).map((l) => l.build).filter(Boolean)])];
  const dups = duplicates(live, ids);
  if (dry) return { ok: true, dry: true, duplicates: dups };
  for (const d of dups) {
    for (const name of d.end) {
      const ok = kill(name, env);
      record({ gate: 'duplicate-reaped', build: d.build, by, action: ok ? `ended duplicate session ${name}, kept ${d.keep}` : `could not end duplicate session ${name}`, detail: `${d.build} had ${d.end.length + 1} live sessions; the oldest (${d.keep}) keeps running.`, session: name }, { env });
    }
    fyi({ title: `Duplicate session reaped: ${d.build}`, body: `Ended ${d.end.join(', ')}; kept the oldest, ${d.keep}.`, build: d.build }, env);
  }
  return { ok: true, duplicates: dups };
}
export function killSession(name, env = process.env) {
  if (env.AXF_GATE_SESSIONS) { const f = env.AXF_GATE_SESSIONS; const j = readJson(f) ?? []; writeFileSync(f, JSON.stringify(j.filter((s) => s.name !== name))); return true; }
  if (env.AXF_GATE_TMUX === 'off' || env.AXF_SLOTS_TMUX === 'off') return false;
  const r = spawnSync('tmux', ['kill-session', '-t', `=${name}`], { encoding: 'utf8', timeout: 10e3 });
  return !r.error && r.status === 0;
}

// ------------------------------------------------------------------ the gate log

/** Pure: one gate log entry, normalised. */
export function normEntry(e = {}, at = nowIso()) {
  return {
    $axf: SCHEMA_LOG, at: str(e.at, 40) || at, gate: GATES.includes(e.gate) ? e.gate : 'main',
    build: str(e.build, 80), by: str(e.by, 120) || 'unknown', action: str(e.action, 300), detail: str(e.detail, 1500),
    ...(e.session ? { session: str(e.session, 120) } : {}), ...(e.worktree ? { worktree: str(e.worktree, 300) } : {}),
  };
}

/** Write one gate log entry (never throws: a gate must not fail because its log could not be written). */
export function record(e, { env = process.env, now = Date.now() } = {}) {
  const entry = normEntry(e, new Date(now).toISOString());
  try {
    const f = logFile(env); mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, `${JSON.stringify(entry)}\n`);
    trim(f);
  } catch { /* best effort */ }
  return entry;
}
function trim(f) {
  let t = ''; try { t = readFileSync(f, 'utf8'); } catch { return; }
  const lines = t.split('\n').filter(Boolean);
  if (lines.length <= LOG_KEEP + 500) return;
  const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, `${lines.slice(-LOG_KEEP).join('\n')}\n`); renameSync(tmp, f);
}

/** Pure: filter + newest first + counts per gate. */
export function query(entries, { gate = '', build = '', since = '', limit = 200 } = {}) {
  const counts = Object.fromEntries(GATES.map((g) => [g, 0]));
  for (const e of entries) counts[e.gate] = (counts[e.gate] ?? 0) + 1;
  const rows = entries.filter((e) => (!gate || e.gate === gate) && (!build || e.build === build) && (!since || e.at > since)).reverse();
  return { $axf: SCHEMA_LOG, total: entries.length, counts, gates: GATES.map((g) => ({ id: g, label: GATE_LABEL[g], count: counts[g] })), shown: Math.min(rows.length, limit), matched: rows.length, entries: rows.slice(0, Math.max(0, limit)) };
}
export function readLog(opts = {}, env = process.env) {
  let t = ''; try { t = readFileSync(logFile(env), 'utf8'); } catch { /* none yet */ }
  const entries = t.split('\n').flatMap((l) => { if (!l.trim()) return []; try { return [normEntry(JSON.parse(l))]; } catch { return []; } });
  return query(entries, opts);
}

// ------------------------------------------------------------------ where the gate log's banner widget shows

/*
 * The Server gate log widget (a counter: gate hits in the last day, tap opens the log) shows in one place, kept here on
 * the server so the console, its REST / MCP command, this CLI and voice all switch the same one, live:
 *   own   its own banner strip across the top, only while there is something in it (default)
 *   bar   the app banner bar (a widget beside the clock and the other banner widgets)
 *   off   nowhere
 *   <id>  snapped into an existing banner (any banner id the console has: its banner.extras slot)
 */
export const BANNER_PLACES = Object.freeze(['own', 'bar', 'off']);
const PLACE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const bannerFile = (env) => join(gateDir(env), 'server-gate-banner.json');
export function bannerPlace(env = process.env) {
  const j = readJson(bannerFile(env));
  return { place: j && PLACE_RE.test(String(j.place)) ? j.place : 'own', by: str(j?.by, 120), at: str(j?.at, 40) };
}
export function setBannerPlace(place, { by = 'cli', env = process.env } = {}) {
  const p = String(place || '').trim();
  if (!PLACE_RE.test(p)) throw Object.assign(new Error(`place is own, bar, off or a banner id (got "${p}")`), { code: 2 });
  const rec = { $axf: 'server-gate-banner@1', place: p, by: str(by, 120), at: nowIso() };
  const f = bannerFile(env); mkdirSync(dirname(f), { recursive: true }); rewrite(f, rec);
  return rec;
}

// ------------------------------------------------------------------ AmberX FYI (the console's alerts API, from the host)

export function fyi({ title, body, build = '' }, env = process.env) {
  if (env.AXF_GATE_ALERTS === 'off') return false;
  const name = env.AXF_PIPELINE_CONSOLE || 'axf-console';
  if (name === 'off') return false;
  const alert = { source: 'server-gate', key: `server-gate:${build || 'vps'}:${Date.now()}`, severity: 'warning', title: str(title, 200), body: str(body, 1500), link: '/console/server-gate-log', meta: { kind: 'server-gate', build } };
  const cmd = `curl -s -m 20 -X POST -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" --data-binary @- "http://127.0.0.1:${env.AXF_CONSOLE_PORT || 7090}/api/alerts"`;
  try {
    const c = spawn('docker', ['exec', '-i', name, 'sh', '-c', cmd], { stdio: ['pipe', 'ignore', 'ignore'], detached: true });
    c.on('error', () => {}); c.stdin.on('error', () => {}); c.stdin.end(JSON.stringify(alert)); c.unref();
    return true;
  } catch { return false; }
}

// ------------------------------------------------------------------ CLI

async function resolveBuild({ build, name, brief }) {
  if (build) return build;
  if (!name && !brief) return '';
  try {
    const { findBuild } = await import('./model-gate.mjs');
    const { loadStore } = await import('./builds-store.mjs');
    return findBuild(loadStore(), { name, brief })?.id ?? '';
  } catch { return ''; }
}

async function main(argv) {
  const json = argv.includes('--json'); const dry = argv.includes('--dry');
  const args = argv.filter((a) => a !== '--json' && a !== '--dry');
  const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] ?? '' : ''; };
  const [cmd, first] = args;
  const out = (o, line) => console.log(json ? JSON.stringify(o, null, 1) : line);
  if (['acquire', 'hold', 'release'].includes(cmd)) {
    const briefFile = opt('brief');
    const brief = briefFile && existsSync(briefFile) ? readFileSync(briefFile, 'utf8').slice(0, 64 * 1024) : '';
    const build = await resolveBuild({ build: opt('build') || process.env.AXF_BUILD_ID || '', name: opt('name'), brief });
    const common = { build, worktree: opt('worktree') || process.cwd(), pid: Number(opt('pid')) || 0, session: opt('session'), by: opt('by') || process.env.AXF_SURFACE || 'launcher', owner: opt('owner') || (cmd === 'acquire' ? '' : process.env.AXF_GATE_OWNER || '') };
    const r = cmd === 'acquire' ? acquire(common) : cmd === 'hold' ? hold(common) : release(common);
    if (cmd === 'acquire') {
      // --sh: the line the launcher evals (the owner tag its later runs carry)
      if (args.includes('--sh')) console.log(r.ok ? `gate_owner=${r.build ? r.owner : ''} gate_build=${r.build}` : `gate_refused=1\n${r.why}`);
      else out(r, `${r.ok ? 'ok' : 'refused'}: ${r.why.replace(/^refused: /, '')}`);
      if (!r.ok) process.exitCode = 3;
    } else out(r, JSON.stringify(r));
    return;
  }
  if (cmd === 'status') { const s = status(); return out({ locks: s }, s.length ? s.map((l) => `${l.alive ? 'live' : 'stale'}  ${l.build}  ${l.session || `pid ${l.pid}`}  ${l.worktree}  since ${l.at}`).join('\n') : 'no locks'); }
  if (cmd === 'sessions') { const s = sessionsOf(first || ''); return out({ build: first, sessions: s }, s.map((x) => x.name).join('\n') || 'none'); }
  if (cmd === 'reap') { const r = reap({ dry, by: opt('by') || 'cli' }); return out(r, r.duplicates.length ? r.duplicates.map((d) => `${d.build}: keep ${d.keep}, ${dry ? 'would end' : 'ended'} ${d.end.join(', ')}`).join('\n') : 'no duplicate sessions'); }
  if (cmd === 'record') {
    const briefFile = opt('brief');
    const brief = briefFile && existsSync(briefFile) ? readFileSync(briefFile, 'utf8').slice(0, 64 * 1024) : '';
    const build = await resolveBuild({ build: opt('build'), name: opt('name'), brief }) || opt('name');
    const e = record({ gate: opt('gate'), build, by: opt('by') || process.env.AXF_SURFACE || 'cli', action: opt('action'), detail: opt('detail'), session: opt('session') });
    return out(e, `logged: ${e.gate} ${e.build}`);
  }
  if (cmd === 'banner') {
    try {
      const r = opt('place') ? setBannerPlace(opt('place'), { by: opt('by') || process.env.AXF_SURFACE || 'cli' }) : bannerPlace();
      return out(r, `Server gate log widget: ${r.place === 'own' ? 'its own banner' : r.place === 'bar' ? 'the app banner bar' : r.place === 'off' ? 'off' : `in the ${r.place} banner`}${r.by ? ` (set by ${r.by})` : ''}`);
    } catch (e) { console.error(e.message); process.exitCode = 2; return; }
  }
  if (cmd === 'log' || cmd === 'gates') {
    const q = readLog({ gate: opt('gate'), build: opt('build'), limit: Number(opt('limit')) || 50 });
    if (cmd === 'gates') return out({ total: q.total, gates: q.gates }, q.gates.map((g) => `${String(g.count).padStart(5)}  ${g.label}`).join('\n'));
    return out(q, [`Server gate log: ${q.total} hit${q.total === 1 ? '' : 's'}${opt('gate') ? ` (${GATE_LABEL[opt('gate')] || opt('gate')}: ${q.matched})` : ''}`, ...q.entries.map((e) => `${e.at.slice(0, 16).replace('T', ' ')}  ${GATE_LABEL[e.gate]}  ${e.build || '-'}  by ${e.by}: ${e.action}`)].join('\n'));
  }
  console.error('usage: server-gate.mjs acquire|hold|release|status|sessions <build>|reap [--dry]|log [--gate g] [--build id]|record --gate g --action a|gates|banner [--place p]  [--json]');
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));

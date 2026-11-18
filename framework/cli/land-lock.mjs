#!/usr/bin/env node
/**
 * land-lock.mjs — land-lock@1: one landing at a time on the VPS (Gizmo, Nov 18 2026: "Landing is strictly one at a
 * time: a global landing lock on the VPS. build_land, the auto-lander, the merge queue and any session landing all
 * take the lock; others wait. A build must not pull/merge main while another build is landing").
 *
 * Who takes it:
 *   - the merge queue (push-banner land/merge-queue.mjs) around a batch push to main and a stack PR merge;
 *   - the console's PR merge (push-banner server POST /merge, and its auto-merge) around the GitHub merge call;
 *   - every `git push` to refs/heads/main from a checkout of this repo (build_land, sessions, scripts): the shared
 *     pre-push hook runs `hook`, which takes the lock for the life of that `git push` process;
 *   - anything else: `run --who … -- <cmd>` holds it while the command runs.
 * Who waits for it: merge-main (push-banner land.mjs mergeMain, used by the auto-lander and the merge queue, and
 * `merge-main` below for sessions) waits while someone else holds it, then fetches main fresh and merges.
 *
 * Re-entrant: the holder's token goes into AXF_LAND_LOCK_TOKEN, so its own children (the git push under the merge
 * queue's lock, a merge-main inside a merge) pass straight through instead of waiting on themselves.
 * Fair: waiters line up first come, first served; each waiter beats while it polls, so one that died leaves the line.
 * Stale holders go by themselves: a holder on this host whose process is gone, or any holder past its ttl.
 *
 * Store: <agent-slots dir>/land-lock.json (shared by the host and the console container), changed under an atomic
 * mkdir mutex. Built-ins only (the pre-push hook and the console container run this file as is).
 *
 *   node framework/cli/land-lock.mjs status [--json]                         holder and the waiting line
 *   … acquire --who w [--kind k] [--build b] [--pr n] [--pid N] [--ttl sec] [--wait sec] [--json]   exit 0 held · 3 timed out
 *   … release <id>                                                         drop it (only that holder)
 *   … run --who w [--kind k] [--build b] [--pr n] [--wait sec] -- <cmd…>   hold it while <cmd> runs
 *   … wait-free [--wait sec]                                               block while someone else holds it (exit 3: timed out)
 *   … merge-main [--remote origin] [--base main] [--wait sec]              wait-free, fetch main fresh, merge it into HEAD
 *   … hook <remote> <url>                                                  git pre-push hook (stdin: the refs being pushed)
 *   … install-hook [--hooks <dir>] [--cli a,b]                             add the hook line to the shared pre-push hook
 *   … clear [--by who]                                                     drop the holder by hand (a stuck one)
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'land-lock@1';
export const TOKEN_ENV = 'AXF_LAND_LOCK_TOKEN';
export const DEFAULTS = Object.freeze({ ttlSec: 3600, waiterStaleSec: 120, pollMs: 2000, waitSec: 1800 });
const HISTORY_MAX = 30;
const KINDS = ['merge-queue', 'console', 'git-push', 'build-land', 'auto-lander', 'session', 'run'];

/* ---------------- pure core ---------------- */

export const emptyLock = () => ({ $axf: SCHEMA, holder: null, waiting: [], history: [] });
const str = (v, n = 120) => (typeof v === 'string' ? v.slice(0, n) : '');
const posInt = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : 0);

export function normLock(raw) {
  const s = { ...emptyLock(), ...(raw && typeof raw === 'object' ? raw : {}) };
  s.$axf = SCHEMA;
  s.holder = s.holder && typeof s.holder.id === 'string' ? s.holder : null;
  s.waiting = Array.isArray(s.waiting) ? s.waiting.filter((w) => w && typeof w.id === 'string') : [];
  s.history = Array.isArray(s.history) ? s.history.slice(-HISTORY_MAX) : [];
  return s;
}

/** A request: who wants it. */
export function request(o = {}, facts = {}) {
  const now = facts.now ?? Date.now();
  return {
    id: str(o.id, 60) || `ll-${now.toString(36)}-${randomBytes(3).toString('hex')}`,
    token: str(o.token, 80) || randomBytes(8).toString('hex'),
    who: str(o.who) || 'unknown', kind: KINDS.includes(o.kind) ? o.kind : 'run',
    ...(o.build ? { build: str(o.build, 80) } : {}), ...(posInt(o.pr) ? { pr: posInt(o.pr) } : {}),
    pid: posInt(o.pid), host: str(o.host, 80) || facts.host || '', ttlSec: posInt(o.ttlSec) || DEFAULTS.ttlSec,
  };
}

const isGone = (e, facts, staleMs) => {
  const now = facts.now ?? Date.now();
  const beat = Date.parse(e.beat || e.at || e.since || 0) || 0;
  if (e.host && e.host === facts.host && e.pid && facts.alive && !facts.alive(e.pid)) return 'process gone';
  if (now - beat > staleMs) return 'timed out';
  return '';
};

/** Drops a stale holder (its process gone on this host, or past its ttl) and waiters that stopped polling. */
export function prune(st, facts = {}) {
  const now = facts.now ?? Date.now();
  if (st.holder) {
    const why = isGone(st.holder, facts, (st.holder.ttlSec || DEFAULTS.ttlSec) * 1000);
    if (why) { st.history = [...st.history, endOf(st.holder, now, `released: ${why}`)].slice(-HISTORY_MAX); st.holder = null; }
  }
  st.waiting = st.waiting.filter((w) => !isGone(w, facts, DEFAULTS.waiterStaleSec * 1000));
  return st;
}
const endOf = (h, now, how) => ({ who: h.who, kind: h.kind, build: h.build, pr: h.pr, at: h.at, end: new Date(now).toISOString(), heldSec: Math.round((now - (Date.parse(h.at) || now)) / 1000), how });

/**
 * One try. Returns { ok, reentrant?, position (1-based place in line when waiting), holder }.
 * The lock goes to the first live waiter; a request already holding it (same token) passes again.
 */
export function tryAcquire(st, req, facts = {}) {
  const now = facts.now ?? Date.now(); const iso = new Date(now).toISOString();
  prune(st, facts);
  if (st.holder && st.holder.token === req.token) { st.holder.beat = iso; return { ok: true, reentrant: true, position: 0, holder: st.holder }; }
  let w = st.waiting.find((x) => x.id === req.id);
  if (!w) { w = { ...req, since: iso }; st.waiting.push(w); }
  w.beat = iso;
  const position = st.waiting.indexOf(w) + 1;
  if (st.holder || position !== 1) return { ok: false, position, holder: st.holder };
  st.waiting = st.waiting.filter((x) => x !== w);
  const { since, ...rest } = w;
  st.holder = { ...rest, at: iso, beat: iso, waitedSec: Math.round((now - (Date.parse(since) || now)) / 1000) };
  return { ok: true, position: 0, holder: st.holder };
}

/** Lets go (only the holder with that id or token). */
export function releaseLock(st, idOrToken, facts = {}) {
  const now = facts.now ?? Date.now();
  st.waiting = st.waiting.filter((w) => w.id !== idOrToken && w.token !== idOrToken);
  if (!st.holder || (st.holder.id !== idOrToken && st.holder.token !== idOrToken)) return false;
  st.history = [...st.history, endOf(st.holder, now, 'released')].slice(-HISTORY_MAX);
  st.holder = null;
  return true;
}

/** Is it free for this caller (nobody holds it, or the caller's own token does)? */
export const freeFor = (st, token = '') => !st.holder || (!!token && st.holder.token === token);

/** What the console, CLI, MCP and voice show: never the token. */
export function view(st, facts = {}) {
  const now = facts.now ?? Date.now();
  const pub = (e, since) => ({ id: e.id, who: e.who, kind: e.kind, ...(e.build ? { build: e.build } : {}), ...(e.pr ? { pr: e.pr } : {}), host: e.host, pid: e.pid, since, forSec: Math.max(0, Math.round((now - (Date.parse(since) || now)) / 1000)) });
  return {
    $axf: 'land-lock-status@1', free: !st.holder,
    holder: st.holder ? pub(st.holder, st.holder.at) : null,
    waiting: st.waiting.map((w, i) => ({ position: i + 1, ...pub(w, w.since) })),
    recent: st.history.slice(-10).reverse(),
  };
}

/** One line for people (CLI, voice, the pipeline status text). */
export function sayLock(v) {
  const name = (e) => `${e.who}${e.pr ? ` (#${e.pr})` : ''}`;
  const head = v.holder ? `landing lock held by ${name(v.holder)} for ${fmtSec(v.holder.forSec)}` : 'landing lock free';
  return `${head}${v.waiting.length ? ` · waiting: ${v.waiting.map((w) => name(w)).join(', ')}` : ' · nobody waiting'}`;
}
const fmtSec = (s) => (s < 90 ? `${s}s` : `${Math.round(s / 60)} min`);

/** The pushes in a pre-push hook's stdin that change main: "<local ref> <local sha> <remote ref> <remote sha>" lines. */
export function pushesMain(stdin, base = 'main') {
  return String(stdin || '').split('\n').map((l) => l.trim().split(/\s+/)).some((p) => p.length >= 4 && p[2] === `refs/heads/${base}`);
}

/* ---------------- store ---------------- */

/** The agent-slots store (same rule as agent-slots.mjs slotsDir()). */
export function slotsDir() {
  if (process.env.AXF_SLOTS_DIR) return process.env.AXF_SLOTS_DIR;
  if (existsSync('/projects/amberx-axf/_data')) return '/projects/amberx-axf/_data/agent-slots';
  return join(homedir(), '.axf', 'agent-slots');
}
const files = () => { const d = slotsDir(); return { dir: d, state: join(d, 'land-lock.json'), mutex: join(d, 'land-lock.mutex') }; };
const HOST = () => process.env.AXF_SLOTS_HOST || hostname();
const pidAlive = (pid) => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const hostFacts = () => ({ now: Date.now(), host: HOST(), alive: pidAlive });
export const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };

/** fn(state) under the mutex; the state is written back. */
export function withLock(fn) {
  const f = files(); mkdirSync(f.dir, { recursive: true });
  const until = Date.now() + 15_000;
  for (;;) {
    try { mkdirSync(f.mutex); break; } catch {
      try { if (Date.now() - statSync(f.mutex).mtimeMs > 15_000) { rmSync(f.mutex, { recursive: true, force: true }); continue; } } catch { continue; }
      if (Date.now() > until) throw new Error(`land-lock: ${f.mutex} is held; remove it if no land-lock command is running`);
      sleepSync(30);
    }
  }
  try {
    const st = normLock(readJson(f.state, null));
    const out = fn(st);
    const tmp = `${f.state}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(st, null, 1)}\n`); renameSync(tmp, f.state);
    return out;
  } finally { rmSync(f.mutex, { recursive: true, force: true }); }
}

export const status = () => withLock((st) => view(prune(st, hostFacts()), hostFacts()));

/**
 * Takes the lock, waiting up to waitSec. Returns { ok, id, token, reentrant, holder } (ok false: timed out, the line
 * left). On success the token goes into process.env so this process's children pass through.
 */
export function acquireSync(o = {}) {
  const facts0 = hostFacts();
  const inherited = process.env[TOKEN_ENV] || '';
  const req = request({ ...o, host: HOST(), pid: o.pid ?? process.pid, token: o.token || inherited }, facts0);
  const waitMs = (o.waitSec ?? DEFAULTS.waitSec) * 1000; const until = Date.now() + waitMs;
  let told = false; let last = null;
  for (;;) {
    last = withLock((st) => tryAcquire(st, req, hostFacts()));
    if (last.ok) { if (!last.reentrant) process.env[TOKEN_ENV] = req.token; return { ok: true, id: req.id, token: req.token, reentrant: !!last.reentrant, holder: last.holder }; }
    if (!told) { o.onWait?.(last); told = true; }
    if (Date.now() >= until) { withLock((st) => releaseLock(st, req.id)); return { ok: false, id: req.id, holder: last.holder, position: last.position }; }
    sleepSync(Math.min(o.pollMs ?? DEFAULTS.pollMs, Math.max(1, until - Date.now())));
  }
}

export function releaseSync(idOrToken) {
  const ok = withLock((st) => releaseLock(st, idOrToken, hostFacts()));
  if (process.env[TOKEN_ENV] && process.env[TOKEN_ENV] === idOrToken) delete process.env[TOKEN_ENV];
  return ok;
}

/** Runs fn while holding the lock (sync). A timeout returns { ok: false, holder } without running fn. */
export function withLandLockSync(o, fn) {
  const r = acquireSync(o);
  if (!r.ok) return { ok: false, holder: r.holder };
  try { return { ok: true, value: fn() }; } finally { if (!r.reentrant) { releaseSync(r.id); delete process.env[TOKEN_ENV]; } }
}

/** Runs fn while holding the lock (async: the wait polls without blocking the event loop). */
export async function withLandLock(o, fn) {
  const facts0 = hostFacts();
  const req = request({ ...o, host: HOST(), pid: o.pid ?? process.pid, token: process.env[TOKEN_ENV] || '' }, facts0);
  const until = Date.now() + (o.waitSec ?? DEFAULTS.waitSec) * 1000;
  let r; let told = false;
  for (;;) {
    r = withLock((st) => tryAcquire(st, req, hostFacts()));
    if (r.ok) break;
    if (!told) { o.onWait?.(r); told = true; }
    if (Date.now() >= until) { withLock((st) => releaseLock(st, req.id)); return { ok: false, holder: r.holder }; }
    await new Promise((res) => setTimeout(res, Math.min(o.pollMs ?? DEFAULTS.pollMs, Math.max(1, until - Date.now()))));
  }
  const prev = process.env[TOKEN_ENV];
  if (!r.reentrant) process.env[TOKEN_ENV] = req.token;
  try { return { ok: true, value: await fn() }; } finally {
    if (!r.reentrant) { releaseSync(req.id); if (prev) process.env[TOKEN_ENV] = prev; else delete process.env[TOKEN_ENV]; }
  }
}

/**
 * Blocks while someone else is landing (merge-main's rule: never merge main mid-landing). Returns { ok, holder,
 * waitedSec }; ok false = still held after waitSec.
 */
export function waitFreeSync(o = {}) {
  const t0 = Date.now(); const until = t0 + (o.waitSec ?? DEFAULTS.waitSec) * 1000;
  const token = process.env[TOKEN_ENV] || '';
  let told = false;
  for (;;) {
    let v;
    try { v = withLock((st) => { prune(st, hostFacts()); return { free: freeFor(st, token), holder: st.holder ? view(st).holder : null }; }); } catch { return { ok: true, holder: null, waitedSec: 0, unavailable: true }; }
    if (v.free) return { ok: true, holder: null, waitedSec: Math.round((Date.now() - t0) / 1000) };
    if (!told) { o.onWait?.(v.holder); told = true; }
    if (Date.now() >= until) return { ok: false, holder: v.holder, waitedSec: Math.round((Date.now() - t0) / 1000) };
    sleepSync(Math.min(o.pollMs ?? DEFAULTS.pollMs, Math.max(1, until - Date.now())));
  }
}

/* ---------------- the hook ---------------- */

export const HOOK_MARK = '# axf land lock (framework/cli/land-lock.mjs install-hook)';
/** The lines added to the shared pre-push hook: a push to main takes the landing lock for the life of the `git push`. */
export function hookLines(cli) {
  const paths = (Array.isArray(cli) ? cli : [cli]).map((c) => `"${c}"`).join(' ');
  return [
    HOOK_MARK,
    `case "$input" in *" refs/heads/main "*) ll=""; for f in ${paths}; do [ -f "$f" ] && { ll="$f"; break; }; done; if [ -n "$ll" ] && command -v node >/dev/null 2>&1; then printf '%s\\n' "$input" | node "$ll" hook --pid "$PPID" "$@" || exit 1; fi ;; esac`,
  ];
}

/** Adds (or refreshes) the land-lock lines right after `input=$(cat)` in the pre-push hook. */
export function patchHook(text, cli) {
  const kept = String(text || '').split('\n').filter((l, i, a) => l !== HOOK_MARK && !(a[i - 1] === HOOK_MARK));
  if (!kept.length || !kept[0].startsWith('#!')) kept.unshift('#!/bin/sh');
  let at = kept.findIndex((l) => l.trim() === 'input=$(cat)');
  if (at < 0) { kept.splice(1, 0, 'input=$(cat)'); at = 1; }
  kept.splice(at + 1, 0, ...hookLines(cli));
  return kept.join('\n').replace(/\n*$/, '\n');
}

/* ---------------- CLI ---------------- */

function flags(argv) {
  const out = { _: [], rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out.rest = argv.slice(i + 1); break; }
    if (a.startsWith('--')) { const k = a.slice(2); const nx = argv[i + 1]; if (nx === undefined || nx.startsWith('--')) out[k] = true; else { out[k] = nx; i++; } }
    else out._.push(a);
  }
  return out;
}
const meta = (f, kind) => ({ who: String(f.who || process.env.AXF_BUILD_ID || process.env.AXF_AGENT_NAME || 'session'), kind: f.kind || kind, build: f.build || process.env.AXF_BUILD_ID || '', pr: f.pr, ttlSec: f.ttl ? Number(f.ttl) : undefined, waitSec: f.wait !== undefined ? Number(f.wait) : undefined });
const say = (v) => console.log(sayLock(v));

export async function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv; const f = flags(rest);
  switch (cmd) {
    case 'status': case undefined: { const v = status(); return f.json ? console.log(JSON.stringify(v)) : say(v); }
    case 'acquire': {
      const r = acquireSync({ ...meta(f, 'run'), pid: f.pid ? Number(f.pid) : process.ppid, onWait: (w) => console.error(`land-lock: waiting (place ${w.position}) for ${w.holder?.who ?? 'the line'}`) });
      if (f.json) console.log(JSON.stringify({ ok: r.ok, id: r.id, token: r.ok ? r.token : undefined, holder: r.ok ? undefined : r.holder ?? null }));
      else console.log(r.ok ? `held ${r.id} token=${r.token}` : `timed out: ${r.holder ? `held by ${r.holder.who}` : 'still in line'}`);
      if (!r.ok) process.exitCode = 3; return;
    }
    case 'release': { const ok = releaseSync(String(f._[0] || '')); console.log(ok ? 'released' : 'not the holder'); if (!ok) process.exitCode = 4; return; }
    case 'clear': {
      const v = withLock((st) => { const h = st.holder; if (h) { st.history = [...st.history, endOf(h, Date.now(), `cleared by ${str(String(f.by || 'hand'), 40)}`)].slice(-HISTORY_MAX); st.holder = null; } return h; });
      return console.log(v ? `cleared ${v.who}` : 'nobody held it');
    }
    case 'run': {
      if (!f.rest.length) throw new Error('run: give the command after --');
      const r = acquireSync({ ...meta(f, 'run'), pid: process.pid, onWait: (w) => console.error(`land-lock: waiting for ${w.holder?.who ?? 'the line'}…`) });
      if (!r.ok) { console.error(`land-lock: timed out waiting for ${r.holder?.who ?? 'the line'}`); process.exitCode = 3; return; }
      try { const c = spawnSync(f.rest[0], f.rest.slice(1), { stdio: 'inherit', env: process.env }); process.exitCode = c.status ?? 1; } finally { if (!r.reentrant) releaseSync(r.id); }
      return;
    }
    case 'wait-free': {
      const r = waitFreeSync({ waitSec: f.wait !== undefined ? Number(f.wait) : undefined, onWait: (h) => console.error(`land-lock: ${h?.who ?? 'a build'} is landing; waiting…`) });
      console.log(r.ok ? `free (waited ${r.waitedSec}s)` : `still held by ${r.holder?.who}`); if (!r.ok) process.exitCode = 3; return;
    }
    case 'merge-main': {
      const remote = String(f.remote || 'origin'); const base = String(f.base || 'main');
      const r = waitFreeSync({ waitSec: f.wait !== undefined ? Number(f.wait) : undefined, onWait: (h) => console.error(`land-lock: ${h?.who ?? 'a build'} is landing; merge-main waits…`) });
      if (!r.ok) { console.error(`land-lock: still held by ${r.holder?.who}; main not merged`); process.exitCode = 3; return; }
      const fe = spawnSync('git', ['fetch', '-q', remote, base], { stdio: 'inherit' });
      if (fe.status) { process.exitCode = fe.status; return; }
      const m = spawnSync('git', ['merge', '--no-edit', `${remote}/${base}`], { stdio: 'inherit' });
      process.exitCode = m.status ?? 1; return;
    }
    case 'hook': {
      // stdin: the refs being pushed. Only a push to main takes the lock; it is held by the `git push` process (--pid).
      const input = readFileSync(0, 'utf8');
      if (!pushesMain(input)) return;
      const r = acquireSync({ who: `git push to main${process.env.AXF_BUILD_ID ? ` (${process.env.AXF_BUILD_ID})` : ''}`, kind: 'git-push', build: process.env.AXF_BUILD_ID || '', pid: Number(f.pid) || process.ppid, ttlSec: 900, waitSec: Number(process.env.AXF_LAND_LOCK_HOOK_WAIT || 900),
        onWait: (w) => console.error(`land-lock: ${w.holder?.who ?? 'another landing'} is landing; this push to main waits its turn (place ${w.position})…`) });
      if (!r.ok) { console.error(`land-lock: timed out behind ${r.holder?.who ?? 'the line'}; nothing pushed to main`); process.exitCode = 1; }
      return;
    }
    case 'install-hook': {
      const hooks = resolve(String(f.hooks || join(spawnSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).stdout.trim() || '.git', 'hooks')));
      // --cli a,b: the copies to try in order (the deployed checkout first, the host's installed copy after)
      const file = join(hooks, 'pre-push'); const cli = String(f.cli || fileURLToPath(import.meta.url)).split(',').map((c) => resolve(c));
      mkdirSync(hooks, { recursive: true });
      writeFileSync(file, patchHook(existsSync(file) ? readFileSync(file, 'utf8') : '', cli)); chmodSync(file, 0o755);
      return console.log(`land lock added to ${file}`);
    }
    default: throw new Error(`unknown command ${cmd} (status | acquire | release | run | wait-free | merge-main | hook | install-hook | clear)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`land-lock: ${e.message}`); process.exitCode = 2; });
}

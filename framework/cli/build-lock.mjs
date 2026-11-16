#!/usr/bin/env node
/**
 * build-lock — one live session per build (build-lock@1).
 *
 * Nov 13 2026: the dispatcher launched the same build phase twice on the same worktree three times in one day, so two
 * headless sessions wrote the same files at once, and the self-check released builds back to the Queue while their
 * session was still alive. This module answers one question for a build id and its worktree: is anything still alive?
 *
 *   - tmux: any session named axf-<id>, axf-<id>--<agent>, or either with the launcher's -HHMMSS duplicate suffix
 *   - pids: any claude process whose cwd is the worktree, or whose environment carries AXF_BUILD_ID=<id>
 *   - lock: <worktree>/.axf-build.lock, written by the dispatcher at launch and kept fresh by its tick (heartbeat);
 *     a lock whose heartbeat is older than LOCK_STALE_MS has expired and no longer counts
 *
 * The dispatcher (pipeline.mjs) refuses a launch while any of the three says alive, and the self-check never releases a
 * build whose session is alive. The launcher (deploy/claude-headless.sh) checks tmux and pids (not the lock, which the
 * dispatcher wrote for that very launch) before it opens a tmux session, instead of starting a renamed second one.
 * Parallel sub-builds each have their own build id, worktree and branch, so they never share a lock.
 *
 *   node framework/cli/build-lock.mjs check <build> [--dir <worktree>] [--no-lock] [--json]   exit 0 free · 3 live
 *   node framework/cli/build-lock.mjs acquire <build> --dir <worktree> [--session s] [--account a]   exit 0 · 3 live
 *   node framework/cli/build-lock.mjs beat <build> --dir <worktree> [--session s]
 *   node framework/cli/build-lock.mjs release <build> --dir <worktree>
 *
 * Tests: AXF_BUILD_LOCK_TMUX=off|<comma list of session names>, AXF_BUILD_LOCK_PIDS=off (no /proc scan).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'build-lock@1';
export const LOCK_FILE = '.axf-build.lock';
export const LOCK_STALE_MS = 20 * 60e3;
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nowIso = () => new Date().toISOString();

/** Does tmux session `name` belong to build `id`? axf-<id>, axf-<id>--<agent>, with or without the -HHMMSS suffix. */
export function sessionOf(id, name) {
  if (!ID_RE.test(id) || typeof name !== 'string') return false;
  return new RegExp(`^axf-${esc(id)}(--[A-Za-z0-9._:-]+?)?(-\\d{6})?$`).test(name);
}

function tmuxNames(env) {
  const v = env.AXF_BUILD_LOCK_TMUX;
  if (v === 'off') return [];
  if (v != null && v !== '') return v.split(',').map((s) => s.trim()).filter(Boolean);
  const r = spawnSync('tmux', ['ls', '-F', '#S'], { encoding: 'utf8', timeout: 10e3 });
  if (r.error || r.status !== 0) return [];
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** tmux sessions alive for build `id`. */
export function tmuxSessions(id, env = process.env) { return tmuxNames(env).filter((n) => sessionOf(id, n)); }

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
function ancestors() {
  const out = new Set([process.pid]); let pid = process.ppid;
  for (let i = 0; i < 32 && pid > 1; i += 1) {
    out.add(pid);
    try { pid = Number(/^PPid:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] || 0); } catch { break; }
  }
  return out;
}

/** claude processes alive for build `id`: cwd is the worktree, or AXF_BUILD_ID=<id> in their environment. */
export function claudePids(id, dir = '', env = process.env) {
  if (env.AXF_BUILD_LOCK_PIDS === 'off' || !existsSync('/proc')) return [];
  const want = dir ? real(dir) : ''; const mine = ancestors(); const out = [];
  let ents = []; try { ents = readdirSync('/proc'); } catch { return []; }
  for (const e of ents) {
    if (!/^\d+$/.test(e) || mine.has(Number(e))) continue;
    let argv = '';
    try { argv = readFileSync(`/proc/${e}/cmdline`, 'utf8'); } catch { continue; }
    const args = argv.split('\0').filter(Boolean);
    if (!args.some((a) => /(^|\/)claude$/.test(a) || /@anthropic-ai\/claude-code\//.test(a))) continue;
    let hit = false;
    if (want) { try { const cwd = realpathSync(`/proc/${e}/cwd`); hit = cwd === want || cwd.startsWith(`${want}/`); } catch { /* not ours to read */ } }
    if (!hit) { try { hit = readFileSync(`/proc/${e}/environ`, 'utf8').split('\0').includes(`AXF_BUILD_ID=${id}`); } catch { /* not ours to read */ } }
    if (hit) out.push(Number(e));
  }
  return out;
}

const lockPath = (dir) => join(dir, LOCK_FILE);
/** The lock on file for a worktree, or null. */
export function readLock(dir) {
  if (!dir) return null;
  try { const j = JSON.parse(readFileSync(lockPath(dir), 'utf8')); return j && j.$axf === SCHEMA ? j : null; } catch { return null; }
}
/** Fresh = its heartbeat is younger than LOCK_STALE_MS; a stale lock has expired. */
export function lockFresh(lock, now = Date.now(), staleMs = LOCK_STALE_MS) {
  if (!lock) return false;
  const t = Date.parse(lock.beat || lock.at || 0);
  return Number.isFinite(t) && now - t < staleMs;
}

/**
 * Is anything alive for this build? { live, build, dir, sessions, pids, lock, lockFresh, why }.
 * `useLock: false` judges by tmux and pids only (the launcher, whose own lock the dispatcher just wrote).
 */
export function liveness(id, { dir = '', useLock = true, env = process.env, now = Date.now() } = {}) {
  const sessions = tmuxSessions(id, env);
  const pids = claudePids(id, dir, env);
  const lock = useLock ? readLock(dir) : null;
  const fresh = useLock && lockFresh(lock, now) && (!lock.build || lock.build === id);
  const live = sessions.length > 0 || pids.length > 0 || fresh;
  const why = !live ? `${id}: no live session` : `${id} already has a live session: ${[
    sessions.length ? `tmux ${sessions.join(', ')}` : '',
    pids.length ? `claude pid ${pids.join(', ')}` : '',
    fresh ? `lock ${lock.session || 'launching'} (heartbeat ${lock.beat || lock.at})` : '',
  ].filter(Boolean).join('; ')}`;
  return { live, build: id, dir, sessions, pids, lock, lockFresh: fresh, why };
}

function writeLock(dir, lock) {
  const f = lockPath(dir); const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(lock)}\n`); renameSync(tmp, f);
  return lock;
}

/** Take the build's lock, or refuse (throws, code 'live') while anything is alive. A stale lock is replaced. */
export function acquire(id, { dir, session = '', account = '', by = 'dispatcher', env = process.env, now = Date.now() } = {}) {
  if (!ID_RE.test(id)) throw Object.assign(new Error(`bad build id ${id}`), { code: 'usage' });
  if (!dir) throw Object.assign(new Error('acquire needs the worktree --dir'), { code: 'usage' });
  const l = liveness(id, { dir, env, now });
  if (l.live) throw Object.assign(new Error(`refused: ${l.why}`), { code: 'live', liveness: l });
  const at = new Date(now).toISOString();
  return writeLock(dir, { $axf: SCHEMA, build: id, session, account, by, pid: process.pid, at, beat: at, expired: l.lock && !l.lockFresh ? l.lock.beat || l.lock.at || '' : '' });
}

/** Refresh the heartbeat (and the session name once known). Writes a lock when none is on file. */
export function beat(id, { dir, session = '', now = Date.now() } = {}) {
  if (!dir || !existsSync(dir)) return null;
  const prev = readLock(dir);
  const t = new Date(now).toISOString();
  return writeLock(dir, { $axf: SCHEMA, build: id, account: '', by: 'dispatcher', pid: process.pid, at: t, ...(prev?.build === id ? prev : {}), session: session || prev?.session || '', beat: t });
}

/** Drop the lock (the session ended, or the build was released after the liveness check said dead). */
export function release(id, { dir } = {}) {
  const lock = readLock(dir);
  if (!lock || (lock.build && lock.build !== id)) return false;
  try { rmSync(lockPath(dir), { force: true }); return true; } catch { return false; }
}

function arg(argv, flag) { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] || '' : ''; }
function main(argv) {
  const [cmd, id = ''] = argv; const dir = arg(argv, '--dir'); const json = argv.includes('--json');
  const say = (o, line, code = 0) => { console.log(json ? JSON.stringify(o) : line); return code; };
  if (!ID_RE.test(id)) { console.error('usage: build-lock.mjs check|acquire|beat|release <build> [--dir <worktree>] [--no-lock] [--json]'); return 2; }
  if (cmd === 'check') { const l = liveness(id, { dir, useLock: !argv.includes('--no-lock') }); return say(l, l.live ? `refused: ${l.why}` : l.why, l.live ? 3 : 0); }
  if (cmd === 'acquire') {
    try { const l = acquire(id, { dir, session: arg(argv, '--session'), account: arg(argv, '--account'), by: arg(argv, '--by') || 'cli' }); return say(l, `locked ${id} in ${dir}`); }
    catch (e) { if (e.code === 'live') return say(e.liveness, e.message, 3); console.error(e.message); return 2; }
  }
  if (cmd === 'beat') { const l = beat(id, { dir, session: arg(argv, '--session') }); return say(l, l ? `beat ${id} ${l.beat}` : `no worktree ${dir}`, l ? 0 : 2); }
  if (cmd === 'release') { const ok = release(id, { dir }); return say({ released: ok }, ok ? `released ${id}` : `no lock for ${id}`); }
  console.error('usage: build-lock.mjs check|acquire|beat|release <build> [--dir <worktree>] [--no-lock] [--json]'); return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));

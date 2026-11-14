#!/usr/bin/env node
/**
 * claude-token-save.mjs — a rotated Claude OAuth token is saved everywhere that login is kept, at once (build
 * refresh-token-save, Nov 6 2026, Brett: "the very first build is to make the refresh token update every time it's used.").
 *
 * Claude OAuth refresh tokens rotate: every renewal spends the old token and answers with a new one. Each headless build
 * runs on a private copy of its login (deploy/claude-login.mjs), so a renewal used to land only in that copy, which is
 * deleted when the build ends, leaving the saved login on a spent token.
 *
 * Who a token belongs to is decided by lineage, never by name or email: a store is rewritten only when it holds a token
 * this login has already spent. A store holding anything else is another account (or a newer token) and is left alone.
 *
 *   node deploy/claude-token-save.mjs watch --copy <login copy dir> [--parent <pid>] [--every <ms>]
 *        one build's copy: saves it back every few seconds until the copy is gone or <pid> exits (claude-headless.sh)
 *   node deploy/claude-token-save.mjs sweep
 *        the host's live login and the AI keys inbox, one pass (cron, every minute: axf-claude-token-save)
 *
 * Stores: the live login (~/.claude/.credentials.json), every ~/.claude-accounts/<name>/.credentials.json, and the AI
 * keys store through token-rotation@1 drop files in <ai-keys data>/rotations/ (it runs in the console container):
 *   to-console-<hash>.json  written here, only when a saved pair really holds the spent token; AI keys absorbs it
 *   to-host-<hash>.json     written by AI keys when it renews a pair; the sweep applies it here and deletes it
 *
 * Every store write runs under the host's one token lock (<accounts>/.token.lock, withTokenLock), so parallel builds
 * renewing the same account never clobber each other. Writes are atomic and 0600, keep every other field of the target (mcpOAuth…), and never print a credential.
 * token-chain.json in a copy holds sha256 prefixes only. Paths: AXF_CLAUDE_ACCOUNTS, AXF_CLAUDE_HOME, AXF_AI_KEYS_HOST_DIR.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHAIN = 'token-chain.json';
const CHAIN_MAX = 32;
const STATE = '.token-state.json';

export const tokenHash = (t) => (t ? createHash('sha256').update(String(t)).digest('hex').slice(0, 32) : '');
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const isFile = (f) => { try { return statSync(f).isFile(); } catch { return false; } };

function writeAtomic(file, doc) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

export const LOCK = '.token.lock';
const LOCK_STALE_MS = 30e3;
const LOCK_WAIT_MS = 20e3;
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Run `fn` holding the host's one token lock (<accounts>/.token.lock, a directory: mkdir is atomic). Every write of a
 * login store goes through it (save-back, the sweep, seeding a shared login), so parallel builds renewing the same
 * account never interleave a read-modify-write. A lock whose holder is gone, or older than 30 s, is taken over; after
 * 20 s of waiting the lock is taken over too (a stuck holder never blocks a build). No accounts folder = no lock.
 */
let lockDepth = 0;
export function withTokenLock(accountsDir, fn, { waitMs = LOCK_WAIT_MS } = {}) {
  if (!accountsDir || !existsSync(accountsDir) || lockDepth > 0) return fn();   // re-entrant within one process
  const dir = join(accountsDir, LOCK);
  const until = Date.now() + waitMs;
  let held = false;
  while (!held) {
    try { mkdirSync(dir, { mode: 0o700 }); held = true; break; } catch (e) { if (e.code !== 'EEXIST') return fn(); }
    let stale = false;
    try {
      const pid = Number(readFileSync(join(dir, 'pid'), 'utf8')) || 0;
      stale = (pid > 0 && pid !== process.pid && !alive(pid)) || Date.now() - statSync(dir).mtimeMs > LOCK_STALE_MS;
    } catch { stale = (() => { try { return Date.now() - statSync(dir).mtimeMs > 2000; } catch { return false; } })(); }
    if (stale || Date.now() > until) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* raced */ } continue; }
    nap(25 + Math.floor(Math.random() * 50));
  }
  try { writeFileSync(join(dir, 'pid'), String(process.pid)); } catch { /* the lock itself is what counts */ }
  lockDepth++;
  try { return fn(); } finally { lockDepth--; try { rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } }
}

/** Where this host keeps logins. */
export function places(env = process.env) {
  const home = env.HOME || homedir();
  return {
    live: join(env.AXF_CLAUDE_HOME || join(home, '.claude'), '.credentials.json'),
    accounts: env.AXF_CLAUDE_ACCOUNTS || join(home, '.claude-accounts'),
    aiKeys: env.AXF_AI_KEYS_HOST_DIR || '/opt/axf/.axf-console/plugins/ai-keys',  // axf-plugin:ai-keys
  };
}

function stores(p) {
  let names = []; try { names = readdirSync(p.accounts); } catch { /* no saved accounts */ }
  // the accounts' shared config dirs (claude-login.mjs shareHome) are stores too: a renewal made elsewhere reaches
  // the builds running there (Claude Code re-reads the file when it changes)
  let homes = []; try { homes = readdirSync(join(p.accounts, '.shared')); } catch { /* none yet */ }
  return [p.live, ...names.map((n) => join(p.accounts, n, '.credentials.json')), ...homes.map((n) => join(p.accounts, '.shared', n, '.credentials.json'))].filter(isFile);
}

/**
 * Where a build's login really lives: a build folder whose build-login@1 marker names a shared config dir
 * (claude-login.mjs) is saved back from that dir; an old-style private copy from itself.
 */
export function loginHome(copyDir) {
  const config = readJson(join(copyDir, 'build-login.json'))?.config;
  return typeof config === 'string' && config && existsSync(join(config, CHAIN)) ? config : copyDir;
}

/**
 * Write `fresh` (a claudeAiOauth object) into every store holding a spent token of this login, or the same refresh token
 * with an older access token. Returns the files written.
 */
export function applyRotation(fresh, spent, p) {
  if (!fresh?.accessToken || !fresh?.refreshToken) return [];
  const cur = tokenHash(fresh.refreshToken);
  const written = [];
  for (const f of stores(p)) {
    const doc = readJson(f); const o = doc?.claudeAiOauth; const h = tokenHash(o?.refreshToken);
    if (!h) continue;
    const stale = h === cur ? (o.expiresAt || 0) < (fresh.expiresAt || 0) : spent.has(h);
    if (!stale) continue;
    writeAtomic(f, { ...doc, claudeAiOauth: { ...o, ...fresh } });
    written.push(f);
  }
  return written;
}

/** Tell AI keys, only when one of its saved pairs really holds a spent token. */
function tellAiKeys(fresh, spent, p) {
  if (!p.aiKeys) return false;   // AI keys uninstalled
  const keys = readJson(join(p.aiKeys, 'keys.json'))?.keys;
  if (!keys || !spent.size) return false;
  const held = Object.values(keys).some((r) => r?.kind === 'claude-code' && spent.has(tokenHash(r.refresh)));
  if (!held) return false;
  const dir = join(p.aiKeys, 'rotations');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeAtomic(join(dir, `to-console-${tokenHash(fresh.refreshToken)}.json`), { $axf: 'token-rotation@1', old: [...spent], fresh, at: Date.now() });
  return true;
}

/** A new login copy starts its chain with the token it was copied from. */
export function beginChain(copyDir, p) {
  const o = readJson(join(copyDir, '.credentials.json'))?.claudeAiOauth;
  const h = tokenHash(o?.refreshToken);
  if (!h) return;
  writeFileSync(join(copyDir, CHAIN), JSON.stringify({ $axf: 'token-chain@1', places: p, chain: [h] }), { mode: 0o600 });
}

/**
 * Save one login copy back. Safe to run at any time and from several processes: the same state always gives the same
 * writes. The paths come from the chain file, because a build's own CLAUDE_CONFIG_DIR points at the copy itself.
 */
export function saveBack(dir) {
  const copyDir = loginHome(dir);
  const first = readJson(join(copyDir, CHAIN));
  if (first?.$axf !== 'token-chain@1') return [];
  return withTokenLock(first.places?.accounts, () => saveBackLocked(copyDir));
}

function saveBackLocked(copyDir) {
  const file = join(copyDir, CHAIN);
  const state = readJson(file);
  if (state?.$axf !== 'token-chain@1') return [];
  const fresh = readJson(join(copyDir, '.credentials.json'))?.claudeAiOauth;
  const cur = tokenHash(fresh?.refreshToken);
  if (!cur) return [];
  if (!state.chain.includes(cur)) {
    state.chain = [...state.chain, cur].slice(-CHAIN_MAX);
    writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
  }
  const spent = new Set(state.chain.filter((h) => h !== cur));
  const written = applyRotation(fresh, spent, state.places);
  tellAiKeys(fresh, spent, state.places);
  return written;
}


/** Save a copy back until it is released or the run that owns it exits (one last pass then). */
export async function watch(copyDir, { parent = 0, every = 3000 } = {}) {
  for (;;) {
    if (!existsSync(join(copyDir, CHAIN)) && !existsSync(join(copyDir, 'build-login.json'))) return;
    const going = parent > 0 && !alive(parent);
    try { saveBack(copyDir); } catch { /* the next pass tries again */ }
    if (going) return;
    await new Promise((ok) => setTimeout(ok, every));
  }
}

/** The same watcher for a node launcher. It ends when the copy is released. */
export function watchCopy(copyDir, parent = process.pid) {
  spawn(process.execPath, [fileURLToPath(import.meta.url), 'watch', '--copy', copyDir, '--parent', String(parent)], { detached: true, stdio: 'ignore' }).unref();
}

/** One pass on the host: AI keys' renewals come in, and the live login's own renewals go out to the saved copies. */
export function sweep(env = process.env) {
  const p = places(env);
  return withTokenLock(p.accounts, () => sweepLocked(p));
}

function sweepLocked(p) {
  const out = { fromAiKeys: 0, fromLive: 0 };
  const inbox = p.aiKeys ? join(p.aiKeys, 'rotations') : '';
  let files = []; try { files = readdirSync(inbox).filter((n) => /^to-host-[a-f0-9]+\.json$/.test(n)); } catch { /* no inbox */ }
  for (const n of files) {
    const d = readJson(join(inbox, n));
    if (d?.$axf === 'token-rotation@1') out.fromAiKeys += applyRotation(d.fresh, new Set(d.old || []), p).length;
    rmSync(join(inbox, n), { force: true });
  }
  const fresh = readJson(p.live)?.claudeAiOauth;
  const cur = tokenHash(fresh?.refreshToken);
  if (!cur) return out;   // logged out: the saved copies keep the last login
  const stateFile = join(p.accounts, STATE);
  const prev = readJson(stateFile)?.live || '';
  const spent = new Set(prev && prev !== cur ? [prev] : []);
  out.fromLive = applyRotation(fresh, spent, p).length;
  tellAiKeys(fresh, spent, p);
  if (prev !== cur && existsSync(p.accounts)) writeAtomic(stateFile, { live: cur, at: new Date().toISOString() });
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n, d = '') => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : d; };
  if (cmd === 'watch' && flag('copy')) {
    await watch(flag('copy'), { parent: Number(flag('parent', '0')) || 0, every: Number(flag('every', '3000')) || 3000 });
  } else if (cmd === 'hold-lock' && flag('accounts')) {   // tests: hold the token lock for --ms
    withTokenLock(flag('accounts'), () => { console.log('held'); nap(Number(flag('ms', '500')) || 500); });
  } else if (cmd === 'save-back' && flag('copy')) {   // tests: one save-back pass from its own process
    saveBack(flag('copy'));
  } else if (cmd === 'sweep') {
    const r = sweep();
    if (r.fromAiKeys || r.fromLive) console.log(`${new Date().toISOString()} saved rotated tokens: ${r.fromLive} from the live login, ${r.fromAiKeys} from AI keys`);
  } else {
    console.error('usage: claude-token-save.mjs watch --copy <dir> [--parent <pid>] [--every <ms>] | sweep');
    process.exit(2);
  }
}

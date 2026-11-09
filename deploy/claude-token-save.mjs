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
 * Writes are atomic and 0600, keep every other field of the target (mcpOAuth…), and never print a credential.
 * token-chain.json in a copy holds sha256 prefixes only. Paths: AXF_CLAUDE_ACCOUNTS, AXF_CLAUDE_HOME, AXF_AI_KEYS_HOST_DIR.
 *
 * One refresher per login (spent-refresh-token, Nov 9 2026). A refresh token is single-use, and Claude Code only keeps
 * processes that share ONE config dir from refreshing it twice (its own refresh lock + re-reading the file). Every build
 * runs in its own copy, so that protection is gone: two copies of one login refreshing near the same moment = one wins,
 * the other (and every store still on the old token) holds a spent token, and Anthropic may revoke the whole chain on
 * reuse. So the host does what Claude Code would do across its own processes:
 *   - every write to a store or a running copy happens under one host lock (<accounts>/.token-save.lock);
 *   - running copies are registered (<accounts>/.copies/), and every rotation, from anywhere, is written into each
 *     running copy still on a spent token, so all copies of a login always hold the newest pair;
 *   - the keeper renews a running copy's pair itself, under the lock, well before Claude Code would (KEEP_AHEAD), so
 *     only one refresh per login ever happens at a time and Claude Code re-reads a fresh pair instead of refreshing;
 *   - every rotation is recorded as spent → successor (<accounts>/.lineage.json, hashes only), so a store that missed
 *     some rotations still catches up, and a sweep saves back copies whose watcher died (crash, kill, reboot);
 *   - `freshen` checks a saved login before a launch: a refresh refused with invalid_grant marks it dead
 *     (<accounts>/.dead.json, hashes only) until it is signed in again, and launches skip it.
 *
 *   node deploy/claude-token-save.mjs freshen --file <credentials.json> [--min-left <ms>]
 *        renew that login now if its access token has less than <ms> left (default 90 min); prints {ok, refreshed, dead,
 *        why}; exit 0 alive, 5 dead (sign in again), 1 could not tell (network)
 * Refresh grant: AXF_CLAUDE_OAUTH_URL / AXF_CLAUDE_OAUTH_CLIENT_ID (as AI keys); AXF_TOKEN_REFRESHER = a module exporting
 * refresh(refreshToken) (tests). AXF_TOKEN_KEEP=off turns the keeper and launch check off.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, watch as fsWatch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHAIN = 'token-chain.json';
const CHAIN_MAX = 32;
const STATE = '.token-state.json';
const LOCK = '.token-save.lock';
const COPIES = '.copies';
const LINEAGE = '.lineage.json';
const LINEAGE_MAX = 512;
const DEAD = '.dead.json';
const MIN = 60_000;
/**
 * The keeper renews a running copy this long before its access token runs out: ahead of Claude Code (~5 min) and of
 * AI keys' own renewal thread (30 min), so the host is the one refresher and the others only ever see a fresh pair.
 */
export const KEEP_AHEAD = 60 * MIN;
/** A launch starts on a pair with at least this long left, so a short build never has to refresh at all. */
export const MIN_LEFT = 90 * MIN;
/** A copy without a known owner stops being kept after this long (a run's copy that was never released). */
const ORPHAN_AGE = 24 * 60 * MIN;
const OAUTH_URL = process.env.AXF_CLAUDE_OAUTH_URL || 'https://console.anthropic.com/v1/oauth/token';
const OAUTH_CLIENT_ID = process.env.AXF_CLAUDE_OAUTH_CLIENT_ID || '9d1c250a-e61b-44d9-88ed-5944d1962f5e';  // Claude Code's public client

export const tokenHash = (t) => (t ? createHash('sha256').update(String(t)).digest('hex').slice(0, 32) : '');
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const isFile = (f) => { try { return statSync(f).isFile(); } catch { return false; } };
const isDir = (f) => { try { return statSync(f).isDirectory(); } catch { return false; } };
const alive = (pid) => { if (!(pid > 0)) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const keepOn = (env = process.env) => String(env.AXF_TOKEN_KEEP || 'on') !== 'off';

function writeAtomic(file, doc) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
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

// ── the host lock: every read-decide-write of a store or a running copy happens under it ────────────────────────────
let held = 0;
/**
 * Run fn holding <accounts>/.token-save.lock. Re-entrant inside one process. A lock whose owner is gone, or older than
 * 60 s, is taken over. fn may be async (the keeper's refresh): the lock is held until it settles.
 */
export function withLock(p, fn, { wait = Number(process.env.AXF_TOKEN_LOCK_WAIT_MS) || 20_000 } = {}) {
  if (held > 0 || !p?.accounts) { held++; return settle(fn, () => { held--; }); }
  if (!isDir(p.accounts)) { try { mkdirSync(p.accounts, { recursive: true, mode: 0o700 }); } catch { held++; return settle(fn, () => { held--; }); } }
  const f = join(p.accounts, LOCK);
  const until = Date.now() + wait;
  for (;;) {
    try { const fd = openSync(f, 'wx', 0o600); writeFileSync(fd, `${process.pid} ${Date.now()}`); closeSync(fd); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const [pid, at] = String((() => { try { return readFileSync(f, 'utf8'); } catch { return ''; } })()).split(' ').map(Number);
      if ((pid && !alive(pid)) || (at && Date.now() - at > 60_000)) { rmSync(f, { force: true }); continue; }
      if (Date.now() > until) throw Object.assign(new Error('Claude login stores are locked'), { code: 'ELOCKED' });
      sleepSync(25);
    }
  }
  held++;
  return settle(fn, () => { held--; if (held === 0) rmSync(f, { force: true }); });
}
function settle(fn, done) {
  let r;
  try { r = fn(); } catch (e) { done(); throw e; }
  if (r && typeof r.then === 'function') return r.finally(done);
  done(); return r;
}

// ── lineage: which token followed which (hashes only) ────────────────────────────────────────────────────────────
function lineage(p) { const d = readJson(join(p.accounts, LINEAGE)); return d?.next && typeof d.next === 'object' ? d.next : {}; }
function recordLineage(p, spent, cur) {
  if (!cur || !p?.accounts || !isDir(p.accounts)) return;
  const next = lineage(p);
  let changed = false;
  for (const h of spent) if (h && h !== cur && next[h] !== cur && !follows(next, cur, h)) { delete next[h]; next[h] = cur; changed = true; }
  if (!changed) return;
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - LINEAGE_MAX))) delete next[k];
  writeAtomic(join(p.accounts, LINEAGE), { $axf: 'token-lineage@1', next });
}
/** true when `to` is reached from `from` by following spent → successor (from itself is a spent ancestor). */
function follows(next, from, to) {
  let h = from;
  for (let i = 0; i < 64 && next[h]; i++) { h = next[h]; if (h === to) return true; }
  return false;
}

// ── running copies ────────────────────────────────────────────────────────────────────────────────────────────────
const copyKey = (dir) => tokenHash(resolve(dir)).slice(0, 16);
/** Record a running copy so every rotation reaches it. pid = the run that owns it (0 = unknown). */
export function registerCopy(copyDir, p, pid = 0) {
  if (!p?.accounts) return;
  const d = join(p.accounts, COPIES);
  try { mkdirSync(d, { recursive: true, mode: 0o700 }); } catch { return; }
  const f = join(d, `${copyKey(copyDir)}.json`);
  const was = readJson(f);
  writeAtomic(f, { $axf: 'login-copy@1', copy: resolve(copyDir), pid: pid || was?.pid || 0, at: was?.at || new Date().toISOString() });
}
export function unregisterCopy(copyDir, p) { if (p?.accounts) rmSync(join(p.accounts, COPIES, `${copyKey(copyDir)}.json`), { force: true }); }
/** Registered copies that still exist: [{copy, pid, at, file}]. Gone ones are dropped. */
export function copies(p) {
  const d = join(p.accounts, COPIES);
  let names = []; try { names = readdirSync(d).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const n of names) {
    const r = readJson(join(d, n));
    if (!r?.copy || !isFile(join(r.copy, '.credentials.json'))) { rmSync(join(d, n), { force: true }); continue; }
    out.push({ ...r, file: join(d, n) });
  }
  return out;
}

function stores(p, { withCopies = true } = {}) {
  let names = []; try { names = readdirSync(p.accounts); } catch { /* no saved accounts */ }
  const own = [p.live, ...names.filter((n) => !n.startsWith('.')).map((n) => join(p.accounts, n, '.credentials.json'))].filter(isFile);
  return withCopies ? [...own, ...copies(p).map((c) => join(c.copy, '.credentials.json'))] : own;
}

/**
 * Write `fresh` (a claudeAiOauth object) into every store and running copy holding a spent token of this login, or the
 * same refresh token with an older access token. Returns the files written. Runs under the host lock.
 */
export function applyRotation(fresh, spent, p) {
  if (!fresh?.accessToken || !fresh?.refreshToken) return [];
  const cur = tokenHash(fresh.refreshToken);
  return withLock(p, () => {
    recordLineage(p, spent, cur);
    const next = lineage(p);
    const written = [];
    for (const f of [...new Set(stores(p))]) {
      const doc = readJson(f); const o = doc?.claudeAiOauth; const h = tokenHash(o?.refreshToken);
      if (!h) continue;
      const stale = h === cur ? (o.expiresAt || 0) < (fresh.expiresAt || 0) : spent.has(h) || follows(next, h, cur);
      if (!stale) continue;
      writeAtomic(f, { ...doc, claudeAiOauth: { ...o, ...fresh } });
      learn(join(resolve(f, '..'), CHAIN), cur);   // a running copy: its chain knows the token it now holds
      written.push(f);
    }
    return written;
  });
}

/** Add a token hash to a copy's chain file (no chain file = not a copy: nothing to do). */
function learn(chainFile, h) {
  const st = readJson(chainFile);
  if (st?.$axf !== 'token-chain@1' || !h || st.chain.includes(h)) return;
  st.chain = [...st.chain, h].slice(-CHAIN_MAX);
  writeFileSync(chainFile, JSON.stringify(st), { mode: 0o600 });
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

/** A new login copy starts its chain with the token it was copied from, and is registered as running. */
export function beginChain(copyDir, p, { pid = 0 } = {}) {
  const o = readJson(join(copyDir, '.credentials.json'))?.claudeAiOauth;
  const h = tokenHash(o?.refreshToken);
  if (!h) return;
  writeFileSync(join(copyDir, CHAIN), JSON.stringify({ $axf: 'token-chain@1', places: p, chain: [h] }), { mode: 0o600 });
  registerCopy(copyDir, p, pid);
}

/**
 * Save one login copy back. Safe to run at any time and from several processes: the same state always gives the same
 * writes. The paths come from the chain file, because a build's own CLAUDE_CONFIG_DIR points at the copy itself.
 */
export function saveBack(copyDir) {
  const file = join(copyDir, CHAIN);
  const state = readJson(file);
  if (state?.$axf !== 'token-chain@1') return [];
  return withLock(state.places, () => {
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
  });
}

// ── dead logins ──────────────────────────────────────────────────────────────────────────────────────────────────
/** {hash: {at, why}}: refresh tokens Anthropic refused. A login is dead while its store still holds one of them. */
export const deadSet = (p) => readJson(join(p.accounts, DEAD))?.dead || {};
export function isDead(credsFile, p) { const h = tokenHash(readJson(credsFile)?.claudeAiOauth?.refreshToken); return !!h && !!deadSet(p)[h]; }
function markDead(p, h, why) {
  if (!h || !isDir(p.accounts)) return;
  const dead = deadSet(p);
  dead[h] = { at: new Date().toISOString(), why: String(why || '').slice(0, 200) };
  const keys = Object.keys(dead); for (const k of keys.slice(0, Math.max(0, keys.length - 64))) delete dead[k];
  writeAtomic(join(p.accounts, DEAD), { $axf: 'token-dead@1', dead });
}

// ── the refresh grant ────────────────────────────────────────────────────────────────────────────────────────────
/** refresh token → {accessToken, refreshToken, expiresAt, scopes?}. Throws {dead: true} when Anthropic refuses the token. */
async function defaultRefresh(refreshToken) {
  const r = await fetch(OAUTH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: OAUTH_CLIENT_ID }), signal: AbortSignal.timeout(20_000) });
  let d = {}; try { d = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) {
    const err = typeof d?.error === 'string' ? d.error : d?.error?.type || '';
    const why = `refresh refused (${r.status}${err ? `: ${err}` : ''})`;
    throw Object.assign(new Error(why), { dead: err === 'invalid_grant' || (r.status === 400 && /invalid_grant/.test(JSON.stringify(d))) });
  }
  if (!String(d.access_token || '').startsWith('sk-ant-oat')) throw new Error('the refresh answer had no access token');
  const scopes = typeof d.scope === 'string' ? d.scope.split(' ').filter(Boolean) : undefined;
  return { accessToken: d.access_token, refreshToken: d.refresh_token || refreshToken, expiresAt: Date.now() + (Number(d.expires_in) || 28800) * 1000, ...(scopes ? { scopes } : {}) };
}
async function refresher(env = process.env) {
  if (!env.AXF_TOKEN_REFRESHER) return defaultRefresh;
  const m = await import(pathToFileURL(resolve(env.AXF_TOKEN_REFRESHER)).href);
  return m.refresh || m.default;
}

/**
 * Make sure the login in `file` (a saved store, the live login or a running copy) has at least `minLeft` ms on its
 * access token: renew it once, under the host lock, and write the new pair to every store and running copy of that
 * login. Returns { ok, refreshed, dead, why }. Never prints a credential.
 */
export async function freshen(file, { minLeft = MIN_LEFT, env = process.env, p = null, now = () => Date.now() } = {}) {
  const pl = p || places(env);
  const before = readJson(file)?.claudeAiOauth;
  if (!before?.refreshToken) return { ok: false, refreshed: false, dead: false, why: 'no refresh token in this login' };
  if (deadSet(pl)[tokenHash(before.refreshToken)]) return { ok: false, refreshed: false, dead: true, why: 'this login was refused before: sign in again' };
  if ((before.expiresAt || 0) - now() > minLeft) return { ok: true, refreshed: false, dead: false, why: '' };
  const refresh = await refresher(env);
  return withLock(pl, async () => {
    // AI keys may have renewed this login a moment ago (its drop file is not swept yet): take that in first, then
    // re-read under the lock: another holder may have renewed it and written it here
    try { absorbAiKeys(pl); } catch { /* the sweep does it */ }
    const doc = readJson(file); const o = doc?.claudeAiOauth;
    const h = tokenHash(o?.refreshToken);
    if (!h) return { ok: false, refreshed: false, dead: false, why: 'no refresh token in this login' };
    if ((o.expiresAt || 0) - now() > minLeft) return { ok: true, refreshed: false, dead: false, why: '' };
    let got;
    try { got = await refresh(o.refreshToken); } catch (e) {
      const why = String(e?.message || e).slice(0, 200);
      if (!e?.dead) return { ok: false, refreshed: false, dead: false, why };
      // Refused: dead, unless somebody else renewed it meanwhile (AI keys' drop arrived, or a rotation is on record)
      try { absorbAiKeys(pl); } catch { /* checked below anyway */ }
      if (tokenHash(readJson(file)?.claudeAiOauth?.refreshToken) !== h || lineage(pl)[h]) return { ok: false, refreshed: false, dead: false, why: `${why}; renewed elsewhere meanwhile` };
      markDead(pl, h, why);
      return { ok: false, refreshed: false, dead: true, why };
    }
    const fresh = { ...o, ...got };
    // this file first: if anything below fails, the one place that asked still holds the live token
    writeAtomic(file, { ...doc, claudeAiOauth: fresh });
    const spent = new Set([h]);
    applyRotation(fresh, spent, pl);
    tellAiKeys(fresh, spent, pl);
    learn(join(resolve(file, '..'), CHAIN), tokenHash(fresh.refreshToken));   // a running copy: its chain learns it too
    return { ok: true, refreshed: true, dead: false, why: '' };
  });
}

/** Should the keeper renew this copy now? Only while its run is alive (or, owner unknown, for a day). */
function keeping(copyDir, parent, now = Date.now()) {
  if (parent > 0) return alive(parent);
  const at = Date.parse(readJson(join(copyDir, 'build-login.json'))?.at || '') || (() => { try { return statSync(join(copyDir, CHAIN)).ctimeMs; } catch { return 0; } })();
  return !!at && now - at < ORPHAN_AGE;
}

/**
 * Save a copy back until it is released or the run that owns it exits (one last pass then). A change to the copy's
 * credentials is saved at once (fs.watch), not only on the next pass. The keeper renews the copy's pair ahead of
 * Claude Code, so a copy never has to refresh on its own.
 */
export async function watch(copyDir, { parent = 0, every = 3000, env = process.env } = {}) {
  const state = readJson(join(copyDir, CHAIN));
  if (state?.places) try { registerCopy(copyDir, state.places, parent); } catch { /* the sweep still finds the copy */ }
  let w = null;
  try { w = fsWatch(copyDir, { persistent: false }, (_, name) => { if (name === '.credentials.json') { try { saveBack(copyDir); } catch { /* next pass */ } } }); } catch { /* polling only */ }
  let retryAt = 0;
  try {
    for (;;) {
      if (!existsSync(join(copyDir, CHAIN))) return;
      const going = parent > 0 && !alive(parent);
      try { saveBack(copyDir); } catch { /* the next pass tries again */ }
      if (going) return;
      if (keepOn(env) && Date.now() >= retryAt && keeping(copyDir, parent)) {
        const ahead = Number(env.AXF_TOKEN_KEEP_AHEAD_MS) || KEEP_AHEAD;
        try {
          const r = await freshen(join(copyDir, '.credentials.json'), { minLeft: ahead, env, p: state?.places || null });
          if (!r.ok) retryAt = Date.now() + (r.dead ? 60 * MIN : MIN);
        } catch { retryAt = Date.now() + MIN; }
      }
      await new Promise((ok) => setTimeout(ok, every));
    }
  } finally { try { w?.close(); } catch { /* closed */ } }
}

/** The same watcher for a node launcher. It ends when the copy is released (or `parent` exits). */
export function watchCopy(copyDir, parent = process.pid) {
  spawn(process.execPath, [fileURLToPath(import.meta.url), 'watch', '--copy', copyDir, '--parent', String(parent)], { detached: true, stdio: 'ignore' }).unref();
}

/** AI keys' renewals (to-host drop files) come in. Returns the number of files written. */
function absorbAiKeys(p) {
  let n = 0;
  const inbox = p.aiKeys ? join(p.aiKeys, 'rotations') : '';
  let files = []; try { files = readdirSync(inbox).filter((f) => /^to-host-[a-f0-9]+\.json$/.test(f)); } catch { return 0; }
  for (const f of files) {
    const d = readJson(join(inbox, f));
    if (d?.$axf === 'token-rotation@1') n += applyRotation(d.fresh, new Set(d.old || []), p).length;
    rmSync(join(inbox, f), { force: true });
  }
  return n;
}

/** The live login's own renewals go out to the saved copies and running copies (also run before every snapshot). */
export function syncLive(p) {
  return withLock(p, () => {
    const fresh = readJson(p.live)?.claudeAiOauth;
    const cur = tokenHash(fresh?.refreshToken);
    if (!cur) return 0;   // logged out: the saved copies keep the last login
    const stateFile = join(p.accounts, STATE);
    const prev = readJson(stateFile)?.live || '';
    const spent = new Set(prev && prev !== cur ? [prev] : []);
    const n = applyRotation(fresh, spent, p).length;
    tellAiKeys(fresh, spent, p);
    if (prev !== cur && existsSync(p.accounts)) writeAtomic(stateFile, { live: cur, at: new Date().toISOString() });
    return n;
  });
}

/**
 * One pass on the host: AI keys' renewals come in, the live login's own renewals go out, and every registered copy is
 * saved back (its watcher may have died with a crash, a kill or a reboot).
 */
export function sweep(env = process.env) {
  const p = places(env);
  const out = { fromAiKeys: 0, fromLive: 0, fromCopies: 0 };
  out.fromAiKeys = withLock(p, () => absorbAiKeys(p));
  for (const c of copies(p)) { try { out.fromCopies += saveBack(c.copy).length; } catch { /* next minute */ } }
  out.fromLive = syncLive(p);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n, d = '') => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : d; };
  if (cmd === 'watch' && flag('copy')) {
    await watch(flag('copy'), { parent: Number(flag('parent', '0')) || 0, every: Number(flag('every', '3000')) || 3000 });
  } else if (cmd === 'sweep') {
    const r = sweep();
    if (r.fromAiKeys || r.fromLive || r.fromCopies) console.log(`${new Date().toISOString()} saved rotated tokens: ${r.fromLive} from the live login, ${r.fromAiKeys} from AI keys, ${r.fromCopies} from build copies`);
  } else if (cmd === 'freshen' && flag('file')) {
    const r = await freshen(resolve(flag('file')), { minLeft: Number(flag('min-left', '')) || Number(process.env.AXF_TOKEN_MIN_LEFT_MS) || MIN_LEFT });
    console.log(JSON.stringify(r));
    process.exit(r.ok ? 0 : r.dead ? 5 : 1);
  } else {
    console.error('usage: claude-token-save.mjs watch --copy <dir> [--parent <pid>] [--every <ms>] | sweep | freshen --file <credentials.json> [--min-left <ms>]');
    process.exit(2);
  }
}

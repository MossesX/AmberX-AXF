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
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncLive, syncMirror } from './claude-home.mjs';

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
  return [p.live, ...names.map((n) => join(p.accounts, n, '.credentials.json'))].filter(isFile);
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
export function saveBack(copyDir) {
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
  // One home per login (account-failover-notify): the copy against its account's home, both ways. A newer token goes
  // home; a home that moved on (another build or the console renewed it) is pulled into the copy, which the running
  // Claude reloads, so it never renews with a spent token.
  const account = readJson(join(copyDir, 'build-login.json'))?.account;
  let home = '';
  if (account && account !== 'live') {
    try { home = syncMirror(join(copyDir, '.credentials.json'), account, { chain: [...spent], by: `build ${readJson(join(copyDir, 'build-login.json'))?.session || ''}`.trim() }, envFor(state.places)); } catch { /* the next pass */ }
    if (home === 'pulled') {
      const now = tokenHash(readJson(join(copyDir, '.credentials.json'))?.claudeAiOauth?.refreshToken);
      if (now && !state.chain.includes(now)) { state.chain = [...state.chain, now].slice(-CHAIN_MAX); writeFileSync(file, JSON.stringify(state), { mode: 0o600 }); }
      return [];
    }
  }
  const written = applyRotation(fresh, spent, state.places);
  if (home === 'saved') written.unshift(join(state.places.accounts, account, '.credentials.json'));
  tellAiKeys(fresh, spent, state.places);
  return written;
}

/** The environment claude-home.mjs needs for a copy's stores (its chain names them; HOME stays as it is). */
const envFor = (pl) => ({ ...process.env, AXF_CLAUDE_ACCOUNTS: pl.accounts, AXF_CLAUDE_HOME: dirname(pl.live) });

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Save a copy back until it is released or the run that owns it exits (one last pass then). */
export async function watch(copyDir, { parent = 0, every = 3000 } = {}) {
  for (;;) {
    if (!existsSync(join(copyDir, CHAIN))) return;
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
  const prevState = readJson(stateFile) ?? {};
  const prev = prevState.live || '';
  const spent = new Set(prev && prev !== cur ? [prev] : []);
  // One home per login: the live login against the home of the login it is, both ways (a build that renewed the
  // console's account is pulled into the live login before the console's session renews with a spent token).
  const r = syncLive(prevState, { ...env, AXF_CLAUDE_ACCOUNTS: p.accounts, AXF_CLAUDE_HOME: dirname(p.live) });
  out.fromLive = r.result === 'saved' || r.result === 'pulled' ? 1 : 0;
  out.live = r.result; out.owner = r.owner || '';
  tellAiKeys(fresh, spent, p);
  if ((prev !== r.state.live || prevState.email !== r.state.email) && existsSync(p.accounts)) writeAtomic(stateFile, r.state);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n, d = '') => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : d; };
  if (cmd === 'watch' && flag('copy')) {
    await watch(flag('copy'), { parent: Number(flag('parent', '0')) || 0, every: Number(flag('every', '3000')) || 3000 });
  } else if (cmd === 'sweep') {
    const r = sweep();
    if (r.fromAiKeys || r.fromLive) console.log(`${new Date().toISOString()} ${r.live === 'pulled' ? 'pulled the newer home token into the live login' : 'saved rotated tokens'}: ${r.fromLive} from the live login${r.owner ? ` (${r.owner})` : ''}, ${r.fromAiKeys} from AI keys`);
    // account-failover-notify: accounts that are back (time passed, or signed in again) leave the limits and their phone
    // alert is resolved; alerts the console could not take yet are sent
    // (child processes: claude-workers imports claude-login, which imports this file)
    const here = dirname(fileURLToPath(import.meta.url));
    const rv = spawnSync(process.execPath, [join(here, 'claude-workers.mjs'), 'revive'], { encoding: 'utf8', timeout: 30_000 });
    if (/^back: /.test(rv.stdout || '')) console.log(`${new Date().toISOString()} Claude accounts ${rv.stdout.trim()}`);
    spawnSync(process.execPath, [join(here, 'account-alerts.mjs'), 'flush'], { encoding: 'utf8', timeout: 60_000 });
  } else {
    console.error('usage: claude-token-save.mjs watch --copy <dir> [--parent <pid>] [--every <ms>] | sweep');
    process.exit(2);
  }
}

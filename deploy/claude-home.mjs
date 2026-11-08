#!/usr/bin/env node
/**
 * claude-home.mjs — one home per Claude login (build account-failover-notify, Nov 8 2026, Brett: "each account's
 * credentials live in exactly ONE store; every token refresh from any build, console or session writes back to that
 * same place. No duplicate copies that can spend a refresh token and leave others dead.").
 *
 * Why (account-1, Nov 6-8 2026): account-1 was signed in on Nov 6 02:20 and saved to ~/.claude-accounts/account-1.
 * Until Nov 7 ~12:00 it was the active account, so every build ran on a copy of the *live* login (~/.claude) and every
 * renewal rotated the token there, never in the saved folder. Then another account was signed in over the live login:
 * account-1's newest token went with it, and its saved folder still held the Nov 6 token, spent hours earlier. On
 * Nov 8 every build routed to account-1 died in a second ("OAuth session expired and could not be refreshed").
 *
 * The rule now: ~/.claude-accounts/<name>/.credentials.json is the login's only home. The live login and every build's
 * copy are mirrors. Claude Code refuses a symlinked credentials file (it opens it O_NOFOLLOW) but reloads the file when
 * its mtime changes, so mirrors are kept in step both ways, by lineage:
 *   - a mirror holding a token this login has not had yet, rotated from one it had, is newer: it goes home at once;
 *   - a mirror holding a token the home has already moved past is older: the home's token is written into it, so a
 *     running build or the console's session never refreshes with a spent token;
 *   - anything else (no lineage in common) is another login and is never written either way.
 *
 * Next to the credentials sits .home.json (login-home@1, hashes and times only, never a credential):
 *   { $axf, name, lineage: [sha256 prefixes, oldest first], current, expiresAt, lastRefreshAt, lastRefreshBy, updatedAt }
 *
 *   node deploy/claude-home.mjs status [--json]          every login: current token hash, expiry, last refresh, by whom
 *   node deploy/claude-home.mjs audit [--json]           every place a login is kept on this host and whether it is in step
 *   node deploy/claude-home.mjs sync-live                the live login against its home, both ways (the minute sweep runs it)
 *
 * Paths: AXF_CLAUDE_ACCOUNTS (default ~/.claude-accounts), AXF_CLAUDE_HOME (the live config dir, default ~/.claude),
 * AXF_CLAUDE_GLOBAL (the live ~/.claude.json, for the signed-in email), AXF_CLAUDE_BUILDS (folders holding build copies,
 * comma list, default /root/axf-builds,/opt for the audit).
 */
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'login-home@1';
export const META = '.home.json';
const LINEAGE_MAX = 64;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const tokenHash = (t) => (t ? createHash('sha256').update(String(t)).digest('hex').slice(0, 32) : '');
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const isFile = (f) => { try { return statSync(f).isFile(); } catch { return false; } };

export function homePaths(env = process.env) {
  const home = env.HOME || homedir();
  const liveDir = env.AXF_CLAUDE_HOME || env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  return {
    accounts: env.AXF_CLAUDE_ACCOUNTS || join(home, '.claude-accounts'),
    live: join(liveDir, '.credentials.json'),
    global: env.AXF_CLAUDE_GLOBAL || (env.AXF_CLAUDE_HOME || env.CLAUDE_CONFIG_DIR ? join(liveDir, '.claude.json') : join(home, '.claude.json')),
    builds: (env.AXF_CLAUDE_BUILDS || '/root/axf-builds,/opt').split(',').filter(Boolean),
  };
}

function writeAtomic(file, doc) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

/** One writer per login at a time (a few ms; stale after 10 s). */
function withLock(dir, fn) {
  const f = join(dir, '.home.lock');
  const until = Date.now() + 10_000;
  for (;;) {
    try { closeSync(openSync(f, 'wx', 0o600)); break; } catch {
      try { if (Date.now() - statSync(f).mtimeMs > 10_000) { rmSync(f, { force: true }); continue; } } catch { continue; }
      if (Date.now() > until) throw new Error(`login home ${dir} is locked`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try { return fn(); } finally { rmSync(f, { force: true }); }
}

const credsFile = (p, name) => join(p.accounts, name, '.credentials.json');
const oauthOf = (f) => readJson(f)?.claudeAiOauth ?? null;

/** Saved logins that have a home with an OAuth pair. */
export function homes(env = process.env) {
  const p = homePaths(env);
  let names = []; try { names = readdirSync(p.accounts).filter((n) => NAME_RE.test(n)).sort(); } catch { /* none */ }
  return names.filter((n) => tokenHash(oauthOf(credsFile(p, n))?.refreshToken));
}

/** The home record, made from the credentials the first time it is read. */
export function meta(name, env = process.env) {
  const p = homePaths(env);
  const m = readJson(join(p.accounts, name, META));
  const o = oauthOf(credsFile(p, name));
  const cur = tokenHash(o?.refreshToken);
  const base = m?.$axf === SCHEMA ? m : { $axf: SCHEMA, name, lineage: [], current: '', expiresAt: 0, lastRefreshAt: '', lastRefreshBy: '', updatedAt: '' };
  if (cur && !base.lineage.includes(cur)) base.lineage = [...base.lineage, cur].slice(-LINEAGE_MAX);
  base.current = cur;
  base.expiresAt = Number(o?.expiresAt) || 0;
  return base;
}

/** Which saved login a token belongs to ('' = none). */
export function ownerOf(hash, env = process.env) {
  if (!hash) return '';
  for (const n of homes(env)) if (meta(n, env).lineage.includes(hash)) return n;
  return '';
}

/**
 * Bring a mirror's OAuth pair home. `chain` = token hashes the mirror held before (its own lineage). Returns one of
 *   'same'    nothing to do
 *   'saved'   the mirror was newer: the home has it now
 *   'older'   the home is newer than the mirror (the caller may pull it)
 *   'foreign' no lineage in common: another login, left alone
 */
export function adopt(name, fresh, { chain = [], by = '', now = Date.now() } = {}, env = process.env) {
  if (!NAME_RE.test(name || '')) return 'foreign';
  const p = homePaths(env);
  const dir = join(p.accounts, name);
  if (!fresh?.accessToken || !fresh?.refreshToken || !existsSync(dir)) return 'foreign';
  return withLock(dir, () => {
    const file = credsFile(p, name);
    const doc = readJson(file) ?? {};
    const home = doc.claudeAiOauth;
    const m = meta(name, env);
    const h = tokenHash(fresh.refreshToken); const hh = tokenHash(home?.refreshToken);
    let take = false;
    if (!hh) take = !m.lineage.length || chain.some((c) => m.lineage.includes(c));
    else if (h === hh) {
      const a = Number(fresh.expiresAt) || 0; const b = Number(home.expiresAt) || 0;
      if (a > b) take = true;
      else return a < b ? 'older' : 'same';
    } else if (m.lineage.includes(h)) return 'older';
    else if (chain.includes(hh) || chain.some((c) => m.lineage.includes(c))) take = true;
    if (!take) return 'foreign';
    writeAtomic(file, { ...doc, claudeAiOauth: { ...(home ?? {}), ...fresh } });
    const at = new Date(now).toISOString();
    writeAtomic(join(dir, META), { ...m, lineage: [...m.lineage.filter((x) => x !== h), h].slice(-LINEAGE_MAX), current: h,
      expiresAt: Number(fresh.expiresAt) || 0, lastRefreshAt: at, lastRefreshBy: String(by || '').slice(0, 80), updatedAt: at });
    return 'saved';
  });
}

/** Write the home's pair into a mirror file, keeping its other fields (mcpOAuth…). */
function pullInto(file, name, env) {
  const home = oauthOf(credsFile(homePaths(env), name));
  if (!home?.refreshToken) return false;
  const doc = readJson(file) ?? {};
  writeAtomic(file, { ...doc, claudeAiOauth: { ...(doc.claudeAiOauth ?? {}), ...home } });
  return true;
}

/** A mirror against its home, both ways. Returns 'same' | 'saved' | 'pulled' | 'foreign'. */
export function syncMirror(file, name, { chain = [], by = '' } = {}, env = process.env) {
  const fresh = oauthOf(file);
  if (!fresh?.refreshToken) return 'foreign';
  const r = adopt(name, fresh, { chain, by }, env);
  if (r === 'older') return pullInto(file, name, env) ? 'pulled' : 'same';
  return r;
}

const liveEmail = (p) => String(readJson(p.global)?.oauthAccount?.emailAddress || '');

/**
 * The live login (~/.claude) against its home. Who it is: the login whose lineage holds its token, else (renewed since
 * the last pass) the login whose lineage holds the token it had a minute ago, as long as the signed-in email did not
 * change in between (a new sign-in is somebody else, never a renewal). `state` = { live, email } from the last pass.
 */
export function syncLive(state = {}, env = process.env) {
  const p = homePaths(env);
  const fresh = oauthOf(p.live);
  const cur = tokenHash(fresh?.refreshToken);
  const email = liveEmail(p);
  if (!cur) return { result: 'none', state: { ...state } };
  let owner = ownerOf(cur, env); const chain = [];
  // a state file from before this build has no email: its first renewal still counts; after that the email must match
  if (!owner && state.live && state.live !== cur && (!('email' in state) || state.email === email)) {
    owner = ownerOf(state.live, env); chain.push(state.live);
  }
  const result = owner ? syncMirror(p.live, owner, { chain, by: 'live login' }, env) : 'unowned';
  const now = tokenHash(oauthOf(p.live)?.refreshToken);
  return { result, owner, state: { live: now, email, at: new Date().toISOString() } };
}

/** Every login: hashes and times only. */
export function status(env = process.env) {
  return homes(env).map((name) => {
    const m = meta(name, env);
    return { name, current: m.current.slice(0, 12), expiresAt: m.expiresAt ? new Date(m.expiresAt).toISOString() : '', lastRefreshAt: m.lastRefreshAt, lastRefreshBy: m.lastRefreshBy, lineage: m.lineage.length };
  });
}

/**
 * Every place a login is kept on this host: its home, the live login, every build copy (.axf-claude/<session>), and
 * whether each is in step with its home. A copy that is 'behind' would spend an old token; 'foreign' holds a login no
 * home knows (a sign-in that was never saved).
 */
export function audit(env = process.env) {
  const p = homePaths(env);
  const rows = [];
  const place = (kind, file, session = '') => {
    const o = oauthOf(file); const h = tokenHash(o?.refreshToken);
    if (!h) return;
    const owner = ownerOf(h, env);
    const home = owner ? meta(owner, env) : null;
    const state = !owner ? 'foreign' : home.current === h ? ((Number(o.expiresAt) || 0) >= home.expiresAt ? 'in step' : 'behind') : 'behind';
    rows.push({ kind, file, session, owner, token: h.slice(0, 12), expiresAt: o.expiresAt ? new Date(o.expiresAt).toISOString() : '', state });
  };
  for (const n of homes(env)) place('home', credsFile(p, n));
  place('live', p.live);
  for (const base of p.builds) {
    let ds = []; try { ds = readdirSync(base); } catch { continue; }
    for (const d of ds) {
      const f = join(base, d, '.axf-claude');
      let ss = []; try { ss = readdirSync(f); } catch { continue; }
      for (const s of ss) if (readJson(join(f, s, 'build-login.json'))?.$axf === 'build-login@1') place('build copy', join(f, s, '.credentials.json'), s);
    }
  }
  return rows;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const json = rest.includes('--json');
  if (cmd === 'status') {
    const s = status();
    console.log(json ? JSON.stringify(s) : s.map((r) => `${r.name.padEnd(16)} token ${r.current} · expires ${r.expiresAt || '?'} · last refresh ${r.lastRefreshAt || 'not seen yet'}${r.lastRefreshBy ? ` (${r.lastRefreshBy})` : ''}`).join('\n') || 'no saved logins');
  } else if (cmd === 'audit') {
    const a = audit();
    console.log(json ? JSON.stringify(a) : a.map((r) => `${r.state.padEnd(8)} ${r.kind.padEnd(10)} ${(r.owner || '?').padEnd(14)} ${r.token} ${r.session || r.file}`).join('\n') || 'no logins found');
  } else if (cmd === 'sync-live') {
    const r = syncLive();
    console.log(`${r.result}${r.owner ? ` (${r.owner})` : ''}`);
  } else {
    console.error('usage: claude-home.mjs status|audit [--json] · sync-live');
    process.exit(2);
  }
}

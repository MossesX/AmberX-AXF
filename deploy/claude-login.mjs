#!/usr/bin/env node
/**
 * claude-login.mjs — every headless build keeps its own Claude login (build-own-login, Nov 5 2026).
 *
 * Before: every `claude -p` on the VPS ran against the one shared login in ~/.claude, so logging the VPS out, switching
 * accounts or adding one killed or re-pointed every running build. Now each launch snapshots a login into a private
 * per-build Claude config dir and runs `claude` with CLAUDE_CONFIG_DIR pointed at it (Claude Code reads
 * $CLAUDE_CONFIG_DIR/.credentials.json and $CLAUDE_CONFIG_DIR/.claude.json instead of ~/.claude and ~/.claude.json,
 * verified on Claude Code 2.1.318). A token refresh during the build writes only to that copy.
 *
 *   node deploy/claude-login.mjs snapshot --dir <build folder> --session <name> [--account active|live|<saved name>] [--sh|--json]
 *   node deploy/claude-login.mjs release  --dir <build folder> --session <name>
 *   node deploy/claude-login.mjs who      --dir <build folder> --session <name>
 *   node deploy/claude-login.mjs accounts [--json]                 saved account names, the active one, emails
 *
 * The copy lives in <build folder>/.axf-claude/<session>/ (both 0700; `.axf-claude/` is git-ignored):
 *   .credentials.json   the account's login (0600), the only real credential file
 *   .claude.json        a copy of the shared global config (MCP servers, onboarding) minus the cached account (it
 *                       goes stale on every switch; Claude Code reads it again)
 *   token.env           0600 shell line: `export CLAUDE_CODE_OAUTH_TOKEN=…` when the account has a saved token, else
 *                       `unset CLAUDE_CODE_OAUTH_TOKEN`, so an inherited token never beats the snapshot
 *   build-login.json    build-login@1: { account, email, source, at } — never a credential
 *   everything else     symlinks to the shared config dir (settings.json + hooks, CLAUDE.md, projects/ transcripts,
 *                       plugins, skills…), so a build behaves exactly as before apart from whose login it uses
 *
 * Which account (--account, else AXF_CLAUDE_ACCOUNT, else "active"):
 *   active   the switcher's active account (~/.claude-accounts/.active). Its freshest copy is the live login
 *            (~/.claude/.credentials.json) unless that is byte-identical to another saved account or missing (logged
 *            out): then the saved copy. No saved accounts at all = the live login, recorded as "live".
 *   live     whatever ~/.claude holds right now (after AI keys switched accounts on a usage limit), named after the
 *            saved account it is identical to
 *   <name>   a saved account (~/.claude-accounts/<name>/.credentials.json and/or token)
 *
 * Never prints a credential: --sh prints only login_dir / login_account / login_email / login_source / login_token
 * (0|1, whether a saved token is used). Paths: AXF_CLAUDE_ACCOUNTS (default ~/.claude-accounts), AXF_CLAUDE_HOME
 * (the shared config dir, default $CLAUDE_CONFIG_DIR or ~/.claude), AXF_CLAUDE_GLOBAL (default ~/.claude.json, or
 * <AXF_CLAUDE_HOME>/.claude.json when CLAUDE_CONFIG_DIR is set), AXF_CLAUDE_SEEN (emails last seen per account).
 * Exit 0 ok, 2 bad usage / unknown account, 4 no login to snapshot.
 */
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = 'build-login.json';
export const FOLDER = '.axf-claude';
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SKIP = new Set(['.credentials.json', '.claude.json', MARKER, 'token.env']);

export function paths(env = process.env) {
  const home = env.HOME || homedir();
  const shared = env.AXF_CLAUDE_HOME || env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  return {
    accounts: env.AXF_CLAUDE_ACCOUNTS || join(home, '.claude-accounts'),
    shared,
    global: env.AXF_CLAUDE_GLOBAL || (env.CLAUDE_CONFIG_DIR || env.AXF_CLAUDE_HOME ? join(shared, '.claude.json') : join(home, '.claude.json')),
    // emails last seen per saved account (the switcher's console plugin keeps them; names + emails only)
    seen: env.AXF_CLAUDE_SEEN || '/opt/axf/.axf-console/plugins/claude-accounts/seen.json',  // axf-plugin:claude-accounts
  };
}

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const readText = (f) => { try { return readFileSync(f, 'utf8').trim(); } catch { return ''; } };
const isFile = (f) => { try { return statSync(f).isFile(); } catch { return false; } };
const slug = (s) => String(s || 'run').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 64) || 'run';

/** Saved accounts: [{name, active, creds, token, email}] (no credential is read beyond "is it there"). */
export function accounts(env = process.env) {
  const p = paths(env);
  const active = readText(join(p.accounts, '.active'));
  const seen = readJson(p.seen) || {};
  let names = [];
  try { names = readdirSync(p.accounts).filter((n) => NAME_RE.test(n)).sort(); } catch { /* no store */ }
  return names.map((name) => {
    const d = join(p.accounts, name);
    return { name, active: name === active, creds: isFile(join(d, '.credentials.json')), token: readText(join(d, 'token')) !== '', email: String(seen?.[name]?.email || '') };
  }).filter((a) => a.creds || a.token);
}

const liveEmail = (p) => String(readJson(p.global)?.oauthAccount?.emailAddress || '');
const bytes = (f) => { try { return readFileSync(f); } catch { return null; } };

/**
 * Work out where the login comes from. Returns { account, email, source: 'saved'|'live', creds: file|'', tokenFile: file|'' }.
 * Who the live login is: the saved account whose copy is byte-identical to it, else (refreshed since the switch, or a
 * new login) the active one. ~/.claude.json's cached account is no guide: the switcher swaps only the credentials
 * file, so that email goes stale on every switch.
 */
export function pick(want = 'active', env = process.env) {
  const p = paths(env);
  const list = accounts(env);
  const liveCreds = join(p.shared, '.credentials.json');
  const liveBuf = bytes(liveCreds);
  const hasLive = !!liveBuf && isFile(liveCreds);
  const owner = hasLive ? list.find((a) => a.creds && bytes(join(p.accounts, a.name, '.credentials.json'))?.equals(liveBuf)) || null : null;
  const act = list.find((a) => a.active) || null;
  const saved = (a) => ({ account: a.name, email: a.email, source: 'saved',
    creds: a.creds ? join(p.accounts, a.name, '.credentials.json') : '', tokenFile: a.token ? join(p.accounts, a.name, 'token') : '' });
  const fromLive = (a) => ({ account: a ? a.name : 'live', email: a ? a.email : (list.length ? '' : liveEmail(p)), source: 'live',
    creds: hasLive ? liveCreds : '', tokenFile: a?.token ? join(p.accounts, a.name, 'token') : '' });
  // the live login is (still) account `a`: identical bytes, or nothing says it is anyone else
  const liveIs = (a) => hasLive && (owner ? owner === a : a === act);
  const w = String(want || 'active').trim().toLowerCase();
  if (w === 'live') return fromLive(owner);   // unmatched (AI keys wrote another login) = "live"
  if (w === 'active' || w === '') {
    if (!act) return fromLive(owner);
    return liveIs(act) ? fromLive(act) : saved(act);
  }
  if (!NAME_RE.test(w)) throw Object.assign(new Error(`not an account name: ${w}`), { code: 2 });
  const a = list.find((x) => x.name === w);
  if (!a) throw Object.assign(new Error(`no saved Claude account "${w}" (saved: ${list.map((x) => x.name).join(', ') || 'none'})`), { code: 2 });
  return liveIs(a) ? fromLive(a) : saved(a);
}

export const loginDir = (dir, session) => join(resolve(dir), FOLDER, slug(session));

/**
 * Snapshot a login into <dir>/.axf-claude/<session>. Returns { dir, account, email, source, token } plus `env` /
 * `unset` for a node launcher to spawn `claude` with (env carries the token only when the account has one).
 */
export function snapshot({ dir, session, account = process.env.AXF_CLAUDE_ACCOUNT || 'active', env = process.env } = {}) {
  if (!dir) throw Object.assign(new Error('--dir <build folder> is required'), { code: 2 });
  const p = paths(env);
  const choice = pick(account, env);
  const token = choice.tokenFile ? readText(choice.tokenFile) : '';
  if (!choice.creds && !token) throw Object.assign(new Error(`no Claude login to snapshot for "${choice.account}" (log in, or save the account first)`), { code: 4 });
  const parent = join(resolve(dir), FOLDER);
  const out = loginDir(dir, session);
  mkdirSync(parent, { recursive: true, mode: 0o700 }); chmodSync(parent, 0o700);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { mode: 0o700 }); chmodSync(out, 0o700);
  // the login itself: a real file, so Claude's refresh writes land here and nowhere else
  if (choice.creds) { copyFileSync(choice.creds, join(out, '.credentials.json')); chmodSync(join(out, '.credentials.json'), 0o600); }
  // the global config: MCP servers, onboarding, trust. The cached account belongs to the live login only.
  const g = readJson(p.global);
  if (g && typeof g === 'object') {
    if (accounts(env).length) delete g.oauthAccount;   // a cached identity that may belong to another account
    writeFileSync(join(out, '.claude.json'), JSON.stringify(g, null, 2), { mode: 0o600 });
  }
  // everything else is shared, as before (settings + hooks, CLAUDE.md, transcripts, plugins…). Real paths, so a nested
  // launch from inside a build never links to a copy that is deleted when that build ends.
  let shared = p.shared; try { shared = realpathSync(p.shared); } catch { /* missing */ }
  let names = []; try { names = readdirSync(shared); } catch { /* no shared dir */ }
  for (const n of names) {
    if (SKIP.has(n) || n === FOLDER) continue;
    let target = join(shared, n); try { target = realpathSync(target); } catch { continue; }
    try { symlinkSync(target, join(out, n)); } catch { /* raced or exists */ }
  }
  const line = token ? `export CLAUDE_CODE_OAUTH_TOKEN='${token.replace(/'/g, `'\\''`)}'\n` : 'unset CLAUDE_CODE_OAUTH_TOKEN\n';
  writeFileSync(join(out, 'token.env'), line, { mode: 0o600 });
  const rec = { $axf: 'build-login@1', account: choice.account, email: choice.email, source: choice.source, token: !!token, session: slug(session), at: new Date().toISOString() };
  writeFileSync(join(out, MARKER), JSON.stringify(rec, null, 2) + '\n', { mode: 0o600 });
  return { dir: out, account: rec.account, email: rec.email, source: rec.source, token: rec.token,
    env: { CLAUDE_CONFIG_DIR: out, ...(token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}) }, unset: token ? [] : ['CLAUDE_CODE_OAUTH_TOKEN'] };
}

/** The environment for a node launcher: the parent's env with the snapshot applied (inherited token dropped). */
export function childEnv(snap, base = process.env) {
  const e = { ...base };
  for (const k of snap.unset) delete e[k];
  return { ...e, ...snap.env };
}

/** Remove a build's copy (only a folder this tool made: it must carry the build-login@1 marker). */
export function release({ dir, session } = {}) {
  if (!dir) throw Object.assign(new Error('--dir <build folder> is required'), { code: 2 });
  const out = loginDir(dir, session);
  if (!existsSync(out)) return { released: false, why: 'nothing to release' };
  if (lstatSync(out).isSymbolicLink() || readJson(join(out, MARKER))?.$axf !== 'build-login@1') return { released: false, why: 'not a build login copy; left alone' };
  rmSync(out, { recursive: true, force: true });   // symlinks are removed, never followed
  try { rmdirSync(join(resolve(dir), FOLDER)); } catch { /* other builds' copies still there */ }
  return { released: true };
}

export function who({ dir, session } = {}) {
  const r = readJson(join(loginDir(dir, session), MARKER));
  return r?.$axf === 'build-login@1' ? r : null;
}

export const describe = (r) => (r ? `${r.account}${r.email ? ` (${r.email})` : ''}` : 'shared login');

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const main = () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n, d = '') => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : d; };
  const has = (n) => rest.includes(`--${n}`);
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const dir = flag('dir', process.cwd()); const session = flag('session', basename(resolve(dir)));
  try {
    if (cmd === 'snapshot') {
      const s = snapshot({ dir, session, account: flag('account', process.env.AXF_CLAUDE_ACCOUNT || 'active') });
      const pub = { dir: s.dir, account: s.account, email: s.email, source: s.source, token: s.token };
      if (has('json')) console.log(JSON.stringify(pub));
      else if (has('sh')) console.log(`login_dir=${q(s.dir)} login_account=${q(s.account)} login_email=${q(s.email)} login_source=${s.source} login_token=${s.token ? 1 : 0}`);
      else console.log(`build login: ${describe(s)} · ${s.source} copy in ${s.dir}`);
    } else if (cmd === 'release') {
      const r = release({ dir, session }); console.log(r.released ? 'released' : r.why);
    } else if (cmd === 'who') {
      const r = who({ dir, session }); console.log(has('json') ? JSON.stringify(r) : describe(r));
    } else if (cmd === 'accounts') {
      const l = accounts();
      if (has('json')) console.log(JSON.stringify(l.map(({ name, active, email, token }) => ({ name, active, email, token }))));
      else for (const a of l) console.log(`${a.active ? '*' : ' '} ${a.name}${a.email ? ` (${a.email})` : ''}${a.token ? ' [token]' : ''}`);
    } else {
      console.error('usage: claude-login.mjs snapshot|release|who --dir <build folder> --session <name> [--account active|live|<name>] [--sh|--json] · accounts');
      process.exit(2);
    }
  } catch (e) { console.error(`claude-login: ${e.message}`); process.exit(e.code === 4 ? 4 : 2); }
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

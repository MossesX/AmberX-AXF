#!/usr/bin/env node
/**
 * claude-whoami.mjs — who a headless run is really signed in as (fix-account-attribution, Nov 9 2026).
 *
 * The dispatcher picks a saved account and claude-login.mjs snapshots it, but what Claude Code authenticates with is
 * decided by the environment: CLAUDE_CODE_OAUTH_TOKEN beats the config dir's .credentials.json, ANTHROPIC_API_KEY beats
 * both. A saved `token` file that belongs to another login (account-3's token was Moses X's setup token) made every run
 * labelled account-3 bill Moses X while the log, the run record and claude-workers' cost said account-3.
 *
 * So the launcher asks before the run starts, in the run's own environment:
 *   1. `claude auth status --json`: logged in at all, the method, and the email / org id when Claude Code has them.
 *   2. When no email came back (a setup token or an API key carries no profile scope): one count_tokens request with the
 *      same credential (free, no usage) whose `anthropic-organization-id` response header names the org. 401/403 = dead.
 *   3. org id → email through orgs.json (claude-orgs@1, next to the accounts plugin's seen.json: org ids and emails only),
 *      learned every time step 1 returns both.
 *
 *   node deploy/claude-whoami.mjs check --account <picked> [--email <expected>] [--kind subscription|api] [--session s] [--sh|--json]
 *   node deploy/claude-whoami.mjs learn --org <uuid> --email <email>
 *   node deploy/claude-whoami.mjs backfill --picked <name> --real <name> [--email e] [--since iso] [--until iso] [--reason r] [--apply]
 *
 * --sh prints one line: who_state=ok|mismatch|dead|unverified who_account=… who_email=… who_method=… who_org=… who_why=…
 *   ok          the login is the picked account (email or org confirmed)
 *   mismatch    it is someone else: who_account is the saved account with that email ('unknown' when none), and the
 *               mismatch is recorded on claude-workers (alert in Claude accounts and the systems check)
 *   dead        not signed in, or the credential is refused: the launcher marks the account out and never falls back
 *   unverified  nothing could confirm it (no network, older Claude Code); the run goes on under the picked account
 * Never prints or stores a credential. AXF_WHOAMI=off skips the check (state unverified); AXF_WHOAMI_PROBE=off skips the
 * network request; AXF_WHOAMI_URL points the request elsewhere (tests); AXF_CLAUDE_ORGS overrides the orgs.json path.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accounts, paths as loginPaths } from './claude-login.mjs';

export const ORGS_SCHEMA = 'claude-orgs@1';
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@'"]+@[^\s@'"]+$/;
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const lower = (s) => String(s || '').trim().toLowerCase();

export const orgsFile = (env = process.env) => env.AXF_CLAUDE_ORGS || join(dirname(loginPaths(env).seen), 'orgs.json');

/** { orgId: email } */
export function loadOrgs(env = process.env) {
  const j = readJson(orgsFile(env));
  const o = j?.orgs && typeof j.orgs === 'object' ? j.orgs : {};
  return Object.fromEntries(Object.entries(o).filter(([k, v]) => UUID_RE.test(k) && EMAIL_RE.test(String(v?.email || ''))).map(([k, v]) => [k.toLowerCase(), lower(v.email)]));
}

/** Remember which email an org id belongs to (only when Claude Code said both). */
export function learn(orgId, email, env = process.env) {
  if (!UUID_RE.test(orgId || '') || !EMAIL_RE.test(email || '')) return false;
  const f = orgsFile(env);
  const j = readJson(f) || {};
  const orgs = j.orgs && typeof j.orgs === 'object' ? j.orgs : {};
  if (lower(orgs[orgId.toLowerCase()]?.email) === lower(email)) return false;
  orgs[orgId.toLowerCase()] = { email: lower(email), at: new Date().toISOString() };
  try {
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify({ $axf: ORGS_SCHEMA, orgs }, null, 1), { mode: 0o600 });
    renameSync(`${f}.${process.pid}.tmp`, f);
    return true;
  } catch { return false; }
}

/** `claude auth status --json` in the run's environment. null when it didn't answer. */
export function authStatus(env = process.env) {
  const r = spawnSync(env.AXF_WHOAMI_CLAUDE || 'claude', ['auth', 'status', '--json'], { env, encoding: 'utf8', timeout: 30_000 });
  if (r.error || r.status !== 0) return null;
  try { const j = JSON.parse(r.stdout); return j && typeof j === 'object' ? j : null; } catch { return null; }
}

/** The credential Claude Code will use in this environment, in its own order of precedence. Never leaves this module. */
export function credentialOf(env = process.env, now = Date.now()) {
  if (env.ANTHROPIC_API_KEY) return { kind: 'api', key: env.ANTHROPIC_API_KEY };
  if (env.CLAUDE_CODE_OAUTH_TOKEN) return { kind: 'oauth_token', key: env.CLAUDE_CODE_OAUTH_TOKEN };
  const dir = env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), '.claude');
  const o = readJson(join(dir, '.credentials.json'))?.claudeAiOauth;
  if (!o?.accessToken) return null;
  // an access token past its expiry is refreshed by Claude Code on start: a 401 for it says nothing
  return { kind: 'claude.ai', key: o.accessToken, expired: Number(o.expiresAt) > 0 ? Number(o.expiresAt) < now + 60_000 : true };
}

/** One count_tokens request (free): { http, orgId }. */
export async function probe(cred, env = process.env, fetchImpl = globalThis.fetch) {
  const base = String(env.AXF_WHOAMI_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
  if (cred.kind === 'api') headers['x-api-key'] = cred.key;
  else { headers.authorization = `Bearer ${cred.key}`; headers['anthropic-beta'] = 'oauth-2025-04-20'; }
  try {
    const r = await fetchImpl(`${base}/v1/messages/count_tokens`, { method: 'POST', headers, signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ model: env.AXF_WHOAMI_MODEL || 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }] }) });
    const org = r.headers.get('anthropic-organization-id') || '';
    return { http: r.status, orgId: UUID_RE.test(org) ? org.toLowerCase() : '' };
  } catch (e) { return { http: 0, orgId: '', error: String(e?.message || e).slice(0, 120) }; }
}

/**
 * Who this environment is signed in as, against the account the dispatcher picked.
 * deps: { status: () => authStatus json|null, probe: async (cred) => {http, orgId} } (tests pass fakes).
 */
export async function identify({ account = '', email = '', kind = '' } = {}, env = process.env, deps = {}) {
  const picked = { account, email: lower(email), kind };
  const out = (state, extra = {}) => ({ $axf: 'claude-whoami@1', state, picked: picked.account, pickedEmail: picked.email, account: picked.account, email: '', method: '', orgId: '', why: '', ...extra });
  if (env.AXF_WHOAMI === 'off') return out('unverified', { why: 'check switched off' });
  const st = (deps.status || (() => authStatus(env)))();
  if (st && st.loggedIn === false) return out('dead', { method: 'none', why: 'Claude Code is not signed in with this login' });
  const method = String(st?.authMethod || (env.ANTHROPIC_API_KEY ? 'api_key' : env.CLAUDE_CODE_OAUTH_TOKEN ? 'oauth_token' : ''));
  let realEmail = lower(st?.email); let orgId = UUID_RE.test(st?.orgId || '') ? st.orgId.toLowerCase() : '';
  let why = '';
  if (realEmail && orgId) learn(orgId, realEmail, env);
  if (!realEmail && env.AXF_WHOAMI_PROBE !== 'off') {
    const cred = credentialOf(env);
    if (cred) {
      const r = await (deps.probe || ((c) => probe(c, env)))(cred);
      if ((r.http === 401 || r.http === 403) && !cred.expired) return out('dead', { method, why: `the credential was refused (HTTP ${r.http})` });
      if (r.orgId) orgId = r.orgId;
      else why = r.http ? `no org id (HTTP ${r.http})` : `probe failed${r.error ? `: ${r.error}` : ''}`;
    } else why = 'no credential found';
  }
  const orgs = loadOrgs(env);
  if (!realEmail && orgId) realEmail = orgs[orgId] || '';
  const expectOrg = picked.email ? Object.entries(orgs).find(([, e]) => e === picked.email)?.[0] || '' : '';
  const base = { method, orgId, email: realEmail };
  const differs = (realEmail && picked.email && realEmail !== picked.email) || (!realEmail && orgId && expectOrg && orgId !== expectOrg);
  // the saved account a login belongs to: same email, same kind of login first, the console's active one next
  const owner = () => {
    const want = method === 'api_key' ? 'api' : 'subscription';
    const list = realEmail ? accounts(env).filter((a) => lower(a.email) === realEmail) : [];
    return list.find((a) => a.kind === want && a.active) || list.find((a) => a.kind === want) || list[0] || null;
  };
  if (differs) return out('mismatch', { ...base, account: owner()?.name || 'unknown', why: `picked ${picked.account}${picked.email ? ` (${picked.email})` : ''}, signed in as ${realEmail || `org ${orgId}`}` });
  // nothing expected (the shared login): name the saved account it is, when there is one
  if (realEmail && !picked.email) {
    const o = owner();
    if (o && o.name !== picked.account && picked.account !== 'shared') return out('mismatch', { ...base, account: o.name, why: `picked ${picked.account}, signed in as ${realEmail} (${o.name})` });
    return out('ok', { ...base, account: o?.name || picked.account });
  }
  if (realEmail || (orgId && expectOrg)) return out('ok', { ...base, email: realEmail || picked.email });
  return out('unverified', { ...base, why: why || (orgId ? `org ${orgId} not known yet` : 'Claude Code gave no identity') });
}

/**
 * Re-attribute recorded runs (events.jsonl session-login lines) that are proven to have run on another login: every
 * `picked` login at or after `since` becomes `real`, keeping `picked`, `mismatch: true` and `backfilled`. Dry run unless
 * apply; a backup goes next to the file. Lines appended while it runs are kept.
 */
export function backfill({ picked, real, email = '', since = '', until = '', apply = false, reason = '' } = {}, env = process.env, now = Date.now()) {
  if (!NAME_RE.test(picked || '') || !NAME_RE.test(real || '') || picked === real) throw Object.assign(new Error('--picked and --real are two account names'), { code: 2 });
  const from = since ? Date.parse(since) : 0; const to = until ? Date.parse(until) : Infinity;
  if (Number.isNaN(from) || Number.isNaN(to)) throw Object.assign(new Error('--since / --until must be ISO times'), { code: 2 });
  const f = join(env.AXF_HEADLESS_DIR || '/var/tmp/axf-headless', 'events.jsonl');
  let before = ''; try { before = readFileSync(f, 'utf8'); } catch { return { file: f, changed: 0, sessions: [] }; }
  const sessions = [];
  const fix = (text) => text.split('\n').map((l) => {
    if (!l.trim()) return l;
    let e; try { e = JSON.parse(l); } catch { return l; }
    const at = Date.parse(e.at);
    if (e.event !== 'session-login' || e.account !== picked || !(at >= from && at <= to)) return l;
    sessions.push(e.session);
    return JSON.stringify({ ...e, account: real, email: email || e.email, picked, mismatch: true, backfilled: { at: new Date(now).toISOString(), reason: String(reason).slice(0, 200) } });
  }).join('\n');
  const out = fix(before);
  if (apply && sessions.length) {
    writeFileSync(`${f}.bak-${new Date(now).toISOString().replace(/[:.]/g, '-')}`, before);
    let after = before; try { after = readFileSync(f, 'utf8'); } catch { /* gone */ }
    const tail = after.startsWith(before) ? after.slice(before.length) : '';
    writeFileSync(`${f}.${process.pid}.tmp`, out + tail);
    renameSync(`${f}.${process.pid}.tmp`, f);
  }
  return { file: f, changed: sessions.length, sessions, applied: !!(apply && sessions.length) };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const main = async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n, d = '') => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : d; };
  const has = (n) => rest.includes(`--${n}`);
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  if (cmd === 'learn') { console.log(learn(flag('org'), flag('email')) ? 'learned' : 'unchanged'); return; }
  if (cmd === 'backfill') {
    try {
      const r = backfill({ picked: flag('picked'), real: flag('real'), email: flag('email'), since: flag('since'), until: flag('until'), reason: flag('reason'), apply: has('apply') });
      console.log(has('json') ? JSON.stringify(r) : `${r.applied ? 're-attributed' : 'would re-attribute'} ${r.changed} run(s) from ${flag('picked')} to ${flag('real')}${r.applied ? '' : ' (dry run: add --apply)'}`);
    } catch (e) { console.error(`claude-whoami: ${e.message}`); process.exit(2); }
    return;
  }
  if (cmd !== 'check') { console.error('usage: claude-whoami.mjs check --account <picked> [--email e] [--kind k] [--session s] [--sh|--json] · learn --org <uuid> --email <e> · backfill --picked a --real b [--since iso] [--apply]'); process.exit(2); }
  const account = flag('account');
  if (!NAME_RE.test(account)) { console.error('claude-whoami: --account is a saved account name'); process.exit(2); }
  const r = await identify({ account, email: flag('email'), kind: flag('kind') });
  if (r.state === 'mismatch' && flag('session')) {
    try { const { markMismatch } = await import('./claude-workers.mjs'); markMismatch(r.picked, { real: r.account, email: r.email, session: flag('session') }); } catch { /* the alert is best effort */ }
  }
  const clean = (s) => String(s || '').replace(/[^\w@.:() ,/-]/g, ' ').slice(0, 160);
  if (has('json')) console.log(JSON.stringify(r));
  else if (has('sh')) console.log(`who_state=${r.state} who_account=${q(NAME_RE.test(r.account) ? r.account : 'unknown')} who_email=${q(EMAIL_RE.test(r.email) ? r.email : '')} who_method=${q(clean(r.method))} who_org=${q(UUID_RE.test(r.orgId) ? r.orgId : '')} who_why=${q(clean(r.why))}`);
  else console.log(`${r.state}: ${r.account}${r.email ? ` (${r.email})` : ''}${r.why ? ` · ${r.why}` : ''}`);
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

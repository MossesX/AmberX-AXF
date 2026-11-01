/**
 * GitHub App broker (github-app@1, Nov 1 2026): one GitHub App ("AmberX AXF Bot") replaces the personal tokens that
 * kept dying. Installation tokens are minted from the app's private key whenever they are needed (1 h, refreshed at
 * 50 min), so they never expire for good; a user access token from the same app (8 h, refresh token 6 months, rolled
 * on every refresh) does what installation tokens can't on a personal account: create repos.
 *
 *   import * as app from './github-app.mjs';
 *   const dir = app.appDir();                                  // <console>/.axf-console/github-app (0700)
 *   app.buildManifest({ origin, name })                       → the manifest the console POSTs to github.com
 *   await app.convertManifest(dir, { code, state })           → stores app id, slug, client id/secret, key, webhook secret
 *   await app.findInstallation(dir)                           → installation id (GET /app/installations, app JWT)
 *   await app.installationToken(dir)                          → { token, expiresAt } (cached, refreshed at 50 min)
 *   app.authorizeUrl(dir, { origin }) / await app.exchangeUserCode(dir, { code, state, origin })
 *   await app.userToken(dir)                                  → { token, … } (refreshed when < 15 min left)
 *   await app.status(dir, { live })                           → health snapshot (never a secret)
 *   await app.createRepo(dir, { name, private })              → POST /user/repos with the user token
 *
 * Files (dir 0700, every file 0600, git-ignored with the rest of .axf-console): app.json (ids, no secrets),
 * private-key.pem, client-secret, webhook-secret, installation-token.json, user-token.json, pending-state.json.
 * Token refreshes run under one lock (`.lock`), so the console, git and the CLI never spend a refresh token twice.
 * No secret is ever logged or put in an error message; the CLI (github-token.mjs) prints a token only to stdout.
 */
import { createSign, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitHubError, apiBaseFromEnv, createGitHub, scrub, validName } from './github.mjs';

export const VERSION = 'github-app@1';
export const WEB_BASE = 'https://github.com';
export const DEFAULT_NAME = 'AmberX AXF Bot';
export const INSTALLATION_REFRESH_S = 10 * 60;  // a 1 h installation token is replaced once it has < 10 min left (at 50 min)
export const USER_REFRESH_S = 15 * 60;          // a user access token (8 h) is refreshed once it has < 15 min left
export const STATE_TTL_S = 60 * 60;             // a manifest / authorize round trip must finish within the hour
export const LOCK_STALE_MS = 30_000;
export const FILES = {
  meta: 'app.json', key: 'private-key.pem', clientSecret: 'client-secret', webhookSecret: 'webhook-secret',
  installation: 'installation-token.json', user: 'user-token.json', state: 'pending-state.json',
};
/** Repository permissions the app asks for (Brett, Nov 1 2026). Metadata read is implied but listed for clarity. */
export const PERMISSIONS = Object.freeze({
  administration: 'write', contents: 'write', pull_requests: 'write', actions: 'write', workflows: 'write',
  issues: 'write', checks: 'read', statuses: 'read', metadata: 'read',
});
/** Query value the console reads on its way back from github.com (`?ghapp=<step>`). */
export const RETURN_STEPS = ['created', 'installed', 'authorized'];

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const PEM_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

/* ─── where things live ──────────────────────────────────────────────────── */

/** The console's credential folder: AXF_GITHUB_APP_DIR, else <AXF_ROOT>/.axf-console/github-app, else /opt/axf's, else this checkout's. */
export function appDir(env = process.env) {
  if (env.AXF_GITHUB_APP_DIR) return resolve(env.AXF_GITHUB_APP_DIR);
  if (env.AXF_ROOT) return resolve(env.AXF_ROOT, '.axf-console', 'github-app');
  if (existsSync('/opt/axf/.axf-console')) return '/opt/axf/.axf-console/github-app';
  return join(REPO_ROOT, '.axf-console', 'github-app');
}
/** The console's secrets.env (the old personal token lives there as GITHUB_TOKEN). */
export function secretsFile(dir) { return join(dirname(dir), 'secrets.env'); }

export const webBaseFromEnv = (env = process.env) => (env.GITHUB_WEB_URL || WEB_BASE).replace(/\/+$/, '');

function baseOk(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || (p.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(p.hostname));
  } catch { return false; }
}

/** Every secret pattern (GitHub tokens, JWTs, PEM keys) and the given values → ***. */
export function redact(text, secrets = []) {
  return scrub(String(text), secrets.filter(Boolean)).replace(PEM_RE, '***').replace(JWT_RE, '***');
}

/* ─── private files ──────────────────────────────────────────────────────── */

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}
/** Atomic 0600 write (temp file + rename) inside the 0700 folder. */
export function writePrivate(dir, name, content) {
  ensureDir(dir);
  const file = join(dir, name);
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  return file;
}
const readText = (dir, name) => { try { return readFileSync(join(dir, name), 'utf8'); } catch { return ''; } };
const readJson = (dir, name) => { try { return JSON.parse(readFileSync(join(dir, name), 'utf8')); } catch { return null; } };
const writeJson = (dir, name, v) => writePrivate(dir, name, JSON.stringify(v, null, 2) + '\n');

/** Mode problems in the folder (dir not 0700, files not 0600); [] when all private. */
export function permissionProblems(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const mode = (p) => statSync(p).mode & 0o777;
  if (mode(dir) !== 0o700) out.push(`${dir} is ${mode(dir).toString(8)}, not 700`);
  for (const f of Object.values(FILES)) {
    const p = join(dir, f);
    if (existsSync(p) && mode(p) !== 0o600) out.push(`${f} is ${mode(p).toString(8)}, not 600`);
  }
  return out;
}

export const readMeta = (dir) => readJson(dir, FILES.meta);
export const configured = (dir) => !!(readMeta(dir)?.appId && readText(dir, FILES.key));
export const hasUser = (dir) => !!readJson(dir, FILES.user)?.accessToken;

/* ─── lock (refresh tokens are single-use) ───────────────────────────────── */

export async function withLock(dir, fn, { waitMs = 20_000 } = {}) {
  ensureDir(dir);
  const lock = join(dir, '.lock');
  const t0 = Date.now();
  for (;;) {
    try { mkdirSync(lock, { mode: 0o700 }); break; } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
      try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { rmSync(lock, { recursive: true, force: true }); continue; } } catch { continue; }
      if (Date.now() - t0 > waitMs) throw new Error('another process holds the GitHub App lock');
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try { return await fn(); } finally { rmSync(lock, { recursive: true, force: true }); }
}

/* ─── one-time states (CSRF on the round trips through github.com) ───────── */

export function newState(dir, kind, now = Date.now()) {
  const state = randomBytes(24).toString('hex');
  const all = (readJson(dir, FILES.state) ?? []).filter((s) => now - s.at < STATE_TTL_S * 1000);
  all.push({ kind, state, at: now });
  writeJson(dir, FILES.state, all.slice(-10));
  return state;
}
/** True once per issued state of that kind (it is used up). */
export function takeState(dir, kind, state, now = Date.now()) {
  if (typeof state !== 'string' || !/^[0-9a-f]{48}$/.test(state)) return false;
  const all = (readJson(dir, FILES.state) ?? []).filter((s) => now - s.at < STATE_TTL_S * 1000);
  const i = all.findIndex((s) => s.kind === kind && s.state.length === state.length && timingSafeEqual(Buffer.from(s.state), Buffer.from(state)));
  if (i < 0) return false;
  all.splice(i, 1);
  writeJson(dir, FILES.state, all);
  return true;
}

/* ─── 1. manifest flow ───────────────────────────────────────────────────── */

/** The console's own address (https, or http on this machine), without a trailing slash; throws when not. */
export function checkOrigin(origin) {
  const o = String(origin ?? '').trim().replace(/\/+$/, '');
  if (!baseOk(o)) throw new Error('origin must be the console\'s https address');
  const u = new URL(o);
  if (u.pathname !== '/' && u.pathname !== '' || u.search || u.hash) throw new Error('origin must be scheme://host[:port] only');
  return `${u.protocol}//${u.host}`;
}
export const returnUrl = (origin, step) => `${checkOrigin(origin)}/?ghapp=${step}`;

/** The GitHub App manifest (https://docs.github.com/apps/sharing-github-apps/registering-a-github-app-from-a-manifest). */
export function buildManifest({ origin, name = DEFAULT_NAME } = {}) {
  const o = checkOrigin(origin);
  const n = String(name || DEFAULT_NAME).trim().slice(0, 34);
  return {
    name: n,
    url: o,
    description: 'AmberX AXF Dev Console: pushes, pull requests, merges, CI reads and repo creation for the AmberX stack. Tokens are minted on the console server and never leave it.',
    hook_attributes: { url: o, active: false },  // no webhook: tokens are minted on demand
    redirect_url: returnUrl(o, 'created'),
    callback_urls: [returnUrl(o, 'authorized')],
    setup_url: returnUrl(o, 'installed'),
    setup_on_update: true,
    request_oauth_on_install: false,
    public: false,
    default_permissions: { ...PERMISSIONS },
    default_events: [],
  };
}
/** Where the console's form POSTs the manifest: the personal account's new-app page (or an organisation's). */
export function manifestAction({ org = '', state = '' } = {}, env = process.env) {
  const web = webBaseFromEnv(env);
  const path = org ? `/organizations/${encodeURIComponent(org)}/settings/apps/new` : '/settings/apps/new';
  return `${web}${path}${state ? `?state=${encodeURIComponent(state)}` : ''}`;
}
/** Everything the console needs to start: { action, manifest, state } (the state is kept here for the callback). */
export function startManifest(dir, { origin, name, org } = {}) {
  const manifest = buildManifest({ origin, name });
  const state = newState(dir, 'manifest');
  return { action: manifestAction({ org, state }), manifest, state };
}

const api = (token) => createGitHub({ token: () => token, base: apiBaseFromEnv(), userAgent: 'axf-github-app', tokenHint: 'the GitHub App', timeoutMs: 20_000 });
const publicApi = () => createGitHub({ token: '', userAgent: 'axf-github-app', timeoutMs: 20_000 });

/** Callback of the manifest flow: POST /app-manifests/{code}/conversions, then every credential to its own 0600 file. */
export async function convertManifest(dir, { code, state, origin = '' } = {}) {
  if (!takeState(dir, 'manifest', state)) throw new Error('this setup link is stale or was already used: start again with Create GitHub App');
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(code)) throw new Error('GitHub sent no usable code');
  const r = await publicApi().json('POST', `/app-manifests/${code}/conversions`, {}, { auth: false });
  if (!r?.id || !r?.pem || !r?.client_id) throw new Error('GitHub\'s answer has no app id, key or client id');
  writePrivate(dir, FILES.key, r.pem.endsWith('\n') ? r.pem : `${r.pem}\n`);
  if (r.client_secret) writePrivate(dir, FILES.clientSecret, r.client_secret);
  if (r.webhook_secret) writePrivate(dir, FILES.webhookSecret, r.webhook_secret);
  const meta = {
    $axf: VERSION, appId: r.id, slug: r.slug, name: r.name, clientId: r.client_id,
    owner: r.owner?.login ?? '', ownerType: r.owner?.type ?? '', htmlUrl: r.html_url ?? '',
    permissions: r.permissions ?? { ...PERMISSIONS }, origin: origin ? checkOrigin(origin) : '',
    createdAt: new Date().toISOString(), installationId: null,
  };
  writeJson(dir, FILES.meta, meta);
  rmSync(join(dir, FILES.installation), { force: true });
  return publicMeta(meta);
}
export function installUrl(meta, env = process.env) {
  return meta?.slug ? `${webBaseFromEnv(env)}/apps/${encodeURIComponent(meta.slug)}/installations/new` : '';
}
/** app.json without anything secret (it has none, but this is the shape callers get). */
export function publicMeta(meta) {
  if (!meta) return null;
  const { appId, slug, name, clientId, owner, ownerType, htmlUrl, createdAt, installationId, installationAccount, installedAt, repositorySelection } = meta;
  return { appId, slug, name, clientId, owner, ownerType, htmlUrl, createdAt, installationId: installationId ?? null, installationAccount: installationAccount ?? '', installedAt: installedAt ?? '', repositorySelection: repositorySelection ?? '', installUrl: installUrl(meta) };
}

/* ─── app JWT + installation token ───────────────────────────────────────── */

const b64url = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** RS256 JWT for the app (iat 60 s back for clock drift, 9 min life; GitHub allows 10). */
export function appJwt({ appId, clientId }, pem, nowS = Math.floor(Date.now() / 1000)) {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: nowS - 60, exp: nowS + 540, iss: String(clientId || appId) }));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(pem);
  return `${head}.${body}.${b64url(sig)}`;
}
function jwtFor(dir) {
  const meta = readMeta(dir);
  const pem = readText(dir, FILES.key);
  if (!meta?.appId || !pem) throw new Error('the GitHub App isn\'t set up yet (Settings → Plugins → GitHub → Create GitHub App)');
  try { return { meta, jwt: appJwt(meta, pem) }; } catch { throw new Error('the GitHub App\'s private key can\'t sign (the key file is damaged): create the app again'); }
}

/** GET /app/installations with the app JWT; stores the one on the app's owner (or the only one). */
export async function findInstallation(dir, { wanted = null } = {}) {
  const { meta, jwt } = jwtFor(dir);
  const list = await api(jwt).json('GET', '/app/installations?per_page=100');
  const all = Array.isArray(list) ? list : [];
  const pick = all.find((i) => wanted && String(i.id) === String(wanted))
    ?? all.find((i) => meta.owner && i.account?.login?.toLowerCase() === meta.owner.toLowerCase())
    ?? (all.length === 1 ? all[0] : null);
  const next = { ...readMeta(dir) };
  if (pick) {
    if (String(next.installationId) !== String(pick.id)) rmSync(join(dir, FILES.installation), { force: true });
    Object.assign(next, { installationId: pick.id, installationAccount: pick.account?.login ?? '', repositorySelection: pick.repository_selection ?? '', installedAt: next.installedAt || new Date().toISOString() });
  } else {
    Object.assign(next, { installationId: null, installationAccount: '', repositorySelection: '' });
    rmSync(join(dir, FILES.installation), { force: true });
  }
  writeJson(dir, FILES.meta, next);
  return pick ? { id: pick.id, account: pick.account?.login ?? '', repositorySelection: pick.repository_selection ?? '' } : null;
}

const fresh = (iso, leftS, now = Date.now()) => !!iso && Date.parse(iso) - now > leftS * 1000;

/** A working installation token: the cached one while it has > 10 min left, else a new one (under the lock). */
export async function installationToken(dir, { force = false } = {}) {
  const cached = readJson(dir, FILES.installation);
  const meta = readMeta(dir);
  if (!force && cached?.token && String(cached.installationId) === String(meta?.installationId) && fresh(cached.expiresAt, INSTALLATION_REFRESH_S)) {
    return { token: cached.token, expiresAt: cached.expiresAt, cached: true };
  }
  return withLock(dir, async () => {
    const again = readJson(dir, FILES.installation);
    const m = readMeta(dir);
    if (!force && again?.token && String(again.installationId) === String(m?.installationId) && fresh(again.expiresAt, INSTALLATION_REFRESH_S)) {
      return { token: again.token, expiresAt: again.expiresAt, cached: true };
    }
    let id = m?.installationId;
    if (!id) id = (await findInstallation(dir))?.id;
    if (!id) throw new Error('the GitHub App isn\'t installed yet: open its install page and pick All repositories');
    const { jwt } = jwtFor(dir);
    let r;
    try { r = await api(jwt).json('POST', `/app/installations/${encodeURIComponent(id)}/access_tokens`, {}); } catch (e) {
      if (e instanceof GitHubError && e.status === 404) { await findInstallation(dir); throw new Error('the GitHub App was uninstalled: install it again (All repositories)'); }
      throw e;
    }
    if (!r?.token) throw new Error('GitHub minted no installation token');
    writeJson(dir, FILES.installation, { token: r.token, expiresAt: r.expires_at, installationId: id, mintedAt: new Date().toISOString() });
    return { token: r.token, expiresAt: r.expires_at, cached: false };
  });
}

/* ─── user access token (OAuth user-to-server; repo creation) ────────────── */

export function authorizeUrl(dir, { origin } = {}, env = process.env) {
  const meta = readMeta(dir);
  if (!meta?.clientId) throw new Error('create the GitHub App first');
  const state = newState(dir, 'authorize');
  const q = new URLSearchParams({ client_id: meta.clientId, redirect_uri: returnUrl(origin || meta.origin, 'authorized'), state, allow_signup: 'false' });
  return { url: `${webBaseFromEnv(env)}/login/oauth/authorize?${q}`, state };
}

async function oauthToken(params, env = process.env) {
  const web = webBaseFromEnv(env);
  if (!baseOk(web)) throw new Error('GITHUB_WEB_URL must be https');
  let res;
  try {
    res = await fetch(`${web}/login/oauth/access_token`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'axf-github-app' },
      body: JSON.stringify(params),
    });
  } catch (e) { throw new Error(`GitHub not reachable: ${redact(e?.cause?.message || e?.message || e, Object.values(params)).slice(0, 200)}`); }
  let d = null;
  try { d = JSON.parse(await res.text()); } catch { /* not JSON */ }
  if (!res.ok || !d || d.error || !d.access_token) {
    const why = d?.error_description || d?.error || `HTTP ${res.status}`;
    const err = new Error(`GitHub refused the user token: ${redact(why, Object.values(params)).slice(0, 200)}`);
    err.code = d?.error || `http_${res.status}`;
    throw err;
  }
  return d;
}
function userRecord(d, prev = {}, now = Date.now()) {
  const at = (s) => (s ? new Date(now + Number(s) * 1000).toISOString() : null);
  return {
    ...prev,
    accessToken: d.access_token, accessExpiresAt: at(d.expires_in),
    refreshToken: d.refresh_token || prev.refreshToken || '', refreshExpiresAt: d.refresh_token ? at(d.refresh_token_expires_in) : (prev.refreshExpiresAt ?? null),
    refreshedAt: new Date(now).toISOString(), lastError: null,
  };
}

/** Callback of "Authorize as Brett": code → access + refresh token, stored with the login it belongs to. */
export async function exchangeUserCode(dir, { code, state, origin = '' } = {}, env = process.env) {
  if (!takeState(dir, 'authorize', state)) throw new Error('this sign-in link is stale or was already used: tap Authorize again');
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(code)) throw new Error('GitHub sent no usable code');
  const meta = readMeta(dir);
  const secret = readText(dir, FILES.clientSecret).trim();
  if (!meta?.clientId || !secret) throw new Error('create the GitHub App first');
  const d = await oauthToken({ client_id: meta.clientId, client_secret: secret, code, redirect_uri: returnUrl(origin || meta.origin, 'authorized') }, env);
  let login = '';
  try { login = (await api(d.access_token).json('GET', '/user'))?.login ?? ''; } catch { /* the token is stored either way */ }
  const rec = { ...userRecord(d), login, authorizedAt: new Date().toISOString() };
  return withLock(dir, async () => { writeJson(dir, FILES.user, rec); return publicUser(rec); });
}

export function publicUser(rec) {
  if (!rec?.accessToken) return null;
  return { login: rec.login ?? '', accessExpiresAt: rec.accessExpiresAt, refreshExpiresAt: rec.refreshExpiresAt, refreshedAt: rec.refreshedAt, authorizedAt: rec.authorizedAt, lastError: rec.lastError ?? null, expiring: !!rec.accessExpiresAt };
}

/** The user access token, refreshed (refresh token rolled) when it has < 15 min left. A failed refresh is recorded. */
export async function userToken(dir, { force = false } = {}, env = process.env) {
  const rec = readJson(dir, FILES.user);
  if (!rec?.accessToken) throw new Error('nobody has authorized the GitHub App as a user yet (Settings → Plugins → GitHub → Authorize as Brett)');
  const okNow = (r) => !r.accessExpiresAt || fresh(r.accessExpiresAt, USER_REFRESH_S);
  if (!force && okNow(rec)) return { token: rec.accessToken, ...publicUser(rec), cached: true };
  return withLock(dir, async () => {
    const cur = readJson(dir, FILES.user);
    if (!force && okNow(cur)) return { token: cur.accessToken, ...publicUser(cur), cached: true };
    if (!cur.refreshToken) throw new Error('the user token has no refresh token: authorize again');
    if (cur.refreshExpiresAt && !fresh(cur.refreshExpiresAt, 0)) throw new Error('the user refresh token expired: authorize again');
    const meta = readMeta(dir);
    const secret = readText(dir, FILES.clientSecret).trim();
    try {
      const d = await oauthToken({ client_id: meta?.clientId, client_secret: secret, grant_type: 'refresh_token', refresh_token: cur.refreshToken }, env);
      const next = userRecord(d, cur);
      writeJson(dir, FILES.user, next);
      return { token: next.accessToken, ...publicUser(next), cached: false };
    } catch (e) {
      writeJson(dir, FILES.user, { ...cur, lastError: { at: new Date().toISOString(), message: redact(e.message).slice(0, 200), code: e.code ?? '' } });
      throw e;
    }
  });
}

/* ─── the old personal token (fallback until Brett deletes it) ───────────── */

/** GITHUB_TOKEN_PAT, else GITHUB_TOKEN in the console's secrets.env, else a GITHUB_TOKEN in the environment that isn't the app's. */
export function legacyToken(dir, env = process.env) {
  if (env.GITHUB_TOKEN_PAT) return env.GITHUB_TOKEN_PAT.trim();
  const line = readText(dirname(dir), 'secrets.env').split('\n').find((l) => l.startsWith('GITHUB_TOKEN='));
  const fromFile = line ? line.slice('GITHUB_TOKEN='.length).replace(/["'\r\s]/g, '') : '';
  if (fromFile) return fromFile;
  const e = (env.GITHUB_TOKEN || '').trim();
  return e && !e.startsWith('ghs_') ? e : '';
}

/** What git and other callers should use: the installation token, else the old token. { token, source }. */
export async function bestToken(dir, env = process.env) {
  if (configured(dir)) {
    try { return { token: (await installationToken(dir)).token, source: 'app' }; } catch { /* fall back */ }
  }
  const t = legacyToken(dir, env);
  return { token: t, source: t ? 'legacy' : 'none' };
}

/* ─── repos ──────────────────────────────────────────────────────────────── */

/** POST /user/repos with the user token (installation tokens can't create repos on a personal account). */
export async function createRepo(dir, { name, private: priv = true, description = '' } = {}, env = process.env) {
  if (!validName(name)) throw new Error(`not a repo name: ${JSON.stringify(String(name).slice(0, 60))}`);
  const { token, login } = await userToken(dir, {}, env);
  const gh = api(token);
  try {
    const r = await gh.json('POST', '/user/repos', { name, private: !!priv, description: String(description).slice(0, 300), auto_init: false });
    return { created: true, fullName: r.full_name, private: r.private, htmlUrl: r.html_url };
  } catch (e) {
    if (e instanceof GitHubError && e.status === 422 && login) {
      const r = await gh.json('GET', `/repos/${encodeURIComponent(login)}/${encodeURIComponent(name)}`).catch(() => null);
      if (r?.full_name) return { created: false, fullName: r.full_name, private: r.private, htmlUrl: r.html_url, note: 'already exists' };
    }
    throw e;
  }
}

/* ─── health ─────────────────────────────────────────────────────────────── */

const why = (e) => redact(e?.message ?? String(e)).slice(0, 220);

/**
 * { configured, app, checks: { key, installation, token, user, rateLimit, files }, legacy } — never a secret.
 * live = call GitHub (GET /app, find the installation, mint/refresh); otherwise only what's on disk.
 */
export async function status(dir, { live = false } = {}, env = process.env) {
  const meta = readMeta(dir);
  const out = { $axf: VERSION, dir, configured: configured(dir), app: publicMeta(meta), checks: {}, legacy: { set: !!legacyToken(dir, env) } };
  const files = permissionProblems(dir);
  out.checks.files = { ok: files.length === 0, problems: files };
  const userRec = readJson(dir, FILES.user);
  out.checks.user = userRec?.accessToken ? { ok: !userRec.lastError, state: userRec.lastError ? 'failed' : 'ok', ...publicUser(userRec) } : { ok: false, state: 'none' };
  if (!out.configured) return out;
  const inst = readJson(dir, FILES.installation);
  out.checks.token = inst?.token ? { ok: fresh(inst.expiresAt, 0), expiresAt: inst.expiresAt, mintedAt: inst.mintedAt } : { ok: false, why: 'not minted yet' };
  out.checks.installation = meta.installationId ? { ok: true, id: meta.installationId, account: meta.installationAccount, repositorySelection: meta.repositorySelection } : { ok: false, why: 'not installed yet' };
  if (!live) return out;
  try {
    const { jwt } = jwtFor(dir);
    const a = await api(jwt).json('GET', '/app');
    out.checks.key = { ok: true, slug: a?.slug ?? meta.slug };
  } catch (e) {
    out.checks.key = { ok: false, why: e instanceof GitHubError && e.status === 401 ? 'GitHub rejected the app key (401): the key was revoked or the app deleted' : why(e) };
    return out;
  }
  try {
    const i = await findInstallation(dir);
    out.checks.installation = i ? { ok: true, ...i } : { ok: false, why: 'not installed yet' };
    out.app = publicMeta(readMeta(dir));
  } catch (e) { out.checks.installation = { ok: false, why: why(e) }; }
  if (out.checks.installation.ok) {
    try {
      const t = await installationToken(dir);
      out.checks.token = { ok: true, expiresAt: t.expiresAt, cached: t.cached };
      try {
        const rl = await api(t.token).json('GET', '/rate_limit');
        const c = rl?.resources?.core ?? rl?.rate ?? {};
        out.checks.rateLimit = { ok: (c.remaining ?? 1) > 100, remaining: c.remaining, limit: c.limit, resetAt: c.reset ? new Date(c.reset * 1000).toISOString() : null };
      } catch (e) { out.checks.rateLimit = { ok: false, why: why(e) }; }
    } catch (e) { out.checks.token = { ok: false, why: why(e) }; }
  }
  if (userRec?.accessToken) {
    try {
      const u = await userToken(dir, {}, env);
      out.checks.user = { ok: true, state: 'ok', ...publicUser(readJson(dir, FILES.user)), cached: u.cached };
    } catch (e) { out.checks.user = { ok: false, state: 'failed', why: why(e), ...publicUser(readJson(dir, FILES.user)) }; }
  }
  return out;
}

/** Forget the user token (Sign out) or everything (Remove app: the app itself stays on GitHub until deleted there). */
export function forget(dir, { all = false } = {}) {
  rmSync(join(dir, FILES.user), { force: true });
  if (!all) return;
  for (const f of Object.values(FILES)) rmSync(join(dir, f), { force: true });
}

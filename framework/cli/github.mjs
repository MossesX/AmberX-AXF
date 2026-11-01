/**
 * GitHub REST helpers for AXF's Node tools (lib-github, `x.lib.github`) — the twin of Python
 * `framework/python/axf_server/github.py`; both replay `framework/spec/fixtures/github.json`
 * (`node framework/spec/check-github.mjs`).
 *
 *   import { createGitHub, githubToken, gitAuthEnv, parseRepo, repoPath } from './github.mjs';
 *   const gh = createGitHub({ token: githubToken(), userAgent: 'axf-claude-project' });
 *   const me = await gh.json('GET', '/user');                                // GitHubError { status } when not 2xx
 *   spawnSync('git', ['push', url, 'main'], { env: { ...process.env, ...gitAuthEnv(token) } });
 *
 * Rules (the strictest of the copies it replaced; same as the Python module):
 *   - the token goes to the API origin only (https://api.github.com, or GITHUB_API_URL: https, or plain http on this
 *     machine for tests); a path is joined to it and an absolute URL elsewhere is refused before anything is sent;
 *   - API calls never follow redirects (`redirect: 'manual'`; a 3xx is an error), so the token can't travel;
 *   - every call has a timeout and a size cap; errors never carry the token (`scrub`);
 *   - owner/repo names are checked before they reach a URL or git (no leading '.'/'-', no '..');
 *   - git gets the token through GIT_CONFIG_* environment only: an Authorization header scoped to https://github.com/
 *     plus http.followRedirects=false — never argv, never a URL, never .git/config.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API_BASE = 'https://api.github.com';
export const GIT_BASE = 'https://github.com';
export const UPLOADS_BASE = 'https://uploads.github.com'; // placeholder: release asset uploads (not used yet)
export const API_VERSION = '2022-11-28';
export const ACCEPT = 'application/vnd.github+json';
export const MAX_REDIRECTS = 5;
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
export const RUN_STATES = ['queued', 'waiting', 'running', 'success', 'failure', 'cancelled'];
export const FAILURE_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);

const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const NAME_RE = /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;
const SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,199}$/;
const PARSE_RE = /^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:)?([^/\s:]+)\/([^/\s]+)$/i;
const TOKEN_RE = /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const CANCELLED = new Set(['cancelled', 'skipped', 'neutral']);
const QUEUED = new Set(['queued', 'requested', 'pending']);

export class GitHubError extends Error {
  /** status: HTTP status (0 = not reached / refused before sending). The message never carries a secret. */
  constructor(status, message) { super(message); this.name = 'GitHubError'; this.status = status; }
}

/* ─── names and paths (pure; fixture-pinned) ─────────────────────────────── */

export const validOwner = (s) => typeof s === 'string' && OWNER_RE.test(s);
export const validName = (s) => typeof s === 'string' && NAME_RE.test(s);
export function validRepo(s) {
  if (typeof s !== 'string' || s.split('/').length !== 2) return false;
  const [o, n] = s.split('/');
  return validOwner(o) && validName(n);
}

/** "owner/name", "https://github.com/owner/name(.git)" or "git@github.com:owner/name.git" → "owner/name" (null if not). */
export function parseRepo(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim().slice(0, 300).replace(/\.git$/, '').replace(/\/+$/, '');
  const m = t.match(PARSE_RE);
  if (!m || !validOwner(m[1]) || !validName(m[2])) return null;
  return `${m[1]}/${m[2]}`;
}

function query(q) {
  if (!q) return '';
  const pairs = Object.entries(q).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, typeof v === 'boolean' ? String(v) : String(v)]);
  if (!pairs.length) return '';
  // same encoding as Python's urlencode (quote_plus): spaces → '+', unreserved kept
  const enc = (s) => encodeURIComponent(s).replace(/%20/g, '+').replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return '?' + pairs.map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
}
function segment(p) {
  const s = (typeof p === 'string' || (typeof p === 'number' && Number.isInteger(p))) ? String(p) : '';
  if (!SEGMENT_RE.test(s) || s.includes('..')) throw new Error(`bad path part: ${JSON.stringify(s.slice(0, 40))}`);
  return encodeURIComponent(s);
}
/** '/user/repos?per_page=100' from ['user', 'repos'], { per_page: 100 }; every part checked (no '/', no '..'). */
export const apiPath = (parts, q) => '/' + parts.map(segment).join('/') + query(q);
/** '/repos/<owner>/<name>/<parts…>?<query>' — throws when the repo isn't owner/name. */
export function repoPath(repo, parts = [], q) {
  if (!validRepo(repo)) throw new Error('repo must look like owner/name');
  const [o, n] = repo.split('/');
  return apiPath(['repos', o, n, ...parts], q);
}

/** The rel="next" URL of a Link header (RFC 8288), or null. */
export function nextLink(header) {
  if (typeof header !== 'string') return null;
  const re = /<([^>]*)>\s*((?:;\s*[^;,]+)*)/g;
  let m;
  while ((m = re.exec(header))) {
    const url = m[1].trim();
    for (const p of m[2].split(';')) {
      const i = p.indexOf('=');
      if (i < 0) continue;
      if (p.slice(0, i).trim().toLowerCase() === 'rel' && p.slice(i + 1).trim().replace(/^"|"$/g, '').toLowerCase().split(/\s+/).includes('next')) return url || null;
    }
  }
  return null;
}

/** GitHub Actions (status, conclusion) → queued | waiting | running | success | failure | cancelled. */
export function runState(status, conclusion) {
  const st = String(status ?? '');
  if (st === 'in_progress') return 'running';
  if (st === 'waiting') return 'waiting';
  if (QUEUED.has(st)) return 'queued';
  if (conclusion === 'success') return 'success';
  if (CANCELLED.has(conclusion)) return 'cancelled';
  return 'failure';
}

/* ─── targets, token and redirect decisions (pure; fixture-pinned) ───────── */

function parse(url) { try { return new URL(url); } catch { return null; } }
/** https anywhere; plain http only to this machine; no user:password, no other scheme (= axf_server.http.target_ok). */
export function targetOk(url) {
  if (typeof url !== 'string' || /[\r\n\t\0 ]/.test(url)) return false;
  const u = parse(url);
  if (!u || !u.hostname || u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return LOOPBACK.has(u.hostname.toLowerCase());
  return false;
}
export function originOf(url) { const u = parse(url); return u ? u.origin.toLowerCase() : ''; }
/** May the token be sent to `url`? Only a valid target on exactly the API base's origin. */
export const tokenAllowed = (url, base = API_BASE) => targetOk(url) && targetOk(base) && originOf(url) === originOf(base);

/** A download's 3xx: { follow, url?, auth: false, reason? } — https only, hop limit, never with credentials. */
export function redirectStep(current, location, hop, maxHops = MAX_REDIRECTS) {
  if (typeof location !== 'string' || !location.trim()) return { follow: false, auth: false, reason: 'no location' };
  if (hop > maxHops) return { follow: false, auth: false, reason: 'too many redirects' };
  let next;
  try { next = new URL(location.trim(), current).href; } catch { return { follow: false, auth: false, reason: 'redirect target must be https' }; }
  if (!next.startsWith('https:') || !targetOk(next)) return { follow: false, auth: false, reason: 'redirect target must be https' };
  return { follow: true, url: next, auth: false };
}

/* ─── git auth + scrubbing ──────────────────────────────────────────────── */

const basicOf = (token) => Buffer.from(`x-access-token:${token}`).toString('base64');
/** git config pairs that authenticate to `base` (https only, else none): a scoped Authorization header + no redirects. */
export function gitAuthConfig(token, base = GIT_BASE) {
  if (!token || typeof base !== 'string' || !base.startsWith('https://') || !targetOk(base)) return [];
  return [[`http.${base.replace(/\/+$/, '')}/.extraheader`, `Authorization: Basic ${basicOf(token)}`], ['http.followRedirects', 'false']];
}
/** Environment additions for one git command (GIT_TERMINAL_PROMPT=0 + GIT_CONFIG_* after any already set). */
export function gitAuthEnv(token, base = GIT_BASE, env = process.env) {
  const out = { GIT_TERMINAL_PROMPT: '0' };
  const pairs = gitAuthConfig(token, base);
  if (!pairs.length) return out;
  const start = Math.max(0, Number.parseInt(env?.GIT_CONFIG_COUNT ?? '0', 10) || 0);
  pairs.forEach(([k, v], i) => { out[`GIT_CONFIG_KEY_${start + i}`] = k; out[`GIT_CONFIG_VALUE_${start + i}`] = v; });
  out.GIT_CONFIG_COUNT = String(start + pairs.length);
  return out;
}
/** `text` with every secret (and its git Basic form) and anything that looks like a GitHub token replaced by ***. */
export function scrub(text, secrets = []) {
  let s = String(text);
  for (const t of secrets) if (t && t.length >= 4) s = s.split(basicOf(t)).join('***').split(t).join('***');
  return s.replace(TOKEN_RE, '***');
}

/** GITHUB_TOKEN / GH_TOKEN, else the GitHub App's installation token (github-app@1 broker), else `gh auth token`, else ''. */
export function githubToken() {
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (t) return t.trim();
  const app = appInstallationToken();
  if (app) return app;
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim(); } catch { return ''; }
}
/** The broker's installation token when a GitHub App is set up here (cached file while fresh, else one broker run). */
function appInstallationToken(env = process.env) {
  const dir = env.AXF_GITHUB_APP_DIR || (env.AXF_ROOT ? join(env.AXF_ROOT, '.axf-console', 'github-app') : '/opt/axf/.axf-console/github-app');
  if (!existsSync(join(dir, 'app.json'))) return '';
  try {
    const c = JSON.parse(readFileSync(join(dir, 'installation-token.json'), 'utf8'));
    if (c?.token && Date.parse(c.expiresAt) - Date.now() > 10 * 60_000) return String(c.token);
  } catch { /* none cached */ }
  try {
    return execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'github-token.mjs'), 'installation'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000, env: { ...env, AXF_GITHUB_APP_DIR: dir } }).trim();
  } catch { return ''; }
}
/** GITHUB_API_URL when set (GitHub Enterprise, or a loopback fake in tests), else https://api.github.com. */
export const apiBaseFromEnv = () => (process.env.GITHUB_API_URL || API_BASE).replace(/\/+$/, '');

/* ─── client ────────────────────────────────────────────────────────────── */

async function readCapped(res, maxBytes) {
  if (!res.body) return Buffer.alloc(0);
  const chunks = [];
  let n = 0;
  for await (const c of res.body) {
    n += c.length;
    if (n > maxBytes) { try { await res.body.cancel?.(); } catch { /* gone */ } throw new GitHubError(0, `GitHub's answer is larger than ${maxBytes} bytes`); }
    chunks.push(Buffer.from(c));
  }
  return Buffer.concat(chunks);
}

/**
 * A GitHub REST client. `token` is a string or a function read on every call; `base` defaults to GITHUB_API_URL or
 * https://api.github.com. Methods: call(method, path, body?, opts) → { status, headers, body: Buffer },
 * json(method, path, body?, opts) (GitHubError when not 2xx), get(path, opts), paginate(path, { key, maxPages, maxItems }).
 */
export function createGitHub({ token = githubToken, base = apiBaseFromEnv(), userAgent = 'axf-cli', timeoutMs = 30_000, maxBytes = DEFAULT_MAX_BYTES, tokenHint = 'GITHUB_TOKEN', fetchImpl = fetch } = {}) {
  const root = String(base).replace(/\/+$/, '');
  if (!targetOk(root)) throw new Error('GitHub API base must be https (plain http only on this machine)');
  const tok = () => { try { return String((typeof token === 'function' ? token() : token) ?? '').trim(); } catch { return ''; } };
  const urlOf = (path) => (/^[a-z][a-z0-9+.-]*:/i.test(path) ? path : `${root}/${String(path).replace(/^\/+/, '')}`);

  async function call(method, path, body, { auth = true, timeoutMs: t = timeoutMs, maxBytes: cap = maxBytes } = {}) {
    const t0 = tok();
    if (auth && !t0) throw new GitHubError(0, `No GitHub token: set ${tokenHint}`);
    const url = urlOf(path);
    if (!tokenAllowed(url, root)) throw new GitHubError(0, 'refused: that URL isn\'t on the GitHub API');
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        redirect: 'manual',
        headers: { Accept: ACCEPT, 'X-GitHub-Api-Version': API_VERSION, 'User-Agent': userAgent, ...(t0 ? { Authorization: `Bearer ${t0}` } : {}), ...(body !== undefined && body !== null ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(t),
      });
    } catch (e) {
      throw new GitHubError(0, `GitHub not reachable: ${scrub(e?.cause?.message || e?.message || e, [t0]).slice(0, 200)}`);
    }
    const buf = await readCapped(res, cap);
    return { status: res.status, headers: res.headers, body: buf, url };
  }
  const message = (r) => {
    try { const d = JSON.parse(r.body.toString('utf8')); return typeof d?.message === 'string' ? scrub(d.message, [tok()]).slice(0, 200) : ''; } catch { return scrub(r.body.toString('utf8').slice(0, 200), [tok()]); }
  };
  async function json(method, path, body, opts) {
    const r = await call(method, path, body, opts);
    if (r.status < 200 || r.status >= 300) {
      const redirect = r.status >= 300 && r.status < 400;
      throw new GitHubError(r.status, `GitHub ${r.status}: ${message(r) || (redirect ? 'redirects aren\'t followed' : 'request failed')}`);
    }
    const text = r.body.toString('utf8');
    if (!text.trim()) return null;
    try { return JSON.parse(text); } catch { throw new GitHubError(r.status, `GitHub ${r.status}: the answer isn't JSON`); }
  }
  async function paginate(path, { key, maxPages = 10, maxItems = 1000, ...opts } = {}) {
    const out = [];
    let url = path;
    for (let i = 0; i < Math.max(1, maxPages) && url; i++) {
      const r = await call('GET', url, undefined, opts);
      if (r.status < 200 || r.status >= 300) throw new GitHubError(r.status, `GitHub ${r.status}: ${message(r) || 'request failed'}`);
      const d = JSON.parse(r.body.toString('utf8') || 'null');
      const items = key && d && typeof d === 'object' && !Array.isArray(d) ? d[key] : d;
      if (Array.isArray(items)) out.push(...items);
      if (out.length >= maxItems) return out.slice(0, maxItems);
      url = nextLink(r.headers.get('link'));
      if (url && !tokenAllowed(url, root)) break; // never follow a next page to another host
    }
    return out;
  }
  return { base: root, token: tok, hasToken: () => !!tok(), call, json, get: (path, opts) => json('GET', path, undefined, opts), paginate };
}

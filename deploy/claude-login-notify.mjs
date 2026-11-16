#!/usr/bin/env node
/**
 * claude-login-notify.mjs — a phone notification for every Claude login event on the VPS (build
 * builds-share-one-claude-login-write, Nov 14 2026, Brett: "I want a verification every time it uses the token... and
 * then a notification to tell me that it was successfully refreshed and changed.").
 *
 *   sign-in   a build starts on an account's login (claude-headless.sh, own_login): the token it will use is checked with
 *             Anthropic, the same call Claude Code makes itself (GET /api/oauth/profile with the access token; an API
 *             key: GET /v1/models). Nothing is spent. → ok | renews (access token expired, Claude renews it from the
 *             shared refresh token on its first call; the refresh alert follows) | failed | unchecked (no answer)
 *   refresh   a renewed token was seen and written back (claude-token-save.mjs): the shared credentials file and every
 *             store written are read back and must hold the new token → ok | failed
 *
 * Every event: one login-event@1 line in <headless dir>/login-events.jsonl (account, build, result; never a credential)
 * and one console alert (source "claude-login", key claude-login:<kind>:<ok|failed>:<account>:<build>:<time>), so each
 * event is its own AmberX phone push (types in the Claude accounts plugin's notify.json).
 *
 *   node deploy/claude-login-notify.mjs verify --dir <build folder> --session <name> [--build <id>]
 *   node deploy/claude-login-notify.mjs recent [--n 20] [--json]
 *
 * Off switches: AXF_LOGIN_NOTIFY=off (no alert; the log line stays), AXF_LOGIN_VERIFY=off (no network check).
 * Where alerts go: AXF_LOGIN_NOTIFY_CMD (a shell command that gets the alert JSON on stdin; tests), else the console
 * container (AXF_PIPELINE_CONSOLE, default axf-console) through docker exec + curl, like the dispatcher's alerts.
 * AXF_LOGIN_VERIFY_URL overrides https://api.anthropic.com (tests).
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'login-event@1';
export const SOURCE = 'claude-login';
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const str = (v, n = 300) => String(v ?? '').slice(0, n);
const slug = (s) => str(s, 80).replace(/[^A-Za-z0-9._-]/g, '-') || 'run';

export const eventsFile = (env = process.env) => join(env.AXF_HEADLESS_DIR || '/var/tmp/axf-headless', 'login-events.jsonl');

/** The alert for one event (pure: tests and the CLI use it). */
export function alertOf(ev) {
  const ok = ev.result === 'ok' || ev.result === 'renews' || ev.result === 'unchecked';
  const who = `${ev.account || '?'}${ev.build ? ` · ${ev.build}` : ''}`;
  const key = `${SOURCE}:${ev.kind}:${ok ? 'ok' : 'failed'}:${slug(ev.account)}:${slug(ev.build || '-')}:${Date.parse(ev.at) || Date.now()}`;
  const base = { source: SOURCE, key, link: '#/claude-accounts', meta: { kind: ev.kind, result: ev.result, account: ev.account || '', build: ev.build || '' } };
  if (ev.kind === 'signin') {
    if (ev.result === 'ok') return { ...base, severity: 'success', title: `Claude sign-in verified: ${who}`, body: str(`Token checked with Anthropic: OK.${ev.shared ? ' Shared account login.' : ''}`, 1500) };
    if (ev.result === 'renews') return { ...base, severity: 'info', title: `Claude sign-in: ${who}`, body: str(`Access token expired: Claude renews it from the shared login on its first call. A refresh alert follows.`, 1500) };
    if (ev.result === 'unchecked') return { ...base, severity: 'warning', title: `Claude sign-in not verified: ${who}`, body: str(`Anthropic did not answer the check (${ev.detail || 'no answer'}). The build runs anyway.`, 1500) };
    return { ...base, severity: 'error', title: `Claude sign-in FAILED: ${who}`, body: str(`${ev.detail || 'the token was refused'}. The build will stop on it: sign the account in again (Claude accounts → ${ev.account || 'the account'} → Sign in).`, 1500) };
  }
  if (ok) return { ...base, severity: 'success', title: `Claude token refreshed: ${ev.account || '?'}`, body: str(`New token saved to the shared login file${ev.saved ? ` and ${ev.saved} other store${ev.saved === 1 ? '' : 's'}` : ''}, read back OK.${ev.build ? ` Seen by ${ev.build}.` : ''}`, 1500) };
  return { ...base, severity: 'error', title: `Claude token refresh NOT saved: ${ev.account || '?'}`, body: str(`${ev.detail || 'the new token could not be written back'}${ev.build ? ` (seen by ${ev.build})` : ''}. Builds on this account may stop at their next renewal.`, 1500) };
}

/** Send one alert to the console (or AXF_LOGIN_NOTIFY_CMD). Never throws; false = not sent. */
export function postAlert(alert, env = process.env) {
  if (env.AXF_LOGIN_NOTIFY === 'off') return false;
  const body = JSON.stringify(alert);
  if (env.AXF_LOGIN_NOTIFY_CMD) {
    const r = spawnSync('sh', ['-c', env.AXF_LOGIN_NOTIFY_CMD], { input: body, timeout: 20e3 });
    return !r.error && r.status === 0;
  }
  const name = env.AXF_PIPELINE_CONSOLE || 'axf-console';
  if (name === 'off') return false;
  const cmd = `curl -s -m 10 -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" --data-binary @- "http://127.0.0.1:${env.AXF_CONSOLE_PORT || 7090}/api/alerts" >/dev/null`;
  const r = spawnSync('docker', ['exec', '-i', name, 'sh', '-c', cmd], { input: body, timeout: 20e3 });
  return !r.error && r.status === 0;
}

/** Record one login event and push it to the phone. Returns the event (with `sent`). Never throws. */
export function record(ev, env = process.env) {
  const e = { $axf: SCHEMA, at: new Date().toISOString(), kind: ev.kind === 'refresh' ? 'refresh' : 'signin', account: str(ev.account, 40), build: str(ev.build, 120),
    result: str(ev.result, 20), detail: str(ev.detail, 300), ...(ev.saved != null ? { saved: Number(ev.saved) || 0 } : {}), ...(ev.shared != null ? { shared: !!ev.shared } : {}) };
  let sent = false;
  try { sent = postAlert(alertOf(e), env); } catch { /* the log line still says it */ }
  try { mkdirSync(resolve(eventsFile(env), '..'), { recursive: true }); appendFileSync(eventsFile(env), `${JSON.stringify({ ...e, sent })}\n`); } catch { /* best effort */ }
  return { ...e, sent };
}

/** The last n login events (newest last). */
export function recent(n = 20, env = process.env) {
  try { return readFileSync(eventsFile(env), 'utf8').trim().split('\n').filter(Boolean).slice(-n).map((l) => JSON.parse(l)); } catch { return []; }
}

/**
 * Check the token a build is about to use. `login` = { config, kind, token (bool) } from the build's marker; the token
 * itself is read from the config dir / token.env here and only ever sent to Anthropic.
 */
export async function verifyToken({ config, buildDir = '', kind = 'subscription' } = {}, env = process.env) {
  if (env.AXF_LOGIN_VERIFY === 'off') return { result: 'unchecked', detail: 'verification off' };
  const base = (env.AXF_LOGIN_VERIFY_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const envFile = buildDir ? readTokenEnv(join(buildDir, 'token.env')) : {};
  let url; let headers;
  if (kind === 'api' || envFile.ANTHROPIC_API_KEY) {
    if (!envFile.ANTHROPIC_API_KEY) return { result: 'failed', detail: 'no API key saved for this account' };
    url = `${base}/v1/models?limit=1`; headers = { 'x-api-key': envFile.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' };
  } else {
    let access = envFile.CLAUDE_CODE_OAUTH_TOKEN || '';
    if (!access) {
      const o = readJson(join(config || '', '.credentials.json'))?.claudeAiOauth;
      if (!o?.accessToken && !o?.refreshToken) return { result: 'failed', detail: 'no Claude login in the credentials file' };
      if (o.expiresAt && o.expiresAt <= Date.now() + 60e3) return o.refreshToken ? { result: 'renews', detail: 'access token expired' } : { result: 'failed', detail: 'access token expired and no refresh token' };
      access = o.accessToken;
    }
    url = `${base}/api/oauth/profile`; headers = { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' };
  }
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(10e3) });
    if (r.ok) return { result: 'ok', detail: `HTTP ${r.status}` };
    if (r.status === 401 || r.status === 403) return { result: 'failed', detail: `Anthropic refused the token (HTTP ${r.status})` };
    return { result: 'unchecked', detail: `HTTP ${r.status}` };
  } catch (e) { return { result: 'unchecked', detail: str(e?.cause?.code || e?.name || e?.message, 80) }; }
}

function readTokenEnv(file) {
  const out = {};
  let t = ''; try { t = readFileSync(file, 'utf8'); } catch { return out; }
  for (const m of t.matchAll(/^export (CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)='((?:[^']|'\\'')*)'$/gm)) out[m[1]] = m[2].replace(/'\\''/g, "'");
  return out;
}

/** Verify one build's login (its folder from claude-login.mjs) and record the sign-in event. */
export async function verifyBuild({ dir, session, build = '' } = {}, env = process.env) {
  const { loginDir, MARKER } = await import('./claude-login.mjs');
  const out = loginDir(dir, session);
  const m = readJson(join(out, MARKER));
  if (m?.$axf !== 'build-login@1') return record({ kind: 'signin', account: '', build: build || session, result: 'failed', detail: 'no build login to verify' }, env);
  const v = await verifyToken({ config: m.config || out, buildDir: out, kind: m.kind }, env);
  return record({ kind: 'signin', account: m.account, build: build || session, result: v.result, detail: v.detail, shared: !!m.config }, env);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n, d = '') => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : d; };
  if (cmd === 'verify' && flag('dir') && flag('session')) {
    const e = await verifyBuild({ dir: flag('dir'), session: flag('session'), build: flag('build') });
    console.log(`${e.kind} ${e.account || '?'} ${e.build}: ${e.result}${e.detail ? ` (${e.detail})` : ''}${e.sent ? ' · phone notified' : ''}`);
    process.exit(e.result === 'failed' ? 1 : 0);
  } else if (cmd === 'recent') {
    const l = recent(Number(flag('n', '20')) || 20);
    if (rest.includes('--json')) console.log(JSON.stringify({ ok: true, events: l }));
    else console.log(l.map((e) => `${e.at} ${e.kind.padEnd(7)} ${String(e.account).padEnd(14)} ${e.result.padEnd(9)} ${e.build}${e.detail ? ` · ${e.detail}` : ''}`).join('\n') || 'no login events yet');
  } else {
    console.error('usage: claude-login-notify.mjs verify --dir <build folder> --session <name> [--build <id>] | recent [--n 20] [--json]');
    process.exit(2);
  }
}

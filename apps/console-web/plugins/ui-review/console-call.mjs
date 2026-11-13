/**
 * The UI Review CLIs' call to the running console (review.mjs and shots.mjs, `--console`): AXF_CONSOLE_URL + AXF_TOKEN,
 * Bearer header, never following a redirect. Every way it can fail gets a message that says what to fix: no token in
 * this session, the token refused (401 / 403), a web page instead of the API (wrong URL, or the request was stopped at
 * axHub's sign-in wall), the console unreachable.
 *
 *   import { consoleCall, consoleEnv } from './console-call.mjs';
 *   await consoleCall('submit', body)            // POST /api/plugins/ui-review/submit
 *   await consoleCall('items?status=open')       // GET
 *
 * Failures throw an Error with `.code` (`no-token` | `unauthorized` | `not-api` | `unreachable` | `http`) and `.status`.
 *
 * reported(call, { what, markerDir }) wraps a call so a failure is never silent: it writes `<markerDir>/submit-failed.json`
 * (the console's ui-review-stuck health check reads it from build worktrees: red systems check banner item + one phone
 * alert) and, when the console still takes the token, raises a console alert at once (POST /api/alerts, key
 * ui-review:submit-failed:<session>). A later success removes the marker.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PREFIX = '/api/plugins/ui-review/';

/** { url, token } from the environment (either may be ''). */
export function consoleEnv(env = process.env) {
  return { url: String(env.AXF_CONSOLE_URL ?? '').trim().replace(/\/+$/, ''), token: String(env.AXF_TOKEN ?? '').trim() };
}

const fail = (code, message, status = 0) => Object.assign(new Error(message), { code, status });

export async function consoleCall(path, body, { env = process.env, fetch: f = globalThis.fetch, timeoutMs = 120_000 } = {}) {
  const { url, token } = consoleEnv(env);
  if (!url || !token) {
    throw fail('no-token', `--console needs AXF_CONSOLE_URL and AXF_TOKEN (missing: ${[!url && 'AXF_CONSOLE_URL', !token && 'AXF_TOKEN'].filter(Boolean).join(', ')}). `
      + 'Headless builds get both from deploy/claude-headless.sh; a session started another way needs them exported.');
  }
  let r;
  try {
    r = await f(`${url}${PREFIX}${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw fail('unreachable', `can't reach the console at ${url} (${e?.message ?? e})`);
  }
  const json = (r.headers?.get?.('content-type') ?? '').includes('json');
  const j = json ? await r.json().catch(() => ({})) : {};
  if (r.status === 401 || r.status === 403) {
    throw fail('unauthorized', `console ${r.status}: the console token was refused (AXF_TOKEN is wrong or was reset). `
      + 'The launcher reads it from the console env file; a reset there reaches the next build.', r.status);
  }
  if ((r.status >= 300 && r.status < 400) || (r.ok && !json)) {
    throw fail('not-api', `console answered ${r.status} with a web page, not the API: AXF_CONSOLE_URL (${url}) is wrong, or the request stopped at axHub's sign-in wall`, r.status);
  }
  if (!r.ok) throw fail('http', `console ${r.status}: ${typeof j.detail === 'string' ? j.detail : r.statusText || 'failed'}`, r.status);
  return j;
}

export const MARKER = 'submit-failed.json';

/** Raise the failure as a console alert (best effort: a refused or missing token can't, the marker covers that). */
export async function raiseAlert(err, what, { env = process.env, fetch: f = globalThis.fetch } = {}) {
  const { url, token } = consoleEnv(env);
  if (!url || !token || err?.code === 'unauthorized' || err?.code === 'no-token') return false;
  const who = String(env.AXF_BUILD_ID || env.AXF_SESSION || 'session').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 80);
  try {
    const r = await f(`${url}/api/alerts`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'ui-review', severity: 'error', key: `ui-review:submit-failed:${who}`, link: 'view:ui-review',
        title: `UI Review ${what || 'submit'} failed (${who})`.slice(0, 120), body: String(err?.message ?? err).slice(0, 900) }),
    });
    return r.ok;
  } catch { return false; }
}

/** Run a console call; on failure leave the marker + raise the alert, then rethrow. On success clear the marker. */
export async function reported(call, { what = 'submit', markerDir = '', env = process.env, fetch: f = globalThis.fetch } = {}) {
  try {
    const out = await call();
    if (markerDir) rmSync(join(markerDir, MARKER), { force: true });
    return out;
  } catch (e) {
    if (markerDir) {
      try {
        mkdirSync(markerDir, { recursive: true });
        writeFileSync(join(markerDir, MARKER), JSON.stringify({ at: new Date().toISOString(), what, code: e?.code || 'error', reason: String(e?.message ?? e).slice(0, 300), build: env.AXF_BUILD_ID || '' }, null, 2) + '\n');
      } catch { /* the alert below still goes */ }
    }
    await raiseAlert(e, what, { env, fetch: f });
    throw e;
  }
}

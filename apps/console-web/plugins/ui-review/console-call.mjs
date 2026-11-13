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
 */

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

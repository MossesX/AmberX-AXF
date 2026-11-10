#!/usr/bin/env node
/**
 * claude-account-check.mjs — is a saved Claude account usable right now? (build test-button-on-every-claude-account-subscription,
 * Nov 10 2026). Runs only when someone asks (the Test / Test all buttons, the console API, MCP, CLI or voice): never on
 * console start and never before a launch (Brett, Nov 9 2026: "The orchestrator doesn't test before he runs the build.
 * If the build fails, that's the check.").
 *
 *   node deploy/claude-account-check.mjs check <name> [--models opus,fable] [--json]
 *
 * One tiny no-tool call per model: `claude -p` with a one-line system prompt, no tools, no MCP, safe mode (no hooks,
 * CLAUDE.md or plugins), no session saved, on a private copy of the account's login (deploy/claude-login.mjs snapshot,
 * released at once so a token refresh is carried back to every store of that login). No AI build, a few tokens.
 * The second model is only tried when the first says nothing about the account itself (the login or key works, or only
 * that model is unavailable), so a dead login costs one call.
 *
 * Answer (account-check@1, never a credential):
 *   { $axf, name, kind: subscription|api, state, models: { opus: ok|unavailable|…, fable: … }, detail, until, at, ms }
 *   state: alive | expired (login needs signing in again) | bad-key (API key refused) | no-credit (API credit used up)
 *          | limit (usage limit hit; `until` when Claude said) | unknown-account | error (anything else; see detail)
 * Paths: claude-login.mjs's AXF_CLAUDE_ACCOUNTS etc. AXF_CHECK_DIR (default /var/tmp/axf-account-check) holds the
 * short-lived login copies. AXF_CHECK_CLAUDE replaces the claude binary (tests). Exit 0 answered, 2 bad usage.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accounts, childEnv, release, snapshot } from './claude-login.mjs';
import { parseReset } from './claude-workers.mjs';

export const SCHEMA = 'account-check@1';
export const MODELS = ['opus', 'fable'];
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const TIMEOUT_MS = 60_000;
const PROMPT = 'Reply with the single word OK.';

const NO_CREDIT = /credit balance is too low|out of credits|insufficient (?:credit|balance)|billing/i;
const LIMIT = /hit your (?:weekly |daily |session |5-hour |opus |fable )?limit|usage limit|rate[ _]limit|limit reached|\b429\b|overloaded_error/i;
const AUTH = /invalid api key|invalid x-api-key|authentication_error|failed to authenticate|oauth (?:token|session) (?:has )?expired|(?:token|session) (?:has )?expired|could not be refreshed|please run \/login|not logged in|\b401\b|unauthori[sz]ed|revoked/i;
const MODEL = /not_found_error|model[^\n]{0,80}(?:not (?:found|available|supported)|does not exist|isn't available|is not available)|invalid model|no access to (?:the )?model|permission_error/i;

/** What one call's output says: ok, expired, bad-key, no-credit, limit, unavailable (this model only) or error. */
export function classify({ status = 0, stdout = '', stderr = '', timedOut = false } = {}, kind = 'subscription') {
  let res = null;
  try { res = JSON.parse(String(stdout).trim().split('\n').pop() || 'null'); } catch { /* not JSON */ }
  const text = `${res && typeof res === 'object' ? String(res.result ?? '') : String(stdout)}\n${stderr}`;
  if (timedOut) return { result: 'error', detail: `no answer in ${TIMEOUT_MS / 1000} s` };
  if (status === 0 && res && res.is_error === false) return { result: 'ok', detail: '' };
  const detail = text.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (NO_CREDIT.test(text)) return { result: kind === 'api' ? 'no-credit' : 'limit', detail };
  if (LIMIT.test(text)) return { result: 'limit', detail };
  if (AUTH.test(text)) return { result: kind === 'api' ? 'bad-key' : 'expired', detail };
  if (MODEL.test(text)) return { result: 'unavailable', detail };
  return { result: 'error', detail: detail || `claude exited ${status}` };
}

/** One account's overall state from its per-model results (models in the order they ran). */
export function overall(results) {
  const vals = Object.values(results);
  if (vals.some((r) => r.result === 'ok')) return 'alive';
  for (const s of ['expired', 'bad-key', 'no-credit', 'limit']) if (vals.some((r) => r.result === s)) return s;
  return 'error';
}

/** A result that speaks for the account, not the model: no point asking the next model. */
const accountWide = (r) => ['expired', 'bad-key', 'no-credit'].includes(r);

function runClaude(model, env, cwd) {
  const bin = env.AXF_CHECK_CLAUDE || 'claude';
  const args = ['-p', PROMPT, '--model', model, '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--safe-mode',
    '--no-session-persistence', '--system-prompt', PROMPT];
  const r = spawnSync(bin, args, { cwd, env, encoding: 'utf8', timeout: TIMEOUT_MS, input: '' });
  return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || (r.error ? String(r.error.message) : ''), timedOut: r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM' };
}

/** Check one saved account. `run` stands in for the claude call in tests. */
export function check(name, { models = MODELS, env = process.env, now = () => Date.now(), run = runClaude } = {}) {
  if (!NAME_RE.test(name || '')) throw Object.assign(new Error(`not an account name: ${name}`), { code: 2 });
  const started = now();
  const at = new Date(started).toISOString();
  const acc = accounts(env).find((a) => a.name === name);
  if (!acc) return { $axf: SCHEMA, name, kind: '', state: 'unknown-account', models: {}, detail: `No saved login or key called ${name} on the VPS.`, until: '', at, ms: 0 };
  const base = env.AXF_CHECK_DIR || '/var/tmp/axf-account-check';
  const work = join(base, name);
  mkdirSync(work, { recursive: true, mode: 0o700 });
  const session = `check-${name}`;
  const results = {};
  let snap;
  try {
    snap = snapshot({ dir: work, session, account: name, env });
    const childenv = { ...childEnv(snap, env), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
    for (const m of models) {
      results[m] = classify(run(m, childenv, work), acc.kind);
      if (accountWide(results[m].result)) break;
    }
  } catch (e) {
    return { $axf: SCHEMA, name, kind: acc.kind, state: 'error', models: {}, detail: String(e.message).slice(0, 200), until: '', at, ms: now() - started };
  } finally {
    if (snap) try { release({ dir: work, session }); } catch { /* the copy goes with the next check */ }
  }
  const state = overall(results);
  const bad = Object.values(results).find((r) => r.result === state) ?? Object.values(results).find((r) => r.detail);
  const until = state === 'limit' ? (parseReset(bad?.detail ?? '', started) ? new Date(parseReset(bad.detail, started)).toISOString() : '') : '';
  return { $axf: SCHEMA, name, kind: acc.kind, state, models: Object.fromEntries(Object.entries(results).map(([m, r]) => [m, r.result])),
    detail: state === 'alive' ? '' : bad?.detail ?? '', until, at, ms: now() - started };
}

const LABEL = { alive: 'alive', expired: 'login expired', 'bad-key': 'bad key', 'no-credit': 'out of credits', limit: 'limit hit', 'unknown-account': 'no such account', error: 'check failed' };
export const line = (r) => `${r.name}: ${LABEL[r.state] ?? r.state}${Object.keys(r.models).length ? ` · ${Object.entries(r.models).map(([m, v]) => `${m} ${v}`).join(', ')}` : ''}${r.until ? ` · until ${r.until}` : ''}${r.detail ? ` · ${r.detail}` : ''}`;

const main = () => {
  const [cmd, name, ...rest] = process.argv.slice(2);
  const flag = (n, d = '') => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : d; };
  try {
    if (cmd !== 'check') throw Object.assign(new Error('usage: claude-account-check.mjs check <name> [--models opus,fable] [--json]'), { code: 2 });
    const models = flag('models', MODELS.join(',')).split(',').map((m) => m.trim().toLowerCase()).filter((m) => MODELS.includes(m));
    const r = check(name, { models: models.length ? models : MODELS });
    console.log(rest.includes('--json') ? JSON.stringify(r) : line(r));
  } catch (e) { console.error(`claude-account-check: ${e.message}`); process.exit(2); }
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

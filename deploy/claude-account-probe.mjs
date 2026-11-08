#!/usr/bin/env node
/**
 * claude-account-probe.mjs — the account health check (build account-health-failover, Nov 8 2026, Brett: "On console
 * load and on a schedule, the orchestrator probes EVERY Claude account (subscriptions + API keys): a tiny headless
 * session with a minimal brief, NO rules, NO CLAUDE.md, no MCP. … Keep probe cost near zero.").
 *
 * Subscription login (OAuth, or a saved setup token):
 *   1. a tiny headless session on a private copy of the login (claude-login.mjs snapshot) with every shared link taken
 *      out: no CLAUDE.md, no settings or hooks, no MCP servers, no tools, a one-line system prompt, an empty cwd, no
 *      session saved: `claude -p "Reply OK." --model opus --tools "" --strict-mcp-config --setting-sources ""`. About
 *      360 input tokens (≈ $0.0015 at list price, nothing extra on a subscription). It proves the login works, renews
 *      the token if it was due (the renewal goes home: claude-login.mjs release → the login's one home) and reports the
 *      rate-limit window that is closest to its limit.
 *   2. two free reads with the (renewed) token: /api/oauth/usage (5-hour and weekly use, resets, per-model weekly caps,
 *      extra-usage credits) and /v1/models (which models it can use).
 * API key: the free /v1/models (proves the key, lists models) and, with apiMessage on, a 1-token message on Opus
 *   (about $0.0001) that is the only way to see "credit balance is too low". Anthropic has no balance API, so "credits
 *   left" for a key is the last-known spend against its daily / weekly cap (claude-workers status).
 *
 * Each account's result goes into the ONE shared store (deploy/account-status.mjs, account-status@1). An account that
 * comes back ok leaves worker-state's limits (its problem alert closes); one that turned expired / limited / out of
 * credits gets one phone alert (account-alerts.mjs, type claude-accounts.problem). With notifyRuns on, a phone
 * notification goes before the check ("checking 4 accounts") and after it (one line per account), type account-status.
 *
 *   node deploy/claude-account-probe.mjs run [--trigger load|schedule|manual] [--account a,b] [--background] [--json] [--no-notify]
 *   node deploy/claude-account-probe.mjs due        the minute sweep: starts a check the console asked for (account-probe-request.json),
 *                                                   else a scheduled one when it is due, in the background
 *   node deploy/claude-account-probe.mjs show [--json]   the store (same as account-status.mjs show)
 *
 * Exit 0 ok (also: skipped, with why), 2 bad usage. Never prints a credential. Paths: claude-login.mjs / claude-workers.mjs
 * ones, AXF_PROBE_DIR (where login copies live while a check runs, default /var/tmp/axf-probe), AXF_PROBE_CLAUDE (the
 * claude binary), AXF_PROBE_API (API base URL, tests), AXF_ACCOUNT_ALERTS (see account-alerts.mjs).
 */
import { spawn } from 'node:child_process';
import { appendFileSync, chmodSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Health from './account-status.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const PROMPT = 'Reply with the single word OK.';
const SYSTEM = 'You are a login health check. Reply OK.';
const OPUS_ID = 'claude-opus-5-5';
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const api = (env) => (env.AXF_PROBE_API || 'https://api.anthropic.com').replace(/\/+$/, '');
const probeDir = (env) => env.AXF_PROBE_DIR || '/var/tmp/axf-probe';
const iso = (t) => (t ? new Date(t).toISOString() : '');

/** Lines of `claude -p --output-format stream-json --verbose` → what the check needs. */
export function parseSession(stdout = '', stderr = '', exit = 0) {
  const out = { ok: false, text: '', costUsd: 0, inputTokens: 0, model: '', rate: [], isError: false, errorText: '' };
  for (const l of String(stdout).split('\n')) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.type === 'assistant') {
      const t = (o.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      out.text += t; out.model = o.message?.model || out.model;
      if (o.error || o.message?.model === '<synthetic>') { out.isError = true; out.errorText += ` ${t}`; }
    } else if (o.type === 'rate_limit_event' && o.rate_limit_info) {
      const r = o.rate_limit_info;
      out.rate.push({ type: String(r.rateLimitType || ''), status: String(r.status || ''), used: Number.isFinite(Number(r.utilization)) ? Number(r.utilization) * 100 : null, resetsAt: r.resetsAt ? iso(Number(r.resetsAt) * 1000) : '', overage: String(r.overageDisabledReason || '') });
    } else if (o.type === 'result' || (o.usage && o.total_cost_usd !== undefined)) {
      out.costUsd = Number(o.total_cost_usd) || 0;
      out.inputTokens = Number(o.usage?.input_tokens) || 0;
      if (o.is_error) { out.isError = true; if (o.result && !out.errorText.includes(String(o.result).trim())) out.errorText += ` ${o.result}`; }
    }
  }
  out.ok = exit === 0 && !out.isError && /\bok\b/i.test(out.text);
  out.errorText = `${out.errorText} ${out.ok ? '' : String(stderr).slice(-2000)}`.trim();
  return out;
}

/** /api/oauth/usage → usage (account-status@1 shape). Utilization there is 0-100. */
export function parseUsage(u) {
  if (!u || typeof u !== 'object') return null;
  const w = (x) => (x && Number.isFinite(Number(x.utilization)) ? { used: Number(x.utilization), resetsAt: x.resets_at || '' } : null);
  const perModel = [];
  for (const l of Array.isArray(u.limits) ? u.limits : []) {
    const m = l?.scope?.model?.display_name || l?.scope?.model?.id;
    if (l?.kind === 'weekly_scoped' && m) perModel.push({ model: String(m).toLowerCase(), used: Number(l.percent) || 0, resetsAt: l.resets_at || '' });
  }
  for (const [k, m] of [['seven_day_opus', 'opus'], ['seven_day_fable', 'fable']]) if (u[k] && !perModel.some((p) => p.model === m)) perModel.push({ model: m, used: Number(u[k].utilization) || 0, resetsAt: u[k].resets_at || '' });
  const x = u.extra_usage;
  const dp = 10 ** (Number(x?.decimal_places) || 0);
  return {
    fiveHour: w(u.five_hour), weekly: w(u.seven_day), perModel,
    extra: x && typeof x === 'object' ? { enabled: !!x.is_enabled, usedUsd: (Number(x.used_credits) || 0) / dp, limitUsd: (Number(x.monthly_limit) || 0) / dp } : null,
  };
}

/** The rate-limit events of a session as usage windows (the fallback when the usage read isn't allowed, e.g. a setup token). */
export function usageFromRate(rate = []) {
  const pick = (re) => rate.filter((r) => re.test(r.type) && r.used !== null).at(-1);
  const f = pick(/^five_hour$/); const s = pick(/^seven_day$/);
  const perModel = rate.filter((r) => /^seven_day_/.test(r.type) && r.used !== null).map((r) => ({ model: r.type.replace(/^seven_day_/, ''), used: r.used, resetsAt: r.resetsAt }));
  return { fiveHour: f ? { used: f.used, resetsAt: f.resetsAt } : null, weekly: s ? { used: s.used, resetsAt: s.resetsAt } : null, perModel, extra: null };
}

/**
 * Everything one check saw → { status, why, until, warn, models }. `hit` = claude-workers hitOf on the session's words
 * (auth | usage | credits | '').
 */
export function classify({ session = null, hit = '', usage = null, usageStatus = 0, modelIds = null, modelsStatus = 0, now = Date.now() } = {}) {
  const windows = [['5-hour', usage?.fiveHour], ['weekly', usage?.weekly]].filter(([, x]) => x);
  const full = windows.filter(([, x]) => x.used >= 100).sort((a, b) => Date.parse(b[1].resetsAt || 0) - Date.parse(a[1].resetsAt || 0))[0];
  const rejected = (session?.rate ?? []).find((r) => r.status === 'rejected');
  const warn = windows.some(([, x]) => x.used >= 80) || (session?.rate ?? []).some((r) => r.status === 'allowed_warning');
  let models = Array.isArray(modelIds) ? Health.policyModels(modelIds) : (session?.ok ? null : null);
  if (models) for (const p of usage?.perModel ?? []) if (p.used >= 100) models = models.filter((m) => m !== p.model);
  if (hit === 'auth' || ((usageStatus === 401 || modelsStatus === 401) && !session?.ok)) return { status: 'expired', why: authWhy(session?.errorText), until: '', warn: false, models: [] };
  if (hit === 'credits') return { status: 'no-credits', why: oneLine(session?.errorText) || 'out of credits', until: '', warn: false, models: [] };
  if (hit === 'usage' || rejected || full) {
    const until = full?.[1]?.resetsAt || rejected?.resetsAt || '';
    return { status: 'limited', why: full ? `${full[0]} limit used up` : rejected ? `${rejected.type.replace(/_/g, '-')} limit reached` : oneLine(session?.errorText) || 'usage limit reached', until, warn: true, models };
  }
  if (session && !session.ok) return { status: 'unknown', why: oneLine(session.errorText) || 'the check session did not answer', until: '', warn, models };
  const near = windows.filter(([, x]) => x.used >= 80).map(([n, x]) => `${n} ${Math.round(x.used)}% used`).join(', ');
  return { status: 'ok', why: near || (session ? 'answered' : 'key works'), until: '', warn, models };
}

/** A refused login in plain words (the alert title has room for about 60 characters of it). */
export function authWhy(t) {
  const x = String(t || '');
  if (/could not be refreshed|(?:session|token) (?:has )?expired|invalid_grant|revoked/i.test(x)) return 'login expired and could not be renewed';
  if (/invalid (?:x-)?api[ -]key/i.test(x)) return 'API key refused';
  if (/not logged in|please run \/login/i.test(x)) return 'signed out';
  return oneLine(x) || 'the login was refused';
}

const oneLine = (t) => String(t || '').replace(/sk-ant-[\w-]+/g, '[key]').replace(/\s+/g, ' ').trim().slice(0, 200);

async function getJson(url, headers, fetchImpl, timeoutMs = 15_000) {
  try {
    const r = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    let body = null; try { body = await r.json(); } catch { /* not JSON */ }
    return { status: r.status, body };
  } catch (e) { return { status: 0, body: null, error: String(e?.message || e).slice(0, 120) }; }
}

/** Run claude with a timeout; resolves { exit, stdout, stderr, ms }. */
function runClaude(bin, args, opts, timeoutMs) {
  return new Promise((res) => {
    const t0 = Date.now(); let stdout = ''; let stderr = ''; let done = false;
    let child;
    try { child = spawn(bin, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { res({ exit: 127, stdout: '', stderr: String(e.message), ms: 0 }); return; }
    const kill = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const end = (exit) => { if (done) return; done = true; clearTimeout(kill); res({ exit, stdout, stderr, ms: Date.now() - t0 }); };
    child.on('error', (e) => { stderr += String(e.message); end(127); });
    child.on('close', (code, sig) => end(sig ? 124 : code ?? 1));
  });
}

/** A login copy for the check with every shared link removed: no CLAUDE.md, settings, hooks, plugins or MCP servers. */
function bareCopy(L, name, env) {
  const base = probeDir(env);
  mkdirSync(base, { recursive: true, mode: 0o700 }); chmodSync(base, 0o700);
  const snap = L.snapshot({ dir: base, session: `probe-${name}`, account: name, env });
  for (const n of readdirSync(snap.dir)) { const f = join(snap.dir, n); try { if (lstatSync(f).isSymbolicLink()) unlinkSync(f); } catch { /* raced */ } }
  const g = readJson(join(snap.dir, '.claude.json'));
  if (g && typeof g === 'object') {
    for (const k of ['mcpServers', 'projects', 'oauthAccount']) delete g[k];
    writeFileSync(join(snap.dir, '.claude.json'), JSON.stringify(g), { mode: 0o600 });
  }
  mkdirSync(join(base, 'cwd'), { recursive: true, mode: 0o700 });
  return snap;
}

/** Check one subscription account. */
export async function probeSubscription(row, cfg, { env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  const L = await import('./claude-login.mjs');
  const W = await import('./claude-workers.mjs');
  const t0 = Date.now();
  let session = null; let hit = ''; let access = ''; let expiresAt = '';
  let snap = null;
  try {
    snap = bareCopy(L, row.name, env);
    if (cfg.session) {
      const e = L.childEnv(snap, env);
      for (const k of Object.keys(e)) if (/^CLAUDECODE$|^CLAUDE_CODE_(ENTRYPOINT|SSE_PORT|SESSION)|^AXF_(SESSION|SURFACE)$|^MCP_/.test(k)) delete e[k];
      e.PATH = `${join(homedir(), '.local', 'bin')}:${e.PATH || '/usr/bin:/bin'}`;
      const args = ['-p', PROMPT, '--model', 'opus', '--output-format', 'stream-json', '--verbose', '--tools', '', '--strict-mcp-config', '--setting-sources', '',
        '--system-prompt', SYSTEM, '--no-session-persistence', '--max-turns', '1'];
      const r = await runClaude(env.AXF_PROBE_CLAUDE || 'claude', args, { cwd: join(probeDir(env), 'cwd'), env: e }, cfg.timeoutSec * 1000);
      session = parseSession(r.stdout, r.stderr, r.exit);
      hit = W.hitOf(`${session.errorText} ${r.stderr}`, session.ok ? 0 : (r.exit || 1));
      if (r.exit === 124 && !hit) session.errorText = `no answer in ${cfg.timeoutSec} s`;
    }
    const c = readJson(join(snap.dir, '.credentials.json'))?.claudeAiOauth;
    access = c?.accessToken || snap.env?.CLAUDE_CODE_OAUTH_TOKEN || '';
    expiresAt = c?.expiresAt ? iso(c.expiresAt) : '';
  } catch (e) {
    session = session ?? { ok: false, errorText: String(e?.message || e), rate: [], costUsd: 0, inputTokens: 0 };
  } finally {
    if (snap) try { L.release({ dir: probeDir(env), session: `probe-${row.name}` }); } catch { /* left for the next check */ }
  }
  let usage = null; let usageStatus = 0; let modelIds = null; let modelsStatus = 0;
  if (access && hit !== 'auth') {
    const h = { Authorization: `Bearer ${access}`, 'anthropic-beta': 'oauth-2025-04-20', 'anthropic-version': '2023-06-01' };
    const [u, m] = await Promise.all([getJson(`${api(env)}/api/oauth/usage`, h, fetchImpl), getJson(`${api(env)}/v1/models?limit=100`, h, fetchImpl)]);
    usageStatus = u.status; modelsStatus = m.status;
    if (u.status === 200) usage = parseUsage(u.body);
    if (m.status === 200 && Array.isArray(m.body?.data)) modelIds = m.body.data.map((x) => String(x.id));
  }
  if (!usage && session?.rate?.length) usage = usageFromRate(session.rate);
  const c = classify({ session, hit, usage, usageStatus, modelIds, modelsStatus, now });
  // a setup token can't read the model list: the session proved Opus; Fable stays "not known" (null = routing doesn't filter)
  return entryOf(row, c, { usage, modelIds, login: { valid: c.status === 'expired' ? false : session ? session.ok || null : null, expiresAt, hash: W.loginHashOf(row.name, env).slice(0, 16) },
    probe: { ms: Date.now() - t0, costUsd: session?.costUsd || 0, inputTokens: session?.inputTokens || 0, session: !!session } });
}

/** Check one API-key account. */
export async function probeApi(row, cfg, { env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  const L = await import('./claude-login.mjs');
  const t0 = Date.now();
  const spend = row.spend ? { spendDay: row.spend.day, spendWeek: row.spend.week, capDay: row.spend.dayCap, capWeek: row.spend.weekCap,
    left: row.spend.dayCap || row.spend.weekCap ? Math.max(0, Math.min(...[row.spend.dayCap ? row.spend.dayCap - row.spend.day : Infinity, row.spend.weekCap ? row.spend.weekCap - row.spend.week : Infinity])) : null } : null;
  let key = ''; try { key = readFileSync(join(L.paths(env).accounts, row.name, 'apikey'), 'utf8').trim(); } catch { /* none */ }
  if (!key) return entryOf(row, { status: 'unknown', why: 'no API key saved yet', until: '', warn: false, models: null }, { api: spend, probe: { ms: 0, costUsd: 0, inputTokens: 0, session: false } });
  const h = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  const m = await getJson(`${api(env)}/v1/models?limit=100`, h, fetchImpl);
  const modelIds = m.status === 200 && Array.isArray(m.body?.data) ? m.body.data.map((x) => String(x.id)) : null;
  let hit = ''; let text = ''; let costUsd = 0; let session = null;
  if (m.status === 401 || m.status === 403) { hit = 'auth'; text = `invalid api key: ${m.body?.error?.message || ''}`; }
  else if (m.status === 200 && cfg.apiMessage) {
    try {
      const r = await fetchImpl(`${api(env)}/v1/messages`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ model: OPUS_ID, max_tokens: 1, messages: [{ role: 'user', content: '.' }] }), signal: AbortSignal.timeout(cfg.timeoutSec * 1000) });
      let b = null; try { b = await r.json(); } catch { /* not JSON */ }
      text = b?.error?.message || '';
      if (r.status === 200) { costUsd = ((Number(b?.usage?.input_tokens) || 0) * 5 + (Number(b?.usage?.output_tokens) || 0) * 25) / 1e6; session = { ok: true, rate: [], errorText: '' }; }
      else if (/credit balance|billing|insufficient/i.test(text)) hit = 'credits';
      else if (r.status === 429) hit = 'usage';
      else if (r.status === 401 || r.status === 403) hit = 'auth';
    } catch (e) { text = String(e?.message || e); }
  } else if (m.status !== 200) text = m.error || `models list answered ${m.status}`;
  const c = hit ? classify({ session: { ok: false, errorText: text, rate: [] }, hit, modelIds: null, now })
    : m.status === 200 ? classify({ session, modelIds, now }) : { status: 'unknown', why: oneLine(text) || 'could not reach Anthropic', until: '', warn: false, models: null };
  if (hit === 'usage') c.until = new Date(now + 60e3).toISOString();
  if (spend?.left === 0 && c.status === 'ok') Object.assign(c, { why: 'at its spend cap (the router holds it back)', warn: true });
  return entryOf(row, c, { modelIds, api: spend, login: { valid: hit === 'auth' ? false : m.status === 200 ? true : null, expiresAt: '', hash: '' }, probe: { ms: Date.now() - t0, costUsd, inputTokens: costUsd ? 9 : 0, session: false } });
}

const entryOf = (row, c, extra) => ({ name: row.name, label: row.label || '', kind: row.kind === 'api' ? 'api' : 'subscription', email: row.email || '',
  status: c.status, why: c.why, until: c.until, warn: !!c.warn, models: c.models, source: 'probe', ...extra });

/** The phone notifications of one check (account-status type). */
export function startAlert(run, rows) {
  return { source: 'claude-accounts', severity: 'info', title: `Checking ${rows.length} Claude account${rows.length === 1 ? '' : 's'}`.slice(0, 120),
    body: `${rows.map((r) => r.label || r.name).join(', ')}: login, credits left and models. The result follows in a minute.`.slice(0, 900),
    key: `claude-accounts:status:${run.id}:start`, link: 'view:claude-accounts', meta: { type: 'account-status', phase: 'start', run: run.id, trigger: run.trigger, accounts: rows.length } };
}
export function resultAlert(run, entries, now = Date.now()) {
  const s = Health.summary({ accounts: Object.fromEntries(entries.map((e) => [e.name, e])) });
  const bad = entries.filter((e) => e.status !== 'ok');
  const todo = bad.map((e) => e.status === 'expired' ? `Sign ${e.name} in again.` : e.status === 'no-credits' ? `Top up ${e.label || e.name}.` : '').filter(Boolean);
  return { source: 'claude-accounts', severity: bad.some((e) => e.status === 'expired' || e.status === 'no-credits') ? 'warning' : 'success',
    title: `Claude accounts: ${s.text}`.slice(0, 120),
    body: [...entries.map((e) => Health.line(e, now)), ...todo].join('\n').slice(0, 900),
    key: `claude-accounts:status:${run.id}:result`, link: 'view:claude-accounts',
    meta: { type: 'account-status', phase: 'result', run: run.id, trigger: run.trigger, ok: s.counts.ok ?? 0, limited: s.counts.limited ?? 0, noCredits: s.counts['no-credits'] ?? 0, expired: s.counts.expired ?? 0, unknown: s.counts.unknown ?? 0 } };
}

const notifies = (cfg, trigger) => cfg.notifyRuns === 'all' || (cfg.notifyRuns === 'load' && (trigger === 'load' || trigger === 'manual'));

/**
 * One check of every account (or `names`). Returns { skipped?, run, entries }. `deps` lets tests swap the network,
 * the clock and the probes.
 */
export async function run({ trigger = 'manual', names = null, notify = true, force = false } = {}, env = process.env, deps = {}) {
  const now = deps.now ?? Date.now();
  const W = await import('./claude-workers.mjs');
  const A = await import('./account-alerts.mjs');
  const cfg = W.loadConfig(env).probe;
  const store = Health.read(env);
  const last = store.run;
  if (last?.state === 'running' && now - Date.parse(last.startedAt || 0) < (cfg.timeoutSec + 60) * 1000) return { skipped: `a check is already running (started ${last.startedAt})`, run: last, entries: [] };
  if (!force && trigger === 'load') {
    if (!cfg.onLoad) return { skipped: 'checking on console load is off', run: last, entries: [] };
    const ago = now - Date.parse(last?.finishedAt || last?.startedAt || 0);
    if (ago < cfg.loadGapMin * 60e3) return { skipped: `checked ${Math.round(ago / 60e3)} min ago (gap ${cfg.loadGapMin} min)`, run: last, entries: [] };
  }
  const st = W.status(env, now);
  const rows = st.accounts.filter((a) => (!names || names.includes(a.name)) && (a.kind === 'subscription' || a.role === 'api-worker' || a.hasKey !== false));
  if (!rows.length) return { skipped: names ? `no account named ${names.join(', ')}` : 'no Claude accounts saved', run: last, entries: [] };
  const runRec = { id: `${new Date(now).toISOString().replace(/[-:]/g, '').slice(0, 13)}-${Math.random().toString(36).slice(2, 6)}`, trigger, state: 'running', startedAt: new Date(now).toISOString(), finishedAt: '', accounts: rows.map((r) => r.name), costUsd: 0 };
  Health.update((s) => { s.run = runRec; }, env, now);
  const tell = notify && notifies(cfg, trigger);
  if (tell) try { A.postAlert(startAlert(runRec, rows), env); } catch { /* the check still runs */ }
  const pSub = deps.probeSubscription ?? probeSubscription; const pApi = deps.probeApi ?? probeApi;
  const opts = { env, fetchImpl: deps.fetch ?? fetch, now };
  const before = store.accounts;
  const entries = await Promise.all(rows.map((r) => (r.kind === 'api' ? pApi(r, cfg, opts) : pSub(r, cfg, opts)).catch((e) => entryOf(r, { status: 'unknown', why: oneLine(e?.message || e), until: '', warn: false, models: null }, {}))));
  const end = deps.now ?? Date.now();
  const saved = Health.update((s) => {
    for (const e of entries) s.accounts[e.name] = Health.normEntry(e.name, { ...(s.accounts[e.name] ?? {}), ...e, checkedAt: new Date(end).toISOString(), trigger });
    s.run = { ...runRec, state: 'done', finishedAt: new Date(end).toISOString(), costUsd: entries.reduce((n, e) => n + (e.probe?.costUsd || 0), 0) };
  }, env, end);
  // what changed: back = leaves the limits (its problem alert closes); newly out = one problem alert
  for (const e of Object.values(saved.accounts).filter((x) => runRec.accounts.includes(x.name))) {
    const was = before[e.name]?.status;
    if (e.status === 'ok') {
      const lim = st.accounts.find((a) => a.name === e.name)?.limited;
      if (lim && lim.source !== 'account-status') { try { W.clearLimit(e.name, env); } catch { /* next sweep */ } }
      if (was && was !== 'ok' && was !== 'unknown') try { A.resolveAlerts(e.name, undefined, env); } catch { /* outbox */ }
    } else if (['expired', 'limited', 'no-credits'].includes(e.status) && was !== e.status && cfg.alertProblems) {
      const kind = { expired: 'auth', 'no-credits': 'credits', limited: 'usage' }[e.status];
      try { A.raise({ account: e.name, kind, reason: `${e.why} (account check)`, until: e.until, untilSignin: e.status === 'expired', email: e.email }, env); } catch { /* outbox */ }
    }
  }
  if (tell) {
    try { A.resolveKeys([`claude-accounts:status:${runRec.id}:start`], env); A.postAlert(resultAlert(saved.run, entries.map((e) => saved.accounts[e.name]), end), env); } catch { /* outbox */ }
  }
  return { run: saved.run, entries: entries.map((e) => saved.accounts[e.name]) };
}

/** Is a scheduled check due? { due, why }. */
export function due(cfg, store, now = Date.now()) {
  if (!cfg.enabled) return { due: false, why: 'scheduled checks are off' };
  const last = store.run;
  if (last?.state === 'running' && now - Date.parse(last.startedAt || 0) < (cfg.timeoutSec + 60) * 1000) return { due: false, why: 'a check is running' };
  const at = Date.parse(last?.startedAt || 0);
  const left = at + cfg.intervalMin * 60e3 - now;
  return left <= 0 ? { due: true, why: last ? `last check ${Math.round((now - at) / 60e3)} min ago` : 'never checked' } : { due: false, why: `next in ${Math.ceil(left / 60e3)} min` };
}

/**
 * A check the console asked for (console load, Check now, voice, MCP): it writes account-probe-request.json in the
 * shared folder (it never runs anything on the host itself) and the minute sweep starts it. Taken = the file is gone.
 */
export const requestFile = (env = process.env) => join(Health.dir(env), 'account-probe-request.json');
export function takeRequest(env = process.env, now = Date.now()) {
  const f = requestFile(env);
  const r = readJson(f);
  if (!r) return null;
  try { unlinkSync(f); } catch { return null; }   // another sweep took it
  if (now - Date.parse(r.at || 0) > 30 * 60e3) return null;   // stale: the console asked half an hour ago
  const names = (Array.isArray(r.accounts) ? r.accounts : []).filter((n) => /^[a-z0-9][a-z0-9-]{0,31}$/.test(n)).slice(0, 20);
  return { trigger: ['load', 'manual'].includes(r.trigger) ? r.trigger : 'manual', names: names.length ? names : null, by: String(r.by || '').slice(0, 60) };
}

/** Start `run` detached (the console and the sweep never wait for it). */
export function background(args, env = process.env) {
  const log = join(env.AXF_HEADLESS_DIR || '/var/tmp/axf-headless', 'account-probe.log');
  try { mkdirSync(join(log, '..'), { recursive: true }); } catch { /* ok */ }
  const fd = openSync(log, 'a');
  const c = spawn(process.execPath, [SELF, 'run', ...args], { detached: true, stdio: ['ignore', fd, fd], env });
  c.unref();
  return log;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  const [cmd = 'show', ...rest] = process.argv.slice(2);
  const flag = (n, d = '') => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : d; };
  const json = rest.includes('--json');
  try {
    if (cmd === 'run') {
      const trigger = ['load', 'schedule', 'manual', 'failover'].includes(flag('trigger')) ? flag('trigger') : 'manual';
      const names = flag('account') ? flag('account').split(',').filter(Boolean) : null;
      if (rest.includes('--background')) {
        const log = background(rest.filter((a) => a !== '--background'));
        console.log(`started: ${trigger} check of ${names ? names.join(', ') : 'every account'} (log ${log})`);
      } else {
        const r = await run({ trigger, names, notify: !rest.includes('--no-notify'), force: rest.includes('--force') });
        if (json) console.log(JSON.stringify(r));
        else if (r.skipped) console.log(`skipped: ${r.skipped}`);
        else {
          console.log(`${new Date().toISOString()} ${trigger} check of ${r.entries.length} account(s) · $${(r.run?.costUsd ?? 0).toFixed(4)}`);
          for (const e of r.entries) console.log(`  ${Health.line(e)}${e.status !== 'ok' && e.why ? ` · ${e.why}` : ''}`);
        }
      }
    } else if (cmd === 'due') {
      const W = await import('./claude-workers.mjs');
      const req = takeRequest();
      if (req) {
        background(['--trigger', req.trigger, ...(req.names ? ['--account', req.names.join(',')] : [])]);
        console.log(`${new Date().toISOString()} account check started (${req.trigger}${req.by ? ` by ${req.by}` : ''})`);
        process.exit(0);
      }
      const d = due(W.loadConfig().probe, Health.read());
      if (d.due) { background(['--trigger', 'schedule']); console.log(`${new Date().toISOString()} account check started (${d.why})`); }
      else if (json) console.log(JSON.stringify(d));
    } else if (cmd === 'show') {
      const s = Health.read();
      if (json) console.log(JSON.stringify(s, null, 1));
      else for (const e of Object.values(s.accounts)) console.log(`${Health.line(e)} · checked ${Health.short(e.checkedAt)}${e.status !== 'ok' && e.why ? ` · ${e.why}` : ''}`);
    } else { console.error('usage: claude-account-probe.mjs run [--trigger t] [--account a,b] [--background] [--json] | due | show [--json]'); process.exit(2); }
  } catch (e) { console.error(`account probe: ${e.message}`); process.exit(e.code || 1); }
}

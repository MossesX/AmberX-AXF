#!/usr/bin/env node
/**
 * account-status.mjs — the ONE shared store of what every Claude account can do right now (build
 * account-health-failover, Nov 8 2026, Brett: "It saves each account's status in ONE shared store all plugins read
 * (status: ok / limited / no credits / login expired; credits left; models; checked at). Usage badge, Claude accounts
 * screen and routing all read it.").
 *
 * account-status@1 lives in account-status.json next to workers.json (the claude-accounts plugin's data folder, which
 * the VPS host and the console container share). Writers: the health probe (deploy/claude-account-probe.mjs), failover
 * (claude-workers.mjs markLimit: a build that died on an account), and a by-hand clear. Readers: routing
 * (claude-workers.mjs status → worker-routing.mjs decide), the console's Claude accounts screen, the usage badge (through
 * capability axf.account-status@1) and the systems check. Nothing here holds or prints a credential.
 *
 *   {
 *     $axf: 'account-status@1', updatedAt,
 *     run: { id, trigger: load|schedule|manual|failover, state: running|done, startedAt, finishedAt, accounts: [names], costUsd },
 *     accounts: { <name>: {
 *       name, label, kind: subscription|api, email,
 *       status: ok | limited | no-credits | expired | unknown,
 *       why            one plain line (what the check saw)
 *       warn           true when a window is at 80 % or more (still ok)
 *       checkedAt, source: probe | failover | clear, trigger
 *       until          when a limited / no-credits account should be back ('' = unknown; expired = until signed in)
 *       login          { valid: true|false|null, expiresAt, hash }   hash = 16-char sha256 prefix of the login (never the token)
 *       usage          { fiveHour: { used, left, resetsAt } | null, weekly: {…} | null,
 *                        perModel: [{ model, used, resetsAt }], extra: { enabled, usedUsd, limitUsd } | null }
 *       api            { spendDay, spendWeek, capDay, capWeek, left } | null   (Anthropic has no balance API: last-known spend vs cap)
 *       models         ['opus','fable'] it can use now; null = not known (routing then does not filter on it)
 *       modelIds       the raw model ids the account lists
 *       probe          { ms, costUsd, inputTokens, session: true|false }
 *     } }
 *   }
 *
 * Routing reads it through ableFor(): an account the store says is expired, limited or out of credits gets no job until
 * `until` passes, its login changes (signed in again) or a newer probe says ok; a job whose model the account can't use
 * now (e.g. its weekly Fable cap is spent) goes elsewhere. An account never checked, or checked too long ago, is not
 * blocked by the store (the launcher's own failover still catches it), so a fresh install never stops every build.
 *
 *   node deploy/account-status.mjs [show] [--json]        every account's status
 *   node deploy/account-status.mjs able <name> [--model m] [--json]
 *
 * Paths: AXF_CLAUDE_WORKERS (the folder), else the folder of AXF_CLAUDE_SEEN, else the plugin's data folder.
 */
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'account-status@1';
export const STATUSES = ['ok', 'limited', 'no-credits', 'expired', 'unknown'];
export const LABELS = { ok: 'ok', limited: 'limited', 'no-credits': 'no credits', expired: 'login expired', unknown: 'not checked' };
/** A probe older than this no longer blocks an account (it may have come back); the next probe decides again. */
export const MAX_AGE_MS = 6 * 3600e3;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const POLICY_MODELS = ['opus', 'fable'];
/** failover kinds (claude-workers.mjs hitOf) → store status */
export const FROM_HIT = { auth: 'expired', credits: 'no-credits', usage: 'limited' };

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const str = (v, n = 200) => (typeof v === 'string' ? v.slice(0, n) : '');
const iso = (v) => { const t = typeof v === 'number' ? v : Date.parse(v || ''); return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : ''; };
const pct = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 10) / 10)) : null; };

export function dir(env = process.env) {
  return env.AXF_CLAUDE_WORKERS || dirname(env.AXF_CLAUDE_SEEN || '/opt/axf/.axf-console/plugins/claude-accounts/seen.json');  // axf-plugin:claude-accounts
}
export const file = (env = process.env) => join(dir(env), 'account-status.json');

/** Model ids → the policy models (Opus, Fable). Sonnet and Haiku never run here (model policy), so they don't count. */
export function policyModels(ids) {
  const out = new Set();
  for (const id of Array.isArray(ids) ? ids : []) {
    const s = String(id).toLowerCase();
    if (s.includes('fable')) out.add('fable'); else if (s.includes('opus')) out.add('opus');
  }
  return POLICY_MODELS.filter((m) => out.has(m));
}

const normWindow = (w) => (w && typeof w === 'object' && pct(w.used) !== null
  ? { used: pct(w.used), left: Math.max(0, Math.round((100 - pct(w.used)) * 10) / 10), resetsAt: iso(w.resetsAt) } : null);

export function normEntry(name, e = {}) {
  const x = e && typeof e === 'object' ? e : {};
  const u = x.usage && typeof x.usage === 'object' ? x.usage : {};
  const api = x.api && typeof x.api === 'object' ? x.api : null;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
  return {
    name, label: str(x.label, 40), kind: x.kind === 'api' ? 'api' : 'subscription', email: str(x.email, 120),
    status: STATUSES.includes(x.status) ? x.status : 'unknown', why: str(x.why, 300), warn: !!x.warn,
    checkedAt: iso(x.checkedAt), source: ['probe', 'failover', 'clear'].includes(x.source) ? x.source : 'probe', trigger: str(x.trigger, 20),
    until: iso(x.until),
    login: { valid: typeof x.login?.valid === 'boolean' ? x.login.valid : null, expiresAt: iso(x.login?.expiresAt), hash: str(x.login?.hash, 16) },
    usage: {
      fiveHour: normWindow(u.fiveHour), weekly: normWindow(u.weekly),
      perModel: (Array.isArray(u.perModel) ? u.perModel : []).slice(0, 8).map((m) => ({ model: str(m?.model, 30), used: pct(m?.used) ?? 0, resetsAt: iso(m?.resetsAt) })),
      extra: u.extra && typeof u.extra === 'object' ? { enabled: !!u.extra.enabled, usedUsd: num(u.extra.usedUsd), limitUsd: num(u.extra.limitUsd) } : null,
    },
    api: api ? { spendDay: num(api.spendDay), spendWeek: num(api.spendWeek), capDay: num(api.capDay), capWeek: num(api.capWeek), left: api.left === null || api.left === undefined ? null : num(api.left) } : null,
    models: Array.isArray(x.models) ? POLICY_MODELS.filter((m) => x.models.includes(m)) : null,
    modelIds: (Array.isArray(x.modelIds) ? x.modelIds : []).filter((m) => typeof m === 'string').slice(0, 40).map((m) => m.slice(0, 60)),
    probe: x.probe && typeof x.probe === 'object' ? { ms: Math.round(Number(x.probe.ms) || 0), costUsd: Math.round((Number(x.probe.costUsd) || 0) * 1e6) / 1e6, inputTokens: Math.round(Number(x.probe.inputTokens) || 0), session: !!x.probe.session } : null,
  };
}

export function normStore(s) {
  const x = s && typeof s === 'object' ? s : {};
  const accounts = {};
  for (const [n, e] of Object.entries(x.accounts && typeof x.accounts === 'object' ? x.accounts : {})) if (NAME_RE.test(n)) accounts[n] = normEntry(n, e);
  const r = x.run && typeof x.run === 'object' ? x.run : null;
  return {
    $axf: SCHEMA, updatedAt: iso(x.updatedAt),
    run: r ? { id: str(r.id, 40), trigger: str(r.trigger, 20), state: r.state === 'running' ? 'running' : 'done', startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt),
      accounts: (Array.isArray(r.accounts) ? r.accounts : []).filter((n) => NAME_RE.test(n)), costUsd: Math.round((Number(r.costUsd) || 0) * 1e6) / 1e6 } : null,
    accounts,
  };
}

export function read(env = process.env) {
  return normStore(readJson(file(env)));
}

/** One writer at a time (the probe, failover and the console may all write). Stale after 10 s. */
function withLock(env, fn) {
  const f = `${file(env)}.lock`;
  mkdirSync(dirname(f), { recursive: true });
  const until = Date.now() + 15_000;
  for (;;) {
    try { closeSync(openSync(f, 'wx')); break; } catch {
      try { if (Date.now() - statSync(f).mtimeMs > 10_000) { rmSync(f, { force: true }); continue; } } catch { continue; }
      if (Date.now() > until) throw Object.assign(new Error('account status is locked'), { code: 2 });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    }
  }
  try { return fn(); } finally { rmSync(f, { force: true }); }
}

/** Read, change, write under the lock. `fn(store)` changes the store in place or returns a new one. */
export function update(fn, env = process.env, now = Date.now()) {
  return withLock(env, () => {
    const s = read(env);
    const out = normStore(fn(s) ?? s);
    out.updatedAt = new Date(now).toISOString();
    const f = file(env);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(out, null, 1));
    renameSync(`${f}.${process.pid}.tmp`, f);
    return out;
  });
}

/** Put one account's entry (merged over what the store holds, so a failover write keeps the last usage numbers). */
export function put(name, entry, env = process.env, now = Date.now()) {
  if (!NAME_RE.test(name)) throw Object.assign(new Error(`not an account name: ${name}`), { code: 2 });
  return update((s) => { s.accounts[name] = normEntry(name, { ...(s.accounts[name] ?? {}), ...entry }); }, env, now).accounts[name];
}

/** A build died on this account (failover): the store says so at once, so routing skips it before the next probe. */
export function fromFailover(name, { kind = 'usage', reason = '', until = '', loginHash = '' } = {}, env = process.env, now = Date.now()) {
  const status = FROM_HIT[kind] || 'limited';
  return put(name, { status, why: reason ? `a build stopped on it: ${reason}` : `a build stopped on it (${LABELS[status]})`, warn: false, checkedAt: new Date(now).toISOString(),
    source: 'failover', trigger: 'failover', until: status === 'expired' ? '' : until, ...(status === 'expired' ? { login: { valid: false, expiresAt: '', hash: loginHash } } : {}) }, env, now);
}

/** Brought back by hand: the store stops blocking it until the next probe looks again. */
export function clear(name, env = process.env, now = Date.now()) {
  return put(name, { status: 'unknown', why: 'brought back by hand; the next check looks again', checkedAt: new Date(now).toISOString(), source: 'clear', until: '' }, env, now);
}

/**
 * Can this account take a job (with this model) by what the store says? { ok, why, status, until }.
 * `loginHash` = the account's login now: a different one than the dead login the store recorded = signed in again.
 */
export function ableFor(entry, { model = '', now = Date.now(), loginHash = '', maxAgeMs = MAX_AGE_MS } = {}) {
  if (!entry || !entry.checkedAt) return { ok: true, why: 'not checked yet', status: 'unknown', until: '' };
  const age = now - Date.parse(entry.checkedAt);
  const st = entry.status;
  if (st === 'expired') {
    if (loginHash && entry.login?.hash && loginHash.slice(0, 16) !== entry.login.hash) return { ok: true, why: 'signed in again since the check', status: 'unknown', until: '' };
    if (entry.source === 'probe' && age > maxAgeMs) return { ok: true, why: 'expired at the last check, a while ago', status: 'unknown', until: '' };
    return { ok: false, why: `login expired (${entry.why || 'checked ' + entry.checkedAt})`, status: st, until: '' };
  }
  if (st === 'limited' || st === 'no-credits') {
    const back = Date.parse(entry.until || '');
    if (back && back <= now) return { ok: true, why: `${LABELS[st]} until ${entry.until}, should be back`, status: 'unknown', until: '' };
    if (!back && age > maxAgeMs) return { ok: true, why: `${LABELS[st]} at the last check, a while ago`, status: 'unknown', until: '' };
    return { ok: false, why: `${LABELS[st]}${entry.until ? ` until ${entry.until}` : ''}${entry.why ? ` (${entry.why})` : ''}`, status: st, until: entry.until || new Date(now + 3600e3).toISOString() };
  }
  const m = String(model || '').toLowerCase();
  if (m && Array.isArray(entry.models) && age <= maxAgeMs && !entry.models.includes(m)) return { ok: false, why: `can't use ${m} now${modelWhy(entry, m)}`, status: st, until: '', model: true };
  return { ok: true, why: st === 'ok' ? 'ok at the last check' : 'not checked yet', status: st, until: '' };
}

const modelWhy = (e, m) => {
  const cap = (e.usage?.perModel ?? []).find((x) => x.model.toLowerCase() === m);
  return cap ? ` (weekly ${m} cap ${cap.used}% used${cap.resetsAt ? `, resets ${cap.resetsAt}` : ''})` : ' (not on its model list)';
};

/** The worker-state limit routing applies for a store entry that blocks the account, or null. */
export function limitFor(entry, opts = {}) {
  const a = ableFor(entry, { ...opts, model: '' });
  if (a.ok) return null;
  const kind = { expired: 'auth', 'no-credits': 'credits', limited: 'usage' }[a.status] || 'usage';
  return { at: entry.checkedAt, until: a.until || new Date((opts.now ?? Date.now()) + 30 * 24 * 3600e3).toISOString(), kind, reason: `${LABELS[a.status]} (account check)`, source: 'account-status', ...(a.status === 'expired' ? { untilSignin: true } : {}) };
}

/** One short line per account (phone, CLI, voice). */
export function line(e, now = Date.now()) {
  const who = e.label || e.name;
  const parts = [LABELS[e.status] || e.status];
  if (e.kind === 'api') {
    if (e.api) parts.push(`$${e.api.spendDay.toFixed(2)} today${e.api.capDay ? ` of $${e.api.capDay}` : ''}${e.api.capWeek ? ` · $${e.api.spendWeek.toFixed(2)} of $${e.api.capWeek} this week` : ''}`);
  } else {
    if (e.usage?.fiveHour) parts.push(`5h ${e.usage.fiveHour.left}% left`);
    if (e.usage?.weekly) parts.push(`week ${e.usage.weekly.left}% left`);
  }
  if ((e.status === 'limited' || e.status === 'no-credits') && e.until) parts.push(`back ${short(e.until, now)}`);
  if (Array.isArray(e.models)) parts.push(e.models.length ? e.models.join('+') : 'no models');
  return `${who}: ${parts.join(' · ')}`;
}

export function short(isoStr, now = Date.now()) {
  const t = Date.parse(isoStr || '');
  if (!t) return '';
  const d = new Date(t);
  const sameDay = new Date(now).toISOString().slice(0, 10) === d.toISOString().slice(0, 10);
  return `${sameDay ? '' : `${d.toUTCString().slice(0, 11).trim()} `}${d.toISOString().slice(11, 16)} UTC`;
}

/** Counts by status: { ok: 2, limited: 1, … } and the one-line summary. */
export function summary(store, names = null) {
  const rows = Object.values(store.accounts).filter((e) => !names || names.includes(e.name));
  const counts = {};
  for (const e of rows) counts[e.status] = (counts[e.status] ?? 0) + 1;
  const text = STATUSES.filter((s) => counts[s]).map((s) => `${counts[s]} ${LABELS[s]}`).join(', ');
  return { counts, total: rows.length, text: text || 'no accounts' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd = 'show', ...rest] = process.argv.slice(2);
  const json = rest.includes('--json');
  const flag = (n, d = '') => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : d; };
  const s = read();
  if (cmd === 'show' || cmd === '--json') {
    if (json || cmd === '--json') console.log(JSON.stringify(s, null, 1));
    else {
      const rows = Object.values(s.accounts);
      if (!rows.length) console.log('No account checked yet (node deploy/claude-account-probe.mjs run).');
      for (const e of rows) console.log(`${line(e)}${e.checkedAt ? ` · checked ${short(e.checkedAt)}` : ''}${e.why && e.status !== 'ok' ? ` · ${e.why}` : ''}`);
      if (s.run) console.log(`last check: ${s.run.trigger} ${s.run.state} ${s.run.startedAt}${s.run.costUsd ? ` · $${s.run.costUsd}` : ''}`);
    }
  } else if (cmd === 'able') {
    const name = rest.find((a) => !a.startsWith('--') && a !== flag('model'));
    const a = ableFor(s.accounts[name], { model: flag('model') });
    console.log(json ? JSON.stringify(a) : `${name}: ${a.ok ? 'can take it' : 'no'} (${a.why})`);
    if (!a.ok) process.exitCode = 1;
  } else { console.error('usage: account-status.mjs [show|able <name> --model m] [--json]'); process.exit(2); }
}

#!/usr/bin/env node
/**
 * worker-routing.mjs — which Claude account takes a headless job (build workers-api-routing, Nov 8 2026).
 *
 * Pure: no files, no clock, no network. deploy/claude-workers.mjs feeds it the config (workers.json), the accounts the
 * host knows (role, kind, running, queued, limit, spend) and the job; the console server runs the same code for the
 * settings page and its test-a-job preview (`node deploy/worker-routing.mjs <op>`, JSON on stdin), so the page and
 * the launcher can never disagree.
 *
 * Config (claude-workers@1; every field optional, a missing file = the defaults):
 *   workers               order of the subscription workers (names first in this list go first)
 *   excluded              subscription logins that are NOT workers (Stop worker). Every other saved subscription login
 *                         is a worker by default (Brett, Nov 8 2026: "All subscription logins are workers").
 *   interactiveTakesJobs  the console's own (active) account also takes headless jobs, after the workers. Default on.
 *   limits                { building: 3, queue: 5 } per account: jobs running at once, jobs waiting for that account
 *   perAccount            { name: { label?, building?, queue? } }
 *   api                   { name: { label, enabled, dailyCapUsd, weeklyCapUsd, alertAt } } the API-key accounts that may
 *                         work. They bill per token, so they only take a job a rule sends them (never by default).
 *   rules                 ordered; the first enabled rule that matches a job decides:
 *                         { id, name, enabled, to: api|subscription, accounts: [names] (api only; [] = any API account),
 *                           when: { jobTypes, models, priorities, profiles: [] (any), minSteps, maxSteps, maxMinutes,
 *                                   subs: any|busy } }
 *                         subs "busy" = the rule only applies while no subscription account can start the job now
 *                         (all limited, full or missing): the fallback rule.
 *
 * Decision: { account, kind: subscription|api|'', state: run|queue|none, rule, position, why, considered: [...] }.
 *   rule to api   → the least busy matching API account under its caps with a free building slot; none → falls through
 *   otherwise     → the least busy subscription worker with a free slot (workers in order, the interactive account last);
 *                   all full → queue on the account with the shortest queue that still has room; none → state none.
 *
 * Spend: an API account at or over a cap takes nothing more; at alertAt (default 0.8) of a cap its state is "warn".
 * Caps count the last 24 h / 7 days of that account's runs (the same windows as the cost columns).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'claude-workers@1';
export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const DEFAULT_LIMITS = Object.freeze({ building: 3, queue: 5 });
export const MAX_LIMIT = 20;
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
export const MODELS = ['fable', 'opus'];
export const RULE_FIELDS = ['jobTypes', 'models', 'priorities', 'profiles', 'minSteps', 'maxSteps', 'maxMinutes', 'subs'];
const MAX_RULES = 50;

const str = (v, n = 80) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const int = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };
const money = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };
const names = (v) => [...new Set((Array.isArray(v) ? v : []).filter((n) => typeof n === 'string' && NAME_RE.test(n)))];
const words = (v, n = 40) => [...new Set((Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => str(String(x), n).toLowerCase()).filter(Boolean))].slice(0, 30);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** Priority words people use → P0-P3. */
export function normPriority(p) {
  const s = String(p ?? '').trim().toLowerCase();
  return { p0: 'P0', urgent: 'P0', p1: 'P1', high: 'P1', p2: 'P2', normal: 'P2', p3: 'P3', low: 'P3' }[s] || '';
}
/** Model words → fable | opus | '' (Sonnet and Haiku run as Opus by policy). */
export function normModel(m) {
  const s = String(m ?? '').toLowerCase();
  if (s.includes('fable')) return 'fable';
  if (/opus|sonnet|haiku/.test(s)) return 'opus';
  return '';
}

export function normRule(r, i = 0) {
  const w = r?.when && typeof r.when === 'object' ? r.when : {};
  const to = r?.to === 'subscription' ? 'subscription' : 'api';
  const when = {
    jobTypes: words(w.jobTypes), models: words(w.models).map(normModel).filter(Boolean), priorities: words(w.priorities).map(normPriority).filter(Boolean),
    profiles: words(w.profiles), minSteps: int(w.minSteps, 0, 999, 0), maxSteps: int(w.maxSteps, 0, 999, 0), maxMinutes: int(w.maxMinutes, 0, 100000, 0),
    subs: w.subs === 'busy' ? 'busy' : 'any',
  };
  when.models = [...new Set(when.models)]; when.priorities = [...new Set(when.priorities)];
  const name = str(r?.name, 80) || `Rule ${i + 1}`;
  return { id: slug(r?.id) || slug(name) || `rule-${i + 1}`, name, enabled: r?.enabled !== false, to, accounts: to === 'api' ? names(r?.accounts) : [], when };
}

export function normApi(a) {
  return { label: str(a?.label, 40), enabled: a?.enabled !== false, dailyCapUsd: money(a?.dailyCapUsd), weeklyCapUsd: money(a?.weeklyCapUsd),
    alertAt: Math.min(1, Math.max(0.1, Number(a?.alertAt) || 0.8)) };
}

/** Any config (or nothing) → a full, valid config. Unknown fields are dropped; rule ids are made unique. */
export function normConfig(c) {
  const src = c && typeof c === 'object' ? c : {};
  const lim = src.limits && typeof src.limits === 'object' ? src.limits : {};
  const limits = { building: int(lim.building, 1, MAX_LIMIT, DEFAULT_LIMITS.building), queue: int(lim.queue, 0, MAX_LIMIT, DEFAULT_LIMITS.queue) };
  const perAccount = {};
  for (const [n, v] of Object.entries(src.perAccount && typeof src.perAccount === 'object' ? src.perAccount : {})) {
    if (!NAME_RE.test(n) || !v || typeof v !== 'object') continue;
    const o = {};
    if (str(v.label, 40)) o.label = str(v.label, 40);
    if (v.building !== undefined && v.building !== null && v.building !== '') o.building = int(v.building, 0, MAX_LIMIT, limits.building);
    if (v.queue !== undefined && v.queue !== null && v.queue !== '') o.queue = int(v.queue, 0, MAX_LIMIT, limits.queue);
    if (Object.keys(o).length) perAccount[n] = o;
  }
  const api = {};
  for (const [n, v] of Object.entries(src.api && typeof src.api === 'object' ? src.api : {})) if (NAME_RE.test(n)) api[n] = normApi(v);
  const seen = new Set();
  const rules = (Array.isArray(src.rules) ? src.rules : []).slice(0, MAX_RULES).map((r, i) => {
    const x = normRule(r, i); let id = x.id; let k = 2;
    while (seen.has(id)) id = `${x.id}-${k++}`;
    seen.add(id); return { ...x, id };
  });
  return { $axf: SCHEMA, workers: names(src.workers), excluded: names(src.excluded), interactiveTakesJobs: src.interactiveTakesJobs !== false, limits, perAccount, api, rules };
}

/** The caps of one account that went up from `before` to `after` (raising a cap is Brett's own call). */
export function raisedCaps(before, after) {
  const a = normConfig(before); const b = normConfig(after); const out = [];
  const up = (x, y) => (y === 0 && x > 0) || (x > 0 && y > x);   // 0 = no cap, so removing one raises it
  for (const [n, v] of Object.entries(b.api)) {
    const o = a.api[n];
    if (!o) { if (v.dailyCapUsd === 0 || v.weeklyCapUsd === 0) out.push(`${n}: a new API account without a daily and weekly cap`); continue; }
    if (up(o.dailyCapUsd, v.dailyCapUsd)) out.push(`${n} daily cap $${o.dailyCapUsd} → ${v.dailyCapUsd ? `$${v.dailyCapUsd}` : 'none'}`);
    if (up(o.weeklyCapUsd, v.weeklyCapUsd)) out.push(`${n} weekly cap $${o.weeklyCapUsd} → ${v.weeklyCapUsd ? `$${v.weeklyCapUsd}` : 'none'}`);
  }
  return out;
}

/** A job as the rules see it. */
export function normJob(j) {
  const src = j && typeof j === 'object' ? j : {};
  return { name: str(src.name, 120), jobType: str(src.jobType, 40).toLowerCase() || 'build', model: normModel(src.model) || 'opus', priority: normPriority(src.priority) || 'P2',
    profile: str(src.profile, 40).toLowerCase() || 'all', steps: int(src.steps, 0, 999, 0), minutes: int(src.minutes, 0, 100000, 0), build: str(src.build, 80) };
}

/** Why a rule does or doesn't match a job: '' = it matches. */
export function ruleMiss(rule, job, subsFree) {
  const w = rule.when;
  if (w.jobTypes.length && !w.jobTypes.includes(job.jobType)) return `job type ${job.jobType} is not ${w.jobTypes.join('/')}`;
  if (w.models.length && !w.models.includes(job.model)) return `model ${job.model} is not ${w.models.join('/')}`;
  if (w.priorities.length && !w.priorities.includes(job.priority)) return `priority ${job.priority} is not ${w.priorities.join('/')}`;
  if (w.profiles.length && !w.profiles.includes(job.profile)) return `profile ${job.profile} is not ${w.profiles.join('/')}`;
  if (w.minSteps && job.steps < w.minSteps) return `${job.steps} steps, fewer than ${w.minSteps}`;
  if (w.maxSteps && job.steps > w.maxSteps) return `${job.steps} steps, more than ${w.maxSteps}`;
  if (w.maxMinutes && job.minutes > w.maxMinutes) return `${job.minutes} min, more than ${w.maxMinutes}`;
  if (w.subs === 'busy' && subsFree) return 'a subscription account can take it now';
  return '';
}

/** Spend state of one API account: { day, week, dayCap, weekCap, state: ok|warn|capped, why }. */
export function spendOf(acc, apiCfg) {
  const c = normApi(apiCfg);
  const day = Number(acc?.costToday) || 0; const week = Number(acc?.costWeek) || 0;
  const over = (c.dailyCapUsd && day >= c.dailyCapUsd) ? `daily cap $${c.dailyCapUsd} reached ($${day.toFixed(2)})` : (c.weeklyCapUsd && week >= c.weeklyCapUsd) ? `weekly cap $${c.weeklyCapUsd} reached ($${week.toFixed(2)})` : '';
  const near = (c.dailyCapUsd && day >= c.alertAt * c.dailyCapUsd) ? `$${day.toFixed(2)} of the $${c.dailyCapUsd} daily cap` : (c.weeklyCapUsd && week >= c.alertAt * c.weeklyCapUsd) ? `$${week.toFixed(2)} of the $${c.weeklyCapUsd} weekly cap` : '';
  return { day: +day.toFixed(2), week: +week.toFixed(2), dayCap: c.dailyCapUsd, weekCap: c.weeklyCapUsd, alertAt: c.alertAt, state: over ? 'capped' : near ? 'warn' : 'ok', why: over || near };
}

/**
 * Every account with what routing makes of it. `accounts` rows: { name, kind: subscription|api, active, hasKey,
 * limited, running: [..], queued: n, costToday, costWeek }.
 */
export function roster(config, accounts) {
  const cfg = normConfig(config);
  const order = (n) => { const i = cfg.workers.indexOf(n); return i < 0 ? 1e3 : i; };
  return (accounts ?? []).map((a) => {
    const kind = a.kind === 'api' ? 'api' : 'subscription';
    const pa = cfg.perAccount[a.name] ?? {};
    const building = pa.building ?? cfg.limits.building; const queue = pa.queue ?? cfg.limits.queue;
    const running = Array.isArray(a.running) ? a.running.length : Number(a.running) || 0;
    const queued = Number(a.queued) || 0;
    const api = kind === 'api' ? cfg.api[a.name] : null;
    let role; let why = '';
    if (kind === 'api') {
      role = api && api.enabled ? 'api-worker' : 'api-off';
      if (!api) why = 'API key, not set up as a worker'; else if (!api.enabled) why = 'API worker switched off'; else if (a.hasKey === false) why = 'no key saved yet';
    } else if (a.active) { role = 'interactive'; if (!cfg.interactiveTakesJobs) why = 'console account; taking headless jobs is off'; }
    else if (cfg.excluded.includes(a.name)) { role = 'saved'; why = 'not a worker (stopped)'; }
    else role = 'worker';
    const spend = kind === 'api' ? spendOf(a, api) : null;
    const takes = (role === 'worker' || (role === 'interactive' && cfg.interactiveTakesJobs) || (role === 'api-worker' && a.hasKey !== false)) && building > 0;
    const limited = a.limited || null;
    const capped = spend?.state === 'capped';
    const can = takes && !limited && !capped;
    if (!why && limited) why = `out until ${limited.until}${limited.reason ? ` (${limited.reason})` : ''}`;
    if (!why && capped) why = spend.why;
    return { name: a.name, label: pa.label || api?.label || '', kind, role, active: !!a.active, running, queued, building, queue, limited, spend,
      takesJobs: takes, canRun: can && running < building, canQueue: can && running >= building && queued < queue, order: role === 'interactive' ? 2e3 : order(a.name), why };
  });
}

/** Workers before the console's own account; then the least busy; then the configured order. */
const byLoad = (a, b) => (a.role === 'interactive') - (b.role === 'interactive') || a.running - b.running || a.order - b.order || a.name.localeCompare(b.name);

/** Which account takes `job`. */
export function decide(config, accounts, job) {
  const cfg = normConfig(config); const j = normJob(job);
  const rows = roster(cfg, accounts);
  const subs = rows.filter((r) => r.kind === 'subscription' && r.takesJobs);
  const subsFree = subs.filter((r) => r.canRun);
  const considered = [];
  let rule = null;
  for (const r of cfg.rules) {
    if (!r.enabled) { considered.push({ rule: r.id, name: r.name, match: false, why: 'switched off' }); continue; }
    const miss = ruleMiss(r, j, subsFree.length > 0);
    considered.push({ rule: r.id, name: r.name, match: !miss, why: miss || `matches → ${r.to === 'api' ? 'API account' : 'subscriptions'}` });
    if (!miss) { rule = r; break; }
  }
  const out = (row, state, why, position = 0) => ({ account: row?.name ?? '', label: row?.label ?? '', kind: row?.kind ?? '', state, rule: rule?.id ?? '', ruleName: rule?.name ?? '', position, why, job: j, considered });
  let fell = '';
  if (rule?.to === 'api') {
    const apis = rows.filter((r) => r.role === 'api-worker' && (!rule.accounts.length || rule.accounts.includes(r.name)));
    const free = apis.filter((r) => r.canRun).sort(byLoad)[0];
    if (free) return out(free, 'run', `rule "${rule.name}" sends it to API account ${free.name}`);
    fell = apis.length ? `no API account free (${apis.map((r) => `${r.name}: ${r.why || 'full'}`).join('; ')})` : 'no API account set up for this rule';
  }
  const lead = rule?.to === 'subscription' ? `rule "${rule.name}" keeps it on subscriptions: ` : fell ? `${fell}, so ` : '';
  const run = [...subsFree].sort(byLoad)[0];
  if (run) return out(run, 'run', `${lead}${run.name} is the least busy ${run.role === 'interactive' ? 'account (the console\'s own)' : 'worker'}`);
  const q = subs.filter((r) => r.canQueue).sort((a, b) => a.queued - b.queued || byLoad(a, b))[0];
  if (q) return out(q, 'queue', `${lead}every subscription account is full: waits for ${q.name} (${q.queued + 1} in its queue)`, q.queued + 1);
  return out(null, 'none', `${lead}${subs.length ? 'every subscription account is out or its queue is full' : 'no subscription account takes headless jobs'}`);
}

/** Alerts for the banner: API accounts near or over a cap, API workers without a key. */
export function alerts(config, accounts) {
  return roster(config, accounts).flatMap((r) => {
    if (r.kind !== 'api' || r.role !== 'api-worker') return [];
    const out = [];
    if (r.spend && r.spend.state !== 'ok') out.push({ account: r.name, level: r.spend.state === 'capped' ? 'error' : 'warn', kind: 'spend', text: `${r.label || r.name}: ${r.spend.why}` });
    if (r.why === 'no key saved yet') out.push({ account: r.name, level: 'warn', kind: 'key', text: `${r.label || r.name}: no API key saved yet` });
    return out;
  });
}

// ── CLI: JSON on stdin, JSON out (the console server's way in) ───────────────────────────────────────────────────
const main = () => {
  const op = process.argv[2];
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { console.error('worker-routing: stdin is not JSON'); process.exit(2); }
  const ops = {
    normalize: () => normConfig(input.config),
    raised: () => raisedCaps(input.before, input.after),
    roster: () => roster(input.config, input.accounts),
    decide: () => decide(input.config, input.accounts, input.job),
    alerts: () => alerts(input.config, input.accounts),
  };
  if (!ops[op]) { console.error(`usage: worker-routing.mjs ${Object.keys(ops).join('|')} < input.json`); process.exit(2); }
  console.log(JSON.stringify(ops[op]()));
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

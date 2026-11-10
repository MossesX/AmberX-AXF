/**
 * Pipeline core (pure, IO-free): the dispatcher's rules. Shared by the CLI (pipeline.mjs), the console page and the
 * tests, so the console shows exactly what the dispatcher on the VPS will do next.
 *
 * Brett, Nov 8 2026 (build urgent-rebuild-pipeline-orchestrator-ids-splits-): the orchestrator assigns the id, uses
 * Claude to split a build into ≤ 30-min steps (Fable only where needed, Opus otherwise), puts it in Pending; Brett moves
 * it to the Queue; the orchestrator "checks the VPS to see what accounts have what slots" and, when a slot is free,
 * grabs the next Queue build and starts a headless session on it: Fable steps to an account with Fable, the rest to
 * Opus. It never starts a session right away.
 *
 *   accounts   accountViews(): every saved Claude account with Fable yes / no (override > probe > plan), its parallel
 *              cap and what runs on it now; candidates(): who can take a build's next phase
 *   plan       plan(): the launches a tick makes (one per free slot, next Queue build first), why the others wait, and
 *              whether the pipeline is idle (nothing running while the Queue has work) and why
 *   runs       endOutcome(): what a session's end means (finished / requeued / returned / failed)
 *   split      splitPrompt() → Claude; parseSplit() checks the answer; rulesSplit() when no model can be asked
 *   alerts     alertFor(): the one payload shape for the console's alerts API (notify.json names the types)
 *   API jobs   (Brett, Nov 9 2026: "I'm also gonna be able to have the orchestrator send jobs to the API, right?") the
 *              dispatcher can put a build on an API-key account (claude-workers@1 api slots, e.g. hulu-api, mossesx-api):
 *              routeFor() = the per-build override (pipeline.route = api | subscription) or the overflow rule (setting
 *              apiOverflow, off by default: every subscription account full or out → an API account). An API account
 *              takes a build only when it has a key, is switched on, is under its daily and weekly caps and has room;
 *              otherwise it is skipped and the reason is said (apiNoAccountWhy()).
 */
import { DEFAULT_MAX_RUNS, STATUS_AFTER, nextModel, openSteps, outcomeLine, outcomeOf, queueOrder } from '../../../../framework/core/build-pipeline.mjs';
import { effectivePriority, priorityLabel } from '../../../../framework/core/build-priority.mjs';
import { FOUNDATION_MODEL, MODEL_LABELS, modelForWork, modelKey } from '../../../../framework/core/model-policy.mjs';
import { API_RULE, estimateMinutes, nextUp as orchNextUp, MODEL_GUIDE } from './web/orchestrator-core.mjs';

export const SCHEMA = 'pipeline-settings@1';
export const DEFAULTS = Object.freeze({
  /** Sessions per account at once, when the account has no cap of its own (the Claude setting builds.maxParallel wins when set). */
  parallelPerAccount: 1,
  /** Plans that run Fable (Brett's Max subscriptions do; Pro ones don't). An account's override or probe beats the plan. */
  fablePlans: ['max'],
  /** Use the console's own (interactive) account when no account is marked as a worker. */
  useConsoleAccount: true,
  /** A crashed or cut-off session is relaunched this many times, then the build is failed. */
  maxRuns: DEFAULT_MAX_RUNS,
  /** Nothing running while the Queue has work for this long = a phone alert. */
  idleAfterMin: 5,
  /** A probe of an account's Fable access is good for this long. */
  probeDays: 7,
  /** How the split is made: claude (a one-shot Claude call), rules (no model), off (steps by hand only). */
  splitProvider: 'claude',
  /** New builds go straight to the Queue (the Claude setting builds.launchWithoutAsking, read on every tick). */
  autoQueue: false,
  /** The overflow rule: when no subscription account can take a build, send it to an API-key account (billed per token, under its caps). Off by default. */
  apiOverflow: false,
  /** API accounts the dispatcher may use ([] = every API worker in claude-workers@1). */
  apiAccounts: [],
});
const LIMITS = { parallelPerAccount: [1, 12], maxRuns: [1, 10], idleAfterMin: [0, 240], probeDays: [1, 90] };

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const list = (v) => (Array.isArray(v) ? v : []);
const clamp = (k, v) => { const [lo, hi] = LIMITS[k]; const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : DEFAULTS[k]; };

export function normSettings(raw = {}) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    $axf: SCHEMA,
    parallelPerAccount: o.parallelPerAccount === undefined ? DEFAULTS.parallelPerAccount : clamp('parallelPerAccount', o.parallelPerAccount),
    fablePlans: list(o.fablePlans).map((p) => str(p, 20).toLowerCase()).filter(Boolean).length ? list(o.fablePlans).map((p) => str(p, 20).toLowerCase()).filter(Boolean) : [...DEFAULTS.fablePlans],
    useConsoleAccount: o.useConsoleAccount !== false,
    maxRuns: o.maxRuns === undefined ? DEFAULTS.maxRuns : clamp('maxRuns', o.maxRuns),
    idleAfterMin: o.idleAfterMin === undefined ? DEFAULTS.idleAfterMin : clamp('idleAfterMin', o.idleAfterMin),
    probeDays: o.probeDays === undefined ? DEFAULTS.probeDays : clamp('probeDays', o.probeDays),
    splitProvider: ['claude', 'rules', 'off'].includes(o.splitProvider) ? o.splitProvider : DEFAULTS.splitProvider,
    autoQueue: o.autoQueue === true,
    apiOverflow: o.apiOverflow === true,
    apiAccounts: [...new Set((typeof o.apiAccounts === 'string' ? o.apiAccounts.split(',') : list(o.apiAccounts)).map((n) => str(n, 32).toLowerCase()).filter((n) => /^[a-z0-9][a-z0-9-]{0,31}$/.test(n)))],
  };
}

// ------------------------------------------------------------------ accounts

/**
 * One account as the pipeline sees it. `row` = a claude-workers status row ({ name, role, email, plan, limited, running[] }),
 * `own` = the pipeline's own record for it (accounts.json: { fable?, parallel?, use?, probe?: { fable, at, error } }).
 *   fable      may this account run Fable? override (own.fable) > a fresh probe > the plan (fablePlans)
 *   parallel   sessions at once: own.parallel > settings.parallelPerAccount
 *   usable     may the dispatcher put a build on it? never limited, never an API key, never one Brett switched off;
 *              workers always; the console's account only when no worker exists and useConsoleAccount is on
 */
export function accountView(row, own = {}, { settings = normSettings(), anyWorker = false, now = Date.now() } = {}) {
  const o = own && typeof own === 'object' ? own : {};
  const plan = str(row?.plan, 40).toLowerCase();
  const probe = o.probe && typeof o.probe === 'object' && typeof o.probe.fable === 'boolean' && now - Date.parse(o.probe.at || 0) < settings.probeDays * 86400e3 ? o.probe : null;
  const fable = typeof o.fable === 'boolean' ? o.fable : probe ? probe.fable : settings.fablePlans.includes(plan);
  const fableFrom = typeof o.fable === 'boolean' ? 'override' : probe ? 'probe' : plan ? 'plan' : 'unknown';
  const role = str(row?.role, 20) || 'saved';
  const running = list(row?.running).length;
  const parallel = Number.isInteger(o.parallel) && o.parallel > 0 ? Math.min(12, o.parallel) : settings.parallelPerAccount;
  const apiKey = row?.kind === 'api' || role === 'api-key' || role === 'api-worker' || role === 'api-off' || plan === 'api';
  const off = o.use === false;
  const limited = row?.limited && typeof row.limited === 'object' ? row.limited : null;
  // subscriptions only: an API account never takes a build by itself, only through routeFor() (override or overflow)
  const usable = !off && !apiKey && !limited && (role === 'worker' || (!anyWorker && settings.useConsoleAccount && (role === 'interactive' || role === 'saved')));
  let why = '';
  if (off) why = 'switched off for the pipeline';
  else if (limited) why = `${limited.reason === 'auth' ? 'login expired' : limited.reason || 'limited'} until ${str(limited.until, 40).slice(0, 16).replace('T', ' ')}`;
  else if (apiKey) why = 'API key (billed per token): takes a build only when routed there';
  else if (!usable) why = anyWorker ? 'not a worker (workers take every headless job)' : 'console account use is off';
  // API accounts: their own slot count (claude-workers building limit), Fable unless overridden (an API key reaches every model)
  const apiParallel = Number.isInteger(o.parallel) && o.parallel > 0 ? Math.min(12, o.parallel) : Number.isInteger(row?.building) && row.building > 0 ? row.building : settings.parallelPerAccount;
  const api = apiKey ? apiState(row, o, settings, { limited, apiParallel, running }) : null;
  return { name: str(row?.name, 40), email: str(row?.email, 200), plan, role, kind: apiKey ? 'api' : 'subscription', label: str(row?.label, 40),
    fable: apiKey && typeof o.fable !== 'boolean' && !probe ? true : fable, fableFrom: apiKey && typeof o.fable !== 'boolean' && !probe ? 'api' : fableFrom,
    parallel: apiKey ? apiParallel : parallel, running, free: Math.max(0, (apiKey ? apiParallel : parallel) - running), usable, why, limited, probe: probe ?? (o.probe ?? null), api };
}

/** May the dispatcher route a build to this API account now? { usable, why, spend } (why says what to do when it can't). */
export function apiState(row, own = {}, settings = normSettings(), { limited = null, apiParallel = 1, running = 0 } = {}) {
  const name = str(row?.name, 40);
  const spend = row?.spend && typeof row.spend === 'object' ? row.spend : null;
  let why = '';
  if (own?.use === false) why = 'switched off for the pipeline';
  else if (settings.apiAccounts.length && !settings.apiAccounts.includes(name)) why = 'not in the pipeline\'s API account list';
  else if (row?.hasKey === false) why = `no API key saved (Terminal → VPS host → claude-account savekey ${name})`;
  else if (row?.role === 'api-off') why = row?.why || 'not set up as an API worker (Claude accounts → Job routing → API accounts)';
  else if (limited) why = `${limited.reason === 'auth' ? 'key rejected' : limited.reason || 'limited'} until ${str(limited.until, 40).slice(0, 16).replace('T', ' ')}`;
  else if (spend?.state === 'capped') why = `spend cap reached: ${spend.why}`;
  else if (running >= apiParallel) why = `full (${running}/${apiParallel})`;
  return { usable: !why, why, spend };
}

/** Every account as the pipeline sees it; `rows` = claude-workers status rows, `own` = accounts.json. */
export function accountViews(rows, own = {}, opts = {}) {
  const anyWorker = list(rows).some((r) => r?.role === 'worker');
  return list(rows).map((r) => accountView(r, own?.[r?.name], { ...opts, anyWorker }));
}

/** Accounts that can take one more session on `model` now: Fable needs an account with Fable; fewest running first, Opus away from Fable accounts, workers before the console's account. */
export function candidates(accounts, model) {
  const needFable = modelKey(model) === FOUNDATION_MODEL;
  // Opus work goes to accounts without Fable first, so the Fable accounts stay free for Fable phases
  return list(accounts).filter((a) => a.usable && a.free > 0 && (!needFable || a.fable))
    .sort((a, b) => a.running - b.running || (needFable ? 0 : (a.fable ? 1 : 0) - (b.fable ? 1 : 0)) || (a.role === 'worker' ? 0 : 1) - (b.role === 'worker' ? 0 : 1));
}

/** API accounts that can take one more build on `model` now: least busy first, then the least spent today. */
export function apiCandidates(accounts, model) {
  const needFable = modelKey(model) === FOUNDATION_MODEL;
  return list(accounts).filter((a) => a.kind === 'api' && a.api?.usable && a.free > 0 && (!needFable || a.fable))
    .sort((a, b) => a.running - b.running || (Number(a.api?.spend?.day) || 0) - (Number(b.api?.spend?.day) || 0) || a.name.localeCompare(b.name));
}

/** Why no API account takes `model` right now: every API account and what keeps it out. */
export function apiNoAccountWhy(accounts, model) {
  const apis = list(accounts).filter((a) => a.kind === 'api');
  if (!apis.length) return 'no API account is set up (Claude accounts → Job routing → API accounts)';
  const needFable = modelKey(model) === FOUNDATION_MODEL;
  return `no API account can take it: ${apis.map((a) => `${a.name}: ${a.api?.why || (needFable && !a.fable ? `no ${MODEL_LABELS[FOUNDATION_MODEL]}` : 'full')}`).join('; ')}`;
}

/**
 * Where one build goes this tick: { account, kind, rule, why }. `rule` = override (pipeline.route api) | overflow
 * (settings.apiOverflow, every subscription account full or out) | '' (a subscription account, the normal case).
 * No account = account '' and `why` says what keeps each option out (a missing key, a cap, a full account).
 */
export function routeFor(b, accounts, model, settings = normSettings()) {
  const route = b?.pipeline?.route || '';
  if (route === 'api') {
    const a = apiCandidates(accounts, model)[0];
    return a ? { account: a.name, kind: 'api', rule: 'override', why: `routed to API account ${a.name} (this build is set to run on API)` } : { account: '', kind: '', rule: 'override', why: `set to run on API, ${apiNoAccountWhy(accounts, model)}` };
  }
  const sub = candidates(accounts, model)[0];
  if (sub) return { account: sub.name, kind: 'subscription', rule: '', why: '' };
  const subWhy = noAccountWhy(accounts, model);
  if (route === 'subscription') return { account: '', kind: '', rule: '', why: `${subWhy} (this build is kept off API accounts)` };
  const hasApi = list(accounts).some((a) => a.kind === 'api');
  if (!settings.apiOverflow) return { account: '', kind: '', rule: '', why: hasApi ? `${subWhy} (API overflow is off)` : subWhy };
  const a = apiCandidates(accounts, model)[0];
  return a ? { account: a.name, kind: 'api', rule: 'overflow', why: `every subscription account is full or out, so the overflow rule sends it to API account ${a.name}` }
    : { account: '', kind: '', rule: 'overflow', why: `${subWhy}; overflow: ${apiNoAccountWhy(accounts, model)}` };
}

/** Why no account takes `model` right now, in plain words. */
export function noAccountWhy(accounts, model) {
  const usable = list(accounts).filter((a) => a.usable);
  const needFable = modelKey(model) === FOUNDATION_MODEL;
  if (!usable.length) return list(accounts).length ? `no usable Claude account (${list(accounts).map((a) => `${a.name}: ${a.why || 'busy'}`).join('; ')})` : 'no Claude account is signed in on the VPS';
  const able = needFable ? usable.filter((a) => a.fable) : usable;
  if (!able.length) return `no account with ${MODEL_LABELS[FOUNDATION_MODEL]} (${usable.map((a) => a.name).join(', ')} ${usable.length === 1 ? 'has' : 'have'} none)`;
  return `${able.map((a) => `${a.name} ${a.running}/${a.parallel}`).join(', ')}: every ${needFable ? 'Fable ' : ''}account is at its parallel cap`;
}

// ------------------------------------------------------------------ the plan of one tick

/**
 * What one tick does. `builds` = live builds@1 records; `accounts` = accountViews(); `slots` = { free, used, cap } from
 * agent-slots; `rules` = the orchestrator rules. Returns { launches, waits, queue, idle }:
 *   launches  [{ id, account, model, phase }]  one per free slot, in Queue order
 *   waits     [{ id, why }]                    queued builds that stay put this tick, and why
 *   idle      null, or { reason, since? }      nothing is running while work waits
 */
export function plan({ builds, accounts, slots, settings = normSettings(), rules, now = Date.now() }) {
  const live = list(builds).filter((b) => !b.deleted);
  const queue = queueOrder(live, (b) => effectivePriority(b));
  const running = live.filter((b) => b.status === 'running' || b.status === 'waiting');
  const pending = live.filter((b) => b.status === 'pending' && !b.hidden);
  const acc = list(accounts).map((a) => ({ ...a }));
  let free = Math.max(0, Number(slots?.free) || 0);
  const launches = []; const waits = [];
  for (const b of queue) {
    if (!openSteps(b).length) { waits.push({ id: b.id, why: b.steps?.length ? 'every step is done: nothing to run' : 'no steps yet: waiting for the split' }); continue; }
    const n = orchNextUp(b, rules);
    if (n.needsApproval) { waits.push({ id: b.id, why: `needs Brett's approval: upgrade ${n.phase.from} → ${n.phase.model}` }); continue; }
    const model = nextModel(b);
    if (free <= 0) { waits.push({ id: b.id, why: `no free agent slot (${slots?.used ?? '?'}/${slots?.cap ?? '?'} in use)` }); continue; }
    const r = routeFor(b, acc, model, settings);
    const a = r.account ? acc.find((x) => x.name === r.account) : null;
    if (!a) { waits.push({ id: b.id, why: r.why }); continue; }
    a.running += 1; a.free -= 1; free -= 1;
    if (a.kind === 'api' && a.api && a.free <= 0) a.api = { ...a.api, usable: false, why: `full (${a.running}/${a.parallel})` };
    launches.push({ id: b.id, account: a.name, model, phase: n.phase?.name ?? '', priority: priorityLabel(effectivePriority(b)), kind: r.kind, rule: r.rule, why: r.why });
  }
  let idle = null;
  const nothingRunning = !running.length && !(Number(slots?.used) > 0);
  if (nothingRunning && !launches.length) {
    if (queue.length) idle = { reason: `${queue.length} build${queue.length === 1 ? '' : 's'} in the Queue, nothing running: ${waits[0]?.why ?? 'no launch this tick'}`, kind: 'stuck' };
    else if (pending.length) idle = { reason: `Queue empty, nothing running: ${pending.length} build${pending.length === 1 ? '' : 's'} wait in Pending for you to queue them`, kind: 'empty' };
  }
  return { launches, waits, queue: queue.map((b) => b.id), running: running.map((b) => b.id), pending: pending.length, idle, at: new Date(now).toISOString() };
}

// ------------------------------------------------------------------ session end

/** A run ended: the build's new status, its lastRun record and a note line. */
export function endOutcome(b, { exit, account = '', session = '', now = new Date().toISOString() } = {}, settings = normSettings()) {
  const stepsLeft = openSteps(b).length;
  const runs = (b.pipeline?.runs ?? 0) || 1;
  const phaseSwitch = stepsLeft > 0 && !!b.pipeline?.model && nextModel(b) !== b.pipeline.model;
  const outcome = outcomeOf({ exit, stepsLeft, runs, phaseSwitch }, settings.maxRuns);
  const run = { at: now, exit: Number.isInteger(exit) ? exit : null, outcome, stepsLeft, account: account || b.pipeline?.account || '', session: session || b.pipeline?.session || '' };
  let status = STATUS_AFTER[outcome];
  if (outcome === 'finished') status = b.pr && !b.mergedAt ? 'built' : 'complete';
  return { outcome, status, run, note: outcomeLine({ ...b, pipeline: { ...(b.pipeline ?? {}), runs } }, run) };
}

// ------------------------------------------------------------------ split

/** The one-shot prompt the orchestrator sends to Claude to split a build. The answer must be JSON only. */
export function splitPrompt(b, rules = { maxStepMinutes: 30 }) {
  const max = rules.maxStepMinutes || 30;
  const said = str(b.origin?.said, 6000).trim();
  const addenda = list(b.origin?.addenda).map((a, i) => `Addendum ${i + 1}: ${str(a.said, 2000)}`).join('\n');
  return [
    `You are the AmberX AXF build orchestrator. Split the build below into small steps a headless Claude Code session does one after another in one repo checkout.`,
    `Rules: every step ${max} minutes or less, with an estimate; 3 to 20 steps; each step is one concrete piece of work naming the files or folders it touches; the last step is tests, report (_claude/builds/reports/<build id>.md), THREADS row and PR.`,
    `API rule: ${API_RULE} So every step that adds or changes UI names its API part (deep link, state read, actions, settings; REST + MCP + CLI + voice) in the same step or the step right after it.`,
    `Model per step, Opus by default. Fable ONLY for: ${MODEL_GUIDE.Fable} Opus for: ${MODEL_GUIDE.Opus} Put Fable steps first when the work allows, so the build switches model at most once.`,
    `Answer with JSON only, no prose: {"steps":[{"text":"…","model":"Fable|Opus","estimate":"<n> min","why":"<one line when Fable>","files":["…"]}]}`,
    '', `Build id: ${b.id}`, `Title: ${str(b.title, 300)}`, b.category ? `Category: ${str(b.category, 60)}` : '', b.detail ? `Details:\n${str(b.detail, 8000)}` : '',
    said ? `Brett said (verbatim):\n${said}` : '', addenda,
  ].filter(Boolean).join('\n');
}

const EST_RE = /^\s*(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)?\s*$/i;
/** Claude's answer → steps, or an error. Accepts the JSON object alone or inside other text; refuses steps over the limit. */
export function parseSplit(text, rules = { maxStepMinutes: 30 }) {
  const max = rules.maxStepMinutes || 30;
  const s = str(text, 200000);
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return { steps: [], error: 'no JSON object in the answer' };
  let j;
  try { j = JSON.parse(s.slice(start, end + 1)); } catch (e) { return { steps: [], error: `not JSON: ${e.message}` }; }
  const raw = list(j?.steps);
  if (raw.length < 1) return { steps: [], error: 'no steps in the answer' };
  if (raw.length > 40) return { steps: [], error: `${raw.length} steps: too many (40 at most)` };
  const steps = []; const problems = [];
  raw.forEach((r, i) => {
    const text = str(r?.text ?? r?.title, 2000).trim();
    if (text.length < 5) { problems.push(`step ${i + 1} has no text`); return; }
    const est = typeof r?.estimate === 'number' ? `${Math.round(r.estimate)} min` : str(r?.estimate, 20).trim();
    const m = EST_RE.exec(est); const minutes = m ? Math.round(Number(m[1]) * (/^h/i.test(m[2] || '') ? 60 : 1)) : null;
    if (minutes == null) problems.push(`step ${i + 1} has no estimate`); else if (minutes > max) problems.push(`step ${i + 1} is ${minutes} min (limit ${max})`);
    const model = modelKey(r?.model) === FOUNDATION_MODEL ? 'Fable' : 'Opus';
    steps.push({ id: `s${i + 1}`, text, model, estimate: minutes != null ? `${minutes} min` : '', why: str(r?.why, 300), files: list(r?.files).map((f) => str(f, 300)).filter(Boolean).slice(0, 30), checks: list(r?.checks).map((f) => str(f, 300)).filter(Boolean).slice(0, 20) });
  });
  return problems.length ? { steps, error: problems.join('; ') } : { steps, error: '' };
}

/**
 * Steps without a model: one per numbered line, bullet or sentence of the detail (and Brett's words when the detail
 * is bare), each ${max} min, Fable when its words name foundation work; a closing test + report + PR step. Marked for
 * review: it is the fallback when no model can be asked (`split.provider: rules`).
 */
export function rulesSplit(b, rules = { maxStepMinutes: 30 }) {
  const max = Math.min(30, rules.maxStepMinutes || 30);
  const source = `${str(b.detail, 8000)}\n${str(b.origin?.said, 6000)}`.trim() || str(b.title, 300);
  let parts = source.split(/\n+/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter((l) => l.length >= 12);
  if (parts.length < 2) parts = source.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z])/).map((x) => x.trim()).filter((x) => x.length >= 12);
  if (!parts.length) parts = [str(b.title, 300)];
  const seen = new Set();
  parts = parts.filter((p) => { const k = p.toLowerCase().slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 19);
  const steps = parts.map((text, i) => ({ id: `s${i + 1}`, text: text.slice(0, 2000), model: modelForWork(text) === FOUNDATION_MODEL ? 'Fable' : 'Opus', estimate: `${max} min`, why: modelForWork(text) === FOUNDATION_MODEL ? 'foundation words in the step' : '', files: [], checks: [] }));
  // Fable first so the build switches model once at most (a downgrade needs nobody)
  steps.sort((a, c) => (a.model === 'Fable' ? 0 : 1) - (c.model === 'Fable' ? 0 : 1));
  steps.forEach((s, i) => { s.id = `s${i + 1}`; });
  steps.push({ id: `s${steps.length + 1}`, text: `Tests green, report _claude/builds/reports/${b.id}.md, THREADS row, commit, push, PR`, model: 'Opus', estimate: `${Math.min(max, 20)} min`, why: '', files: [`_claude/builds/reports/${b.id}.md`, '_claude/THREADS.md'], checks: [] });
  return steps;
}

/** Does this build still need the orchestrator's split? (no steps, or steps over the limit / without estimates) */
export function needsSplit(b, rules = { maxStepMinutes: 30 }) {
  if (!b || ['built', 'complete', 'archived', 'failed'].includes(b.status) || b.deleted) return false;
  if (!list(b.steps).length) return true;
  const max = rules.maxStepMinutes || 30;
  return list(b.steps).some((s) => !s.done && (estimateMinutes(s.estimate) == null || estimateMinutes(s.estimate) > max));
}

// ------------------------------------------------------------------ alerts (the console alerts API; types in notify.json)

export const ALERT_SOURCE = 'pipeline';
export const ALERT_LINK = '#/build-orchestrator';
/**
 * The payload POST /api/alerts takes. kind = idle | launched | ended | failed | split. `key` makes repeats bump a count
 * instead of a new alert, and lets the dispatcher resolve one (idle) when a build runs again. Key prefixes are what
 * notify.json's types match on: pipeline:idle, pipeline:run:<id> (started), pipeline:end:<id> (ended / failed), pipeline:split:<id>.
 */
export function alertFor(kind, d = {}) {
  const base = { source: ALERT_SOURCE, link: ALERT_LINK, meta: { kind, build: d.id ?? '', account: d.account ?? '' } };
  switch (kind) {
    case 'idle': return { ...base, key: 'pipeline:idle', severity: d.kind === 'empty' ? 'info' : 'warning', title: d.kind === 'empty' ? 'Nothing is building: the Queue is empty' : 'Nothing is building while the Queue has work', body: str(d.reason, 1500) };
    case 'launched': return { ...base, key: `pipeline:run:${d.id}`, severity: 'info', title: `Building: ${str(d.title, 120)}`, body: `Started on ${d.account} (${d.model}${d.phase ? `, ${d.phase}` : ''}) · session ${d.session || ''}`.trim() };
    case 'ended': return { ...base, key: `pipeline:end:${d.id}`, severity: d.outcome === 'finished' ? 'success' : 'warning', title: `${d.outcome === 'finished' ? 'Built' : d.outcome === 'requeued' ? 'Back in the Queue' : 'Needs something'}: ${str(d.title, 120)}`, body: str(d.note, 1500) };
    case 'failed': return { ...base, key: `pipeline:end:${d.id}`, severity: 'error', title: `Build failed: ${str(d.title, 120)}`, body: str(d.note, 1500) };
    case 'split': return { ...base, key: `pipeline:split:${d.id}`, severity: d.error ? 'warning' : 'info', title: d.error ? `Split needs a look: ${str(d.title, 120)}` : `Split into ${d.steps} steps: ${str(d.title, 120)}`, body: str(d.error || d.note, 1500) };
    default: throw new Error(`unknown alert kind ${kind}`);
  }
}

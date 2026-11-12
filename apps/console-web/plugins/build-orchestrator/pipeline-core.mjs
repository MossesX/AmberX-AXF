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
 *              apiOverflow, on by default since Nov 10 2026: every subscription account full or out → an API account). An API account
 *              takes a build only when it has a key, is switched on, is under its daily and weekly caps and has room;
 *              otherwise it is skipped and the reason is said (apiNoAccountWhy()).
 *   order      (Brett, Nov 10 2026: "Subscriptions first, then any API") every subscription account in Brett's order
 *              (the Claude Accounts Manager's drag-and-drop order: row.order / own.order, lower first), then every API
 *              account. apiOverflow is on by default; a build set to Subscriptions never reaches API, one set to API
 *              never takes a subscription. routeOptions() is the whole ordered list; the dispatcher walks it until an
 *              account accepts the launch (what it believed about one may turn out wrong).
 *   planning   planFor(): as soon as a build is split the orchestrator plans its model and account (pipeline.planned);
 *              the final pick happens when its turn comes in the Queue and is recorded (pipeline.account, pickedAt).
 *   health     (Brett: "Every five minutes a background headless session that doesn't affect any builds or sign
 *              anything out checks all the accounts: can get in, have credits, can accept the Fable model.")
 *              healthOf() reads one tiny call's answer; a fresh health record (own.health) decides usable / Fable,
 *              so the dispatcher never tests an account at launch time. healthDue() says when the next sweep runs.
 */
import { DEFAULT_MAX_RUNS, STATUS_AFTER, isHeld, nextModel, openSteps, outcomeLine, outcomeOf, queueOrder } from '../../../../framework/core/build-pipeline.mjs';
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
  /** Subscriptions first, then any API account (Brett, Nov 10 2026): when no subscription account can take a build, an API-key account takes it (billed per token, under its caps). */
  apiOverflow: true,
  /** API accounts the dispatcher may use ([] = every API worker in claude-workers@1). */
  apiAccounts: [],
  /** The account health sweep runs this often (minutes; 0 = off). */
  healthEveryMin: 5,
});
const LIMITS = { parallelPerAccount: [1, 12], maxRuns: [1, 10], idleAfterMin: [0, 240], probeDays: [1, 90], healthEveryMin: [0, 120] };
/** A health record older than this many sweeps is stale: the account falls back to its probe / plan. */
const HEALTH_STALE_SWEEPS = 4;

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
    apiOverflow: o.apiOverflow === undefined ? DEFAULTS.apiOverflow : o.apiOverflow === true,
    healthEveryMin: o.healthEveryMin === undefined ? DEFAULTS.healthEveryMin : clamp('healthEveryMin', o.healthEveryMin),
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
  const health = freshHealth(o.health, settings, now);
  // a fresh health answer about Fable beats an older probe (an auth or credit failure says nothing about Fable)
  const hp = health && typeof health.fable === 'boolean' ? { fable: health.fable, at: health.at, error: health.error } : null;
  const probe = hp ?? (o.probe && typeof o.probe === 'object' && typeof o.probe.fable === 'boolean' && now - Date.parse(o.probe.at || 0) < settings.probeDays * 86400e3 ? o.probe : null);
  const fable = typeof o.fable === 'boolean' ? o.fable : probe ? probe.fable : settings.fablePlans.includes(plan);
  const fableFrom = typeof o.fable === 'boolean' ? 'override' : hp ? 'health' : probe ? 'probe' : plan ? 'plan' : 'unknown';
  const role = str(row?.role, 20) || 'saved';
  const running = list(row?.running).length;
  const parallel = Number.isInteger(o.parallel) && o.parallel > 0 ? Math.min(12, o.parallel) : settings.parallelPerAccount;
  const apiKey = row?.kind === 'api' || role === 'api-key' || role === 'api-worker' || role === 'api-off' || plan === 'api';
  const off = o.use === false;
  const sick = health && (health.signedIn === false || health.credits === false)
    ? { kind: health.signedIn === false ? 'auth' : 'credits', reason: health.signedIn === false ? 'cannot sign in (health check)' : 'no credits left (health check)', until: '' } : null;
  const limited = row?.limited && typeof row.limited === 'object' ? row.limited : sick;
  // subscriptions only: an API account never takes a build by itself, only through routeFor() (override or overflow)
  const usable = !off && !apiKey && !limited && (role === 'worker' || (!anyWorker && settings.useConsoleAccount && (role === 'interactive' || role === 'saved')));
  let why = '';
  if (off) why = 'switched off for the pipeline';
  else if (limited) why = `${limited.reason === 'auth' ? 'login expired' : limited.reason || 'limited'}${limited.until ? ` until ${str(limited.until, 40).slice(0, 16).replace('T', ' ')}` : ''}`;
  else if (apiKey) why = 'API key (billed per token): takes a build only when routed there';
  else if (!usable) why = anyWorker ? 'not a worker (workers take every headless job)' : 'console account use is off';
  // API accounts: their own slot count (claude-workers building limit), Fable unless overridden (an API key reaches every model)
  const apiParallel = Number.isInteger(o.parallel) && o.parallel > 0 ? Math.min(12, o.parallel) : Number.isInteger(row?.building) && row.building > 0 ? row.building : settings.parallelPerAccount;
  const api = apiKey ? apiState(row, o, settings, { limited, apiParallel, running }) : null;
  const rawOrder = o.order ?? row?.order;
  const order = typeof rawOrder === 'number' && Number.isFinite(rawOrder) ? rawOrder : null;
  return { name: str(row?.name, 40), email: str(row?.email, 200), plan, role, kind: apiKey ? 'api' : 'subscription', label: str(row?.label, 40), order, health: health ?? (o.health && typeof o.health === 'object' ? o.health : null),
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
  else if (limited) why = `${limited.reason === 'auth' ? 'key rejected' : limited.reason || 'limited'}${limited.until ? ` until ${str(limited.until, 40).slice(0, 16).replace('T', ' ')}` : ''}`;
  else if (spend?.state === 'capped') why = `spend cap reached: ${spend.why}`;
  else if (running >= apiParallel) why = `full (${running}/${apiParallel})`;
  return { usable: !why, why, spend };
}

/** Every account as the pipeline sees it; `rows` = claude-workers status rows, `own` = accounts.json. */
export function accountViews(rows, own = {}, opts = {}) {
  const anyWorker = list(rows).some((r) => r?.role === 'worker');
  return list(rows).map((r) => accountView(r, own?.[r?.name], { ...opts, anyWorker }));
}

/** Brett's account order (Claude Accounts Manager drag-and-drop): ordered accounts first, lower first; unordered keep the old rules. */
const byOrder = (a, b) => (a.order == null ? 1 : 0) - (b.order == null ? 1 : 0) || (a.order != null && b.order != null ? a.order - b.order : 0);

/** Accounts that can take one more session on `model` now: Fable needs an account with Fable; Brett's order first, then fewest running, Opus away from Fable accounts, workers before the console's account. */
export function candidates(accounts, model) {
  const needFable = modelKey(model) === FOUNDATION_MODEL;
  // Opus work goes to accounts without Fable first, so the Fable accounts stay free for Fable phases
  return list(accounts).filter((a) => a.usable && a.free > 0 && (!needFable || a.fable))
    .sort((a, b) => byOrder(a, b) || a.running - b.running || (needFable ? 0 : (a.fable ? 1 : 0) - (b.fable ? 1 : 0)) || (a.role === 'worker' ? 0 : 1) - (b.role === 'worker' ? 0 : 1));
}

/** API accounts that can take one more build on `model` now: least busy first, then the least spent today. */
export function apiCandidates(accounts, model) {
  const needFable = modelKey(model) === FOUNDATION_MODEL;
  return list(accounts).filter((a) => a.kind === 'api' && a.api?.usable && a.free > 0 && (!needFable || a.fable))
    .sort((a, b) => byOrder(a, b) || a.running - b.running || (Number(a.api?.spend?.day) || 0) - (Number(b.api?.spend?.day) || 0) || a.name.localeCompare(b.name));
}

/**
 * Every account that may take this build's next phase now, in the order the final pick tries them: subscriptions
 * first (Brett's order), then API accounts (unless the build is kept off API, or overflow is switched off). A build set
 * to API only lists API accounts. [{ account, kind, rule, why }]
 */
export function routeOptions(b, accounts, model, settings = normSettings()) {
  const route = b?.pipeline?.route || '';
  const subs = route === 'api' ? [] : candidates(accounts, model).map((a) => ({ account: a.name, kind: 'subscription', rule: '', why: '' }));
  const apiOk = route === 'api' || (route !== 'subscription' && settings.apiOverflow);
  const apis = apiOk ? apiCandidates(accounts, model).map((a) => ({ account: a.name, kind: 'api', rule: route === 'api' ? 'override' : 'overflow',
    why: route === 'api' ? `routed to API account ${a.name} (this build is set to run on API)` : `every subscription account is full or out, so it goes to API account ${a.name}` })) : [];
  return [...subs, ...apis];
}

/**
 * The orchestrator's plan for a build, made as soon as it is split (pipeline.planned): the model of its next phase
 * and the account it expects to take it (the first that could, ignoring how busy it is now). The final pick, when the
 * build's turn comes, can differ; both are recorded.
 */
export function planFor(b, accounts, settings = normSettings(), now = new Date().toISOString()) {
  const model = nextModel(b);
  if (!model) return null;
  // planning ignores who is busy right now: everyone gets a free slot for the guess
  const roomy = list(accounts).map((a) => ({ ...a, free: Math.max(1, a.free), api: a.api ? { ...a.api, usable: a.api.usable || /^full/.test(a.api.why || ''), why: /^full/.test(a.api.why || '') ? '' : a.api.why } : a.api }));
  const r = routeOptions(b, roomy, model, settings)[0];
  return { model, account: r?.account ?? '', kind: r?.kind ?? '', at: now, why: r ? (r.why || `subscription account ${r.account}`) : routeFor(b, roomy, model, settings).why };
}

// ------------------------------------------------------------------ account health

const healthOk = (h) => h && typeof h === 'object' && Number.isFinite(Date.parse(h.at || ''));
/** The account's health record when it is fresh enough to trust (a few sweeps old at most), else null. */
export function freshHealth(h, settings = normSettings(), now = Date.now()) {
  if (!healthOk(h) || !settings.healthEveryMin) return null;
  return now - Date.parse(h.at) <= settings.healthEveryMin * HEALTH_STALE_SWEEPS * 60e3 ? h : null;
}

/** Is a health sweep due? `last` = the ISO of the last sweep's start ('' = never). */
export function healthDue(last, settings = normSettings(), now = Date.now()) {
  if (!settings.healthEveryMin) return false;
  const t = Date.parse(last || '');
  return !Number.isFinite(t) || now - t >= settings.healthEveryMin * 60e3;
}

/**
 * Read one health call's answer (claude -p on Fable, one turn, no tools) into { signedIn, credits, fable, error }.
 * `null` = the call did not say (a timeout or a crash says nothing about the account).
 */
export function healthOf({ status = null, out = '', error = '' } = {}) {
  const t = `${out || ''} ${error || ''}`;
  const auth = /invalid api key|authentication|unauthori[sz]ed|oauth token|token (has )?expired|please run \/login|not logged in|log ?in again|401\b|invalid x-api-key/i.test(t);
  const credits = /credit balance|out of credits|insufficient (credit|fund|quota)|usage limit|limit reached|rate limit|quota|billing|payment required|402\b|429\b/i.test(t);
  const model = /not available|no access|does not exist|invalid model|model.*not found|not_found_error|permission to use/i.test(t);
  // a clean exit whose JSON answer is not an error = signed in, credits left, Fable accepted (the answer text is never matched)
  if (status === 0 && !/"is_error"\s*:\s*true/.test(out)) return { signedIn: true, credits: true, fable: true, error: '' };
  const line = str(t.trim().split('\n').filter(Boolean).pop() || error || `exit ${status}`, 200);
  if (auth) return { signedIn: false, credits: null, fable: null, error: line };
  if (credits) return { signedIn: true, credits: false, fable: null, error: line };
  if (model) return { signedIn: true, credits: true, fable: false, error: line };
  return { signedIn: null, credits: null, fable: null, error: line };
}

/** One line for the health of every account: "4 accounts: 3 ok, 1 can't sign in". */
export function healthSummary(rows) {
  const r = list(rows);
  const bad = (x) => x.signedIn === false ? 'can\'t sign in' : x.credits === false ? 'no credits' : x.fable === false ? 'no Fable' : x.signedIn == null ? 'no answer' : '';
  const problems = r.filter((x) => bad(x)).map((x) => `${x.name}: ${bad(x)}${x.error ? ` (${x.error})` : ''}`);
  return { line: r.length ? `${r.length} accounts: ${r.length - problems.length} ok${problems.length ? `, ${problems.length} not` : ''}` : 'no Claude account found', problems };
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
export function plan({ builds, accounts, slots, settings = normSettings(), rules, now = Date.now(), checks = {} }) {
  const live = list(builds).filter((b) => !b.deleted);
  const queue = queueOrder(live, (b) => effectivePriority(b));
  const running = live.filter((b) => b.status === 'running' || b.status === 'waiting');
  const pending = live.filter((b) => b.status === 'pending' && !b.hidden);
  const acc = list(accounts).map((a) => ({ ...a }));
  let free = Math.max(0, Number(slots?.free) || 0);
  const launches = []; const waits = [];
  for (const b of queue) {
    // only Queued builds take slots (Brett, Nov 12 2026): never a Pending one, whatever else the record says
    if (b.status !== 'queued') continue;
    if (isHeld(b)) { waits.push({ id: b.id, why: `on hold${b.pipeline.heldBy ? ` (${b.pipeline.heldBy})` : ''}: skipped until released`, held: true }); continue; }
    if (!openSteps(b).length) { waits.push({ id: b.id, why: b.steps?.length ? 'every step is done: nothing to run' : 'no steps yet: waiting for the split' }); continue; }
    // the split found shipped work this build would redo, change or conflict with: Brett was told; it waits for his go
    if (shippedHolds(checks?.[b.id])) { waits.push({ id: b.id, why: `waiting for Brett: ${shippedLine(checks[b.id])} (shipped-ack ${b.id} to go on)`, shipped: true }); continue; }
    const n = orchNextUp(b, rules);
    if (n.needsApproval) { waits.push({ id: b.id, why: `needs Brett's approval: upgrade ${n.phase.from} → ${n.phase.model}` }); continue; }
    const model = nextModel(b);
    if (free <= 0) { waits.push({ id: b.id, why: slots?.hard?.max && Number(slots.hard.free) <= 0 ? `VPS hard build limit reached (${slots.hard.live ?? '?'}/${slots.hard.max} running)` : `no free agent slot (${slots?.used ?? '?'}/${slots?.cap ?? '?'} in use)` }); continue; }
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
    const active = queue.filter((b) => !isHeld(b)); const firstWait = waits.find((w) => !w.held);
    if (active.length) idle = { reason: `${active.length} build${active.length === 1 ? '' : 's'} in the Queue, nothing running: ${firstWait?.why ?? 'no launch this tick'}`, kind: 'stuck' };
    else if (pending.length) idle = { reason: `Queue empty, nothing running: ${pending.length} build${pending.length === 1 ? '' : 's'} wait in Pending for you to queue them`, kind: 'empty' };
  }
  return { launches, waits, queue: queue.map((b) => b.id), held: queue.filter(isHeld).map((b) => b.id), running: running.map((b) => b.id), pending: pending.length, idle, at: new Date(now).toISOString() };
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

// ------------------------------------------------------------------ shipped features check (before every split)

/**
 * Brett, Nov 12 2026: "when he receives a job, he splits it up into steps. And when he does that, he needs to check with
 * the shipped features... make sure he's not doing something twice or fucking up something that's already been done and
 * if it's gonna conflict with something or change something that's already built he's gonna let me know".
 *
 *   shippedContext()  the shipped builds (shipped-manifest@1, one per landed build) most related to a job: they go into the
 *                     split prompt so Claude plans around them and flags any step that redoes, changes or conflicts with one
 *   shippedCheck()    the verdict on a split: Claude's flags plus the orchestrator's own matching (a job or a step whose
 *                     words match a shipped build's title). verdict = clear | needs-brett. needs-brett = an AmberX alert and
 *                     the build does not start until Brett acknowledges it (shipped-ack); file overlap alone is listed
 *                     (touches) and never holds a build.
 */
export const SHIPPED_CHECK = 'shipped-check@1';
export const SHIPPED_KINDS = ['duplicate', 'changes', 'conflicts'];
const STOP = new Set(('the and for with that this from into when then them they have has been were will just also make made only every each what which your about there their should would could need needs onto over under than more most some such like want wants gonna going build builds step steps brett said fine right sure thing things know mean really else here where while after before first last next same other another able well back good does doing done keep goes come comes give gets cant dont isnt thats show shows actually').split(' '));
/** The significant words of a text (4+ letters, no filler). */
export const words = (t) => new Set(str(t, 20000).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 4 && !STOP.has(w)));
/** Dice similarity of two word sets (0..1). */
export const dice = (a, c) => { if (!a.size || !c.size) return 0; let n = 0; for (const w of a) if (c.has(w)) n += 1; return (2 * n) / (a.size + c.size); };
/** Files every build touches (bookkeeping): never a sign that two builds overlap. */
const BOOKKEEPING = /^(_claude\/|changes\/|sessions\/|framework\/spec\/fixtures\/|framework\/catalog\/|framework\/schemas\/json\/|framework\/schemas\/[a-z-]+\.json$)|(^|\/)(THREADS|STATUS|README|CHANGELOG)\.md$|(package-lock|pnpm-lock)\.(json|yaml)$|\.axf-brief\.md$|\.(log|jsonl)$/;
export const ownFiles = (files) => list(files).map((f) => str(f, 300)).filter((f) => f && !BOOKKEEPING.test(f));
const mWords = (m) => words(`${m.build?.title} ${str(m.said?.text, 4000)}`);
const jobWords = (b) => words(`${b.title} ${str(b.detail, 8000)} ${str(b.origin?.said, 6000)} ${list(b.origin?.addenda).map((a) => str(a?.said, 2000)).join(' ')}`);

/** The shipped builds most related to a job (never the job itself), best first: { id, title, said, landedAt, pr, files, score }. */
export function shippedContext(b, manifests, { max = 12, min = 0.12 } = {}) {
  const jw = jobWords(b); const tw = words(b.title);
  return list(manifests)
    .filter((m) => m?.build?.id && m.build.id !== b.id && !(b.branch && m.branch === b.branch))
    .map((m) => ({ m, score: Math.max(dice(jw, mWords(m)), dice(tw, words(m.build.title))) }))
    .filter((x) => x.score >= min)
    .sort((x, y) => y.score - x.score || x.m.build.id.localeCompare(y.m.build.id))
    .slice(0, max)
    .map(({ m, score }) => ({ id: m.build.id, title: str(m.build.title, 200), said: str(m.said?.text, 300).replace(/\s+/g, ' ').trim(), landedAt: str(m.landedAt || m.mergedAt, 10), pr: m.pr?.number || 0, files: ownFiles(m.files).slice(0, 12), score: Math.round(score * 100) / 100 }));
}

/** The split prompt's block on shipped features ('' when nothing related has shipped). */
export function shippedPromptBlock(ctx) {
  if (!list(ctx).length) return '';
  return [
    `Shipped features: these builds already landed (the Shipped features ledger). Check this build against them BEFORE you split it: never plan a step that builds one of them again, and never redo or break one.`,
    `When a step would change how one of them works, remove it, or conflict with it, say so on that step: "shipped":[{"id":"<shipped build id>","kind":"changes|conflicts|duplicate","why":"<one line>"}]. Adding something next to a shipped feature is not a change; leave those unflagged.`,
    `If the whole build is already shipped, answer {"alreadyShipped":"<shipped build id>","why":"<one line>","steps":[]}.`,
    ...ctx.map((c) => `- ${c.id}: ${c.title}${c.landedAt ? ` (landed ${c.landedAt}${c.pr ? `, PR #${c.pr}` : ''})` : ''}${c.said && c.said !== c.title ? ` · Brett: "${c.said.slice(0, 200)}"` : ''}${c.files.length ? ` · files: ${c.files.slice(0, 8).join(', ')}` : ''}`),
  ].join('\n');
}

/**
 * The verdict on a split. `steps` = the split's steps (with files); `flags` = Claude's per-step flags ([{ step, id, kind, why }]);
 * `alreadyShipped` = Claude's whole-build answer ({ id, why }) or null. Returns a shipped-check@1 record.
 */
export function shippedCheck(b, steps, manifests, { flags = [], alreadyShipped = null, now = new Date().toISOString(), provider = '' } = {}) {
  const all = list(manifests).filter((m) => m?.build?.id && m.build.id !== b.id && !(b.branch && m.branch === b.branch));
  const byId = new Map(all.map((m) => [m.build.id, m]));
  const findings = []; const seen = new Set();
  const add = (f) => { const k = `${f.kind}|${f.step}|${f.ship}`; if (seen.has(k)) return; seen.add(k); findings.push(f); };
  const titleOf = (id) => str(byId.get(id)?.build?.title, 200);
  if (alreadyShipped?.id) add({ kind: 'duplicate', step: '', ship: str(alreadyShipped.id, 120), title: titleOf(alreadyShipped.id), why: str(alreadyShipped.why, 300) || 'Claude: the whole build is already shipped', by: 'claude' });
  // the orchestrator's own match: the job's title against every shipped title, and Brett's words against theirs
  const tw = words(b.title); const sw = words(b.origin?.said);
  for (const m of all) {
    const t = dice(tw, words(m.build.title)); const s = sw.size >= 6 ? dice(sw, words(m.said?.text)) : 0;
    // Brett's words alone are not enough: builds split off one request share them (the title must be alike too)
    if (t >= 0.8 || (t >= 0.6 && s >= 0.6) || (t >= 0.4 && s >= 0.85)) add({ kind: 'duplicate', step: '', ship: m.build.id, title: str(m.build.title, 200), why: `same job as shipped "${str(m.build.title, 120)}" (title ${Math.round(t * 100)}%, words ${Math.round(s * 100)}% alike)`, by: 'orchestrator' });
  }
  for (const f of list(flags)) {
    const kind = SHIPPED_KINDS.includes(f?.kind) ? f.kind : 'changes'; const id = str(f?.id, 120).trim(); if (!id) continue;
    add({ kind, step: str(f.step, 10), ship: id, title: titleOf(id), why: str(f.why, 300), by: 'claude' });
  }
  const touches = [];
  for (const st of list(steps)) {
    const sw2 = words(st.text);
    for (const m of all) {
      // a step that is word for word a shipped build is a redo
      if (sw2.size >= 3 && dice(sw2, words(m.build.title)) >= 0.75) add({ kind: 'duplicate', step: str(st.id, 10), ship: m.build.id, title: str(m.build.title, 200), why: `step ${st.id} matches shipped "${str(m.build.title, 120)}"`, by: 'orchestrator' });
      const mf = new Set(ownFiles(m.files)); const shared = ownFiles(st.files).filter((f) => mf.has(f));
      if (shared.length) touches.push({ step: str(st.id, 10), ship: m.build.id, title: str(m.build.title, 200), files: shared.slice(0, 10) });
    }
  }
  const verdict = findings.length ? 'needs-brett' : 'clear';
  return { $axf: SHIPPED_CHECK, build: b.id, at: now, provider: str(provider, 20), ledger: all.length, verdict, findings: findings.slice(0, 30), touches: touches.slice(0, 40), line: shippedLine({ verdict, findings, touches, ledger: all.length }), ackedAt: '', ackedBy: '', ackWhy: '' };
}

const KIND_WORD = { duplicate: 'already built', changes: 'changes', conflicts: 'conflicts with' };
/** One line for a check (notes, waits, the alert title). */
export function shippedLine(c) {
  if (!c) return 'not checked against Shipped features yet';
  if (c.verdict !== 'needs-brett') return `checked against ${c.ledger} shipped builds: nothing done twice, nothing shipped changed${list(c.touches).length ? ` (${new Set(list(c.touches).map((t) => t.ship)).size} share files, listed)` : ''}`;
  const f = list(c.findings);
  return `${f.length} shipped feature${f.length === 1 ? '' : 's'} affected: ${f.slice(0, 3).map((x) => `${x.step ? `${x.step} ` : ''}${KIND_WORD[x.kind] || x.kind} ${x.ship}`).join('; ')}${f.length > 3 ? '; …' : ''}`;
}
/** Does this check hold the build until Brett says go? */
export const shippedHolds = (c) => !!c && c.verdict === 'needs-brett' && !c.ackedAt;

/** The one-shot prompt the orchestrator sends to Claude to split a build. The answer must be JSON only. */
export function splitPrompt(b, rules = { maxStepMinutes: 30 }, shipped = []) {
  const max = rules.maxStepMinutes || 30;
  const said = str(b.origin?.said, 6000).trim();
  const addenda = list(b.origin?.addenda).map((a, i) => `Addendum ${i + 1}: ${str(a.said, 2000)}`).join('\n');
  const shippedBlock = shippedPromptBlock(shipped);
  return [
    `You are the AmberX AXF build orchestrator. Split the build below into small steps a headless Claude Code session does one after another in one repo checkout.`,
    `Rules: every step ${max} minutes or less, with an estimate; 3 to 20 steps; each step is one concrete piece of work naming the files or folders it touches; the last step is tests, report (_claude/builds/reports/<build id>.md), THREADS row and PR.`,
    `API rule: ${API_RULE} So every step that adds or changes UI names its API part (deep link, state read, actions, settings; REST + MCP + CLI + voice) in the same step or the step right after it.`,
    `Model per step, Opus by default. Fable ONLY for: ${MODEL_GUIDE.Fable} Opus for: ${MODEL_GUIDE.Opus} Put Fable steps first when the work allows, so the build switches model at most once.`,
    `Answer with JSON only, no prose: {"steps":[{"text":"…","model":"Fable|Opus","estimate":"<n> min","why":"<one line when Fable>","files":["…"]${shippedBlock ? ',"shipped":[]' : ''}}]}`,
    shippedBlock ? `\n${shippedBlock}` : '',
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
  const alreadyShipped = str(j?.alreadyShipped, 120).trim() ? { id: str(j.alreadyShipped, 120).trim(), why: str(j?.why, 300) } : null;
  if (raw.length < 1) return alreadyShipped ? { steps: [], error: '', alreadyShipped, flags: [] } : { steps: [], error: 'no steps in the answer' };
  if (raw.length > 40) return { steps: [], error: `${raw.length} steps: too many (40 at most)` };
  const steps = []; const problems = []; const flags = [];
  raw.forEach((r, i) => {
    for (const f of list(r?.shipped)) if (f && typeof f === 'object' && str(f.id, 120).trim()) flags.push({ step: `s${i + 1}`, id: str(f.id, 120).trim(), kind: SHIPPED_KINDS.includes(f.kind) ? f.kind : 'changes', why: str(f.why, 300) });
    const text = str(r?.text ?? r?.title, 2000).trim();
    if (text.length < 5) { problems.push(`step ${i + 1} has no text`); return; }
    const est = typeof r?.estimate === 'number' ? `${Math.round(r.estimate)} min` : str(r?.estimate, 20).trim();
    const m = EST_RE.exec(est); const minutes = m ? Math.round(Number(m[1]) * (/^h/i.test(m[2] || '') ? 60 : 1)) : null;
    if (minutes == null) problems.push(`step ${i + 1} has no estimate`); else if (minutes > max) problems.push(`step ${i + 1} is ${minutes} min (limit ${max})`);
    const model = modelKey(r?.model) === FOUNDATION_MODEL ? 'Fable' : 'Opus';
    steps.push({ id: `s${i + 1}`, text, model, estimate: minutes != null ? `${minutes} min` : '', why: str(r?.why, 300), files: list(r?.files).map((f) => str(f, 300)).filter(Boolean).slice(0, 30), checks: list(r?.checks).map((f) => str(f, 300)).filter(Boolean).slice(0, 20) });
  });
  return problems.length ? { steps, error: problems.join('; '), flags, alreadyShipped } : { steps, error: '', flags, alreadyShipped };
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
// ------------------------------------------------------------------ self-check

/**
 * One account as the self-check finds it, from its view (accountView) and its claude-workers row:
 *   { name, kind, role, state: ready | busy | standby | blocked, signedIn, keySaved, keyOk, limited, running, parallel, free, note }
 * ready = takes the next build; busy = takes builds, every slot full; standby = by design not taking one now (not a worker,
 * an API key only takes routed builds, switched off by Brett); blocked = can't work until something changes (a limit, an
 * expired login, no key, a rejected key, a spend cap). A key is checked locally: saved and not rejected by its last run.
 */
export function checkAccount(v, row = {}) {
  const api = v.kind === 'api';
  const limited = v.limited ?? null;
  const signedIn = api ? null : !(limited && limited.kind === 'auth');
  const keySaved = api ? row?.hasKey !== false : null;
  const keyOk = api ? keySaved && !(limited && limited.kind === 'auth') : null;
  let state; let note;
  if (api) {
    const why = v.api?.why || '';
    if (!keySaved) { state = 'blocked'; note = why || 'no API key saved'; }
    else if (limited || /spend cap|rejected/i.test(why)) { state = 'blocked'; note = why; }
    else if (why && !/^full/.test(why)) { state = 'standby'; note = why; }
    else { state = v.free > 0 ? 'ready' : 'busy'; note = v.free > 0 ? 'takes routed builds' : why || 'full'; }
  } else if (limited) { state = 'blocked'; note = v.why; }
  else if (!v.usable) { state = 'standby'; note = v.why; }
  else { state = v.free > 0 ? 'ready' : 'busy'; note = v.free > 0 ? `${v.free} free` : 'every slot is in use'; }
  return { name: v.name, kind: v.kind, role: v.role, state, signedIn, keySaved, keyOk, limited: limited ? { kind: str(limited.kind, 20), until: str(limited.until, 40), reason: str(limited.reason, 80) } : null,
    running: v.running, parallel: v.parallel, free: v.free, note: str(note, 300) };
}

/** The self-check's verdict in one line, and the problems worth a phone alert (an account it can't use). */
export function checkSummary(findings, fixes = []) {
  const f = list(findings);
  const count = (s) => f.filter((x) => x.state === s).length;
  const blocked = f.filter((x) => x.state === 'blocked');
  const line = !f.length ? 'no Claude account found'
    : `${f.length} accounts: ${count('ready')} ready, ${count('busy')} busy, ${count('standby')} standby, ${blocked.length} blocked${fixes.length ? ` · fixed ${fixes.length}` : ''}`;
  return { line, problems: blocked.map((x) => `${x.name}: ${x.note}`), signature: blocked.map((x) => `${x.name}:${x.limited?.kind || x.note}`).sort().join('|') };
}

/** Should the self-check tell Brett? When it fixed something, or an account it can't use shows up that wasn't there last time. */
export function checkNotify(cur, prev) {
  if (list(cur?.fixes).length) return true;
  const was = new Set(String(prev?.signature || '').split('|').filter(Boolean));
  return String(cur?.signature || '').split('|').filter(Boolean).some((s) => !was.has(s)) || (!list(cur?.findings).length && list(prev?.findings).length > 0);
}

export function alertFor(kind, d = {}) {
  const base = { source: ALERT_SOURCE, link: ALERT_LINK, meta: { kind, build: d.id ?? '', account: d.account ?? '' } };
  switch (kind) {
    case 'idle': return { ...base, key: 'pipeline:idle', severity: d.kind === 'empty' ? 'info' : 'warning', title: d.kind === 'empty' ? 'Nothing is building: the Queue is empty' : 'Nothing is building while the Queue has work', body: str(d.reason, 1500) };
    case 'launched': return { ...base, key: `pipeline:run:${d.id}`, severity: 'info', title: `Building: ${str(d.title, 120)}`, body: `Started on ${d.account} (${d.model}${d.phase ? `, ${d.phase}` : ''}) · session ${d.session || ''}`.trim() };
    case 'ended': return { ...base, key: `pipeline:end:${d.id}`, severity: d.outcome === 'finished' ? 'success' : 'warning', title: `${d.outcome === 'finished' ? 'Built' : d.outcome === 'requeued' ? 'Back in the Queue' : 'Back in Pending'}: ${str(d.title, 120)}`, body: str(d.note, 1500) };
    case 'failed': return { ...base, key: `pipeline:end:${d.id}`, severity: 'error', title: `Build failed: ${str(d.title, 120)}`, body: str(d.note, 1500) };
    case 'selfcheck': return { ...base, key: 'pipeline:selfcheck', severity: list(d.problems).length ? 'warning' : 'info',
      title: `Dispatcher self-check: ${list(d.fixes).length ? `fixed ${list(d.fixes).length}` : 'nothing fixed'}${list(d.problems).length ? `, ${list(d.problems).length} account${list(d.problems).length === 1 ? '' : 's'} can't work` : ''}`,
      body: str([...list(d.fixes).map((x) => `Fixed: ${x}`), ...list(d.problems).map((x) => `Can't use ${x}`), d.line ? `Now: ${d.line}` : ''].filter(Boolean).join('\n'), 1500) };
    case 'shipped': return { ...base, key: `pipeline:shipped:${d.id}`, severity: 'warning', title: `Check before building: ${str(d.title, 120)}`,
      body: str([d.line, ...list(d.findings).slice(0, 8).map((f) => `${f.step ? `Step ${f.step}: ` : 'Whole build: '}${KIND_WORD[f.kind] || f.kind} ${f.ship}${f.title ? ` (${f.title})` : ''}${f.why ? `: ${f.why}` : ''}`), `It waits until you say go: "go ahead with ${d.id}" or pipeline.mjs shipped-ack ${d.id}.`].filter(Boolean).join('\n'), 1500) };
    case 'split': return { ...base, key: `pipeline:split:${d.id}`, severity: d.error ? 'warning' : 'info', title: d.error ? `Split needs a look: ${str(d.title, 120)}` : `Split into ${d.steps} steps: ${str(d.title, 120)}`, body: str(d.error || d.note, 1500) };
    default: throw new Error(`unknown alert kind ${kind}`);
  }
}

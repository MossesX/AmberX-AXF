/**
 * Pipeline core (pure, IO-free): the dispatcher's rules. Shared by the CLI (pipeline.mjs), the console page and the
 * tests, so the console shows exactly what the dispatcher on the VPS will do next.
 *
 * Brett, Nov 8 2026 (build urgent-rebuild-pipeline-orchestrator-ids-splits-): the orchestrator assigns the id, uses
 * Claude to split a build into ≤ 10-min steps (checkpoints inside one session) (Fable only where needed, Opus otherwise), puts it in Pending; Brett moves
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
import { CLAIM_TTL_MS, DEFAULT_MAX_RUNS, STATUS_AFTER, claimLive, dependsOn as resolvedDeps, explicitAfter, fileClashes, isHeld, isParallelStep, readySteps, releaseStep, stepFiles, nextModel, openSteps, outcomeLine, outcomeOf, queueOrder } from '../../../../framework/core/build-pipeline.mjs';
import { effectivePriority, priorityLabel } from '../../../../framework/core/build-priority.mjs';
import { FOUNDATION_MODEL, MODEL_LABELS, modelForWork, modelKey } from '../../../../framework/core/model-policy.mjs';
import { API_RULE, estimateMinutes, maxStep, nextUp as orchNextUp, MODEL_GUIDE, STEP_MINUTES, stepLimit } from './web/orchestrator-core.mjs';

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
export function accountView(row, own = {}, { settings = normSettings(), anyWorker = false, now = Date.now(), pick = '' } = {}) {
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
  // one build account (claude-workers@1 buildAccount, build one-account-picker): it alone takes builds, whatever its role
  // or the pipeline's own on/off says; every other account, API ones too, is off for builds
  const picked = !!pick && str(row?.name, 40) === pick && !apiKey;
  const usable = pick ? picked && !limited : !off && !apiKey && !limited && (role === 'worker' || (!anyWorker && settings.useConsoleAccount && (role === 'interactive' || role === 'saved')));
  let why = '';
  if (pick && !picked) why = `off for builds: ${pick} takes every build`;
  else if (picked && limited) why = `${limited.reason === 'auth' ? 'login expired' : limited.reason || 'limited'}${limited.until ? ` until ${str(limited.until, 40).slice(0, 16).replace('T', ' ')}` : ''}`;
  else if (picked) why = '';
  else if (off) why = 'switched off for the pipeline';
  else if (limited) why = `${limited.reason === 'auth' ? 'login expired' : limited.reason || 'limited'}${limited.until ? ` until ${str(limited.until, 40).slice(0, 16).replace('T', ' ')}` : ''}`;
  else if (apiKey) why = 'API key (billed per token): takes a build only when routed there';
  else if (!usable) why = anyWorker ? 'not a worker (workers take every headless job)' : 'console account use is off';
  // API accounts: their own slot count (claude-workers building limit), Fable unless overridden (an API key reaches every model)
  const apiParallel = Number.isInteger(o.parallel) && o.parallel > 0 ? Math.min(12, o.parallel) : Number.isInteger(row?.building) && row.building > 0 ? row.building : settings.parallelPerAccount;
  const api = apiKey ? (pick ? { usable: false, why: `off for builds: ${pick} takes every build`, spend: row?.spend && typeof row.spend === 'object' ? row.spend : null } : apiState(row, o, settings, { limited, apiParallel, running })) : null;
  const rawOrder = o.order ?? row?.order;
  const order = typeof rawOrder === 'number' && Number.isFinite(rawOrder) ? rawOrder : null;
  return { name: str(row?.name, 40), email: str(row?.email, 200), plan, role, kind: apiKey ? 'api' : 'subscription', label: str(row?.label, 40), order, buildAccount: picked, health: health ?? (o.health && typeof o.health === 'object' ? o.health : null),
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
  const pick = buildPick(rows);
  return list(rows).map((r) => accountView(r, own?.[r?.name], { ...opts, anyWorker, pick }));
}

/** The one build account the claude-workers rows carry (buildPick on every row), '' = none: the normal routing. */
export function buildPick(rows) {
  const p = list(rows).map((r) => str(r?.buildPick, 40)).find(Boolean) ?? '';
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(p) ? p : '';
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
  const one = list(accounts).find((a) => a.buildAccount);
  const offAll = list(accounts).length && list(accounts).every((a) => /^off for builds: /.test(a.why || ''));
  if (offAll) return `the one build account ${list(accounts)[0].why.replace(/^off for builds: | takes every build$/g, '')} is not saved on the VPS`;
  if (one && !one.usable) return `the one build account ${one.name} is ${one.why || 'not usable'}`;
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
    // only Queued builds take slots (Brett, Nov 12 2026): never a Pending one, whatever else the record says
    if (b.status !== 'queued') continue;
    if (isHeld(b)) { waits.push({ id: b.id, why: `on hold${b.pipeline.heldBy ? ` (${b.pipeline.heldBy})` : ''}: skipped until released`, held: true }); continue; }
    if (!openSteps(b).length) { waits.push({ id: b.id, why: b.steps?.length ? 'every step is done: nothing to run' : 'no steps yet: waiting for the split' }); continue; }
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
  // (fill every slot: the dispatcher adds kind 'slots' when slots are free while ready steps wait, see fillIdle)
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

/** The one-shot prompt the orchestrator sends to Claude to split a build. The answer must be JSON only. */
export function splitPrompt(b, rules = { maxStepMinutes: STEP_MINUTES }) {
  const max = maxStep(rules);
  const said = str(b.origin?.said, 6000).trim();
  const addenda = list(b.origin?.addenda).map((a, i) => `Addendum ${i + 1}: ${str(a.said, 2000)}`).join('\n');
  return [
    `You are the AmberX AXF build orchestrator. Split the build below into small steps a headless Claude Code session does one after another in one repo checkout.`,
    `Steps are checkpoints inside ONE session, not separate launches: the session works through them in order, commits and ticks each one as it finishes it, so nothing is lost if it dies; no step gets its own prompt or relaunch. Small steps cost nothing extra, so cut fine.`,
    `Rules: every step ${max} minutes or less, with an estimate; 3 to 40 steps; each step is one concrete piece of work naming the files or folders it touches and ending in something that can be committed; anything bigger than ${max} minutes is cut into several steps; the last step is tests, report (_claude/builds/reports/<build id>.md), THREADS row and PR.`,
    `API rule: ${API_RULE} So every step that adds or changes UI names its API part (deep link, state read, actions, settings; REST + MCP + CLI + voice) in the same step or the step right after it.`,
    `Model per step, Opus by default. Fable ONLY for: ${MODEL_GUIDE.Fable} Opus for: ${MODEL_GUIDE.Opus} Put Fable steps first when the work allows, so the build switches model at most once.`,
    `Dependencies: steps are numbered s1, s2, … in your order. Give every step "dependsOn", the ids of the steps it needs finished first; by default that is the step right before it (["s3"] for s4), and [] for the first step. Only when a step truly needs none of the steps before it (it touches other files and does not use their results), list just the ones it needs, so idle agent slots can run it beside them. Never name a later step or the step itself; no cycles.`,
    `Files: give every step "files", the repo paths (files or folders) it changes. Two steps sharing a file never run at once.`,
    `Answer with JSON only, no prose: {"steps":[{"text":"…","model":"Fable|Opus","estimate":"<n> min","why":"<one line when Fable>","dependsOn":["s1"],"files":["…"]}]}`,
    '', `Build id: ${b.id}`, `Title: ${str(b.title, 300)}`, b.category ? `Category: ${str(b.category, 60)}` : '', b.detail ? `Details:\n${str(b.detail, 8000)}` : '',
    said ? `Brett said (verbatim):\n${said}` : '', addenda,
  ].filter(Boolean).join('\n');
}

const EST_RE = /^\s*(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)?\s*$/i;
/** Claude's answer → steps, or an error. Accepts the JSON object alone or inside other text; refuses steps over the limit. */
export function parseSplit(text, rules = { maxStepMinutes: STEP_MINUTES }) {
  const max = maxStep(rules);
  const s = str(text, 200000);
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return { steps: [], error: 'no JSON object in the answer' };
  let j;
  try { j = JSON.parse(s.slice(start, end + 1)); } catch (e) { return { steps: [], error: `not JSON: ${e.message}` }; }
  const raw = list(j?.steps);
  if (raw.length < 1) return { steps: [], error: 'no steps in the answer' };
  if (raw.length > 60) return { steps: [], error: `${raw.length} steps: too many (60 at most)` };
  const steps = []; const problems = [];
  raw.forEach((r, i) => {
    const text = str(r?.text ?? r?.title, 2000).trim();
    if (text.length < 5) { problems.push(`step ${i + 1} has no text`); return; }
    const est = typeof r?.estimate === 'number' ? `${Math.round(r.estimate)} min` : str(r?.estimate, 20).trim();
    const m = EST_RE.exec(est); const minutes = m ? Math.round(Number(m[1]) * (/^h/i.test(m[2] || '') ? 60 : 1)) : null;
    if (minutes == null) problems.push(`step ${i + 1} has no estimate`); else if (minutes > max) problems.push(`step ${i + 1} is ${minutes} min (limit ${max})`);
    const model = modelKey(r?.model) === FOUNDATION_MODEL ? 'Fable' : 'Opus';
    const deps = splitDeps(r?.dependsOn ?? r?.after, i, raw.length, problems);
    steps.push({ id: `s${i + 1}`, text, model, estimate: minutes != null ? `${minutes} min` : '', why: str(r?.why, 300), ...(deps ? { dependsOn: deps } : {}), files: list(r?.files).map((f) => str(f, 300)).filter(Boolean).slice(0, 30), checks: list(r?.checks).map((f) => str(f, 300)).filter(Boolean).slice(0, 20) });
  });
  if (!problems.length) { const cyc = splitCycle(steps); if (cyc) problems.push(`dependency cycle: ${cyc.join(' → ')}`); }
  return problems.length ? { steps, error: problems.join('; ') } : { steps, error: '' };
}

/**
 * One step's `dependsOn` from the splitter's answer (build-pipeline@1): ids `s<n>` or step numbers, deduplicated, the
 * step itself dropped. Absent = undefined (the step keeps the implicit "previous step" order). An id outside the split
 * or a later step is a problem (the split is refused and falls back to rules).
 */
export function splitDeps(v, i, total, problems = []) {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) { problems.push(`step ${i + 1} dependsOn is not a list`); return undefined; }
  const out = [];
  for (const x of v) {
    const n = typeof x === 'number' ? x : /^s?(\d+)$/i.test(str(x, 20).trim()) ? Number(/(\d+)/.exec(str(x, 20))[1]) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > total) { problems.push(`step ${i + 1} depends on "${str(x, 20)}", which is not a step of the split`); continue; }
    if (n === i + 1) continue;
    if (n > i + 1) { problems.push(`step ${i + 1} depends on a later step (s${n})`); continue; }
    if (!out.includes(`s${n}`)) out.push(`s${n}`);
  }
  return out.slice(0, 20);
}

/** The first cycle in a split's resolved graph (explicit dependsOn plus the implicit previous step), or null. */
export function splitCycle(steps) {
  const b = { steps: steps.map((x) => (x.dependsOn ? { ...x, after: x.dependsOn } : x)) };
  const deps = new Map(b.steps.map((x) => [x.id, resolvedDeps(b, x)]));
  const state = new Map(); let found = null;
  const walk = (id, path) => {
    if (found || state.get(id) === 'done') return;
    if (state.get(id) === 'open') { found = [...path.slice(path.indexOf(id)), id]; return; }
    state.set(id, 'open'); for (const d of deps.get(id) ?? []) walk(d, [...path, id]); state.set(id, 'done');
  };
  for (const x of b.steps) walk(x.id, []);
  return found;
}

// ------------------------------------------------------------------ parallel steps: merge back (Nov 13 2026)

/** A step note line starting with this marks a step sent back by a merge conflict (the step itself stays open). */
export const BLOCKED_PREFIX = 'blocked: ';

/**
 * A parallel step whose branch could not merge back into the build branch (BUILD-PARALLEL §4). Pure:
 * the claim is released, the step stays open with a `blocked:` note naming the conflicting files, and it re-runs after
 * the steps it clashed with (settled steps of the build sharing a conflicting file; the previous step when none is
 * known) in the build's own session (`parallel: never`), so the retry starts from a build branch that holds their work.
 * → { ok, build, after, note } or { ok: false, why }.
 */
export function conflictBack(b, stepId, { files = [], branch = '', now = Date.now() } = {}) {
  const steps = list(b?.steps); const i = steps.findIndex((x) => x.id === stepId);
  if (i < 0) return { ok: false, why: `no step ${stepId}` };
  const conflict = list(files).map((f) => str(f, 300)).filter(Boolean);
  const touches = (x, f) => stepFiles(x).some((g) => g === f || f.startsWith(`${g.replace(/\/$/, '')}/`) || g.startsWith(`${f.replace(/\/$/, '')}/`));
  let after = steps.filter((x, j) => j !== i && (x.done || x.skip) && conflict.some((f) => touches(x, f))).map((x) => x.id);
  if (!after.length && i > 0) after = [steps[i - 1].id];
  const note = `${BLOCKED_PREFIX}merge conflict on ${branch || 'the step branch'}${conflict.length ? ` (${conflict.slice(0, 6).join(', ')}${conflict.length > 6 ? ', …' : ''})` : ''}: re-runs after ${after.join(', ') || 'the steps before it'} in the build's own session; the step branch is kept`;
  const r = releaseStep(b, stepId, { now });
  if (!r.ok) return r;
  const at = new Date(typeof now === 'number' ? now : Date.parse(now) || Date.now()).toISOString();
  const noted = (x) => `${x.note ? `${x.note}\n` : ''}${note}`.slice(-1000);
  const build = { ...r.build, steps: r.build.steps.map((x) => (x.id === stepId ? { ...x, done: false, doneAt: '', after, parallel: 'never', note: noted(x), updatedAt: at } : x)) };
  return { ok: true, build, after, note };
}

/** Runs a parallel step session gets before the step is left to the build's own session. */
export const STEP_MAX_RUNS = 3;

/**
 * The planner's view of a running build whose own session is alive (pipeline.session): that session holds the first
 * ready step nobody else claims (it works in list order), as an in-memory claim `main:<session>`. planFill then counts it
 * as the build's own session and never launches its step beside it. Never stored. Pure.
 */
export function withMainClaim(b, now = Date.now()) {
  if (!b?.pipeline?.session || !list(b.steps).length) return b;
  if (list(b.steps).some((s) => claimLive(s.claim, now) && str(s.claim.runId, 80).startsWith('main:'))) return b;
  const first = readySteps(b, { now, files: false })[0];
  if (!first) return b;
  const t = typeof now === 'number' ? now : Date.parse(now) || Date.now();
  const claim = { runId: `main:${str(b.pipeline.session, 70)}`, slot: str(b.pipeline.slot, 60), account: str(b.pipeline.account, 40), branch: str(b.branch, 200), at: new Date(t).toISOString(), model: first.model, expiresAt: new Date(t + CLAIM_TTL_MS).toISOString() };
  return { ...b, steps: b.steps.map((s) => (s === first ? { ...s, claim } : s)) };
}

/**
 * Parallel candidates of running builds held back by a file clash with a running step (readySteps leaves them out, so
 * the planner never names them): [{ id, step, why: 'files clash with s2 (a.txt)' }] for the plan's waits.
 */
export function clashWaits(running, now = Date.now()) {
  const out = [];
  for (const b of list(running)) {
    const steps = list(b.steps);
    const settledId = (id) => { const x = steps.find((y) => y.id === id); return !!x && (x.done || x.skip); };
    for (const st of steps) {
      if (st.done || st.skip || !isParallelStep(st) || claimLive(st.claim, now)) continue;
      if (!resolvedDeps(b, st).every(settledId)) continue;
      const c = fileClashes(b, st, { now });
      if (c.length) out.push({ id: b.id, step: st.id, why: `files clash with ${c.map((x) => `${x.step} (${x.files.join(', ')})`).join('; ')}` });
    }
  }
  return out;
}

/**
 * Where a step runs now, for views and the API: { slot, session, account, branch, worktree, since, main } from its live
 * claim (a parallel step session) or null. `worktree` follows BUILD-PARALLEL §4 (<root>/<build>--<step>).
 */
export function runningIn(b, step, { now = Date.now(), root = '/root/axf-builds', sessions = {} } = {}) {
  const c = step?.claim;
  if (!c || !claimLive(c, now)) return null;
  const main = str(c.runId, 80).startsWith('main:');
  const rec = sessions[c.runId] ?? null;
  return { runId: c.runId, slot: str(c.slot, 60) || str(rec?.slot, 60), session: main ? str(c.runId, 80).slice(5) : str(rec?.session, 80), account: c.account, branch: c.branch, model: c.model,
    worktree: main ? `${root}/${b.id}` : `${root}/${b.id}--${step.id}`, since: c.at, main };
}

/**
 * Every step of a build with its dependency state, for the Steps view and the API (pure):
 * { id, text, model, estimate, done, skip, dependsOn (resolved), explicit (the stored list or null), parallel, files,
 *   state: done | skipped | running | ready | waiting | blocked, waitingOn: [ids], why, runningIn }.
 * `slotOf(runningIn)` may number the slot (the Slots strip's chip number).
 */
export function stepStates(b, { now = Date.now(), root = '/root/axf-builds', sessions = {}, slotOf = () => 0 } = {}) {
  const steps = list(b?.steps);
  const settled = (id) => { const x = steps.find((y) => y.id === id); return !!x && (x.done || x.skip); };
  const ready = new Set(readySteps(b, { now }).map((x) => x.id));
  return steps.map((st) => {
    const deps = resolvedDeps(b, st);
    const waitingOn = deps.filter((id) => !settled(id));
    const ri = runningIn(b, st, { now, root, sessions });
    let state = 'waiting'; let why = '';
    if (st.done) state = 'done';
    else if (st.skip) state = 'skipped';
    else if (ri) { state = 'running'; why = ri.main ? "in the build's own session" : `in slot ${slotOf(ri) || ri.slot || '?'}`; }
    else if (isConflictBlocked(st)) { state = waitingOn.length ? 'blocked' : 'ready'; why = str(st.note, 1000).split('\n').filter(Boolean).pop(); }
    else if (waitingOn.length) why = `waiting on ${waitingOn.join(', ')}`;
    else if (ready.has(st.id)) state = 'ready';
    else { const c = fileClashes(b, st, { now }); why = c.length ? `files clash with ${c.map((x) => x.step).join(', ')}` : ''; }
    const explicit = explicitAfter(st);
    return { id: st.id, text: str(st.text, 400), model: st.model, estimate: str(st.estimate, 20), done: !!st.done, skip: !!st.skip, dependsOn: deps, explicit: explicit ? [...explicit] : null,
      parallel: isParallelStep(st), files: stepFiles(st), state, waitingOn, why, runningIn: ri ? { ...ri, n: slotOf(ri) || 0 } : null };
  });
}

/** Is this step blocked by a merge conflict (its newest note line says so)? */
export const isConflictBlocked = (step) => str(step?.note, 1000).split('\n').filter(Boolean).pop()?.startsWith(BLOCKED_PREFIX) === true && !step?.done;

/**
 * Steps without a model: one per numbered line, bullet or sentence of the detail (and Brett's words when the detail
 * is bare), each ${max} min, Fable when its words name foundation work; a closing test + report + PR step. Marked for
 * review: it is the fallback when no model can be asked (`split.provider: rules`).
 */
export function rulesSplit(b, rules = { maxStepMinutes: STEP_MINUTES }) {
  const max = maxStep(rules);
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
  steps.push({ id: `s${steps.length + 1}`, text: `Tests green, report _claude/builds/reports/${b.id}.md, THREADS row, commit, push, PR`, model: 'Opus', estimate: `${max} min`, why: '', files: [`_claude/builds/reports/${b.id}.md`, '_claude/THREADS.md'], checks: [] });
  return steps;
}

/** Does this build still need the orchestrator's split? (no steps, or steps over the limit / without estimates) */
export function needsSplit(b, rules = { maxStepMinutes: STEP_MINUTES }) {
  if (!b || ['built', 'complete', 'archived', 'failed'].includes(b.status) || b.deleted) return false;
  if (!list(b.steps).length) return true;
  return list(b.steps).some((s) => !s.done && (estimateMinutes(s.estimate) == null || estimateMinutes(s.estimate) > stepLimit(s, rules)));
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

/**
 * The idle alert's other case (fill every slot): agent slots are free and ready steps of running builds wait, yet the
 * fill round started nothing. → { kind: 'slots', reason } or null.
 */
export function fillIdle(fillPlan, launchedCount = 0) {
  if (!fillPlan || launchedCount > 0 || !(Number(fillPlan.free) > 0)) return null;
  const waiting = list(fillPlan.waits).filter((w) => w.step);
  if (!waiting.length) return null;
  return { kind: 'slots', reason: `${fillPlan.free} agent slot${fillPlan.free === 1 ? '' : 's'} free while ${waiting.length} ready step${waiting.length === 1 ? '' : 's'} wait: ${waiting[0].id} ${waiting[0].step}: ${waiting[0].why}` };
}

export function alertFor(kind, d = {}) {
  const base = { source: ALERT_SOURCE, link: ALERT_LINK, meta: { kind, build: d.id ?? '', account: d.account ?? '' } };
  switch (kind) {
    case 'idle': return { ...base, key: 'pipeline:idle', severity: d.kind === 'empty' ? 'info' : 'warning', title: d.kind === 'empty' ? 'Nothing is building: the Queue is empty' : d.kind === 'slots' ? 'Agent slots free while ready steps wait' : 'Nothing is building while the Queue has work', body: str(d.reason, 1500) };
    case 'launched': return { ...base, key: `pipeline:run:${d.id}`, severity: 'info', title: `Building: ${str(d.title, 120)}`, body: `Started on ${d.account} (${d.model}${d.phase ? `, ${d.phase}` : ''}) · session ${d.session || ''}`.trim() };
    case 'ended': return { ...base, key: `pipeline:end:${d.id}`, severity: d.outcome === 'finished' ? 'success' : 'warning', title: `${d.outcome === 'finished' ? 'Built' : d.outcome === 'requeued' ? 'Back in the Queue' : 'Back in Pending'}: ${str(d.title, 120)}`, body: str(d.note, 1500) };
    case 'failed': return { ...base, key: `pipeline:end:${d.id}`, severity: 'error', title: `Build failed: ${str(d.title, 120)}`, body: str(d.note, 1500) };
    case 'selfcheck': return { ...base, key: 'pipeline:selfcheck', severity: list(d.problems).length ? 'warning' : 'info',
      title: `Dispatcher self-check: ${list(d.fixes).length ? `fixed ${list(d.fixes).length}` : 'nothing fixed'}${list(d.problems).length ? `, ${list(d.problems).length} account${list(d.problems).length === 1 ? '' : 's'} can't work` : ''}`,
      body: str([...list(d.fixes).map((x) => `Fixed: ${x}`), ...list(d.problems).map((x) => `Can't use ${x}`), d.line ? `Now: ${d.line}` : ''].filter(Boolean).join('\n'), 1500) };
    case 'split': return { ...base, key: `pipeline:split:${d.id}`, severity: d.error ? 'warning' : 'info', title: d.error ? `Split needs a look: ${str(d.title, 120)}` : `Split into ${d.steps} steps: ${str(d.title, 120)}`, body: str(d.error || d.note, 1500) };
    case 'autoqueue': return { ...base, key: `pipeline:autoqueue:${str(list(d.ids).join(','), 200)}`, severity: 'info', title: `Auto-queued ${list(d.ids).length} Pending build${list(d.ids).length === 1 ? '' : 's'}: slots were free`, body: str(list(d.builds).map((b) => `${b.id}${b.priority ? ` (${b.priority})` : ''}${b.title ? `: ${b.title}` : ''}`).join('\n') || list(d.ids).join(', '), 1500), meta: { ...base.meta, build: str(list(d.ids)[0] ?? '', 120), builds: list(d.ids) } };
    case 'step-conflict': return { ...base, key: `pipeline:step-conflict:${d.id}:${d.step}`, severity: 'warning', title: `Step ${str(d.step, 40)} of ${str(d.id, 120)} could not merge back`, body: str(d.note, 1500), meta: { ...base.meta, step: str(d.step, 40) } };
    default: throw new Error(`unknown alert kind ${kind}`);
  }
}

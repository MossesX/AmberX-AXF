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
 *              routeFor() = the per-build override (pipeline.route = api | subscription), else the Job routing rules of
 *              Claude accounts (workers.json rules, first enabled match decides, the same ruleMiss() the launcher runs;
 *              "API fallback when subscriptions are busy" is a rule with subs: busy). An API account takes a build only
 *              when it has a key, is switched on, is under its daily and weekly caps and has room (apiNoAccountWhy()).
 *   one source (Brett, Nov 9 2026: "I need him to read from one source, dude. One true source.") every account fact comes
 *              from Claude accounts (deploy/claude-workers.mjs status: workers.json + the saved logins): role, whether it
 *              takes jobs, its building cap, Fable by hand (perAccount.fable), API slots, caps and the routing rules. The
 *              pipeline keeps no copy; its own file holds only what it measured (Fable probes). migrationOf() moves the
 *              old pipeline-settings / accounts.json values into workers.json once.
 */
import { DEFAULT_MAX_RUNS, STATUS_AFTER, nextModel, openSteps, outcomeLine, outcomeOf, queueOrder } from '../../../../framework/core/build-pipeline.mjs';
import { effectivePriority, priorityLabel } from '../../../../framework/core/build-priority.mjs';
import { FOUNDATION_MODEL, MODEL_LABELS, modelForWork, modelKey } from '../../../../framework/core/model-policy.mjs';
import { API_RULE, estimateMinutes, nextUp as orchNextUp, MODEL_GUIDE } from './web/orchestrator-core.mjs';
import { normJob, normRule, ruleMiss } from '../../../../deploy/worker-routing.mjs';

export const SCHEMA = 'pipeline-settings@1';
export const DEFAULTS = Object.freeze({
  /** Plans that run Fable (Brett's Max subscriptions do; Pro ones don't). Fable set by hand in Claude accounts or a probe beats the plan. */
  fablePlans: ['max'],
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
});
/** Settings that were account facts and now live only in Claude accounts (workers.json); migrationOf() moves them. */
export const MOVED_SETTINGS = Object.freeze(['parallelPerAccount', 'useConsoleAccount', 'apiOverflow', 'apiAccounts']);
/** The rule id an old apiOverflow switch becomes in workers.json. */
export const FALLBACK_RULE_ID = 'api-fallback';
const LIMITS = { maxRuns: [1, 10], idleAfterMin: [0, 240], probeDays: [1, 90] };

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const list = (v) => (Array.isArray(v) ? v : []);
const clamp = (k, v) => { const [lo, hi] = LIMITS[k]; const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : DEFAULTS[k]; };
const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function normSettings(raw = {}) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    $axf: SCHEMA,
    fablePlans: list(o.fablePlans).map((p) => str(p, 20).toLowerCase()).filter(Boolean).length ? list(o.fablePlans).map((p) => str(p, 20).toLowerCase()).filter(Boolean) : [...DEFAULTS.fablePlans],
    maxRuns: o.maxRuns === undefined ? DEFAULTS.maxRuns : clamp('maxRuns', o.maxRuns),
    idleAfterMin: o.idleAfterMin === undefined ? DEFAULTS.idleAfterMin : clamp('idleAfterMin', o.idleAfterMin),
    probeDays: o.probeDays === undefined ? DEFAULTS.probeDays : clamp('probeDays', o.probeDays),
    splitProvider: ['claude', 'rules', 'off'].includes(o.splitProvider) ? o.splitProvider : DEFAULTS.splitProvider,
    autoQueue: o.autoQueue === true,
  };
}

/**
 * The one-time move of the pipeline's old account settings into Claude accounts. `file` = the raw pipeline settings.json,
 * `own` = the raw accounts.json, `cfg` = workers.json (normConfig'd), `rows` = claude-workers status rows (to tell API
 * accounts from subscriptions). Returns { config, settings, own, moved: [lines] }; moved = [] means nothing to do.
 *   apiOverflow true      → a Job routing rule "API fallback when subscriptions are busy" (to api, subs busy, accounts =
 *                           apiAccounts), unless an enabled api rule with subs busy is already there
 *   parallel (per account)→ perAccount.building (API accounts too)
 *   fable (per account)   → perAccount.fable
 *   use false             → excluded (subscription) or api.enabled false (API account)
 *   parallelPerAccount, useConsoleAccount → dropped: the workers.json limits and interactiveTakesJobs already decide
 * Probes stay in accounts.json: they are measurements, not settings.
 */
export function migrationOf(file = {}, own = {}, cfg = {}, rows = []) {
  const f = file && typeof file === 'object' ? { ...file } : {};
  const config = JSON.parse(JSON.stringify(cfg ?? {}));
  config.perAccount ??= {}; config.api ??= {}; config.excluded ??= []; config.rules ??= [];
  const moved = [];
  const isApi = (n) => !!config.api[n] || list(rows).some((r) => r?.name === n && r?.kind === 'api');
  if (f.apiOverflow === true) {
    const have = config.rules.find((r) => r?.enabled !== false && r?.to === 'api' && r?.when?.subs === 'busy');
    if (have) moved.push(`API overflow: already the Job routing rule "${have.name || have.id}"`);
    else {
      const accounts = [...new Set((typeof f.apiAccounts === 'string' ? f.apiAccounts.split(',') : list(f.apiAccounts)).map((n) => str(n, 32).trim().toLowerCase()).filter((n) => NAME.test(n)))];
      config.rules.push({ id: FALLBACK_RULE_ID, name: 'API fallback when subscriptions are busy', enabled: true, to: 'api', accounts, when: { subs: 'busy' } });
      moved.push(`API overflow on → Job routing rule "API fallback when subscriptions are busy"${accounts.length ? ` (${accounts.join(', ')})` : ''}`);
    }
  }
  for (const k of MOVED_SETTINGS) if (k in f) { if (k !== 'apiOverflow' || f.apiOverflow !== true) moved.push(`pipeline setting ${k} dropped (Claude accounts decides it)`); delete f[k]; }
  const nextOwn = {};
  for (const [n, rec] of Object.entries(own && typeof own === 'object' && !Array.isArray(own) ? own : {})) {
    if (!NAME.test(n) || !rec || typeof rec !== 'object') continue;
    const pa = { ...(config.perAccount[n] ?? {}) };
    if (typeof rec.fable === 'boolean') { if (typeof pa.fable !== 'boolean') pa.fable = rec.fable; moved.push(`${n}: Fable ${rec.fable ? 'on' : 'off'} by hand`); }
    if (Number.isInteger(rec.parallel) && rec.parallel > 0) { if (pa.building === undefined) pa.building = rec.parallel; moved.push(`${n}: ${rec.parallel} at once`); }
    if (rec.use === false) {
      if (isApi(n)) { if (config.api[n]) config.api[n] = { ...config.api[n], enabled: false }; moved.push(`${n}: API worker switched off`); }
      else { if (!config.excluded.includes(n)) config.excluded.push(n); moved.push(`${n}: not a worker`); }
    }
    if (Object.keys(pa).length) config.perAccount[n] = pa;
    if (rec.probe && typeof rec.probe === 'object') nextOwn[n] = { probe: rec.probe };
  }
  const ownChanged = JSON.stringify(nextOwn) !== JSON.stringify(Object.fromEntries(Object.entries(own ?? {}).filter(([n, r]) => NAME.test(n) && r && typeof r === 'object')));
  if (!moved.length && ownChanged) moved.push('accounts.json: only Fable probes kept');
  return { config, settings: f, own: nextOwn, moved };
}

// ------------------------------------------------------------------ accounts

/**
 * One account as the pipeline sees it. `row` = a claude-workers status row ({ name, kind, role, email, plan, label,
 * limited, running[], building, takesJobs, why, fable, hasKey, spend }): everything comes from Claude accounts; `own` =
 * the pipeline's measurements only ({ probe?: { fable, at, error } }).
 *   fable      may this account run Fable? Claude accounts' hand setting (row.fable) > a fresh probe > the plan (fablePlans)
 *   parallel   sessions at once: the account's building cap in Claude accounts
 *   usable     may the dispatcher put a build on it? exactly when Claude accounts says it takes jobs (workers, and the
 *              console's own account while interactiveTakesJobs is on), never limited, never an API key
 */
export function accountView(row, own = {}, { settings = normSettings(), now = Date.now() } = {}) {
  const o = own && typeof own === 'object' ? own : {};
  const plan = str(row?.plan, 40).toLowerCase();
  const probe = o.probe && typeof o.probe === 'object' && typeof o.probe.fable === 'boolean' && now - Date.parse(o.probe.at || 0) < settings.probeDays * 86400e3 ? o.probe : null;
  const hand = typeof row?.fable === 'boolean' ? row.fable : null;
  const role = str(row?.role, 20) || 'saved';
  const apiKey = row?.kind === 'api' || role === 'api-key' || role === 'api-worker' || role === 'api-off' || plan === 'api';
  const fable = hand !== null ? hand : probe ? probe.fable : apiKey ? true : settings.fablePlans.includes(plan);
  const fableFrom = hand !== null ? 'override' : probe ? 'probe' : apiKey ? 'api' : plan ? 'plan' : 'unknown';
  const running = list(row?.running).length;
  const parallel = Number.isInteger(row?.building) && row.building >= 0 ? Math.min(20, row.building) : 1;
  const limited = row?.limited && typeof row.limited === 'object' ? row.limited : null;
  const takes = typeof row?.takesJobs === 'boolean' ? row.takesJobs : role === 'worker' || role === 'interactive';
  // subscriptions only: an API account never takes a build by itself, only through routeFor() (override or a rule)
  const usable = !apiKey && !limited && takes && parallel > 0;
  let why = '';
  if (limited) why = `${limited.reason === 'auth' ? 'login expired' : limited.reason || 'limited'} until ${str(limited.until, 40).slice(0, 16).replace('T', ' ')}`;
  else if (apiKey) why = 'API key (billed per token): takes a build only when a Job routing rule or the build sends it there';
  else if (!usable) why = str(row?.why, 200) || (parallel <= 0 ? 'building cap 0' : 'does not take headless jobs');
  const api = apiKey ? apiState(row, { limited, apiParallel: parallel, running }) : null;
  return { name: str(row?.name, 40), email: str(row?.email, 200), plan, role, kind: apiKey ? 'api' : 'subscription', label: str(row?.label, 40),
    fable, fableFrom, parallel, running, free: Math.max(0, parallel - running), usable, takesJobs: takes, why, limited, probe: probe ?? (o.probe ?? null), api };
}

/** May the dispatcher route a build to this API account now? { usable, why, spend } (why says what to do when it can't). */
export function apiState(row, { limited = null, apiParallel = 1, running = 0 } = {}) {
  const name = str(row?.name, 40);
  const spend = row?.spend && typeof row.spend === 'object' ? row.spend : null;
  let why = '';
  if (row?.hasKey === false) why = `no API key saved (Terminal → VPS host → claude-account savekey ${name})`;
  else if (row?.role === 'api-off') why = row?.why || 'not set up as an API worker (Claude accounts → Job routing → API accounts)';
  else if (limited) why = `${limited.reason === 'auth' ? 'key rejected' : limited.reason || 'limited'} until ${str(limited.until, 40).slice(0, 16).replace('T', ' ')}`;
  else if (spend?.state === 'capped') why = `spend cap reached: ${spend.why}`;
  else if (running >= apiParallel) why = `full (${running}/${apiParallel})`;
  return { usable: !why, why, spend };
}

/** Every account as the pipeline sees it; `rows` = claude-workers status rows, `own` = accounts.json (probes). */
export function accountViews(rows, own = {}, opts = {}) {
  return list(rows).map((r) => accountView(r, own?.[r?.name], opts));
}

/** Accounts that can take one more session on `model` now: Fable needs an account with Fable; fewest running first, Opus away from Fable accounts, workers before the console's account. */
export function candidates(accounts, model) {
  const needFable = modelKey(model) === FOUNDATION_MODEL;
  // Opus work goes to accounts without Fable first, so the Fable accounts stay free for Fable phases
  return list(accounts).filter((a) => a.usable && a.free > 0 && (!needFable || a.fable))
    .sort((a, b) => (a.role === 'interactive' ? 1 : 0) - (b.role === 'interactive' ? 1 : 0) || a.running - b.running || (needFable ? 0 : (a.fable ? 1 : 0) - (b.fable ? 1 : 0)));
}

/** API accounts that can take one more build on `model` now: least busy first, then the least spent today. */
export function apiCandidates(accounts, model, only = []) {
  const needFable = modelKey(model) === FOUNDATION_MODEL;
  return list(accounts).filter((a) => a.kind === 'api' && a.api?.usable && a.free > 0 && (!needFable || a.fable) && (!only.length || only.includes(a.name)))
    .sort((a, b) => a.running - b.running || (Number(a.api?.spend?.day) || 0) - (Number(b.api?.spend?.day) || 0) || a.name.localeCompare(b.name));
}

/** Why no API account takes `model` right now: every API account and what keeps it out. */
export function apiNoAccountWhy(accounts, model, only = []) {
  const apis = list(accounts).filter((a) => a.kind === 'api' && (!only.length || only.includes(a.name)));
  if (!apis.length) return only.length ? `none of ${only.join(', ')} is an API account here` : 'no API account is set up (Claude accounts → Job routing → API accounts)';
  const needFable = modelKey(model) === FOUNDATION_MODEL;
  return `no API account can take it: ${apis.map((a) => `${a.name}: ${a.api?.why || (needFable && !a.fable ? `no ${MODEL_LABELS[FOUNDATION_MODEL]}` : 'full')}`).join('; ')}`;
}

/** A build as the Job routing rules see it (worker-routing normJob): type build, its next model, priority, profile, steps and minutes left. */
export function jobOf(b, model) {
  const left = openSteps(b);
  return normJob({ name: b?.id, build: b?.id, jobType: 'build', model, priority: effectivePriority(b), profile: b?.profile || 'all', steps: left.length, minutes: left.reduce((n, s) => n + (estimateMinutes(s.estimate) || 0), 0) });
}

/**
 * Where one build goes this tick: { account, kind, rule, why }. The per-build override (pipeline.route api | subscription)
 * first; else the Job routing rules of Claude accounts (`routing` = workers.json, normConfig'd), first enabled match
 * decides, exactly as the launcher's decide() does: a rule to api → an API account under its caps (none free → falls
 * through to subscriptions); otherwise the least busy subscription account that runs the model. `rule` = override |
 * the matching rule's id | ''. No account = account '' and `why` says what keeps each option out.
 */
export function routeFor(b, accounts, model, routing = {}) {
  const route = b?.pipeline?.route || '';
  if (route === 'api') {
    const a = apiCandidates(accounts, model)[0];
    return a ? { account: a.name, kind: 'api', rule: 'override', why: `routed to API account ${a.name} (this build is set to run on API)` } : { account: '', kind: '', rule: 'override', why: `set to run on API, ${apiNoAccountWhy(accounts, model)}` };
  }
  const sub = candidates(accounts, model)[0];
  const job = jobOf(b, model);
  let rule = null;
  if (route !== 'subscription') {
    for (const r of list(routing?.rules)) {
      if (!r || r.enabled === false) continue;
      if (!ruleMiss(normRule(r), job, !!sub)) { rule = r; break; }
    }
  }
  let fell = '';
  if (rule?.to === 'api') {
    const only = list(rule.accounts);
    const a = apiCandidates(accounts, model, only)[0];
    if (a) return { account: a.name, kind: 'api', rule: rule.id, why: `Job routing rule "${rule.name}" sends it to API account ${a.name}` };
    fell = `rule "${rule.name}": ${apiNoAccountWhy(accounts, model, only)}`;
  }
  if (sub) return { account: sub.name, kind: 'subscription', rule: rule?.to === 'subscription' ? rule.id : '', why: fell ? `${fell}, so ${sub.name}` : '' };
  const subWhy = noAccountWhy(accounts, model);
  if (route === 'subscription') return { account: '', kind: '', rule: '', why: `${subWhy} (this build is kept off API accounts)` };
  if (fell) return { account: '', kind: '', rule: rule.id, why: `${subWhy}; ${fell}` };
  const hasApi = list(accounts).some((a) => a.kind === 'api');
  return { account: '', kind: '', rule: rule?.id ?? '', why: hasApi && !rule ? `${subWhy} (no Job routing rule sends it to an API account)` : subWhy };
}

/** The API rules of Claude accounts in one line for the console and the CLI ("API fallback when subscriptions are busy: on (hulu-api)"). */
export function routingLines(routing = {}) {
  return list(routing?.rules).filter((r) => r?.to === 'api').map((r) => `${r.name}: ${r.enabled === false ? 'off' : 'on'}${list(r.accounts).length ? ` (${r.accounts.join(', ')})` : ' (any API account)'}${r.when?.subs === 'busy' ? ' · only while subscriptions are busy' : ''}`);
}

/** Why no account takes `model` right now, in plain words. */
export function noAccountWhy(accounts, model) {
  const usable = list(accounts).filter((a) => a.usable);
  const needFable = modelKey(model) === FOUNDATION_MODEL;
  if (!usable.length) return list(accounts).filter((a) => a.kind !== 'api').length ? `no usable Claude account (${list(accounts).filter((a) => a.kind !== 'api').map((a) => `${a.name}: ${a.why || 'busy'}`).join('; ')})` : 'no Claude subscription account is signed in on the VPS';
  const able = needFable ? usable.filter((a) => a.fable) : usable;
  if (!able.length) return `no account with ${MODEL_LABELS[FOUNDATION_MODEL]} (${usable.map((a) => a.name).join(', ')} ${usable.length === 1 ? 'has' : 'have'} none)`;
  return `${able.map((a) => `${a.name} ${a.running}/${a.parallel}`).join(', ')}: every ${needFable ? 'Fable ' : ''}account is at its parallel cap`;
}

// ------------------------------------------------------------------ the plan of one tick

/**
 * What one tick does. `builds` = live builds@1 records; `accounts` = accountViews(); `slots` = { free, used, cap } from
 * agent-slots; `routing` = Claude accounts' workers.json (its Job routing rules); `rules` = the orchestrator rules. Returns { launches, waits, queue, idle }:
 *   launches  [{ id, account, model, phase }]  one per free slot, in Queue order
 *   waits     [{ id, why }]                    queued builds that stay put this tick, and why
 *   idle      null, or { reason, since? }      nothing is running while work waits
 */
export function plan({ builds, accounts, slots, routing = {}, rules, now = Date.now() }) {
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
    const r = routeFor(b, acc, model, routing);
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
    case 'ended': return { ...base, key: `pipeline:end:${d.id}`, severity: d.outcome === 'finished' ? 'success' : 'warning', title: `${d.outcome === 'finished' ? 'Built' : d.outcome === 'requeued' ? 'Back in the Queue' : 'Back in Pending'}: ${str(d.title, 120)}`, body: str(d.note, 1500) };
    case 'failed': return { ...base, key: `pipeline:end:${d.id}`, severity: 'error', title: `Build failed: ${str(d.title, 120)}`, body: str(d.note, 1500) };
    case 'split': return { ...base, key: `pipeline:split:${d.id}`, severity: d.error ? 'warning' : 'info', title: d.error ? `Split needs a look: ${str(d.title, 120)}` : `Split into ${d.steps} steps: ${str(d.title, 120)}`, body: str(d.error || d.note, 1500) };
    default: throw new Error(`unknown alert kind ${kind}`);
  }
}

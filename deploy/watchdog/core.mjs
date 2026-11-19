/**
 * Pipeline 2.0 watchdog, the pure part (pipeline-watchdog@2). No IO: the layer-2 pass (layer2.mjs) gathers the facts
 * (the builds store, tmux, step logs, Claude accounts, the clock) and this module says what is stuck and what to do.
 *
 * Shared contract (Pipeline 2.0, Nov 19 2026), forward-only:
 *   build: pending → splitting → split ("Pending") → pulling-main → assigning-models → ready → sending → building →
 *          build-complete → merging-pr → pr-pulling-main → running-ci → merging-main → landed, plus failed (attempt N)
 *   step:  pending → pulling-main → ready → sending → building → completed → in-pr, plus failed (attempt N)
 * A retry continues forward: a failed record goes back into the status it failed in (failedAt) as attempt N+1, never
 * to an earlier status. Every change records `at` and `by` (here always `by: watchdog`).
 *
 * Layer 1 (the orchestrator tick) does the normal work. This layer finds work that did not move and fixes it:
 *   - a build or step whose status is older than its time budget      → re-run the transition (nudge the tick), then
 *                                                                        after `nudges` tries mark it failed
 *   - a `building` step whose tmux session is gone                     → failed, retried as attempt N+1
 *   - a `building` step whose log shows a usage limit                  → the account is marked out, the step failed and
 *                                                                        retried on another account with usage left
 *   - a failed build or step under maxAttempts                         → retried forward (attempt N+1)
 *   - a failed record at maxAttempts                                   → left failed, one give-up alert
 */

export const SCHEMA = 'pipeline-watchdog@2';
export const BY = 'watchdog';

export const BUILD_FLOW = Object.freeze(['pending', 'splitting', 'split', 'pulling-main', 'assigning-models', 'ready', 'sending', 'building', 'build-complete', 'merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main', 'landed']);
export const STEP_FLOW = Object.freeze(['pending', 'pulling-main', 'ready', 'sending', 'building', 'completed', 'in-pr']);
export const FAILED = 'failed';
export const BUILD_STATUSES = Object.freeze([...BUILD_FLOW, FAILED]);
export const STEP_STATUSES = Object.freeze([...STEP_FLOW, FAILED]);
/** The build holding the box: from pulling-main to merging-main. Only one at a time; nothing else touches main. */
export const ACTIVE_BUILD = Object.freeze(BUILD_FLOW.slice(BUILD_FLOW.indexOf('pulling-main'), BUILD_FLOW.indexOf('landed')));
/** Statuses that legitimately wait while another build is active (the one-active-build rule): never stuck then. */
export const WAITING_BUILD = Object.freeze(['split']);
/** Done: nothing to watch. */
export const BUILD_DONE = Object.freeze(['landed']);
export const STEP_DONE = Object.freeze(['in-pr']);

/** Minutes a status may stand before the watchdog acts (settings.budgets overrides any of them). */
export const BUILD_BUDGET_MIN = Object.freeze({
  pending: 10, splitting: 15, split: 10, 'pulling-main': 20, 'assigning-models': 10, ready: 5, sending: 15,
  building: 300, 'build-complete': 10, 'merging-pr': 20, 'pr-pulling-main': 20, 'running-ci': 60, 'merging-main': 20,
});
export const STEP_BUDGET_MIN = Object.freeze({ pending: 30, 'pulling-main': 15, ready: 60, sending: 10, building: 150, completed: 30 });

export const DEFAULTS = Object.freeze({
  enabled: true,
  maxAttempts: 5,      // attempts per build or step before the watchdog stops retrying and alerts
  nudges: 2,           // re-runs of a stuck transition before it is marked failed
  nudgeEveryMin: 3,    // minutes between two nudges of the same stuck status
  retryAfterMin: 1,    // minutes a failed record stands before it is retried (lets layer 1 retry first)
  logIdleMin: 20,      // a building step over budget is hung only when its log has not grown for this long
  graceMin: 3,         // a building step younger than this is never called dead (the session may still be starting)
  budgets: {},         // { build: { status: min }, step: { status: min } }
});

/** Same text the Claude worker router uses (deploy/claude-workers.mjs LIMIT_RE), plus "any usage limit". */
export const LIMIT_RE = /hit your (?:weekly |daily |session |5-hour |opus |usage )?limit|usage limit reached|reached your (?:usage |weekly )?limit|out of credits|credit balance is too low|rate[_ -]?limit(?:ed)? exceeded/i;

const MIN = 60_000;
const str = (v, n = 400) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n);
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);

export function normSettings(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULTS, budgets: { build: { ...BUILD_BUDGET_MIN }, step: { ...STEP_BUDGET_MIN } } };
  for (const k of ['maxAttempts', 'nudges', 'nudgeEveryMin', 'retryAfterMin', 'logIdleMin', 'graceMin']) out[k] = num(r[k], DEFAULTS[k]);
  if (typeof r.enabled === 'boolean') out.enabled = r.enabled;
  for (const side of ['build', 'step']) for (const [s, m] of Object.entries(r.budgets?.[side] ?? {})) if (Number(m) > 0) out.budgets[side][s] = Number(m);
  return out;
}

/** When the record's current status was set: the contract's `at`, then older field names, then updatedAt. */
export function sinceOf(rec) {
  const hist = Array.isArray(rec?.history) ? rec.history : Array.isArray(rec?.statusLog) ? rec.statusLog : [];
  const last = hist.length ? hist[hist.length - 1] : null;
  const t = rec?.statusAt || rec?.at || (last && last.status === rec?.status ? last.at : '') || rec?.updatedAt || rec?.createdAt || '';
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : 0;
}

export const attemptOf = (rec) => Math.max(1, Math.floor(Number(rec?.attempt) || 1));

/**
 * Forward-only: `to` must come after `from` in the flow; `failed` may follow anything not done; a failed record may
 * only go back into the status it failed in (failedAt), as the next attempt.
 */
export function forwardOk(flow, from, to, failedAt = '') {
  if (to === FAILED) return from !== flow[flow.length - 1];
  if (from === FAILED) return !!failedAt && to === failedAt;
  const a = flow.indexOf(from); const b = flow.indexOf(to);
  return a >= 0 && b > a;
}

/** One stamped status change: the fields the contract carries, plus a history line. Pure: returns the patch. */
export function stamp(rec, flow, to, { at, why = '', attempt, failedAt, extra = {} } = {}) {
  const from = rec.status;
  if (!forwardOk(flow, from, to, rec.failedAt)) throw new Error(`not forward: ${from} → ${to}`);
  const next = { status: to, statusAt: at, statusBy: BY, attempt: attempt ?? attemptOf(rec), ...extra };
  if (to === FAILED) next.failedAt = failedAt || from;
  else next.failedAt = undefined;
  next.history = [...(Array.isArray(rec.history) ? rec.history : []), { status: to, at, by: BY, attempt: next.attempt, ...(why ? { why: str(why, 300) } : {}) }].slice(-100);
  return next;
}

export const isActive = (b) => ACTIVE_BUILD.includes(b?.status) || (b?.status === FAILED && ACTIVE_BUILD.includes(b?.failedAt));
const live = (b) => b && !b.deleted && !b.hidden && !b.demo && BUILD_STATUSES.includes(b.status);
const stepName = (b, s) => `${b.id}/${s.id}`;

/** The minutes past budget of a status, or a negative number when inside it. */
const over = (rec, budgets, now) => (now - sinceOf(rec)) / MIN - (budgets[rec.status] ?? Infinity);

/**
 * Every problem in the store. `probes` maps "<build>/<step>" → { tmux: true|false|null, logTail: '', logAgeMin: n|null };
 * `memory` is the watchdog's own state ({ nudges: { key: { n, last } }, alerted: { key: at } }).
 * Returns issues: { kind, build, step?, status, cause, minutes, … }.
 */
export function findIssues(store, { probes = {}, now = Date.now(), settings = normSettings() } = {}) {
  const S = settings;
  const builds = (store?.builds ?? []).filter(live);
  const anyActive = builds.some((b) => isActive(b) && b.status !== FAILED);
  const out = [];
  for (const b of builds) {
    if (BUILD_DONE.includes(b.status)) continue;
    if (b.status === FAILED) { out.push({ kind: 'build-failed', build: b.id, status: FAILED, failedAt: b.failedAt || '', attempt: attemptOf(b), minutes: Math.round((now - sinceOf(b)) / MIN) }); continue; }
    // steps of this build first: a dead or limited step is the cause of a stuck `building` build
    for (const s of Array.isArray(b.steps) ? b.steps : []) {
      if (!STEP_STATUSES.includes(s.status) || STEP_DONE.includes(s.status) || s.skip) continue;
      const key = stepName(b, s);
      const p = probes[key] ?? {};
      if (s.status === FAILED) { out.push({ kind: 'step-failed', build: b.id, step: s.id, status: FAILED, failedAt: s.failedAt || '', attempt: attemptOf(s), account: s.account || '', tried: Array.isArray(s.tried) ? s.tried : [], minutes: Math.round((now - sinceOf(s)) / MIN) }); continue; }
      if (s.status === 'building') {
        const age = (now - sinceOf(s)) / MIN;
        if (p.logTail && LIMIT_RE.test(p.logTail)) { out.push({ kind: 'step-limit', build: b.id, step: s.id, status: s.status, cause: 'usage-limit', account: s.account || '', attempt: attemptOf(s), evidence: str((p.logTail.match(LIMIT_RE) || [''])[0], 120) }); continue; }
        if (p.tmux === false && age >= S.graceMin) { out.push({ kind: 'step-dead', build: b.id, step: s.id, status: s.status, cause: 'tmux-dead', account: s.account || '', attempt: attemptOf(s), session: p.session || '' }); continue; }
        const late = over(s, S.budgets.step, now);
        if (late > 0 && (p.logAgeMin == null || p.logAgeMin >= S.logIdleMin)) { out.push({ kind: 'step-hung', build: b.id, step: s.id, status: s.status, cause: 'over-budget', minutes: Math.round(late), account: s.account || '', attempt: attemptOf(s), session: p.session || '' }); continue; }
        continue;
      }
      // a step waiting for a slot is only late while its build is the active one (one active build at a time)
      if (s.status === 'ready' && !isActive(b)) continue;
      const late = over(s, S.budgets.step, now);
      if (late > 0) out.push({ kind: 'step-stuck', build: b.id, step: s.id, status: s.status, cause: 'over-budget', minutes: Math.round(late), attempt: attemptOf(s) });
    }
    if (WAITING_BUILD.includes(b.status) && anyActive) continue;
    const late = over(b, S.budgets.build, now);
    if (late > 0) out.push({ kind: 'build-stuck', build: b.id, status: b.status, cause: 'over-budget', minutes: Math.round(late), attempt: attemptOf(b) });
  }
  return out;
}

/**
 * The next account for a retried step: the one with the most usage left that this step has not just failed on and
 * that is not out (limited). `accounts` = [{ name, usable, left }] (left: 0–1 or a percentage). '' = none usable.
 */
export function pickAccount(accounts = [], exclude = []) {
  const ex = new Set(exclude.filter(Boolean));
  const ok = accounts.filter((a) => a && a.name && a.usable !== false && !ex.has(a.name) && !(Number(a.left) <= 0 && a.left != null));
  ok.sort((a, b) => (Number(b.left ?? 1) - Number(a.left ?? 1)) || a.name.localeCompare(b.name));
  return ok[0]?.name || '';
}

const keyOf = (i) => `${i.build}${i.step ? `/${i.step}` : ''}:${i.status}${i.failedAt ? `:${i.failedAt}` : ''}`;

/**
 * What to do about one issue → { action, … }:
 *   nudge              re-run the transition (layer 1 tick for this build); the watchdog remembers the count
 *   fail               mark the build or step failed (attempt N, failedAt = its status), retried on a later pass
 *   fail-limit         a step hit a usage limit: account out, kill the session, fail; the retry picks another account
 *   fail-dead          a building step whose session is gone (or hung: the session is killed first)
 *   retry              a failed record goes back into failedAt as attempt N+1 (a step gets `account` when it needs one)
 *   give-up            attempts used up: stays failed, alert Brett once (the only time this layer pages)
 *   wait               nothing yet (cooling down between nudges, or a retry not yet due)
 */
export function plan(issue, { memory = {}, settings = normSettings(), now = Date.now(), accounts = [], store = null } = {}) {
  const S = settings;
  const k = keyOf(issue);
  const nudged = memory.nudges?.[k] ?? { n: 0, last: 0 };
  switch (issue.kind) {
    case 'build-stuck':
    case 'step-stuck': {
      if (nudged.n < S.nudges) {
        if (nudged.last && now - nudged.last < S.nudgeEveryMin * MIN) return { action: 'wait', key: k, why: 'nudged recently' };
        return { action: 'nudge', key: k, n: nudged.n + 1, why: `${issue.status} ${issue.minutes} min past its budget` };
      }
      return { action: 'fail', key: k, why: `${issue.status} did not move after ${nudged.n} re-run(s) of the transition (${issue.minutes} min past its budget)` };
    }
    case 'step-limit':
      return { action: 'fail-limit', key: k, account: issue.account, why: `usage limit on ${issue.account || 'its account'}: "${issue.evidence}"` };
    case 'step-dead':
      return { action: 'fail-dead', key: k, kill: false, why: `tmux session ${issue.session || ''} is gone while the step was building`.replace('  ', ' ') };
    case 'step-hung':
      return { action: 'fail-dead', key: k, kill: true, why: `building ${issue.minutes} min past its budget with a silent log: session killed` };
    case 'build-failed':
    case 'step-failed': {
      if (memory.alerted?.[k]) return { action: 'wait', key: k, why: 'gave up already (alerted)' };
      if (!issue.failedAt) return { action: 'give-up', key: k, why: 'failed with no failedAt: the watchdog cannot tell where to continue' };
      if (issue.attempt >= S.maxAttempts) return { action: 'give-up', key: k, why: `attempt ${issue.attempt} of ${S.maxAttempts} failed at ${issue.failedAt}` };
      if (issue.minutes < S.retryAfterMin) return { action: 'wait', key: k, why: 'retry not due yet' };
      if (issue.kind === 'build-failed' && ACTIVE_BUILD.includes(issue.failedAt)) {
        const other = (store?.builds ?? []).find((b) => live(b) && b.id !== issue.build && b.status !== FAILED && ACTIVE_BUILD.includes(b.status));
        if (other) return { action: 'wait', key: k, why: `${other.id} is the active build` };
      }
      const r = { action: 'retry', key: k, attempt: issue.attempt + 1, to: issue.failedAt, why: `retry forward at ${issue.failedAt}, attempt ${issue.attempt + 1}` };
      if (issue.kind === 'step-failed' && STEP_FLOW.indexOf(issue.failedAt) >= STEP_FLOW.indexOf('ready') && STEP_FLOW.indexOf(issue.failedAt) <= STEP_FLOW.indexOf('building')) {
        // a step that dies in its slot relaunches through `ready` (the orchestrator sends it to a slot on the pinned account)
        const tried = [issue.account, ...(issue.tried ?? [])];
        const acct = pickAccount(accounts, tried) || pickAccount(accounts, []);
        if (!acct) return { action: 'wait', key: k, why: 'no Claude account has usage left' };
        r.to = 'ready'; r.account = acct;
      }
      return r;
    }
    default:
      return { action: 'wait', key: k, why: 'unknown issue' };
  }
}

/** The status a failed step re-enters: `ready` for anything that died at or after it (the relaunch path). */
export const retryTarget = (failedAt) => (STEP_FLOW.indexOf(failedAt) >= STEP_FLOW.indexOf('ready') && STEP_FLOW.indexOf(failedAt) <= STEP_FLOW.indexOf('building') ? 'ready' : failedAt);

/**
 * Apply one decision to a store (mutates the build record in place; pure of IO). Returns the note text written, or ''.
 * `ready` after a failed `building` step is the relaunch path, so the step's forward check accepts it as its retry.
 */
export function applyDecision(store, issue, d, { now = Date.now() } = {}) {
  const at = new Date(now).toISOString();
  const b = (store.builds ?? []).find((x) => x.id === issue.build);
  if (!b) return '';
  const rec = issue.step ? (b.steps ?? []).find((s) => s.id === issue.step) : b;
  if (!rec || rec.status !== issue.status) return ''; // moved since the scan: layer 1 got there first
  const flow = issue.step ? STEP_FLOW : BUILD_FLOW;
  const what = issue.step ? `step ${issue.step}` : 'build';
  let text = '';
  if (d.action === 'fail' || d.action === 'fail-limit' || d.action === 'fail-dead') {
    const extra = issue.step ? { tried: [...new Set([...(rec.tried ?? []), rec.account].filter(Boolean))].slice(-10) } : {};
    Object.assign(rec, stamp(rec, flow, FAILED, { at, why: d.why, failedAt: rec.status, extra }));
    text = `Watchdog: ${what} failed at ${rec.failedAt}, attempt ${attemptOf(rec)}: ${d.why}.`;
  } else if (d.action === 'retry') {
    const to = issue.step ? retryTarget(rec.failedAt) : rec.failedAt;
    const fake = issue.step && to !== rec.failedAt ? { ...rec, failedAt: to } : rec;
    const extra = d.account ? { account: d.account, slot: undefined, session: undefined } : {};
    Object.assign(rec, stamp(fake, flow, to, { at, why: d.why, attempt: d.attempt, extra }));
    text = `Watchdog: ${what} retried at ${to}, attempt ${d.attempt}${d.account ? ` on ${d.account}` : ''}.`;
  } else if (d.action === 'nudge') {
    text = `Watchdog: ${what} stuck at ${issue.status} (${issue.minutes} min past budget): re-ran the transition (${d.n}).`;
  } else if (d.action === 'give-up') {
    text = `Watchdog: ${what} gave up: ${d.why}. Alerted Brett.`;
  }
  if (text) {
    b.notes = [...(Array.isArray(b.notes) ? b.notes : []), { text, at, by: BY }];
    b.updatedAt = at;
  }
  return text;
}

/** The watchdog's memory after a pass: nudge counts per stuck key (dropped once the key is gone), alert stamps. */
export function nextMemory(memory = {}, issues = [], decisions = [], now = Date.now()) {
  const live = new Set(issues.map(keyOf));
  const nudges = Object.fromEntries(Object.entries(memory.nudges ?? {}).filter(([k]) => live.has(k)));
  for (const d of decisions) if (d.action === 'nudge') nudges[d.key] = { n: d.n, last: now };
  const alerted = { ...(memory.alerted ?? {}) };
  for (const d of decisions) if (d.action === 'give-up' && !alerted[d.key]) alerted[d.key] = new Date(now).toISOString();
  for (const k of Object.keys(alerted)) if (!live.has(k)) delete alerted[k];
  return { nudges, alerted };
}

export { keyOf };

/**
 * Pipeline 2.0 watchdog, the pure part (pipeline-watchdog@2). No IO: the layer-2 pass (layer2.mjs) gathers the facts
 * (the builds store, tmux, step logs, Claude accounts, the clock) and this module says what is stuck and what to do.
 *
 * This is the one Pipeline 2.0 watchdog, and it has no status rules of its own: the flows, who holds the active place
 * (holdsActive), the attempt ceiling (MAX_ATTEMPTS), the step cap and every status change (transition) come from the
 * contract, framework/core/pipeline-status.mjs. A retry continues forward: a failed record goes back into the status
 * it failed in (failedFrom) as attempt N+1, never to an earlier status. Every change records `at` and `by: watchdog`.
 *
 * Layer 1 (the orchestrator tick) does the normal work. This layer finds work that did not move and fixes it:
 *   - a build or step whose status is older than its time budget      → re-run the transition (nudge the tick), then
 *                                                                        after `nudges` tries mark it failed
 *   - a build waiting its turn at `split`                              → nothing, however long, while any build holds
 *                                                                        the active place (a failed one holds it too)
 *   - a `building` step past twice its estimate with a silent log      → hung: session killed, failed, relaunched
 *   - a `building` step whose tmux session is gone                     → failed, retried as attempt N+1
 *   - a `building` step whose log shows a usage limit                  → the account is marked out, the step failed and
 *                                                                        retried on another account with usage left
 *   - a failed build or step under maxAttempts                         → retried forward (attempt N+1)
 *   - a build in a landing status (LANDER_OWNED)                       → the lander's: nudged with a lander tick only
 *   - an Opus step failed in its slot at maxAttempts                   → raised to Fable once (the switch is noted on
 *                                                                        the build) and relaunched with a fresh
 *                                                                        attempt count (a reset, with the reason)
 *   - a failed record at maxAttempts                                   → left failed, one give-up alert; final: the
 *                                                                        contract refuses every move out of it but a
 *                                                                        reset (Brett's retry: orchestrator.mjs retry)
 */
import * as P2 from '../../framework/core/pipeline-status.mjs';

const { MAX_ATTEMPTS, FAILED, BUILD_FLOW, STEP_FLOW, BUILD_STATUSES, STEP_STATUSES } = P2;
export { FAILED, BUILD_FLOW, STEP_FLOW, BUILD_STATUSES, STEP_STATUSES };

export const SCHEMA = 'pipeline-watchdog@2';
export const BY = 'watchdog';

/** The build holding the box: from pulling-main to merging-main. Only one at a time; nothing else touches main. */
export const ACTIVE_BUILD = P2.ACTIVE;
/** Statuses that legitimately wait while another build holds the active place (the one-active-build rule): never stuck then. */
export const WAITING_BUILD = P2.WAITING;
/**
 * The lander's statuses (deploy/lander, lander@1): from build-complete to merging-main, and failed in one of them. The
 * lander retries its own failures with its own backoff, so the watchdog never fails or retries these: a stuck one is
 * nudged by running one lander tick for that build. Once the attempts are used up (the contract's ceiling stops the
 * lander too) the watchdog gives up on it like on any other record: one alert.
 */
export const LANDER_OWNED = Object.freeze(BUILD_FLOW.slice(BUILD_FLOW.indexOf('build-complete'), BUILD_FLOW.indexOf('landed')));
export const landerOwned = (b) => LANDER_OWNED.includes(b?.status) || (b?.status === FAILED && LANDER_OWNED.includes(b?.failedFrom));
/** Done: nothing to watch. */
export const BUILD_DONE = Object.freeze(['landed']);
export const STEP_DONE = Object.freeze(['in-pr']);

/**
 * Minutes a status may stand before the watchdog acts (settings.budgets overrides any of them). `split` only counts
 * while no build holds the active place. A `building` step has no fixed budget: twice its own estimate
 * (P2.stepBudgetMinutes, from the one step cap), unless settings.budgets.step.building sets one.
 */
export const BUILD_BUDGET_MIN = Object.freeze({
  pending: 10, splitting: 15, split: 10, 'pulling-main': 20, 'assigning-models': 10, ready: 5, sending: 15,
  building: 300, 'build-complete': 10, 'merging-pr': 20, 'pr-pulling-main': 20, 'running-ci': 60, 'merging-main': 20,
});
export const STEP_BUDGET_MIN = Object.freeze({ pending: 30, 'pulling-main': 15, ready: 60, sending: 10, completed: 30 });

export const DEFAULTS = Object.freeze({
  enabled: true,
  maxAttempts: MAX_ATTEMPTS, // attempts per build or step before the watchdog stops retrying and alerts (layer 1 reads it too); never above the contract's ceiling
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
  out.maxAttempts = Math.max(1, Math.min(MAX_ATTEMPTS, Math.floor(out.maxAttempts) || MAX_ATTEMPTS));
  if (typeof r.enabled === 'boolean') out.enabled = r.enabled;
  for (const side of ['build', 'step']) for (const [s, m] of Object.entries(r.budgets?.[side] ?? {})) if (Number(m) > 0) out.budgets[side][s] = Number(m);
  return out;
}

/** When the record's current status was set: the contract's `at`, then older field names, then updatedAt. */
export function sinceOf(rec) {
  const hist = Array.isArray(rec?.statusLog) ? rec.statusLog : [];
  const last = hist.length ? hist[hist.length - 1] : null;
  const t = rec?.statusAt || rec?.at || (last && last.status === rec?.status ? last.at : '') || rec?.updatedAt || rec?.createdAt || '';
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : 0;
}

export const attemptOf = (rec) => Math.max(1, Math.floor(Number(rec?.attempt) || 1));

/** Does the build hold the active place (the contract's one definition: a build that failed while active still does)? */
export const isActive = (b) => P2.holdsActive(b);
/** The build every waiting build waits for, or null: the contract's activeBuild over every build in the store. */
export const placeHolder = (store) => P2.activeBuild(store?.builds ?? []).active;
const live = (b) => b && !b.deleted && !b.hidden && !b.demo && BUILD_STATUSES.includes(b.status);
const stepName = (b, s) => `${b.id}/${s.id}`;

/** The minutes past budget of a status, or a negative number when inside it. */
const over = (rec, budgets, now) => (now - sinceOf(rec)) / MIN - (budgets[rec.status] ?? Infinity);
/** A building step's budget: the setting when one is set, else twice the step's own estimate. */
const buildingBudget = (s, budgets) => (Number(budgets.building) > 0 ? Number(budgets.building) : P2.stepBudgetMinutes(s));

/**
 * Every problem in the store. `probes` maps "<build>/<step>" → { tmux: true|false|null, logTail: '', logAgeMin: n|null };
 * `memory` is the watchdog's own state ({ nudges: { key: { n, last } }, alerted: { key: at } }).
 * Returns issues: { kind, build, step?, status, cause, minutes, … }.
 */
export function findIssues(store, { probes = {}, now = Date.now(), settings = normSettings() } = {}) {
  const S = settings;
  const builds = (store?.builds ?? []).filter(live);
  const holder = placeHolder(store);
  const out = [];
  for (const b of builds) {
    if (BUILD_DONE.includes(b.status)) continue;
    // the lander retries its own failures (its own backoff); once the attempts are used up the contract stops it too,
    // and that is a give-up like any other (one alert: only a reset moves the build on)
    if (b.status === FAILED && landerOwned(b) && !P2.gaveUp(b, S.maxAttempts)) continue;
    if (b.status === FAILED) { out.push({ kind: 'build-failed', build: b.id, status: FAILED, failedFrom: b.failedFrom || '', attempt: attemptOf(b), minutes: Math.round((now - sinceOf(b)) / MIN) }); continue; }
    // steps of this build first: a dead or limited step is the cause of a stuck `building` build
    for (const s of Array.isArray(b.steps) ? b.steps : []) {
      if (!STEP_STATUSES.includes(s.status) || STEP_DONE.includes(s.status) || s.skip) continue;
      const key = stepName(b, s);
      const p = probes[key] ?? {};
      if (s.status === FAILED) { out.push({ kind: 'step-failed', build: b.id, step: s.id, status: FAILED, failedFrom: s.failedFrom || '', attempt: attemptOf(s), model: s.model || '', account: s.account || '', tried: Array.isArray(s.tried) ? s.tried : [], minutes: Math.round((now - sinceOf(s)) / MIN) }); continue; }
      if (s.status === 'building') {
        const age = (now - sinceOf(s)) / MIN;
        if (p.logTail && LIMIT_RE.test(p.logTail)) { out.push({ kind: 'step-limit', build: b.id, step: s.id, status: s.status, cause: 'usage-limit', account: s.account || '', attempt: attemptOf(s), evidence: str((p.logTail.match(LIMIT_RE) || [''])[0], 120) }); continue; }
        if (p.tmux === false && age >= S.graceMin) { out.push({ kind: 'step-dead', build: b.id, step: s.id, status: s.status, cause: 'tmux-dead', account: s.account || '', attempt: attemptOf(s), session: p.session || '' }); continue; }
        const late = age - buildingBudget(s, S.budgets.step);
        if (late > 0 && (p.logAgeMin == null || p.logAgeMin >= S.logIdleMin)) { out.push({ kind: 'step-hung', build: b.id, step: s.id, status: s.status, cause: 'over-budget', minutes: Math.round(late), account: s.account || '', attempt: attemptOf(s), session: p.session || '' }); continue; }
        continue;
      }
      // a step waiting for a slot is only late while its build is the active one (one active build at a time); a
      // pending step of a build that waits its turn (split) is not late either: main is pulled into it only once the
      // build is active (Nov 20 2026: a waiting build's pending steps were failed and retried towards a give-up)
      if ((s.status === 'ready' || s.status === 'pending') && !isActive(b)) continue;
      // a completed step waits for its siblings: only the lander moves it on (in-pr), after build-complete. Never late
      // before that (Nov 20 2026: finished steps were failed and given up on while the rest of the build still ran);
      // late after it = the lander's, nudged only
      if (s.status === 'completed' && !landerOwned(b)) continue;
      const late = over(s, S.budgets.step, now);
      if (late > 0) out.push({ kind: 'step-stuck', build: b.id, step: s.id, status: s.status, cause: 'over-budget', minutes: Math.round(late), attempt: attemptOf(s), ...(s.status === 'completed' ? { lander: true } : {}) });
    }
    // waiting its turn is never stuck, however long: a build holds the active place (failed ones too), so this one
    // cannot move. Emergency builds never wait for the place.
    if (WAITING_BUILD.includes(b.status) && holder && holder.id !== b.id && !P2.isEmergency(b)) continue;
    const late = over(b, S.budgets.build, now);
    if (late > 0) out.push({ kind: 'build-stuck', build: b.id, status: b.status, cause: 'over-budget', minutes: Math.round(late), attempt: attemptOf(b), ...(landerOwned(b) ? { lander: true } : {}) });
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

const keyOf = (i) => `${i.build}${i.step ? `/${i.step}` : ''}:${i.status}${i.failedFrom ? `:${i.failedFrom}` : ''}`;

/**
 * What to do about one issue → { action, … }:
 *   nudge              re-run the transition (layer 1 tick for this build); the watchdog remembers the count
 *   fail               mark the build or step failed (attempt N, failedFrom = its status), retried on a later pass
 *   fail-limit         a step hit a usage limit: account out, kill the session, fail; the retry picks another account
 *   fail-dead          a building step whose session is gone (or hung: the session is killed first)
 *   retry              a failed record goes back into failedFrom as attempt N+1 (a step gets `account` when it needs one)
 *   escalate           an Opus step that died in its slot used up its attempts: raised to Fable, relaunched once more
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
      if (issue.lander) {
        // the lander's status: nudge it (one lander tick for this build) as often as it stays stuck; never fail it here
        if (nudged.last && now - nudged.last < S.nudgeEveryMin * MIN) return { action: 'wait', key: k, why: 'nudged the lander recently' };
        return { action: 'nudge', key: k, n: nudged.n + 1, lander: true, why: `${issue.status} ${issue.minutes} min past its budget (the lander's)` };
      }
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
      // a step failed after its session ended cleanly (failedFrom completed: older passes failed finished steps as
      // "stuck"): its work is done, so it goes back to completed whatever its attempt count or alert
      if (issue.kind === 'step-failed' && issue.failedFrom === 'completed') return { action: 'retry', key: k, attempt: issue.attempt + 1, to: 'completed', reset: issue.attempt >= S.maxAttempts, why: 'its session had ended cleanly: back to completed' };
      if (memory.alerted?.[k]) return { action: 'wait', key: k, why: 'gave up already (alerted)' };
      if (!issue.failedFrom) return { action: 'give-up', key: k, why: 'failed with no failedFrom: the watchdog cannot tell where to continue' };
      const inSlot = issue.kind === 'step-failed' && STEP_FLOW.indexOf(issue.failedFrom) >= STEP_FLOW.indexOf('ready') && STEP_FLOW.indexOf(issue.failedFrom) <= STEP_FLOW.indexOf('building');
      if (issue.attempt >= S.maxAttempts) {
        // the Fable path (Brett, Nov 4 2026: "If it needs Fable, set it to be Fable"): one more go on the stronger model
        if (inSlot && issue.model && issue.model !== 'Fable') {
          const acct = pickAccount(accounts, [issue.account, ...(issue.tried ?? [])]) || pickAccount(accounts, []);
          if (acct) return { action: 'escalate', key: k, attempt: 1, to: 'ready', account: acct, model: 'Fable', reset: true, why: `attempt ${issue.attempt} of ${S.maxAttempts} failed on ${issue.model} at ${issue.failedFrom}: raised to Fable with a fresh attempt count` };
        }
        return { action: 'give-up', key: k, why: `attempt ${issue.attempt} of ${S.maxAttempts} failed at ${issue.failedFrom}${issue.model === 'Fable' && inSlot ? ' (Fable included)' : ''}` };
      }
      if (issue.minutes < S.retryAfterMin) return { action: 'wait', key: k, why: 'retry not due yet' };
      if (issue.kind === 'build-failed' && ACTIVE_BUILD.includes(issue.failedFrom)) {
        // emergency builds run beside the active build: one never waits for the active place, and is never the build waited for
        const mine = (store?.builds ?? []).find((b) => b.id === issue.build);
        const other = P2.isEmergency(mine) ? null : placeHolder(store);
        if (other && other.id !== issue.build) return { action: 'wait', key: k, why: `${other.id} is the active build` };
      }
      const r = { action: 'retry', key: k, attempt: issue.attempt + 1, to: issue.failedFrom, why: `retry forward at ${issue.failedFrom}, attempt ${issue.attempt + 1}` };
      if (inSlot) {
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
export const retryTarget = (failedFrom) => (STEP_FLOW.indexOf(failedFrom) >= STEP_FLOW.indexOf('ready') && STEP_FLOW.indexOf(failedFrom) <= STEP_FLOW.indexOf('building') ? 'ready' : failedFrom);

/**
 * Apply one decision to a store (mutates the build record in place; pure of IO). Returns the note text written, or ''.
 * Every status change goes through the contract's transition (P2.transition): the attempt count, failedFrom and the
 * log line are its; a move it refuses changes nothing. `ready` after a step died in its slot is the contract's relaunch
 * path; an escalation and a finished step going back to completed past the ceiling are resets with their reason.
 */
export function applyDecision(store, issue, d, { now = Date.now() } = {}) {
  const at = new Date(now).toISOString();
  const b = (store.builds ?? []).find((x) => x.id === issue.build);
  if (!b) return '';
  const rec = issue.step ? (b.steps ?? []).find((s) => s.id === issue.step) : b;
  if (!rec || rec.status !== issue.status) return ''; // moved since the scan: layer 1 got there first
  const kind = issue.step ? 'step' : 'build';
  const what = issue.step ? `step ${issue.step}` : 'build';
  const move = (to, opts = {}) => { const t = P2.transition(rec, to, { at, by: BY, why: d.why, kind, ...opts }); if (t.ok) { for (const k of Object.keys(rec)) if (!(k in t.rec)) delete rec[k]; Object.assign(rec, t.rec); } return t.ok; };
  let text = '';
  if (d.action === 'fail' || d.action === 'fail-limit' || d.action === 'fail-dead') {
    const extra = issue.step ? { tried: [...new Set([...(rec.tried ?? []), rec.account].filter(Boolean))].slice(-10) } : null;
    if (move(FAILED, { extra })) text = `Watchdog: ${what} failed at ${rec.failedFrom}, attempt ${attemptOf(rec)}: ${d.why}.`;
  } else if (d.action === 'escalate' && issue.step) {
    const from = rec.model || 'Opus'; const tries = attemptOf(rec);
    if (move('ready', { reset: true, extra: { model: 'Fable', account: d.account, slot: undefined, tmux: undefined } })) text = `Watchdog: step ${issue.step} raised ${from} → Fable after ${tries} failed attempts; relaunched at ready, attempt ${attemptOf(rec)} on ${d.account}.`;
  } else if (d.action === 'retry') {
    const to = issue.step ? retryTarget(rec.failedFrom) : rec.failedFrom;
    // the pinned account for the relaunch (the orchestrator honours it unless it is out); the old slot and tmux go
    const extra = d.account ? { account: d.account, slot: undefined, tmux: undefined } : null;
    if (move(to, { reset: d.reset === true, extra })) text = `Watchdog: ${what} retried at ${to}, attempt ${attemptOf(rec)}${d.account ? ` on ${d.account}` : ''}.`;
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

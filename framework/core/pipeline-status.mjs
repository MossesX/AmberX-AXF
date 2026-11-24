/**
 * pipeline-2@1 — the Pipeline 2.0 status contract (framework/spec/PIPELINE-2.md, JSON Schema
 * framework/schemas/pipeline-2.json). Pure: no IO, no clock unless one is passed. Shared by the builds store (which
 * enforces it on every write), the orchestrator flow, the lander, the watchdog and the builds table.
 *
 * Brett, Nov 19 2026: everything is status, forward-only. A build or a step only ever moves forward through its flow;
 * `failed` (with `attempt: N`, shown "failed, attempt N") may be entered from any status but the last, and a retry
 * leaves `failed` forward again: at the status it failed at or later, never earlier, as attempt N + 1.
 * Every status change records `at` and `by` (statusAt, statusBy, and one statusLog line).
 *
 * The contract owns every limit (one place, every caller covered):
 *   - attempts: a record failed at MAX_ATTEMPTS leaves `failed` only through a reset with a reason (Brett's retry, the
 *     watchdog's escalation); the attempt count then starts again at 1;
 *   - step size: STEP_MAX_MINUTES, read by the split prompt, the design check, the split and the watchdog;
 *   - archive: an archived build remembers where it was (`archivedFrom`) and returns there, or to `failed` from it;
 *   - steps: once a build is split its steps keep their identity (none removed, none replaced), and past `split` none
 *     is added; every step always has a status (a new one enters at `pending`);
 *   - refusals are whole: a write that breaks any of this changes nothing on that build (enforceFlow, strict).
 *
 * A build follows this contract when `flow === 'pipeline-2'` (set by Plan Studio's Send to orchestrator, or by the
 * first write that gives a build a Pipeline 2.0-only status). Builds made before it keep their builds@1 statuses.
 */

export const SCHEMA = 'pipeline-2@1';
export const FLOW = 'pipeline-2';
export const FAILED = 'failed';

/** Build statuses, in order. `split` is shown as "Pending" (the build row reads pending again once its steps exist). */
export const BUILD_FLOW = Object.freeze(['pending', 'splitting', 'split', 'pulling-main', 'assigning-models', 'ready', 'sending', 'building', 'build-complete', 'merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main', 'landed']);
/** Step statuses, in order. `in-pr` carries the PR number (prNumber). */
export const STEP_FLOW = Object.freeze(['pending', 'pulling-main', 'ready', 'sending', 'building', 'completed', 'in-pr']);
export const BUILD_STATUSES = Object.freeze([...BUILD_FLOW, FAILED]);
export const STEP_STATUSES = Object.freeze([...STEP_FLOW, FAILED]);
/** Statuses only Pipeline 2.0 uses (a build given one of these joins the contract). */
export const P2_ONLY = Object.freeze(BUILD_FLOW.filter((s) => !['pending', 'landed'].includes(s)));
/**
 * Active: from the first main pull to the merge into main. Only ONE build may be active at a time, and nothing pulls
 * main, merges or touches main while one is (the dispatcher's gate, the lander's and the watchdog's).
 */
export const ACTIVE = Object.freeze(BUILD_FLOW.slice(BUILD_FLOW.indexOf('pulling-main'), BUILD_FLOW.indexOf('landed')));
/**
 * One PR group's landing run (the lander, lander@1): over the size cap or after a split a build lands as several PRs,
 * one at a time, and each later group runs these again from `merging-pr`.
 */
export const LANDING_GROUP = Object.freeze(BUILD_FLOW.slice(BUILD_FLOW.indexOf('merging-pr'), BUILD_FLOW.indexOf('landed')));
/** Step statuses a step dies in while it is being sent or built: its relaunch re-enters at `ready` (watchdog layer 2). */
export const RELAUNCH_FROM = Object.freeze(['ready', 'sending', 'building']);
/** The statuses a build waits its turn in: failed there, it has never held the active place and may be activated again. */
export const WAITING = Object.freeze(['split']);
/** A build that failed while active still holds the one active place (its retry continues forward). */
export const holdsActive = (b) => !!b && b.flow === FLOW && !b.deleted && (ACTIVE.includes(b.status) || (b.status === FAILED && ACTIVE.includes(b.failedFrom)));
/**
 * Emergency builds (Brett, Nov 20 2026): a build Brett sent to emergency from his signed-in console carries
 * `emergency: { at, by }`. It skips the line: it never waits for the active place and never holds it (so it runs beside
 * the active build, in the emergency slot pool), and the lander takes it before every other build.
 */
export const isEmergency = (b) => !!b && !!b.emergency && typeof b.emergency === 'object' && !!str(b.emergency.at);
/** The tag as stored: { at, by } or null. */
export const normEmergency = (e) => (e && typeof e === 'object' && !Array.isArray(e) && str(e.at) ? { at: str(e.at, 40), by: str(e.by, 80) } : null);
/**
 * Hand builds (Brett, Nov 23 2026): a session started by hand (axHub vps.build_start, a console launch) gets a record
 * the moment it starts, tagged `hand: { at, by }`. It is one step whose session is already running, so it enters the
 * flow at `building`. It never waits for the active place and never holds it (it runs beside the active build, in the
 * slot its launcher booked), the dispatcher never launches it, and from `build-complete` on the lander lands it like
 * any other build.
 */
export const isHand = (b) => !!b && !!b.hand && typeof b.hand === 'object' && !!str(b.hand.at);
/** The tag as stored: { at, by } or null. */
export const normHand = (h) => (h && typeof h === 'object' && !Array.isArray(h) && str(h.at) ? { at: str(h.at, 40), by: str(h.by, 80) } : null);
/** Runs beside the line: an emergency build or a hand build. Neither takes, waits for, or breaches the one active place. */
export const besideLine = (b) => isEmergency(b) || isHand(b);
/**
 * A budget stop (build-budget@1, framework/core/build-budget.mjs): `budgetStop: { at, kind: build | daily, spentUsd,
 * capUsd }` on a build whose spend reached its cap, or that was running when the day's cap was reached. While it is
 * set nothing of the build is launched and the watchdog leaves it alone; it is cleared when the cap allows it again.
 */
export const normBudgetStop = (x) => (x && typeof x === 'object' && !Array.isArray(x) && str(x.at) && ['build', 'daily'].includes(x.kind)
  ? { at: str(x.at, 40), kind: x.kind, spentUsd: Math.max(0, Number(x.spentUsd) || 0), capUsd: Math.max(0, Number(x.capUsd) || 0) } : null);
export const isBudgetStopped = (b) => !!normBudgetStop(b?.budgetStop);
/** A Pipeline 2.0 build may also be archived (removed from the table); that is the one way out of the flow. */
export const EXIT = 'archived';

export const BUILD_LABELS = Object.freeze({
  pending: 'Pending', splitting: 'Splitting', split: 'Pending', 'pulling-main': 'Pulling in main', 'assigning-models': 'Assigning models',
  ready: 'Ready for build', sending: 'Sending to slot', building: 'Building', 'build-complete': 'Build complete', 'merging-pr': 'Merging to one PR',
  'pr-pulling-main': 'Pulling in main (PR)', 'running-ci': 'Running CI', 'merging-main': 'Merging into main', landed: 'Landed', failed: 'Failed',
});
export const STEP_LABELS = Object.freeze({
  pending: 'Pending', 'pulling-main': 'Pulling in main', ready: 'Ready', sending: 'Sending to slot', building: 'Building', completed: 'Completed', 'in-pr': 'In PR', failed: 'Failed',
});
/** The fields a build or step carries for the contract. */
export const BUILD_FIELDS = Object.freeze(['flow', 'status', 'statusAt', 'statusBy', 'attempt', 'failedFrom', 'archivedFrom', 'statusLog']);
export const STEP_FIELDS = Object.freeze(['status', 'statusAt', 'statusBy', 'attempt', 'failedFrom', 'statusLog', 'model', 'account', 'slot', 'prNumber', 'worktree', 'branch', 'tmux', 'tried']);
export const TRIED_MAX = 10;
export const LOG_MAX = 60;
/**
 * Attempts a step or build gets, the ceiling for every writer (the dispatcher, the main pull, the lander, the watchdog;
 * the watchdog's maxAttempts setting may lower it, never raise it). A record failed at or past it has given up: the
 * contract refuses every move out of `failed` (Nov 20 2026: a step relaunched to "attempt 21", a build at "attempt 9")
 * except a reset with a reason, which starts the count again at 1.
 */
export const MAX_ATTEMPTS = 5;
/**
 * The one step-size cap, in minutes (Brett: a build step is 15 minutes or less). The split prompt asks for it, normDesign
 * refuses a design over it, splitParts never joins steps past it, and the watchdog calls a `building` step hung at twice
 * its estimate with a silent log (stepBudgetMinutes). The builds@1 rules default (maxStepMinutes) reads it too.
 */
export const STEP_MAX_MINUTES = 15;

const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const flowOf = (kind) => (kind === 'step' ? STEP_FLOW : BUILD_FLOW);
const statusesOf = (kind) => (kind === 'step' ? STEP_STATUSES : BUILD_STATUSES);
export const rank = (status, kind = 'build') => flowOf(kind).indexOf(status);
export const isStatus = (status, kind = 'build') => statusesOf(kind).includes(status);
export const isP2 = (b) => !!b && (b.flow === FLOW || P2_ONLY.includes(b.status));
/** Has this record used up its attempts (failed at attempt >= max)? Then the orchestrator leaves it to the watchdog. */
export const gaveUp = (rec, max = MAX_ATTEMPTS) => !!rec && rec.status === FAILED && Math.max(1, Number(rec.attempt) || 1) >= Math.max(1, Number(max) || MAX_ATTEMPTS);
/** May the orchestrator send this step to a slot: `ready`, or failed in a slot status with attempts left. */
export const sendable = (s, max = MAX_ATTEMPTS) => !!s && (s.status === 'ready' || (s.status === FAILED && ['ready', 'sending', 'building'].includes(s.failedFrom) && !gaveUp(s, max)));

/** "Pending", "Pulling in main", "failed, attempt 2". */
export function labelOf(status, attempt = 1, kind = 'build') {
  if (status === FAILED) return `failed, attempt ${Math.max(1, Number(attempt) || 1)}`;
  return (kind === 'step' ? STEP_LABELS : BUILD_LABELS)[status] ?? str(status, 40);
}

const lastOf = (list) => (Array.isArray(list) && list.length ? list[list.length - 1] : null);
/** The last status of the flow a record's log shows (what it was before its status was lost or it was archived). */
const lastLogged = (rec, kind) => { const l = (Array.isArray(rec?.statusLog) ? rec.statusLog : []).filter((x) => isStatus(x?.status, kind)); return l.length ? l[l.length - 1].status : ''; };
/** Where an archived build returns to: the status it was archived from (recorded, else the last one its log shows). */
export const archivedFromOf = (rec) => (isStatus(rec?.archivedFrom, 'build') ? rec.archivedFrom : lastLogged(rec, 'build'));

/**
 * May `rec` move from its status to `to`? → { ok, why, retry }. `rec` = { status, failedFrom, attempt, archivedFrom,
 * statusLog }.
 *  - the same status is a no-op (ok);
 *  - a status outside the contract is refused;
 *  - a build may be archived from anywhere; an archived build returns only to the status it was archived from, or to
 *    `failed` from it (never anywhere else: archive is not a way back);
 *  - a record not yet in the contract (a builds@1 status, or none, and no status log) may enter it anywhere; one that
 *    is in it but lost its status continues from the last status its log shows;
 *  - `failed` from anything but the last status of the flow;
 *  - out of `failed`: refused once the attempts are used up (attempt >= `max`) unless `reset` is given; otherwise to the
 *    status it failed at or later (retry = true, attempt + 1, or 1 on a reset); two named re-entries: a step that
 *    failed at ready / sending / building may relaunch at `ready` (RELAUNCH_FROM), and a build that failed in a PR
 *    group's landing run may retry at any status of that run (LANDING_GROUP: re-run CI, split, pull main);
 *  - otherwise forward only (skips allowed), never back, except that a build in a landing run may start the next PR
 *    group at `merging-pr` (the lander's size cap and splits).
 */
export function checkTransition(rec, to, kind = 'build', { reset = false, max = MAX_ATTEMPTS } = {}) {
  let cur = str(rec?.status, 40);
  if (cur === to) return { ok: true, why: '', retry: false, same: true };
  if (kind === 'build' && to === EXIT) return { ok: true, why: '', retry: false, archive: true };
  if (!isStatus(to, kind)) return { ok: false, why: `"${to}" is not a ${kind} status of ${SCHEMA} (${statusesOf(kind).join(', ')})` };
  const flow = flowOf(kind); const last = flow[flow.length - 1];
  if (kind === 'build' && cur === EXIT) {
    const back = archivedFromOf(rec);
    if (!back) return rec?.flow === FLOW ? (to === flow[0] ? { ok: true, why: '', retry: false, unarchive: true } : { ok: false, why: `an archived build returns to the status it was archived from: nothing is recorded for this one, so only ${flow[0]}` }) : { ok: true, why: '', retry: false, entered: true };
    if (to === back || (to === FAILED && back !== last)) return { ok: true, why: '', retry: false, unarchive: true, back };
    return { ok: false, why: `an archived build returns to the status it was archived from (${back}), or to failed from it: not ${to}` };
  }
  if (!isStatus(cur, kind)) {
    cur = lastLogged(rec, kind);
    if (!cur) return { ok: true, why: '', retry: false, entered: true };
    if (cur === to) return { ok: true, why: '', retry: false };
  }
  if (to === FAILED) return cur === last ? { ok: false, why: `${cur} is final: it cannot fail any more` } : { ok: true, why: '', retry: false };
  if (cur === FAILED) {
    const cap = Math.max(1, Number(max) || MAX_ATTEMPTS);
    if (!reset && gaveUp(rec, cap)) return { ok: false, gaveUp: true, why: `attempts used up: ${kind} failed at attempt ${Math.max(1, Number(rec?.attempt) || 1)} of ${cap}, so only a reset with a reason (Brett's retry, the watchdog's escalation) moves it on` };
    const ff = str(rec?.failedFrom, 40);
    const from = rank(ff, kind);
    const relaunch = kind === 'step' && to === 'ready' && RELAUNCH_FROM.includes(ff);
    const regroup = kind === 'build' && LANDING_GROUP.includes(ff) && LANDING_GROUP.includes(to);
    if (from >= 0 && rank(to, kind) < from && !relaunch && !regroup) return { ok: false, why: `a retry continues forward: ${kind} failed at ${rec.failedFrom}, so it cannot go back to ${to}` };
    return { ok: true, why: '', retry: true, reset: !!reset };
  }
  if (kind === 'build' && to === 'merging-pr' && LANDING_GROUP.includes(cur)) return { ok: true, why: '', retry: false, group: true };
  if (rank(to, kind) < rank(cur, kind)) return { ok: false, why: `forward-only: ${cur} → ${to} goes back` };
  return { ok: true, why: '', retry: false };
}

/**
 * Move one record (a build, or a step with kind 'step'), pure: → { ok, why, rec } (rec is a copy; unchanged when
 * refused). Records at / by, the attempt (failed keeps the attempt it failed on; a retry is attempt + 1), the status it
 * failed at, and one statusLog line. `extra` is merged into the record on success (account, slot, prNumber…).
 *   reset: true   leave `failed` whatever the attempt count, as attempt 1. Needs `why` (the log line carries both: the
 *                 store's guard lets a reset through only with them).
 *   resplit: true a build waiting at `split` whose steps are all still pending is split again: same status, one log
 *                 line marked `resplit` (the guard then lets that write replace the steps). Needs `why`.
 *   max           the attempt ceiling (never above MAX_ATTEMPTS).
 */
export function transition(rec, to, { at, by = 'pipeline', why = '', kind = 'build', extra = null, reset = false, resplit = false, max = MAX_ATTEMPTS } = {}) {
  const r = { ...(rec ?? {}) };
  if ((reset || resplit) && !str(why).trim()) return { ok: false, why: `a ${reset ? 'reset' : 're-split'} needs a reason`, rec: r };
  const when = str(at, 40) || new Date().toISOString();
  const line = (o = {}) => { r.statusLog = [...(Array.isArray(r.statusLog) ? r.statusLog : []), { status: r.status, at: when, by: r.statusBy, attempt: r.attempt, ...(why ? { why: str(why, 300) } : {}), ...o }].slice(-LOG_MAX); };
  if (resplit) {
    if (kind !== 'build' || to !== 'split' || !canResplit(r)) return { ok: false, why: 'a re-split is only for a build waiting at split with no step past pending', rec: r };
    r.statusAt = when; r.statusBy = str(by, 80) || 'pipeline'; r.attempt = Math.max(1, Number(r.attempt) || 1); line({ resplit: true });
    if (extra) Object.assign(r, extra);
    return { ok: true, why: '', rec: r };
  }
  const c = checkTransition(r, to, kind, { reset, max: Math.min(MAX_ATTEMPTS, Math.max(1, Number(max) || MAX_ATTEMPTS)) });
  if (!c.ok) return { ok: false, why: c.why, rec: r, ...(c.gaveUp ? { gaveUp: true } : {}) };
  if (c.same) { if (extra) Object.assign(r, extra); return { ok: true, why: '', rec: r, same: true }; }
  const attempt = Math.max(1, Number(r.attempt) || 1);
  if (c.archive) { const from = isStatus(r.status, kind) ? r.status : archivedFromOf(r); if (from) r.archivedFrom = from; else delete r.archivedFrom; r.attempt = attempt; } // failedFrom stays: it returns as it left
  else if (c.unarchive) { if (to === FAILED && c.back !== FAILED) r.failedFrom = c.back; else if (to !== FAILED) delete r.failedFrom; delete r.archivedFrom; r.attempt = attempt; }
  else if (to === FAILED) { r.failedFrom = r.status && isStatus(r.status, kind) ? r.status : (r.failedFrom || lastLogged(r, kind)); r.attempt = attempt; }
  else if (c.retry) { r.attempt = c.reset ? 1 : attempt + 1; }
  else if (!r.attempt) r.attempt = 1;
  if (to !== FAILED && !c.archive) delete r.failedFrom; // only meaningful while failed (the log keeps the history)
  r.status = to; r.statusAt = when; r.statusBy = str(by, 80) || 'pipeline';
  if (kind === 'build') r.flow = FLOW;
  line(c.reset ? { reset: true } : {});
  if (kind === 'step') r.done = to === 'completed' || to === 'in-pr';
  if (extra) Object.assign(r, extra);
  return { ok: true, why: '', rec: r };
}

/** One statusLog line, normalised. */
export function normLogLine(l) {
  if (!l || typeof l !== 'object') return null;
  const status = str(l.status, 40); if (!status) return null;
  return { status, at: str(l.at, 40), by: str(l.by, 80), attempt: Math.max(1, Number(l.attempt) || 1), ...(str(l.why) ? { why: str(l.why, 300) } : {}), ...(l.reset === true ? { reset: true } : {}), ...(l.resplit === true ? { resplit: true } : {}) };
}

/** The contract's fields of a record, normalised (kept only when set, so builds@1 records stay as they were). */
export function normFields(o, kind = 'build') {
  const x = o && typeof o === 'object' ? o : {};
  const out = {};
  if (kind === 'build' && (x.flow === FLOW || P2_ONLY.includes(x.status))) out.flow = FLOW;
  if (str(x.statusAt)) out.statusAt = str(x.statusAt, 40);
  if (str(x.statusBy)) out.statusBy = str(x.statusBy, 80);
  if (Number(x.attempt) >= 1) out.attempt = Math.floor(Number(x.attempt));
  if (str(x.failedFrom) && isStatus(x.failedFrom, kind)) out.failedFrom = x.failedFrom;
  if (kind === 'build' && x.status === EXIT && isStatus(x.archivedFrom, 'build')) out.archivedFrom = x.archivedFrom;
  const log = (Array.isArray(x.statusLog) ? x.statusLog : []).map(normLogLine).filter(Boolean).slice(-LOG_MAX);
  if (log.length) out.statusLog = log;
  if (kind === 'step') {
    if (isStatus(x.status, 'step')) out.status = x.status;
    for (const k of ['account', 'slot', 'worktree', 'branch', 'tmux']) if (str(x[k])) out[k] = str(x[k], 300);
    if (Number.isInteger(Number(x.prNumber)) && Number(x.prNumber) > 0) out.prNumber = Number(x.prNumber);
    // accounts this step already failed on (the watchdog's relaunch avoids them)
    const tried = [...new Set((Array.isArray(x.tried) ? x.tried : []).map((a) => str(a, 80)).filter(Boolean))].slice(-TRIED_MAX);
    if (tried.length) out.tried = tried;
  }
  return out;
}

/* ------------------------------------------------------------------ the lander's fields on a build (lander@1) */

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const nums = (v, max = 50) => (Array.isArray(v) ? v.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0).slice(0, max) : []);
const strs = (v, n = 120, max = 20) => (Array.isArray(v) ? v.map((x) => str(x, n)).filter(Boolean).slice(0, max) : []);
const headAt = (v) => { const x = obj(v); return x ? { head: str(x.head, 64), at: str(x.at, 40) } : null; };

/**
 * A Pipeline 2.0 build's landing record (deploy/lander): { attempt (failures of this landing run: the lander's own
 * count, never the build's `attempt`, which is the dispatcher's), split, merged[pr], closed[pr], reruns { head, n },
 * rules { head, ok, failing, fixed, skipped, at } (skipped: true or the reason; rules that could not run carry `error`,
 * `tail` and `tries`, a failing run its `detail`), ciKick { head, at }, fullKick { head, at }, mainPull { head, at } (main
 * moved after CI went green: the newest main was pulled into the PR again and CI runs on that head), green { head, at }
 * (the head CI and the rules passed on: the only head that merges), fixes { pr, n } (fix sessions the PR in flight has
 * had), lastMerge { pr, sha, head, at } (the last PR merged: the evidence `landed` carries; a PR merged by hand also
 * has `byHand`, `by` and what GitHub says about its CI, `ci`) }. A cleared part (null) is left out.
 * → the record, or null when there is nothing to keep.
 */
export function normLanding(l) {
  const x = obj(l); if (!x) return null;
  const out = {};
  const count = (v) => Math.max(0, Math.floor(Number(v) || 0));
  if (count(x.attempt)) out.attempt = count(x.attempt);
  if (x.split === true) out.split = true;
  for (const k of ['merged', 'closed']) { const v = nums(x[k]); if (v.length) out[k] = v; }
  const rr = obj(x.reruns); if (rr && str(rr.head)) out.reruns = { head: str(rr.head, 64), n: count(rr.n) };
  const ru = obj(x.rules);
  if (ru && str(ru.head)) {
    out.rules = {
      head: str(ru.head, 64), ok: ru.ok === true, failing: strs(ru.failing), fixed: strs(ru.fixed),
      ...(ru.skipped === true ? { skipped: true } : str(ru.skipped) ? { skipped: str(ru.skipped, 120) } : {}),
      ...(str(ru.error) ? { error: str(ru.error, 300), tail: str(ru.tail, 600), tries: count(ru.tries) || 1 } : {}),
      ...(str(ru.detail) ? { detail: str(ru.detail, LAND_LOG_MAX) } : {}),
      at: str(ru.at, 40),
    };
  }
  for (const k of ['ciKick', 'fullKick', 'mainPull', 'green']) { const v = headAt(x[k]); if (v?.head) out[k] = v; }
  const fx = obj(x.fixes); if (fx && nums([fx.pr]).length && count(fx.n)) out.fixes = { pr: nums([fx.pr])[0], n: count(fx.n) };
  const lm = obj(x.lastMerge);
  if (lm && str(lm.sha)) out.lastMerge = { pr: nums([lm.pr])[0] ?? 0, sha: str(lm.sha, 64), head: str(lm.head, 64), at: str(lm.at, 40), ...(lm.byHand === true ? { byHand: true, ci: LAND_CI.includes(lm.ci) ? lm.ci : 'unknown', by: str(lm.by, 80) } : {}) };
  // pipeline-status@1: the lander's display state and its merge line (the place in line and the build it waits for)
  if (['waiting-to-merge', 'merging', 'running-ci', 'landed'].includes(x.state)) out.state = x.state;
  const ml = obj(x.mergeLine);
  if (ml && (Number(ml.position) > 0 || ml.waitingFor)) out.mergeLine = { position: Math.max(0, Math.floor(Number(ml.position) || 0)), waitingFor: obj(ml.waitingFor) ? { buildId: str(ml.waitingFor.buildId ?? ml.waitingFor.id, 80), number: str(ml.waitingFor.number, 24), title: str(ml.waitingFor.title, 300) } : str(ml.waitingFor, 80), ...(str(ml.at) ? { at: str(ml.at, 40) } : {}) };
  return Object.keys(out).length ? out : null;
}
/** What GitHub says about CI on a PR merged by hand (the done-means-merged@1 `landed.ci` words). */
const LAND_CI = Object.freeze(['success', 'failure', 'running', 'none', 'unknown']);
/** Characters of a failing log the lander's records keep (the fix brief's tail). */
const LAND_LOG_MAX = 3000;

/**
 * The lander's failure record on a Pipeline 2.0 build: { kind, status (the phase it failed in), why, head, pr, at,
 * attempt (the landing run's), retry, notBefore, failing?, runIds?, jobIds?, log? (the failing log's tail), tiedStep?,
 * of? { kind, why, failing, jobIds, log } (the failure a fix session was working on),
 * fix? { at, head, session, n, model, queued } (a fix session that started), fixStart? { n, at, why } (one that did
 * not), and for a build that stopped at the ladder's top (retry `hold`): needsBrett, stopped (why), resume (the retry
 * a release starts with) }. builds@1 builds keep their done-means-merged failure record instead
 * (framework/core/build-pipeline.mjs normFailure). → the record or null.
 */
export function normLandFailure(f) {
  const x = obj(f); if (!x || !str(x.kind)) return null;
  const fix = obj(x.fix); const of = obj(x.of); const fs = obj(x.fixStart);
  const count = (v) => Math.max(0, Math.floor(Number(v) || 0));
  const part = (y) => ({ ...(strs(y.failing).length ? { failing: strs(y.failing, 120, 10) } : {}), ...(nums(y.jobIds, 10).length ? { jobIds: nums(y.jobIds, 10) } : {}), ...(str(y.log) ? { log: str(y.log, LAND_LOG_MAX) } : {}) });
  return {
    kind: str(x.kind, 40), status: isStatus(x.status, 'build') ? x.status : '', why: str(x.why, 600), head: str(x.head, 64),
    pr: Number.isInteger(Number(x.pr)) && Number(x.pr) > 0 ? Number(x.pr) : 0, at: str(x.at, 40), ...(count(x.attempt) ? { attempt: count(x.attempt) } : {}), retry: str(x.retry, 40), notBefore: str(x.notBefore, 40),
    ...(x.needsBrett === true ? { needsBrett: true, stopped: str(x.stopped, 200), resume: str(x.resume, 40) } : {}),
    ...part(x), ...(nums(x.runIds, 10).length ? { runIds: nums(x.runIds, 10) } : {}),
    ...(str(x.tiedStep) ? { tiedStep: str(x.tiedStep, 80) } : {}),
    ...(of && str(of.kind) ? { of: { kind: str(of.kind, 40), why: str(of.why, 600), ...part(of) } } : {}),
    ...(fs && count(fs.n) ? { fixStart: { n: count(fs.n), at: str(fs.at, 40), why: str(fs.why, 300) } } : {}),
    ...(fix ? { fix: { at: str(fix.at, 40), head: str(fix.head, 64), session: str(fix.session, 120), ...(count(fix.n) ? { n: count(fix.n) } : {}), ...(str(fix.model) ? { model: str(fix.model, 20) } : {}), ...(fix.queued === true ? { queued: true } : {}), exit: Number.isInteger(fix.exit) ? fix.exit : null, why: str(fix.why, 300) } } : {}),
  };
}

const sameStatus = (a, b) => (a?.status ?? '') === (b?.status ?? '');

/** Has the build reached status `s` (a failed build counts where it failed, an archived one where it was archived from)? */
function reached(b, s) {
  const st = b?.status === EXIT ? archivedFromOf(b) : str(b?.status, 40);
  return rank(st === FAILED ? str(b?.failedFrom, 40) : st) >= rank(s);
}
/** Split or later: the build's steps keep their identity (none removed, none replaced by another). */
export const stepsLocked = (b) => isP2(b) && reached(b, 'split');
/** Past `split` (active or later): no step is added either. A build still waiting at `split` may take a new one. */
export const stepsFrozen = (b) => isP2(b) && reached(b, 'pulling-main');
/** May the build be split again: waiting at `split`, no step past `pending`. */
export const canResplit = (b) => !!b && b.flow === FLOW && b.status === 'split' && (b.steps ?? []).every((s) => !s.status || s.status === 'pending');
/** The steps a build's "every step" tests count: skipped steps never block it. */
export const liveSteps = (b) => (Array.isArray(b?.steps) ? b.steps : []).filter((s) => s && !s.skip);
/** Is every counted step at one of `statuses` (and is there one)? */
export const everyStep = (b, ...statuses) => { const l = liveSteps(b); return l.length > 0 && l.every((s) => statuses.includes(s.status)); };
/** Why a build's steps may not be edited (add, remove, divide, harvest, restore), or '' when they may. */
export function stepsEditRefusal(b, { add = false } = {}) {
  if (add ? !stepsFrozen(b) : !stepsLocked(b)) return '';
  const label = labelOf(b.status, b.attempt);
  return add ? `${b.id} is past the split (${label}): no step is added to a build that is being built` : `${b.id} is split (${label}): its steps are fixed, none is removed or replaced`;
}

/** Did this write add a marked line (reset, resplit) with a reason to the record's log: the explicit actions the guard lets through. */
function marked(prev, cur, flag) {
  const l = lastOf(cur?.statusLog); const pl = lastOf(prev?.statusLog);
  return !!l && l[flag] === true && !!str(l.why).trim() && l.status === cur.status && !(pl && pl.at === l.at && pl.status === l.status && pl[flag] === true);
}

/**
 * The store's guard (builds-store withStore runs it on every write): for every Pipeline 2.0 build, and every step of
 * one, a change that breaks the contract is refused, and a legal status change a writer made by hand gets its at / by /
 * log line stamped. Pure. → { store, refused: [{ id, step?, from, to, why }] }
 *
 * Checked on each build: the status move (forward-only, the attempt ceiling unless the write is a marked reset, the
 * archive rule; an archived build never returns into the active place while another build holds it); its steps (once
 * split none is removed or swapped for another uid unless the write is a marked re-split, past `split` none is added);
 * every step's status move. A step that arrives with no status keeps the one it had, and a new one enters at `pending`.
 *
 * strict (the default): one refusal on a build throws away the whole of that write for that build (the record stays as
 * it was, plus one note saying what was refused), so a stale writer never lands its content while its status change is
 * dropped. `strict: false` keeps the old behaviour (only the status fields are put back).
 */
export function enforceFlow(before, after, { at, by = 'store', strict = true } = {}) {
  const old = new Map((before?.builds ?? []).map((b) => [b.id, b]));
  const when = str(at, 40) || new Date().toISOString();
  const refused = [];
  const keep = (prev, cur, kind) => { const out = { ...cur }; for (const k of ['status', 'statusAt', 'statusBy', 'attempt', 'failedFrom', 'statusLog', ...(kind === 'build' ? ['archivedFrom'] : ['done', 'doneAt'])]) { if (prev && k in prev) out[k] = prev[k]; else delete out[k]; } return out; };
  const stamp = (prev, cur, kind) => {
    const t = transition({ ...cur, status: prev?.status ?? '', attempt: prev?.attempt ?? cur.attempt, failedFrom: prev?.failedFrom ?? '', archivedFrom: prev?.archivedFrom, statusLog: prev?.statusLog ?? cur.statusLog }, cur.status, { at: when, by, kind });
    const out = { ...cur, ...t.rec, ...(kind === 'step' ? { done: cur.done === true || t.rec.done === true } : {}) };
    for (const k of ['failedFrom', 'archivedFrom']) if (!(k in t.rec)) delete out[k]; // cleared by the move: never left over from the writer's copy
    return out;
  };
  const holder = (id) => (after?.builds ?? []).find((x) => x.id !== id && holdsActive(x) && !besideLine(x)) ?? null;
  const builds = (after?.builds ?? []).map((b) => {
    const prev = old.get(b.id);
    if (!isP2(b) && !isP2(prev)) return b;
    const bad = [];
    let next = b;
    if (prev && !sameStatus(prev, b)) {
      let c = checkTransition(prev, b.status, 'build', { reset: marked(prev, b, 'reset') });
      if (c.ok && c.unarchive && holdsActive({ ...b, flow: FLOW }) && !besideLine(b) && holder(b.id)) c = { ok: false, why: `${holder(b.id).id} holds the active place: an archived build returns into it only when no other build is active` };
      if (!c.ok) { bad.push({ id: b.id, from: prev.status, to: b.status, why: c.why }); next = keep(prev, b, 'build'); }
      else if (b.statusAt === prev.statusAt || !b.statusAt) next = stamp(prev, b, 'build');
    } else if (!prev && b.status && !b.statusAt) next = stamp(null, b, 'build');
    if (isP2(next) && next.flow !== FLOW) next = { ...next, flow: FLOW };
    const prevSteps = prev?.steps ?? [];
    const byUid = new Map(prevSteps.filter((s) => s.uid).map((s) => [s.uid, s]));
    const byId = new Map(prevSteps.map((s) => [s.id, s]));
    const locked = !!prev && stepsLocked(prev) && !(canResplit(prev) && marked(prev, b, 'resplit'));
    const frozen = !!prev && stepsFrozen(prev);
    const over = [EXIT, BUILD_FLOW[BUILD_FLOW.length - 1]].includes(next.status);
    const seen = new Set();
    let stepsChanged = false;
    const steps = (next.steps ?? []).map((s) => {
      const ps = (s.uid && byUid.get(s.uid)) || (!seen.has(byId.get(s.id)) && byId.get(s.id)) || null;
      if (ps) seen.add(ps);
      if (locked && ps && ps.uid && s.uid && ps.uid !== s.uid) bad.push({ id: b.id, step: s.id, from: ps.status || '', to: s.status || '', why: `step ${s.id} was replaced by another (${stepsEditRefusal(prev)})` });
      if (!ps && frozen) bad.push({ id: b.id, step: s.id, from: '', to: s.status || '', why: `step ${s.id} was added: ${stepsEditRefusal(prev, { add: true })}` });
      if (!isP2(next)) return s;
      // the status is never optional: a step that arrives without one keeps the one it had, a new one enters at pending
      // (the old steps of a build that is already landed or archived are left as they are)
      if (!s.status) {
        if (ps?.status) { stepsChanged = true; return keep(ps, s, 'step'); }
        if (ps && over) return s;
        stepsChanged = true; return stamp(null, { ...s, status: flowOf('step')[0] }, 'step');
      }
      if (ps && !sameStatus(ps, s)) {
        const c = checkTransition(ps, s.status, 'step', { reset: marked(ps, s, 'reset') });
        if (!c.ok) { bad.push({ id: b.id, step: s.id, from: ps.status || '', to: s.status || '', why: c.why }); stepsChanged = true; return keep(ps, s, 'step'); }
        if (s.statusAt === ps.statusAt || !s.statusAt) { stepsChanged = true; return stamp(ps, s, 'step'); }
      } else if (!ps && s.status && !s.statusAt) { stepsChanged = true; return stamp(null, s, 'step'); }
      return s;
    });
    if (locked) for (const ps of prevSteps) if (!seen.has(ps)) bad.push({ id: b.id, step: ps.id, from: ps.status || '', to: '', why: `step ${ps.id} was removed: ${stepsEditRefusal(prev)}` });
    refused.push(...bad);
    if (bad.length && strict && prev) {
      // the whole write is thrown away for this build; one note says so (never the same note twice in a row)
      const text = `Store: refused a write by ${str(by, 80) || 'store'}, nothing of it was kept: ${str(bad.map((x) => `${x.step ? `${x.step} ` : ''}${x.why}`).join('; '), 600)}`;
      const notes = Array.isArray(prev.notes) ? prev.notes : [];
      return lastOf(notes)?.text === text ? prev : { ...prev, notes: [...notes, { text, at: when, by: 'store' }] };
    }
    return stepsChanged ? { ...next, steps } : next;
  });
  return { store: { ...after, builds }, refused };
}

/* ------------------------------------------------------------------ the flow's pure decisions */

/** Do two steps' file lists overlap (one path equal to, or inside, the other)? Steps with no files never clash. */
export function filesOverlap(a = [], b = []) {
  const norm = (p) => str(p, 300).replace(/\/+$/, '').replace(/\*.*$/, '').replace(/\/+$/, '');
  for (const x of a.map(norm).filter(Boolean)) for (const y of b.map(norm).filter(Boolean)) if (x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)) return true;
  return false;
}

/**
 * Split a build's steps into at most `slots` parts that never touch the same files (Brett: "as many as there are
 * slots, without the parts stepping on each other"). Steps are kept in order; each goes to the first part it does not
 * clash with, the least loaded first; a step that clashes with a part joins it (one session then does both).
 * A part never passes the step cap (`maxMinutes`, STEP_MAX_MINUTES): a step that would push every part it may join over
 * it gets a part of its own, so there can be more parts than slots (the dispatcher sends them out as slots free). A step
 * with no estimate counts as 0 minutes. Pure → [[step…]…], at least one part when there are steps.
 */
export function splitParts(steps = [], slots = 1, { maxMinutes = STEP_MAX_MINUTES } = {}) {
  const n = Math.max(1, Math.min(Number(slots) || 1, steps.length || 1));
  const cap = Number(maxMinutes) > 0 ? Number(maxMinutes) : Infinity;
  const minutes = (p) => p.reduce((m, x) => m + minutesHint(x), 0);
  const parts = [];
  for (const s of steps) {
    const files = Array.isArray(s.files) ? s.files : [];
    const fits = (c) => minutes(parts[c.i]) + minutesHint(s) <= cap;
    const clash = parts.map((p, i) => ({ i, hit: p.some((x) => filesOverlap(x.files, files)), load: p.length }));
    const hits = clash.filter((c) => c.hit);
    if (hits.length) { const h = hits.find(fits); if (h) parts[h.i].push(s); else parts.push([s]); continue; }
    if (parts.length < n) { parts.push([s]); continue; }
    const open = clash.filter(fits).sort((a, b) => a.load - b.load || a.i - b.i)[0];
    if (open) parts[open.i].push(s); else parts.push([s]);
  }
  return parts;
}

/**
 * Minutes a `building` step may run before the watchdog looks at its log: twice its estimate (the cap when it has
 * none). Past that with a silent log the step is hung.
 */
export const stepBudgetMinutes = (step) => 2 * (minutesHint(step) || STEP_MAX_MINUTES);

/**
 * Accounts by usage left, then spread: the account for the next step is the one with usage left that has the fewest
 * steps of this build on it, then the most usage left, then the fewest running sessions, then by name. Accounts
 * marked out (limited until a reset), unusable or full are never picked. Pure → the account row or null.
 *   accounts: [{ name, usable, limited, free, running, usageLeft (0..1, 1 when unknown), fable }]
 */
export function pickAccount(accounts = [], { model = 'Opus', onBuild = {}, exclude = [], now = Date.now() } = {}) {
  const out = (a) => a.limited && (!a.limited.until || Date.parse(a.limited.until) > now);
  const ok = accounts.filter((a) => a && a.usable !== false && !out(a) && (a.free ?? 1) > 0 && !(exclude || []).includes(a.name) && (model !== 'Fable' || a.fable !== false) && (a.usageLeft ?? 1) > 0);
  ok.sort((a, b) => (onBuild[a.name] ?? 0) - (onBuild[b.name] ?? 0) || (b.usageLeft ?? 1) - (a.usageLeft ?? 1) || (a.running?.length ?? a.running ?? 0) - (b.running?.length ?? b.running ?? 0) || a.name.localeCompare(b.name));
  return ok[0] ?? null;
}

/**
 * The account a step is pinned to, when the pin may be used: a step at `ready` carrying `account` (the watchdog's
 * relaunch picked it) is sent there as long as that account is not marked out and could take it now (the same test
 * as pickAccount). Pure → the account row, or null (then the normal pickAccount chooses; never an out account).
 */
export function pinnedAccount(accounts = [], step = {}, { model = step?.model || 'Opus', exclude = [], now = Date.now() } = {}) {
  const name = str(step?.account, 80);
  if (!name || step?.status !== 'ready') return null;
  return pickAccount((accounts || []).filter((a) => a && a.name === name), { model, exclude, now });
}

/**
 * The one build allowed to be active, or null; `others` = every other build that also holds the place (a breach).
 * Emergency builds and hand builds are left out: they run beside the active build and are never a breach
 * (emergencyBuilds and handBuilds list them).
 */
export function activeBuild(builds = []) {
  const act = builds.filter((b) => holdsActive(b) && !besideLine(b)).sort((a, b) => String(a.statusLog?.find((l) => ACTIVE.includes(l.status))?.at ?? a.statusAt).localeCompare(String(b.statusLog?.find((l) => ACTIVE.includes(l.status))?.at ?? b.statusAt)));
  return { active: act[0] ?? null, others: act.slice(1) };
}

/**
 * The emergency builds the dispatcher works on now, oldest tag first: split and waiting (activated at once, whatever
 * else is active; one that failed while it waited too, while it has attempts left), or already past the main pull.
 * Before `split` an emergency build is split like any other.
 */
export function emergencyBuilds(builds = []) {
  const waits = (b) => WAITING.includes(b.status) || (b.status === FAILED && WAITING.includes(b.failedFrom) && !gaveUp(b));
  return builds.filter((b) => isEmergency(b) && b.flow === FLOW && !b.deleted && !b.hidden && (waits(b) || holdsActive(b)))
    .sort((a, b) => str(a.emergency.at).localeCompare(str(b.emergency.at)) || str(a.id).localeCompare(str(b.id)));
}

/** The hand builds whose one session is out (sending or building): the dispatcher only watches for their session's end. */
export function handBuilds(builds = []) {
  return builds.filter((b) => isHand(b) && b.flow === FLOW && !b.deleted && ['sending', 'building'].includes(b.status));
}
/* ------------------------------------------------------------------ plan-build@1: what Plan Studio may send */

/*
 * Plan Studio's steps are planning only (Brett, Nov 19 2026). Send hands the orchestrator ONE build: the plan as a whole
 * (title, body, and its steps as planning context). The orchestrator's splitting stage designs the real build steps
 * (Fable: each estimated in minutes, each with its model); a plan never needs per-step minutes or models to be sent.
 */
export const PLAN_SCHEMA = 'plan-build@1';
export const PLAN_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/; // build-id@1
export const PLAN_MODELS = Object.freeze(['Fable', 'Opus']);
export const PLANNING_MAX = 100;
export const DESIGN_MAX_STEPS = 40;

const capModel = (m) => { const x = str(m, 20).toLowerCase(); return x === 'fable' ? 'Fable' : x === 'opus' ? 'Opus' : str(m, 20); };
const minutesHint = (s) => (Number.isFinite(Number(s?.minutes)) && Number(s?.minutes) > 0 ? Math.round(Number(s.minutes)) : (parseInt(str(s?.estimate), 10) || 0));
const pathList = (v) => (Array.isArray(v) ? v.map((f) => str(f, 300)).filter(Boolean) : []);

/** One planning step: its text, and the model / minutes Brett noted, when he did (hints for the split, never required). */
function planningStep(s) {
  const model = capModel(s?.model); const minutes = minutesHint(s); const files = pathList(s?.files);
  return { text: str(s?.text, 2000).trim(), ...(PLAN_MODELS.includes(model) ? { model } : {}), ...(minutes ? { minutes } : {}), ...(files.length ? { files } : {}) };
}

/** The plan manifest in its one shape (planning steps with their hints only), before validation. */
export function normPlan(p) {
  const o = p && typeof p === 'object' ? p : {};
  return {
    $axf: PLAN_SCHEMA, id: str(o.id, 80), title: str(o.title, 300).trim(), detail: str(o.detail, 8000), source: str(o.source, 40) || 'plan-studio-2',
    planItem: str(o.planItem, 80), ...(str(o.said) ? { said: str(o.said, 2000) } : {}),
    steps: (Array.isArray(o.steps) ? o.steps : []).map(planningStep),
  };
}

/** Every reason a plan may not be sent (empty = valid). Steps are planning context: no minutes or model needed. */
export function validatePlan(p) {
  const errs = []; const e = (path, why) => errs.push({ path, why });
  if (!p || typeof p !== 'object') return [{ path: '', why: 'not an object' }];
  if (p.$axf !== PLAN_SCHEMA) e('$axf', `must be ${PLAN_SCHEMA}`);
  if (!PLAN_ID_RE.test(p.id ?? '')) e('id', 'a build id: a-z, 0-9 and -, at most 40 characters (build-id@1)');
  if (!str(p.title).trim()) e('title', 'a plan needs a title');
  if (p.steps !== undefined && !Array.isArray(p.steps)) e('steps', 'a list of planning steps');
  const steps = Array.isArray(p.steps) ? p.steps : [];
  if (!steps.length && !str(p.detail).trim()) e('steps', 'nothing to build: add open steps or a body');
  if (steps.length > PLANNING_MAX) e('steps', `at most ${PLANNING_MAX} planning steps`);
  const seen = new Set();
  steps.forEach((s, i) => {
    const k = str(s?.text).trim().toLowerCase();
    if (!k) e(`steps[${i}].text`, 'a step needs text');
    else if (seen.has(k)) e(`steps[${i}].text`, 'the same step twice');
    seen.add(k);
    if (s?.files !== undefined && !Array.isArray(s.files)) e(`steps[${i}].files`, 'a list of paths');
  });
  return errs;
}

/** The planning context a Pipeline 2.0 build carries (the plan's steps as Plan Studio sent them; never build steps). */
export const normPlanning = (list) => (Array.isArray(list) ? list : []).slice(0, PLANNING_MAX).map(planningStep).filter((s) => s.text);

/**
 * The splitting stage's answer for a build sent without build steps (Fable's design) → { steps, errors }. Each step
 * needs text, minutes (1..STEP_MAX_MINUTES) and a model (Fable or Opus, never Sonnet or Haiku); `files` is optional.
 * Accepts `{ steps: [...] }` or the list itself. Any error = the design is not used.
 */
export function normDesign(answer) {
  const errs = []; const e = (path, why) => errs.push({ path, why });
  const list = Array.isArray(answer) ? answer : Array.isArray(answer?.steps) ? answer.steps : null;
  if (!list) return { steps: [], errors: [{ path: 'steps', why: 'no list of steps' }] };
  if (!list.length) e('steps', 'no steps');
  if (list.length > DESIGN_MAX_STEPS) e('steps', `at most ${DESIGN_MAX_STEPS} steps`);
  const steps = list.slice(0, DESIGN_MAX_STEPS).map((s, i) => {
    const text = str(s?.text, 4000).trim(); const model = capModel(s?.model); const minutes = Number(s?.minutes);
    if (!text) e(`steps[${i}].text`, 'a step needs text');
    if (!PLAN_MODELS.includes(model)) e(`steps[${i}].model`, `Fable or Opus, not ${s?.model || 'nothing'} (never Sonnet or Haiku)`);
    if (!(Number.isInteger(minutes) && minutes > 0)) e(`steps[${i}].minutes`, 'every build step needs an estimate in whole minutes');
    else if (minutes > STEP_MAX_MINUTES) e(`steps[${i}].minutes`, `a build step is ${STEP_MAX_MINUTES} minutes or less: ${minutes}`);
    if (s?.files !== undefined && !Array.isArray(s.files)) e(`steps[${i}].files`, 'a list of paths');
    return { text, model, minutes, files: pathList(s?.files) };
  });
  return { steps: errs.length ? [] : steps, errors: errs };
}

/**
 * The split without Fable (no credits, no answer, an answer that does not pass normDesign): one build step per planning
 * step, its noted minutes (capped) or the cap; a plan with no planning steps is one step. No model is chosen here: the
 * VPS triage gate (model-triage@1) assigns it. A model noted on the planning step in Plan Studio is carried as `pin`,
 * the explicit override the gate keeps; `model` is only the placeholder a step row needs until the gate has answered.
 */
export function fallbackDesign(b = {}) {
  const planning = normPlanning(b.planning);
  const rows = planning.length ? planning : [{ text: [str(b.title, 300).trim(), str(b.detail, 3000).trim()].filter(Boolean).join('\n\n') || 'The build' }];
  return rows.map((s) => ({ text: s.text, model: PLAN_MODELS.includes(s.model) ? s.model : PLAN_MODELS[PLAN_MODELS.length - 1], ...(PLAN_MODELS.includes(s.model) ? { pin: s.model } : {}), minutes: Math.min(STEP_MAX_MINUTES, s.minutes || STEP_MAX_MINUTES), files: s.files ?? [] }));
}

/* ------------------------------------------------------------------ pipeline-status@1: what a build is doing, in words */

/*
 * One view of a build for every screen (Brett, Nov 23 2026: "different badges for all the different steps, like waiting
 * for the VPS to do this, waiting for it to do that, merging, waiting to merge"). The builds store works it out on
 * every read (framework/cli/builds-store.mjs attaches `pipelineView`) and never stores it, so the orchestrator, Pending,
 * Plan Studio 2.0 and the console server all say the same thing from the one record.
 * JSON Schema: framework/schemas/pipeline-status.json. Golden cases: framework/spec/fixtures/pipeline-status.json.
 */
export const STATUS_SCHEMA = 'pipeline-status@1';
/** The lander's states: a built build waits its turn, is merged, has CI run, lands. */
export const LANDER_STATES = Object.freeze(['waiting-to-merge', 'merging', 'running-ci', 'landed']);
/** Every state a build shows a badge for, in order: the build's own, `failed`, then the lander's. */
export const PIPELINE_STATES = Object.freeze(['pending', 'splitting', 'split', 'pulling-main', 'assigning-models', 'ready', 'sending', 'building', 'build-complete', FAILED, ...LANDER_STATES]);
export const PIPELINE_TONES = Object.freeze(['muted', 'info', 'accent', 'warning', 'success', 'danger']);
/** Per state: label, tone, icon name and the plain status line (a template: {n} steps, {done} built, {attempt}, {max}, {from}). */
export const PIPELINE_STATE_INFO = Object.freeze({
  pending: { label: 'Pending', tone: 'muted', icon: 'clock', line: 'Waiting for the VPS to split it into steps.' },
  splitting: { label: 'Splitting', tone: 'accent', icon: 'layers', line: 'The VPS is splitting it into steps with Fable.' },
  split: { label: 'Split', tone: 'muted', icon: 'list', line: 'Split into {n}. Next in line for the active place.' },
  'pulling-main': { label: 'Pulling main', tone: 'info', icon: 'download', line: 'The VPS is cutting a worktree for each step and pulling main into it.' },
  'assigning-models': { label: 'Assigning models', tone: 'info', icon: 'user', line: 'The VPS triage gate is giving each step its model.' },
  ready: { label: 'Ready', tone: 'info', icon: 'check', line: 'Ready. Waiting for the VPS to send its steps to free slots.' },
  sending: { label: 'Sending', tone: 'accent', icon: 'play', line: 'The VPS is sending its steps to their slots.' },
  building: { label: 'Building', tone: 'accent', icon: 'zap', line: 'Building: {done} of {n} built.' },
  'build-complete': { label: 'Build complete', tone: 'success', icon: 'check', line: 'Every step is built. The lander takes it next.' },
  failed: { label: 'Failed (attempt {attempt})', tone: 'danger', icon: 'alert', line: 'Failed at {from}, attempt {attempt} of {max}. The VPS tries again by itself.' },
  'waiting-to-merge': { label: 'Waiting to merge', tone: 'warning', icon: 'clock', line: 'Built and waiting its turn to merge.' },
  merging: { label: 'Merging', tone: 'warning', icon: 'branch', line: 'The lander is merging it.' },
  'running-ci': { label: 'Running CI', tone: 'warning', icon: 'refresh', line: 'CI is running on its PR.' },
  landed: { label: 'Landed', tone: 'success', icon: 'check', line: 'Merged into main.' },
});
/** A stored status that has no badge of its own → the state it shows as, with its own line. */
const SHOWN_AS = Object.freeze({
  'merging-pr': { state: 'merging', line: 'The lander is putting its steps into one PR.' },
  'pr-pulling-main': { state: 'merging', line: 'The lander is pulling main into its PR.' },
  'merging-main': { state: 'merging', line: 'The lander is merging its PR into main.' },
});
const ordinal = (n) => { const t = n % 100; const u = n % 10; return `${n}${t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th'}`; };
const refOf = (b) => ({ buildId: str(b?.id, 80), number: str(b?.number, 24), title: str(b?.title, 300) });
const nameOf = (r) => r.number || r.title || r.buildId;
const stepsWord = (n) => `${n} step${n === 1 ? '' : 's'}`;
const fill = (t, v) => str(t, 400).replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));
const isoOf = (b, ...statuses) => str((Array.isArray(b?.statusLog) ? b.statusLog : []).filter((l) => statuses.includes(l?.status)).pop()?.at || b?.statusAt || b?.updatedAt, 40);

/** Split provenance as stored on the build (`split`): { by, model, at, stepCount }, or null before the split. */
export function normSplit(s, steps = []) {
  const x = obj(s); if (!x || !str(x.by)) return null;
  const n = Number(x.stepCount);
  return { by: str(x.by, 40), model: str(x.model, 80), at: str(x.at, 40), stepCount: Number.isInteger(n) && n > 0 ? n : (Array.isArray(steps) ? steps.length : 0) };
}

/**
 * What every view of one read shares: the build holding the one active place and the merge line (the builds in a
 * landing run first, then the built ones in the order the lander takes them: emergency builds, then the oldest
 * build-complete). Work it out once per read and hand it to pipelineView instead of the list.
 */
export function pipelineContext(allBuilds = []) {
  const all = (Array.isArray(allBuilds) ? allBuilds : []).filter((b) => b && b.flow === FLOW && !b.deleted && b.status !== EXIT);
  const holder = activeBuild(all).active;
  const landing = (b) => LANDING_GROUP.includes(b.status) || (b.status === FAILED && LANDING_GROUP.includes(b.failedFrom));
  const inRun = all.filter(landing).sort((a, b) => isoOf(a, 'merging-pr').localeCompare(isoOf(b, 'merging-pr')) || str(a.id).localeCompare(str(b.id)));
  const built = all.filter((b) => b.status === 'build-complete').sort((a, b) => Number(isEmergency(b)) - Number(isEmergency(a)) || isoOf(a, 'build-complete').localeCompare(isoOf(b, 'build-complete')) || str(a.id).localeCompare(str(b.id)));
  return { $ctx: STATUS_SCHEMA, holder, line: [...inRun, ...built] };
}

/** The merge line of one build: its place and the build right ahead of it; the lander's own record on the build wins. */
function mergeLineOf(b, ctx) {
  const stored = obj(b?.mergeLine) ?? obj(obj(b?.landing)?.mergeLine);
  const i = ctx.line.findIndex((x) => x.id === b?.id);
  if (!stored && i < 0) return null;
  const ahead = i > 0 ? ctx.line[i - 1] : null;
  const sw = stored ? (obj(stored.waitingFor) ?? (str(stored.waitingFor) ? (ctx.line.find((x) => x.id === stored.waitingFor || (x.number && x.number === stored.waitingFor)) ?? { id: str(stored.waitingFor, 80) }) : null)) : null;
  const position = Number.isInteger(Number(stored?.position)) && Number(stored.position) > 0 ? Number(stored.position) : i + 1;
  const waitingFor = sw ? { buildId: str(sw.buildId ?? sw.id, 80), number: str(sw.number, 24), title: str(sw.title, 300) } : ahead ? refOf(ahead) : null;
  if (!position && !waitingFor) return null;
  const text = [position ? `${ordinal(position)} to merge` : '', waitingFor ? `waiting for ${nameOf(waitingFor)} to merge` : ''].filter(Boolean).join(', ');
  return { position, waitingFor, text: text.charAt(0).toUpperCase() + text.slice(1) };
}

/**
 * pipeline-status@1: the view of one build → { state, label, tone, icon, line, attempt, waitingOn: { buildId, number,
 * title, reason } | null, mergeLine: { position, waitingFor: { buildId, number, title } | null, text } | null,
 * split: { by, model, at, stepCount } | null, clash?: { reason, options } }.
 *   state       one of PIPELINE_STATES; a status outside them (a builds@1 status, archived, anything unknown) is shown
 *               as itself: the raw status as state and label, tone muted. Never throws.
 *   waitingOn   set while the build sits at split (or ready) because another build holds the one active place.
 *   mergeLine   set from build-complete to the merge: the place in the lander's line and the build it waits for.
 * `all` is every build of the same read, or a pipelineContext() of them.
 */
export function pipelineView(build, all = []) {
  const b = obj(build) ?? {};
  try {
    const ctx = all && all.$ctx === STATUS_SCHEMA ? all : pipelineContext(all);
    const raw = str(b.status, 40);
    const attempt = Math.max(1, Math.floor(Number(b.attempt) || 1));
    const steps = liveSteps(b);
    const split = normSplit(b.split, b.steps);
    const mergeLine = b.flow === FLOW || isP2(b) ? mergeLineOf(b, ctx) : null;
    let state = raw; let line = '';
    const lander = str(obj(b.landing)?.state || b.landingState || b.landerState || b.mergeState, 40); // wherever the lander wrote its state
    if (SHOWN_AS[raw]) { state = SHOWN_AS[raw].state; line = SHOWN_AS[raw].line; }
    if (LANDER_STATES.includes(lander) && (raw === 'build-complete' || LANDING_GROUP.includes(raw))) { if (lander !== state) line = ''; state = lander; }
    else if (raw === 'build-complete' && mergeLine && mergeLine.position > 1) state = 'waiting-to-merge';
    const info = PIPELINE_STATE_INFO[state];
    if (!info || !(isP2(b) || state === 'landed')) {
      // outside the contract: the raw status, as it is
      const label = raw ? (BUILD_LABELS[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1).replace(/-/g, ' ')) : 'Unknown';
      return { state: raw, label, tone: 'muted', icon: 'circle', line: '', attempt, waitingOn: null, mergeLine: null, split };
    }
    const from = str(b.failedFrom, 40);
    const vars = { n: stepsWord(steps.length), done: steps.filter((s) => s.status === 'completed' || s.status === 'in-pr').length, attempt, max: MAX_ATTEMPTS, from: (PIPELINE_STATE_INFO[SHOWN_AS[from]?.state ?? from]?.label ?? from) || 'an unknown status' };
    let label = fill(info.label, vars); let tone = info.tone; let icon = info.icon;
    line = line || fill(info.line, vars);
    let waitingOn = null;
    if (state === FAILED && gaveUp(b)) line = `Failed at ${vars.from}, attempt ${attempt} of ${MAX_ATTEMPTS}. It gave up: retry it to start again.`;
    if (state === 'building' && isHand(b)) line = 'A session started by hand is building it.';
    if (['waiting-to-merge', 'merging', 'running-ci', 'build-complete'].includes(state) && mergeLine?.waitingFor) line = `${mergeLine.text}.`;
    const clash = obj(b.clash);
    const waits = state === 'split' || (state === FAILED && WAITING.includes(from));
    if (waits && clash && clash.rejected !== false && !clash.answer) {
      label = 'Rejected (clash)'; tone = 'danger'; icon = 'alert';
      line = `${str(clash.reason, 500)} Choose: run all now, or run the clean steps and defer the rest.`;
    } else if (waits && str(obj(b.pipeline)?.heldAt)) line = 'On hold: release it to give it its turn.';
    else if ((state === 'split' || state === 'ready') && !besideLine(b) && ctx.holder && ctx.holder.id !== b.id) {
      const r = refOf(ctx.holder);
      waitingOn = { ...r, reason: `Waiting: ${r.title || r.buildId} holds the active place` };
      line = `${waitingOn.reason} (${labelOf(ctx.holder.status, ctx.holder.attempt)}).`;
    }
    const deferred = steps.filter((s) => obj(s.waitsFor) && s.status === 'pending');
    if (deferred.length && ['pulling-main', 'assigning-models', 'ready', 'sending', 'building'].includes(state)) line = `${line} ${stepsWord(deferred.length)} deferred, waiting for ${[...new Set(deferred.map((s) => nameOf({ buildId: str(s.waitsFor.buildId, 80), number: str(s.waitsFor.number, 24), title: str(s.waitsFor.title, 300) })))].join(', ')} to land.`;
    return { state, label, tone, icon, line, attempt, waitingOn, mergeLine, split, ...(clash && str(clash.reason) ? { clash: { rejected: clash.rejected !== false && !clash.answer, reason: str(clash.reason, 600), answer: str(clash.answer, 20) } } : {}) };
  } catch {
    const raw = str(b.status, 40);
    return { state: raw, label: raw || 'Unknown', tone: 'muted', icon: 'circle', line: '', attempt: 1, waitingOn: null, mergeLine: null, split: null };
  }
}

/** The view fields a read exposes per step: its unique id, who split it, its model and who chose it, its status. */
export const stepView = (s) => ({ id: str(s?.id, 40), uid: str(s?.uid, 60), splitBy: str(s?.splitBy, 40), model: str(s?.model, 20), modelBy: str(s?.modelBy, 40), status: str(s?.status, 40) || (s?.done ? 'completed' : 'pending') });

/* ------------------------------------------------------------------ build numbers */

/** A build's short unique number: `B-0123`, given once by the builds store and never changed or used again. */
export const NUMBER_RE = /^B-(\d{4,})$/;
export const numberText = (n) => `B-${String(Math.max(1, Math.floor(Number(n) || 1))).padStart(4, '0')}`;
export const numberValue = (text) => { const m = NUMBER_RE.exec(str(text, 24)); return m ? Number(m[1]) : 0; };
/**
 * Give every build in `ids` (or every build, when `ids` is null) that has no number its own, oldest first, counting on
 * from `seq` (the store's high-water mark) or the highest number in use. A number held by two builds (two writers at
 * the same moment) stays with the older one; the other gets a new one. Changes the builds in place.
 * → { seq, given: [{ id, number }] }
 */
export function assignNumbers(builds = [], { seq = 0, ids = null } = {}) {
  const all = (Array.isArray(builds) ? builds : []).filter((b) => b && typeof b === 'object');
  let top = Math.max(Math.floor(Number(seq) || 0), ...all.map((b) => numberValue(b.number)), 0);
  const age = (a, b) => str(a.createdAt, 40).localeCompare(str(b.createdAt, 40)) || str(a.id).localeCompare(str(b.id));
  const holders = new Map();
  for (const b of [...all].sort(age)) { const v = numberValue(b.number); if (!v) continue; if (holders.has(v)) b.number = ''; else holders.set(v, b); }
  const given = [];
  for (const b of all.filter((x) => !numberValue(x.number) && (x.number === '' || !ids || ids.has(x.id))).sort(age)) { top += 1; b.number = numberText(top); given.push({ id: b.id, number: b.number }); }
  return { seq: top, given };
}

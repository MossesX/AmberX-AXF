/**
 * The lander's CI decision for the PR head in flight (running-ci), as one pure function: what the checks on the head
 * say, whether a CI run has to be started, and whether the wait is over. run.mjs reads GitHub and acts on the answer
 * (dispatch, wait, fail, go on to the build rules); nothing here touches the network, git or the store, so recorded
 * heads can be replayed through it (test-ci-stall.mjs, fixtures/ci-stall: PRs 915, 916 and 917).
 *
 * The rules:
 *   The verdict comes from the checks on the pinned head, and from nothing else. GitHub's `mergeable_state` (clean,
 *     unstable, blocked …) is never read: `unstable` only says that some check on the head is not green, which the
 *     check runs say themselves, by name. A head whose checks are all green merges whatever that summary says.
 *   The required names have one source: `requiredChecks` in the lander's config. They are matched against what the
 *     jobs report: the newest GitHub Actions check run per name on the head (a re-run, or a dispatched run on the same
 *     sha, replaces the older one), and a commit status whose context is a required name. A required job the CI scope
 *     skipped has reported; neutral, cancelled, timed out and the like are red.
 *   Nothing is loosened to get a merge: every Actions job on the head has to be green, required or not (a red job that
 *     is not required is named apart in the failure). Checks of other apps (a review bot) are not CI. Light PR checks
 *     alone are not CI either: the full run is started and only it counts.
 *   A required name no job of the workflow can report is a named failure at once, never a wait.
 *   A dispatch is done for a head only once a run for that sha shows up. One that produced no run (or that GitHub
 *     refused) is sent again every rekickMinutes(), until the CI timeout: a bounded number of times.
 *   No wait is endless: light-only, not started, running and missing all end in `ci-timeout` after ciTimeoutMin,
 *     counted from the run on the current head (or the status change, when no run has started), and that goes down the
 *     existing path: failed, attempt N, the retry starts CI again, and the ladder's top stops the build for Brett.
 *
 * Where the watchdog takes over (watchdog-catches-lander-prs-stuck-ci, not built here): everything above needs the
 * lander's tick to run and the store to take its writes. A PR that sits in running-ci (or failed, with a retry long
 * due) past the timeouts because the tick died, the store refused, or GitHub cannot be read is the watchdog's to
 * catch; so is a build this ladder stopped for Brett that nobody picked up.
 */
import * as L from './lander-core.mjs';

const actions = (r) => (r?.app?.slug || 'github-actions') === 'github-actions';
const ms = (iso) => Date.parse(iso) || 0;

/** Minutes between two dispatches on one head when the first produced no run. */
export const rekickMinutes = (cfg) => Math.max(15, 2 * L.normConfig(cfg).ciNoneKickMin);

/**
 * The names a workflow's jobs report as (each job's `name:`), from the workflow file's text. null when they cannot be
 * told (no file, no named job, or a name built from an expression): then nothing is concluded from them.
 */
export function checkNames(workflowText) {
  const names = [];
  for (const line of String(workflowText || '').split('\n')) {
    const m = line.match(/^ {2,4}name:\s*(.+?)\s*$/);
    if (!m) continue;
    const name = m[1].replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2');
    if (name.includes('${{')) return null;
    names.push(name);
  }
  return names.length ? names : null;
}

/**
 * Commit statuses as check runs, for the required names only (a status of any other context is some other service's
 * and is not CI): the newest per context; success is green, pending is running, failure and error are red.
 */
export function statusRuns(statuses, required = []) {
  const by = new Map();
  for (const s of Array.isArray(statuses) ? statuses : []) {
    const name = String(s?.context || ''); if (!required.includes(name)) continue;
    const cur = by.get(name); const t = ms(s.updated_at || s.created_at);
    if (!cur || t >= ms(cur.updated_at || cur.created_at)) by.set(name, s);
  }
  return [...by.values()].map((s) => ({
    id: 0, name: String(s.context), app: { slug: 'github-actions' }, fromStatus: true,
    status: s.state === 'pending' ? 'in_progress' : 'completed', conclusion: s.state === 'success' ? 'success' : s.state === 'pending' ? null : 'failure',
    started_at: String(s.updated_at || s.created_at || ''), details_url: '',
  }));
}

/**
 * → { state, since, ci, kick, fail, waiting }
 *   state    light-only | none | running | failure | missing | success
 *   since    where the CI clocks start
 *   ci       L.ciOf() on the head (null when only light PR checks ran)
 *   kick     null, or { marker: 'fullKick' | 'ciKick', why, said, again } when a CI run has to be started on the head
 *   fail     null, or { kind, ctx } for the failure ladder (L.failure)
 *   waiting  what the tick says while it waits ('' on success or failure)
 * `runs` are the check runs on the head (all pages), `statuses` its commit statuses, `reportable` the names the
 * workflow's jobs report as on this head (checkNames; null = not known), `baseRuns` the check runs on main's head
 * (null = not read), `landing` the build's landing record, `statusAt` when it entered its status, `at` now.
 */
export function ciDecision({ runs = [], statuses = [], reportable = null, baseRuns = null, baseSha = '', head = '', landing = {}, statusAt = '', at, cfg }) {
  const land = landing || {};
  const required = cfg.requiredChecks || [];
  const short = String(head).slice(0, 9);
  // a required name reported as a commit status counts like a check run (a check run of that name wins)
  const own = (runs || []).filter(actions);
  const all = [...(runs || []), ...statusRuns(statuses, required).filter((s) => !own.some((r) => r?.name === s.name))];
  // the full run's jobs on this head: not the light PR jobs, not a job the CI scope skipped
  const fullRuns = all.filter((r) => actions(r) && !L.isLightCheck(r) && r?.conclusion !== 'skipped' && r?.started_at);
  // … and when that run started: its first job, the scope job of the same workflow run included
  const fullIds = new Set(fullRuns.map((r) => L.runIdOf(r)).filter(Boolean));
  const runStart = [...fullRuns, ...all.filter((r) => actions(r) && r?.started_at && fullIds.has(L.runIdOf(r)))].map((r) => String(r.started_at)).sort((a, b) => ms(a) - ms(b))[0] || '';
  // the CI clocks start with the run on the current head; before one has started, at the status change or at the last
  // pull of main into the PR (a new head: CI starts over). A dispatch does not move the clock: sending one again
  // never buys more time
  const since = [statusAt, land.mainPull?.at, runStart].filter(Boolean).sort((a, b) => ms(a) - ms(b)).pop() || at;
  const timedOut = L.ciTimedOut(since, at, cfg);
  const again = rekickMinutes(cfg);
  /** Start a CI run: the first time when `firstDue`; again when the last start produced no run on this head in time. */
  const kick = (marker, why, firstDue = true) => {
    const k = land[marker];
    if (k?.head !== head) return firstDue ? { marker, why, again: false, said: `${why} on ${short}: started ${marker === 'fullKick' ? 'the full CI run' : 'it'}` } : null;
    if (fullRuns.some((r) => ms(r.started_at) > ms(k.at))) return null; // a run for this sha showed up: the dispatch is done
    if (L.minutesBetween(k.at, at) < again) return null;
    return { marker, why, again: true, said: `${why} on ${short}, and no run ${Math.round(L.minutesBetween(k.at, at))} min after the last start: started it again` };
  };
  const timeout = (why, more = {}) => (timedOut ? { kind: 'ci-timeout', ctx: { why, ...more } } : null);

  // a required name that is not a job of the workflow on this head: no run can ever report it, so it is said now
  const never = reportable?.length ? required.filter((n) => !reportable.includes(n) && !all.some((r) => actions(r) && r?.name === n)) : [];
  if (never.length) {
    const why = `required check${never.length > 1 ? 's' : ''} ${never.map((n) => `"${n}"`).join(', ')} ${never.length > 1 ? 'are' : 'is'} not a job of ${cfg.workflow} on ${short}, so no CI run can report ${never.length > 1 ? 'them' : 'it'}: put the job's own name in the lander's requiredChecks (or give the job that name). Nothing merges without ${never.length > 1 ? 'them' : 'it'}`;
    return { state: 'missing', since, ci: L.lightOnly(all) ? null : L.ciOf(all, { required }), kick: null, fail: { kind: 'infra', ctx: { why, failing: never } }, waiting: '' };
  }

  // light PR checks only (ci-scope: a PR while the old merge queue's repo variable is on): the one CI run must be the
  // full one, so it is dispatched (workflow_dispatch is always full) and only the full run counts
  if (L.lightOnly(all)) {
    return { state: 'light-only', since, ci: null, kick: kick('fullKick', 'only light PR checks'), fail: timeout(`no full CI run after ${cfg.ciTimeoutMin} min`), waiting: 'waiting for the full CI run' };
  }
  const ci = L.ciOf(all, { required });
  if (ci.ci === 'none') {
    return { state: 'none', since, ci, kick: kick('ciKick', 'no CI', L.ciKickDue(since, at, cfg)), fail: timeout(`CI never started on ${short} in ${cfg.ciTimeoutMin} min`), waiting: 'CI has not started on the head' };
  }
  if (ci.ci === 'running') {
    return { state: 'running', since, ci, kick: null, fail: timeout(`CI still running after ${cfg.ciTimeoutMin} min`), waiting: 'CI is running' };
  }
  if (ci.ci === 'failure') {
    // required and not required told apart (both block: nothing is loosened), and a red the PR took over from main
    const isReq = (f) => required.some((n) => f === n || f.startsWith(`${n} (`));
    const failingRequired = ci.failing.filter(isReq);
    const other = required.length ? ci.failing.filter((f) => !isReq(f)) : [];
    const red = L.redChecks(all); const baseRed = baseRuns ? L.redChecks(baseRuns) : [];
    const onBase = red.filter((n) => baseRed.includes(n));
    const lead = required.length ? failingRequired : ci.failing;
    const why = `CI is red on ${short} (${lead.slice(0, 3).join(', ') || (other.length ? 'no required check' : 'checks failed')})`
      + (other.length ? ` · not required: ${other.slice(0, 3).join(', ')}` : '')
      + (onBase.length ? ` · also red on main${baseSha ? ` (${String(baseSha).slice(0, 9)})` : ''}: ${onBase.slice(0, 3).join(', ')}` : '');
    return { state: 'failure', since, ci, kick: null, fail: { kind: 'ci-red', ctx: { why, failing: ci.failing, failingRequired, runIds: ci.runIds, jobIds: ci.jobIds, ...(onBase.length ? { redOnBase: onBase } : {}) } }, waiting: '' };
  }
  // nothing red, nothing running, but a required check has not reported on this head: not green yet
  if (ci.ci === 'missing') {
    const k = kick('fullKick', `required checks have not reported (${ci.missing.slice(0, 3).join(', ')})`, L.ciKickDue(since, at, cfg));
    return { state: 'missing', since, ci, kick: k, fail: timeout(`required checks never reported in ${cfg.ciTimeoutMin} min: ${ci.missing.join(', ')}`, { failing: ci.missing }), waiting: `waiting for required checks: ${ci.missing.join(', ')}` };
  }
  return { state: 'success', since, ci, kick: null, fail: null, waiting: '' };
}

/** The per-head parts of a landing record, cleared when the PR head changes or the PR in flight is done. */
export const NEW_HEAD = Object.freeze({ reruns: null, rules: null, ciKick: null, fullKick: null, green: null });

/**
 * The landing-record change when the PR in flight has merged (by the lander or by hand): the PR joins `merged`, the
 * merge evidence is kept, and everything that belonged to that PR is cleared, its failure count with it. The attempt
 * count is per PR: a build that lands as many PRs gives each of them its own attempts, so the failures of the parts
 * before never stop a later part on its first red CI (PRs 916 and 917, Nov 24 2026: "attempt 5 of 5" and "attempt 7
 * of 5" on a PR's first CI run, no re-run and no fix session, two hours each until they were merged by hand).
 */
export function prMerged(b, lastMerge) {
  return { merged: [...new Set([...L.landingOf(b).merged, lastMerge.pr])], lastMerge, ...NEW_HEAD, mainPull: null, fixes: null, attempt: 0 };
}

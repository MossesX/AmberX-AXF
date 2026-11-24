/**
 * Lander core (lander@1, Pipeline 2.0 part 2; Brett, Nov 18-19 2026). Pure: no IO, no git, no model calls. The runner
 * (run.mjs) reads the builds store, asks this file what to do, does it and writes every status back to the store.
 *
 * A build reaches the lander at `build-complete`. The lander then:
 *   merging-pr       merges ALL its steps' branches into one PR (each step goes `in-pr` with its prNumber)
 *   pr-pulling-main  pulls main into that PR (data conflicts resolve by land-rules.mjs; only code conflicts fail)
 *   running-ci       CI once on the PR head, then the gate's build rules (phase gate) on the same head
 *   merging-main     merges the PR into main (sha pinned)
 *   landed           every step's PR is merged
 *
 * Size cap: when the combined diff is over `sizeCapLines`, the steps are grouped in order into as few PRs as the cap
 * allows (never one PR per step unless the steps are that big). The PRs land one at a time, in order: each group runs
 * merging-pr → … → merging-main before the next group starts. The build status always shows the phase of the group in
 * flight; per group it only moves forward.
 *
 * The merge line (Brett, Nov 20 2026): an emergency build (`emergency` on the build) goes to the front, ahead of a
 * build already landing. Every build in the line carries its place in the builds store (`mergeLine: { position,
 * waitingFor }`, Nov 24 2026), so every screen can say "2nd to merge, waiting for build 41".
 *
 * The merge rule (Brett, Nov 24 2026): a green PR is ALWAYS merged as it is first. Main having moved is no reason to
 * pull it in or to run CI again: only a merge that GitHub actually refuses (a conflict, a head that changed) makes the
 * lander pull main into the PR and run CI again, by itself. A build that already has its own open PR (a hand build's
 * session opened it) lands on that PR: no second PR, no second CI run.
 *
 * Merge together (Brett, Nov 24 2026): on request, every build waiting at `build-complete` is combined into one branch
 * and one PR, CI runs once and they merge in one go. A build that clashes in code with the ones before it is left out
 * and lands by itself, one at a time, after them.
 *
 * Failures: the build goes `failed` with a `failure` record and the landing run's own attempt count
 * (`landing.attempt`, never the dispatcher's `attempt`), and the next tick retries forward by itself after a backoff:
 *   clash-steps  two steps of the group conflict in code          → split: the group's steps land one PR each
 *   clash-main   main conflicts with the PR in code               → a Fable fix session on the PR branch, then CI again
 *   ci-red       CI red on the head                               → re-run the failed jobs once per head (flaky);
 *                                                                   still red: a Fable fix session on the PR as it is;
 *                                                                   fixes used up: split, only when the failure names
 *                                                                   one step's files
 *   rules        build rules (phase gate) fail after their fixers → a fix session, then CI again
 *   fix-timeout  a fix session pushed nothing in time             → the next fix session (the failing log attached)
 *   fix-start    a fix session did not start, several ticks running → the next try after the backoff
 *   merge        GitHub refused the merge (not mergeable)         → pull main into the PR at once, then CI again
 *   infra        push / API / git error, build rules that could not run → the same phase again
 *   pr-closed    the PR was closed without merging                → stop until it is reopened or re-sent
 *   hand-merge   the PR was merged by hand and CI is not green on it → stop until CI is green or Brett decides
 * The ladder has a top: after `maxFixes` fix sessions on one PR, or `maxAttempts` failures in one landing run, the
 * build stops (`failure.retry: 'hold'`, `failure.needsBrett`) with the exact failing check, is posted once, shows on the
 * systems check, and moves to the back of the merge line. `lander retry <build>` (or the reopened PR) starts it again.
 */

export const SCHEMA = 'lander@1';

/** The shared contract (Pipeline 2.0): build statuses, forward-only; `failed` carries attempt N. */
export const BUILD_FLOW = Object.freeze(['pending', 'splitting', 'split', 'pulling-main', 'assigning-models', 'ready', 'sending', 'building', 'build-complete', 'merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main', 'landed']);
export const STEP_FLOW = Object.freeze(['pending', 'pulling-main', 'ready', 'sending', 'building', 'completed', 'in-pr']);
/** The statuses the lander owns. */
export const LANDING = Object.freeze(BUILD_FLOW.slice(BUILD_FLOW.indexOf('build-complete')));
/** The statuses a group passes through, in order. */
export const GROUP_FLOW = Object.freeze(['merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main']);
export const FAILURE_KINDS = Object.freeze(['clash-steps', 'clash-main', 'ci-red', 'ci-timeout', 'rules', 'merge', 'fix-timeout', 'fix-start', 'pr-closed', 'hand-merge', 'infra']);

export const DEFAULTS = Object.freeze({
  enabled: true,
  /** Lines changed (insertions + deletions, tracking files left out) one PR may carry before the steps are grouped. */
  sizeCapLines: 4000,
  /** Re-runs of the failed CI jobs per head before a red CI counts as real. */
  flakyReruns: 1,
  /** Minutes to wait before retry N: min(backoffMaxMin, backoffBaseMin × backoffFactor^(N−1)). */
  backoffBaseMin: 2, backoffFactor: 2, backoffMaxMin: 30,
  /** No CI on the head for this long: start it (workflow_dispatch) once per head. */
  ciNoneKickMin: 10,
  /** CI still running after this long: counts as a failure (ci-timeout → re-run). */
  ciTimeoutMin: 120,
  /** A fix session that pushed nothing within this long is a failed attempt (a new one starts). */
  fixTimeoutMin: 60,
  /** From this attempt on, every new attempt is posted to the crew chat and the console alerts. */
  notifyAfterAttempts: 3,
  /**
   * Failures one landing run may have before it stops and waits for Brett (the ladder's top). Never above the status
   * contract's own ceiling (pipeline-status.mjs MAX_ATTEMPTS, 5): past that the store lets nothing out of `failed`
   * without a reset.
   */
  maxAttempts: 5,
  /** Fix sessions one PR may get: the first on the failing checks, the next with the failing log attached. */
  maxFixes: 2,
  /** Ticks in a row a fix session may fail to start before that counts as a failed attempt. */
  fixStartTries: 5,
  /**
   * Checks that must have reported on the head before CI counts as green (each success, or skipped by the CI scope).
   * Without them "every check present is done" is green while a second workflow has not posted yet.
   */
  requiredChecks: [],
  /** After `landed`: remove the build's merged step branches (local and remote) and their worktrees. */
  cleanup: true,
  workflow: 'android.yml',
  mergeMethod: 'merge',
});
const RANGES = { sizeCapLines: [50, 1e7], flakyReruns: [0, 5], backoffBaseMin: [0, 600], backoffFactor: [1, 10], backoffMaxMin: [0, 1440], ciNoneKickMin: [0, 600], ciTimeoutMin: [5, 1440], fixTimeoutMin: [5, 1440], notifyAfterAttempts: [1, 100], maxAttempts: [1, 5], maxFixes: [0, 10], fixStartTries: [1, 100] };

const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : v == null ? '' : String(v).slice(0, n));
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const minutesBetween = (from, to) => (Date.parse(to) - Date.parse(from)) / 60000;
const plusMin = (iso, m) => new Date(Date.parse(iso) + m * 60000).toISOString();

/** A list of names from an array, a JSON array or a `|`-separated line (check names hold commas). */
function names(v) {
  let list = v;
  if (typeof v === 'string') { const t = v.trim(); try { list = t.startsWith('[') ? JSON.parse(t) : t.split('|'); } catch { list = []; } }
  return (Array.isArray(list) ? list : []).map((x) => str(x, 200).trim()).filter(Boolean).slice(0, 50);
}

/** The lander's settings: DEFAULTS with a config file / env on top, numbers clamped. */
export function normConfig(c = {}) {
  const out = { ...DEFAULTS };
  for (const [k, v] of Object.entries(obj(c))) {
    if (!(k in DEFAULTS)) continue;
    if (typeof DEFAULTS[k] === 'boolean') out[k] = v === true || v === 'true' || v === 'on' || v === '1';
    else if (Array.isArray(DEFAULTS[k])) out[k] = names(v);
    else if (typeof DEFAULTS[k] === 'number') { const [lo, hi] = RANGES[k] || [0, Infinity]; const n = num(v, DEFAULTS[k]); out[k] = Math.min(hi, Math.max(lo, n)); }
    else out[k] = str(v, 120) || DEFAULTS[k];
  }
  return out;
}

// ------------------------------------------------------------------ statuses

export const buildIndex = (s) => BUILD_FLOW.indexOf(s);
export const stepIndex = (s) => STEP_FLOW.indexOf(s);

/**
 * May a build go from `from` to `to`? Forward along BUILD_FLOW, or to `failed`. From `failed` a retry continues at any
 * landing phase (the attempt counter, not the status, records that it is a retry). Inside landing a later group starts
 * its own run at merging-pr (`group` true): the build status shows the group in flight.
 */
export function canMove(from, to, { group = false } = {}) {
  if (to === 'failed') return from !== 'landed';
  if (from === 'failed') return LANDING.includes(to) && to !== 'build-complete';
  const a = buildIndex(from); const b = buildIndex(to);
  if (a < 0 || b < 0) return false;
  if (b >= a) return true;
  return group && to === 'merging-pr' && LANDING.includes(from);
}

/** May a step go from `from` to `to`? Forward only; `in-pr` → `in-pr` (a new prNumber after a split) is allowed. */
export function canMoveStep(from, to) {
  if (to === 'failed') return from !== 'in-pr';
  if (from === 'failed') return to === 'completed' || to === 'in-pr';
  const a = stepIndex(from); const b = stepIndex(to);
  return a >= 0 && b >= 0 && b >= a;
}

/** The status a failure happened in (failure.status), or the build's own status. */
export const failedIn = (b) => (b?.status === 'failed' ? str(b.failure?.status, 40) : str(b?.status, 40));

/** Is the build the lander's (at build-complete, in a landing phase, or failed in one)? */
export function isLanding(b) {
  if (!b || b.deleted || b.hidden || b.archived) return false;
  const s = failedIn(b);
  return LANDING.includes(s) && s !== 'landed';
}

/** Sent to emergency by Brett (pipeline-2@1 `emergency: { at, by }`): front of the merge line. */
export const isEmergency = (b) => !!b && !!b.emergency && typeof b.emergency === 'object' && !!str(b.emergency.at);

/** Stopped at the ladder's top (or on a closed PR): no retry until it is released (`lander retry`, the PR reopened). */
export const isHeld = (b) => b?.status === 'failed' && b.failure?.retry === 'hold';

/**
 * The one build the lander works on. Emergency builds go first (oldest tag first), ahead of a build already landing:
 * that one waits where it is and, once the emergency build is on main, pulls main and runs CI again before its own
 * merge. Then the build already in a landing phase, else the oldest at build-complete. A build that stopped for Brett
 * goes to the back: it never holds the line. Returns { build, others } (others = the rest of the line, in order: the
 * runner reports them and never works on two at once).
 */
export function pickBuild(builds) {
  const all = lineOf(builds);
  return { build: all[0] || null, others: all.slice(1).map((b) => b.id) };
}

/** The whole merge line, in the order the lander works it: emergency builds, the ones already landing, the oldest finished, then the stopped ones. */
export function lineOf(builds) {
  const landing = (Array.isArray(builds) ? builds : []).filter(isLanding);
  const list = landing.filter((b) => !isHeld(b));
  const held = landing.filter(isHeld);
  const age = (b) => str(b.completedAt || b.builtAt || b.updatedAt || b.createdAt) || '9';
  const line = (xs) => [
    ...xs.filter((b) => failedIn(b) !== 'build-complete').sort((x, y) => age(x).localeCompare(age(y))),
    ...xs.filter((b) => failedIn(b) === 'build-complete').sort((x, y) => age(x).localeCompare(age(y))),
  ];
  const urgent = list.filter(isEmergency).sort((x, y) => str(x.emergency.at).localeCompare(str(y.emergency.at)) || age(x).localeCompare(age(y)));
  return [...urgent, ...line(list.filter((b) => !isEmergency(b))), ...held.sort((x, y) => age(x).localeCompare(age(y)))];
}

// ------------------------------------------------------------------ the merge line in the store, the landing state

/** The landing states every screen shows (pipeline-status@1's lander states), and the build statuses behind them. */
export const LANDING_STATES = Object.freeze(['waiting-to-merge', 'merging', 'running-ci', 'landed', 'failed']);
/**
 * A build's landing state in the contract's words: waiting-to-merge (finished, not picked up yet), merging (its PR is
 * being put together, main pulled in, or merged), running-ci, landed, failed (with the landing run's attempt N).
 * '' when the build is not the lander's.
 */
export function landingState(b) {
  const s = str(b?.status, 40);
  if (s === 'landed') return 'landed';
  if (s === 'failed') return LANDING.includes(failedIn(b)) ? 'failed' : '';
  if (s === 'build-complete') return 'waiting-to-merge';
  if (s === 'running-ci') return 'running-ci';
  return GROUP_FLOW.includes(s) ? 'merging' : '';
}

/** The PR a build has in flight, 0 when none. */
export const prInFlight = (b) => groupState(b).inFlight?.pr || 0;

/**
 * The merge line as the store carries it: build id → { position, waitingFor } (position 1 = merging now, or next;
 * waitingFor = the build right ahead: { buildId, id, number, title }, null at the front). Builds that share one PR
 * (merge together) share one place. A build that stopped for Brett has no place: it is not going to merge until he
 * acts. `number` is the build's short number when the store gives it one (pipeline-status@1), else ''.
 */
export function mergeLine(builds) {
  const out = new Map(); const byPr = new Map();
  let position = 0; let ahead = null;
  for (const b of lineOf(builds)) {
    if (isHeld(b)) continue;
    const pr = prInFlight(b);
    const shared = pr && togetherWith(builds, b).length ? pr : 0; // one PR for several builds: one place in the line
    let place = shared ? byPr.get(shared) : null;
    if (!place) { position += 1; place = { position, waitingFor: ahead ? { ...ahead } : null }; if (shared) byPr.set(shared, place); }
    out.set(b.id, { position: place.position, waitingFor: place.waitingFor ? { ...place.waitingFor } : null });
    ahead = { buildId: b.id, id: b.id, number: b.number == null ? '' : str(b.number, 24), title: str(b.title || b.id, 200) };
  }
  return out;
}
/**
 * The merge line a build record carries: on the build (`mergeLine`) or in its landing record (`landing.mergeLine`,
 * where pipeline-status@1 keeps it); the lander writes both and reads whichever the store kept.
 */
export const storedLine = (b) => obj(b?.mergeLine)?.position ? b.mergeLine : obj(obj(b?.landing).mergeLine)?.position ? b.landing.mergeLine : null;
/** The build a merge-line entry waits for, as an id ('' at the front), whatever shape the store kept it in. */
export const waitsFor = (m) => { const w = m?.waitingFor; return typeof w === 'string' ? w : str(w?.buildId ?? w?.id, 120); };
/** The other builds whose PR in flight is this build's (merge together). */
export function togetherWith(builds, b) {
  const pr = prInFlight(b); if (!pr) return [];
  return (Array.isArray(builds) ? builds : []).filter((x) => x && x.id !== b.id && isLanding(x) && prInFlight(x) === pr);
}
/** Are two merge-line entries the same (nothing to write)? */
export const sameLine = (a, b) => num(a?.position) === num(b?.position) && waitsFor(a) === waitsFor(b);
/** "1st", "2nd", "3rd", "4th" … */
export function ordinal(n) {
  const k = Math.max(0, Math.floor(num(n))); const t = k % 100;
  return `${k}${t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][k % 10] || 'th'}`;
}
/** Plain words for a build's place: "2nd to merge, waiting for build 41". */
export function lineText(m) {
  if (!m || !num(m.position)) return '';
  const w = m.waitingFor; const name = w ? (typeof w === 'object' && w.number != null && w.number !== '' ? `build ${w.number}` : waitsFor(m)) : '';
  return `${ordinal(m.position)} to merge${name ? `, waiting for ${name}` : ''}`;
}

/** The step branch a build's own PR would be on: the one branch all its steps share, '' when they have several. */
export function ownBranch(b, steps = landSteps(b)) {
  const set = [...new Set(steps.map((s) => stepBranch(b, s)).filter(Boolean))];
  return set.length === 1 ? set[0] : '';
}
/** Is `branch` one the lander made itself (lander/…)? Anything else in a PR is the build's own branch. */
export const isLanderBranch = (branch) => /^lander\//.test(str(branch, 300));
/** The one PR branch of a merge-together batch (named after the build at its front). */
export const togetherBranch = (leadId) => `lander/together-${leadId}`;

// ------------------------------------------------------------------ steps, branches, groups

/** A step's branch: its own (Pipeline 2.0 steps build in their own worktree), else the build's. */
export const stepBranch = (b, s) => str(s?.branch, 200) || str(b?.branch, 200);

/** The steps the lander lands: every step that isn't skipped. */
export const landSteps = (b) => (Array.isArray(b?.steps) ? b.steps : []).filter((s) => s && !s.skip && !s.removed);

/**
 * The build's landing record (contract addition, flagged for review): { split, merged: [pr], closed: [pr], attempt }.
 * `attempt` counts the failures of this landing run only; the dispatcher's `attempt` on the build is never read here.
 */
export function landingOf(b) {
  const l = obj(b?.landing);
  const nums = (v) => (Array.isArray(v) ? v.map((x) => num(x)).filter((x) => x > 0) : []);
  return { split: l.split === true, merged: nums(l.merged), closed: nums(l.closed), attempt: Math.max(0, Math.floor(num(l.attempt))) };
}
/** Failures so far in this landing run. */
export const landingAttempt = (b) => landingOf(b).attempt;
/** Fix sessions started on PR `pr` so far (`landing.fixes: { pr, n }`). */
export const fixesOf = (b, pr) => { const f = obj(obj(b?.landing).fixes); return num(pr) && num(f.pr) === num(pr) ? Math.max(0, Math.floor(num(f.n))) : 0; };

/**
 * The evidence the builds store's done-means-merged@1 guard asks of `landed` (framework/core/build-pipeline.mjs
 * guardStatus): the PR, mergedAt, the merge commit (landed.sha) and CI green (landed.ci). The lander merges only a PR
 * whose head passed CI and the gate's rules, pinned to that head, so CI green on the merged head is what it records.
 * A PR merged by hand carries what GitHub says about its CI (`lastMerge.ci`), never an assumed green.
 * → { mergedAt, landed } for the `landed` write ({} when no merge is recorded: the guard then refuses, never silently).
 */
export function landedEvidence(b, at = new Date().toISOString()) {
  const m = obj(obj(b?.landing).lastMerge);
  const pr = num(m?.pr) || landingOf(b).merged.slice(-1)[0] || num(String(b?.pr || '').replace(/^#/, ''));
  if (!pr || !str(m.sha)) return {};
  const when = str(m.at, 40) || at;
  return { mergedAt: when, landed: { pr, sha: str(m.sha, 64), mergedAt: when, ci: m.byHand ? str(m.ci, 20) || 'unknown' : 'success', ciAt: when } };
}

/**
 * Where the build's PRs stand, from the steps (no state of the lander's own):
 *   merged   steps whose PR merged          inFlight  { pr, steps } the open group (in-pr, PR not merged / closed)
 *   waiting  steps not in a PR yet (completed, or in a closed PR after a split)
 */
export function groupState(b) {
  const l = landingOf(b); const merged = new Set(l.merged); const closed = new Set(l.closed);
  const out = { merged: [], inFlight: null, waiting: [] };
  for (const s of landSteps(b)) {
    const pr = num(s.prNumber);
    if (s.status === 'in-pr' && pr && merged.has(pr)) out.merged.push(s);
    else if (s.status === 'in-pr' && pr && !closed.has(pr)) { if (!out.inFlight) out.inFlight = { pr, steps: [] }; if (out.inFlight.pr === pr) out.inFlight.steps.push(s); else out.waiting.push(s); }
    else out.waiting.push(s);
  }
  return out;
}

/**
 * Group steps in order under the size cap: each group as big as fits; a step bigger than the cap alone. `sizes` maps
 * step id → lines changed. `split` (after a combined PR failed): one step per group. Steps that share a branch always
 * stay together (one branch can't be in two PRs). → [[step, …], …]
 */
export function groupSteps(steps, sizes = {}, cap = DEFAULTS.sizeCapLines, { split = false, branchOf = (s) => s.branch || '' } = {}) {
  // steps sharing a branch are one unit
  const units = [];
  for (const s of steps || []) {
    const br = branchOf(s); const u = br && units.find((x) => x.branch === br);
    if (u) u.steps.push(s); else units.push({ branch: br, steps: [s], size: 0 });
  }
  for (const u of units) u.size = u.branch ? Math.max(...u.steps.map((s) => num(sizes[s.id]))) : u.steps.reduce((t, s) => t + num(sizes[s.id]), 0);
  if (split) return units.map((u) => u.steps);
  const groups = []; let cur = null;
  for (const u of units) {
    if (cur && cur.size + u.size <= cap) { cur.steps.push(...u.steps); cur.size += u.size; continue; }
    cur = { steps: [...u.steps], size: u.size }; groups.push(cur);
  }
  return groups.map((g) => g.steps);
}

/** Total lines of a diff --numstat text, tracking files (and binary "-" lines) left out. */
export function numstatLines(text, isTracking = () => false) {
  let n = 0;
  for (const line of String(text || '').split('\n')) {
    const [a, d, ...p] = line.split('\t'); const path = p.join('\t');
    if (!path || isTracking(path)) continue;
    n += num(a) + num(d);
  }
  return n;
}

/** The PR branch of one group: lander/<build> for the first, lander/<build>-<k> after it. */
export const groupBranch = (buildId, k = 1) => `lander/${buildId}${k > 1 ? `-${k}` : ''}`;

// ------------------------------------------------------------------ CI

const actions = (r) => (r?.app?.slug || 'github-actions') === 'github-actions';
/** The newest check run per name (a re-run or a second workflow run on the head replaces the older one). */
function newest(runs) {
  const by = new Map();
  const key = (r) => [str(r?.started_at, 40), num(r?.id)];
  for (const r of runs || []) {
    const n = str(r?.name, 200); const cur = by.get(n);
    if (!cur) { by.set(n, r); continue; }
    const [a, ai] = key(cur); const [b, bi] = key(r);
    if (b > a || (b === a && bi >= ai)) by.set(n, r);
  }
  return [...by.values()];
}

/**
 * CI on a commit, from every GitHub Actions check run on it (all pages), the newest per name.
 * → { ci: success | failure | running | missing | none, failing: [name], runIds, jobIds, missing: [name] }
 *   success   every check that ran ended `success`, and every `required` check has reported (success, or skipped by
 *             the CI scope). Anything else a check can end as (failure, neutral, cancelled, timed out, stale, action
 *             required, no conclusion) is not green.
 *   missing   nothing is red or running, but a required check has not reported on this head yet
 *   none      no check ran (a skipped check is not CI)
 */
export function ciOf(runs, { required = [] } = {}) {
  const ours = newest((runs || []).filter(actions));
  const ran = ours.filter((r) => r?.conclusion !== 'skipped');
  const missing = (required || []).filter((n) => !ours.some((r) => r?.name === n));
  if (!ran.length) return { ci: 'none', failing: [], runIds: [], jobIds: [], missing };
  if (ran.some((r) => r.status !== 'completed')) return { ci: 'running', failing: [], runIds: [], jobIds: [], missing };
  const bad = ran.filter((r) => r.conclusion !== 'success');
  if (bad.length) {
    const runIds = [...new Set(bad.map((r) => runIdOf(r)).filter(Boolean))];
    return { ci: 'failure', failing: bad.map((r) => `${str(r.name, 100)}${r.conclusion && r.conclusion !== 'failure' ? ` (${str(r.conclusion, 20)})` : ''}`), runIds, jobIds: bad.map((r) => num(r.id)).filter(Boolean), missing };
  }
  return { ci: missing.length ? 'missing' : 'success', failing: [], runIds: [], jobIds: [], missing };
}
/** The jobs of a light PR run (ci-scope.mjs `light`, android.yml `scope` + "Light PR checks …"). */
const LIGHT = /^(Light PR checks|scope)\b/i;
/**
 * Only light PR checks ran on the head (a pull_request run while the repo variable AXF_MERGE_QUEUE is on): no full CI
 * yet. True when a light job is there and no other GitHub Actions job is.
 */
export function lightOnly(runs) {
  const ours = (runs || []).filter((r) => (r?.app?.slug || 'github-actions') === 'github-actions' && r?.conclusion !== 'skipped');
  return ours.some((r) => /^Light PR checks/i.test(String(r.name || ''))) && ours.every((r) => LIGHT.test(String(r.name || '')));
}

/** The Actions run id of a check run (from its details URL …/actions/runs/<id>/job/<job>). */
export function runIdOf(checkRun) {
  const m = String(checkRun?.details_url || checkRun?.html_url || '').match(/\/actions\/runs\/(\d+)/);
  return m ? Number(m[1]) : 0;
}

// ------------------------------------------------------------------ failures and retries

/** Minutes to wait before attempt n (n ≥ 1). */
export function backoffMinutes(n, cfg = DEFAULTS) {
  const c = normConfig(cfg); const k = Math.max(1, Math.floor(num(n, 1)));
  return Math.min(c.backoffMaxMin, c.backoffBaseMin * c.backoffFactor ** (k - 1));
}

/**
 * The failure record and the retry it calls for. `ctx` = { status (the phase it failed in), groupSize, reruns (on this
 * head), fixes (fix sessions this PR has had), tiedStep (the one step a red CI names, when it names one), head, pr,
 * why, at, failing, runIds, jobIds, log, of (the failure a fix session was working on) }.
 * → { attempt, failure: { kind, status, why, head, pr, at, retry, notBefore, … } }
 * retry: rerun | split | fix | pull-main | same | hold. `hold` is the ladder's top: no retry, `needsBrett`, `stopped`
 * says why and `resume` keeps the retry a release starts with.
 */
export function failure(b, kind, ctx = {}, cfg = DEFAULTS) {
  const c = normConfig(cfg);
  const k = FAILURE_KINDS.includes(kind) ? kind : 'infra';
  const attempt = landingAttempt(b) + 1;
  const at = ctx.at || new Date().toISOString();
  const group = Math.max(1, Math.floor(num(ctx.groupSize, 1)));
  const fixes = Math.max(0, Math.floor(num(ctx.fixes)));
  const fixesUsed = `${fixes} fix session${fixes === 1 ? '' : 's'} did not get it through`;
  let retry = 'same'; let stopped = ''; let resume = '';
  if (k === 'clash-steps') retry = 'split';
  else if (k === 'clash-main' || k === 'rules' || k === 'fix-timeout' || k === 'fix-start') { if (fixes < c.maxFixes) retry = 'fix'; else { stopped = fixesUsed; resume = 'fix'; } }
  else if (k === 'ci-red') {
    if (num(ctx.reruns) < c.flakyReruns) retry = 'rerun';
    else if (fixes < c.maxFixes) retry = 'fix';
    else if (group > 1 && str(ctx.tiedStep)) retry = 'split';
    else { stopped = fixesUsed; resume = 'fix'; }
  } else if (k === 'ci-timeout') retry = 'rerun';
  else if (k === 'merge') retry = 'pull-main';
  else if (k === 'pr-closed') { stopped = 'the PR was closed without merging'; resume = 'same'; }
  else if (k === 'hand-merge') { stopped = 'merged by hand without green CI'; resume = 'same'; }
  if (!stopped && attempt >= c.maxAttempts) { stopped = `attempt ${attempt} of ${c.maxAttempts}`; resume = retry; }
  if (stopped) retry = 'hold';
  // a flaky re-run goes at once; everything else waits its backoff (the first retry included); a stopped build has no next try,
  // and so does the main pull after the first refused merge (the merge rule: try it, and only then pull main)
  const wait = (retry === 'rerun' || retry === 'pull-main') && attempt === 1 ? 0 : backoffMinutes(attempt, c);
  const list = (v, f, n = 10) => (Array.isArray(v) && v.length ? v.slice(0, n).map(f).filter(Boolean) : null);
  const failing = list(ctx.failing, (x) => str(x, 120)); const runIds = list(ctx.runIds, (x) => num(x)); const jobIds = list(ctx.jobIds, (x) => num(x));
  const of = obj(ctx.of);
  return {
    attempt,
    failure: {
      kind: k, status: str(ctx.status, 40) || failedIn(b), why: str(ctx.why, 600), head: str(ctx.head, 64), pr: num(ctx.pr) || 0, at, attempt, retry,
      notBefore: retry === 'hold' ? '' : plusMin(at, wait),
      ...(retry === 'hold' ? { needsBrett: true, stopped, resume } : {}),
      ...(failing ? { failing } : {}), ...(runIds ? { runIds } : {}), ...(jobIds ? { jobIds } : {}),
      ...(str(ctx.log) ? { log: str(ctx.log, LOG_TAIL) } : {}),
      ...(str(ctx.tiedStep) ? { tiedStep: str(ctx.tiedStep, 80) } : {}),
      ...(of.kind ? { of: { kind: str(of.kind, 40), why: str(of.why, 600), ...(Array.isArray(of.failing) ? { failing: of.failing.slice(0, 10) } : {}), ...(Array.isArray(of.jobIds) ? { jobIds: of.jobIds.slice(0, 10) } : {}), ...(str(of.log) ? { log: str(of.log, LOG_TAIL) } : {}) } } : {}),
    },
  };
}
/** Characters of a failing log a failure record keeps (the fix brief's tail; the store is not a log archive). */
export const LOG_TAIL = 3000;

/**
 * Release a stopped build (`lander retry <build>`: Brett re-sends it). → the store change: a new landing run on the
 * same PR (the attempt and fix counts start again), at the phase the stopped rung belongs to: CI and the rules are
 * read again there, and what is still wrong climbs the ladder from its first rung. A PR that was closed is given up
 * (a new PR is opened). null when the build is not stopped.
 */
export function releaseHold(b, { at = new Date().toISOString(), by = '' } = {}) {
  if (!isHeld(b)) return null;
  const f = b.failure; const who = by ? ` by ${str(by, 60)}` : '';
  const fresh = { attempt: 0, fixes: null, reruns: null, rules: null, ciKick: null, fullKick: null, green: null };
  if (f.kind === 'pr-closed' && num(f.pr)) {
    return { ...RESET, status: 'merging-pr', failure: null, landing: { ...fresh, mainPull: null, closed: [...new Set([...landingOf(b).closed, num(f.pr)])] }, note: `Lander: re-sent${who}; PR #${num(f.pr)} stays closed, a new PR is opened` };
  }
  const to = retryStatus({ retry: FAILURE_RETRIES.includes(f.resume) ? f.resume : 'same', status: f.status });
  return { ...RESET, status: to, failure: null, landing: fresh, note: `Lander: re-sent${who} after it stopped (${str(f.stopped, 200)}); a new landing run starts at ${to}` };
}
/**
 * A stopped build that goes on is a reset in the status contract's words: the store lets a build out of `failed` at
 * its attempt ceiling only through a write marked `reset` with a reason (the change's note), and the count starts again.
 */
export const RESET = Object.freeze({ reset: true, attempt: 1 });
const FAILURE_RETRIES = Object.freeze(['rerun', 'split', 'fix', 'pull-main', 'same']);

/**
 * A person vouches for a PR merged by hand whose CI the lander cannot find green (`lander accept <build> --by … --why …`):
 * the one verdict the lander takes from a person, noted on the build with who and why. → the store change, or
 * { error } when the build is not stopped on a hand merge or the vouching is not signed.
 */
export function acceptHandMerge(b, { by = '', why = '' } = {}) {
  const m = obj(obj(b?.landing).lastMerge);
  if (!(isHeld(b) && b.failure?.kind === 'hand-merge' && m.byHand === true)) return { error: `${b?.id || 'the build'} is not stopped on a hand merge: nothing to accept` };
  if (!str(by).trim() || !str(why).trim()) return { error: 'accept needs --by <who> and --why "<what was checked>"' };
  return { ...RESET, status: 'merging-pr', failure: null, landing: { lastMerge: { ...m, ci: 'success' } }, note: `Lander: PR #${num(m.pr)} (merged by hand, ${str(m.sha, 9)}) accepted as green by ${str(by, 60)}: ${str(why, 400)}` };
}

/**
 * The one step a red CI can be tied to: the step whose own files (changed by no other step of the group) the failing
 * log names, when exactly one step is named. `filesByStep` = { stepId: [path] }. '' when the log names none, or more
 * than one step: the PR then stays whole.
 */
export function tiedStep(log, filesByStep = {}) {
  const text = String(log || ''); if (!text) return '';
  const owners = new Map();
  for (const [id, files] of Object.entries(obj(filesByStep))) for (const f of files || []) owners.set(f, owners.has(f) ? '' : id);
  const hit = new Set();
  for (const [f, id] of owners) if (id && f.includes('/') && text.includes(f)) hit.add(id);
  return hit.size === 1 ? [...hit][0] : '';
}

/** The phase a retry continues in (forward from `failed`). */
export function retryStatus(f) {
  const r = f?.retry;
  if (r === 'rerun' || r === 'fix') return 'running-ci';
  if (r === 'split') return 'merging-pr';
  if (r === 'pull-main') return 'pr-pulling-main';
  return LANDING.includes(f?.status) && f.status !== 'landed' ? (f.status === 'build-complete' ? 'merging-pr' : f.status) : 'merging-pr';
}

/** Is a failed build's retry due at `at`? Never for a stopped build. */
export const retryDue = (b, at = new Date().toISOString()) => b?.status === 'failed' && !isHeld(b) && (!b.failure?.notBefore || Date.parse(at) >= Date.parse(b.failure.notBefore));

/** Should this attempt be posted (never silent once retries pile up)? */
export const shouldNotify = (attempt, cfg = DEFAULTS) => attempt >= normConfig(cfg).notifyAfterAttempts;

/** Has a fix session had its time without pushing? */
export const fixTimedOut = (fix, at, cfg = DEFAULTS) => !!fix?.at && minutesBetween(fix.at, at) >= normConfig(cfg).fixTimeoutMin;

/** Should CI be started on a head that has none (once per head, after ciNoneKickMin in running-ci)? */
export const ciKickDue = (since, at, cfg = DEFAULTS) => !since || minutesBetween(since, at) >= normConfig(cfg).ciNoneKickMin;
/** Has CI on the head run past its timeout? */
export const ciTimedOut = (since, at, cfg = DEFAULTS) => !!since && minutesBetween(since, at) >= normConfig(cfg).ciTimeoutMin;

/** Plain words for one tick's outcome (logs, the crew chat). */
export function say(b, text) { return `${b?.id || 'lander'}: ${str(text, 500)}`; }

/**
 * The attempt a queue row shows. A build in a landing phase: the landing run's own count; a record the lander wrote
 * before it had one (a failure with no `attempt` of its own) still shows the number it was given then. A build that
 * is not landing yet (building): the dispatcher's count.
 */
export function rowAttempt(b) {
  if (!LANDING.includes(failedIn(b))) return Math.max(0, Math.floor(num(b?.attempt)));
  const own = landingAttempt(b) || Math.max(0, Math.floor(num(b?.failure?.attempt)));
  return own || (b?.status === 'failed' && b.failure && !('attempt' in b.failure) ? Math.max(0, Math.floor(num(b.attempt))) : 0);
}

/**
 * The merge queue view (read-only, merge-queue@2): every build waiting to land, from the same store rows, live status,
 * no state of its own. `attempt` is the landing run's own count. → [{ build, title, status, attempt, needsBrett, failure,
 * prs: [{ pr, steps, state }], waiting, at }]
 */
export function queueRows(builds) {
  const rows = [];
  for (const b of Array.isArray(builds) ? builds : []) {
    if (!b || b.deleted || b.hidden) continue;
    const s = failedIn(b);
    const idx = buildIndex(s);
    if (idx < buildIndex('building') || s === 'landed') continue;
    const g = groupState(b); const l = landingOf(b);
    const prs = new Map();
    for (const st of landSteps(b)) {
      const n = num(st.prNumber); if (!n) continue;
      if (!prs.has(n)) prs.set(n, { pr: n, steps: [], state: l.merged.includes(n) ? 'merged' : l.closed.includes(n) ? 'closed' : 'open' });
      prs.get(n).steps.push(st.id);
    }
    rows.push({ build: b.id, title: str(b.title || b.id, 200), ...(isEmergency(b) ? { emergency: true } : {}), status: b.status, attempt: rowAttempt(b), ...(isHeld(b) ? { needsBrett: true } : {}), failure: b.status === 'failed' ? b.failure || null : null, statusAt: str(b.statusAt, 40), prs: [...prs.values()], waiting: g.waiting.map((x) => x.id), steps: landSteps(b).map((x) => ({ id: x.id, status: x.status || '', prNumber: num(x.prNumber) || null, model: x.model || '', slot: x.slot ?? null })) });
  }
  const order = (r) => (r.status === 'failed' ? buildIndex(r.failure?.status || 'build-complete') : buildIndex(r.status));
  return rows.sort((a, b) => Number(!!b.emergency) - Number(!!a.emergency) || order(b) - order(a) || a.build.localeCompare(b.build));
}

/**
 * The builds that stopped for Brett, for the systems check (gate plugin, `escalations`): what broke, since when, the
 * exact failing check. → [{ build, pr, kind (clash | red-ci | land), attempts, since, why, log }]
 */
export function escalations(builds) {
  const word = (k) => (/^clash/.test(k) ? 'clash' : /^ci-|^rules$/.test(k) ? 'red-ci' : 'land');
  return (Array.isArray(builds) ? builds : []).filter((b) => isLanding(b) && isHeld(b)).map((b) => {
    const f = b.failure; const src = f.of?.kind ? f.of : f;
    const checks = (src.failing || f.failing || []).join(', ');
    return { build: b.id, pr: num(f.pr) || null, kind: word(str(src.kind || f.kind)), attempts: num(f.attempt) || landingAttempt(b), since: str(b.statusAt || f.at, 40), why: `Stopped: ${str(f.stopped, 200)}. ${str(src.why || f.why, 400)}`, log: [checks ? `Failing: ${checks}` : '', `Start it again: node deploy/lander/run.mjs retry ${b.id}`].filter(Boolean).join('\n') };
  });
}

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
 * Failures (ported from the retired auto-land rules: push-banner land.mjs + deploy/auto-lander decide()): the build goes
 * `failed` with `attempt: N` and a `failure` record, and the next tick retries forward by itself after a backoff:
 *   clash-steps  two steps of the group conflict in code          → split: the group's steps land one PR each
 *   clash-main   main conflicts with the PR in code               → a fix session on the PR branch, then CI again
 *   ci-red       CI red on the head                               → re-run the failed jobs once per head (flaky);
 *                                                                   still red: a group of 2+ splits, one step gets a fix session
 *   rules        build rules (phase gate) fail after their fixers → a fix session, then CI again
 *   merge        GitHub refused the merge (main moved, not mergeable) → pull main again
 *   infra        push / API / git error                           → the same phase again
 * Nothing escalates to a person (Brett: "absolutely no human intervention, ever"): attempts keep going with a capped
 * backoff; from `notifyAfterAttempts` on every new attempt is posted (never silent).
 */

export const SCHEMA = 'lander@1';

/** The shared contract (Pipeline 2.0): build statuses, forward-only; `failed` carries attempt N. */
export const BUILD_FLOW = Object.freeze(['pending', 'splitting', 'split', 'pulling-main', 'assigning-models', 'ready', 'sending', 'building', 'build-complete', 'merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main', 'landed']);
export const STEP_FLOW = Object.freeze(['pending', 'pulling-main', 'ready', 'sending', 'building', 'completed', 'in-pr']);
/** The statuses the lander owns. */
export const LANDING = Object.freeze(BUILD_FLOW.slice(BUILD_FLOW.indexOf('build-complete')));
/** The statuses a group passes through, in order. */
export const GROUP_FLOW = Object.freeze(['merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main']);
export const FAILURE_KINDS = Object.freeze(['clash-steps', 'clash-main', 'ci-red', 'ci-timeout', 'rules', 'merge', 'fix-timeout', 'infra']);

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
  workflow: 'android.yml',
  mergeMethod: 'merge',
});
const RANGES = { sizeCapLines: [50, 1e7], flakyReruns: [0, 5], backoffBaseMin: [0, 600], backoffFactor: [1, 10], backoffMaxMin: [0, 1440], ciNoneKickMin: [0, 600], ciTimeoutMin: [5, 1440], fixTimeoutMin: [5, 1440], notifyAfterAttempts: [1, 100] };

const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : v == null ? '' : String(v).slice(0, n));
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const minutesBetween = (from, to) => (Date.parse(to) - Date.parse(from)) / 60000;
const plusMin = (iso, m) => new Date(Date.parse(iso) + m * 60000).toISOString();

/** The lander's settings: DEFAULTS with a config file / env on top, numbers clamped. */
export function normConfig(c = {}) {
  const out = { ...DEFAULTS };
  for (const [k, v] of Object.entries(obj(c))) {
    if (!(k in DEFAULTS)) continue;
    if (typeof DEFAULTS[k] === 'boolean') out[k] = v === true || v === 'true' || v === 'on' || v === '1';
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

/**
 * The one build the lander works on: the one already in a landing phase (only one build is active at a time), else the
 * oldest at build-complete. Returns { build, others } (others = more builds the lander would own: a contract breach
 * the runner reports, never works on in parallel).
 */
export function pickBuild(builds) {
  const list = (Array.isArray(builds) ? builds : []).filter(isLanding);
  const age = (b) => str(b.completedAt || b.builtAt || b.updatedAt || b.createdAt) || '9';
  const inFlight = list.filter((b) => failedIn(b) !== 'build-complete').sort((x, y) => age(x).localeCompare(age(y)));
  const ready = list.filter((b) => failedIn(b) === 'build-complete').sort((x, y) => age(x).localeCompare(age(y)));
  const all = [...inFlight, ...ready];
  return { build: all[0] || null, others: all.slice(1).map((b) => b.id) };
}

// ------------------------------------------------------------------ steps, branches, groups

/** A step's branch: its own (Pipeline 2.0 steps build in their own worktree), else the build's. */
export const stepBranch = (b, s) => str(s?.branch, 200) || str(b?.branch, 200);

/** The steps the lander lands: every step that isn't skipped. */
export const landSteps = (b) => (Array.isArray(b?.steps) ? b.steps : []).filter((s) => s && !s.skip && !s.removed);

/** The build's landing record (contract addition, flagged for review): { split, merged: [pr], closed: [pr] }. */
export function landingOf(b) {
  const l = obj(b?.landing);
  const nums = (v) => (Array.isArray(v) ? v.map((x) => num(x)).filter((x) => x > 0) : []);
  return { split: l.split === true, merged: nums(l.merged), closed: nums(l.closed) };
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

const BAD = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale']);

/** CI on a commit from GitHub Actions only (a skipped check is not CI) → { ci: success|failure|running|none, failing, runIds }. */
export function ciOf(runs) {
  const ours = (runs || []).filter((r) => (r?.app?.slug || 'github-actions') === 'github-actions' && r?.conclusion !== 'skipped');
  if (!ours.length) return { ci: 'none', failing: [], runIds: [] };
  if (ours.some((r) => r.status !== 'completed')) return { ci: 'running', failing: [], runIds: [] };
  const bad = ours.filter((r) => BAD.has(r.conclusion));
  const runIds = [...new Set(bad.map((r) => runIdOf(r)).filter(Boolean))];
  return { ci: bad.length ? 'failure' : 'success', failing: bad.map((r) => str(r.name, 120)), runIds };
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
 * head), head, pr, why, at }. → { attempt, failure: { kind, status, why, head, pr, at, retry, notBefore } }
 * retry: rerun | split | fix | pull-main | same.
 */
export function failure(b, kind, ctx = {}, cfg = DEFAULTS) {
  const c = normConfig(cfg);
  const k = FAILURE_KINDS.includes(kind) ? kind : 'infra';
  const attempt = Math.max(0, Math.floor(num(b?.attempt))) + 1;
  const at = ctx.at || new Date().toISOString();
  const group = Math.max(1, Math.floor(num(ctx.groupSize, 1)));
  let retry = 'same';
  if (k === 'clash-steps') retry = 'split';
  else if (k === 'clash-main' || k === 'rules' || k === 'fix-timeout') retry = 'fix';
  else if (k === 'ci-red') retry = num(ctx.reruns) < c.flakyReruns ? 'rerun' : group > 1 ? 'split' : 'fix';
  else if (k === 'ci-timeout') retry = 'rerun';
  else if (k === 'merge') retry = 'pull-main';
  // a flaky re-run goes at once; everything else waits its backoff (the first retry included)
  const wait = retry === 'rerun' && attempt === 1 ? 0 : backoffMinutes(attempt, c);
  return {
    attempt,
    failure: { kind: k, status: str(ctx.status, 40) || failedIn(b), why: str(ctx.why, 600), head: str(ctx.head, 64), pr: num(ctx.pr) || 0, at, retry, notBefore: plusMin(at, wait), ...(ctx.failing?.length ? { failing: ctx.failing.slice(0, 10).map((x) => str(x, 120)) } : {}), ...(ctx.runIds?.length ? { runIds: ctx.runIds.slice(0, 10).map((x) => num(x)).filter(Boolean) } : {}) },
  };
}

/** The phase a retry continues in (forward from `failed`). */
export function retryStatus(f) {
  const r = f?.retry;
  if (r === 'rerun' || r === 'fix') return 'running-ci';
  if (r === 'split') return 'merging-pr';
  if (r === 'pull-main') return 'pr-pulling-main';
  return LANDING.includes(f?.status) && f.status !== 'landed' ? (f.status === 'build-complete' ? 'merging-pr' : f.status) : 'merging-pr';
}

/** Is a failed build's retry due at `at`? */
export const retryDue = (b, at = new Date().toISOString()) => b?.status === 'failed' && (!b.failure?.notBefore || Date.parse(at) >= Date.parse(b.failure.notBefore));

/** Should this attempt be posted (never silent once retries pile up)? */
export const shouldNotify = (attempt, cfg = DEFAULTS) => attempt >= normConfig(cfg).notifyAfterAttempts;

/** Has a fix session had its time without pushing? */
export const fixTimedOut = (fix, at, cfg = DEFAULTS) => !!fix?.at && minutesBetween(fix.at, at) >= normConfig(cfg).fixTimeoutMin;

/** Should CI be started on a head that has none (once per head, after ciNoneKickMin in running-ci)? */
export const ciKickDue = (since, at, cfg = DEFAULTS) => !since || minutesBetween(since, at) >= normConfig(cfg).ciNoneKickMin;
/** Has CI on the head run past its timeout? */
export const ciTimedOut = (since, at, cfg = DEFAULTS) => !!since && minutesBetween(since, at) >= normConfig(cfg).ciTimeoutMin;

/**
 * The job a fix hands to an agent (agent-job.mjs land-build, the all-rounder router picks who): the PR branch, the
 * build, what to fix.
 */
export function fixJob(b, f, branch) {
  const what = f.kind === 'clash-main' ? `merging main into ${branch} conflicts in code: merge origin/main, resolve, push`
    : f.kind === 'rules' ? `the build rules fail at the gate (${(f.failing || []).join(', ') || 'see Builds → Gate & rules'}); fix them on ${branch} and push`
      : `CI is red on ${branch}${f.failing?.length ? ` (${f.failing.join(', ')})` : ''}; fix it and push`;
  return { type: 'land-build', input: { branch, build: b.id, checks: what } };
}

/** Plain words for one tick's outcome (logs, the crew chat). */
export function say(b, text) { return `${b?.id || 'lander'}: ${str(text, 500)}`; }

/**
 * The merge queue view (read-only, merge-queue@2): every build waiting to land, from the same store rows, live status,
 * no state of its own. → [{ build, title, status, attempt, failure, prs: [{ pr, steps, state }], waiting, at }]
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
    rows.push({ build: b.id, title: str(b.title || b.id, 200), status: b.status, attempt: num(b.attempt) || 0, failure: b.status === 'failed' ? b.failure || null : null, statusAt: str(b.statusAt, 40), prs: [...prs.values()], waiting: g.waiting.map((x) => x.id), steps: landSteps(b).map((x) => ({ id: x.id, status: x.status || '', prNumber: num(x.prNumber) || null, model: x.model || '', slot: x.slot ?? null })) });
  }
  const order = (r) => (r.status === 'failed' ? buildIndex(r.failure?.status || 'build-complete') : buildIndex(r.status));
  return rows.sort((a, b) => order(b) - order(a) || a.build.localeCompare(b.build));
}

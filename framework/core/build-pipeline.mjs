/**
 * build-pipeline@1 — the pipeline record on a builds@1 build and the three table states (pure, IO-free).
 *
 * Brett, Nov 8 2026 ("You need to start the pipeline over from scratch"): everything he asks for becomes a build in the
 * orchestrator, which assigns the id, splits it into steps (≤ 10 min, checkpoints inside one session; Fable only where needed) and puts it in
 * **Pending**. He moves builds from Pending to the **Queue**. A dispatcher on the VPS watches the connected Claude
 * accounts (which have Fable, how many may run in parallel) and the agent slots; when a slot is free it takes the next
 * Queue build and starts a headless session on an account that can run the next phase's model (**Building**).
 *
 *   One build in the Queue at a time (Nov 28 2026, the single-Queued contract at the end of this file): Pending is a
 *   line, promote() moves its oldest build up when the queued one goes live, and hold / cancel / unqueue stick.
 *
 *   status flow:  pending → queued → running (Building) ⇄ fixing → landing → landed → complete  (done-means-merged@1, below)
 *                 a session that ends with steps left: nextStatusOnExit(). Its phase done (any model, Fable → Opus or
 *                 Opus → Fable with the upgrade policy satisfied) = back to queued, same queue position, the next phase
 *                 starts by itself ('phase-done'). A crash = queued again ('crash') until maxRuns crashes, then pending
 *                 ('crash-limit'). Pending only for a real stop: the crash limit, the next phase is an upgrade Brett has
 *                 not approved while "Fable upgrades need my approval" is on ('upgrade-blocked'), the session needs
 *                 Brett ('needs-brett'), or it stopped mid-phase on purpose: a question, UI Review ('stopped').
 *
 * `pipeline` on a build (kept across orchestrator, Pending and queue writes; only the dispatcher and the queue
 * actions change it):
 *   queuedAt   ISO: when it entered the Queue ('' in Pending)        queuedBy  who queued it (brett | auto | console | …)
 *   account    the Claude account the current / last run is on       session   its tmux session (axf-<id>--<agent>)
 *   slot       the agent-slots entry id of the current run           model     the model that run started on
 *   phase      the phase name that run was launched for ('' before the dispatcher recorded phases)
 *   launchedAt ISO of the current / last launch                      runs      how many sessions have run it
 *   crashes    sessions that ended with a failed exit (the crash limit counts these, never a clean phase end)
 *   lastRun    { at, exit, outcome, reason, stepsLeft, account, session, phase }
 *              outcome = finished | requeued | returned | failed; reason = one of EXIT_REASONS
 *   split      { at, by, provider, steps, note }                     how its steps were made (claude | rules | hand)
 *   splitRequested  ISO: the console asked for a (re)split; the next tick does it
 *   note       one plain line the Pipeline view shows (why it waits, what happened last)
 *   route      '' (auto: subscriptions, then API only when the overflow rule is on) | 'api' (run on an API-key account,
 *              billed per token, under its caps) | 'subscription' (never an API account). Brett's per-build override.
 *   dispatchedAt  ISO of the orchestrator dispatch that started the current run (its token is in the dispatcher's files)
 *   planned    { model, account, kind, at, why }  the orchestrator's plan, made as soon as the build is split (Brett,
 *              Nov 10 2026: "He'll plan what model, what account"); refreshed while it waits
 *   tried      accounts the final pick tried and that refused this run (launch failed), in order; '' list on a clean pick
 *   pickedAt   ISO of the final account decision (the moment the build's turn came in the Queue)
 *   runEnd     { at, exit, signal, kind, limit, account, session, phase }  how the newest session really ended, written by
 *              deploy/claude-headless.sh (builds-live.mjs run-end) the moment claude exits, before anything else runs:
 *              exit 143 / signal TERM = killed, 1 = failed; kind = phase-done | crash | stopped; limit = usage | auth when
 *              the account stopped it. Evidence for the watchdog (build-watchdog@1); absent until a run ends.
 *   heldAt, heldBy, heldWhy  On hold (Brett, Nov 10 2026: "Make a hold status … leave in queue on hold"): the build stays
 *              in the Queue, keeps its place, and the dispatcher skips it until it is released. '' = not held.
 *   stop       { kind, at, by, why, from }  a standing hold | cancel | unqueue: terminal until Brett (the single-Queued
 *              contract at the end of this file). Optional: absent on a build nobody stopped.
 *   lineAt     ISO: the build's place in the Pending line once it has been queued or held (optional; else createdAt)
 *   maxParallel  parallel step sessions this build may have at once beyond its own (0 = the planner's default, 3)
 *   budgetUsd, spentUsd  this build's API spend cap and what its API runs have cost so far (0 = no cap / nothing spent);
 *              an API launch that would pass the cap waits, subscriptions are never counted
 *
 * The orchestrator's tabs (Brett, Nov 10 2026: "Tabs: pending, active, incomplete, complete, errors, queue"): tabOf().
 *
 * Step dependencies and claims (Nov 13 2026, build always-fill-every-slot: "when slots are free, run independent steps
 * of running builds in parallel across them"). Two optional fields on a builds@1 step (spec/BUILD-PARALLEL.md):
 *   after   [stepId]  the steps of the same build that must be done (or skipped) before this one may start.
 *                     NO `after` field = implicitly sequential: the step waits for the step before it in the list, so
 *                     every build from before this contract runs exactly as it did. `after: []` = independent: it may
 *                     start as soon as the build runs. Ids name steps of the same build; a step never names itself;
 *                     cycles and unknown ids are refused by the store check (builds-store.mjs).
 *   claim   { runId, slot, account, branch, at, model, expiresAt } | null  the session working the step right now.
 *                     Model-aware: `model` is the step's pinned model the session was launched on (never higher).
 *                     A claim lives CLAIM_TTL_MS from `at` (expiresAt); past it the step is ready again (a session that
 *                     died without releasing). Ticking a step done releases its claim. `branch` is the parallel step's
 *                     worktree branch (<build-branch>--s<n>) or the build branch for a sequential step.
 *   dependsOn [stepId]  the same list under the splitter's and the API's name: accepted on input and stored as `after`
 *                     (normStep folds it; `after` wins when both are present). One field on disk, two spellings in.
 *   parallel  'auto' | 'never'  may the planner run this step in a parallel session? absent = auto: yes, when it has an
 *                     explicit list and no file clash. 'never' = only the build's own session runs it (a step that
 *                     rebases, merges, releases or touches shared state) even when its dependencies are done.
 *   files     [path]  (an existing step field) what the step touches. Two steps that share a file never run at once:
 *                     a step whose files overlap a step with a live claim is held back (fileClashes).
 * Helpers: normAfter / normClaim / normParallel (shape), dependsOn(build, step) (the resolved list, implicit sequential
 * included), claimLive(claim, now), stepBranch(build, step), fileClashes(build, step, { now, against }).
 * Engine (pure, every call returns a new record): readySteps(build, { now, model }) = open steps whose dependencies are
 * settled, that carry no live claim and that touch no file a live-claimed step touches; claimStep(build, stepId, { runId,
 * slot, account, branch, model, now, ttlMs }) takes one (refused: not ready, a file clash, another run's live claim, a
 * model above the pin); releaseStep(build, stepId, { runId, note }) gives it back; expiredClaims(build, now) lists the
 * dead ones.
 * Planner: planFill({ slots, accounts, running, queue, pending, settings }) fills every free slot: parallel-ready steps of
 * running builds, then Queue builds by priority, then Pending builds when auto-queue is on; agent cap, VPS hard limit,
 * memory floor, per-account model limits, the API budget cap and each build's own caps (pipeline.maxParallel,
 * pipeline.budgetUsd / spentUsd) respected; every launch and every wait says why.
 *
 * done-means-merged@1 (Nov 17 2026, spec/DONE-MEANS-MERGED.md; Brett: "We asked you to build it. You should do whatever
 * you have to do to build it, period."): a build is `landed` only once its PR merged to main with CI green on the merge
 * commit, `complete` only once its feature verify passed on top. Every step done = `landing` (the auto-lander's), never
 * `built` (legacy: read as landed). A failure (FAILURE_KINDS) puts it in `fixing` with an attempt@1 on `attempts[]`;
 * the ladder (retry-ladder.mjs) decides the next try; `escalated` only when the ladder ran out. Records on builds@1:
 *   attempts[]  attempt@1: n, kind, strategy, fixStrategy, model, account, session, step, head, pr, startedAt, endedAt,
 *               result, log (link), note, source                                   (normAttempt / normAttempts)
 *   failure     the open failure the ladder works on: { kind, at, why, head, step, exit } | null   (normFailure)
 *   landed      the evidence: { pr, sha, mergedAt, ci, ciAt, ciRun, verifiedAt, verifyHow, verifyLog } | null (normLanded)
 *   escalation  { at, kind, attempts, why, head, tried[], bannerId, pushedAt } | null              (normEscalation)
 * guardStatus() says whether a status change is allowed; migrateDone() moves old built / complete records that cannot
 * prove a merge back to landing / fixing.
 */

export const SCHEMA = 'build-pipeline@1';
export const DONE_SCHEMA = 'done-means-merged@1';
/** The pipeline table: what each builds@1 status shows as (fixing is a kind of building: a session may be on it). */
export const TABLE = Object.freeze({ pending: 'pending', queued: 'queued', running: 'building', waiting: 'building', fixing: 'building' });
export const TABLE_STATES = ['pending', 'queued', 'building'];
export const TABLE_LABEL = Object.freeze({ pending: 'Pending', queued: 'Queue', building: 'Building' });
export const OUTCOMES = ['finished', 'requeued', 'returned', 'failed'];
/** Why a run ended the way it did (lastRun.reason): the exit transition's reason code. */
export const EXIT_REASONS = ['all-done', 'phase-done', 'crash', 'crash-limit', 'upgrade-blocked', 'needs-brett', 'stopped'];
/** Where a build may run: auto, only API-key accounts, only subscriptions. */
export const ROUTES = ['', 'api', 'subscription'];
export const SPLIT_PROVIDERS = ['claude', 'rules', 'hand'];
export const DEFAULT_MAX_RUNS = 3;
/** runEnd.kind / runEnd.limit values (the headless wrapper's exit kind; the account stop it detected). */
export const RUN_END_KINDS = ['', 'phase-done', 'crash', 'stopped'];
export const RUN_END_LIMITS = ['', 'usage', 'auth'];
/** The signal an exit code stands for (128 + n), '' for none. */
export function signalOf(exit) { return ({ 129: 'HUP', 130: 'INT', 131: 'QUIT', 134: 'ABRT', 137: 'KILL', 139: 'SEGV', 143: 'TERM' })[exit] ?? ''; }
/** A runEnd record in shape, or null. */
export function normRunEnd(r) {
  if (!r || typeof r !== 'object' || !iso(r.at)) return null;
  const exit = Number.isInteger(r.exit) ? r.exit : (typeof r.exit === 'string' && /^\d{1,3}$/.test(r.exit) ? Number(r.exit) : null);
  return { at: iso(r.at), exit, signal: /^[A-Z]{2,6}$/.test(str(r.signal, 8)) ? str(r.signal, 8) : signalOf(exit), kind: RUN_END_KINDS.includes(r.kind) ? r.kind : '', limit: RUN_END_LIMITS.includes(r.limit) ? r.limit : '', account: accountName(r.account), session: str(r.session, 120), phase: str(r.phase, 80) };
}

/**
 * launch-retry (Nov 17 2026): a run that died at launch (before its first output, E2BIG, a launcher error) is requeued
 * with a backoff by itself, outside the maxRuns cap. { count, lastError, at, retryAt, gaveUp } or null.
 */
export const LAUNCH_RETRY_MAX = 3;
export function normLaunchRetry(r) {
  if (!r || typeof r !== 'object' || !iso(r.at)) return null;
  return { count: Number.isInteger(r.count) && r.count > 0 ? Math.min(r.count, 99) : 0, lastError: str(r.lastError, 300), at: iso(r.at), retryAt: iso(r.retryAt), gaveUp: r.gaveUp === true };
}

/** land-clash bounce: the last time a clash with main sent the build back to the Queue with a merge-main step. */
export function normBounce(r) {
  if (!r || typeof r !== 'object' || !iso(r.at)) return null;
  return { at: iso(r.at), why: str(r.why, 300), head: str(r.head, 64), files: (Array.isArray(r.files) ? r.files : []).map((f) => str(f, 200)).filter(Boolean).slice(0, 20), step: str(r.step, 40), count: Number.isInteger(r.count) && r.count > 0 ? Math.min(r.count, 999) : 1 };
}

// ------------------------------------------------------------------ done-means-merged@1: statuses, kinds, records

/** The statuses this contract adds to builds@1 (builds-store-core STATUSES carries the full list). */
export const DONE_STATUSES = Object.freeze(['fixing', 'landing', 'landed', 'escalated']);
/** Statuses a build may only enter with proof (guardStatus): merged + CI green (landed, built), + verify (complete). */
export const PROVEN_STATUSES = Object.freeze(['landed', 'built', 'complete']);
/** What can go wrong on the way to merged and working (spec/DONE-MEANS-MERGED.md → Failure kinds). */
export const FAILURE_KINDS = Object.freeze(['crash', 'ci-red', 'clash', 'push-fail', 'stalled', 'fell-to-pending']);
/** An attempt's kind: a failure kind, or `land` for the auto-lander's merge tries kept in the same log. */
export const ATTEMPT_KINDS = Object.freeze([...FAILURE_KINDS, 'land']);
/** The ladder rungs (retry-ladder.mjs). */
export const STRATEGIES = Object.freeze(['retry', 'merge-main', 'fix', 'fresh-session', 'switch-model', 'switch-account', 'escalate']);
/** How a fix session goes at red CI: the failing checks, regenerate generated files, or redo the step from its text. */
export const FIX_STRATEGIES = Object.freeze(['targeted', 'regenerate', 'redo-step']);
/** auto-lander-attempt@1's results, same meanings (timeout = started past the policy's timeout; skipped never counts). */
export const ATTEMPT_RESULTS = Object.freeze(['started', 'ok', 'failed', 'timeout', 'skipped']);
export const ATTEMPT_FAILURES = Object.freeze(['failed', 'timeout']);
export const ATTEMPT_SOURCES = Object.freeze(['pipeline', 'auto-lander', 'hand']);
/** CI on the merge commit (landed.ci): unknown = a legacy record migrated with mergedAt and no run recorded. */
export const LANDED_CI = Object.freeze(['success', 'failure', 'running', 'none', 'unknown']);
export const VERIFY_HOWS = Object.freeze(['', 'check', 'playwright', 'deploy', 'hand']);
export const ATTEMPTS_MAX = 60;
/** auto-lander-attempt@1 kind → attempt@1 kind. */
export const AUTO_LANDER_KIND = Object.freeze({ clash: 'clash', 'red-ci': 'ci-red', land: 'land' });
export const MODELS = Object.freeze(['Fable', 'Opus']);

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const iso = (v) => { const s = str(v, 40).trim(); return s && Number.isFinite(Date.parse(s)) ? s : ''; };
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const oneOf = (list, v, d) => (list.includes(v) ? v : d);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const int = (v, d = 0) => (Number.isInteger(v) && v >= 0 ? v : d);
const prNum = (v) => { const n = Number(String(v ?? '').replace(/^#/, '').replace(/^.*\/pull\//, '')); return Number.isInteger(n) && n > 0 ? n : 0; };
/** A saved Claude account name (deploy/claude-login.mjs), or ''. */
export const accountName = (v) => (NAME_RE.test(str(v, 40)) ? str(v, 40) : '');

/** One attempt@1, every field in shape; bad enums fall to the safe side (a failure counts, a kind is a failure). */
export function normAttempt(a, i = 0) {
  const x = obj(a) ?? {};
  const strategy = oneOf(STRATEGIES, x.strategy, 'retry');
  return {
    n: int(x.n) || i + 1, kind: oneOf(ATTEMPT_KINDS, x.kind, 'crash'), strategy, fixStrategy: strategy === 'fix' ? oneOf(FIX_STRATEGIES, x.fixStrategy, 'targeted') : '',
    model: oneOf(MODELS, x.model, ''), account: str(x.account, 80), session: str(x.session, 120), step: str(x.step, 40), head: str(x.head, 64), pr: prNum(x.pr),
    startedAt: iso(x.startedAt) || iso(x.at), endedAt: iso(x.endedAt), result: oneOf(ATTEMPT_RESULTS, x.result, 'failed'),
    log: str(x.log, 300), note: str(x.note, 600), source: oneOf(ATTEMPT_SOURCES, x.source, 'pipeline'),
  };
}
/** The list: oldest first, n dense across the build, at most ATTEMPTS_MAX kept (the journal keeps every revision). */
export function normAttempts(list) {
  const arr = (Array.isArray(list) ? list : []).filter((a) => obj(a)).slice(-ATTEMPTS_MAX);
  return arr.map((a, i) => ({ ...normAttempt(a, i), n: i + 1 }));
}
/** An auto-lander-attempt@1 folded into the build's log (its per-PR n is replaced on the build by normAttempts). */
export function fromAutoLanderAttempt(a) {
  const x = obj(a) ?? {};
  const kind = AUTO_LANDER_KIND[x.kind] ?? 'land';
  const strategy = kind === 'clash' ? 'merge-main' : kind === 'ci-red' ? 'fix' : 'retry';
  return normAttempt({ n: x.n, kind, strategy, fixStrategy: 'targeted', account: x.account, session: x.session, head: x.head, pr: x.pr, startedAt: x.at, endedAt: x.endedAt, result: x.result, log: '', note: str(x.log, 600), source: 'auto-lander' });
}
/** The open failure, or null. */
export function normFailure(f) {
  const x = obj(f); if (!x || !FAILURE_KINDS.includes(x.kind)) return null;
  return { kind: x.kind, at: iso(x.at), why: str(x.why, 600), head: str(x.head, 64), step: str(x.step, 40), exit: Number.isInteger(x.exit) ? x.exit : null };
}
/** The evidence a build is merged and working, or null when nothing is recorded. */
export function normLanded(l) {
  const x = obj(l); if (!x) return null;
  const out = { pr: prNum(x.pr), sha: str(x.sha, 64), mergedAt: iso(x.mergedAt), ci: oneOf(LANDED_CI, x.ci, 'none'), ciAt: iso(x.ciAt), ciRun: str(x.ciRun, 300), verifiedAt: iso(x.verifiedAt), verifyHow: oneOf(VERIFY_HOWS, x.verifyHow, ''), verifyLog: str(x.verifyLog, 300) };
  return out.pr || out.sha || out.mergedAt || out.ci !== 'none' || out.verifiedAt ? out : null;
}
/** Why a build stopped (auto-lander's escalation record plus the rungs tried), or null. */
export function normEscalation(e) {
  const x = obj(e); if (!x) return null;
  return { at: iso(x.at), kind: oneOf(ATTEMPT_KINDS, x.kind, 'crash'), attempts: int(x.attempts), why: str(x.why, 600), head: str(x.head, 64), tried: (Array.isArray(x.tried) ? x.tried : []).map((t) => str(t, 40)).filter(Boolean).slice(0, 20), bannerId: str(x.bannerId, 120), pushedAt: iso(x.pushedAt) };
}
/** The attempts of one kind that count as failures (failed, timeout). */
export const failedAttempts = (attempts, kind = '') => normAttempts(attempts).filter((a) => ATTEMPT_FAILURES.includes(a.result) && (!kind || a.kind === kind));

/**
 * May this build move to `to`? Pure: { ok, why }. Only the proven statuses need proof; a record already at rest in a
 * status is never judged (grandfathered: the store runs this on a change of status only).
 *   landing          every step done or skipped, a branch, and a PR (no PR = a push-fail failure, status fixing)
 *   landed, built    a PR, mergedAt (or landed.mergedAt), landed.sha and landed.ci = success
 *   complete         the above plus landed.verifiedAt and a verifyHow
 */
export function guardStatus(b, to) {
  const x = obj(b) ?? {};
  if (x.status === to) return { ok: true, why: '' };
  const L = normLanded(x.landed) ?? {};
  const pr = prNum(x.pr) || L.pr;
  const mergedAt = iso(x.mergedAt) || L.mergedAt;
  if (to === 'landing') {
    const left = (Array.isArray(x.steps) ? x.steps : []).filter((s) => !s?.done && !s?.skip).length;
    if (left) return { ok: false, why: `${left} step${left === 1 ? '' : 's'} still open: a build lands when every step is done` };
    if (!str(x.branch) || x.branch === 'main') return { ok: false, why: 'no branch: nothing to land' };
    if (!pr) return { ok: false, why: 'no PR yet: that is a push-fail failure (fixing), not landing' };
    return { ok: true, why: '' };
  }
  if (to === 'landed' || to === 'built' || to === 'complete') {
    if (!pr) return { ok: false, why: `${to} needs a merged PR: there is no PR` };
    if (!mergedAt) return { ok: false, why: `${to} needs the PR merged to main: mergedAt is empty` };
    if (!L.sha) return { ok: false, why: `${to} needs the merge commit (landed.sha)` };
    if (L.ci !== 'success') return { ok: false, why: `${to} needs CI green on the merge commit: landed.ci is ${L.ci || 'none'}` };
    if (to === 'complete' && !(L.verifiedAt && L.verifyHow)) return { ok: false, why: 'complete needs the feature verify passed (landed.verifiedAt, landed.verifyHow)' };
    return { ok: true, why: '' };
  }
  return { ok: true, why: '' };
}

/**
 * done-means-merged@1 migration of one record, pure: { build, change } where change = { from, to, why } or null.
 *   built, no mergedAt, a PR or a branch      → landing
 *   built, no mergedAt, neither               → fixing + failure push-fail
 *   built, mergedAt                           → landed (landed.ci unknown: legacy)
 *   complete, no mergedAt, a PR or a branch   → landing
 *   complete, no mergedAt, neither            → untouched, reported as unprovable
 * Everything else (complete with mergedAt, deleted, archived, open builds) is untouched.
 */
export function migrateDone(b, { at = new Date().toISOString() } = {}) {
  const x = obj(b);
  if (!x || x.deleted || !['built', 'complete'].includes(x.status)) return { build: b, change: null };
  const merged = iso(x.mergedAt) || normLanded(x.landed)?.mergedAt || '';
  const landable = !!(prNum(x.pr) || (str(x.branch) && x.branch !== 'main'));
  const note = (text) => [...(Array.isArray(x.notes) ? x.notes : []), { text, at }];
  if (x.status === 'built' && merged) {
    const landed = { ...(normLanded(x.landed) ?? {}), pr: prNum(x.pr) || normLanded(x.landed)?.pr || 0, mergedAt: merged, ci: normLanded(x.landed)?.ci === 'success' ? 'success' : 'unknown' };
    return { build: { ...x, status: 'landed', mergedAt: merged, landed: normLanded(landed), updatedAt: at, notes: note('done-means-merged@1: was built with a merged PR; now landed (CI on the merge commit not recorded: legacy).') }, change: { from: 'built', to: 'landed', why: 'merged, CI unknown' } };
  }
  if (!merged && landable) {
    const why = x.status === 'built' ? 'every step done, PR not merged: the auto-lander lands it' : 'complete was never proven (no merge recorded): the lander checks and lands it';
    return { build: { ...x, status: 'landing', builtAt: str(x.builtAt), updatedAt: at, notes: note(`done-means-merged@1: was ${x.status} without a merged PR; now landing (${why}).`) }, change: { from: x.status, to: 'landing', why } };
  }
  if (!merged && x.status === 'built') {
    const failure = { kind: 'push-fail', at, why: 'built with no branch and no PR: nothing ever reached GitHub', head: '', step: '', exit: null };
    return { build: { ...x, status: 'fixing', failure, updatedAt: at, notes: note('done-means-merged@1: was built with no branch and no PR; now fixing (push-fail): a session must push and open the PR.') }, change: { from: 'built', to: 'fixing', why: failure.why } };
  }
  if (!merged) return { build: b, change: { from: 'complete', to: 'complete', why: 'unprovable: no PR, no branch, no merge recorded (pre-pipeline record)' } };
  return { build: b, change: null };
}

/** The migration over a whole builds@1 store (pure): { store, report: { at, moved: [{ id, from, to, why }], unprovable: [ids] } }. */
export function migrateDoneStore(store, { at = new Date().toISOString() } = {}) {
  const s = obj(store) ?? { builds: [] };
  const report = { $axf: DONE_SCHEMA, at, moved: [], unprovable: [] };
  const builds = (Array.isArray(s.builds) ? s.builds : []).map((b) => {
    const r = migrateDone(b, { at });
    if (r.change && r.change.from !== r.change.to) report.moved.push({ id: b.id, ...r.change });
    else if (r.change) report.unprovable.push(b.id);
    return r.build;
  });
  return { store: { ...s, builds, meta: { ...(obj(s.meta) ?? {}), doneMeansMerged: { at, moved: report.moved.length, unprovable: report.unprovable.length } } }, report };
}

export function emptyPipeline() {
  return { queuedAt: '', queuedBy: '', account: '', session: '', slot: '', model: '', phase: '', launchedAt: '', runs: 0, crashes: 0, lastRun: null, split: null, splitRequested: '', note: '', route: '', dispatchedAt: '', planned: null, tried: [], pickedAt: '', heldAt: '', heldBy: '', heldWhy: '', maxParallel: 0, budgetUsd: 0, spentUsd: 0 };
}
const usd = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };

/** The record, every field in shape; null for nothing (a build the pipeline never touched carries none). */
export function normPipeline(p) {
  if (!p || typeof p !== 'object') return null;
  const lr = p.lastRun && typeof p.lastRun === 'object' ? p.lastRun : null;
  const sp = p.split && typeof p.split === 'object' ? p.split : null;
  const pl = p.planned && typeof p.planned === 'object' ? p.planned : null;
  const out = {
    queuedAt: iso(p.queuedAt), queuedBy: str(p.queuedBy, 80),
    account: accountName(p.account), session: str(p.session, 120), slot: str(p.slot, 60), model: str(p.model, 20), phase: str(p.phase, 80),
    launchedAt: iso(p.launchedAt), runs: Number.isInteger(p.runs) && p.runs > 0 ? p.runs : 0, crashes: Number.isInteger(p.crashes) && p.crashes > 0 ? p.crashes : 0,
    lastRun: lr ? { at: iso(lr.at), exit: Number.isInteger(lr.exit) ? lr.exit : null, outcome: OUTCOMES.includes(lr.outcome) ? lr.outcome : 'finished', reason: EXIT_REASONS.includes(lr.reason) ? lr.reason : '', stepsLeft: Number.isInteger(lr.stepsLeft) ? lr.stepsLeft : 0, account: accountName(lr.account), session: str(lr.session, 120), phase: str(lr.phase, 80) } : null,
    split: sp ? { at: iso(sp.at), by: str(sp.by, 80), provider: SPLIT_PROVIDERS.includes(sp.provider) ? sp.provider : 'hand', steps: Number.isInteger(sp.steps) ? sp.steps : 0, note: str(sp.note, 400) } : null,
    splitRequested: iso(p.splitRequested), note: str(p.note, 400),
    route: ROUTES.includes(p.route) ? p.route : '', dispatchedAt: iso(p.dispatchedAt),
    planned: pl ? { model: str(pl.model, 20), account: accountName(pl.account), kind: pl.kind === 'api' ? 'api' : pl.kind === 'subscription' ? 'subscription' : '', at: iso(pl.at), why: str(pl.why, 300) } : null,
    tried: (Array.isArray(p.tried) ? p.tried : []).map(accountName).filter(Boolean).slice(0, 12), pickedAt: iso(p.pickedAt),
    heldAt: iso(p.heldAt), heldBy: iso(p.heldAt) ? str(p.heldBy, 80) : '', heldWhy: iso(p.heldAt) ? str(p.heldWhy, 300) : '',
    maxParallel: Number.isInteger(p.maxParallel) && p.maxParallel > 0 ? Math.min(p.maxParallel, 12) : 0, budgetUsd: usd(p.budgetUsd), spentUsd: usd(p.spentUsd),
    ...(normRunEnd(p.runEnd) ? { runEnd: normRunEnd(p.runEnd) } : {}), // optional: absent until a run ends (old records unchanged)
    ...(normLaunchRetry(p.launchRetry) ? { launchRetry: normLaunchRetry(p.launchRetry) } : {}), // optional: only after a launch crash
    ...(normBounce(p.bounce) ? { bounce: normBounce(p.bounce) } : {}), // optional: only after a land-clash bounce
    ...(normStop(p.stop) ? { stop: normStop(p.stop) } : {}), // optional: a standing hold / cancel / unqueue (single-Queued contract)
    ...(iso(p.lineAt) ? { lineAt: iso(p.lineAt) } : {}), // optional: the build's place in the Pending line once it has been queued or held
  };
  const empty = emptyPipeline();
  return JSON.stringify(out) === JSON.stringify(empty) ? null : out;
}

/** Which table a build sits in ('' for builds the table does not show: built, complete, failed, blocked, archived). */
export const tableOf = (b) => TABLE[b?.status] ?? '';

/** The orchestrator's tabs, in screen order. */
export const TABS = ['pending', 'queue', 'active', 'incomplete', 'complete', 'errors', 'archive', 'deleted'];
export const TAB_LABEL = Object.freeze({ pending: 'Pending', queue: 'Queue', active: 'Active', incomplete: 'Incomplete', complete: 'Complete', errors: 'Errors', archive: 'Archive', deleted: 'Deleted' });

/**
 * Which tab a build shows in ('' = none: archived, deleted or hidden).
 *   pending     filed, not started yet (no step done, never run)       queue       queued, waiting for its turn
 *   active      running or waiting on an approval                       incomplete  started, then stopped with steps left (back in Pending), or blocked
 *   complete    built, its PR not merged yet                          errors      failed, its last launch failed, or back in
 *                                                                                 Pending on the crash limit
 *   archive     complete (merged) or archived: every finished and retired build (Brett, Nov 10 2026: "All completed
 *               builds go to the archive")
 *   deleted     soft-deleted: kept in the store forever, restorable ("A deleted tab where all deleted builds stay saved forever")
 * A queued build On hold stays in the Queue tab (isHeld()).
 */
export function tabOf(b) {
  if (!b) return '';
  if (b.deleted) return 'deleted';
  if (b.hidden) return '';
  if (b.status === 'archived' || b.status === 'complete' || b.status === 'landed') return 'archive';
  const p = b.pipeline ?? {};
  if (b.status === 'failed' || b.status === 'escalated' || /^launch failed/.test(str(p.note, 40))) return 'errors';
  if (b.status === 'pending' && p.lastRun?.outcome === 'failed') return 'errors'; // the crash limit sent it back to Pending
  if (b.status === 'running' || b.status === 'waiting' || b.status === 'fixing') return 'active';
  if (b.status === 'queued') return 'queue';
  if (b.status === 'built' || b.status === 'landing') return 'complete'; // every step done, not merged yet: the lander's (done-means-merged@1)
  if (b.status === 'blocked') return 'incomplete';
  const started = (b.steps ?? []).some((s) => s.done) || (Number(p.runs) || 0) > 0 || !!p.lastRun;
  return started ? 'incomplete' : 'pending';
}

/** A build may be queued: it is in Pending and not finished. */
export const canQueue = (b) => !!b && b.status === 'pending' && !b.deleted && !b.hidden;
/** A build may leave the Queue for Pending: queued and not launched yet. */
export const canUnqueue = (b) => !!b && b.status === 'queued' && !b.deleted;
/** On hold: waiting (in Pending since the single-Queued contract; a legacy record may still be queued), skipped until Brett releases it. */
export const isHeld = (b) => !!b && (b.status === 'queued' || b.status === 'pending') && !!b.pipeline?.heldAt;
/** A build may be put on hold: queued (not launched) and not held already. A Pending build is held through hold(). */
export const canHold = (b) => !!b && b.status === 'queued' && !b.deleted && !isHeld(b);
/** A build with a live session (running, waiting on an approval, or a fix attempt on it) is never archived or deleted underneath it. */
export const isLive = (b) => !!b && (b.status === 'running' || b.status === 'waiting' || b.status === 'fixing');
/** A build may move to the Archive: not live, not deleted, not archived already. */
export const canArchive = (b) => !!b && !b.deleted && !isLive(b) && b.status !== 'archived';
/** A build may be (soft-)deleted: not live, not deleted already. Deleting never drops the record. */
export const canDelete = (b) => !!b && !b.deleted && !isLive(b);
/** The status an archived build comes back with: landed / landing when every step is done (done-means-merged@1), else pending. */
export function unarchivedStatus(b) {
  const left = openSteps(b).length;
  if (!left && (b?.steps ?? []).length) return str(b?.mergedAt) ? (normLanded(b?.landed)?.verifiedAt ? 'complete' : 'landed') : 'landing';
  return 'pending';
}
/** The actions the Build orchestrator offers on a build (Queue: back to Pending, hold / release, archive, delete). */
export const BUILD_ACTIONS = ['unqueue', 'hold', 'release', 'archive', 'unarchive', 'delete', 'restore'];
export function actionsFor(b) {
  if (!b) return [];
  if (b.deleted) return ['restore'];
  const out = [];
  if (canUnqueue(b)) out.push('unqueue');
  if (canHold(b)) out.push('hold');
  if (isHeld(b)) out.push('release');
  if (canArchive(b)) out.push('archive');
  if (b.status === 'archived') out.push('unarchive');
  if (canDelete(b)) out.push('delete');
  return out;
}

/** Builds of the Queue in start order: priority first (P0 before P3), then the moment they were queued. */
export function queueOrder(builds, priorityOf = () => 'P2') {
  const rank = (p) => { const n = parseInt(String(p).replace(/^P/, ''), 10); return Number.isInteger(n) ? n : 2; };
  return [...builds].filter((b) => b.status === 'queued').sort((a, b) => rank(priorityOf(a)) - rank(priorityOf(b)) || str(a.pipeline?.queuedAt).localeCompare(str(b.pipeline?.queuedAt)) || str(a.createdAt).localeCompare(str(b.createdAt)));
}

// ------------------------------------------------------------------ step dependencies and claims (Nov 13 2026)

/** A claim lives this long unless released (steps are ≤ 10 min; the rest is the merge back and session start-up). */
export const CLAIM_TTL_MS = 45 * 60e3;
export const CLAIM_MODELS = ['Fable', 'Opus'];
const AFTER_MAX = 20;

/**
 * The `after` list in shape, or undefined when the step carries none. Absent and empty differ on purpose: absent =
 * implicitly sequential (old builds), [] = independent. `self` is never kept; with `ids` (the build's step ids) unknown
 * ids are dropped (the store check names them first).
 */
export function normAfter(v, { self = '', ids = null } = {}) {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set();
  return v.map((x) => str(x, 40).trim()).filter((id) => id && id !== self && !seen.has(id) && (seen.add(id), true) && (!ids || ids.includes(id))).slice(0, AFTER_MAX);
}

/** The claim record in shape, or null for nothing (a claim without runId is none). `model` defaults to the step's. */
export function normClaim(c, { model = '' } = {}) {
  if (!c || typeof c !== 'object' || !str(c.runId, 80).trim()) return null;
  const at = iso(c.at);
  return {
    runId: str(c.runId, 80).trim(), slot: str(c.slot, 60), account: accountName(c.account), branch: str(c.branch, 200), at,
    model: CLAIM_MODELS.includes(c.model) ? c.model : CLAIM_MODELS.includes(model) ? model : '',
    expiresAt: iso(c.expiresAt) || (at ? new Date(Date.parse(at) + CLAIM_TTL_MS).toISOString() : ''),
  };
}

/** Is this claim alive at `now`? A claim without a time is dead; one past expiresAt is dead. */
export function claimLive(c, now = Date.now()) {
  if (!c?.runId) return false;
  const t = Date.parse(c.expiresAt || '');
  return Number.isFinite(t) && t > (typeof now === 'number' ? now : Date.parse(now));
}

/** The explicit dependency list a step carries (`after`, or its input alias `dependsOn`), or undefined for none. */
export const explicitAfter = (step) => (Array.isArray(step?.after) ? step.after : Array.isArray(step?.dependsOn) ? step.dependsOn : undefined);
/** A step with an explicit list is a parallel candidate; one without is sequential (the build's own session). */
export const isParallelStep = (step) => explicitAfter(step) !== undefined && normParallel(step?.parallel) !== 'never';

export const PARALLEL_MODES = ['auto', 'never'];
/** `parallel` in shape: 'never' when set so, else undefined (absent = auto; the field is stored only when it says something). */
export const normParallel = (v) => (v === 'never' ? 'never' : undefined);

/** The step ids `step` really waits on: its explicit list, or the previous step in the build when it has none. */
export function dependsOn(b, step) {
  const steps = b?.steps ?? [];
  const ex = explicitAfter(step);
  if (ex) return ex.filter((id) => id !== step.id && steps.some((s) => s.id === id));
  const i = steps.findIndex((s) => s === step || (step?.uid && s.uid === step.uid) || s.id === step?.id);
  return i > 0 ? [steps[i - 1].id] : [];
}

/** The files a step touches, in shape (its `files` list; '' entries dropped). */
export const stepFiles = (step) => (Array.isArray(step?.files) ? step.files.map((f) => str(f, 300).trim()).filter(Boolean) : []);

/**
 * Steps `step` may not run beside: open steps of the same build that touch one of its files and are running now
 * (a live claim at `now`), or any step in `against` (the planner passes the step the build's own session is on, and
 * steps of other builds). [{ step: id, files: [shared…] }]; [] = no clash. A step with no files never clashes.
 */
export function fileClashes(b, step, { now = Date.now(), against = null } = {}) {
  const mine = new Set(stepFiles(step));
  if (!mine.size) return [];
  const others = against ? list(against) : (b?.steps ?? []).filter((s) => s !== step && s.id !== step?.id && !settled(s) && claimLive(s.claim, now));
  return others.map((s) => ({ step: s.id, files: stepFiles(s).filter((f) => mine.has(f)) })).filter((c) => c.files.length);
}
const clashLine = (c) => `files clash with ${c.map((x) => `${x.step} (${x.files.join(', ')})`).join('; ')}`;

/** The branch a step is worked on: the build branch for a sequential step, `<build-branch>--<stepId>` for a parallel one. */
export function stepBranch(b, step, { parallel = false } = {}) {
  const base = str(b?.branch, 200) || `claude/${str(b?.id, 80)}`;
  return parallel ? `${base}--${str(step?.id, 40)}` : base;
}

/** Model rank for the "never higher than pinned" rule: Fable above Opus. */
const MODEL_RANK = Object.freeze({ Opus: 1, Fable: 2 });
const settled = (s) => !!s && (s.done === true || s.skip === true);
const stepOf = (b, stepId) => (b?.steps ?? []).find((s) => s.id === stepId || (stepId && s.uid === stepId)) ?? null;
const nowIso = (now) => (typeof now === 'number' ? new Date(now) : now ? new Date(now) : new Date()).toISOString();
const nowMs = (now) => (typeof now === 'number' ? now : now ? Date.parse(now) : Date.now());

/**
 * The steps a session may start now: open (not done, not skipped), every step they depend on settled (done or skipped;
 * dependsOn() resolves the implicit "previous step" of steps without `after`), no live claim at `now`, and no file in
 * common with a step that is running (live claim) right now (`files: false` skips that rule). `model` narrows to steps
 * pinned to that model. In list order, so the first ready step is the one the sequential rule picks.
 */
export function readySteps(b, { now = Date.now(), model = '', files = true } = {}) {
  const steps = b?.steps ?? [];
  return steps.filter((s) => !settled(s) && (!model || s.model === model) && !claimLive(s.claim, now)
    && dependsOn(b, s).every((id) => settled(steps.find((x) => x.id === id)))
    && (!files || !fileClashes(b, s, { now }).length));
}

/** Steps whose claim has run out at `now` (a session that died without releasing): [{ step, claim }]. */
export const expiredClaims = (b, now = Date.now()) => (b?.steps ?? []).filter((s) => s.claim?.runId && !settled(s) && !claimLive(s.claim, now)).map((s) => ({ step: s, claim: s.claim }));

/**
 * Take a step for a session. Pure: returns { ok, build, claim, step } with a new build record, or { ok: false, why }.
 * Refused when the step is missing, settled, not ready (a dependency open), held by another live claim (the same
 * runId renews its own), or when `model` ranks above the step's pinned model (never launch a step higher than it is
 * pinned: raise the step first). A lower model is a downgrade and allowed; the claim records the model it runs on.
 */
export function claimStep(b, stepId, { runId, slot = '', account = '', branch = '', model = '', now = Date.now(), ttlMs = CLAIM_TTL_MS } = {}) {
  const s = stepOf(b, stepId);
  if (!s) return { ok: false, why: `no step ${stepId}` };
  if (!str(runId, 80).trim()) return { ok: false, why: 'a claim needs a runId' };
  if (settled(s)) return { ok: false, why: `${s.id} is ${s.done ? 'done' : 'skipped'}` };
  const open = dependsOn(b, s).filter((id) => !settled((b.steps ?? []).find((x) => x.id === id)));
  if (open.length) return { ok: false, why: `${s.id} waits on ${open.join(', ')}` };
  if (claimLive(s.claim, now) && s.claim.runId !== str(runId, 80).trim()) return { ok: false, why: `${s.id} is claimed by run ${s.claim.runId}${s.claim.account ? ` on ${s.claim.account}` : ''} until ${s.claim.expiresAt}` };
  const clash = fileClashes(b, s, { now }).filter((c) => stepOf(b, c.step)?.claim?.runId !== str(runId, 80).trim());
  if (clash.length) return { ok: false, why: `${s.id} ${clashLine(clash)}` };
  const m = CLAIM_MODELS.includes(model) ? model : s.model;
  if ((MODEL_RANK[m] ?? 0) > (MODEL_RANK[s.model] ?? 0)) return { ok: false, why: `${s.id} is pinned to ${s.model}: never launched on ${m} (raise the step first)` };
  const at = nowIso(now);
  const claim = normClaim({ runId, slot, account, branch: branch || stepBranch(b, s, { parallel: isParallelStep(s) }), at, model: m, expiresAt: new Date(nowMs(now) + Math.max(60e3, Number(ttlMs) || CLAIM_TTL_MS)).toISOString() }, { model: s.model });
  const build = { ...b, steps: b.steps.map((x) => (x === s ? { ...x, claim, updatedAt: at } : x)), updatedAt: at };
  return { ok: true, build, claim, step: build.steps.find((x) => x.id === s.id) };
}

/**
 * Give a step back (a session ended, a merge conflict, a crash). Pure: { ok, build, released } or { ok: false, why }.
 * With `runId`, only that run's claim is released (another session's claim is left alone); without it, any claim.
 * `note` is appended to the step's note (e.g. "merge conflict: sequential retry").
 */
export function releaseStep(b, stepId, { runId = '', now = Date.now(), note = '' } = {}) {
  const s = stepOf(b, stepId);
  if (!s) return { ok: false, why: `no step ${stepId}` };
  if (!s.claim?.runId) return { ok: true, build: b, released: null };
  if (runId && s.claim.runId !== str(runId, 80).trim()) return { ok: false, why: `${s.id} is claimed by run ${s.claim.runId}, not ${runId}` };
  const at = nowIso(now);
  const next = { ...s, updatedAt: at, ...(note ? { note: `${s.note ? `${s.note}\n` : ''}${str(note, 400)}`.slice(0, 1000) } : {}) };
  delete next.claim;
  return { ok: true, build: { ...b, steps: b.steps.map((x) => (x === s ? next : x)), updatedAt: at }, released: s.claim };
}

// ------------------------------------------------------------------ fill every slot (Nov 13 2026)

export const FILL_DEFAULTS = Object.freeze({
  /** Parallel step sessions one running build may have at once (its main session not counted). */
  maxParallelPerBuild: 3,
  /** Launches one planning round may make, whatever the slots say (a runaway guard). */
  maxLaunchesPerRound: 12,
  /** Split Pending builds that clash with nothing running are queued and launched by the planner (the Claude setting builds.autoQueuePending). */
  autoQueuePending: false,
  /** Subscriptions first, then API accounts when every subscription account is full or out. */
  apiOverflow: true,
  /** Optional budget for API launches this round: { capUsd, spentUsd, perLaunchUsd }; null = no cap here (the account's own caps still hold). */
  budget: null,
});
export const FILL_KINDS = ['step', 'build', 'pending'];
const normFill = (s) => ({ ...FILL_DEFAULTS, ...(s && typeof s === 'object' ? s : {}), budget: s?.budget && typeof s.budget === 'object' ? s.budget : null });
const list = (v) => (Array.isArray(v) ? v : []);
const prioRank = (p) => { const n = parseInt(String(p ?? '').replace(/^P/, ''), 10); return Number.isInteger(n) ? n : 2; };

/**
 * The account that takes one launch on `model`, or null. Accounts are the pipeline's views ({ name, kind, usable, free,
 * running, fable, order, api: { usable } }): subscriptions first (Brett's order, then fewest running, Opus kept off
 * Fable accounts), then API accounts when `route` allows (override 'api', or overflow on). Fable only where fable is true.
 */
export function pickAccount(accounts, model, { route = '', settings = {} } = {}) {
  const needFable = model === 'Fable';
  const byOrder = (a, b) => (a.order == null ? 1 : 0) - (b.order == null ? 1 : 0) || ((a.order ?? 0) - (b.order ?? 0)) || (a.running ?? 0) - (b.running ?? 0);
  const fits = (a) => a && a.free > 0 && (!needFable || a.fable);
  const subs = route === 'api' ? [] : list(accounts).filter((a) => a.kind !== 'api' && a.usable && fits(a)).sort((a, b) => byOrder(a, b) || (needFable ? 0 : (a.fable ? 1 : 0) - (b.fable ? 1 : 0)));
  if (subs[0]) return { account: subs[0], kind: 'subscription', rule: '' };
  const apiOk = route === 'api' || (route !== 'subscription' && normFill(settings).apiOverflow);
  const apis = apiOk ? list(accounts).filter((a) => a.kind === 'api' && (a.api?.usable ?? a.usable) && fits(a)).sort(byOrder) : [];
  return apis[0] ? { account: apis[0], kind: 'api', rule: route === 'api' ? 'override' : 'overflow' } : null;
}

/** Why no account takes `model` now, in one line. */
function noAccountLine(accounts, model) {
  const acc = list(accounts);
  if (!acc.length) return 'no Claude account';
  const able = acc.filter((a) => (a.kind === 'api' ? (a.api?.usable ?? a.usable) : a.usable) && (model !== 'Fable' || a.fable));
  if (!able.length) return model === 'Fable' ? 'no account with Fable' : 'no usable account';
  return `every ${model === 'Fable' ? 'Fable ' : ''}account is full (${able.map((a) => `${a.name} ${a.running ?? 0}/${a.parallel ?? '?'}`).join(', ')})`;
}

/**
 * Fill every free slot (Brett, Nov 13 2026: "Always fill every slot"). Pure. Inputs:
 *   slots     agent-slots status: { free, used, cap, hard: { max, live, free }, memory: { availGb, floorGb } }
 *   accounts  the pipeline's account views (pickAccount)                 settings  FILL_DEFAULTS overrides
 *   running   builds@1 records in Building (running / waiting)          queue     queued builds (any order)
 *   pending   pending builds (used only when settings.autoQueuePending)
 * Order: 1. ready steps of running builds that carry an explicit `after` list and are not `parallel: never` (a step
 * without a list is sequential and belongs to the build's own session, as does the first ready step when no step is
 * claimed yet); a step that shares a file with the session's step or with one launched this round is held back, and a
 * build never has more than its cap (pipeline.maxParallel, else maxParallelPerBuild) of parallel sessions;
 * 2. Queue builds by priority, then queue time; 3. Pending builds when auto-queue is on: split (steps present), by
 * priority then creation time, skipped while a running build is on one of their files. Every launch takes one agent
 * slot and one account slot on the step's / phase's pinned model (Fable only to accounts with Fable). Nothing is launched
 * under the memory floor, over the agent cap or the VPS hard limit, past the API budget cap or past a build's own
 * budget (pipeline.budgetUsd).
 * Returns { launches: [{ kind, id, step, model, account, accountKind, rule, branch, why }], waits: [{ id, step?, why }],
 *           free, blocked } where `blocked` is the one reason nothing more fits ('' when slots simply ran out).
 */
export function planFill({ slots = {}, accounts = [], running = [], queue = [], pending = [], settings = {}, now = Date.now(), priorityOf = (b) => b?.priority || 'P2' } = {}) {
  const st = normFill(settings);
  const acc = list(accounts).map((a) => ({ ...a, free: Math.max(0, Number(a.free) || 0), running: Number(a.running) || 0 }));
  const launches = []; const waits = [];
  let free = Math.max(0, Number(slots?.free) || 0);
  if (slots?.hard?.max) free = Math.min(free, Math.max(0, Number(slots.hard.free) || 0));
  const mem = slots?.memory;
  let blocked = '';
  if (mem && mem.availGb != null && Number(mem.floorGb) > 0 && Number(mem.availGb) < Number(mem.floorGb)) blocked = `memory under the floor (${mem.availGb} GB free, floor ${mem.floorGb} GB)`;
  else if (free <= 0) blocked = slots?.hard?.max && Number(slots.hard.free) <= 0 ? `VPS hard build limit reached (${slots.hard.live ?? '?'}/${slots.hard.max} running)` : `no free agent slot (${slots?.used ?? '?'}/${slots?.cap ?? '?'} in use)`;
  let apiSpent = Number(st.budget?.spentUsd) || 0;
  const perLaunch = Number(st.budget?.perLaunchUsd) || 0;
  const buildSpent = new Map(); // build id → API spend counted this round on top of pipeline.spentUsd
  const take = (model, b, item) => {
    const route = b?.pipeline?.route || '';
    if (blocked) { waits.push({ ...item, why: blocked }); return false; }
    if (launches.length >= st.maxLaunchesPerRound) { waits.push({ ...item, why: `round limit of ${st.maxLaunchesPerRound} launches reached` }); return false; }
    const pick = pickAccount(acc, model, { route, settings: st });
    if (!pick) { waits.push({ ...item, why: noAccountLine(acc, model) }); return false; }
    if (pick.kind === 'api' && st.budget && Number(st.budget.capUsd) > 0 && apiSpent + perLaunch > Number(st.budget.capUsd)) { waits.push({ ...item, why: `API budget cap reached ($${apiSpent.toFixed(2)} of $${Number(st.budget.capUsd).toFixed(2)})` }); return false; }
    const cap = usd(b?.pipeline?.budgetUsd); const spent = usd(b?.pipeline?.spentUsd) + (buildSpent.get(b?.id) ?? 0);
    if (pick.kind === 'api' && cap > 0 && spent + perLaunch > cap) { waits.push({ ...item, why: `build budget cap reached ($${spent.toFixed(2)} of $${cap.toFixed(2)})` }); return false; }
    if (pick.kind === 'api') { apiSpent += perLaunch; buildSpent.set(b?.id, (buildSpent.get(b?.id) ?? 0) + perLaunch); }
    pick.account.free -= 1; pick.account.running += 1; free -= 1;
    if (free <= 0) blocked = 'every agent slot is filled';
    launches.push({ ...item, model, account: pick.account.name, accountKind: pick.kind, rule: pick.rule });
    return true;
  };
  // files other builds are on right now: every open step of a running build (and of each build launched this round)
  const busy = new Map(); // file → build id
  const occupy = (b) => { for (const s of openSteps(b)) for (const f of stepFiles(s)) if (!busy.has(f)) busy.set(f, b.id); };
  const live = list(running).filter((b) => b && !b.deleted && (b.status === 'running' || b.status === 'waiting'));
  for (const b of live) occupy(b);
  // 1. parallel-ready steps of running builds
  for (const b of live) {
    const ready = readySteps(b, { now });
    const claimed = (b.steps ?? []).filter((s) => claimLive(s.claim, now)).length;
    const mainTaken = claimed > 0 ? 0 : 1; // no claim anywhere: the build's own session is on the first ready step
    const parallel = ready.filter((s, i) => isParallelStep(s) && !(mainTaken && i === 0));
    const beside = mainTaken && ready[0] ? [ready[0]] : []; // steps started this round: no file of theirs may be touched twice
    const liveParallel = Math.max(0, claimed - 1); // one live claim is the build's own session
    const cap = b.pipeline?.maxParallel > 0 ? b.pipeline.maxParallel : st.maxParallelPerBuild;
    let room = Math.max(0, cap - liveParallel);
    for (const s of parallel) {
      const clash = fileClashes(b, s, { now, against: beside });
      if (clash.length) { waits.push({ id: b.id, step: s.id, why: clashLine(clash) }); continue; }
      if (room <= 0) { waits.push({ id: b.id, step: s.id, why: `build at its parallel cap (${cap})` }); continue; }
      if (take(s.model, b, { kind: 'step', id: b.id, step: s.id, branch: stepBranch(b, s, { parallel: true }), why: `ready step of a running build: ${dependsOn(b, s).length ? `after ${dependsOn(b, s).join(', ')}` : 'independent'}` })) { room -= 1; beside.push(s); }
    }
  }
  // 2. the Queue, by priority then queue time
  const q = queueOrder(list(queue).filter((b) => b && !b.deleted), priorityOf);
  for (const b of q) {
    if (isHeld(b)) { waits.push({ id: b.id, why: `on hold${b.pipeline?.heldBy ? ` (${b.pipeline.heldBy})` : ''}` }); continue; }
    if (!openSteps(b).length) { waits.push({ id: b.id, why: b.steps?.length ? 'every step is done' : 'no steps yet: waiting for the split' }); continue; }
    if (take(nextModel(b), b, { kind: 'build', id: b.id, step: readySteps(b, { now })[0]?.id ?? openSteps(b)[0].id, branch: stepBranch(b, null), why: `next in the Queue (${priorityOf(b)})` })) occupy(b);
  }
  // 3. Pending, only when auto-queue is on: split builds whose files no running build is on
  if (st.autoQueuePending) {
    const p = list(pending).filter((b) => b && !b.deleted && !b.hidden && b.status === 'pending')
      .sort((a, b) => prioRank(priorityOf(a)) - prioRank(priorityOf(b)) || str(a.createdAt).localeCompare(str(b.createdAt)));
    for (const b of p) {
      if (!openSteps(b).length) { waits.push({ id: b.id, why: b.steps?.length ? 'every step is done' : 'no steps yet: waiting for the split' }); continue; }
      const shared = [...new Set(openSteps(b).flatMap(stepFiles))].filter((f) => busy.has(f));
      if (shared.length) { waits.push({ id: b.id, why: `files clash with running build ${busy.get(shared[0])} (${shared.join(', ')})` }); continue; }
      if (take(nextModel(b), b, { kind: 'pending', id: b.id, step: readySteps(b, { now })[0]?.id ?? openSteps(b)[0].id, branch: stepBranch(b, null), why: `auto-queue: Pending build taken (${priorityOf(b)})` })) occupy(b);
    }
  } else if (list(pending).length && !blocked && free > 0) blocked = `${list(pending).length} Pending build${list(pending).length === 1 ? '' : 's'} wait for Brett (auto-queue is off)`;
  return { launches, waits, free, blocked, at: nowIso(now) };
}

/** The steps still to do (not done, not skipped). */
export const openSteps = (b) => (b?.steps ?? []).filter((s) => !s.done && !s.skip);
/** The model the next open step runs on ('' when nothing is left). */
export const nextModel = (b) => openSteps(b)[0]?.model ?? '';

/**
 * The exit transition: what a run's end means for the build, pure. In:
 *   exit            the session's exit code (0 = clean; anything else or null = crash, usage limit, killed)
 *   stepsLeft       open steps after the run
 *   crashes         failed exits before this one (pipeline.crashes); when absent, runs - 1 stands in for it
 *   runs            how many sessions have run the build, this one included
 *   phaseDone       the phase the run was launched for is done (its steps ticked), whatever the models involved
 *   upgradeBlocked  the next phase is an upgrade Brett has not approved while "Fable upgrades need my approval" is on
 *   needsBrett      the session said it needs Brett (a question, UI Review wait, a build left waiting)
 * Out: { status, outcome, reason, crashes, keepQueue }. `keepQueue` = the build stays in the Queue at its position.
 *   all-done         nothing left                         → landing  (done-means-merged@1: the auto-lander lands it; landed
 *                                                                     once merged with CI green, complete once verified)
 *   crash            a failed exit, crashes under maxRuns → queued   the Queue takes it again
 *   crash-limit      a failed exit, crashes at maxRuns    → pending  Brett decides (Errors tab)
 *   upgrade-blocked  clean exit, next phase needs Brett   → pending
 *   needs-brett      clean exit, the session asked        → pending
 *   phase-done       clean exit, its phase done           → queued   the next phase launches by itself; not a crash
 *   stopped          clean exit mid-phase                 → pending  a question, UI Review, a step marked for a new session
 */
export function nextStatusOnExit(run, maxRuns = DEFAULT_MAX_RUNS) {
  const r = run && typeof run === 'object' ? run : {};
  const exit = Number.isInteger(r.exit) ? r.exit : null;
  const stepsLeft = Math.max(0, Number(r.stepsLeft) || 0);
  const runs = Math.max(1, Number(r.runs) || 1);
  const before = Number.isInteger(r.crashes) && r.crashes >= 0 ? r.crashes : runs - 1;
  const clean = exit === 0;
  const crashes = clean ? before : before + 1;
  const max = Number.isInteger(maxRuns) && maxRuns > 0 ? maxRuns : DEFAULT_MAX_RUNS;
  const out = (status, outcome, reason) => ({ status, outcome, reason, crashes, keepQueue: status === 'queued' });
  if (!stepsLeft) return out('landing', 'finished', 'all-done');
  if (!clean) return crashes >= max ? out('pending', 'failed', 'crash-limit') : out('queued', 'requeued', 'crash');
  if (r.upgradeBlocked) return out('pending', 'returned', 'upgrade-blocked');
  if (r.needsBrett) return out('pending', 'returned', 'needs-brett');
  if (r.phaseDone) return out('queued', 'requeued', 'phase-done');
  return out('pending', 'returned', 'stopped');
}

/** The outcome alone (older callers). `phaseSwitch` is the phase-done signal. */
export function outcomeOf({ exit, stepsLeft, runs, crashes, phaseSwitch = false }, maxRuns = DEFAULT_MAX_RUNS) {
  return nextStatusOnExit({ exit, stepsLeft, runs, crashes, phaseDone: phaseSwitch }, maxRuns).outcome;
}
/** Status per outcome when no reason is at hand: the crash limit sends a build back to Pending, never off the table. */
export const STATUS_AFTER = Object.freeze({ finished: 'landing', requeued: 'queued', returned: 'pending', failed: 'pending' });

/** One plain line about a run's end, for the build's notes and the phone. */
export function outcomeLine(b, run) {
  const left = run.stepsLeft ? `${run.stepsLeft} step${run.stepsLeft === 1 ? '' : 's'} left` : 'every step done';
  const where = run.account ? ` on ${run.account}` : '';
  const runs = b.pipeline?.runs ?? 1;
  const phase = run.phase ? `phase ${run.phase}` : 'its phase';
  const next = nextModel(b);
  switch (run.outcome) {
    case 'finished': return `Session ${run.session || ''}${where} finished: ${left}.`.replace('  ', ' ');
    case 'requeued':
      if (run.reason === 'phase-done') return `Session${where} finished ${phase} with ${left}: back in the Queue at its place, the next phase${next ? ` (${next})` : ''} starts by itself.`;
      return `Session${where} ended (exit ${run.exit}) with ${left}: back in the Queue (run ${runs}).`;
    case 'returned':
      if (run.reason === 'upgrade-blocked') return `Session${where} finished ${phase} with ${left}: the next phase upgrades to ${next || 'a higher model'} and needs Brett's approval (Fable upgrades need my approval is on): back in Pending.`;
      if (run.reason === 'needs-brett') return `Session${where} stopped with ${left} and needs Brett: back in Pending.`;
      return `Session${where} stopped on its own with ${left}: back in Pending for Brett.`;
    default: return `Session${where} ended (exit ${run.exit}) with ${left} after ${b.pipeline?.runs ?? 0} runs: crash limit reached, failed: back in Pending for Brett.`;
  }
}

// ------------------------------------------------------------------ the single-Queued contract (Nov 28 2026)

/**
 * One build in the Queue (Brett, Nov 25 2026: "Plan Studio sends to Pending; only one build Queued; when it goes live
 * the next Pending moves up" and "Hold, cancel, unqueue really stick"). Pure, IO-free; every call returns new records.
 *
 * The rules:
 *   1. At most QUEUE_MAX (1) build is in status `queued`. Everything Plan Studio sends lands in Pending.
 *   2. Pending is a line. promote() moves the oldest build in it (pendingOrder) up to `queued` whenever the slot is
 *      free. The slot frees the moment the queued build goes live (goLive(): queued → running), or leaves any other way.
 *   3. A build that comes back to the Queue by itself (nextStatusOnExit: phase-done, crash) may meet the build that was
 *      promoted behind it. settleQueue() keeps one: the build that has run before wins (its next phase starts at once),
 *      then the oldest queuedAt; the others go back to Pending, unmarked, and move up again in their turn.
 *   4. hold, cancel and unqueue are STOPS: terminal until Brett. Each one puts the build in Pending with a `stop`
 *      record on its pipeline ({ kind, at, by, why, from }). A stopped build is never promoted, never launched and never
 *      given another status by the dispatcher, the reconciler, the watchdog or a run's exit: keepStop() is the one gate
 *      every automated writer passes its record through, and it puts the stop back. Only an owner actor (isOwnerActor:
 *      Brett, or a surface acting on his word) reverses one, through release() or queue().
 *        hold      the build waits in Pending and keeps its place in line: released, a build held out of the Queue
 *                  is at the head of the line again
 *        unqueue   the build left the Queue for Pending; it goes back up only when Brett queues it
 *        cancel    the build's session is to be killed and its slot freed (the caller does that with `kill`); every
 *                  step claim is dropped; it runs again only when Brett queues it
 *      A legacy hold (pipeline.heldAt on a queued build, no stop record) is read as a hold stop; settleQueue() moves
 *      it out of the slot so a held build never blocks the line.
 *
 * Every action returns { ok, why, builds, build, changes } (changes = [{ id, from, to, why }]) and never throws; on a
 * refusal `builds` is the list it was given. Fixture: framework/spec/fixtures/build-pipeline.json.
 */
export const QUEUE_MAX = 1;
export const STOP_KINDS = Object.freeze(['hold', 'cancel', 'unqueue']);
export const STOP_LABEL = Object.freeze({ hold: 'On hold', cancel: 'Cancelled', unqueue: 'Back in Pending' });
/** Actors that act on Brett's word. `brett:<surface>` (brett:mcp, brett:cli …) counts too; every other actor is automation. */
export const OWNER_ACTORS = Object.freeze(['brett', 'console', 'voice', 'amberx', 'phone']);
/** The actors named in the code today that never reverse a stop (documentation: anything not an owner is automation). */
export const AUTOMATION_ACTORS = Object.freeze(['dispatcher', 'reconciler', 'watchdog', 'lander', 'pipeline', 'orchestrator', 'tick', 'reaper', 'builds-live', 'vps', 'session', 'auto']);
export const isOwnerActor = (by) => { const s = str(by, 80).trim().toLowerCase(); return OWNER_ACTORS.includes(s) || /^brett:[a-z0-9-]+$/.test(s); };
/** Statuses a stop may be put on: cancel reaches every build that is not finished; hold and unqueue only waiting ones. */
export const STOPPABLE = Object.freeze({ hold: ['pending', 'queued'], unqueue: ['queued'], cancel: ['pending', 'queued', 'running', 'waiting', 'fixing', 'blocked', 'failed', 'landing', 'escalated'] });
/** What the orchestrator's main view lists: sent builds (out of Pending) plus landed ones. Pending has its own tab. */
export const SENT_STATUSES = Object.freeze(['queued', 'running', 'waiting', 'fixing', 'built', 'landing']);
export const isSent = (b) => !!b && !b.deleted && !b.hidden && SENT_STATUSES.includes(b.status);
export const showsInOrchestrator = (b) => isSent(b) || (!!b && !b.deleted && !b.hidden && b.status === 'landed');

/** A stop record in shape, or null. */
export function normStop(s) {
  const x = obj(s);
  if (!x || !STOP_KINDS.includes(x.kind) || !iso(x.at)) return null;
  return { kind: x.kind, at: iso(x.at), by: str(x.by, 80), why: str(x.why, 300), from: str(x.from, 20) };
}
/** The stop standing on a build, or null. A legacy hold (heldAt, no stop record) reads as a hold. */
export function stopOf(b) {
  const p = obj(b?.pipeline);
  if (!p || b.deleted) return null;
  return normStop(p.stop) ?? (iso(p.heldAt) && (b.status === 'queued' || b.status === 'pending') ? { kind: 'hold', at: iso(p.heldAt), by: str(p.heldBy, 80), why: str(p.heldWhy, 300), from: str(b.status, 20) } : null);
}
export const isStopped = (b) => !!stopOf(b);

const live1 = (b) => !!b && !b.deleted;
/** Builds in status queued (deleted ones never count). */
export const queuedBuilds = (builds) => list(builds).filter((b) => live1(b) && b.status === 'queued');
/** The builds holding the Queue slot: queued and not stopped. A sound store has at most QUEUE_MAX. */
export const slotHolders = (builds) => queuedBuilds(builds).filter((b) => !isStopped(b));
/** The one queued build, or null. */
export const queuedOne = (builds) => slotHolders(builds)[0] ?? null;
/** Is the Queue slot free? */
export const slotFree = (builds) => slotHolders(builds).length < QUEUE_MAX;

/**
 * A build's place in line. One that reached the Queue before (lineAt: the moment it was first queued) was at the head
 * of the line already, so it stands before every build that never got that far; among those, the earliest lineAt.
 * The rest line up by the time they were filed.
 */
const lineAt = (b) => iso(b?.pipeline?.lineAt);
const lineCmp = (a, b) => (lineAt(a) ? 0 : 1) - (lineAt(b) ? 0 : 1) || (Date.parse(lineAt(a)) || 0) - (Date.parse(lineAt(b)) || 0)
  || str(a.createdAt, 40).localeCompare(str(b.createdAt, 40)) || str(a.id, 200).localeCompare(str(b.id, 200));
/**
 * May promote() move this Pending build up? { ok, why }. Not when it is stopped, hidden, deleted, unsplit or finished,
 * and not when it is in Pending because a run sent it there for Brett (nextStatusOnExit: crash-limit, upgrade-blocked,
 * needs-brett, stopped): those wait for him to queue them.
 */
export function promotable(b) {
  if (!b || b.deleted || b.hidden) return { ok: false, why: 'not in Pending' };
  if (b.status !== 'pending') return { ok: false, why: `status is ${str(b.status, 20) || 'unknown'}, not pending` };
  const stop = stopOf(b);
  if (stop) return { ok: false, why: `${STOP_LABEL[stop.kind]}${stop.by ? ` (${stop.by})` : ''}: waits for Brett` };
  if (!(b.steps ?? []).length) return { ok: false, why: 'no steps yet: waiting for the split' };
  if (!openSteps(b).length) return { ok: false, why: 'every step is done' };
  const lr = b.pipeline?.lastRun;
  if (lr && (lr.outcome === 'returned' || lr.outcome === 'failed')) return { ok: false, why: `its last run sent it back for Brett (${lr.reason || lr.outcome})` };
  return { ok: true, why: '' };
}
/** The Pending line in promotion order: oldest first (line place, then filed time, then id). Only promotable builds. */
export function pendingOrder(builds) {
  return list(builds).filter((b) => promotable(b).ok).sort(lineCmp);
}

const refuse = (builds, why) => ({ ok: false, why, builds: list(builds), build: null, changes: [] });
const findBuild = (builds, id) => list(builds).find((b) => b && b.id === id) ?? null;
const swap = (builds, next) => list(builds).map((b) => (b && b.id === next.id ? next : b));
const withPipe = (b, patch, extra = {}) => {
  const p = { ...emptyPipeline(), ...(obj(b.pipeline) ?? {}), ...patch };
  for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
  return { ...b, ...extra, pipeline: p };
};
const unheld = { heldAt: '', heldBy: '', heldWhy: '' };

/** Pending → queued, shared by queue() and promote(): the build keeps its first place in line (lineAt). */
const toQueued = (b, { by, at, note }) => withPipe(b, { queuedAt: at, queuedBy: str(by, 80), lineAt: iso(b.pipeline?.lineAt) || at, stop: undefined, ...unheld, note }, { status: 'queued', updatedAt: at });

/**
 * Check the invariant, pure: { ok, queued: [ids], why }. ok = at most QUEUE_MAX builds hold the slot and no stopped
 * build sits in status queued.
 */
export function checkQueue(builds) {
  const q = queuedBuilds(builds); const held = q.filter(isStopped); const slot = q.filter((b) => !isStopped(b));
  const why = slot.length > QUEUE_MAX ? `${slot.length} builds are queued (${slot.map((b) => b.id).join(', ')}): one at a time` : held.length ? `${held.map((b) => b.id).join(', ')} ${held.length === 1 ? 'is' : 'are'} stopped but still queued` : '';
  return { ok: !why, queued: q.map((b) => b.id), why };
}

/**
 * Put a Pending build in the Queue by name. Refused while another build holds the slot (it stays in Pending and moves
 * up by itself), and refused to automation when the build is stopped. An owner's queue() lifts the stop.
 */
export function queue(builds, id, { by = '', now = Date.now() } = {}) {
  const b = findBuild(builds, id);
  if (!b || b.deleted) return refuse(builds, `no build ${id}`);
  if (b.status === 'queued' && !isStopped(b)) return { ok: true, why: 'already queued', builds: list(builds), build: b, changes: [] };
  if (b.status !== 'pending' && !(b.status === 'queued' && isStopped(b))) return refuse(builds, `${id} is ${b.status}: only a Pending build can be queued`);
  if (b.hidden) return refuse(builds, `${id} is hidden`);
  const stop = stopOf(b);
  if (stop && !isOwnerActor(by)) return refuse(builds, `${id} is ${STOP_LABEL[stop.kind].toLowerCase()}${stop.by ? ` (${stop.by})` : ''}: only Brett queues it again`);
  const holder = slotHolders(builds).find((x) => x.id !== id);
  if (holder) return refuse(builds, `${holder.id} is already queued: one build in the Queue at a time. ${id} stays in Pending and moves up by itself when ${holder.id} goes live.`);
  const at = nowIso(now);
  const next = toQueued(b, { by, at, note: `Queued (${str(by, 80) || 'unknown'}).` });
  return { ok: true, why: '', builds: swap(builds, next), build: next, changes: [{ id, from: b.status, to: 'queued', why: stop ? `queued by ${by}: ${stop.kind} lifted` : `queued by ${by || 'unknown'}` }] };
}

/**
 * Move the oldest Pending build up when the slot is free. { ok, builds, build, promoted: id | '', why, changes }.
 * Nothing to do (slot taken, empty line) is ok with promoted ''. Never picks a stopped build.
 */
export function promote(builds, { by = 'dispatcher', now = Date.now() } = {}) {
  const holder = queuedOne(builds);
  if (holder) return { ok: true, why: `${holder.id} is queued`, builds: list(builds), build: null, promoted: '', changes: [] };
  const b = pendingOrder(builds)[0];
  if (!b) return { ok: true, why: 'nothing in Pending can move up', builds: list(builds), build: null, promoted: '', changes: [] };
  const at = nowIso(now);
  const next = toQueued(b, { by, at, note: 'Moved up from Pending: the Queue was free.' });
  return { ok: true, why: '', builds: swap(builds, next), build: next, promoted: b.id, changes: [{ id: b.id, from: 'pending', to: 'queued', why: 'oldest in Pending, the Queue was free' }] };
}

/**
 * The queued build goes live: queued → running, and the next Pending build moves up behind it. The dispatcher writes
 * its launch fields (account, session, slot …) on the returned record. Refused for a stopped build or one not queued.
 */
export function goLive(builds, id, { by = 'dispatcher', now = Date.now() } = {}) {
  const b = findBuild(builds, id);
  if (!b || b.deleted) return refuse(builds, `no build ${id}`);
  const stop = stopOf(b);
  if (stop) return refuse(builds, `${id} is ${STOP_LABEL[stop.kind].toLowerCase()}: it is not launched until Brett says so`);
  if (b.status !== 'queued') return refuse(builds, `${id} is ${b.status}: only the queued build goes live`);
  const at = nowIso(now);
  const live = { ...b, status: 'running', updatedAt: at };
  const p = promote(swap(builds, live), { by, now });
  return { ok: true, why: '', builds: p.builds, build: live, promoted: p.promoted, changes: [{ id, from: 'queued', to: 'running', why: 'went live' }, ...p.changes] };
}

/**
 * Put a stop on a build (hold | cancel | unqueue). Anyone may stop a build; only an owner lifts it. The build goes to
 * Pending with `pipeline.stop`; the slot it held is free and, unless `promote: false`, the next Pending build moves up.
 * cancel also returns `kill: { session, slot, account, claims: [{ step, runId, slot, account }] }`: what the caller
 * must kill and free (the tmux session, the agent slot, each parallel step session); the record no longer points at them.
 */
export function stop(builds, id, kind, { by = '', why = '', now = Date.now(), promote: moveUp = true } = {}) {
  if (!STOP_KINDS.includes(kind)) return refuse(builds, `unknown stop ${kind}`);
  const b = findBuild(builds, id);
  if (!b || b.deleted) return refuse(builds, `no build ${id}`);
  const cur = stopOf(b);
  if (cur && cur.kind === kind && normStop(b.pipeline?.stop) && b.status === 'pending') return { ok: true, why: `already ${STOP_LABEL[kind].toLowerCase()}`, builds: list(builds), build: b, changes: [], kill: null };
  if (cur?.kind === 'cancel' && kind !== 'cancel') return refuse(builds, `${id} is cancelled: queue it again first`);
  if (!STOPPABLE[kind].includes(b.status)) return refuse(builds, `${id} is ${b.status}: ${kind} applies to ${STOPPABLE[kind].join(', ')} builds`);
  const at = nowIso(now);
  const rec = { kind, at, by: str(by, 80), why: str(why, 300), from: str(b.status, 20) };
  const tail = rec.why ? `: ${rec.why}` : '';
  const held = kind === 'hold' ? { heldAt: at, heldBy: rec.by, heldWhy: rec.why } : unheld;
  const p = obj(b.pipeline) ?? {};
  let next; let kill = null;
  if (kind === 'cancel') {
    const claims = (b.steps ?? []).filter((s) => s.claim?.runId).map((s) => ({ step: s.id, runId: str(s.claim.runId, 80), slot: str(s.claim.slot, 60), account: accountName(s.claim.account) }));
    kill = { session: str(p.session, 120), slot: str(p.slot, 60), account: accountName(p.account), claims };
    const steps = (b.steps ?? []).map((s) => { if (!s.claim) return s; const x = { ...s }; delete x.claim; return x; });
    next = withPipe(b, { stop: rec, ...held, queuedAt: '', queuedBy: '', session: '', slot: '', dispatchedAt: '', note: `Cancelled (${rec.by || 'unknown'})${tail}. It runs again only when Brett queues it.` }, { status: 'pending', updatedAt: at, ...(b.steps ? { steps } : {}) });
  } else if (kind === 'hold') {
    next = withPipe(b, { stop: rec, ...held, ...(iso(p.lineAt) || iso(p.queuedAt) ? { lineAt: iso(p.lineAt) || iso(p.queuedAt) } : {}), queuedAt: '', queuedBy: '', note: `On hold (${rec.by || 'unknown'})${tail}. It keeps its place in line and waits until Brett releases it.` }, { status: 'pending', updatedAt: at });
  } else {
    next = withPipe(b, { stop: rec, ...held, queuedAt: '', queuedBy: '', note: `Back to Pending (${rec.by || 'unknown'})${tail}. It moves up only when Brett queues it.` }, { status: 'pending', updatedAt: at });
  }
  let out = swap(builds, next);
  const changes = [{ id, from: b.status, to: 'pending', why: `${kind}${rec.by ? ` by ${rec.by}` : ''}` }];
  let promoted = '';
  if (moveUp) { const pr = promote(out, { now }); out = pr.builds; promoted = pr.promoted; changes.push(...pr.changes); }
  return { ok: true, why: '', builds: out, build: next, changes, kill, promoted };
}
export const hold = (builds, id, opts) => stop(builds, id, 'hold', opts);
export const cancel = (builds, id, opts) => stop(builds, id, 'cancel', opts);
export const unqueue = (builds, id, opts) => stop(builds, id, 'unqueue', opts);

/**
 * Lift a stop: owners only. The build is back in the Pending line, unmarked: a build that had reached the Queue keeps
 * its place at the head of the line (lineAt), any other lines up by its filed time. It takes the slot at once when it is free.
 */
export function release(builds, id, { by = '', now = Date.now(), promote: moveUp = true } = {}) {
  const b = findBuild(builds, id);
  if (!b || b.deleted) return refuse(builds, `no build ${id}`);
  const cur = stopOf(b);
  if (!cur) return { ok: true, why: 'not stopped', builds: list(builds), build: b, changes: [], promoted: '' };
  if (!isOwnerActor(by)) return refuse(builds, `${id} is ${STOP_LABEL[cur.kind].toLowerCase()}${cur.by ? ` (${cur.by})` : ''}: only Brett releases it, not ${str(by, 80) || 'an unnamed actor'}`);
  const at = nowIso(now);
  const next = withPipe(b, { stop: undefined, ...unheld, queuedAt: '', queuedBy: '', note: `Released (${by}): back in line in Pending.` }, { status: 'pending', updatedAt: at });
  let out = swap(builds, next);
  const changes = [{ id, from: b.status, to: 'pending', why: `${cur.kind} lifted by ${by}` }];
  let promoted = '';
  if (moveUp) { const pr = promote(out, { now }); out = pr.builds; promoted = pr.promoted; changes.push(...pr.changes); }
  return { ok: true, why: '', builds: out, build: findBuild(out, id), changes, promoted };
}

/**
 * The gate every automated writer passes a record through before it stores it (the dispatcher's tick, a run's exit,
 * the reconciler, the watchdog, a stale export): `prev` is the stored record, `next` the one about to be written.
 * When `prev` carries a stop and `by` is not an owner, the stop wins: status, the stop record, the hold fields and the
 * cleared launch fields come back from `prev`; everything else in `next` (steps ticked, notes, PR, lastRun) is kept.
 * { build, kept, why }: kept = the write tried to undo a stop and was corrected.
 */
export function keepStop(prev, next, { by = '' } = {}) {
  const cur = stopOf(prev);
  if (!cur || !next || isOwnerActor(by)) return { build: next, kept: false, why: '' };
  const pp = obj(prev.pipeline) ?? {}; const np = obj(next.pipeline) ?? {};
  const same = next.status === prev.status && JSON.stringify(normStop(np.stop)) === JSON.stringify(normStop(pp.stop)) && iso(np.heldAt) === iso(pp.heldAt)
    && !iso(np.queuedAt) && str(np.session) === str(pp.session) && str(np.slot) === str(pp.slot);
  if (same) return { build: next, kept: false, why: '' };
  const pipeline = { ...np, stop: pp.stop, heldAt: pp.heldAt ?? '', heldBy: pp.heldBy ?? '', heldWhy: pp.heldWhy ?? '', queuedAt: pp.queuedAt ?? '', queuedBy: pp.queuedBy ?? '', session: pp.session ?? '', slot: pp.slot ?? '', dispatchedAt: pp.dispatchedAt ?? '' };
  if (pipeline.stop === undefined) delete pipeline.stop;
  const steps = cur.kind === 'cancel' && Array.isArray(next.steps) ? next.steps.map((s) => { if (!s?.claim) return s; const x = { ...s }; delete x.claim; return x; }) : next.steps;
  const build = { ...next, status: prev.status, pipeline, ...(steps ? { steps } : {}) };
  return { build, kept: true, why: `${prev.id ?? 'build'} is ${STOP_LABEL[cur.kind].toLowerCase()}${cur.by ? ` (${cur.by})` : ''}: ${str(by, 80) || 'automation'} may not move it${next.status !== prev.status ? ` to ${next.status}` : ''}` };
}

/**
 * The reconcile pass over a set of builds, pure and idempotent: the one place the invariant is restored.
 *   1. a stopped build still in status queued (a legacy hold) → Pending, its stop kept
 *   2. more than QUEUE_MAX slot holders → one stays (has run before, then oldest queuedAt, then filed time, then id),
 *      the rest → Pending, unmarked, their place in line kept
 *   3. the slot free → promote()
 * A stopped build is never given a new status here. { builds, changes, queued: id | '', ok: true }.
 */
export function settleQueue(builds, { by = 'reconciler', now = Date.now() } = {}) {
  const at = nowIso(now);
  const changes = [];
  let out = list(builds).map((b) => {
    if (!live1(b) || b.status !== 'queued') return b;
    const cur = stopOf(b);
    if (!cur) return b;
    changes.push({ id: b.id, from: 'queued', to: 'pending', why: `${cur.kind} stands: out of the Queue slot` });
    const p = obj(b.pipeline) ?? {};
    return withPipe(b, { stop: normStop(p.stop) ?? { ...cur, from: 'queued' }, lineAt: iso(p.lineAt) || iso(p.queuedAt) || at, queuedAt: '', queuedBy: '' }, { status: 'pending', updatedAt: at });
  });
  const ran = (b) => ((Number(b.pipeline?.runs) || 0) > 0 || !!b.pipeline?.lastRun ? 0 : 1);
  const holders = slotHolders(out).sort((a, b) => ran(a) - ran(b) || str(a.pipeline?.queuedAt, 40).localeCompare(str(b.pipeline?.queuedAt, 40)) || str(a.createdAt, 40).localeCompare(str(b.createdAt, 40)) || str(a.id, 200).localeCompare(str(b.id, 200)));
  const keep = holders.slice(0, QUEUE_MAX); const extra = new Set(holders.slice(QUEUE_MAX).map((b) => b.id));
  if (extra.size) {
    out = out.map((b) => {
      if (!b || !extra.has(b.id) || b.status !== 'queued' || b.deleted) return b;
      changes.push({ id: b.id, from: 'queued', to: 'pending', why: `${keep[0].id} holds the Queue: one at a time` });
      const p = obj(b.pipeline) ?? {};
      return withPipe(b, { lineAt: iso(p.lineAt) || iso(p.queuedAt) || at, queuedAt: '', queuedBy: '', note: `Back in line in Pending: ${keep[0].id} holds the Queue. It moves up by itself.` }, { status: 'pending', updatedAt: at });
    });
  }
  const pr = promote(out, { by, now });
  changes.push(...pr.changes);
  return { ok: true, builds: pr.builds, changes, queued: queuedOne(pr.builds)?.id ?? '' };
}

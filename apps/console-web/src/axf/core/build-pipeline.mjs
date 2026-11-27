/**
 * build-pipeline@1 — the pipeline record on a builds@1 build and the three table states (pure, IO-free).
 *
 * Brett, Nov 8 2026 ("You need to start the pipeline over from scratch"): everything he asks for becomes a build in the
 * orchestrator, which assigns the id, splits it into steps (≤ 10 min, checkpoints inside one session; Fable only where needed) and puts it in
 * **Pending**. He moves builds from Pending to the **Queue**. A dispatcher on the VPS watches the connected Claude
 * accounts (which have Fable, how many may run in parallel) and the agent slots; when a slot is free it takes the next
 * Queue build and starts a headless session on an account that can run the next phase's model (**Building**).
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
 *
 * The orchestrator's tabs (Brett, Nov 10 2026: "Tabs: pending, active, incomplete, complete, errors, queue"): tabOf().
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
  return { queuedAt: '', queuedBy: '', account: '', session: '', slot: '', model: '', phase: '', launchedAt: '', runs: 0, crashes: 0, lastRun: null, split: null, splitRequested: '', note: '', route: '', dispatchedAt: '', planned: null, tried: [], pickedAt: '', heldAt: '', heldBy: '', heldWhy: '' };
}

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
    ...(normRunEnd(p.runEnd) ? { runEnd: normRunEnd(p.runEnd) } : {}), // optional: absent until a run ends (old records unchanged)
    ...(normLaunchRetry(p.launchRetry) ? { launchRetry: normLaunchRetry(p.launchRetry) } : {}), // optional: only after a launch crash
    ...(normBounce(p.bounce) ? { bounce: normBounce(p.bounce) } : {}), // optional: only after a land-clash bounce
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
/** On hold: queued, kept in the Queue, skipped by the dispatcher until released. */
export const isHeld = (b) => !!b && b.status === 'queued' && !!b.pipeline?.heldAt;
/** A build may be put on hold: queued (not launched) and not held already. */
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

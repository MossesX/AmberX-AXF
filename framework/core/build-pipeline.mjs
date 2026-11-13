/**
 * build-pipeline@1 — the pipeline record on a builds@1 build and the three table states (pure, IO-free).
 *
 * Brett, Nov 8 2026 ("You need to start the pipeline over from scratch"): everything he asks for becomes a build in the
 * orchestrator, which assigns the id, splits it into steps (≤ 10 min, checkpoints inside one session; Fable only where needed) and puts it in
 * **Pending**. He moves builds from Pending to the **Queue**. A dispatcher on the VPS watches the connected Claude
 * accounts (which have Fable, how many may run in parallel) and the agent slots; when a slot is free it takes the next
 * Queue build and starts a headless session on an account that can run the next phase's model (**Building**).
 *
 *   status flow:  pending → queued → running (Building) → built → complete
 *                 a session that ends with steps left goes back to queued (crash / limit, up to maxRuns) or to pending
 *                 (stopped on purpose: UI Review wait, a question); failed after maxRuns.
 *
 * `pipeline` on a build (kept across orchestrator, Pending and queue writes; only the dispatcher and the queue
 * actions change it):
 *   queuedAt   ISO: when it entered the Queue ('' in Pending)        queuedBy  who queued it (brett | auto | console | …)
 *   account    the Claude account the current / last run is on       session   its tmux session (axf-<id>--<agent>)
 *   slot       the agent-slots entry id of the current run           model     the model that run started on
 *   launchedAt ISO of the current / last launch                      runs      how many sessions have run it
 *   lastRun    { at, exit, outcome, stepsLeft, account, session }    outcome = finished | requeued | returned | failed
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
 *   heldAt, heldBy, heldWhy  On hold (Brett, Nov 10 2026: "Make a hold status … leave in queue on hold"): the build stays
 *              in the Queue, keeps its place, and the dispatcher skips it until it is released. '' = not held.
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
 */

export const SCHEMA = 'build-pipeline@1';
/** The pipeline table: what each builds@1 status shows as. */
export const TABLE = Object.freeze({ pending: 'pending', queued: 'queued', running: 'building', waiting: 'building' });
export const TABLE_STATES = ['pending', 'queued', 'building'];
export const TABLE_LABEL = Object.freeze({ pending: 'Pending', queued: 'Queue', building: 'Building' });
export const OUTCOMES = ['finished', 'requeued', 'returned', 'failed'];
/** Where a build may run: auto, only API-key accounts, only subscriptions. */
export const ROUTES = ['', 'api', 'subscription'];
export const SPLIT_PROVIDERS = ['claude', 'rules', 'hand'];
export const DEFAULT_MAX_RUNS = 3;

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const iso = (v) => { const s = str(v, 40).trim(); return s && Number.isFinite(Date.parse(s)) ? s : ''; };
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** A saved Claude account name (deploy/claude-login.mjs), or ''. */
export const accountName = (v) => (NAME_RE.test(str(v, 40)) ? str(v, 40) : '');

export function emptyPipeline() {
  return { queuedAt: '', queuedBy: '', account: '', session: '', slot: '', model: '', launchedAt: '', runs: 0, lastRun: null, split: null, splitRequested: '', note: '', route: '', dispatchedAt: '', planned: null, tried: [], pickedAt: '', heldAt: '', heldBy: '', heldWhy: '', maxParallel: 0, budgetUsd: 0, spentUsd: 0 };
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
    account: accountName(p.account), session: str(p.session, 120), slot: str(p.slot, 60), model: str(p.model, 20),
    launchedAt: iso(p.launchedAt), runs: Number.isInteger(p.runs) && p.runs > 0 ? p.runs : 0,
    lastRun: lr ? { at: iso(lr.at), exit: Number.isInteger(lr.exit) ? lr.exit : null, outcome: OUTCOMES.includes(lr.outcome) ? lr.outcome : 'finished', stepsLeft: Number.isInteger(lr.stepsLeft) ? lr.stepsLeft : 0, account: accountName(lr.account), session: str(lr.session, 120) } : null,
    split: sp ? { at: iso(sp.at), by: str(sp.by, 80), provider: SPLIT_PROVIDERS.includes(sp.provider) ? sp.provider : 'hand', steps: Number.isInteger(sp.steps) ? sp.steps : 0, note: str(sp.note, 400) } : null,
    splitRequested: iso(p.splitRequested), note: str(p.note, 400),
    route: ROUTES.includes(p.route) ? p.route : '', dispatchedAt: iso(p.dispatchedAt),
    planned: pl ? { model: str(pl.model, 20), account: accountName(pl.account), kind: pl.kind === 'api' ? 'api' : pl.kind === 'subscription' ? 'subscription' : '', at: iso(pl.at), why: str(pl.why, 300) } : null,
    tried: (Array.isArray(p.tried) ? p.tried : []).map(accountName).filter(Boolean).slice(0, 12), pickedAt: iso(p.pickedAt),
    heldAt: iso(p.heldAt), heldBy: iso(p.heldAt) ? str(p.heldBy, 80) : '', heldWhy: iso(p.heldAt) ? str(p.heldWhy, 300) : '',
    maxParallel: Number.isInteger(p.maxParallel) && p.maxParallel > 0 ? Math.min(p.maxParallel, 12) : 0, budgetUsd: usd(p.budgetUsd), spentUsd: usd(p.spentUsd),
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
 *   complete    built, its PR not merged yet                          errors      failed, or its last launch / run failed
 *   archive     complete (merged) or archived: every finished and retired build (Brett, Nov 10 2026: "All completed
 *               builds go to the archive")
 *   deleted     soft-deleted: kept in the store forever, restorable ("A deleted tab where all deleted builds stay saved forever")
 * A queued build On hold stays in the Queue tab (isHeld()).
 */
export function tabOf(b) {
  if (!b) return '';
  if (b.deleted) return 'deleted';
  if (b.hidden) return '';
  if (b.status === 'archived' || b.status === 'complete') return 'archive';
  const p = b.pipeline ?? {};
  if (b.status === 'failed' || /^launch failed/.test(str(p.note, 40))) return 'errors';
  if (b.status === 'running' || b.status === 'waiting') return 'active';
  if (b.status === 'queued') return 'queue';
  if (b.status === 'built') return 'complete';
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
/** A build with a live session (running or waiting on an approval) is never archived or deleted underneath it. */
export const isLive = (b) => !!b && (b.status === 'running' || b.status === 'waiting');
/** A build may move to the Archive: not live, not deleted, not archived already. */
export const canArchive = (b) => !!b && !b.deleted && !isLive(b) && b.status !== 'archived';
/** A build may be (soft-)deleted: not live, not deleted already. Deleting never drops the record. */
export const canDelete = (b) => !!b && !b.deleted && !isLive(b);
/** The status an archived build comes back with: built / complete when every step is done, else pending. */
export function unarchivedStatus(b) {
  const left = openSteps(b).length;
  if (!left && (b?.steps ?? []).length) return str(b?.mergedAt) ? 'complete' : 'built';
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
  /** Pending builds are queued and launched by the planner (the Claude setting builds.launchWithoutAsking). */
  autoQueue: false,
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
 *   pending   pending builds (used only when settings.autoQueue)
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
  if (st.autoQueue) {
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
 * What a run's end means for the build. A clean exit with nothing left = finished. A failed exit (crash, usage limit,
 * killed) = requeued, until `runs` reaches maxRuns, then failed. A clean exit with steps left = the session stopped on
 * purpose (a question, UI Review, a step marked for a new session): back to Pending for Brett, with the reason.
 */
export function outcomeOf({ exit, stepsLeft, runs, phaseSwitch = false }, maxRuns = DEFAULT_MAX_RUNS) {
  if (!stepsLeft) return 'finished';
  if (exit === 0) return phaseSwitch ? 'requeued' : 'returned'; // a phase ended on purpose: the next phase runs on its own model's account
  return runs >= maxRuns ? 'failed' : 'requeued';
}
export const STATUS_AFTER = Object.freeze({ finished: 'built', requeued: 'queued', returned: 'pending', failed: 'failed' });

/** One plain line about a run's end, for the build's notes and the phone. */
export function outcomeLine(b, run) {
  const left = run.stepsLeft ? `${run.stepsLeft} step${run.stepsLeft === 1 ? '' : 's'} left` : 'every step done';
  const where = run.account ? ` on ${run.account}` : '';
  switch (run.outcome) {
    case 'finished': return `Session ${run.session || ''}${where} finished: ${left}.`.replace('  ', ' ');
    case 'requeued': return `Session${where} ended (exit ${run.exit}) with ${left}: back in the Queue (run ${b.pipeline?.runs ?? 1}).`;
    case 'returned': return `Session${where} stopped on its own with ${left}: back in Pending for Brett.`;
    default: return `Session${where} ended (exit ${run.exit}) with ${left} after ${b.pipeline?.runs ?? 0} runs: failed.`;
  }
}

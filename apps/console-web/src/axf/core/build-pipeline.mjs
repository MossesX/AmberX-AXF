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
 *
 * The orchestrator's tabs (Brett, Nov 10 2026: "Tabs: pending, active, incomplete, complete, errors, queue"): tabOf().
 *
 * `land` on a build (Brett, Nov 14 2026: "We need to make sure things are landing as soon as they're built and merged as
 * soon as they're built. I keep getting too many commits behind"; build land-finish-auto-land-live-clear-backlog): the
 * landing record the auto-lander keeps from the moment the last step is ticked until the branch is on main. Written only
 * by the lander (and the behind check); every other writer carries it through untouched. A build the lander never saw
 * carries none (normLand → null), so older records are byte-stable.
 *   behindMain      how many commits of main the branch is behind at the last check (null = never checked)
 *   behindCheckedAt ISO of that check ('' = never)
 *   finishedAt      ISO: when its last open step was ticked (the moment landing may start; builtAt is when the status
 *                   turned built, which can be later or set by hand)
 *   landState       '' (not in the lander's hands) | waiting (built, in line) | landing (an attempt is running) |
 *                   landed (on main) | red (its merge failed CI: a fix build was filed) | archived (dropped from the
 *                   line on purpose) | flagged (a source clash or a repeat failure: a person has to look)
 *   landAttempts    [{ at, run, base, merged, outcome, ci, note }] oldest first, one per land-run@1 attempt
 *                   (framework/core/land-run.mjs), capped at MAX_LAND_ATTEMPTS (oldest dropped)
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
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const iso = (v) => { const s = str(v, 40).trim(); return ISO_RE.test(s) && Number.isFinite(Date.parse(s)) ? s : ''; };
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** A saved Claude account name (deploy/claude-login.mjs), or ''. */
export const accountName = (v) => (NAME_RE.test(str(v, 40)) ? str(v, 40) : '');

export function emptyPipeline() {
  return { queuedAt: '', queuedBy: '', account: '', session: '', slot: '', model: '', launchedAt: '', runs: 0, lastRun: null, split: null, splitRequested: '', note: '', route: '', dispatchedAt: '', planned: null, tried: [], pickedAt: '', heldAt: '', heldBy: '', heldWhy: '' };
}

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
  };
  const empty = emptyPipeline();
  return JSON.stringify(out) === JSON.stringify(empty) ? null : out;
}

// ------------------------------------------------------------------ land: behind main + landing state (Nov 14 2026)

/** Where a built branch stands with main ('' = the lander has not taken it). */
export const LAND_STATES = ['', 'waiting', 'landing', 'landed', 'red', 'archived', 'flagged'];
export const LAND_STATE_LABEL = Object.freeze({ '': '', waiting: 'Waiting', landing: 'Landing', landed: 'Landed', red: 'Red', archived: 'Archived', flagged: 'Flagged' });
/** One attempt's outcome, as land-run@1 reports it ('' = still running). */
export const LAND_ATTEMPT_OUTCOMES = ['', 'landed', 'red', 'clash', 'cancelled', 'error'];
export const MAX_LAND_ATTEMPTS = 20;
const SHA_RE = /^[0-9a-f]{7,40}$/;
/** A git sha (7 to 40 hex digits, lower-cased), or ''. */
export const sha = (v) => { const s = str(v, 40).trim().toLowerCase(); return SHA_RE.test(s) ? s : ''; };

export function emptyLand() {
  return { behindMain: null, behindCheckedAt: '', finishedAt: '', landState: '', landAttempts: [] };
}

/** One landAttempts entry in shape (null for junk without a time or a run id). */
export function normLandAttempt(a) {
  if (!a || typeof a !== 'object') return null;
  const out = {
    at: iso(a.at), run: str(a.run, 80).trim(), base: sha(a.base), merged: sha(a.merged),
    outcome: LAND_ATTEMPT_OUTCOMES.includes(a.outcome) ? a.outcome : '',
    ci: str(a.ci, 20).trim(), note: str(a.note, 300),
  };
  return out.at || out.run ? out : null;
}

/** The land record, every field in shape; null for nothing (a build the lander never touched carries none). */
export function normLand(l) {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return null;
  const checkedAt = iso(l.behindCheckedAt);
  const out = {
    behindMain: checkedAt && Number.isInteger(l.behindMain) && l.behindMain >= 0 ? l.behindMain : null,
    behindCheckedAt: checkedAt,
    finishedAt: iso(l.finishedAt),
    landState: LAND_STATES.includes(l.landState) ? l.landState : '',
    landAttempts: (Array.isArray(l.landAttempts) ? l.landAttempts : []).map(normLandAttempt).filter(Boolean).slice(-MAX_LAND_ATTEMPTS),
  };
  return JSON.stringify(out) === JSON.stringify(emptyLand()) ? null : out;
}

/**
 * The land state a build shows: its record's when the lander set one, else read off the build itself (an older record
 * that landed before the lander existed shows landed; a built one waiting; anything else '').
 */
export function landStateOf(b) {
  if (!b) return '';
  const l = normLand(b.land);
  if (l?.landState) return l.landState;
  if (b.status === 'complete' || str(b.mergedAt)) return 'landed';
  if (b.status === 'archived') return 'archived';
  if (b.status === 'built') return 'waiting';
  return '';
}
/** When the build finished: its land record's finishedAt, else builtAt, else the last step's doneAt. */
export function finishedAtOf(b) {
  const l = normLand(b?.land);
  if (l?.finishedAt) return l.finishedAt;
  if (iso(b?.builtAt)) return iso(b.builtAt);
  return (b?.steps ?? []).map((s) => iso(s?.doneAt)).filter(Boolean).sort().pop() ?? '';
}
/** A built branch the lander should take: built (every step done), not landed, not dropped. */
export const needsLanding = (b) => !!b && !b.deleted && b.status === 'built' && !str(b.mergedAt) && ['', 'waiting', 'red'].includes(landStateOf(b));
/** Behind main by at least `min` commits at the last check (false when never checked). */
export const isBehind = (b, min = 1) => { const l = normLand(b?.land); return !!l && l.behindMain !== null && l.behindMain >= min; };

/** The land state after an attempt's outcome: running → landing; landed; red; a clash → flagged; cancelled → waiting again; error → waiting. */
export const LAND_STATE_AFTER = Object.freeze({ '': 'landing', landed: 'landed', red: 'red', clash: 'flagged', cancelled: 'waiting', error: 'waiting' });
/** A new land record with one more attempt appended (oldest dropped past the cap); the state follows the outcome. */
export function addLandAttempt(land, attempt, now = new Date().toISOString()) {
  const a = normLandAttempt({ at: now, ...attempt });
  if (!a) throw new Error('a land attempt needs a time or a land-run id');
  const l = normLand(land) ?? emptyLand();
  const same = l.landAttempts.findIndex((x) => a.run && x.run === a.run);
  if (same >= 0) l.landAttempts[same] = a; else l.landAttempts.push(a);
  l.landAttempts = l.landAttempts.slice(-MAX_LAND_ATTEMPTS);
  l.landState = LAND_STATE_AFTER[a.outcome] ?? l.landState;
  return normLand(l);
}
/** A new land record after a behind-main check. */
export function withBehind(land, behindMain, now = new Date().toISOString()) {
  const l = normLand(land) ?? emptyLand();
  l.behindMain = Number.isInteger(behindMain) && behindMain >= 0 ? behindMain : null;
  l.behindCheckedAt = l.behindMain === null ? '' : now;
  return normLand(l);
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

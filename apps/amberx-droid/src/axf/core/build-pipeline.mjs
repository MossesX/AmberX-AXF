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
 *   heldAt, heldBy, heldWhy  On hold (Brett, Nov 10 2026: "Make a hold status … leave in queue on hold"): the build stays
 *              in the Queue, keeps its place, and the dispatcher skips it until it is released. '' = not held.
 *
 * The orchestrator's tabs (Brett, Nov 10 2026: "Tabs: pending, active, incomplete, complete, errors, queue"): tabOf().
 */

export const SCHEMA = 'build-pipeline@1';
/** The pipeline table: what each builds@1 status shows as. */
export const TABLE = Object.freeze({ pending: 'pending', queued: 'queued', running: 'building', waiting: 'building' });
export const TABLE_STATES = ['pending', 'queued', 'building'];
export const TABLE_LABEL = Object.freeze({ pending: 'Pending', queued: 'Queue', building: 'Building' });
export const OUTCOMES = ['finished', 'requeued', 'returned', 'failed'];
/** Why a run ended the way it did (lastRun.reason): the exit transition's reason code. */
export const EXIT_REASONS = ['all-done', 'phase-done', 'crash', 'crash-limit', 'upgrade-blocked', 'needs-brett', 'stopped'];
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
  if (b.status === 'archived' || b.status === 'complete') return 'archive';
  const p = b.pipeline ?? {};
  if (b.status === 'failed' || /^launch failed/.test(str(p.note, 40))) return 'errors';
  if (b.status === 'pending' && p.lastRun?.outcome === 'failed') return 'errors'; // the crash limit sent it back to Pending
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
 * The exit transition: what a run's end means for the build, pure. In:
 *   exit            the session's exit code (0 = clean; anything else or null = crash, usage limit, killed)
 *   stepsLeft       open steps after the run
 *   crashes         failed exits before this one (pipeline.crashes); when absent, runs - 1 stands in for it
 *   runs            how many sessions have run the build, this one included
 *   phaseDone       the phase the run was launched for is done (its steps ticked), whatever the models involved
 *   upgradeBlocked  the next phase is an upgrade Brett has not approved while "Fable upgrades need my approval" is on
 *   needsBrett      the session said it needs Brett (a question, UI Review wait, a build left waiting)
 * Out: { status, outcome, reason, crashes, keepQueue }. `keepQueue` = the build stays in the Queue at its position.
 *   all-done         nothing left                         → built    (the caller makes it complete when there is no open PR)
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
  if (!stepsLeft) return out('built', 'finished', 'all-done');
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
export const STATUS_AFTER = Object.freeze({ finished: 'built', requeued: 'queued', returned: 'pending', failed: 'pending' });

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

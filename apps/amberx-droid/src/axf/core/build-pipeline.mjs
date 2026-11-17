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
 *                 Opus → Fable with the upgrade policy satisfied) = 'phase-done': status queued, but the build keeps its
 *                 slot and sits in the phase-handoff state (stateOf), ahead of every Queue build; the next phase starts
 *                 by itself in that slot. A crash = the same ('crash', the slot kept) until maxRuns crashes, then pending
 *                 ('crash-limit', the slot released). Pending only for a real stop: the crash limit, the next phase is an
 *                 upgrade Brett has not approved while "Fable upgrades need my approval" is on ('upgrade-blocked'), the
 *                 session needs Brett ('needs-brett'), or it stopped mid-phase on purpose: a question, UI Review ('stopped').
 *
 *   slot hold (Brett, Nov 17 2026: "They didn't go back online. They finished. That is retarded. I want the 8 that are
 *   running to finish before the rest go."): a build keeps its agent slot from its first launch until it is merged. A
 *   phase end is a hand-off between two sessions of the same build, never a return to the Queue; a slot held between
 *   phases is not free (freeSlots = max − holders), and pickNext() puts hand-off builds before every queued one. The slot
 *   is released only on merged / complete, failed (the crash limit) or a Brett action (unqueue, hold, archive, delete,
 *   release-slot). Spec: framework/spec/BUILD-PIPELINE.md.
 *
 * `pipeline` on a build (kept across orchestrator, Pending and queue writes; only the dispatcher and the queue
 * actions change it):
 *   queuedAt   ISO: when it entered the Queue ('' in Pending)        queuedBy  who queued it (brett | auto | console | …)
 *   account    the Claude account the current / last run is on       session   its tmux session (axf-<id>--<agent>)
 *   slot       the slot hold { holder, account, model, since, entry, released }: holder = the build id while it holds a
 *              slot ('' = none), since = ISO of the first launch, entry = the agent-slots entry id of the live session
 *              ('' between sessions), released = the last release { at, by, why } or null. A string (records before
 *              Nov 17 2026) reads as no hold with the string as entry.
 *   model      the model that run started on
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
/** The pipeline table: what each builds@1 status shows as (a queued build holding a slot shows as building: tableOf). */
export const TABLE = Object.freeze({ pending: 'pending', queued: 'queued', running: 'building', waiting: 'building' });
export const TABLE_STATES = ['pending', 'queued', 'building'];
export const TABLE_LABEL = Object.freeze({ pending: 'Pending', queued: 'Queue', building: 'Building' });
/**
 * The pipeline state (stateOf): the builds@1 status read together with the slot hold.
 *   pending         in Pending                                    queued    in the Queue, no slot held
 *   phase-handoff   queued and holding a slot: a phase ended (or a session crashed) and the next session has not started
 *   building        running or waiting on an approval             landing   built (every step done), the slot held until the PR merges
 */
export const PIPELINE_STATES = ['pending', 'queued', 'phase-handoff', 'building', 'landing'];
export const STATE_LABEL = Object.freeze({ pending: 'Pending', queued: 'Queue', 'phase-handoff': 'Phase hand-off', building: 'Building', landing: 'Landing' });
/** Why a slot was released: the PR merged (complete), the build failed (the crash limit), or Brett cancelled it (an action). */
export const SLOT_RELEASES = ['merged', 'failed', 'cancelled'];
/** The build actions that take the slot back (Brett cancels the run: the build is no longer one of the running ones). */
export const RELEASING_ACTIONS = ['unqueue', 'hold', 'archive', 'delete', 'release-slot'];
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

/** No slot held, nothing released. */
export function emptySlot() {
  return { holder: '', account: '', model: '', since: '', entry: '', released: null };
}

/**
 * The slot hold in shape. An object keeps holder / account / model / since / entry / released; a string (the agent-slots
 * entry id, records before Nov 17 2026) reads as no hold with the string as entry; anything else as no hold.
 */
export function normSlot(v) {
  if (typeof v === 'string') return { ...emptySlot(), entry: str(v, 60) };
  if (!v || typeof v !== 'object') return emptySlot();
  const holder = NAME_RE.test(str(v.holder, 40)) || /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(str(v.holder, 80)) ? str(v.holder, 80) : '';
  const rel = v.released && typeof v.released === 'object' && iso(v.released.at) ? { at: iso(v.released.at), by: str(v.released.by, 80), why: SLOT_RELEASES.includes(v.released.why) ? v.released.why : 'cancelled' } : null;
  return { holder, account: holder ? accountName(v.account) : '', model: holder ? str(v.model, 20) : '', since: holder ? iso(v.since) : '', entry: str(v.entry, 60), released: rel };
}

export function emptyPipeline() {
  return { queuedAt: '', queuedBy: '', account: '', session: '', slot: emptySlot(), model: '', phase: '', launchedAt: '', runs: 0, crashes: 0, lastRun: null, split: null, splitRequested: '', note: '', route: '', dispatchedAt: '', planned: null, tried: [], pickedAt: '', heldAt: '', heldBy: '', heldWhy: '' };
}

/** The record, every field in shape; null for nothing (a build the pipeline never touched carries none). */
export function normPipeline(p) {
  if (!p || typeof p !== 'object') return null;
  const lr = p.lastRun && typeof p.lastRun === 'object' ? p.lastRun : null;
  const sp = p.split && typeof p.split === 'object' ? p.split : null;
  const pl = p.planned && typeof p.planned === 'object' ? p.planned : null;
  const out = {
    queuedAt: iso(p.queuedAt), queuedBy: str(p.queuedBy, 80),
    account: accountName(p.account), session: str(p.session, 120), slot: normSlot(p.slot), model: str(p.model, 20), phase: str(p.phase, 80),
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

// ------------------------------------------------------------------ the slot hold

/** Does this build hold an agent slot? (its slot.holder is set; a string slot of an older record holds nothing) */
export const holdsSlot = (b) => !!b && !b.deleted && !!normSlot(b.pipeline?.slot).holder;
/** The agent-slots entry id of the live session ('' between sessions), whatever shape the record has. */
export const slotEntry = (p) => normSlot(p?.slot).entry;

/**
 * A session starts: the build takes (or keeps) its slot. The first launch starts the hold (`since`); every later launch
 * of the same build keeps it and records the new account, model and agent-slots entry.
 */
export function takeSlot(slot, { id, account = '', model = '', entry = '', at = new Date().toISOString() } = {}) {
  const s = normSlot(slot);
  const holder = str(id, 80) || s.holder;
  if (!holder) return s;
  return { holder, account: accountName(account) || (s.holder ? s.account : ''), model: str(model, 20) || (s.holder ? s.model : ''), since: s.holder && s.since ? s.since : iso(at) || new Date().toISOString(), entry: str(entry, 60), released: null };
}

/** A session ended with the build going on (phase done, a crash under the limit, a stop for Brett): the hold stays, the live entry is cleared. */
export function handoffSlot(slot) {
  const s = normSlot(slot);
  return s.holder ? { ...s, entry: '' } : s;
}

/** The slot is released: merged, failed, or cancelled by Brett (why in SLOT_RELEASES). The release is kept on the record. */
export function releaseSlot(slot, { at = new Date().toISOString(), by = 'pipeline', why = 'cancelled' } = {}) {
  const s = normSlot(slot);
  if (!s.holder) return { ...s, entry: '' };
  return { ...emptySlot(), released: { at: iso(at) || new Date().toISOString(), by: str(by, 80), why: SLOT_RELEASES.includes(why) ? why : 'cancelled' } };
}

/** The release a status change implies: complete (merged) → merged, failed → failed, else '' (the hold stays). */
export const releaseOnStatus = (status) => (status === 'complete' || status === 'archived' ? 'merged' : status === 'failed' ? 'failed' : '');

/** The slot hold a running build gets from the migration (its first launch, account and model as recorded). */
function migratedSlot(b, now) {
  const p = b.pipeline ?? {};
  const live = b.status === 'running' || b.status === 'waiting';
  const since = iso(p.launchedAt) || iso(p.lastRun?.at) || iso(now) || new Date().toISOString();
  return { holder: b.id, account: accountName(p.account) || accountName(p.lastRun?.account), model: str(p.model, 20), since, entry: live ? slotEntry(p) : '', released: null };
}

/**
 * The migration to the slot-hold rule: one patch { id, slot } per build that was running when the rule landed and holds
 * nothing yet. Running and waiting builds qualify, and queued builds the old exit rule sent back to the Queue after a
 * phase end or a crash (lastRun.outcome requeued, at least one run): they were the running ones. Idempotent.
 */
export function migrateSlots(builds, now = new Date().toISOString()) {
  const out = [];
  for (const b of Array.isArray(builds) ? builds : []) {
    if (!b || b.deleted || !str(b.id)) continue;
    if (holdsSlot(b)) continue;
    const p = b.pipeline ?? {};
    const live = b.status === 'running' || b.status === 'waiting';
    const requeued = b.status === 'queued' && p.lastRun?.outcome === 'requeued' && (Number(p.runs) || 0) > 0 && openSteps(b).length > 0;
    if (!live && !requeued) continue;
    out.push({ id: b.id, slot: migratedSlot(b, now) });
  }
  return out;
}

/**
 * The pipeline state (PIPELINE_STATES): the builds@1 status read with the slot hold. '' for builds the pipeline does not
 * show (complete, failed, blocked, archived, deleted).
 */
export function stateOf(b) {
  if (!b || b.deleted) return '';
  if (b.status === 'running' || b.status === 'waiting') return 'building';
  if (b.status === 'queued') return holdsSlot(b) ? 'phase-handoff' : 'queued';
  if (b.status === 'pending') return 'pending';
  if (b.status === 'built') return holdsSlot(b) ? 'landing' : '';
  return '';
}
/** Phase hand-off: queued with a slot held, waiting for its next session (next in line, ahead of the Queue). */
export const isHandoff = (b) => stateOf(b) === 'phase-handoff';

/** Which table a build sits in ('' for builds the table does not show: built, complete, failed, blocked, archived). A hand-off build is in Building: it is one of the running builds. */
export const tableOf = (b) => (isHandoff(b) ? 'building' : TABLE[b?.status] ?? '');

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
  if (b.status === 'running' || b.status === 'waiting' || isHandoff(b)) return 'active';
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
/** Brett may take the slot back: the build holds one and has no live session (phase-handoff, landing, or Pending with a hold). */
export const canReleaseSlot = (b) => !!b && !b.deleted && holdsSlot(b) && !isLive(b);
/** The actions the Build orchestrator offers on a build (Queue: back to Pending, hold / release, archive, delete, release the slot). */
export const BUILD_ACTIONS = ['unqueue', 'hold', 'release', 'archive', 'unarchive', 'delete', 'restore', 'release-slot'];
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
  if (canReleaseSlot(b)) out.push('release-slot');
  return out;
}
/** Does this action release the build's slot? (Brett cancels the run: RELEASING_ACTIONS) */
export const actionReleasesSlot = (action) => RELEASING_ACTIONS.includes(action);

/** Builds of the Queue in start order: priority first (P0 before P3), then the moment they were queued. */
export function queueOrder(builds, priorityOf = () => 'P2') {
  const rank = (p) => { const n = parseInt(String(p).replace(/^P/, ''), 10); return Number.isInteger(n) ? n : 2; };
  return [...builds].filter((b) => b.status === 'queued').sort((a, b) => rank(priorityOf(a)) - rank(priorityOf(b)) || str(a.pipeline?.queuedAt).localeCompare(str(b.pipeline?.queuedAt)) || str(a.createdAt).localeCompare(str(b.createdAt)));
}

// ------------------------------------------------------------------ dispatch order (the slot hold)

/** Every live build that holds a slot: running, waiting, in hand-off, landing, or parked in Pending with its hold. */
export const holders = (builds) => (Array.isArray(builds) ? builds : []).filter((b) => holdsSlot(b) && !['complete', 'failed', 'archived'].includes(b.status));
/** Holders waiting for their next session (phase-handoff), oldest hold first, then Queue order. */
export const handoffs = (builds) => holders(builds).filter(isHandoff).sort((a, b) => str(a.pipeline?.slot?.since).localeCompare(str(b.pipeline?.slot?.since)) || str(a.pipeline?.queuedAt).localeCompare(str(b.pipeline?.queuedAt)) || str(a.createdAt).localeCompare(str(b.createdAt)));
/** Slots free for new builds: the cap minus every held slot (live or between phases), never below 0. */
export const freeSlots = (builds, max) => Math.max(0, (Number.isInteger(max) && max > 0 ? max : 0) - holders(builds).length);

/**
 * What may start a session this tick, in order (pure). In: the live builds, `max` (the agent-slot cap), `priorityOf`.
 * Out: { order, handoff, holders, free, waits }:
 *   order    build ids to launch, in order: every hand-off build first (it owns a slot already and takes none of the free
 *            ones), then Queue builds (queueOrder: priority, then queuedAt) up to `free`
 *   handoff  the hand-off builds' ids; holders = every held slot's build id; free = freeSlots()
 *   waits    [{ id, why }] queued builds that stay put: a hand-off is waiting (Brett, Nov 17 2026: the running builds
 *            finish before the rest go), On hold, nothing to run, or no free slot
 * A queued build never starts while a hand-off build waits for its next phase, whatever the free count says.
 */
export function pickNext(builds, { max = 0, priorityOf = () => 'P2' } = {}) {
  const live = (Array.isArray(builds) ? builds : []).filter((b) => b && !b.deleted);
  const held = holders(live);
  const hand = handoffs(live);
  const free = freeSlots(live, max);
  const order = hand.map((b) => b.id);
  const waits = [];
  let room = free;
  for (const b of queueOrder(live, priorityOf)) {
    if (holdsSlot(b)) continue; // a hand-off build: already in order
    if (isHeld(b)) { waits.push({ id: b.id, why: `on hold${b.pipeline?.heldBy ? ` (${b.pipeline.heldBy})` : ''}: skipped until released`, held: true }); continue; }
    if (!openSteps(b).length) { waits.push({ id: b.id, why: (b.steps ?? []).length ? 'every step is done: nothing to run' : 'no steps yet: waiting for the split' }); continue; }
    if (hand.length) { waits.push({ id: b.id, why: `waiting: ${hand.length} running build${hand.length === 1 ? '' : 's'} finish${hand.length === 1 ? 'es' : ''} first (phase hand-off: ${hand.map((h) => h.id).join(', ')})`, handoff: true }); continue; }
    if (room <= 0) { waits.push({ id: b.id, why: `no free slot (${held.length}/${max || '?'} held)` }); continue; }
    room -= 1; order.push(b.id);
  }
  return { order, handoff: hand.map((b) => b.id), holders: held.map((b) => b.id), free, waits };
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
 * Out: { status, outcome, reason, crashes, keepQueue, slot, state }. `keepQueue` = the build stays in the Queue at its
 * position; `slot` = keep | release (the slot hold); `state` = the pipeline state after the exit (PIPELINE_STATES).
 *   all-done         nothing left                         → built    (the caller makes it complete when there is no open PR)
 *                                                                    slot kept until the merge (landing); complete releases it
 *   crash            a failed exit, crashes under maxRuns → queued   slot kept: phase-handoff, the retry runs in the same slot
 *   crash-limit      a failed exit, crashes at maxRuns    → pending  slot released (failed); Brett decides (Errors tab)
 *   upgrade-blocked  clean exit, next phase needs Brett   → pending  slot kept: when Brett answers, it goes on ahead of the Queue
 *   needs-brett      clean exit, the session asked        → pending  slot kept
 *   phase-done       clean exit, its phase done           → queued   slot kept: phase-handoff, the next phase launches by itself; not a crash
 *   stopped          clean exit mid-phase                 → pending  slot kept; a question, UI Review, a step marked for a new session
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
  const out = (status, outcome, reason) => ({
    status, outcome, reason, crashes, keepQueue: status === 'queued',
    slot: outcome === 'failed' ? 'release' : 'keep',
    state: status === 'queued' ? 'phase-handoff' : status === 'built' ? 'landing' : 'pending',
  });
  if (!stepsLeft) return out('built', 'finished', 'all-done');
  if (!clean) return crashes >= max ? out('pending', 'failed', 'crash-limit') : out('queued', 'requeued', 'crash');
  if (r.upgradeBlocked) return out('pending', 'returned', 'upgrade-blocked');
  if (r.needsBrett) return out('pending', 'returned', 'needs-brett');
  if (r.phaseDone) return out('queued', 'requeued', 'phase-done');
  return out('pending', 'returned', 'stopped');
}

/**
 * The slot after a run's end, from the record's slot and the exit result: kept (entry cleared) or released. `status` is
 * the status the caller settles on (complete releases as merged even when the exit said built).
 */
export function slotAfterExit(slot, result, { status = result?.status ?? '', at = new Date().toISOString(), by = 'pipeline' } = {}) {
  const implied = releaseOnStatus(status);
  if (result?.slot === 'release') return releaseSlot(slot, { at, by, why: 'failed' });
  if (implied) return releaseSlot(slot, { at, by, why: implied });
  return handoffSlot(slot);
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
      if (run.reason === 'phase-done') return `Session${where} finished ${phase} with ${left}: keeps its slot (phase hand-off, ahead of the Queue), the next phase${next ? ` (${next})` : ''} starts by itself.`;
      return `Session${where} ended (exit ${run.exit}) with ${left}: keeps its slot, retried ahead of the Queue (run ${runs}).`;
    case 'returned':
      if (run.reason === 'upgrade-blocked') return `Session${where} finished ${phase} with ${left}: the next phase upgrades to ${next || 'a higher model'} and needs Brett's approval (Fable upgrades need my approval is on): back in Pending.`;
      if (run.reason === 'needs-brett') return `Session${where} stopped with ${left} and needs Brett: back in Pending.`;
      return `Session${where} stopped on its own with ${left}: back in Pending for Brett.`;
    default: return `Session${where} ended (exit ${run.exit}) with ${left} after ${b.pipeline?.runs ?? 0} runs: crash limit reached, failed: back in Pending for Brett.`;
  }
}

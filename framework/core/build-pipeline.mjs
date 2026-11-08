/**
 * build-pipeline@1 — the pipeline record on a builds@1 build and the three table states (pure, IO-free).
 *
 * Brett, Nov 8 2026 ("You need to start the pipeline over from scratch"): everything he asks for becomes a build in the
 * orchestrator, which assigns the id, splits it into steps (≤ 30 min, Fable only where needed) and puts it in
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
 */

export const SCHEMA = 'build-pipeline@1';
/** The pipeline table: what each builds@1 status shows as. */
export const TABLE = Object.freeze({ pending: 'pending', queued: 'queued', running: 'building', waiting: 'building' });
export const TABLE_STATES = ['pending', 'queued', 'building'];
export const TABLE_LABEL = Object.freeze({ pending: 'Pending', queued: 'Queue', building: 'Building' });
export const OUTCOMES = ['finished', 'requeued', 'returned', 'failed'];
export const SPLIT_PROVIDERS = ['claude', 'rules', 'hand'];
export const DEFAULT_MAX_RUNS = 3;

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const iso = (v) => { const s = str(v, 40).trim(); return s && Number.isFinite(Date.parse(s)) ? s : ''; };
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** A saved Claude account name (deploy/claude-login.mjs), or ''. */
export const accountName = (v) => (NAME_RE.test(str(v, 40)) ? str(v, 40) : '');

export function emptyPipeline() {
  return { queuedAt: '', queuedBy: '', account: '', session: '', slot: '', model: '', launchedAt: '', runs: 0, lastRun: null, split: null, splitRequested: '', note: '' };
}

/** The record, every field in shape; null for nothing (a build the pipeline never touched carries none). */
export function normPipeline(p) {
  if (!p || typeof p !== 'object') return null;
  const lr = p.lastRun && typeof p.lastRun === 'object' ? p.lastRun : null;
  const sp = p.split && typeof p.split === 'object' ? p.split : null;
  const out = {
    queuedAt: iso(p.queuedAt), queuedBy: str(p.queuedBy, 80),
    account: accountName(p.account), session: str(p.session, 120), slot: str(p.slot, 60), model: str(p.model, 20),
    launchedAt: iso(p.launchedAt), runs: Number.isInteger(p.runs) && p.runs > 0 ? p.runs : 0,
    lastRun: lr ? { at: iso(lr.at), exit: Number.isInteger(lr.exit) ? lr.exit : null, outcome: OUTCOMES.includes(lr.outcome) ? lr.outcome : 'finished', stepsLeft: Number.isInteger(lr.stepsLeft) ? lr.stepsLeft : 0, account: accountName(lr.account), session: str(lr.session, 120) } : null,
    split: sp ? { at: iso(sp.at), by: str(sp.by, 80), provider: SPLIT_PROVIDERS.includes(sp.provider) ? sp.provider : 'hand', steps: Number.isInteger(sp.steps) ? sp.steps : 0, note: str(sp.note, 400) } : null,
    splitRequested: iso(p.splitRequested), note: str(p.note, 400),
  };
  const empty = emptyPipeline();
  return JSON.stringify(out) === JSON.stringify(empty) ? null : out;
}

/** Which table a build sits in ('' for builds the table does not show: built, complete, failed, blocked, archived). */
export const tableOf = (b) => TABLE[b?.status] ?? '';

/** A build may be queued: it is in Pending and not finished. */
export const canQueue = (b) => !!b && b.status === 'pending' && !b.deleted && !b.hidden;
/** A build may leave the Queue for Pending: queued and not launched yet. */
export const canUnqueue = (b) => !!b && b.status === 'queued';

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

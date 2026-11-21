/**
 * build-watchdog@1 — when a build is marked Building but nothing is alive for it, what the orchestrator does. Pure, IO-free.
 *
 * Brett, Nov 13 2026: "if anything stops working, the server/orchestrator fixes it automatically with no one asking.
 * Detect builds marked running with no live session (e.g. killed exit 143, failed exit 1), reset and requeue them, retry
 * failed sessions, keep every slot filled, and send an FYI to the phone for each fix. Never wait for Brett to notice."
 *
 * This module is the decision table. The probe (what is alive on the VPS) and the executor (store writes, slot release,
 * relaunch, phone FYI) live in the Build orchestrator plugin and read their answers from here, so the CLI, REST, MCP,
 * voice and the cron pass all decide the same way; the golden cases are framework/spec/fixtures/build-watchdog.json.
 *
 * Marked running (`isMarkedRunning`): status running or waiting, or queued with a session recorded for a launch newer
 * than its last run end ("queued-running": the dispatcher launched it and the store never moved it on).
 *
 * The probe (`normProbe`), one per build, every signal from a different source so one broken source never decides alone:
 *   pid         true | false | null    a claude process for the build (cwd in its worktree or AXF_BUILD_ID), null = not probed
 *   tmux        true | false | null    its tmux session (axf-<id>, axf-<id>--<agent>, duplicate suffix), null = not probed
 *   lastSeenAt  ISO | ''               the newest heartbeat: the build lock's beat, the agent slot's lastSeenAt, the log's mtime
 *   exit        int | null             an exit code recorded for the current session (session-end event, slot finish, meter)
 *   exitKind    phase-done | crash | stopped | ''   what the headless wrapper said about that exit
 *   limit       usage | auth | ''      the run stopped on the account: a usage limit / out of credits, or a dead login
 *   at          ISO                    when the probe looked (the decision's "now")
 *
 * Causes (`CAUSES`), most certain first; `causeOf` names the first that applies:
 *   usage-limit      the account hit its limit or ran out of credits   → the build is fine: retry on another account
 *   auth-failed      the account's login is dead                        → retry on another account
 *   exit-clean       exit 0 recorded, the build still marked running     → the end was never processed: requeue, no retry counted
 *   exit-killed      exit 143 (SIGTERM: a kill, a reboot, tmux gone)     → retry
 *   exit-oom         exit 137 (SIGKILL, usually the OOM killer)          → retry
 *   exit-failed      any other non-zero exit (1 = claude failed)         → retry
 *   tmux-missing     no tmux session and no process alive                → retry
 *   pid-gone         no claude process (tmux unknown or gone)            → retry
 *   stale-heartbeat  nothing alive for sure, heartbeat older than staleMin → retry; a process alive with a stale heartbeat
 *                    is hung: kill-retry
 *   starting         launched less than graceMin ago, nothing recorded yet → none (left alone)
 *   live             a process, a session or a fresh heartbeat says alive → none (left alone, never touched)
 *   unknown          every signal null and no heartbeat at all           → none (the probe has to look first)
 *
 * Actions (`ACTIONS`): what the executor does for a stuck build; `decide` returns one with its effects spelled out
 * (resetStep, releaseSlot, requeue, status, excludeAccounts, banner, notify):
 *   none                 nothing
 *   requeue              release the slot, back to the Queue at its place (the exit transition applies); no attempt counted
 *   retry                reset the step the session was on, release the slot, back to the Queue; same or another account
 *   retry-other-account  as retry, and the account it was on is excluded from the next pick (its limit / login)
 *   kill-retry           kill the hung session first, then as retry
 *   give-up              attempts past maxRetries (or every account tried): release the slot, back to Pending with a banner
 *                        item and an alert; Brett decides
 *
 * Attempts: a retry counts once per recovery since the build last made progress (a step ticked); progress resets the
 * count, so a build that keeps crashing on the same step stops after maxRetries, one that moves on may be rescued again.
 * Account-caused retries (usage-limit, auth-failed) never count: with `accounts` (the usable candidates) at hand the
 * table gives up only when every one of them is in `tried`.
 *
 * The recovery record (`recoveryRecord`, kept on the build as `recoveries[]`, newest last, builds@1; journal action
 * `watchdog-recover`): { at, buildId, phase, step, cause, exit, action, attempt, account, notified, session, note }.
 * `notified` = ISO when the phone FYI went out, '' until then. Old records without `recoveries` load unchanged.
 */

export const SCHEMA = 'build-watchdog@1';
export const RECORD = 'watchdog-recovery@1';
export const VERSION = 1;
/** The builds store journal action every watchdog write carries. */
export const JOURNAL_ACTION = 'watchdog-recover';

export const CAUSES = ['usage-limit', 'auth-failed', 'exit-clean', 'exit-killed', 'exit-oom', 'exit-failed', 'tmux-missing', 'pid-gone', 'stale-heartbeat', 'starting', 'live', 'unknown'];
/** Causes that mean the build is stuck (the rest leave it alone). */
export const STUCK_CAUSES = ['usage-limit', 'auth-failed', 'exit-clean', 'exit-killed', 'exit-oom', 'exit-failed', 'tmux-missing', 'pid-gone', 'stale-heartbeat'];
export const ACTIONS = ['none', 'requeue', 'retry', 'retry-other-account', 'kill-retry', 'give-up'];
/** Actions that relaunch and therefore count towards maxRetries. */
export const RETRY_ACTIONS = ['retry', 'kill-retry'];
export const LIMITS = ['', 'usage', 'auth'];
export const EXIT_KINDS = ['', 'phase-done', 'crash', 'stopped'];
/** Exit codes with a name of their own. */
export const EXIT_CODES = Object.freeze({ 0: 'exit-clean', 143: 'exit-killed', 137: 'exit-oom' });
/** Phone notifications (notify.json types): one FYI per fix, an alert when the watchdog gives up. */
export const NOTIFY = Object.freeze({ fix: 'watchdog.fix', gaveUp: 'watchdog.gave-up' });
/** Recovery records kept per build (the journal has every one). */
export const MAX_RECOVERIES = 50;
/** Statuses the table treats as Building. */
export const RUNNING_STATUSES = ['running', 'waiting'];

export const DEFAULTS = Object.freeze({ enabled: true, staleMin: 20, graceMin: 3, maxRetries: 3 });
const RANGES = { staleMin: [1, 240], graceMin: [0, 60], maxRetries: [0, 10] };

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const iso = (v) => { const s = str(v, 40).trim(); return ISO.test(s) && Number.isFinite(Date.parse(s)) ? s : ''; };
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const accountName = (v) => (NAME_RE.test(str(v, 40)) ? str(v, 40) : '');
const tri = (v) => (v === true ? true : v === false ? false : null);
const int = (v) => (Number.isInteger(v) ? v : typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : null);
const list = (v) => (Array.isArray(v) ? v : []);
const minutes = (ms) => Math.round(ms / 60e3);

/** Watchdog settings in shape: every field present, numbers clamped to their range. */
export function normSettings(raw = {}) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const clamp = (k, v) => { const n = Number(v); const [lo, hi] = RANGES[k]; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : DEFAULTS[k]; };
  const num = (k) => (o[k] == null || o[k] === '' ? DEFAULTS[k] : clamp(k, o[k]));
  return { enabled: o.enabled !== false, staleMin: num('staleMin'), graceMin: num('graceMin'), maxRetries: num('maxRetries') };
}

/** A probe in shape (null = not probed; '' = none). */
export function normProbe(p = {}, now = new Date().toISOString()) {
  const o = p && typeof p === 'object' ? p : {};
  return { pid: tri(o.pid), tmux: tri(o.tmux), lastSeenAt: iso(o.lastSeenAt), exit: int(o.exit), exitKind: EXIT_KINDS.includes(o.exitKind) ? o.exitKind : '', limit: LIMITS.includes(o.limit) ? o.limit : '', at: iso(o.at) || iso(now) || new Date().toISOString() };
}

/** The steps still to do (not done, not skipped). */
const openSteps = (b) => list(b?.steps).filter((s) => s && !s.done && !s.skip);
/** The step the session was on: the first open step. */
export const currentStep = (b) => openSteps(b)[0] ?? null;
/** The phase that step belongs to, else the pipeline's launched phase. */
export const currentPhase = (b) => str(currentStep(b)?.phase, 80) || str(b?.pipeline?.phase, 80);
/** When the build last made progress: its newest ticked step. */
export const lastProgressAt = (b) => list(b?.steps).map((s) => iso(s?.doneAt)).filter(Boolean).sort().pop() ?? '';

/**
 * Is the store saying this build is Building? running / waiting, or queued with a session from a launch newer than its
 * last recorded run end (dispatched, never moved on).
 */
export function isMarkedRunning(b) {
  if (!b || typeof b !== 'object' || b.deleted) return false;
  if (RUNNING_STATUSES.includes(b.status)) return true;
  if (b.status !== 'queued') return false;
  const p = b.pipeline ?? {};
  if (!str(p.session)) return false;
  const launched = iso(p.launchedAt) || iso(p.dispatchedAt);
  return !!launched && launched > (iso(p.lastRun?.at) || '');
}

/** The exit cause for a code. */
export const exitCause = (exit) => (Number.isInteger(exit) ? EXIT_CODES[exit] ?? 'exit-failed' : '');

/**
 * Why a build is stuck, or why it is not: { cause, stuck, exit, alive: [signal…], dead: [signal…], ageMin, heartbeatMin }.
 * `now` is the probe's `at`. A clean exit while still marked running is a missed end, not a live session.
 */
export function causeOf(b, probe, settings = DEFAULTS, now = '') {
  const p = normProbe(probe, now); const s = normSettings(settings);
  const t = Date.parse(now || p.at);
  const launched = iso(b?.pipeline?.launchedAt) || iso(b?.pipeline?.dispatchedAt);
  const ageMin = launched ? minutes(t - Date.parse(launched)) : null;
  const heartbeatMin = p.lastSeenAt ? minutes(t - Date.parse(p.lastSeenAt)) : null;
  const fresh = heartbeatMin != null && heartbeatMin < s.staleMin;
  const alive = []; const dead = [];
  if (p.pid === true) alive.push('pid'); else if (p.pid === false) dead.push('pid');
  if (p.tmux === true) alive.push('tmux'); else if (p.tmux === false) dead.push('tmux');
  if (heartbeatMin != null) (fresh ? alive : dead).push('heartbeat');
  const out = (cause) => ({ cause, stuck: STUCK_CAUSES.includes(cause), exit: p.exit, limit: p.limit, alive, dead, ageMin, heartbeatMin });
  if (p.limit === 'usage') return out('usage-limit');
  if (p.limit === 'auth') return out('auth-failed');
  if (p.exitKind === 'crash') return out(p.exit == null || p.exit === 0 ? 'exit-failed' : exitCause(p.exit));
  if (p.exit != null) return out(exitCause(p.exit));
  if (ageMin != null && ageMin < s.graceMin && p.pid !== false && p.tmux !== false) return out('starting');
  const processAlive = p.pid === true || p.tmux === true;
  if (processAlive) return out(heartbeatMin != null && !fresh ? 'stale-heartbeat' : 'live');
  // two sources agree the session is gone: stuck, however fresh the last heartbeat (it only says when it died)
  if (p.tmux === false && p.pid === false) return out('tmux-missing');
  // one source says gone, the other was not probed: a fresh heartbeat still counts as alive (one broken probe never decides alone)
  if (fresh) return out('live');
  if (p.tmux === false) return out('tmux-missing');
  if (p.pid === false) return out('pid-gone');
  if (heartbeatMin != null) return out('stale-heartbeat');
  return out('unknown');
}

/** Retries since the build last made progress, this one included. */
export function attemptOf(b, recoveries = b?.recoveries) {
  const since = lastProgressAt(b);
  return 1 + list(recoveries).filter((r) => r && RETRY_ACTIONS.includes(r.action) && (!since || str(r.at) > since)).length;
}

/**
 * The decision for one build: { stuck, cause, exit, action, attempt, account, excludeAccounts, resetStep, releaseSlot,
 * requeue, status, step, phase, banner, notify, note }. `status` is the status the build moves to ('' = unchanged).
 *   ctx.accounts  usable account names (optional): with them, an account-caused retry gives up once every one was tried
 *   ctx.now       the decision time (defaults to the probe's `at`)
 */
export function decide(b, probe, settings = DEFAULTS, ctx = {}) {
  const s = normSettings(settings);
  const now = iso(ctx.now) || normProbe(probe).at;
  const c = causeOf(b, probe, s, now);
  const account = accountName(b?.pipeline?.account);
  const step = str(currentStep(b)?.id, 40);
  const phase = currentPhase(b);
  const marked = isMarkedRunning(b);
  // stuck = the store says Building and the probe says nothing is alive; the action may still be none (watchdog off)
  const base = { stuck: marked && c.stuck, cause: c.cause, exit: c.exit, action: 'none', attempt: 0, account, excludeAccounts: [], resetStep: false, releaseSlot: false, requeue: false, status: '', step, phase, banner: false, notify: '', note: '' };
  if (!marked) return { ...base, note: `not marked running (${str(b?.status, 20) || 'no status'})` };
  if (!s.enabled) return { ...base, note: c.stuck ? 'stuck, but the watchdog is off: nothing done' : 'watchdog off' };
  if (!c.stuck) return { ...base, note: c.cause === 'live' ? `alive: ${c.alive.join(', ')}` : c.cause === 'starting' ? `launched ${c.ageMin} min ago, inside the ${s.graceMin} min grace` : 'nothing probed yet' };
  const act = (action, extra = {}) => ({ ...base, action, releaseSlot: true, requeue: action !== 'give-up', status: action === 'give-up' ? 'pending' : 'queued', resetStep: RETRY_ACTIONS.includes(action) || action === 'retry-other-account', banner: action === 'give-up', notify: action === 'give-up' ? NOTIFY.gaveUp : NOTIFY.fix, ...extra });
  const where = account ? ` on ${account}` : '';
  if (c.cause === 'usage-limit' || c.cause === 'auth-failed') {
    const tried = [...new Set([...list(b?.pipeline?.tried).map(accountName), account].filter(Boolean))];
    const usable = list(ctx.accounts).map(accountName).filter(Boolean);
    const left = usable.filter((a) => !tried.includes(a));
    const what = c.cause === 'usage-limit' ? 'hit its usage limit' : 'lost its login';
    if (usable.length && !left.length) return act('give-up', { attempt: attemptOf(b), excludeAccounts: tried, note: `${account || 'its account'} ${what} and every usable account (${tried.join(', ')}) was tried: back in Pending for Brett.` });
    return act('retry-other-account', { attempt: attemptOf(b) - 1, excludeAccounts: tried, note: `${account || 'its account'} ${what}: the build is fine, it goes back to the Queue for another account${left.length ? ` (${left.join(', ')} free)` : ''}.` });
  }
  if (c.cause === 'exit-clean') return act('requeue', { attempt: attemptOf(b) - 1, resetStep: false, note: `session${where} ended clean (exit 0) but the build stayed marked running: back in the Queue at its place.` });
  const attempt = attemptOf(b);
  const why = {
    'exit-killed': `session${where} was killed (exit 143)`, 'exit-oom': `session${where} was killed by the kernel (exit 137, out of memory)`, 'exit-failed': `session${where} failed (exit ${c.exit ?? 1})`,
    'tmux-missing': `its tmux session${where} is gone`, 'pid-gone': `its claude process${where} is gone`, 'stale-heartbeat': `no heartbeat for ${c.heartbeatMin} min (limit ${s.staleMin})${c.alive.length ? `, ${c.alive.join(' and ')} still alive: hung` : ''}`,
  }[c.cause];
  if (attempt > s.maxRetries) return act('give-up', { attempt, note: `${why}: retry ${attempt - 1} of ${s.maxRetries} was the last one, giving up: back in Pending for Brett.` });
  const action = c.cause === 'stale-heartbeat' && c.alive.length ? 'kill-retry' : 'retry';
  return act(action, { attempt, note: `${why}: ${action === 'kill-retry' ? 'session killed, ' : ''}step ${step || '?'} reset, slot released, back in the Queue (retry ${attempt} of ${s.maxRetries}).` });
}

/** A recovery record for a decision (null when the decision does nothing). */
export function recoveryRecord(b, d, { now = '', notified = '', session = '' } = {}) {
  if (!d || d.action === 'none') return null;
  return normRecovery({ at: iso(now) || new Date().toISOString(), buildId: str(b?.id, 80), phase: d.phase, step: d.step, cause: d.cause, exit: d.exit, action: d.action, attempt: d.attempt, account: d.account, notified, session: session || str(b?.pipeline?.session, 120), note: d.note });
}

/** One record in shape, or null for nothing (no action, no time, or an action that does nothing). */
export function normRecovery(r) {
  const o = r && typeof r === 'object' ? r : {};
  if (!ACTIONS.includes(o.action) || o.action === 'none' || !iso(o.at)) return null;
  const n = Number(o.attempt);
  return {
    at: iso(o.at), buildId: str(o.buildId, 80), phase: str(o.phase, 80), step: str(o.step, 40),
    cause: CAUSES.includes(o.cause) ? o.cause : 'unknown', exit: int(o.exit), action: o.action,
    attempt: Number.isInteger(n) && n >= 0 ? n : 0, account: accountName(o.account), notified: iso(o.notified),
    session: str(o.session, 120), note: str(o.note, 400),
  };
}
/** A build's recoveries in shape: oldest first, the newest MAX_RECOVERIES kept, nothing invented when there are none. */
export function normRecoveries(v) {
  const out = list(v).map(normRecovery).filter(Boolean).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return out.length > MAX_RECOVERIES ? out.slice(out.length - MAX_RECOVERIES) : out;
}

/** One plain line for the phone and the build's notes. */
export function recoveryLine(r, b = null) {
  const x = normRecovery(r); if (!x) return '';
  const title = str(b?.title, 80) || x.buildId;
  const head = x.action === 'give-up' ? 'Watchdog gave up on' : 'Watchdog fixed';
  return `${head} ${title}${x.step ? ` (step ${x.step})` : ''}: ${x.note || `${x.cause} → ${x.action}`}`;
}

export const REGISTRY = Object.freeze({ schema: SCHEMA, record: RECORD, version: VERSION, journalAction: JOURNAL_ACTION, causes: CAUSES, stuckCauses: STUCK_CAUSES, actions: ACTIONS, retryActions: RETRY_ACTIONS, limits: LIMITS, exitKinds: EXIT_KINDS, exitCodes: EXIT_CODES, notify: NOTIFY, runningStatuses: RUNNING_STATUSES, maxRecoveries: MAX_RECOVERIES, defaults: DEFAULTS });

/** The JSON Schema (framework/schemas/build-watchdog.json): the recovery record, the probe, the decision and the settings. */
export function jsonSchema() {
  const isoT = { type: 'string', format: 'date-time' };
  const isoOrNone = { type: 'string', description: 'ISO date-time, or "" for none' };
  const account = { type: 'string', pattern: '^$|^[a-z0-9][a-z0-9-]{0,31}$' };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://amberx.ai/axf/schemas/build-watchdog.json',
    title: `${SCHEMA}: stuck-build recovery (record ${RECORD})`,
    description: 'A build marked Building with no live session is reset, requeued and retried by the orchestrator; every fix is a recovery record on the build (builds@1 recoveries[], journal action watchdog-recover) and one phone FYI.',
    type: 'object', $ref: '#/$defs/recovery',
    $defs: {
      recovery: {
        type: 'object', additionalProperties: false, required: ['at', 'buildId', 'cause', 'action', 'attempt'],
        properties: {
          at: isoT, buildId: { type: 'string', minLength: 1, maxLength: 80 }, phase: { type: 'string', maxLength: 80 }, step: { type: 'string', maxLength: 40 },
          cause: { enum: STUCK_CAUSES }, exit: { type: ['integer', 'null'] }, action: { enum: ACTIONS.filter((a) => a !== 'none') },
          attempt: { type: 'integer', minimum: 0 }, account, notified: isoOrNone, session: { type: 'string', maxLength: 120 }, note: { type: 'string', maxLength: 400 },
        },
      },
      probe: {
        type: 'object', additionalProperties: false,
        properties: { pid: { type: ['boolean', 'null'] }, tmux: { type: ['boolean', 'null'] }, lastSeenAt: isoOrNone, exit: { type: ['integer', 'null'] }, exitKind: { enum: EXIT_KINDS }, limit: { enum: LIMITS }, at: isoT },
      },
      decision: {
        type: 'object', additionalProperties: false, required: ['stuck', 'cause', 'action'],
        properties: {
          stuck: { type: 'boolean' }, cause: { enum: CAUSES }, exit: { type: ['integer', 'null'] }, action: { enum: ACTIONS }, attempt: { type: 'integer', minimum: 0 }, account,
          excludeAccounts: { type: 'array', items: account }, resetStep: { type: 'boolean' }, releaseSlot: { type: 'boolean' }, requeue: { type: 'boolean' },
          status: { enum: ['', 'queued', 'pending'] }, step: { type: 'string' }, phase: { type: 'string' }, banner: { type: 'boolean' }, notify: { enum: ['', ...Object.values(NOTIFY)] }, note: { type: 'string' },
        },
      },
      settings: {
        type: 'object', additionalProperties: false,
        properties: { enabled: { type: 'boolean', default: DEFAULTS.enabled }, staleMin: { type: 'integer', minimum: RANGES.staleMin[0], maximum: RANGES.staleMin[1], default: DEFAULTS.staleMin }, graceMin: { type: 'integer', minimum: RANGES.graceMin[0], maximum: RANGES.graceMin[1], default: DEFAULTS.graceMin }, maxRetries: { type: 'integer', minimum: RANGES.maxRetries[0], maximum: RANGES.maxRetries[1], default: DEFAULTS.maxRetries } },
      },
    },
  };
}

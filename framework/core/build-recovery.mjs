/**
 * build-recovery@1 — how the orchestrator fixes a stuck build on its own (pure, IO-free).
 *
 * Brett, Nov 13 2026: "if anything stops working, the server/orchestrator fixes it automatically with no one asking.
 * Detect builds marked running with no live session (killed exit 143, failed exit 1), reset and requeue them, retry
 * failed sessions, keep every slot filled, FYI to phone per fix."
 *
 * The contract has five parts:
 *   1. STATES      the stuck states a build can be in
 *        no-session       marked running / waiting, but nothing live carries it: no tmux session, no running agent slot
 *        killed           its session ended with exit 143 / 137 (SIGTERM / SIGKILL: a restart, a deploy, the OOM killer) with steps left
 *        failed           its session ended with any other non-zero exit (1 = crash, usage limit) with steps left, or the
 *                         build sits in `failed` after the pipeline gave up on it
 *        stale-heartbeat  its session is listed live, but the heartbeat is older than the stale limit (a hung session)
 *        slot-leaked      an agent slot says it runs a build that is not running any more (built, parked, deleted, gone)
 *   2. ACTIONS     what happens for each state
 *        requeue          reset the open step (its session marker and note) and put the build back in the Queue
 *        retry            the same, for a session that ended badly (killed / failed): the session is retried on the next slot
 *        park             the retry cap is reached: back to Pending with a note; Brett decides (never silently dropped)
 *        release-slot     free a leaked slot so the dispatcher can fill it again
 *      A stale heartbeat is a `retry` with `kill` set: the executor kills the hung session first.
 *   3. the per-build retry counter and its backoff (`recovery` on a builds@1 record, kept by normBuild):
 *        { attempts, lastAt, lastCause, lastExit, nextAt, parkedAt, events }
 *      attempt n waits BACKOFF_MS[n-1] before the dispatcher may launch the build again (`nextAt`; canLaunch()). Attempts
 *      count from zero again once the build made progress (a step ticked done after the last recovery) or when a person
 *      queues it (resetRecovery()). At MAX_ATTEMPTS the build is parked.
 *   4. the recovery event record (recovery-event@1): { build, phase, cause, exit, action, attempt, at, step, session,
 *      account, slot, line } — one per fix, appended to `recovery.events` (last EVENTS_KEPT) and sent to the phone.
 *   5. plan(builds, sessions, slots, now, policy): the whole decision as a pure function. It returns the actions to
 *      apply (each with its event and phone line) and never touches a file, a session or the store; the executor
 *      (the orchestrator's tick / self-check) applies them.
 *
 * Facts the planner needs (both optional, but with neither it plans nothing: it never acts on missing facts):
 *   sessions  live tmux sessions: ['axf-x--joey', …] or [{ name, alive?, exit?, heartbeatAt? }]; alive: false with an exit
 *             code = a session that ended, still listed by whoever read it (the dispatcher's end records)
 *   slots     agent-slots@1 status: { running: [{ id, session, build, name, state }], queue: [...] }
 *
 * Never requeued: a build whose PR merged (mergedAt / complete), a deleted build, a build with no open step (built), a
 * build launched less than GRACE_MS ago (its session may still be starting), a build whose backoff is still running.
 */

export const SCHEMA = 'build-recovery@1';
export const RECORD = 'recovery-event@1';
export const VERSION = 1;

export const STATES = ['no-session', 'killed', 'failed', 'stale-heartbeat', 'slot-leaked'];
export const ACTIONS = ['requeue', 'retry', 'park', 'release-slot'];
/** The action each stuck state takes while the cap allows; at the cap every build-level state parks. */
export const ACTION_FOR = Object.freeze({ 'no-session': 'requeue', killed: 'retry', failed: 'retry', 'stale-heartbeat': 'retry', 'slot-leaked': 'release-slot' });
/** The builds@1 status each action leaves the build in ('' = unchanged). */
export const STATUS_AFTER = Object.freeze({ requeue: 'queued', retry: 'queued', park: 'pending', 'release-slot': '' });
/** Exit codes that mean the session was killed from outside (SIGTERM 143, SIGKILL 137) rather than failing on its own. */
export const KILLED_EXITS = [143, 137];
export const MAX_ATTEMPTS = 3;
/** Wait before the dispatcher may launch the build again: 1 min after the first fix, 5 after the second, 15 after the third. */
export const BACKOFF_MS = [60e3, 300e3, 900e3];
/** A just-launched build has no session for a moment; a heartbeat older than this is a hung session (Build manager: 20 min). */
export const GRACE_MS = 5 * 60e3;
export const STALE_HEARTBEAT_MS = 20 * 60e3;
/** A build the pipeline marked failed longer ago than this is left alone: old failures are Brett's, not the watchdog's. */
export const FAILED_MAX_AGE_MS = 24 * 3600e3;
export const EVENTS_KEPT = 20;

export const POLICY = Object.freeze({ maxAttempts: MAX_ATTEMPTS, backoffMs: BACKOFF_MS, graceMs: GRACE_MS, staleHeartbeatMs: STALE_HEARTBEAT_MS, failedMaxAgeMs: FAILED_MAX_AGE_MS, retryFailedBuilds: true, eventsKept: EVENTS_KEPT });

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const iso = (v) => { const s = str(v, 40).trim(); return s && Number.isFinite(Date.parse(s)) ? s : ''; };
const ms = (v) => (typeof v === 'number' ? v : Number.isFinite(Date.parse(v)) ? Date.parse(v) : NaN);
const int = (v) => (Number.isInteger(v) ? v : null);
const list = (v) => (Array.isArray(v) ? v : []);
const LIVE = ['running', 'waiting'];

// ------------------------------------------------------------------ 3. the per-build record

export function emptyRecovery() {
  return { attempts: 0, lastAt: '', lastCause: '', lastExit: null, nextAt: '', parkedAt: '', events: [] };
}

/** The `recovery` field of a builds@1 record, every field in shape; an old record without one reads as the default. */
export function normRecovery(r) {
  const o = r && typeof r === 'object' ? r : {};
  const attempts = Number.isInteger(o.attempts) && o.attempts > 0 ? o.attempts : 0;
  return {
    attempts, lastAt: iso(o.lastAt), lastCause: STATES.includes(o.lastCause) ? o.lastCause : '', lastExit: int(o.lastExit),
    nextAt: iso(o.nextAt), parkedAt: iso(o.parkedAt),
    events: list(o.events).map(normEvent).filter(Boolean).slice(-EVENTS_KEPT),
  };
}
export const isDefaultRecovery = (r) => JSON.stringify(normRecovery(r)) === JSON.stringify(emptyRecovery());
/** Read a build's recovery record (defaults for records written before build-recovery@1). */
export const recoveryOf = (b) => normRecovery(b?.recovery);

/**
 * Default the recovery record on every build of a builds@1 store that lacks one (records written before Nov 13 2026).
 * Pure: returns { store, defaulted } with a copy; `store.meta.recovery` says when it ran. Reading through normBuild gives
 * the same defaults, so the migration is a one-time write that makes the field explicit on disk.
 */
export function migrateRecovery(store, { now = new Date().toISOString() } = {}) {
  const s = JSON.parse(JSON.stringify(store ?? {}));
  let defaulted = 0;
  s.builds = list(s.builds).map((b) => { if (!b || typeof b !== 'object') return b; const had = b.recovery && typeof b.recovery === 'object'; if (!had) defaulted += 1; return { ...b, recovery: normRecovery(b.recovery) }; });
  s.meta = { ...(s.meta && typeof s.meta === 'object' ? s.meta : {}), recovery: { version: VERSION, migratedAt: iso(now) || new Date().toISOString(), defaulted } };
  return { store: s, defaulted };
}

/** The backoff after attempt n (1-based): the last entry repeats for later attempts. */
export const backoffFor = (attempt, policy = POLICY) => { const b = list(policy.backoffMs).length ? policy.backoffMs : BACKOFF_MS; return b[Math.min(Math.max(attempt, 1), b.length) - 1]; };

/** May the dispatcher launch this build now? Not while its recovery backoff runs. */
export function canLaunch(b, now = Date.now()) {
  const next = recoveryOf(b).nextAt;
  return !next || ms(next) <= ms(now);
}

/** The counter starts over: a person queued the build, or it is being re-filed. Keeps the events. */
export function resetRecovery(r, { now = new Date().toISOString(), why = '' } = {}) {
  const o = normRecovery(r);
  return { ...emptyRecovery(), events: why ? [...o.events, { $axf: RECORD, id: `reset:${iso(now)}`, build: '', phase: '', cause: '', exit: null, action: 'reset', attempt: 0, at: iso(now), step: '', session: '', account: '', slot: '', line: str(why, 300) }].slice(-EVENTS_KEPT) : o.events };
}

/** Attempts that still count: none once the build made progress after the last fix (a step ticked done since). */
export function effectiveAttempts(b) {
  const r = recoveryOf(b);
  if (!r.attempts || !r.lastAt) return r.attempts;
  const progressed = list(b?.steps).some((s) => s?.done && iso(s.doneAt) && ms(s.doneAt) > ms(r.lastAt));
  return progressed ? 0 : r.attempts;
}

/** Apply one action to a recovery record (pure): the counter, the backoff, the park mark, the event appended. */
export function applyToRecovery(r, action, policy = POLICY) {
  const o = normRecovery(r);
  if (!action || action.action === 'release-slot') return o;
  const events = [...o.events, action.event].filter(Boolean).slice(-(policy.eventsKept || EVENTS_KEPT));
  if (action.action === 'park') return { ...o, lastAt: action.at, lastCause: action.state, lastExit: int(action.exit), nextAt: '', parkedAt: action.at, events };
  return { attempts: action.attempt, lastAt: action.at, lastCause: action.state, lastExit: int(action.exit), nextAt: action.nextAt, parkedAt: '', events };
}

// ------------------------------------------------------------------ 4. the event record

export function normEvent(e) {
  if (!e || typeof e !== 'object') return null;
  const action = [...ACTIONS, 'reset'].includes(e.action) ? e.action : '';
  const at = iso(e.at);
  if (!action || !at) return null;
  return {
    $axf: RECORD, id: str(e.id, 120), build: str(e.build, 80), phase: str(e.phase, 80), cause: STATES.includes(e.cause) ? e.cause : '', exit: int(e.exit),
    action, attempt: Number.isInteger(e.attempt) && e.attempt >= 0 ? e.attempt : 0, at,
    step: str(e.step, 40), session: str(e.session, 120), account: str(e.account, 40), slot: str(e.slot, 60), line: str(e.line, 300),
  };
}

/** Is this a recovery-event@1? Names what is wrong instead of coercing. */
export function validateEvent(e) {
  const errors = [];
  if (!e || typeof e !== 'object') return { ok: false, errors: [{ field: 'event', message: 'must be an object' }] };
  if (![...ACTIONS, 'reset'].includes(e.action)) errors.push({ field: 'action', message: `one of ${ACTIONS.join(', ')}` });
  if (!iso(e.at)) errors.push({ field: 'at', message: 'ISO timestamp' });
  if (e.action !== 'reset' && !str(e.build) && !str(e.slot)) errors.push({ field: 'build', message: 'a build id (or a slot for release-slot)' });
  if (e.cause !== undefined && e.cause !== '' && !STATES.includes(e.cause)) errors.push({ field: 'cause', message: `one of ${STATES.join(', ')}` });
  if (e.exit !== undefined && e.exit !== null && !Number.isInteger(e.exit)) errors.push({ field: 'exit', message: 'an exit code or null' });
  if (e.attempt !== undefined && !(Number.isInteger(e.attempt) && e.attempt >= 0)) errors.push({ field: 'attempt', message: 'a whole number' });
  return { ok: !errors.length, errors };
}

// ------------------------------------------------------------------ 5. the plan

const sessionRows = (sessions) => list(sessions).map((s) => (typeof s === 'string' ? { name: s, alive: true } : s && typeof s === 'object' ? { name: str(s.name || s.session, 120), alive: s.alive !== false, exit: int(s.exit), heartbeatAt: iso(s.heartbeatAt || s.lastSeenAt || s.at) } : null)).filter((s) => s && s.name);
const slotRows = (slots) => ({ running: list(slots?.running), queue: list(slots?.queue) });
const openSteps = (b) => list(b?.steps).filter((s) => s && !s.done && !s.skip);
const launchedAt = (b) => { const p = b?.pipeline ?? {}; return iso(p.launchedAt) || iso(p.dispatchedAt) || iso(b?.updatedAt) || ''; };

/** What an exit code means: killed from outside, failed on its own, or (0 / unknown) a session that is simply gone. */
export const causeOfExit = (exit) => (int(exit) === null || exit === 0 ? 'no-session' : KILLED_EXITS.includes(exit) ? 'killed' : 'failed');

/**
 * One build's stuck state against the facts. Returns { state, exit, session, slot, why } with state '' when healthy
 * (why says why: healthy, merged, deleted, launching, backoff, no steps left, not live, failed too long ago, no facts).
 */
export function assess(b, { sessions = null, slots = null, now = Date.now(), policy = POLICY } = {}) {
  const t = ms(now);
  const p = b?.pipeline ?? {};
  const out = { id: str(b?.id, 80), state: '', exit: null, session: str(p.session, 120), slot: str(p.slot, 60), account: str(p.account, 40), why: '' };
  const done = (why) => ({ ...out, why });
  if (!b || typeof b !== 'object') return done('no build');
  if (b.deleted) return done('deleted');
  if (iso(b.mergedAt) || b.status === 'complete' || b.status === 'archived') return done('merged');
  if (sessions == null && slots == null) return done('no facts');
  if (!openSteps(b).length) return done('no steps left');
  const next = recoveryOf(b).nextAt;
  if (next && ms(next) > t) return done('backoff');
  const sess = sessionRows(sessions); const sl = slotRows(slots);
  const mine = (x) => x && ((out.slot && x.id === out.slot) || (out.session && x.session === out.session) || x.build === b.id);
  if (b.status === 'failed') {
    if (!policy.retryFailedBuilds) return done('not live');
    const at = iso(p.lastRun?.at) || iso(b.updatedAt);
    if (at && t - ms(at) > policy.failedMaxAgeMs) return done('failed too long ago');
    const exit = int(p.lastRun?.exit);
    return { ...out, state: 'failed', exit, why: `failed after ${p.runs || 0} run(s)${exit === null ? '' : ` (exit ${exit})`}` };
  }
  if (!LIVE.includes(b.status)) return done('not live');
  const row = out.session ? sess.find((s) => s.name === out.session) : null;
  const slotLive = sl.running.some(mine);
  if (row?.alive) {
    if (row.heartbeatAt && t - ms(row.heartbeatAt) > policy.staleHeartbeatMs) return { ...out, state: 'stale-heartbeat', why: `heartbeat ${Math.round((t - ms(row.heartbeatAt)) / 60e3)} min old` };
    return done('healthy');
  }
  if (!row && slotLive) return done('healthy'); // its slot runs; the session name is not known to us (another host's read)
  const since = launchedAt(b);
  if (since && t - ms(since) < policy.graceMs) return done('launching');
  const exit = row && !row.alive ? row.exit : (p.lastRun && (!out.session || p.lastRun.session === out.session) && iso(p.lastRun.at) && (!since || ms(p.lastRun.at) >= ms(since)) ? int(p.lastRun.exit) : null);
  const state = exit === null && !row ? 'no-session' : causeOfExit(exit);
  return { ...out, state, exit, why: state === 'no-session' ? `marked ${b.status}, nothing live carries it` : `session ended with exit ${exit}` };
}

const phaseOf = (b) => { const s = openSteps(b)[0]; return str(s?.phase, 80) || str(s?.model, 20); };
const title = (b) => str(b?.title, 80) || str(b?.id, 80);

/** The one plain line the phone gets for an action (Amber: what broke, what was done). */
export function fyiLine(b, a) {
  const t = title(b);
  const broke = a.state === 'no-session' ? 'was marked running with no live session' : a.state === 'killed' ? `session killed (exit ${a.exit})` : a.state === 'failed' ? `session failed${a.exit === null ? '' : ` (exit ${a.exit})`}` : a.state === 'stale-heartbeat' ? 'session hung (no heartbeat)' : `slot ${a.slot} held a build that is not running`;
  if (a.action === 'release-slot') return `Fixed: ${broke}. Slot released.`;
  if (a.action === 'park') return `Parked: ${t} ${broke} again after ${a.attempt} automatic retries. Back in Pending for you.`;
  return `Fixed: ${t} ${broke}. Back in the Queue, try ${a.attempt} of ${a.max}${a.delayMs ? `, next launch in ${Math.round(a.delayMs / 60e3)} min` : ''}.`;
}

/**
 * The actions to apply now, in build order, then leaked slots. Pure: no side effects. Each action:
 *   { action, build, state, exit, step, session, slot, account, attempt, max, delayMs, nextAt, kill, status, at, line, event }
 * `kill` names a session the executor must end before requeueing (stale heartbeat). `status` is the build status after.
 */
export function plan(builds, sessions = null, slots = null, now = Date.now(), policy = POLICY) {
  const t = ms(now); const at = new Date(t).toISOString();
  const pol = { ...POLICY, ...(policy ?? {}) };
  const out = [];
  if (sessions == null && slots == null) return out;
  const byId = new Map();
  for (const b of list(builds)) {
    if (!b || typeof b !== 'object') continue;
    byId.set(b.id, b);
    const a = assess(b, { sessions, slots, now: t, policy: pol });
    if (!a.state) continue;
    const attempt = effectiveAttempts(b) + 1;
    const park = attempt > pol.maxAttempts;
    const action = park ? 'park' : ACTION_FOR[a.state];
    const delayMs = park ? 0 : backoffFor(attempt, pol);
    const step = openSteps(b)[0];
    const row = { action, build: b.id, state: a.state, exit: a.exit, step: str(step?.id, 40), session: a.session, slot: a.slot, account: a.account, attempt: park ? attempt - 1 : attempt, max: pol.maxAttempts, delayMs, nextAt: park ? '' : new Date(t + delayMs).toISOString(), kill: a.state === 'stale-heartbeat' ? a.session : '', status: STATUS_AFTER[action], at, line: '', event: null };
    row.line = fyiLine(b, row);
    row.event = normEvent({ id: `${b.id}:${action}:${row.attempt}:${at}`, build: b.id, phase: phaseOf(b), cause: a.state, exit: a.exit, action, attempt: row.attempt, at, step: row.step, session: a.session, account: a.account, slot: a.slot, line: row.line });
    out.push(row);
  }
  // leaked slots: a running slot that names a build no longer live (or one we were just told to requeue / park)
  const moved = new Set(out.map((r) => r.build));
  for (const s of slotRows(slots).running) {
    const id = str(s?.build, 80); if (!id) continue;
    const b = byId.get(id);
    const live = b && LIVE.includes(b.status) && !b.deleted && !moved.has(id);
    if (live) continue;
    const row = { action: 'release-slot', build: id, state: 'slot-leaked', exit: null, step: '', session: str(s.session, 120), slot: str(s.id, 60), account: str(b?.pipeline?.account, 40), attempt: 0, max: pol.maxAttempts, delayMs: 0, nextAt: '', kill: '', status: '', at, line: '', event: null };
    row.line = fyiLine(b, row);
    row.event = normEvent({ id: `${id}:release-slot:${row.slot}:${at}`, build: id, phase: phaseOf(b), cause: 'slot-leaked', exit: null, action: 'release-slot', attempt: 0, at, step: '', session: row.session, account: row.account, slot: row.slot, line: row.line });
    out.push(row);
  }
  return out;
}

/** The step fields a requeue resets on the open step (its session marker and note; text, model and files stay). */
export const STEP_RESET = Object.freeze({ note: '' });

// ------------------------------------------------------------------ registry + JSON Schemas (framework/schemas)

export const REGISTRY = Object.freeze({ schema: SCHEMA, record: RECORD, version: VERSION, states: STATES, actions: ACTIONS, actionFor: ACTION_FOR, statusAfter: STATUS_AFTER, killedExits: KILLED_EXITS, policy: POLICY, recovery: Object.keys(emptyRecovery()), stepReset: STEP_RESET });

export function jsonSchemas() {
  const event = {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://amberx.ai/axf/schemas/recovery-event.schema.json',
    title: 'recovery-event@1 (build-recovery@1 record: one automatic fix)', type: 'object', additionalProperties: false, required: ['action', 'at'],
    properties: {
      $axf: { const: RECORD }, id: { type: 'string' }, build: { type: 'string' }, phase: { type: 'string' }, cause: { enum: [...STATES, ''] }, exit: { type: ['integer', 'null'] },
      action: { enum: [...ACTIONS, 'reset'] }, attempt: { type: 'integer', minimum: 0 }, at: { type: 'string', format: 'date-time' },
      step: { type: 'string' }, session: { type: 'string' }, account: { type: 'string' }, slot: { type: 'string' }, line: { type: 'string' },
    },
  };
  return {
    'recovery-event.schema.json': event,
    'build-recovery.schema.json': {
      $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://amberx.ai/axf/schemas/build-recovery.schema.json',
      title: 'build-recovery@1 (the `recovery` field of a builds@1 record)', type: 'object', additionalProperties: false,
      required: ['attempts', 'lastAt', 'lastCause', 'lastExit', 'nextAt', 'parkedAt', 'events'],
      properties: {
        attempts: { type: 'integer', minimum: 0 }, lastAt: { type: 'string' }, lastCause: { enum: [...STATES, ''] }, lastExit: { type: ['integer', 'null'] },
        nextAt: { type: 'string' }, parkedAt: { type: 'string' }, events: { type: 'array', maxItems: EVENTS_KEPT, items: { $ref: 'recovery-event.schema.json' } },
      },
    },
  };
}

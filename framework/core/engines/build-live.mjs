/**
 * build-live@1 — build changes and liveness on the console live channel (pure, IO-free). Spec: framework/spec/BUILD-LIVE.md.
 *
 * Brett, Nov 17 2026: "Every time something happens, I want the console to be updated in real time. The VPS checks every
 * 15 seconds to make sure the jobs are running and updates the console. Every running job in any grid has a spinning or
 * animated icon, and building rows flash slowly; configure the animation, flash, pulse, colors. When it stops it goes
 * red, a pink background with a pop-up alert that says broke, and a dialog shows what happened."
 *
 * One event (build-live-event@1) per builds store change (`change`), per 15-second liveness pass (`liveness`), per
 * recovery the watchdog makes (`watchdog`) and per full state sent on connect (`snapshot`), pushed as one SSE frame
 * (`event: build-live`, `id: seq`). This module:
 *
 *   normEvent / validateEvent      a raw frame in shape (null = refused) / the fields that are wrong
 *   aliveOf                        the liveness verdict from a build-watchdog@1 cause (alive, stale, dead, unknown, none)
 *   livenessEvent / changeEvent / watchdogEvent / snapshotEvent    build the four kinds from what the producers have
 *   stateOf                        the row's live state: idle, running, stale, broke, done (the rule in the spec)
 *   fold / foldAll                 fold events into one build-live-state@1 per build, dedupe repeats and replays
 *   brokeWhat / stateLine          the plain words the alert, the dialog and the voice side say
 *   snapshot                       build-live-snapshot@1 over the folded states
 *   jsonSchema                     framework/schemas/build-live.json
 *
 * Liveness reuses the recovery watchdog's verdicts (build-watchdog@1: causeOf → cause, decide → action) and the
 * stale-row watchdog's (stale-row@1: classify → action + reason) and adds no check of its own. Fixture:
 * framework/spec/fixtures/build-live.json (spec/check-build-live.mjs). Kotlin twin deferred (PORTING.md).
 */
import { ACTIONS as WATCHDOG_ACTIONS, CAUSES, RUNNING_STATUSES } from '../build-watchdog.mjs';
import { ACTIONS as STALE_ACTIONS, REASON_CODES as STALE_REASONS } from '../stale-rows.mjs';
import { BUILD_STATUSES, EVENTS as CHANGE_EVENTS } from '../build-hook.mjs';
import { signalOf } from '../build-pipeline.mjs';

export const SCHEMA = 'build-live@1';
export const EVENT = 'build-live-event@1';
export const STATE = 'build-live-state@1';
export const SNAPSHOT = 'build-live-snapshot@1';
export const VERSION = 1;
/** The SSE event name every frame carries on the console live channel. */
export const SSE_EVENT = 'build-live';
export const KINDS = Object.freeze(['change', 'liveness', 'watchdog', 'snapshot']);
export const ALIVE = Object.freeze(['alive', 'stale', 'dead', 'unknown', 'none']);
export const STATES = Object.freeze(['idle', 'running', 'stale', 'broke', 'done']);
export const STATE_LABEL = Object.freeze({ idle: 'Idle', running: 'Running', stale: 'Stale', broke: 'Broke', done: 'Done' });
/** builds@1 statuses the fold treats as Building (the watchdog's two plus fixing). */
export const LIVE_STATUSES = Object.freeze([...RUNNING_STATUSES, 'fixing']);
/** Statuses that are broke on their own, whatever liveness says. */
export const BROKE_STATUSES = Object.freeze(['failed', 'escalated', 'blocked']);
/** Statuses that are done. */
export const DONE_STATUSES = Object.freeze(['built', 'landing', 'landed', 'complete']);
/** Watchdog actions that mean it is on the build (not none, not give-up). */
export const RECOVERING_ACTIONS = Object.freeze(['requeue', 'retry', 'retry-other-account', 'kill-retry']);
/** How often the VPS pass runs, and the range a setting may give it. */
export const DEFAULT_EVERY_SEC = 15;
export const EVERY_SEC_RANGE = Object.freeze([5, 300]);
/** A client that sees no liveness for this many passes shows the channel as stale. */
export const STALE_PASSES = 3;
/** Frames the publisher keeps for Last-Event-ID replay. */
export const LIVE_RING = 2000;
/** Phone notification (notify.json type) when a row goes broke: once per broke.at. */
export const NOTIFY = Object.freeze({ broke: 'build-live.broke' });
/** Console control addresses (console-control@1): the row and the dialog. */
export const TARGETS = Object.freeze({ row: (build) => `view:build-orchestrator/row:${build}`, dialog: (build) => `dialog:build-live/${build}` });

const BUILD_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v) => (Number.isInteger(v) ? v : typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : null);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** ISO with milliseconds, '' for anything that is not a time. */
export const iso = (v) => { const s = str(v, 40).trim(); if (!s) return ''; const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString() : ''; };
const inList = (list, v, dflt = '') => (list.includes(v) ? v : dflt);

/** The liveness verdict from a build-watchdog@1 cause. `processAlive` = pid or tmux seen; `markedRunning` = the store says Building. */
export function aliveOf(cause, processAlive = null, markedRunning = true) {
  if (markedRunning === false) return 'none';
  if (!CAUSES.includes(cause) || cause === 'unknown') return 'unknown';
  if (cause === 'live' || cause === 'starting') return 'alive';
  if (cause === 'stale-heartbeat') return processAlive === true ? 'stale' : 'dead';
  return 'dead';
}

const normStep = (s) => {
  if (!isObj(s)) return null;
  const id = str(s.id, 40).trim(); if (!id) return null;
  const n = (v) => { const x = int(v); return x != null && x >= 0 ? x : 0; };
  return { id, title: str(s.title, 200), phase: str(s.phase, 80), index: n(s.index), total: n(s.total) };
};
const normLastStep = (s) => {
  if (!isObj(s)) return null;
  const id = str(s.id, 40).trim(); if (!id) return null;
  return { id, title: str(s.title, 200), doneAt: iso(s.doneAt) };
};
const normWatchdog = (w) => {
  const o = isObj(w) ? w : {};
  const n = int(o.attempt);
  return { action: inList(WATCHDOG_ACTIONS, o.action, ''), attempt: n != null && n >= 0 ? n : 0, note: str(o.note, 400), at: iso(o.at) };
};
const normStale = (s) => (isObj(s) && STALE_ACTIONS.includes(s.action) && STALE_REASONS.includes(s.reason) ? { action: s.action, reason: s.reason } : null);
const normEverySec = (v) => { const n = int(v); return n != null && n >= EVERY_SEC_RANGE[0] && n <= EVERY_SEC_RANGE[1] ? n : 0; };
export const eventId = (build, kind, seq) => `${build}:${kind}:${seq}`;

/**
 * A raw frame in shape, every field present ('' / null / 0 for none); null when it is not an event at all (no kind,
 * no build id, no time, no seq). Junk in an optional field reads as none, never as a claim.
 */
export function normEvent(raw) {
  if (!isObj(raw)) return null;
  const kind = inList(KINDS, raw.kind, '');
  const build = str(raw.build, 80).trim();
  const at = iso(raw.at);
  const seq = int(raw.seq);
  if (!kind || !BUILD_RE.test(build) || !at || seq == null || seq < 1) return null;
  const exit = int(raw.exit);
  const alive = inList(ALIVE, raw.alive, '');
  return {
    $axf: EVENT,
    id: eventId(build, kind, seq),
    seq, kind, build,
    title: str(raw.title, 160),
    at,
    by: str(raw.by, 80),
    status: inList(BUILD_STATUSES, raw.status, 'pending'),
    step: normStep(raw.step),
    lastStep: normLastStep(raw.lastStep),
    alive: alive || 'unknown',
    cause: inList(CAUSES, raw.cause, ''),
    exit,
    signal: str(raw.signal, 8) || (exit != null ? signalOf(exit) : ''),
    watchdog: normWatchdog(raw.watchdog),
    stale: normStale(raw.stale),
    change: inList(CHANGE_EVENTS, raw.change, ''),
    everySec: normEverySec(raw.everySec),
    note: str(raw.note, 400),
  };
}

/** The fields of a frame that are wrong (empty = valid). Mirrors framework/schemas/build-live.json. */
export function validateEvent(raw) {
  if (!isObj(raw)) return ['event'];
  const errors = [];
  if (raw.$axf !== EVENT) errors.push('$axf');
  if (typeof raw.id !== 'string' || !raw.id || raw.id.length > 200) errors.push('id');
  if (!Number.isInteger(raw.seq) || raw.seq < 1) errors.push('seq');
  if (!KINDS.includes(raw.kind)) errors.push('kind');
  if (typeof raw.build !== 'string' || !BUILD_RE.test(raw.build)) errors.push('build');
  if (raw.title !== undefined && (typeof raw.title !== 'string' || raw.title.length > 160)) errors.push('title');
  if (!iso(raw.at)) errors.push('at');
  if (raw.by !== undefined && (typeof raw.by !== 'string' || raw.by.length > 80)) errors.push('by');
  if (!BUILD_STATUSES.includes(raw.status)) errors.push('status');
  if (raw.step !== undefined && raw.step !== null && !(isObj(raw.step) && normStep(raw.step))) errors.push('step');
  if (raw.lastStep !== undefined && raw.lastStep !== null && !(isObj(raw.lastStep) && normLastStep(raw.lastStep))) errors.push('lastStep');
  if (!ALIVE.includes(raw.alive)) errors.push('alive');
  if (raw.cause !== undefined && raw.cause !== '' && !CAUSES.includes(raw.cause)) errors.push('cause');
  if (raw.exit !== undefined && raw.exit !== null && !Number.isInteger(raw.exit)) errors.push('exit');
  if (raw.signal !== undefined && (typeof raw.signal !== 'string' || raw.signal.length > 8)) errors.push('signal');
  if (raw.watchdog !== undefined && !(isObj(raw.watchdog) && (raw.watchdog.action === '' || WATCHDOG_ACTIONS.includes(raw.watchdog.action)))) errors.push('watchdog');
  if (raw.stale !== undefined && raw.stale !== null && !normStale(raw.stale)) errors.push('stale');
  if (raw.change !== undefined && raw.change !== '' && !CHANGE_EVENTS.includes(raw.change)) errors.push('change');
  if (raw.everySec !== undefined && raw.everySec !== 0 && !normEverySec(raw.everySec)) errors.push('everySec');
  if (raw.note !== undefined && (typeof raw.note !== 'string' || raw.note.length > 400)) errors.push('note');
  return errors;
}

/* ---------------- producers: the four kinds from what the VPS has ---------------- */

const openSteps = (b) => (Array.isArray(b?.steps) ? b.steps : []).filter((s) => s && !s.done && !s.skip);
/** The step a build is on (the first open step) as the event carries it. */
export function stepOf(b) {
  const steps = Array.isArray(b?.steps) ? b.steps : [];
  const cur = openSteps(b)[0];
  if (!cur) return null;
  return normStep({ id: cur.id, title: cur.title ?? cur.text ?? '', phase: cur.phase ?? '', index: steps.indexOf(cur) + 1, total: steps.length });
}
/** The newest ticked step. */
export function lastStepOf(b) {
  const done = (Array.isArray(b?.steps) ? b.steps : []).filter((s) => s && s.done).sort((a, c) => (iso(a.doneAt) < iso(c.doneAt) ? -1 : iso(a.doneAt) > iso(c.doneAt) ? 1 : 0));
  const s = done[done.length - 1];
  return s ? normLastStep({ id: s.id, title: s.title ?? s.text ?? '', doneAt: s.doneAt }) : null;
}
const base = (b, kind, seq, at, by) => ({ kind, seq, build: str(b?.id, 80), title: str(b?.title, 160), at: iso(at) || new Date().toISOString(), by, status: str(b?.status, 20), step: stepOf(b), lastStep: lastStepOf(b) });

/**
 * A `liveness` event from the recovery watchdog's cause (`causeOf(b, probe)` → { cause, alive: [signals], exit }) and,
 * when it decided, its decision ({ action, attempt, note }); `stale` = the stale-row@1 verdict on the row when looked up.
 */
export function livenessEvent(b, cause, { seq, at = '', decision = null, stale = null, everySec = DEFAULT_EVERY_SEC, markedRunning = true } = {}) {
  const c = isObj(cause) ? cause : { cause: str(cause, 40) };
  const processAlive = Array.isArray(c.alive) ? c.alive.includes('pid') || c.alive.includes('tmux') : null;
  const alive = aliveOf(c.cause, processAlive, markedRunning);
  return normEvent({
    ...base(b, 'liveness', seq, at, 'liveness'),
    alive, cause: alive === 'none' ? '' : c.cause, exit: c.exit ?? null,
    watchdog: decision ? { action: decision.action, attempt: decision.attempt, note: decision.note, at: at || decision.at } : undefined,
    stale: stale ? { action: stale.action, reason: stale.reason } : null,
    everySec,
    note: alive === 'alive' && Array.isArray(c.alive) && c.alive.length ? `alive: ${c.alive.join(', ')}` : str(decision?.note, 400),
  });
}
/** A `change` event from one build-event@1 (build-hook@1) and the build record after the write. */
export function changeEvent(b, buildEvent, { seq, alive = undefined } = {}) {
  const e = isObj(buildEvent) ? buildEvent : {};
  const status = str(b?.status, 20) || str(e.build?.status, 20);
  return normEvent({ ...base({ ...b, status }, 'change', seq, e.at, `store:${str(e.by, 60) || 'store'}`), change: e.event, alive: alive ?? (LIVE_STATUSES.includes(status) ? 'unknown' : 'none') });
}
/** A `watchdog` event from a recovery record (watchdog-recovery@1) and the build after the recovery. */
export function watchdogEvent(b, recovery, { seq, alive = 'dead' } = {}) {
  const r = isObj(recovery) ? recovery : {};
  return normEvent({ ...base(b, 'watchdog', seq, r.at, 'watchdog'), alive, cause: r.cause, exit: r.exit ?? null, watchdog: { action: r.action, attempt: r.attempt, note: r.note, at: r.at } });
}
/** A `snapshot` event from a folded state (what a client gets on connect). */
export function snapshotEvent(state, { seq, at = '', everySec = DEFAULT_EVERY_SEC } = {}) {
  const s = isObj(state) ? state : {};
  return normEvent({ kind: 'snapshot', seq, build: s.build, title: s.title, at: at || s.at, by: 'snapshot', status: s.status, step: s.step, lastStep: s.lastStep, alive: s.alive, cause: s.cause, exit: s.exit, signal: s.signal, watchdog: s.watchdog, stale: s.stale, everySec, note: s.line });
}

/* ---------------- the fold ---------------- */

/** True when the store or the liveness verdict says the build is Building. */
export const markedRunning = (status, alive) => LIVE_STATUSES.includes(status) || (ALIVE.includes(alive) && alive !== 'none');

/** The row's live state from what the state holds (the rule in BUILD-LIVE.md, first that fires wins). */
export function stateOf({ status = '', alive = 'none', cause = '', watchdog = null } = {}) {
  if (BROKE_STATUSES.includes(status)) return 'broke';
  if (watchdog?.action === 'give-up') return 'broke';
  const running = markedRunning(status, alive);
  if (running && alive === 'dead') return cause === 'exit-clean' ? 'running' : 'broke';
  if (running && alive === 'stale') return 'stale';
  if (running) return 'running';
  if (DONE_STATUSES.includes(status)) return 'done';
  return 'idle';
}

/** Plain words for why a row broke (the alert line and the dialog's first line). */
export function brokeWhat({ status = '', cause = '', exit = null, signal = '', watchdog = null, note = '' } = {}) {
  const ex = exit != null ? ` (exit ${exit}${signal ? `, ${signal}` : ''})` : '';
  if (watchdog?.action === 'give-up') return `the watchdog gave up${watchdog.attempt ? ` after ${Math.max(0, watchdog.attempt - 1)} retries` : ''}${ex}`;
  if (status === 'failed') return `the build failed${note ? `: ${note}` : ex}`;
  if (status === 'escalated') return `escalated: the server ran out of retries${note ? ` (${note})` : ''}`;
  if (status === 'blocked') return `blocked${note ? `: ${note}` : ''}`;
  const words = {
    'exit-killed': `the session was killed${ex}`, 'exit-oom': `the session was killed by the kernel, out of memory${ex}`, 'exit-failed': `the session failed${ex}`,
    'tmux-missing': 'its tmux session is gone', 'pid-gone': 'its claude process is gone', 'stale-heartbeat': 'no heartbeat and nothing alive',
    'usage-limit': 'its account hit the usage limit', 'auth-failed': 'its account lost its login', 'exit-clean': `the session ended${ex}`,
  };
  return words[cause] ?? (note || 'the session stopped');
}

/** One plain line for the row's tooltip, the voice side and the log. */
export function stateLine(s) {
  const name = s.title || s.build;
  const parts = [name, STATE_LABEL[s.state]?.toLowerCase() ?? s.state];
  if (s.step?.id) parts.push(s.step.total ? `${s.step.id} (${s.step.index} of ${s.step.total})` : s.step.id);
  if (s.state === 'broke' && s.broke) parts.push(s.broke.what);
  else if (s.state === 'stale') parts.push(s.note || 'alive but silent');
  else if (s.state === 'running' && s.alive === 'alive') parts.push('alive');
  else if (s.state === 'done' || s.state === 'idle') parts.push(s.status);
  if (s.watchdog?.action && s.watchdog.action !== 'none') parts.push(`watchdog: ${s.watchdog.action}${s.watchdog.attempt ? ` ${s.watchdog.attempt}` : ''}`);
  return parts.join(' · ').slice(0, 300);
}

/** An empty state for a build: nothing folded yet. */
export function emptyState(build) {
  return {
    $axf: STATE, build: str(build, 80), title: '', status: 'pending', state: 'idle', step: null, lastStep: null,
    alive: 'none', cause: '', exit: null, signal: '', watchdog: { action: '', attempt: 0, note: '', at: '' }, stale: null,
    broke: null, lastBroke: null, recovering: false, lastChange: null,
    at: '', checkedAt: '', seen: { change: '', liveness: '', watchdog: '', snapshot: '' }, seq: 0, events: 0, note: '', line: '',
  };
}

/** What the grid draws: a change in any of these is a change. */
const projection = (s) => JSON.stringify([s.status, s.state, s.step?.id ?? '', s.lastStep?.id ?? '', s.alive, s.cause, s.exit, s.watchdog.action, s.watchdog.attempt, s.stale, s.broke?.at ?? '', s.recovering, s.lastChange, s.title]);

/**
 * Fold one event into a state: { state, changed, dropped }. `dropped` says why nothing was folded ('' = folded):
 * 'invalid' (not an event), 'other-build', 'replay' (seq already seen), 'older' (an older frame of the same kind).
 * A liveness pass that changes nothing the grid draws moves checkedAt / seq / events only and reports changed: false.
 */
export function fold(state, raw) {
  const s = isObj(state) && state.$axf === STATE ? state : emptyState(raw?.build);
  const ev = raw?.$axf === EVENT && raw.id ? raw : normEvent(raw);
  if (!ev) return { state: s, changed: false, dropped: 'invalid' };
  if (s.build && ev.build !== s.build) return { state: s, changed: false, dropped: 'other-build' };
  if (ev.seq <= s.seq) return { state: s, changed: false, dropped: 'replay' };
  if (s.seen[ev.kind] && ev.at < s.seen[ev.kind]) return { state: s, changed: false, dropped: 'older' };

  const before = projection(s);
  const n = { ...s, seen: { ...s.seen, [ev.kind]: ev.at }, seq: ev.seq, events: s.events + 1, at: ev.at > s.at ? ev.at : s.at };
  n.build = ev.build;
  if (ev.title) n.title = ev.title;
  n.status = ev.status;
  // a change / snapshot carries the steps as the store has them; liveness and watchdog carry them when they looked
  if (ev.kind === 'change' || ev.kind === 'snapshot' || ev.step || ev.lastStep) { n.step = ev.step; n.lastStep = ev.lastStep ?? (ev.kind === 'change' || ev.kind === 'snapshot' ? null : s.lastStep); }
  if (ev.kind === 'change') {
    n.lastChange = { event: ev.change, at: ev.at, by: ev.by };
    // the store moved the build: a status that is not Building clears the liveness verdict (nothing to check now)
    if (!LIVE_STATUSES.includes(ev.status)) { n.alive = 'none'; n.cause = ''; n.exit = null; n.signal = ''; }
    else if (ev.alive !== 'unknown') { n.alive = ev.alive; n.cause = ev.cause; n.exit = ev.exit; n.signal = ev.signal; }
  } else {
    n.alive = ev.alive; n.cause = ev.cause; n.exit = ev.exit; n.signal = ev.signal;
    n.checkedAt = ev.kind === 'liveness' ? ev.at : s.checkedAt;
  }
  if (ev.watchdog.action) n.watchdog = ev.watchdog;
  else if (ev.kind === 'change' && !LIVE_STATUSES.includes(ev.status) && s.watchdog.action && s.watchdog.action !== 'give-up') n.watchdog = { action: '', attempt: 0, note: '', at: '' }; // the store moved on: the watchdog's part is over
  if (ev.stale !== null || ev.kind === 'snapshot') n.stale = ev.stale;
  if (ev.note) n.note = ev.note;

  n.state = stateOf(n);
  n.recovering = RECOVERING_ACTIONS.includes(n.watchdog.action) && (n.state === 'broke' || n.state === 'stale');
  if (n.state === 'broke') {
    const what = brokeWhat({ status: n.status, cause: n.cause, exit: n.exit, signal: n.signal, watchdog: n.watchdog, note: ev.note });
    n.broke = s.broke ? { ...s.broke, recovering: n.recovering, ...(n.watchdog.action === 'give-up' || BROKE_STATUSES.includes(n.status) ? { what } : {}) } : { at: ev.at, cause: n.cause, exit: n.exit, signal: n.signal, what, recovering: n.recovering };
  } else if (s.broke) { n.lastBroke = s.broke; n.broke = null; }
  n.line = stateLine(n);
  return { state: n, changed: projection(n) !== before, dropped: '' };
}

/** Fold a whole stream (any builds, in order) into Map<build, state>; invalid frames are skipped. */
export function foldAll(events, states = new Map()) {
  for (const raw of Array.isArray(events) ? events : []) {
    const ev = normEvent(raw); if (!ev) continue;
    const r = fold(states.get(ev.build) ?? emptyState(ev.build), ev);
    if (!r.dropped) states.set(ev.build, r.state);
  }
  return states;
}

/** build-live-snapshot@1 over folded states. */
export function snapshot(states, { at = '', seq = 0, everySec = DEFAULT_EVERY_SEC } = {}) {
  const list = states instanceof Map ? [...states.values()] : Array.isArray(states) ? states : [];
  const top = list.reduce((m, s) => Math.max(m, s.seq ?? 0), 0);
  return { $axf: SNAPSHOT, at: iso(at) || new Date().toISOString(), seq: Math.max(seq, top), everySec: normEverySec(everySec) || DEFAULT_EVERY_SEC, builds: list.map((s) => ({ ...s })) };
}

/** True when a client should show the channel as stale: no liveness for STALE_PASSES passes. */
export const channelStale = (lastLivenessAt, now, everySec = DEFAULT_EVERY_SEC) => { const t = Date.parse(lastLivenessAt || ''); return !Number.isFinite(t) || Date.parse(now) - t > STALE_PASSES * everySec * 1000; };

export const REGISTRY = Object.freeze({
  schema: SCHEMA, event: EVENT, state: STATE, snapshot: SNAPSHOT, version: VERSION, sseEvent: SSE_EVENT, kinds: KINDS, alive: ALIVE, states: STATES,
  liveStatuses: LIVE_STATUSES, brokeStatuses: BROKE_STATUSES, doneStatuses: DONE_STATUSES, recoveringActions: RECOVERING_ACTIONS,
  everySec: DEFAULT_EVERY_SEC, everySecRange: EVERY_SEC_RANGE, stalePasses: STALE_PASSES, ring: LIVE_RING, notify: NOTIFY,
});

/** The JSON Schema (framework/schemas/build-live.json): the event, the state and the snapshot. */
export function jsonSchema() {
  const isoT = { $ref: '#/$defs/iso' }; const isoOrNone = { $ref: '#/$defs/isoOrNone' };
  const exit = { type: ['integer', 'null'] }; const signal = { type: 'string', maxLength: 8 }; const title = { type: 'string', maxLength: 160 };
  const everySec = { anyOf: [{ const: 0 }, { type: 'integer', minimum: EVERY_SEC_RANGE[0], maximum: EVERY_SEC_RANGE[1] }], description: `how often the liveness pass runs (${DEFAULT_EVERY_SEC}); carried on liveness and snapshot, 0 = not carried` };
  const shared = { step: { $ref: '#/$defs/step' }, lastStep: { $ref: '#/$defs/lastStep' }, alive: { $ref: '#/$defs/alive' }, cause: { $ref: '#/$defs/cause' }, exit, signal, watchdog: { $ref: '#/$defs/watchdog' }, stale: { $ref: '#/$defs/stale' } };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://amberx.ai/axf/schemas/build-live.json',
    title: `${SCHEMA}: build changes and liveness on the console live channel (${EVENT}, ${STATE}, ${SNAPSHOT})`,
    description: 'Every builds store change and every 15-second liveness pass the VPS makes is one build-live-event@1 frame on the console live channel (SSE event build-live, id = seq); framework/core/engines/build-live.mjs folds the stream into one build-live-state@1 per build (idle, running, stale, broke, done) that every grid row, the broke alert and the dialog read. Liveness reuses the recovery watchdog\'s cause (build-watchdog@1) and the stale-row watchdog\'s verdict (stale-row@1) and adds no check of its own. Spec: framework/spec/BUILD-LIVE.md.',
    type: 'object', $ref: '#/$defs/event',
    $defs: {
      iso: { type: 'string', format: 'date-time' },
      isoOrNone: { type: 'string', description: 'ISO date-time, or "" for none' },
      buildId: { type: 'string', pattern: BUILD_RE.source },
      kind: { enum: [...KINDS] },
      status: { enum: [...BUILD_STATUSES] },
      alive: { enum: [...ALIVE] },
      cause: { enum: ['', ...CAUSES] },
      watchdogAction: { enum: ['', ...WATCHDOG_ACTIONS] },
      change: { enum: ['', ...CHANGE_EVENTS] },
      state: { enum: [...STATES] },
      step: { type: ['object', 'null'], additionalProperties: false, required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 40 }, title: { type: 'string', maxLength: 200 }, phase: { type: 'string', maxLength: 80 }, index: { type: 'integer', minimum: 0 }, total: { type: 'integer', minimum: 0 } } },
      lastStep: { type: ['object', 'null'], additionalProperties: false, required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 40 }, title: { type: 'string', maxLength: 200 }, doneAt: isoOrNone } },
      watchdog: { type: 'object', additionalProperties: false, required: ['action'], properties: { action: { $ref: '#/$defs/watchdogAction' }, attempt: { type: 'integer', minimum: 0 }, note: { type: 'string', maxLength: 400 }, at: isoOrNone } },
      stale: { type: ['object', 'null'], additionalProperties: false, required: ['action', 'reason'], properties: { action: { enum: [...STALE_ACTIONS] }, reason: { enum: [...STALE_REASONS] } } },
      broke: { type: ['object', 'null'], additionalProperties: false, required: ['at', 'cause', 'what'], properties: { at: isoT, cause: { $ref: '#/$defs/cause' }, exit, signal, what: { type: 'string', maxLength: 400 }, recovering: { type: 'boolean' } } },
      lastChange: { type: ['object', 'null'], additionalProperties: false, required: ['event', 'at'], properties: { event: { $ref: '#/$defs/change' }, at: isoT, by: { type: 'string', maxLength: 80 } } },
      event: {
        title: EVENT, type: 'object', additionalProperties: false, required: ['$axf', 'id', 'seq', 'kind', 'build', 'at', 'status', 'alive'],
        properties: {
          $axf: { const: EVENT }, id: { type: 'string', maxLength: 200, description: '<build>:<kind>:<seq>: stable, so a replayed frame is folded once' },
          seq: { type: 'integer', minimum: 1, description: 'channel-wide, monotonic on the publishing host; the SSE id' }, kind: { $ref: '#/$defs/kind' }, build: { $ref: '#/$defs/buildId' }, title, at: isoT,
          by: { type: 'string', maxLength: 80, description: 'liveness | watchdog | store:<by> | snapshot' }, status: { $ref: '#/$defs/status' }, ...shared,
          change: { $ref: '#/$defs/change' }, everySec, note: { type: 'string', maxLength: 400 },
        },
      },
      state: {
        title: STATE, type: 'object', additionalProperties: false, required: ['$axf', 'build', 'status', 'state', 'alive', 'at', 'seq'],
        properties: {
          $axf: { const: STATE }, build: { $ref: '#/$defs/buildId' }, title, status: { $ref: '#/$defs/status' }, state: { $ref: '#/$defs/state' }, ...shared,
          broke: { $ref: '#/$defs/broke' }, lastBroke: { $ref: '#/$defs/broke' }, recovering: { type: 'boolean' }, lastChange: { $ref: '#/$defs/lastChange' },
          at: isoOrNone, checkedAt: isoOrNone, seen: { type: 'object', additionalProperties: false, properties: Object.fromEntries(KINDS.map((k) => [k, isoOrNone])), description: 'the newest `at` folded per kind: an older frame of a kind is dropped' },
          seq: { type: 'integer', minimum: 0 }, events: { type: 'integer', minimum: 0 }, note: { type: 'string', maxLength: 400 }, line: { type: 'string', maxLength: 300 },
        },
      },
      snapshot: {
        title: SNAPSHOT, type: 'object', additionalProperties: false, required: ['$axf', 'at', 'seq', 'everySec', 'builds'],
        properties: { $axf: { const: SNAPSHOT }, at: isoT, seq: { type: 'integer', minimum: 0 }, everySec, builds: { type: 'array', items: { $ref: '#/$defs/state' } } },
      },
    },
  };
}

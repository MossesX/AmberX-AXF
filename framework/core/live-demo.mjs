/**
 * demo-run@1 — the guided live demo of the Build orchestrator: the record, its state machine and its timing rules.
 * Pure, IO-free. Spec: framework/spec/LIVE-DEMO.md. Golden transitions: framework/spec/fixtures/live-demo.json.
 *
 * Brett, Nov 17 2026: "I want to watch these grids in real time. I want to watch it die, fail, and show what failed. I
 * want to see it cross off steps as it goes. Make a test so I can watch it in real time everything it can possibly do.
 * Give it at least 30 seconds between each thing. Give me an overlay before it starts with a button to continue or
 * pause. If I have pause between steps on, bring me to the focus of what I need to see and wait until I click next,
 * then another 30 seconds, and bring me to focus again."
 *
 * A run plays a list of acts (demo-act@1: id, title, caption, focus, run, expect, cleanup) on the live console:
 *
 *   idle ─begin─► overlay ─continue─► focusing ─focused─► captioned ─start─► running ─finish(result)─┐
 *                                        ▲                                                            │ pause on
 *                                        │                                  waiting-next ◄────────────┤
 *                                        │                                       │ next               │ pause off
 *                                        │        tick (at ≥ nextAt), acts left  ▼                    ▼
 *                                        └──────────────────────────────── cooldown ◄─────────────────┘
 *                                                                              │ tick (at ≥ nextAt), none left
 *                                                                              ▼
 *                                                                            done
 *   stop from any state but idle / done / stopped ──► stopped
 *
 * Timing: pause on = running → waiting-next (wait for Next) → cooldown (≥ minGapMs) → focusing; pause off = running →
 * cooldown (≥ minGapMs) → focusing. minGapMs is never below MIN_GAP_MS (30 s): a smaller value reads as 30 s. A tick
 * before nextAt is a no-op; advance() before nextAt is refused (too-early). Every event carries `at`.
 *
 * Results (act-result@1: actId, result pass | fail | skipped, startedAt, endedAt, durationMs, observed, evidence[],
 * error) are the crossed-off lines of the check-list; summarize() folds them into what the end overlay says.
 *
 * Every act touches demo- builds only (the sandbox, framework/spec/BUILDS.md → Demo builds): validateRun refuses any
 * other build id (not-demo-build), so a tour can never touch a real build.
 */

import { DEMO_PREFIX, isDemoId } from './demo-build.mjs';

export const SCHEMA = 'demo-run@1';
export const ACT_SCHEMA = 'demo-act@1';
export const RESULT_SCHEMA = 'act-result@1';
export const VERSION = 1;

/** The gap between acts, in ms. Never lower (Brett: "at least 30 seconds between each thing"). */
export const MIN_GAP_MS = 30000;
/** Default timeout for an act's action and for watching its expectation. */
export const DEFAULT_TIMEOUT_MS = 60000;
/** Id prefix of a demo (throwaway) build; the builds store tags them `demo: true` (framework/core/demo-build.mjs). */
export { DEMO_PREFIX };

export const STATES = ['idle', 'overlay', 'focusing', 'captioned', 'running', 'waiting-next', 'cooldown', 'done', 'stopped'];
export const TERMINAL_STATES = ['done', 'stopped'];
export const EVENTS = ['begin', 'continue', 'toggle-pause', 'focused', 'start', 'finish', 'next', 'skip', 'stop', 'tick'];
export const RESULTS = ['pass', 'fail', 'skipped'];
export const ACTION_KINDS = ['cli', 'rest', 'mcp', 'console', 'noop', 'custom'];
export const EXPECT_KINDS = ['status', 'step-done', 'step-skipped', 'row', 'row-gone', 'banner', 'note', 'alert', 'log', 'none', 'custom'];
export const EVIDENCE_KINDS = ['status', 'step', 'banner', 'note', 'alert', 'log', 'shot', 'error', 'custom'];
export const METHODS = ['', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
export const STOPPERS = ['brett', 'driver', 'error'];
export const ERROR_CODES = ['invalid-transition', 'too-early', 'no-act', 'bad-result', 'bad-time', 'not-demo-build'];

/** Which events each state accepts (the table the spec draws). `tick` is accepted everywhere and only moves a cooldown. */
export const ALLOWED = Object.freeze({
  idle: ['begin', 'tick'],
  overlay: ['continue', 'toggle-pause', 'stop', 'tick'],
  focusing: ['focused', 'skip', 'stop', 'tick'],
  captioned: ['start', 'skip', 'stop', 'tick'],
  running: ['finish', 'stop', 'tick'],
  'waiting-next': ['next', 'toggle-pause', 'stop', 'tick'],
  cooldown: ['toggle-pause', 'stop', 'tick'],
  done: ['tick'],
  stopped: ['tick'],
});

/** States in which Brett is looking at something (the console follows the act's focus). */
export const FOCUSED_STATES = ['focusing', 'captioned', 'running', 'waiting-next'];

/** The registry snapshot other ports and the schema writer read. */
export const REGISTRY = Object.freeze({
  $axf: 'live-demo-registry@1', schema: SCHEMA, act: ACT_SCHEMA, result: RESULT_SCHEMA, version: VERSION,
  minGapMs: MIN_GAP_MS, defaultTimeoutMs: DEFAULT_TIMEOUT_MS, demoPrefix: DEMO_PREFIX,
  states: STATES, terminal: TERMINAL_STATES, events: EVENTS, allowed: ALLOWED, results: RESULTS,
  actionKinds: ACTION_KINDS, expectKinds: EXPECT_KINDS, evidenceKinds: EVIDENCE_KINDS, stoppers: STOPPERS, errorCodes: ERROR_CODES,
});

export class DemoTransitionError extends Error {
  constructor(code, message, detail = {}) { super(message); this.name = 'DemoTransitionError'; this.code = ERROR_CODES.includes(code) ? code : 'invalid-transition'; Object.assign(this, detail); }
}

/* ---------------- helpers ---------------- */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
const RUN_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const iso = (v) => (ISO.test(str(v, 40)) ? str(v, 40) : '');
const int = (v, min, dflt) => { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return Number.isFinite(n) && Number.isInteger(n) && n >= min ? n : dflt; };
const ms = (t) => Date.parse(t);
const addMs = (t, n) => new Date(ms(t) + n).toISOString();
const slug = (v) => (SLUG.test(str(v, 60)) ? str(v, 60) : '');
const clone = (v) => JSON.parse(JSON.stringify(v));
/** Is this a demo build id? (the id side of the sandbox; the store adds the `demo: true` tag) */
export const isDemoBuildId = isDemoId;

/* ---------------- normalization ---------------- */

/** An action ({ kind, cmd, args, method, path, body, timeoutMs }); junk reads as noop, an unknown kind as custom. */
export function normAction(a) {
  const o = a && typeof a === 'object' ? a : {};
  const kind = ACTION_KINDS.includes(o.kind) ? o.kind : (typeof o.kind === 'string' && o.kind ? 'custom' : 'noop');
  return {
    kind,
    cmd: str(o.cmd, 200),
    args: (Array.isArray(o.args) ? o.args : []).slice(0, 40).map((x) => (typeof x === 'string' ? x.slice(0, 400) : String(x ?? '').slice(0, 400))),
    method: METHODS.includes(o.method) ? o.method : '',
    path: str(o.path, 400),
    body: o.body === undefined ? null : clone(o.body),
    timeoutMs: int(o.timeoutMs, 1000, DEFAULT_TIMEOUT_MS),
  };
}

/** An expectation ({ kind, build, step, status, text, within, fails }); none = the act passes when its action returned. */
export function normExpect(e) {
  const o = e && typeof e === 'object' ? e : {};
  return {
    kind: EXPECT_KINDS.includes(o.kind) ? o.kind : (typeof o.kind === 'string' && o.kind ? 'custom' : 'none'),
    build: str(o.build, 80),
    step: str(o.step, 40),
    status: str(o.status, 40),
    text: str(o.text, 400),
    within: int(o.within, 0, 0),
    fails: o.fails === true,
  };
}

export function normFocus(f) {
  const o = f && typeof f === 'object' ? f : {};
  return { app: str(o.app, 40), route: str(o.route, 200), selector: str(o.selector, 400), address: str(o.address, 200), note: str(o.note, 400) };
}

/** One act (demo-act@1). `builds` collects the ids it names (its own list plus expect.build), each once, in order. */
export function normAct(a, i = 0) {
  const o = a && typeof a === 'object' ? a : {};
  const expect = normExpect(o.expect);
  const named = [...(Array.isArray(o.builds) ? o.builds : []), expect.build].map((x) => str(x, 80)).filter(Boolean);
  return {
    id: slug(o.id) || `act-${i + 1}`,
    title: str(o.title, 120) || `Act ${i + 1}`,
    caption: str(o.caption, 400),
    focus: normFocus(o.focus),
    run: normAction(o.run),
    expect,
    cleanup: o.cleanup === undefined || o.cleanup === null ? null : normAction(o.cleanup),
    builds: [...new Set(named)].slice(0, 20),
    tags: [...new Set((Array.isArray(o.tags) ? o.tags : []).map(slug).filter(Boolean))].slice(0, 20),
  };
}

export function normEvidence(e) {
  const o = e && typeof e === 'object' ? e : {};
  const text = str(o.text, 2000);
  if (!text) return null;
  return { kind: EVIDENCE_KINDS.includes(o.kind) ? o.kind : 'custom', text, ref: str(o.ref, 400), at: iso(o.at) };
}

/** One act result (act-result@1). Null when it names no act or no known result. */
export function normResult(r) {
  const o = r && typeof r === 'object' ? r : {};
  const actId = slug(o.actId);
  if (!actId || !RESULTS.includes(o.result)) return null;
  const startedAt = iso(o.startedAt); const endedAt = iso(o.endedAt);
  const span = startedAt && endedAt ? Math.max(0, ms(endedAt) - ms(startedAt)) : 0;
  return {
    actId,
    result: o.result,
    startedAt,
    endedAt,
    durationMs: int(o.durationMs, 0, span) || span,
    observed: str(o.observed, 400),
    evidence: (Array.isArray(o.evidence) ? o.evidence : []).map(normEvidence).filter(Boolean).slice(0, 50),
    error: str(o.error, 2000),
  };
}

export function normStopped(s) {
  const o = s && typeof s === 'object' ? s : null;
  if (!o || !iso(o.at)) return null;
  return { at: iso(o.at), by: STOPPERS.includes(o.by) ? o.by : 'driver', why: str(o.why, 400) };
}

/** The gap: anything below MIN_GAP_MS (or junk) reads as MIN_GAP_MS; bigger stays. */
export const normGap = (v) => Math.max(MIN_GAP_MS, int(v, 0, MIN_GAP_MS));

/**
 * A run record (demo-run@1) in shape. Missing times read as `now`. A cursor past the acts is clamped; results that
 * name no act of the run are dropped; `nextAt` is recomputed in cooldown and cleared elsewhere.
 */
export function normRun(r, { now = new Date().toISOString() } = {}) {
  const o = r && typeof r === 'object' ? r : {};
  const acts = (Array.isArray(o.acts) ? o.acts : []).map(normAct).slice(0, 200);
  const seen = new Set();
  acts.forEach((a, i) => { if (seen.has(a.id)) a.id = `${a.id}-${i + 1}`; seen.add(a.id); });
  const ids = new Set(acts.map((a) => a.id));
  const state = STATES.includes(o.state) ? o.state : 'idle';
  const minGapMs = normGap(o.minGapMs);
  const enteredAt = iso(o.enteredAt) || iso(o.updatedAt) || iso(o.createdAt) || now;
  const cursor = Math.min(Math.max(int(o.cursor, -1, -1), -1), Math.max(acts.length - 1, -1));
  return {
    $axf: SCHEMA,
    id: RUN_ID.test(str(o.id, 80)) ? str(o.id, 80) : 'demo-run',
    title: str(o.title, 200) || 'Guided live demo',
    state,
    pause: o.pause !== false,
    minGapMs,
    acts,
    cursor: state === 'idle' || state === 'overlay' ? -1 : cursor,
    results: (Array.isArray(o.results) ? o.results : []).map(normResult).filter((x) => x && ids.has(x.actId)).slice(0, 200),
    enteredAt,
    nextAt: state === 'cooldown' ? (iso(o.nextAt) || addMs(enteredAt, minGapMs)) : '',
    startedAt: iso(o.startedAt),
    endedAt: TERMINAL_STATES.includes(state) ? (iso(o.endedAt) || enteredAt) : '',
    stopped: state === 'stopped' ? (normStopped(o.stopped) ?? { at: iso(o.endedAt) || enteredAt, by: 'driver', why: '' }) : null,
    createdAt: iso(o.createdAt) || now,
    updatedAt: iso(o.updatedAt) || now,
  };
}

/** A new run in `idle` from a title and acts. */
export function newRun({ id = 'demo-run', title = 'Guided live demo', acts = [], pause = true, minGapMs = MIN_GAP_MS, now = new Date().toISOString() } = {}) {
  return normRun({ id, title, acts, pause, minGapMs, state: 'idle', cursor: -1, results: [], enteredAt: now, createdAt: now, updatedAt: now }, { now });
}

/* ---------------- validation ---------------- */

/** Problems a normalized run still has (the things normRun cannot invent): [{ path, code, message }]. */
export function validateRun(run) {
  const errors = []; const err = (path, code, message) => errors.push({ path, code, message });
  if (!run || typeof run !== 'object') return [{ path: 'run', code: 'invalid-transition', message: 'the run must be an object' }];
  if (run.$axf !== SCHEMA) err('$axf', 'invalid-transition', `must be "${SCHEMA}"`);
  if (!Array.isArray(run.acts) || !run.acts.length) err('acts', 'no-act', 'a run needs at least one act');
  (run.acts ?? []).forEach((a, i) => {
    if (!a.focus?.app) err(`acts[${i}].focus.app`, 'invalid-transition', `act "${a.id}" says nothing about where to look`);
    for (const b of a.builds ?? []) if (!isDemoBuildId(b)) err(`acts[${i}].builds`, 'not-demo-build', `act "${a.id}" touches "${b}", which is not a demo build (id prefix ${DEMO_PREFIX})`);
  });
  if (Number.isInteger(run.minGapMs) && run.minGapMs < MIN_GAP_MS) err('minGapMs', 'too-early', `the gap is never below ${MIN_GAP_MS} ms`);
  if (!iso(run.enteredAt)) err('enteredAt', 'bad-time', 'is not an ISO timestamp');
  if (run.state === 'cooldown' && !iso(run.nextAt)) err('nextAt', 'bad-time', 'a cooldown says when it ends');
  const ids = new Set((run.acts ?? []).map((a) => a.id));
  (run.results ?? []).forEach((r, i) => { if (!ids.has(r.actId)) err(`results[${i}].actId`, 'no-act', `"${r.actId}" is not an act of the run`); });
  if (FOCUSED_STATES.includes(run.state) && !(run.acts ?? [])[run.cursor]) err('cursor', 'no-act', `state ${run.state} needs a current act`);
  return errors;
}

/* ---------------- the state machine ---------------- */

/** The current act, or null. */
export const currentAct = (run) => (run && run.cursor >= 0 ? run.acts[run.cursor] ?? null : null);
/** The result recorded for an act id, or null. */
export const resultOf = (run, actId) => run?.results?.find((r) => r.actId === actId) ?? null;
/** Acts after the cursor that still have no result (what remains after this one). */
export const actsLeft = (run) => (run?.acts ?? []).filter((a, i) => i > run.cursor && !resultOf(run, a.id)).length;
/** Is the cooldown over at `at`? */
export const gapElapsed = (run, at) => run?.state === 'cooldown' && !!iso(at) && ms(at) >= ms(run.nextAt);
/** What is allowed now (for the overlay's buttons and the API): events other than tick the state accepts. */
export const allowedEvents = (run) => (ALLOWED[run?.state] ?? []).filter((e) => e !== 'tick');

function enter(run, state, at) {
  const next = { ...run, state, enteredAt: at, updatedAt: at, nextAt: state === 'cooldown' ? addMs(at, run.minGapMs) : '' };
  if (TERMINAL_STATES.includes(state)) next.endedAt = at;
  return next;
}
function withResult(run, result) {
  const results = run.results.filter((r) => r.actId !== result.actId);
  results.push(result);
  const order = new Map(run.acts.map((a, i) => [a.id, i]));
  results.sort((a, b) => order.get(a.actId) - order.get(b.actId));
  return { ...run, results };
}
/** From cooldown's end (or a skip): the next act without a result, or done. */
function advanceFrom(run, at) {
  const nextIndex = run.acts.findIndex((a, i) => i > run.cursor && !resultOf(run, a.id));
  if (nextIndex === -1) return enter({ ...run, cursor: run.acts.length - 1 }, 'done', at);
  return enter({ ...run, cursor: nextIndex }, 'focusing', at);
}
function skipped(run, at, why, startedAt = '') {
  const act = currentAct(run);
  return normResult({ actId: act.id, result: 'skipped', startedAt: startedAt || at, endedAt: at, observed: why, evidence: [], error: '' });
}

/**
 * One event on a run: the new run, or a DemoTransitionError. Events: { type, at, result?, by?, why?, pause? }.
 * `tick` never throws: it moves a cooldown that has elapsed and leaves everything else as it is.
 */
export function step(run, event) {
  const ev = event && typeof event === 'object' ? event : {};
  const at = iso(ev.at);
  if (!EVENTS.includes(ev.type)) throw new DemoTransitionError('invalid-transition', `"${ev.type}" is not a demo event (${EVENTS.join(', ')})`, { state: run?.state, event: ev.type });
  if (!at) throw new DemoTransitionError('bad-time', `event ${ev.type} carries no ISO time`, { state: run?.state, event: ev.type });
  if (!ALLOWED[run?.state]) throw new DemoTransitionError('invalid-transition', `"${run?.state}" is not a demo state`, { state: run?.state, event: ev.type });
  if (!ALLOWED[run.state].includes(ev.type)) throw new DemoTransitionError('invalid-transition', `${ev.type} is not allowed in ${run.state} (allowed: ${allowedEvents(run).join(', ') || 'nothing'})`, { state: run.state, event: ev.type });
  if (ms(at) < ms(run.enteredAt)) throw new DemoTransitionError('bad-time', `event ${ev.type} at ${at} is earlier than the state was entered (${run.enteredAt})`, { state: run.state, event: ev.type });
  switch (ev.type) {
    case 'tick':
      return gapElapsed(run, at) ? advanceFrom(run, at) : run;
    case 'begin':
      return enter(run, 'overlay', at);
    case 'toggle-pause':
      return { ...run, pause: typeof ev.pause === 'boolean' ? ev.pause : !run.pause, updatedAt: at };
    case 'continue': {
      if (!run.acts.length) throw new DemoTransitionError('no-act', 'the run has no acts to play', { state: run.state, event: ev.type });
      const started = { ...run, startedAt: run.startedAt || at, pause: typeof ev.pause === 'boolean' ? ev.pause : run.pause, cursor: -1 };
      return advanceFrom(started, at);
    }
    case 'focused':
      if (!currentAct(run)) throw new DemoTransitionError('no-act', 'nothing is focused: the run has no current act', { state: run.state, event: ev.type });
      return enter(run, 'captioned', at);
    case 'start':
      if (!currentAct(run)) throw new DemoTransitionError('no-act', 'nothing to start: the run has no current act', { state: run.state, event: ev.type });
      return enter(run, 'running', at);
    case 'finish': {
      const act = currentAct(run);
      if (!act) throw new DemoTransitionError('no-act', 'nothing to finish: the run has no current act', { state: run.state, event: ev.type });
      const given = ev.result && typeof ev.result === 'object' ? ev.result : {};
      const result = normResult({ ...given, actId: act.id, startedAt: iso(given.startedAt) || run.enteredAt, endedAt: iso(given.endedAt) || at });
      if (!result) throw new DemoTransitionError('bad-result', `finish needs a result of ${RESULTS.join(' / ')}`, { state: run.state, event: ev.type, result: given.result });
      return enter(withResult(run, result), run.pause ? 'waiting-next' : 'cooldown', at);
    }
    case 'next':
      return enter(run, 'cooldown', at);
    case 'skip':
      return enter(withResult(run, skipped(run, at, str(ev.why) || 'skipped by brett')), 'cooldown', at);
    case 'stop': {
      const by = STOPPERS.includes(ev.by) ? ev.by : 'brett';
      const why = str(ev.why);
      let r = run;
      if (run.state === 'running') r = withResult(run, skipped(run, at, why ? `stopped: ${why}` : 'stopped', run.enteredAt));
      return { ...enter(r, 'stopped', at), stopped: { at, by, why } };
    }
    default:
      throw new DemoTransitionError('invalid-transition', `unhandled event ${ev.type}`, { state: run.state, event: ev.type });
  }
}

/** Force the cooldown to end now: refused before nextAt (too-early); the same as a tick at or after it. */
export function advance(run, at) {
  const t = iso(at);
  if (!t) throw new DemoTransitionError('bad-time', 'advance carries no ISO time', { state: run?.state, event: 'advance' });
  if (run?.state !== 'cooldown') throw new DemoTransitionError('invalid-transition', `advance is only allowed in cooldown (state ${run?.state})`, { state: run?.state, event: 'advance' });
  if (!gapElapsed(run, t)) throw new DemoTransitionError('too-early', `the gap ends at ${run.nextAt}; ${t} is ${ms(run.nextAt) - ms(t)} ms too early (minimum ${run.minGapMs} ms)`, { state: run.state, event: 'advance', nextAt: run.nextAt });
  return advanceFrom(run, t);
}

/** Play a list of events in order; stops at the first error and returns it with the run as it was. */
export function replay(run, events) {
  let r = run; const trace = [];
  for (const ev of events) {
    try { r = step(r, ev); trace.push({ event: ev.type, at: ev.at, state: r.state, cursor: r.cursor, nextAt: r.nextAt }); }
    catch (e) { if (!(e instanceof DemoTransitionError)) throw e; return { run: r, trace, error: { code: e.code, message: e.message, state: e.state, event: e.event } }; }
  }
  return { run: r, trace, error: null };
}

/* ---------------- the summary fold ---------------- */

/** What the overlay and the Next bar show: counts, what is current, what failed and why. */
export function summarize(run) {
  const results = run?.results ?? [];
  const count = (k) => results.filter((r) => r.result === k).length;
  const pass = count('pass'); const fail = count('fail'); const skipped = count('skipped');
  const done = pass + fail + skipped;
  const total = run?.acts?.length ?? 0;
  const titles = new Map((run?.acts ?? []).map((a) => [a.id, a.title]));
  const end = run?.endedAt || run?.updatedAt || '';
  return {
    state: run?.state ?? 'idle',
    total, done, pass, fail, skipped,
    remaining: Math.max(0, total - done),
    current: FOCUSED_STATES.includes(run?.state) || run?.state === 'cooldown' ? (currentAct(run)?.id ?? '') : '',
    failed: results.filter((r) => r.result === 'fail').map((r) => ({ actId: r.actId, title: titles.get(r.actId) ?? r.actId, observed: r.observed, error: r.error })),
    startedAt: run?.startedAt ?? '',
    endedAt: run?.endedAt ?? '',
    durationMs: run?.startedAt && end ? Math.max(0, ms(end) - ms(run.startedAt)) : 0,
    pause: run?.pause !== false,
    minGapMs: run?.minGapMs ?? MIN_GAP_MS,
  };
}

/** One line per act for the check-list: ✓ pass, ✗ fail (with what failed), – skipped, ▶ current, · to come. */
export function checklist(run) {
  const cur = currentAct(run)?.id;
  return (run?.acts ?? []).map((a) => {
    const r = resultOf(run, a.id);
    const mark = r ? ({ pass: '✓', fail: '✗', skipped: '–' })[r.result] : a.id === cur && !TERMINAL_STATES.includes(run.state) ? '▶' : '·';
    return { actId: a.id, title: a.title, mark, result: r?.result ?? '', observed: r?.observed ?? '', error: r?.error ?? '' };
  });
}

/* ---------------- JSON Schema ---------------- */

/** The JSON Schema (framework/schemas/live-demo.json, written by `axf schemas`). */
export function jsonSchema() {
  const slugS = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,59}$' };
  const isoS = { type: 'string', format: 'date-time' };
  const isoOrEmpty = { type: 'string', description: 'ISO date-time, or "" for none' };
  const demoId = '^demo-[a-z0-9][a-z0-9-]{0,74}$';
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://amberx.ai/axf/schemas/live-demo.json',
    title: 'demo-run@1: a guided live demo of the Build orchestrator (acts demo-act@1, results act-result@1)',
    description: 'A scripted tour played on the live console against demo- builds: an overlay first, then per act focus → caption → run → result (pass / fail / skipped with evidence) → wait for Next when pause is on → a gap of at least 30 s → the next act. Reference core framework/core/live-demo.mjs; spec framework/spec/LIVE-DEMO.md.',
    type: 'object',
    $ref: '#/$defs/run',
    $defs: {
      slug: slugS,
      iso: isoS,
      isoOrEmpty,
      action: {
        type: 'object', additionalProperties: false, required: ['kind'],
        properties: {
          kind: { enum: ACTION_KINDS },
          cmd: { type: 'string', maxLength: 200 },
          args: { type: 'array', items: { type: 'string', maxLength: 400 }, maxItems: 40 },
          method: { enum: METHODS },
          path: { type: 'string', maxLength: 400 },
          body: {},
          timeoutMs: { type: 'integer', minimum: 1000, default: DEFAULT_TIMEOUT_MS },
        },
      },
      expect: {
        type: 'object', additionalProperties: false, required: ['kind'],
        properties: {
          kind: { enum: EXPECT_KINDS },
          build: { type: 'string', pattern: `^$|${demoId}` },
          step: { type: 'string', maxLength: 40 },
          status: { type: 'string', maxLength: 40 },
          text: { type: 'string', maxLength: 400 },
          within: { type: 'integer', minimum: 0 },
          fails: { type: 'boolean', default: false, description: 'The act is meant to die: the pass is seeing the failure and what failed; a clean exit is the fail.' },
        },
      },
      focus: {
        type: 'object', additionalProperties: false, required: ['app'],
        properties: {
          app: { type: 'string', minLength: 1, maxLength: 40 },
          route: { type: 'string', maxLength: 200 },
          selector: { type: 'string', maxLength: 400 },
          address: { type: 'string', maxLength: 200, description: 'console-control@1 address of the element to look at (e.g. row:demo-crash/step:s2)' },
          note: { type: 'string', maxLength: 400 },
        },
      },
      act: {
        type: 'object', additionalProperties: false, required: ['id', 'title', 'caption', 'focus', 'run', 'expect'],
        properties: {
          id: { $ref: '#/$defs/slug' },
          title: { type: 'string', minLength: 1, maxLength: 120 },
          caption: { type: 'string', maxLength: 400 },
          focus: { $ref: '#/$defs/focus' },
          run: { $ref: '#/$defs/action' },
          expect: { $ref: '#/$defs/expect' },
          cleanup: { oneOf: [{ $ref: '#/$defs/action' }, { type: 'null' }] },
          builds: { type: 'array', items: { type: 'string', pattern: demoId }, maxItems: 20, description: 'Every build the act touches; each must be a demo build (id prefix demo-, tag demo: true).' },
          tags: { type: 'array', items: { $ref: '#/$defs/slug' }, maxItems: 20 },
        },
      },
      evidence: {
        type: 'object', additionalProperties: false, required: ['kind', 'text'],
        properties: { kind: { enum: EVIDENCE_KINDS }, text: { type: 'string', maxLength: 2000 }, ref: { type: 'string', maxLength: 400 }, at: { $ref: '#/$defs/isoOrEmpty' } },
      },
      result: {
        type: 'object', additionalProperties: false, required: ['actId', 'result', 'startedAt', 'endedAt', 'durationMs', 'observed', 'evidence', 'error'],
        properties: {
          actId: { $ref: '#/$defs/slug' },
          result: { enum: RESULTS },
          startedAt: { $ref: '#/$defs/isoOrEmpty' },
          endedAt: { $ref: '#/$defs/isoOrEmpty' },
          durationMs: { type: 'integer', minimum: 0 },
          observed: { type: 'string', maxLength: 400 },
          evidence: { type: 'array', items: { $ref: '#/$defs/evidence' }, maxItems: 50 },
          error: { type: 'string', maxLength: 2000 },
        },
      },
      stopped: {
        type: 'object', additionalProperties: false, required: ['at', 'by', 'why'],
        properties: { at: { $ref: '#/$defs/iso' }, by: { enum: STOPPERS }, why: { type: 'string', maxLength: 400 } },
      },
      run: {
        type: 'object', additionalProperties: false,
        required: ['$axf', 'id', 'title', 'state', 'pause', 'minGapMs', 'acts', 'cursor', 'results', 'enteredAt', 'nextAt', 'startedAt', 'endedAt', 'stopped', 'createdAt', 'updatedAt'],
        properties: {
          $axf: { const: SCHEMA },
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,79}$' },
          title: { type: 'string', minLength: 1, maxLength: 200 },
          state: { enum: STATES },
          pause: { type: 'boolean', default: true, description: 'Pause between steps: wait for Next after every act, then the gap.' },
          minGapMs: { type: 'integer', minimum: MIN_GAP_MS, default: MIN_GAP_MS, description: 'The gap between acts. Never lower than 30 000: a smaller value reads as 30 000.' },
          acts: { type: 'array', items: { $ref: '#/$defs/act' }, minItems: 1, maxItems: 200 },
          cursor: { type: 'integer', minimum: -1 },
          results: { type: 'array', items: { $ref: '#/$defs/result' }, maxItems: 200 },
          enteredAt: { $ref: '#/$defs/iso' },
          nextAt: { $ref: '#/$defs/isoOrEmpty' },
          startedAt: { $ref: '#/$defs/isoOrEmpty' },
          endedAt: { $ref: '#/$defs/isoOrEmpty' },
          stopped: { oneOf: [{ $ref: '#/$defs/stopped' }, { type: 'null' }] },
          createdAt: { $ref: '#/$defs/iso' },
          updatedAt: { $ref: '#/$defs/iso' },
        },
      },
      event: {
        type: 'object', required: ['type', 'at'],
        properties: {
          type: { enum: EVENTS },
          at: { $ref: '#/$defs/iso' },
          result: { $ref: '#/$defs/result' },
          by: { enum: STOPPERS },
          why: { type: 'string', maxLength: 400 },
          pause: { type: 'boolean' },
        },
      },
      summary: {
        type: 'object', additionalProperties: false,
        required: ['state', 'total', 'done', 'pass', 'fail', 'skipped', 'remaining', 'current', 'failed', 'startedAt', 'endedAt', 'durationMs', 'pause', 'minGapMs'],
        properties: {
          state: { type: 'string' },
          total: { type: 'integer', minimum: 0 },
          done: { type: 'integer', minimum: 0 },
          pass: { type: 'integer', minimum: 0 },
          fail: { type: 'integer', minimum: 0 },
          skipped: { type: 'integer', minimum: 0 },
          remaining: { type: 'integer', minimum: 0 },
          current: { type: 'string' },
          failed: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['actId', 'title', 'observed', 'error'], properties: { actId: { type: 'string' }, title: { type: 'string' }, observed: { type: 'string' }, error: { type: 'string' } } } },
          startedAt: { $ref: '#/$defs/isoOrEmpty' },
          endedAt: { $ref: '#/$defs/isoOrEmpty' },
          durationMs: { type: 'integer', minimum: 0 },
          pause: { type: 'boolean' },
          minGapMs: { type: 'integer', minimum: MIN_GAP_MS },
        },
      },
    },
  };
}

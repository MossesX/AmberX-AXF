/**
 * Work engine — periodic jobs that keep running in the background (work@1).
 *
 * Harvested from the AXHub app's approval watcher (Oct 2026): a foreground service that polled the hub's approvals
 * feed every N seconds, backed off to 5 minutes while signed out, showed one "sign in" notice per signed-out spell,
 * stopped when watching was turned off, took STOP / CHECK_NOW commands and restarted after a reboot. The decisions
 * in that loop are the same for every app that watches something, so they live here as data + a pure reducer:
 *
 *  - a **job spec** (`JobSpec`): id, kind, interval bounds (default/min/max as data, never constants), one rule per
 *    outcome (what delay, whether to show a one-time notice, whether that outcome ends the notice spell, whether to
 *    stop), run conditions (flags the host evaluates), whether it needs a foreground host and restarts after boot;
 *  - a **state machine** (`reduceJob`): events from the host (start, stop, check-now, outcome, wake, host-refused,
 *    interval, flags) → the next `JobState` + the **effects** the host must carry out (run the body, sleep, stop,
 *    show a notice, clear notices, refresh the status). The host (Android foreground service, a web timer, a Python
 *    loop) only runs the body and performs effects; it decides nothing.
 *
 * Open registries: job kinds (`poll` is built; `once`, `alarm`, `constrained`, `chain` are placeholders) and outcome
 * names (any string; `*` is the fallback rule). Pure and framework-agnostic: the Kotlin kernel mirrors it as
 * `ai.amberx.axf.kernel.work.WorkEngine` (fixture: spec/fixtures/work.json).
 */

export const WORK_CONTRACT = 'work@1';
/** The Android lib-work module registers its poll-job host under this capability. */
export const WORK_POLL_CAPABILITY = 'axf.work.poll';

export const WORK_KIND_STATUSES = ['built', 'placeholder'] as const;
export type WorkKindStatus = (typeof WORK_KIND_STATUSES)[number];
export interface WorkKindSpec {
  id: string;
  label: string;
  status: WorkKindStatus;
  note?: string;
}

const kinds = new Map<string, WorkKindSpec>([
  ['poll', { id: 'poll', label: 'Periodic poll', status: 'built', note: 'A body run again and again while conditions hold; delay per outcome; needs a long-running host (Android foreground service)' }],
  ['once', { id: 'once', label: 'One-off', status: 'placeholder', note: 'Run once, retried by the outcome rules; survives process death through the platform scheduler' }],
  ['alarm', { id: 'alarm', label: 'Alarm', status: 'placeholder', note: 'Run at a wall-clock time (exact only when the platform allows)' }],
  ['constrained', { id: 'constrained', label: 'Constrained periodic', status: 'placeholder', note: 'Platform-scheduled periodic work with constraints (network, charging…); 15 min minimum on Android (WorkManager)' }],
  ['chain', { id: 'chain', label: 'Chain', status: 'placeholder', note: 'Jobs that run after each other' }],
]);

/** Every job kind, built or placeholder. */
export function workKinds(): WorkKindSpec[] {
  return [...kinds.values()];
}
export function workKind(id: string): WorkKindSpec | undefined {
  return kinds.get(id);
}
/** A port or a module adds a kind (or marks a placeholder built). */
export function registerWorkKind(spec: WorkKindSpec): void {
  kinds.set(spec.id, { ...spec });
}

/** Capabilities declared now so later work plugs in without reshuffling. */
export const WORK_PLACEHOLDERS = {
  /** the kernel's WorkScheduler contract (`axf.work`) over the platform scheduler (WorkManager on Android) */
  manager: 'axf.work.manager',
  alarm: 'axf.work.alarm',
  chain: 'axf.work.chain',
} as const;

/* ---------- job spec ---------- */

/** Interval bounds, in ms. The host clamps every requested interval into [min, max]. */
export interface IntervalBounds {
  defaultMs: number;
  minMs: number;
  maxMs: number;
}

export type DelayRule =
  /** wait the job's current interval */
  | { kind: 'interval' }
  /** wait a fixed time (e.g. 5 minutes while signed out) */
  | { kind: 'fixed'; ms: number }
  /** baseMs × factor^(streak − 1), capped at maxMs; the streak counts consecutive runs with the same outcome */
  | { kind: 'exponential'; baseMs: number; factor?: number; maxMs: number };

export const DELAY_KINDS = ['interval', 'fixed', 'exponential'] as const;
export const DEFAULT_BACKOFF_FACTOR = 2;

/** What happens after a run ends with an outcome. */
export interface OutcomeRule {
  delay: DelayRule;
  /** show this notice once per spell (it is not shown again until a rule with `endsSpell` runs) */
  notice?: string;
  /** this outcome ends the notice spell: notices shown so far may show again later */
  endsSpell?: boolean;
  /** the job stops after this outcome */
  stop?: boolean;
}

/** A flag the host evaluates (e.g. "watching" from the app's prefs); the job runs only while every condition holds. */
export interface RunCondition {
  /** condition kind; `flag` is the only built one (unknown kinds never hold: fail closed) */
  kind?: string;
  flag: string;
  /** the value the flag must have (default true) */
  equals?: boolean;
}
export const CONDITION_KINDS = ['flag'] as const;

export interface JobSpec {
  /** `[a-z0-9][a-z0-9._-]*` (lowercase, like a module id) */
  id: string;
  /** see `workKinds()` */
  kind: string;
  label?: string;
  module?: string;
  interval: IntervalBounds;
  /** one rule per outcome name; `*` is the fallback (an outcome without a rule and no `*` waits the interval) */
  outcomes: Record<string, OutcomeRule>;
  conditions: RunCondition[];
  /** needs a user-visible, long-running host (a foreground service with an ongoing notification on Android) */
  foreground: boolean;
  /** the host starts it again after a reboot or an app update, when its conditions hold */
  restartOnBoot: boolean;
}

export const JOB_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
export const FALLBACK_OUTCOME = '*';

export interface JobSpecCheck {
  ok: boolean;
  errors: string[];
  spec?: JobSpec;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isMs = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && Math.floor(v) === v;

function checkDelay(raw: unknown, where: string, errors: string[]): DelayRule | undefined {
  if (!isObj(raw)) { errors.push(`${where}: delay must be an object`); return undefined; }
  const kind = raw.kind;
  if (kind === 'interval') return { kind: 'interval' };
  if (kind === 'fixed') {
    if (!isMs(raw.ms) || raw.ms < 1) { errors.push(`${where}: fixed delay needs ms ≥ 1`); return undefined; }
    return { kind: 'fixed', ms: raw.ms };
  }
  if (kind === 'exponential') {
    const factor = raw.factor === undefined ? DEFAULT_BACKOFF_FACTOR : raw.factor;
    if (!isMs(raw.baseMs) || raw.baseMs < 1) { errors.push(`${where}: exponential delay needs baseMs ≥ 1`); return undefined; }
    if (!isMs(raw.maxMs) || raw.maxMs < raw.baseMs) { errors.push(`${where}: exponential delay needs maxMs ≥ baseMs`); return undefined; }
    if (typeof factor !== 'number' || !Number.isFinite(factor) || factor < 1) { errors.push(`${where}: exponential factor must be ≥ 1`); return undefined; }
    return { kind: 'exponential', baseMs: raw.baseMs, factor, maxMs: raw.maxMs };
  }
  errors.push(`${where}: unknown delay kind ${JSON.stringify(kind)}`);
  return undefined;
}

/** Validates a raw job spec (JSON from an app, a plugin or a fixture) and returns the normalized spec. */
export function validateJobSpec(raw: unknown): JobSpecCheck {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['job spec must be an object'] };
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!JOB_ID_PATTERN.test(id)) errors.push('id must match [a-z0-9][a-z0-9._-]*');
  const kind = typeof raw.kind === 'string' ? raw.kind : '';
  const k = kinds.get(kind);
  if (!k) errors.push(`unknown job kind ${JSON.stringify(kind)}`);
  else if (k.status !== 'built') errors.push(`job kind ${kind} is a placeholder (not built yet)`);
  let interval: IntervalBounds = { defaultMs: 0, minMs: 0, maxMs: 0 };
  if (!isObj(raw.interval)) errors.push('interval bounds are required');
  else {
    const { defaultMs, minMs, maxMs } = raw.interval;
    if (!isMs(minMs) || minMs < 1) errors.push('interval.minMs must be ≥ 1');
    if (!isMs(maxMs) || (isMs(minMs) && maxMs < minMs)) errors.push('interval.maxMs must be ≥ minMs');
    if (!isMs(defaultMs) || (isMs(minMs) && isMs(maxMs) && (defaultMs < minMs || defaultMs > maxMs))) errors.push('interval.defaultMs must lie within [minMs, maxMs]');
    if (isMs(defaultMs) && isMs(minMs) && isMs(maxMs)) interval = { defaultMs, minMs, maxMs };
  }
  const outcomes: Record<string, OutcomeRule> = {};
  if (!isObj(raw.outcomes)) errors.push('outcomes must be an object');
  else {
    for (const [name, r] of Object.entries(raw.outcomes)) {
      if (!name) { errors.push('outcome names must not be empty'); continue; }
      if (!isObj(r)) { errors.push(`outcome ${name}: rule must be an object`); continue; }
      const delay = checkDelay(r.delay, `outcome ${name}`, errors);
      if (!delay) continue;
      const rule: OutcomeRule = { delay };
      if (r.notice !== undefined) {
        if (typeof r.notice !== 'string' || !r.notice) { errors.push(`outcome ${name}: notice must be a non-empty string`); continue; }
        rule.notice = r.notice;
      }
      if (r.endsSpell !== undefined) {
        if (typeof r.endsSpell !== 'boolean') { errors.push(`outcome ${name}: endsSpell must be a boolean`); continue; }
        rule.endsSpell = r.endsSpell;
      }
      if (r.stop !== undefined) {
        if (typeof r.stop !== 'boolean') { errors.push(`outcome ${name}: stop must be a boolean`); continue; }
        rule.stop = r.stop;
      }
      outcomes[name] = rule;
    }
  }
  const conditions: RunCondition[] = [];
  if (raw.conditions !== undefined && !Array.isArray(raw.conditions)) errors.push('conditions must be an array');
  else {
    for (const c of (raw.conditions as unknown[]) ?? []) {
      if (!isObj(c) || typeof c.flag !== 'string' || !c.flag) { errors.push('every condition needs a flag name'); continue; }
      const ck = c.kind === undefined ? 'flag' : c.kind;
      if (!(CONDITION_KINDS as readonly unknown[]).includes(ck)) errors.push(`condition ${c.flag}: unknown kind ${JSON.stringify(ck)} (it would never hold)`);
      if (c.equals !== undefined && typeof c.equals !== 'boolean') { errors.push(`condition ${c.flag}: equals must be a boolean`); continue; }
      conditions.push({ kind: typeof ck === 'string' ? ck : 'flag', flag: c.flag, equals: c.equals === undefined ? true : c.equals });
    }
  }
  for (const [f, label] of [['foreground', 'foreground'], ['restartOnBoot', 'restartOnBoot']] as const) {
    if (raw[f] !== undefined && typeof raw[f] !== 'boolean') errors.push(`${label} must be a boolean`);
  }
  if (errors.length) return { ok: false, errors };
  const spec: JobSpec = {
    id, kind, interval, outcomes, conditions,
    foreground: raw.foreground === true,
    restartOnBoot: raw.restartOnBoot === true,
  };
  if (typeof raw.label === 'string' && raw.label) spec.label = raw.label;
  if (typeof raw.module === 'string' && raw.module) spec.module = raw.module;
  return { ok: true, errors: [], spec };
}

/* ---------- pure decisions ---------- */

/** A requested interval clamped into the bounds (a non-number or NaN falls back to the default). */
export function clampInterval(bounds: IntervalBounds, ms: unknown): number {
  const v = typeof ms === 'number' && Number.isFinite(ms) ? Math.floor(ms) : bounds.defaultMs;
  return Math.min(bounds.maxMs, Math.max(bounds.minMs, v));
}

/** The conditions that don't hold right now (flag names). A missing flag counts as false; an unknown kind never holds. */
export function unmetConditions(spec: JobSpec, flags: Record<string, boolean>): string[] {
  const out: string[] = [];
  for (const c of spec.conditions) {
    const kind = c.kind ?? 'flag';
    const want = c.equals === undefined ? true : c.equals;
    const have = flags[c.flag] === true;
    if (kind !== 'flag' || have !== want) out.push(c.flag);
  }
  return out;
}

/** Boot / update: start the job again only when it asks for that and its conditions hold. */
export function shouldRestart(spec: JobSpec, flags: Record<string, boolean>): boolean {
  return spec.restartOnBoot && unmetConditions(spec, flags).length === 0;
}

export function outcomeRule(spec: JobSpec, outcome: string): OutcomeRule {
  return spec.outcomes[outcome] ?? spec.outcomes[FALLBACK_OUTCOME] ?? { delay: { kind: 'interval' } };
}

/** The delay a rule yields for the given state (interval and streak). */
export function delayFor(rule: DelayRule, intervalMs: number, streak: number): number {
  switch (rule.kind) {
    case 'interval': return intervalMs;
    case 'fixed': return rule.ms;
    case 'exponential': {
      const factor = rule.factor ?? DEFAULT_BACKOFF_FACTOR;
      const n = Math.max(0, streak - 1);
      let v = rule.baseMs;
      for (let i = 0; i < n && v < rule.maxMs; i++) v *= factor;
      return Math.min(rule.maxMs, Math.floor(v));
    }
  }
}

/* ---------- state machine ---------- */

export const JOB_PHASES = ['idle', 'running', 'sleeping', 'stopped'] as const;
export type JobPhase = (typeof JOB_PHASES)[number];

export interface JobState {
  phase: JobPhase;
  /** the current (clamped) interval */
  intervalMs: number;
  lastOutcome: string | null;
  /** consecutive runs that ended with `lastOutcome` */
  streak: number;
  runs: number;
  /** how long the host was told to sleep (null unless sleeping) */
  sleepMs: number | null;
  /** notices shown in the current spell */
  notices: string[];
  stopReason: string | null;
}

export type JobEvent =
  /** the host wants the job up (a command, the UI, a boot restart); `checkNow` restarts a running job at once */
  | { type: 'start'; checkNow?: boolean }
  | { type: 'stop' }
  | { type: 'check-now' }
  /** the body finished with this outcome */
  | { type: 'outcome'; outcome: string }
  /** the sleep is over */
  | { type: 'wake' }
  /** the platform refused to host it (Android refuses a foreground start from the background) */
  | { type: 'host-refused' }
  /** the user changed the interval */
  | { type: 'interval'; ms: number }
  /** a condition flag changed; the host passes the current flags with every event */
  | { type: 'flags' };

export const JOB_EVENT_TYPES = ['start', 'stop', 'check-now', 'outcome', 'wake', 'host-refused', 'interval', 'flags'] as const;

export type JobEffect =
  /** run the body now (cancelling a run or a sleep in progress) */
  | { effect: 'run' }
  | { effect: 'sleep'; ms: number }
  | { effect: 'stop'; reason: string }
  /** show a one-time notice; `outcome` says which outcome raised it */
  | { effect: 'notice'; id: string; outcome: string }
  | { effect: 'clear-notices' }
  /** refresh what the host shows about the job (its ongoing notification) */
  | { effect: 'status'; outcome: string };

export const JOB_EFFECTS = ['run', 'sleep', 'stop', 'notice', 'clear-notices', 'status'] as const;
export const STOP_REASONS = { stopped: 'stopped', hostRefused: 'host-refused', outcome: 'outcome', condition: 'condition' } as const;

export interface JobStep {
  state: JobState;
  effects: JobEffect[];
}

export function initialJobState(spec: JobSpec, intervalMs?: number): JobState {
  return { phase: 'idle', intervalMs: clampInterval(spec.interval, intervalMs ?? spec.interval.defaultMs), lastOutcome: null, streak: 0, runs: 0, sleepMs: null, notices: [], stopReason: null };
}

const stopped = (state: JobState, reason: string): JobStep => ({ state: { ...state, phase: 'stopped', sleepMs: null, stopReason: reason }, effects: [{ effect: 'stop', reason }] });
/** A job leaving idle/stopped starts a fresh spell (notices may show again, streaks start over); from sleeping it just continues. */
const running = (state: JobState): JobStep => {
  const fresh = state.phase === 'idle' || state.phase === 'stopped';
  return { state: { ...state, phase: 'running', sleepMs: null, stopReason: null, ...(fresh ? { notices: [], streak: 0, lastOutcome: null } : {}) }, effects: [{ effect: 'run' }] };
};
const conditionStop = (spec: JobSpec, flags: Record<string, boolean>, state: JobState): JobStep | null => {
  const unmet = unmetConditions(spec, flags);
  return unmet.length ? stopped(state, `${STOP_REASONS.condition}:${unmet[0]}`) : null;
};

/**
 * One step of the job's state machine. The host carries out the effects in order. Same results on every port
 * (fixture scenarios in spec/fixtures/work.json).
 */
export function reduceJob(spec: JobSpec, state: JobState, event: JobEvent, flags: Record<string, boolean> = {}): JobStep {
  switch (event.type) {
    case 'start': {
      const blocked = conditionStop(spec, flags, state);
      if (blocked) return blocked;
      if (state.phase === 'running' && !event.checkNow) return { state, effects: [] };
      return running(state);
    }
    case 'check-now': {
      const blocked = conditionStop(spec, flags, state);
      if (blocked) return blocked;
      return running(state);
    }
    case 'stop': return stopped(state, STOP_REASONS.stopped);
    case 'host-refused': return stopped(state, STOP_REASONS.hostRefused);
    case 'interval': return { state: { ...state, intervalMs: clampInterval(spec.interval, event.ms) }, effects: [] };
    case 'flags': {
      if (state.phase !== 'running' && state.phase !== 'sleeping') return { state, effects: [] };
      return conditionStop(spec, flags, state) ?? { state, effects: [] };
    }
    case 'wake': {
      if (state.phase !== 'sleeping') return { state, effects: [] };
      const blocked = conditionStop(spec, flags, state);
      if (blocked) return blocked;
      return running(state);
    }
    case 'outcome': {
      if (state.phase !== 'running') return { state, effects: [] };
      const rule = outcomeRule(spec, event.outcome);
      const streak = state.lastOutcome === event.outcome ? state.streak + 1 : 1;
      const effects: JobEffect[] = [];
      let notices = state.notices;
      if (rule.endsSpell && notices.length) { notices = []; effects.push({ effect: 'clear-notices' }); }
      if (rule.notice && !notices.includes(rule.notice)) { notices = [...notices, rule.notice]; effects.push({ effect: 'notice', id: rule.notice, outcome: event.outcome }); }
      effects.push({ effect: 'status', outcome: event.outcome });
      const next: JobState = { ...state, lastOutcome: event.outcome, streak, runs: state.runs + 1, notices };
      if (rule.stop) {
        const s = stopped(next, `${STOP_REASONS.outcome}:${event.outcome}`);
        return { state: s.state, effects: [...effects, ...s.effects] };
      }
      const ms = delayFor(rule.delay, next.intervalMs, streak);
      effects.push({ effect: 'sleep', ms });
      return { state: { ...next, phase: 'sleeping', sleepMs: ms }, effects };
    }
  }
}

/** Replays a list of events (with the flags in force at each) from the initial state; handy for tests and tools. */
export function replayJob(spec: JobSpec, events: { event: JobEvent; flags?: Record<string, boolean> }[], intervalMs?: number): JobStep[] {
  let state = initialJobState(spec, intervalMs);
  const out: JobStep[] = [];
  for (const e of events) {
    const step = reduceJob(spec, state, e.event, e.flags ?? {});
    out.push(step);
    state = step.state;
  }
  return out;
}

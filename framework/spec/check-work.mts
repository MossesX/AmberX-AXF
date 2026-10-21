/**
 * Self-test for the work engine (work@1) on the web port (CI: npx -y tsx framework/spec/check-work.mts).
 *  1. replays spec/fixtures/work.json against core/engines/work.ts (the Kotlin kernel's WorkConformanceTest replays the same file)
 *  2. drives a tiny in-process host over the reducer (effects → body runs / sleeps / notices) to show the contract is
 *     enough to run a job: the host decides nothing.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONDITION_KINDS, DEFAULT_BACKOFF_FACTOR, DELAY_KINDS, FALLBACK_OUTCOME, JOB_EFFECTS, JOB_EVENT_TYPES, JOB_PHASES, STOP_REASONS,
  WORK_CONTRACT, WORK_PLACEHOLDERS, WORK_POLL_CAPABILITY, clampInterval, delayFor, initialJobState, reduceJob, registerWorkKind, shouldRestart,
  unmetConditions, validateJobSpec, workKind, workKinds, type JobEffect, type JobSpec, type JobState,
} from '../core/engines/work';

const f = JSON.parse(readFileSync(new URL('./fixtures/work.json', import.meta.url), 'utf8'));
let checks = 0;
const norm = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const eq = (a: unknown, b: unknown, what: string) => { assert.deepEqual(norm(a), norm(b), what); checks++; };

/* ---------- 1. fixture replay ---------- */
eq(WORK_CONTRACT, f.contract, 'contract');
eq(WORK_POLL_CAPABILITY, f.pollCapability, 'poll capability');
eq(workKinds(), f.kinds, 'kinds');
eq(WORK_PLACEHOLDERS, f.placeholders, 'placeholders');
eq(DELAY_KINDS, f.delayKinds, 'delay kinds');
eq(CONDITION_KINDS, f.conditionKinds, 'condition kinds');
eq(JOB_PHASES, f.phases, 'phases');
eq(JOB_EVENT_TYPES, f.eventTypes, 'event types');
eq(JOB_EFFECTS, f.effects, 'effects');
eq(STOP_REASONS, f.stopReasons, 'stop reasons');
eq(FALLBACK_OUTCOME, f.fallbackOutcome, 'fallback outcome');
eq(DEFAULT_BACKOFF_FACTOR, f.defaultBackoffFactor, 'default factor');
const specs: Record<string, JobSpec> = {};
for (const [name, raw] of Object.entries(f.specs)) {
  const r = validateJobSpec(raw);
  eq([r.ok, r.spec], [true, raw], `spec ${name} validates to itself`);
  specs[(raw as JobSpec).id] = r.spec!;
}
for (const c of f.validate) eq(validateJobSpec(c.raw), c.result, `validate ${c.name}`);
const A = specs['axhub.approvals'];
for (const c of f.clamp) eq(clampInterval(A.interval, c.ms === 'NaN' ? Number.NaN : c.ms), c.clamped, `clamp ${c.ms}`);
for (const c of f.conditions) eq({ unmet: unmetConditions(A, c.flags), restart: shouldRestart(A, c.flags), restartNoBoot: shouldRestart(specs['demo.backoff'], c.flags) }, { unmet: c.unmet, restart: c.restart, restartNoBoot: c.restartNoBoot }, `conditions ${JSON.stringify(c.flags)}`);
for (const d of f.delays) eq(delayFor(d.rule, d.intervalMs, d.streak), d.ms, `delay ${JSON.stringify(d.rule)} streak ${d.streak}`);
for (const s of f.scenarios) {
  const spec = specs[s.spec];
  let state: JobState = initialJobState(spec, s.intervalMs ?? undefined);
  eq(state, s.initial, `${s.name}: initial`);
  s.steps.forEach((st: { event: Parameters<typeof reduceJob>[2]; flags: Record<string, boolean>; state: JobState; effects: JobEffect[] }, i: number) => {
    const step = reduceJob(spec, state, st.event, st.flags);
    eq(step, { state: st.state, effects: st.effects }, `${s.name}: step ${i} ${JSON.stringify(st.event)}`);
    state = step.state;
  });
}

/* ---------- 2. a host over the reducer ---------- */
// kinds are an open registry: a port can mark a placeholder built
eq(workKind('alarm')?.status, 'placeholder', 'alarm is a placeholder');
registerWorkKind({ id: 'alarm', label: 'Alarm', status: 'built' });
eq(validateJobSpec({ ...A, kind: 'alarm' }).ok, true, 'a kind marked built validates');
registerWorkKind(f.kinds.find((k: { id: string }) => k.id === 'alarm'));

// the host: runs the body on `run`, "sleeps" by recording the ms, shows notices, and never decides anything itself
const log: string[] = [];
const outcomes = ['signed-out', 'signed-out', 'ok', 'unreachable', 'ok'];
let state = initialJobState(A);
let flags = { watching: true };
const apply = (step: ReturnType<typeof reduceJob>) => {
  state = step.state;
  for (const e of step.effects) {
    if (e.effect === 'run') { const o = outcomes.shift(); log.push(`run→${o ?? 'none'}`); if (o) apply(reduceJob(A, state, { type: 'outcome', outcome: o }, flags)); }
    else if (e.effect === 'sleep') log.push(`sleep ${e.ms}`);
    else if (e.effect === 'notice') log.push(`notice ${e.id} (${e.outcome})`);
    else if (e.effect === 'clear-notices') log.push('clear');
    else if (e.effect === 'status') log.push(`status ${e.outcome}`);
    else if (e.effect === 'stop') log.push(`stop ${e.reason}`);
  }
};
apply(reduceJob(A, state, { type: 'start' }, flags));
while (state.phase === 'sleeping' && outcomes.length) apply(reduceJob(A, state, { type: 'wake' }, flags));
eq(log, [
  'run→signed-out', 'notice sign-in (signed-out)', 'status signed-out', 'sleep 300000',
  'run→signed-out', 'status signed-out', 'sleep 300000',
  'run→ok', 'clear', 'status ok', 'sleep 30000',
  'run→unreachable', 'status unreachable', 'sleep 30000',
  'run→ok', 'status ok', 'sleep 30000',
], 'host log');
flags = { watching: false };
apply(reduceJob(A, state, { type: 'wake' }, flags));
eq([state.phase, state.stopReason, log.at(-1)], ['stopped', 'condition:watching', 'stop condition:watching'], 'watching off stops at the next wake');
eq(shouldRestart(A, flags), false, 'no boot restart while watching is off');
eq(shouldRestart(A, { watching: true }), true, 'boot restart while watching is on');

console.log(`✓ work engine: ${checks} checks (fixture work.json + a host over the reducer)`);

#!/usr/bin/env node
/**
 * build-recovery@1 conformance: stuck builds → the actions the orchestrator applies on its own, with no side effects.
 *   node framework/spec/check-build-recovery.mjs           check
 *   node framework/spec/check-build-recovery.mjs --write   regenerate fixtures/build-recovery.json's expected outputs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../core/build-recovery.mjs';
import { normBuild, normalizeStore } from '../plan/builds-store-core.mjs';
import { mergeBuild } from '../plan/builds-merge-core.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/build-recovery.json');
const WRITE = process.argv.includes('--write');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const NOW = '2026-11-13T12:00:00Z';
const ago = (min) => new Date(Date.parse(NOW) - min * 60e3).toISOString();
const step = (id, extra = {}) => ({ id, uid: `u-${id}`, text: `step ${id}`, model: 'Opus', phase: 'Phase 1', ...extra });
const running = (id, pipeline = {}, extra = {}) => ({ id, title: id.replace(/-/g, ' '), status: 'running', steps: [step('s1', { done: true, doneAt: ago(120) }), step('s2')], pipeline: { account: 'w-max', session: `axf-${id}--joey`, slot: `hl-${id}`, launchedAt: ago(60), ...pipeline }, ...extra });
const live = (id, heartbeatMin = 2) => ({ name: `axf-${id}--joey`, alive: true, heartbeatAt: ago(heartbeatMin) });
const ended = (id, exit) => ({ name: `axf-${id}--joey`, alive: false, exit });
const slotFor = (id, build = id) => ({ id: `hl-${id}`, name: build, state: 'running', session: `axf-${id}--joey`, build });
const tried = (attempts, lastMin, cause = 'killed') => ({ attempts, lastAt: ago(lastMin), lastCause: cause, lastExit: 143, nextAt: '', parkedAt: '' });

/** Every case: { builds, sessions, slots, now, policy? } → plan() + assess() per build. */
const IN = {
  // 1. each stuck state
  noSession: { builds: [running('ghost')], sessions: [], slots: { running: [] }, now: NOW },
  noSessionNeverNamed: { builds: [running('silent', { session: '', slot: '' })], sessions: [], slots: { running: [] }, now: NOW },
  killed143: { builds: [running('deployed')], sessions: [ended('deployed', 143)], slots: { running: [] }, now: NOW },
  killed137: { builds: [running('oom')], sessions: [ended('oom', 137)], slots: { running: [] }, now: NOW },
  failed1: { builds: [running('crashed')], sessions: [ended('crashed', 1)], slots: { running: [] }, now: NOW },
  exitZeroStepsLeft: { builds: [running('quiet')], sessions: [ended('quiet', 0)], slots: { running: [] }, now: NOW },
  staleHeartbeat: { builds: [running('hung')], sessions: [live('hung', 45)], slots: { running: [slotFor('hung')] }, now: NOW },
  slotLeaked: { builds: [{ id: 'landed', title: 'Landed', status: 'built', steps: [step('s1', { done: true, doneAt: ago(30) })], pipeline: { account: 'w-max', session: 'axf-landed--joey', slot: 'hl-landed' } }], sessions: [], slots: { running: [slotFor('landed'), { id: 'hl-orphan', name: 'orphan', state: 'running', session: 'axf-orphan--joey', build: 'orphan' }] }, now: NOW },
  // the exit comes from the pipeline's own end record when the session list no longer has the session
  lastRunExit: { builds: [running('ended', { lastRun: { at: ago(10), exit: 143, outcome: 'requeued', stepsLeft: 1, account: 'w-max', session: 'axf-ended--joey' } })], sessions: [], slots: { running: [] }, now: NOW },
  lastRunOlderThanLaunch: { builds: [running('relaunched', { launchedAt: ago(30), lastRun: { at: ago(90), exit: 1, outcome: 'requeued', stepsLeft: 1, account: 'w-max', session: 'axf-relaunched--joey' } })], sessions: [], slots: { running: [] }, now: NOW },
  // 2. nothing to do
  healthy: { builds: [running('fine')], sessions: [live('fine')], slots: { running: [slotFor('fine')] }, now: NOW },
  healthyBySlot: { builds: [running('slotted')], sessions: null, slots: { running: [slotFor('slotted')] }, now: NOW },
  healthyNoHeartbeat: { builds: [running('plain')], sessions: ['axf-plain--joey'], slots: null, now: NOW },
  launching: { builds: [running('fresh', { launchedAt: ago(1) })], sessions: [], slots: { running: [] }, now: NOW },
  merged: { builds: [running('shipped', {}, { mergedAt: ago(5), pr: '#410' })], sessions: [], slots: { running: [] }, now: NOW },
  complete: { builds: [running('done', {}, { status: 'complete' })], sessions: [], slots: { running: [] }, now: NOW },
  deleted: { builds: [running('gone', {}, { deleted: true, deletedAt: ago(5) })], sessions: [], slots: { running: [] }, now: NOW },
  noStepsLeft: { builds: [running('finished', {}, { steps: [step('s1', { done: true, doneAt: ago(3) })] })], sessions: [], slots: { running: [] }, now: NOW },
  queuedOrPending: { builds: [running('waits', {}, { status: 'queued' }), running('filed', {}, { status: 'pending' })], sessions: [], slots: { running: [] }, now: NOW },
  noFacts: { builds: [running('blind')], sessions: null, slots: null, now: NOW },
  junk: { builds: [null, 'x', {}, { id: 'bare' }], sessions: [], slots: { running: [] }, now: NOW },
  // 3. the retry counter, its backoff, the cap
  secondTry: { builds: [running('again', {}, { recovery: tried(1, 30) })], sessions: [ended('again', 143)], slots: { running: [] }, now: NOW },
  thirdTry: { builds: [running('third', {}, { recovery: tried(2, 30) })], sessions: [ended('third', 1)], slots: { running: [] }, now: NOW },
  retryCap: { builds: [running('hopeless', {}, { recovery: tried(3, 30) })], sessions: [ended('hopeless', 143)], slots: { running: [] }, now: NOW },
  inBackoff: { builds: [running('cooling', {}, { recovery: { ...tried(1, 2), nextAt: ago(-3) } })], sessions: [ended('cooling', 143)], slots: { running: [] }, now: NOW },
  backoffOver: { builds: [running('cooled', {}, { recovery: { ...tried(1, 10), nextAt: ago(1) } })], sessions: [ended('cooled', 143)], slots: { running: [] }, now: NOW },
  progressResets: { builds: [running('moving', {}, { recovery: tried(3, 30), steps: [step('s1', { done: true, doneAt: ago(10) }), step('s2')] })], sessions: [ended('moving', 143)], slots: { running: [] }, now: NOW },
  customPolicy: { builds: [running('once')], sessions: [ended('once', 1)], slots: { running: [] }, now: NOW, policy: { maxAttempts: 1, backoffMs: [120e3] } },
  // 4. a build the pipeline gave up on: retried while fresh, left alone when old
  failedBuild: { builds: [running('given-up', { lastRun: { at: ago(20), exit: 1, outcome: 'failed', stepsLeft: 1, account: 'w-max', session: 'axf-given-up--joey' }, runs: 3 }, { status: 'failed' })], sessions: [], slots: { running: [] }, now: NOW },
  failedOld: { builds: [running('ancient', { lastRun: { at: ago(3 * 24 * 60), exit: 1, outcome: 'failed', stepsLeft: 1, account: 'w-max', session: 'axf-ancient--joey' }, runs: 3 }, { status: 'failed', updatedAt: ago(3 * 24 * 60) })], sessions: [], slots: { running: [] }, now: NOW },
  failedNotRetried: { builds: [running('kept', { lastRun: { at: ago(20), exit: 1, outcome: 'failed', stepsLeft: 1 } }, { status: 'failed' })], sessions: [], slots: { running: [] }, now: NOW, policy: { retryFailedBuilds: false } },
  // 5. several at once: builds first in their order, then leaked slots; a build requeued now frees its slot too
  mixed: { builds: [running('a-dead'), running('b-fine'), running('c-hung', {}, { status: 'waiting' })], sessions: [ended('a-dead', 143), live('b-fine'), live('c-hung', 30)], slots: { running: [slotFor('a-dead'), slotFor('b-fine'), slotFor('c-hung')] }, now: NOW },
};

const run = () => {
  const plan = Object.fromEntries(Object.entries(IN).map(([k, c]) => [k, R.plan(c.builds, c.sessions, c.slots, c.now, c.policy)]));
  const assess = Object.fromEntries(Object.entries(IN).map(([k, c]) => [k, c.builds.map((b) => R.assess(b, { sessions: c.sessions, slots: c.slots, now: c.now, policy: c.policy ? { ...R.POLICY, ...c.policy } : R.POLICY }))]));
  // the counter through three fixes and the park, as the executor would write it
  const chain = []; let rec = R.emptyRecovery(); let b = running('chain');
  for (let i = 0; i < 4; i++) {
    const at = new Date(Date.parse(NOW) + i * 3600e3).toISOString();
    const [a] = R.plan([{ ...b, recovery: rec }], [ended('chain', 143)], { running: [] }, at);
    rec = R.applyToRecovery(rec, a);
    chain.push({ action: a.action, attempt: a.attempt, delayMs: a.delayMs, nextAt: a.nextAt, status: a.status, recovery: { attempts: rec.attempts, nextAt: rec.nextAt, parkedAt: rec.parkedAt, events: rec.events.length } });
  }
  return {
    plan, assess, chain,
    reset: R.resetRecovery(rec, { now: NOW, why: 'queued by brett' }),
    canLaunch: [{ recovery: { nextAt: ago(-5) } }, { recovery: { nextAt: ago(5) } }, { recovery: {} }, {}].map((x) => R.canLaunch(x, NOW)),
    norm: [undefined, null, 'junk', { attempts: -1, lastCause: 'nope', lastExit: '1', events: [null, { action: 'retry', at: NOW, build: 'x' }, { action: 'nope', at: NOW }] }, { attempts: 2, lastAt: NOW, lastCause: 'failed', lastExit: 1, nextAt: NOW, parkedAt: NOW, events: [] }].map(R.normRecovery),
    normBuild: normBuild({ id: 'kept', title: 'Kept', recovery: tried(2, 30) }).recovery,
    oldRecord: normBuild({ id: 'old', title: 'Old' }).recovery,
    migrate: (() => { const { store, defaulted } = R.migrateRecovery({ $axf: 'builds@1', builds: [{ id: 'a' }, { id: 'b', recovery: tried(1, 5) }] }, { now: NOW }); return { defaulted, recovery: store.builds.map((x) => x.recovery.attempts), meta: store.meta.recovery }; })(),
    validate: { ok: R.validateEvent({ action: 'retry', at: NOW, build: 'x' }).errors, bad: R.validateEvent({ action: 'nope', cause: 'what', exit: '1', attempt: -1 }).errors.map((e) => e.field) },
    causeOfExit: [undefined, null, 0, 1, 2, 130, 137, 143].map(R.causeOfExit),
    backoff: [0, 1, 2, 3, 9].map((a) => R.backoffFor(a)),
  };
};

const actual = run();
if (WRITE) { writeFileSync(FIX, `${JSON.stringify({ $axf: R.SCHEMA, note: 'Generated by framework/spec/check-build-recovery.mjs --write; every port replays `in` (plan + assess per case) and must answer `out`.', in: IN, out: actual }, null, 1)}\n`); console.log(`wrote ${FIX}`); }
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
t('fixture inputs are the ones in this file', () => assert.ok(same(fx.in, IN), 'inputs drifted: run with --write'));
for (const k of Object.keys(fx.out)) t(`fixture replay: ${k}`, () => assert.deepEqual(actual[k], fx.out[k]));

const acts = (k) => actual.plan[k].map((a) => `${a.action}:${a.state}`);
const one = (k) => { assert.equal(actual.plan[k].length, 1, `${k}: one action`); return actual.plan[k][0]; };
t('running with no live session: reset the step and requeue (attempt 1, 1 min backoff), whether or not a session was ever named', () => {
  for (const k of ['noSession', 'noSessionNeverNamed']) { const a = one(k); assert.equal(a.action, 'requeue'); assert.equal(a.state, 'no-session'); assert.equal(a.step, 's2'); assert.equal(a.attempt, 1); assert.equal(a.delayMs, 60e3); assert.equal(a.status, 'queued'); assert.equal(a.exit, null); }
  assert.equal(one('noSession').nextAt, new Date(Date.parse(NOW) + 60e3).toISOString());
});
t('a session killed from outside (143 / 137) is retried; one that failed on its own (exit 1) too; exit 0 with steps left is simply gone', () => {
  assert.deepEqual(acts('killed143'), ['retry:killed']); assert.equal(one('killed143').exit, 143);
  assert.deepEqual(acts('killed137'), ['retry:killed']);
  assert.deepEqual(acts('failed1'), ['retry:failed']); assert.equal(one('failed1').exit, 1);
  assert.deepEqual(acts('exitZeroStepsLeft'), ['requeue:no-session']);
  assert.deepEqual(acts('lastRunExit'), ['retry:killed'], 'the pipeline end record gives the exit when the session list no longer has it');
  assert.deepEqual(acts('lastRunOlderThanLaunch'), ['requeue:no-session'], 'an end record from before the current launch says nothing about it');
});
t('a hung session (stale heartbeat) is killed first, then retried; its slot is released too', () => {
  assert.deepEqual(acts('staleHeartbeat'), ['retry:stale-heartbeat', 'release-slot:slot-leaked']);
  const a = actual.plan.staleHeartbeat[0]; assert.equal(a.kill, 'axf-hung--joey'); assert.match(a.line, /hung/); assert.equal(actual.plan.staleHeartbeat[1].slot, 'hl-hung');
});
t('a leaked slot is released: the slot of a built build, and one naming a build the store does not know', () => {
  assert.deepEqual(acts('slotLeaked'), ['release-slot:slot-leaked', 'release-slot:slot-leaked']);
  assert.deepEqual(actual.plan.slotLeaked.map((a) => [a.build, a.slot, a.status]), [['landed', 'hl-landed', ''], ['orphan', 'hl-orphan', '']]);
});
t('nothing to do: healthy (session alive, by slot, or named without a heartbeat), launching, merged, complete, deleted, no steps left, not live, no facts, junk', () => {
  for (const k of ['healthy', 'healthyBySlot', 'healthyNoHeartbeat', 'launching', 'merged', 'complete', 'deleted', 'noStepsLeft', 'queuedOrPending', 'noFacts', 'junk']) assert.deepEqual(actual.plan[k], [], k);
  const why = (k) => actual.assess[k].map((a) => a.why);
  assert.deepEqual(why('healthy'), ['healthy']); assert.deepEqual(why('launching'), ['launching']); assert.deepEqual(why('merged'), ['merged']); assert.deepEqual(why('complete'), ['merged']);
  assert.deepEqual(why('deleted'), ['deleted']); assert.deepEqual(why('noStepsLeft'), ['no steps left']); assert.deepEqual(why('queuedOrPending'), ['not live', 'not live']); assert.deepEqual(why('noFacts'), ['no facts']);
});
t('a merged build is never requeued, even when marked running with nothing live', () => { assert.equal(IN.merged.builds[0].status, 'running'); assert.deepEqual(actual.plan.merged, []); });
t('the counter: attempt 2 waits 5 min, attempt 3 waits 15 min, attempt 4 parks the build in Pending', () => {
  assert.deepEqual([one('secondTry').attempt, one('secondTry').delayMs], [2, 300e3]);
  assert.deepEqual([one('thirdTry').attempt, one('thirdTry').delayMs], [3, 900e3]);
  const p = one('retryCap'); assert.equal(p.action, 'park'); assert.equal(p.status, 'pending'); assert.equal(p.attempt, 3); assert.equal(p.nextAt, ''); assert.match(p.line, /^Parked:/);
  assert.deepEqual(actual.chain.map((c) => [c.action, c.attempt, c.delayMs]), [['retry', 1, 60e3], ['retry', 2, 300e3], ['retry', 3, 900e3], ['park', 3, 0]]);
  assert.equal(actual.chain[3].recovery.parkedAt, new Date(Date.parse(NOW) + 3 * 3600e3).toISOString()); assert.equal(actual.chain[3].recovery.events, 4);
});
t('backoff timing: nothing while nextAt is ahead, the next attempt once it passed; progress since the last fix starts the count over', () => {
  assert.deepEqual(actual.plan.inBackoff, []); assert.deepEqual(actual.assess.inBackoff.map((a) => a.why), ['backoff']);
  assert.equal(one('backoffOver').attempt, 2);
  assert.equal(one('progressResets').attempt, 1, 'a step ticked after the last recovery resets the counter');
  assert.deepEqual(actual.canLaunch, [false, true, true, true]);
  assert.deepEqual(actual.backoff, [60e3, 60e3, 300e3, 900e3, 900e3]);
});
t('policy is a parameter: a cap of one parks on the second fix; failed builds can be left alone', () => {
  const a = one('customPolicy'); assert.equal(a.action, 'retry'); assert.equal(a.max, 1); assert.equal(a.delayMs, 120e3);
  assert.deepEqual(actual.plan.failedNotRetried, []);
});
t('a build the pipeline gave up on is retried while the failure is fresh, never when it is days old', () => {
  const a = one('failedBuild'); assert.equal(a.action, 'retry'); assert.equal(a.state, 'failed'); assert.equal(a.exit, 1); assert.equal(a.status, 'queued');
  assert.deepEqual(actual.plan.failedOld, []); assert.deepEqual(actual.assess.failedOld.map((x) => x.why), ['failed too long ago']);
});
t('several at once: builds in order, a requeued build frees its slot, a healthy one is untouched', () => {
  assert.deepEqual(actual.plan.mixed.map((a) => [a.action, a.build]), [['retry', 'a-dead'], ['retry', 'c-hung'], ['release-slot', 'a-dead'], ['release-slot', 'c-hung']]);
});
t('every action carries a recovery-event@1 that validates and normalises to itself, and a phone line', () => {
  for (const acts of Object.values(actual.plan)) for (const a of acts) { assert.ok(a.event, a.build); assert.ok(R.validateEvent(a.event).ok, a.event.id); assert.deepEqual(R.normEvent(a.event), a.event); assert.equal(a.event.line, a.line); assert.ok(a.line.length > 10); assert.equal(a.event.phase, a.action === 'release-slot' && ['orphan', 'landed'].includes(a.build) ? '' : 'Phase 1', `${a.build}: the phase is the open step's`); }
  assert.deepEqual(actual.validate.ok, []); assert.deepEqual(actual.validate.bad, ['action', 'at', 'build', 'cause', 'exit', 'attempt']);
});
t('plan() is pure: the inputs are untouched and two runs agree', () => { const before = JSON.stringify(IN); run(); assert.equal(JSON.stringify(IN), before); assert.deepEqual(run(), actual); });
t('builds@1 keeps the recovery record; a record from before build-recovery@1 reads as the default; the migration counts what it defaulted', () => {
  assert.equal(actual.normBuild.attempts, 2); assert.equal(actual.normBuild.lastCause, 'killed');
  assert.deepEqual(actual.oldRecord, R.emptyRecovery());
  assert.deepEqual([actual.migrate.defaulted, actual.migrate.recovery], [1, [0, 1]]); assert.equal(actual.migrate.meta.migratedAt, NOW);
  const s = normalizeStore({ $axf: 'builds@1', builds: [{ id: 'x', title: 'X' }] }); assert.deepEqual(s.builds[0].recovery, R.emptyRecovery());
  const a = normBuild({ id: 'm', title: 'M', updatedAt: ago(5), recovery: tried(2, 10) }); const b = normBuild({ id: 'm', title: 'M', updatedAt: ago(1) });
  assert.equal(mergeBuild(a, b).recovery.attempts, 0, 'the newer copy wins the record (the executor writes both together)');
  assert.equal(mergeBuild(b, a).recovery.attempts, 0);
});
t('normRecovery: junk reads as the default, bad fields drop, bad events drop', () => {
  assert.deepEqual(actual.norm[0], R.emptyRecovery()); assert.deepEqual(actual.norm[1], R.emptyRecovery()); assert.deepEqual(actual.norm[2], R.emptyRecovery());
  assert.deepEqual([actual.norm[3].attempts, actual.norm[3].lastCause, actual.norm[3].lastExit, actual.norm[3].events.length], [0, '', null, 1]);
  assert.equal(actual.norm[4].attempts, 2);
  assert.deepEqual(actual.causeOfExit, ['no-session', 'no-session', 'no-session', 'failed', 'failed', 'failed', 'killed', 'killed']);
  assert.deepEqual([actual.reset.attempts, actual.reset.nextAt, actual.reset.events.at(-1).action], [0, '', 'reset']);
});
t('registry: states, actions and the action per state are closed lists', () => {
  assert.deepEqual(R.STATES, ['no-session', 'killed', 'failed', 'stale-heartbeat', 'slot-leaked']);
  assert.deepEqual(R.ACTIONS, ['requeue', 'retry', 'park', 'release-slot']);
  for (const s of R.STATES) assert.ok(R.ACTIONS.includes(R.ACTION_FOR[s]), s);
  for (const a of R.ACTIONS) assert.ok(a in R.STATUS_AFTER, a);
});
t('schemas/build-recovery.json + schemas/json/{build-recovery,recovery-event}.schema.json are current (run axf schemas)', () => { assert.ok(same(JSON.parse(rd('framework/schemas/build-recovery.json')), R.REGISTRY)); for (const [name, s] of Object.entries(R.jsonSchemas())) assert.ok(same(JSON.parse(rd(`framework/schemas/json/${name}`)), s), name); });
t('PORTING.md lists the contract', () => assert.match(rd('framework/spec/PORTING.md'), /build-recovery@1/));
console.log(`check-build-recovery: ${n} checks passed`);

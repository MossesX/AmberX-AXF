#!/usr/bin/env node
/**
 * build-pipeline@1 checks: the exit transition. A session that ends cleanly with its phase done and steps left goes
 * back to the Queue ('phase-done'), keeps its place and never counts as a crash; a crash requeues until maxRuns
 * crashes, then Pending ('crash-limit'); Pending otherwise only for a blocked upgrade, a session that needs Brett, or
 * a stop mid-phase. Golden cases live in fixtures/build-pipeline-exit.json: `transition` replays the pure
 * nextStatusOnExit(), `sessions` replays the dispatcher's endOutcome() on build records.
 * Single Queued (Nov 28 2026): fixtures/build-pipeline.json replays the queue contract (queue, promote, goLive, hold,
 * cancel, unqueue, release, keepStop, settleQueue and whole sequences) and, beyond the golden answers, asserts on every
 * op: at most one build queued, promotion only into a free Queue and only of the head of the Pending line, and a hold /
 * cancel / unqueue kept by every automated writer and every reconcile pass until an owner lifts it.
 *   node framework/spec/check-build-pipeline.mjs            compare the engine with the fixture
 *   node framework/spec/check-build-pipeline.mjs --write    regenerate the fixture's `out` blocks from the engine
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const FIXTURE = join(HERE, 'fixtures/build-pipeline-exit.json');
const WRITE = process.argv.includes('--write');

const BP = await import('../core/build-pipeline.mjs');
const { setUpgradePolicy } = await import('../core/model-switch.mjs');
const P = await import(join(ROOT, 'apps/console-web/plugins/build-orchestrator/pipeline-core.mjs')); // axf-plugin:build-orchestrator

let n = 0; let failed = 0;
const ok = (cond, what) => { n++; if (!cond) { failed++; console.error(`FAIL ${what}`); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const NOW = '2026-11-08T01:00:00.000Z';
const QUEUED_AT = '2026-11-08T00:00:00.000Z';

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
eq(fixture.$axf, 'build-pipeline-exit@1', 'fixture schema');
const maxRuns = fixture.maxRuns ?? BP.DEFAULT_MAX_RUNS;

// ---------------- the pure transition
const pick = (r) => ({ status: r.status, outcome: r.outcome, reason: r.reason, crashes: r.crashes, keepQueue: r.keepQueue });
for (const c of fixture.transition) {
  const got = pick(BP.nextStatusOnExit(c.in, c.maxRuns ?? maxRuns));
  if (WRITE) c.out = got; else eq(got, c.out, `transition: ${c.name}`);
  ok(BP.EXIT_REASONS.includes(got.reason), `transition: ${c.name}: reason ${got.reason} is in EXIT_REASONS`);
  ok(got.keepQueue === (got.status === 'queued'), `transition: ${c.name}: keepQueue follows the Queue`);
  ok(['landing', 'queued', 'pending'].includes(got.status), `transition: ${c.name}: never a status off the table (all done = landing, done-means-merged@1)`);
}
// a clean phase end is never a crash, whatever the run count; a crash always adds one
for (let runs = 1; runs <= 6; runs++) {
  eq(BP.nextStatusOnExit({ exit: 0, stepsLeft: 1, runs, crashes: 0, phaseDone: true }).status, 'queued', `phase-done on run ${runs} stays queued`);
  eq(BP.nextStatusOnExit({ exit: 0, stepsLeft: 1, runs, crashes: 2, phaseDone: true }).crashes, 2, `phase-done on run ${runs} adds no crash`);
}
eq([0, 1, 2].map((c) => BP.nextStatusOnExit({ exit: 1, stepsLeft: 1, runs: c + 1, crashes: c }).status), ['queued', 'queued', 'pending'], 'crash, crash, limit');
eq(BP.nextStatusOnExit({ exit: 0, stepsLeft: 1, phaseDone: true, upgradeBlocked: true, needsBrett: true }).reason, 'upgrade-blocked', 'a blocked upgrade is named before anything else');
eq(BP.nextStatusOnExit({ exit: 0, stepsLeft: 1, phaseDone: true, needsBrett: true }).reason, 'needs-brett', 'Brett before the phase end');
eq(BP.nextStatusOnExit({ exit: 7, stepsLeft: 1, phaseDone: true, upgradeBlocked: true }).reason, 'crash', 'a failed exit is a crash, whatever the phase says');
eq(BP.nextStatusOnExit(null).reason, 'all-done', 'no input: nothing left');
eq(BP.nextStatusOnExit({ exit: 1, stepsLeft: 1, runs: 9 }, 0).status, 'pending', 'a bad maxRuns falls back to the default (3)');
eq(BP.STATUS_AFTER.failed, 'pending', 'the crash limit sends a build to Pending, never off the table');
// the older outcome-only call still answers
eq(BP.outcomeOf({ exit: 0, stepsLeft: 2, runs: 1, phaseSwitch: true }), 'requeued', 'outcomeOf: phaseSwitch = phase done');
eq(BP.outcomeOf({ exit: 0, stepsLeft: 2, runs: 1 }), 'returned', 'outcomeOf: a stop');
eq(BP.outcomeOf({ exit: 1, stepsLeft: 2, runs: 3 }), 'failed', 'outcomeOf: the limit by runs');

// ---------------- the record
const run = { at: NOW, exit: 0, outcome: 'requeued', reason: 'phase-done', stepsLeft: 2, account: 'w-max', session: 'axf-x--a', phase: 'Schema' };
const p = BP.normPipeline({ queuedAt: QUEUED_AT, runs: 2, crashes: 1, phase: 'Schema', lastRun: run });
eq([p.phase, p.crashes, p.lastRun.reason, p.lastRun.phase], ['Schema', 1, 'phase-done', 'Schema'], 'normPipeline keeps phase, crashes, lastRun.reason and lastRun.phase');
eq(BP.normPipeline({ queuedAt: QUEUED_AT, crashes: -2, lastRun: { ...run, reason: 'nope' } }).lastRun.reason, '', 'an unknown reason reads as none');
eq(BP.normPipeline({ queuedAt: QUEUED_AT, crashes: -2 }).crashes, 0, 'a negative crash count reads as 0');
eq(BP.normPipeline({ phase: '', crashes: 0 }), null, 'the new fields at rest leave the record empty');
eq(BP.emptyPipeline().crashes, 0, 'emptyPipeline has crashes');
eq(BP.emptyPipeline().phase, '', 'emptyPipeline has phase');

// ---------------- tabs: a crash-limited build in Pending shows under Errors; a requeued one in the Queue
const steps = [{ id: 's1', done: false, skip: false, model: 'Opus' }];
eq(BP.tabOf({ status: 'pending', steps, pipeline: { runs: 3, lastRun: { ...run, outcome: 'failed', reason: 'crash-limit' } } }), 'errors', 'crash limit → Errors tab');
eq(BP.tabOf({ status: 'pending', steps, pipeline: { runs: 1, lastRun: { ...run, outcome: 'returned', reason: 'stopped' } } }), 'incomplete', 'a stop → Incomplete');
eq(BP.tabOf({ status: 'queued', steps, pipeline: { runs: 1, lastRun: run } }), 'queue', 'phase done → Queue');
eq(BP.tabOf({ status: 'queued', steps, pipeline: { runs: 2, lastRun: { ...run, outcome: 'failed' } } }), 'queue', 'Brett queued it again after the limit: Queue, not Errors');

// ---------------- the note lines
const b = { pipeline: { runs: 2 }, steps: [{ id: 's1', done: true, model: 'Fable' }, { id: 's2', done: false, model: 'Opus' }] };
ok(/finished phase Schema with 2 steps left: back in the Queue at its place, the next phase \(Opus\) starts by itself/.test(BP.outcomeLine(b, run)), `phase-done line: ${BP.outcomeLine(b, run)}`);
ok(/back in the Queue \(run 2\)/.test(BP.outcomeLine(b, { ...run, exit: 1, reason: 'crash' })), 'crash line');
ok(/needs Brett's approval/.test(BP.outcomeLine(b, { ...run, outcome: 'returned', reason: 'upgrade-blocked' })), 'blocked upgrade line');
ok(/needs Brett: back in Pending/.test(BP.outcomeLine(b, { ...run, outcome: 'returned', reason: 'needs-brett' })), 'needs-brett line');
ok(/stopped on its own .* back in Pending for Brett/.test(BP.outcomeLine(b, { ...run, outcome: 'returned', reason: 'stopped' })), 'stopped line');
ok(/crash limit reached, failed: back in Pending for Brett/.test(BP.outcomeLine(b, { ...run, exit: 1, outcome: 'failed', reason: 'crash-limit' })), 'crash-limit line');

// ---------------- the dispatcher's endOutcome on build records
const fullStep = (s, i) => ({ id: s.id ?? `s${i + 1}`, uid: `u-${s.id ?? i}`, text: `${s.id ?? i} work`, model: s.model, estimate: '10 min', done: !!s.done, doneAt: s.done ? (s.doneAt ?? NOW) : '', skip: false, files: [], checks: [], session: 'same', agent: false, why: '', phase: s.phase ?? '', group: '', note: '' });
// records as the store holds them: every pipeline field in shape (normPipeline), as setPipeline() writes it
const fullBuild = (c) => ({ id: 'x', title: 'x', createdAt: NOW, updatedAt: NOW, notes: [], approvals: [], upgradeRequests: [], deleted: false, hidden: false, ...c.build, steps: c.build.steps.map(fullStep), pipeline: BP.normPipeline({ queuedAt: QUEUED_AT, ...(c.build.pipeline ?? {}) }) });
for (const c of fixture.sessions) {
  setUpgradePolicy({ approvalRequired: c.policy === 'on', source: 'check-build-pipeline' });
  const r = P.endOutcome(fullBuild(c), { exit: c.exit, now: NOW, needsBrett: !!c.needsBrett }, P.normSettings({ maxRuns }));
  const got = { status: r.status, outcome: r.outcome, reason: r.reason, crashes: r.crashes, keepQueue: r.keepQueue, phase: r.run.phase, queuedAtKept: !('queuedAt' in r.patch) };
  if (WRITE) c.out = got; else eq(got, c.out, `session: ${c.name}`);
  eq([r.run.reason, r.run.outcome, r.patch.crashes, r.patch.session, r.patch.slot], [r.reason, r.outcome, r.crashes, '', ''], `session: ${c.name}: lastRun and the patch agree`);
  ok(r.note.length > 10 && (r.outcome === 'finished' ? r.patch.note === '' : r.patch.note === r.note), `session: ${c.name}: note on the record unless finished`);
}
setUpgradePolicy({ approvalRequired: false, source: 'check-build-pipeline' });
// a requeued build keeps its place: queueOrder by queuedAt is untouched by the end patch
const early = { id: 'early', status: 'queued', createdAt: NOW, pipeline: { queuedAt: QUEUED_AT } };
const later = { id: 'later', status: 'queued', createdAt: NOW, pipeline: { queuedAt: '2026-11-08T00:20:00.000Z' } };
const ended = P.endOutcome(fullBuild(fixture.sessions[0]), { exit: 0, now: NOW });
eq(BP.queueOrder([later, { ...early, pipeline: BP.normPipeline({ ...early.pipeline, ...ended.patch }) }]).map((x) => x.id), ['early', 'later'], 'the phase-done build is still first in the Queue');
// launchedPhase: the recorded name wins; without one, the phase holding a step ticked during the run
const lp = fullBuild(fixture.sessions[1]);
eq(P.launchedPhase(lp)?.name, 'Phase 1', 'launchedPhase by the recorded name');
eq(P.launchedPhase({ ...lp, pipeline: { ...lp.pipeline, phase: '' } })?.name, 'Phase 1', 'launchedPhase by the ticked step');
eq(P.launchedPhase({ ...lp, pipeline: { ...lp.pipeline, phase: '', launchedAt: '2026-11-08T02:00:00.000Z' } }), null, 'nothing ticked since the launch and no name: unknown');

// ---------------- single Queued (Nov 28 2026): one queued max, promotion on go-live, hold / cancel / unqueue stick
const QFIXTURE = join(HERE, 'fixtures/build-pipeline.json');
const qfx = JSON.parse(readFileSync(QFIXTURE, 'utf8'));
eq(qfx.$axf, 'build-pipeline@1', 'queue fixture schema');
eq(qfx.queueMax, BP.QUEUE_MAX, 'queue fixture: queueMax');
eq(BP.QUEUE_MAX, 1, 'one build in the Queue');
eq(qfx.stopKinds, BP.STOP_KINDS, 'queue fixture: stopKinds');
eq(qfx.ownerActors, BP.OWNER_ACTORS, 'queue fixture: ownerActors');
eq(qfx.sentStatuses, BP.SENT_STATUSES, 'queue fixture: sentStatuses');
eq(qfx.stoppable, BP.STOPPABLE, 'queue fixture: stoppable');
const QNOW = qfx.now;
const ids = (builds) => builds.map((b) => b.id);
const byId = (builds, id) => builds.find((b) => b.id === id);
const stopKinds = (builds) => Object.fromEntries(builds.filter((b) => BP.isStopped(b)).map((b) => [b.id, BP.stopOf(b).kind]));
/** What a caller sees after an action: the answer plus where every build stands. */
const view = (r, builds) => ({
  ok: r.ok, why: r.why ?? '',
  statuses: Object.fromEntries(builds.map((b) => [b.id, b.status])),
  stops: stopKinds(builds),
  queued: ids(BP.queuedBuilds(builds)),
  ...('promoted' in r ? { promoted: r.promoted } : {}),
  ...('changes' in r ? { changes: r.changes } : {}),
  ...('kill' in r ? { kill: r.kill } : {}),
  invariant: BP.checkQueue(builds).ok,
});
/** One action on a list of builds: { r (the engine's answer), builds (the list after it) }. */
function act(builds, o) {
  const opts = { by: o.by, why: o.why, now: QNOW };
  const drop = (x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined));
  if (o.op === 'queue') { const r = BP.queue(builds, o.id, drop(opts)); return { r, builds: r.builds }; }
  if (o.op === 'promote') { const r = BP.promote(builds, drop(opts)); return { r, builds: r.builds }; }
  if (o.op === 'goLive') { const r = BP.goLive(builds, o.id, drop(opts)); return { r, builds: r.builds }; }
  if (o.op === 'hold' || o.op === 'cancel' || o.op === 'unqueue') { const r = BP[o.op](builds, o.id, drop(opts)); return { r, builds: r.builds }; }
  if (o.op === 'release') { const r = BP.release(builds, o.id, drop(opts)); return { r, builds: r.builds }; }
  if (o.op === 'settleQueue') { const { queued, ...r } = BP.settleQueue(builds, drop(opts)); return { r, builds: r.builds }; }
  // an automated writer stores { ...record, ...patch } (pipeline merged key by key) through the keepStop gate
  if (o.op === 'write') {
    const prev = byId(builds, o.id);
    const next = { ...prev, ...o.patch, ...(o.patch.pipeline ? { pipeline: { ...(prev.pipeline ?? {}), ...o.patch.pipeline } } : {}) };
    const k = BP.keepStop(prev, next, { by: o.by });
    return { r: { ok: true, why: k.why, kept: k.kept }, builds: builds.map((b) => (b.id === o.id ? k.build : b)), kept: k.kept };
  }
  throw new Error(`unknown op ${o.op}`);
}
/**
 * The contract, checked on every op of every case whatever the golden answer says. `stood` = id → stop kind standing
 * before the op; `sound` = the list satisfied checkQueue before it (a case may start from a broken store to show the repair).
 */
function contract(what, o, before, after, r, sound) {
  const q = BP.slotHolders(after);
  const repairs = o.op === 'settleQueue';
  // a raw write (a run's exit sending its build back to the Queue) may meet the build promoted behind it: the next
  // reconcile pass keeps one, which settled() asserts after every op
  if ((sound && o.op !== 'write') || repairs) {
    ok(BP.queuedBuilds(after).length <= BP.QUEUE_MAX, `${what}: at most ${BP.QUEUE_MAX} queued (${ids(BP.queuedBuilds(after)).join(', ')})`);
    ok(BP.checkQueue(after).ok, `${what}: the Queue is sound afterwards (${BP.checkQueue(after).why})`);
  } else if (o.op === 'write') ok(BP.isOwnerActor(o.by) || !BP.isStopped(byId(before, o.id)) || byId(after, o.id).status !== 'queued', `${what}: an automated write never queues a stopped build`);
  else ok(q.length <= Math.max(BP.slotHolders(before).length, BP.QUEUE_MAX), `${what}: never adds a queued build to a full Queue`);
  // promotion: only into a free Queue, only the head of the Pending line, never a stopped build
  if (r.promoted) {
    const was = byId(before, r.promoted); const now = byId(after, r.promoted);
    ok(now.status === 'queued', `${what}: the promoted build ${r.promoted} is queued`);
    ok(!BP.isStopped(now), `${what}: the promoted build carries no stop`);
    if (o.op === 'promote') {
      ok(BP.slotFree(before), `${what}: promotes only into a free Queue`);
      ok(BP.pendingOrder(before)[0]?.id === r.promoted, `${what}: promotes the head of the Pending line`);
      ok(was.status === 'pending' && !BP.isStopped(was), `${what}: promotes a Pending build nobody stopped`);
    }
  }
  if (o.op === 'promote' && !r.promoted) ok(!BP.slotFree(before) || !BP.pendingOrder(before).length, `${what}: no promotion only when the Queue is taken or nothing can move up`);
  // go-live: the queued build runs, its slot is handed to the next in line in the same call
  if (o.op === 'goLive' && r.ok) {
    ok(byId(before, o.id).status === 'queued' && byId(after, o.id).status === 'running', `${what}: queued → running`);
    const rest = BP.pendingOrder(before.map((b) => (b.id === o.id ? { ...b, status: 'running' } : b)));
    if (sound) eq(r.promoted, rest[0]?.id ?? '', `${what}: the next Pending build moves up on go-live`);
  }
  if (o.op === 'goLive' && !r.ok) eq(after, before, `${what}: a refused go-live changes nothing`);
  // a stop: the build rests in Pending under its mark and no longer holds the slot
  if (['hold', 'cancel', 'unqueue'].includes(o.op) && r.ok) {
    const b = byId(after, o.id);
    eq([b.status, BP.stopOf(b)?.kind], ['pending', o.op], `${what}: stopped in Pending`);
    ok(!BP.promotable(b).ok, `${what}: a stopped build cannot be promoted`);
    if (o.op === 'cancel') ok(!(b.steps ?? []).some((s) => s.claim) && !b.pipeline.session && !b.pipeline.slot, `${what}: cancel drops every claim, the session and the slot from the record`);
    if (o.op === 'cancel' && r.changes.length) { const p = byId(before, o.id).pipeline ?? {}; eq([r.kill.session, r.kill.slot], [p.session ?? '', p.slot ?? ''], `${what}: cancel hands back the session and slot to kill`); }
  }
  // stops stick: whatever stood before the op still stands unless an owner acted on that build
  for (const b of before) {
    const had = BP.stopOf(b); if (!had) continue;
    const nb = byId(after, b.id);
    const lifted = BP.isOwnerActor(o.by) && o.id === b.id && ['queue', 'release', 'write', 'hold', 'cancel', 'unqueue'].includes(o.op);
    if (lifted) continue;
    eq(BP.stopOf(nb)?.kind, had.kind, `${what}: ${b.id} keeps its ${had.kind} (${o.op} by ${o.by || 'automation'})`);
    ok(nb.status === 'pending' || nb.status === b.status, `${what}: stopped ${b.id} only rests in Pending (${b.status} → ${nb.status})`);
    ok(nb.status !== 'queued' || b.status === 'queued', `${what}: stopped ${b.id} never enters the Queue`);
    ok(r.promoted !== b.id, `${what}: stopped ${b.id} is never promoted`);
  }
  // only an owner lifts a stop
  if ((o.op === 'release' || o.op === 'queue') && BP.isStopped(byId(before, o.id)) && !BP.isOwnerActor(o.by)) { ok(!r.ok, `${what}: ${o.by || 'automation'} may not lift a stop`); eq(after, before, `${what}: the refusal changes nothing`); }
  if (r.ok === false) eq(after, before, `${what}: a refusal returns the list it was given`);
}
/** A reconcile pass twice over gives the pass once over (statuses, stops and the Queue): nothing drifts. */
function settled(what, builds) {
  const one = BP.settleQueue(builds, { now: QNOW }); const two = BP.settleQueue(one.builds, { now: QNOW });
  eq(two.changes, [], `${what}: a second reconcile pass changes nothing`);
  eq(view({ ok: true }, two.builds), view({ ok: true }, one.builds), `${what}: reconcile is idempotent`);
  ok(BP.checkQueue(one.builds).ok && BP.queuedBuilds(one.builds).length <= BP.QUEUE_MAX, `${what}: a reconcile pass leaves at most one queued`);
  eq(stopKinds(one.builds), stopKinds(builds), `${what}: a reconcile pass keeps every stop`);
  for (const b of builds) if (BP.isStopped(b)) ok(byId(one.builds, b.id).status === 'pending', `${what}: stopped ${b.id} is in Pending after a reconcile pass`);
}
const qops = {};
for (const c of qfx.cases) {
  const what = `queue: ${c.name}`;
  qops[c.op] = (qops[c.op] ?? 0) + 1;
  let got;
  if (c.op === 'sequence') {
    let builds = c.in.builds; got = [];
    c.in.ops.forEach((o, i) => {
      const before = builds; const sound = BP.checkQueue(before).ok;
      const a = act(builds, o); builds = a.builds;
      got.push({ ...view(a.r, builds), ...('kept' in a ? { kept: a.kept } : {}) });
      contract(`${what}: op ${i + 1} (${o.op}${o.id ? ` ${o.id}` : ''})`, o, before, builds, a.r, sound);
      // every automated write that touches a stopped build is put right, and a reconcile pass after any op keeps the stops
      if (o.op === 'write' && BP.isStopped(byId(before, o.id)) && !BP.isOwnerActor(o.by)) eq([byId(builds, o.id).status, BP.stopOf(byId(builds, o.id))?.kind], [byId(before, o.id).status, BP.stopOf(byId(before, o.id)).kind], `${what}: op ${i + 1}: the write by ${o.by} leaves the stop standing`);
      settled(`${what}: after op ${i + 1}`, builds);
    });
  } else if (c.op === 'keepStop') {
    const k = BP.keepStop(c.in.prev, c.in.next, { by: c.in.by });
    got = { kept: k.kept, why: k.why, status: k.build.status, stop: BP.stopOf(k.build)?.kind ?? '', build: k.build };
    const had = BP.stopOf(c.in.prev);
    if (had && !BP.isOwnerActor(c.in.by)) {
      eq([k.build.status, BP.stopOf(k.build)?.kind], [c.in.prev.status, had.kind], `${what}: the stop and the status stand`);
      eq(BP.keepStop(c.in.prev, k.build, { by: c.in.by }), { build: k.build, kept: false, why: '' }, `${what}: the corrected record passes the gate untouched`);
      settled(what, [k.build]);
    } else eq(k, { build: c.in.next, kept: false, why: '' }, `${what}: the write goes through as written`);
  } else if (c.op === 'checkQueue') got = BP.checkQueue(c.in.builds);
  else if (c.op === 'pendingOrder') {
    got = { order: ids(BP.pendingOrder(c.in.builds)), waits: Object.fromEntries(c.in.builds.filter((b) => b.status === 'pending' && !BP.promotable(b).ok).map((b) => [b.id, BP.promotable(b).why])) };
    eq(BP.promote(c.in.builds.map((b) => (b.status === 'queued' ? { ...b, status: 'running' } : b)), { now: QNOW }).promoted, got.order[0] ?? '', `${what}: promote takes the head of the line`);
  } else if (c.op === 'isOwnerActor') got = Object.fromEntries(c.in.actors.map((a) => [a, BP.isOwnerActor(a)]));
  else if (c.op === 'orchestrator') {
    got = { shown: ids(c.in.builds.filter(BP.showsInOrchestrator)), sent: ids(c.in.builds.filter(BP.isSent)) };
    ok(c.in.builds.filter(BP.showsInOrchestrator).every((b) => b.status !== 'pending'), `${what}: a Pending build is not in the orchestrator view`);
  } else {
    const o = { op: c.op, ...c.in }; const before = c.in.builds; const sound = BP.checkQueue(before).ok;
    const a = act(before, o);
    got = view(a.r, a.builds);
    contract(what, o, before, a.builds, a.r, sound);
    settled(what, a.builds);
  }
  if (WRITE) c.out = got; else eq(got, c.out, what);
}
// the fixture covers the whole contract: no op may quietly drop out of it
for (const op of ['queue', 'promote', 'goLive', 'hold', 'cancel', 'unqueue', 'release', 'keepStop', 'settleQueue', 'checkQueue', 'pendingOrder', 'isOwnerActor', 'orchestrator', 'sequence']) ok(qops[op] > 0, `queue fixture: has ${op} cases`);
for (const kind of BP.STOP_KINDS) ok(qfx.cases.some((c) => c.op === 'sequence' && c.in.ops.some((o) => o.op === kind) && c.in.ops.some((o) => o.op === 'settleQueue' || o.op === 'write')), `queue fixture: a sequence carries a ${kind} across a reconcile pass`);

// the three stops across reconcile and dispatcher passes, built here rather than read: every automated actor, every kind
{
  const step = (id) => ({ id, model: 'Fable' });
  const mk = (id, status, day, pipeline) => ({ id, status, createdAt: `2026-11-${day}T09:00:00.000Z`, steps: [step('s1'), step('s2')], ...(pipeline ? { pipeline } : {}) });
  const start = () => [mk('a', 'queued', 20, { queuedAt: QUEUED_AT, queuedBy: 'brett', lineAt: QUEUED_AT }), mk('b', 'pending', 21), mk('c', 'pending', 22), mk('d', 'pending', 23)];
  for (const kind of BP.STOP_KINDS) {
    const what = `stick: ${kind}`;
    const s = BP[kind](start(), 'a', { by: 'brett', now: QNOW });
    eq([s.ok, s.promoted, byId(s.builds, 'a').status, BP.stopOf(byId(s.builds, 'a'))?.kind], [true, 'b', 'pending', kind], `${what}: the queued build is stopped and the next moves up`);
    let builds = s.builds;
    for (const by of BP.AUTOMATION_ACTORS) {
      // each automated actor tries every way back: a status write, a stop wiped off the record, queue(), release(), a pass
      for (const status of ['queued', 'running', 'fixing', 'waiting', 'landing']) {
        const prev = byId(builds, 'a');
        const k = BP.keepStop(prev, { ...prev, status, pipeline: { ...prev.pipeline, stop: null, heldAt: '', queuedAt: QNOW, queuedBy: by, session: 'axf-a', slot: 'slot-9' } }, { by });
        eq([k.kept, k.build.status, BP.stopOf(k.build)?.kind, k.build.pipeline.session, k.build.pipeline.slot, k.build.pipeline.queuedAt], [true, 'pending', kind, '', '', ''], `${what}: ${by} writing ${status} is undone`);
        builds = builds.map((b) => (b.id === 'a' ? k.build : b));
      }
      eq([BP.queue(builds, 'a', { by, now: QNOW }).ok, BP.release(builds, 'a', { by, now: QNOW }).ok, BP.goLive(builds, 'a', { by, now: QNOW }).ok], [false, false, false], `${what}: ${by} may not queue, release or launch it`);
      builds = BP.settleQueue(builds, { by, now: QNOW }).builds;
      eq([byId(builds, 'a').status, BP.stopOf(byId(builds, 'a'))?.kind], ['pending', kind], `${what}: still standing after ${by}'s reconcile pass`);
    }
    // the line drains behind it, one queued at a time, and the stopped build never moves
    const order = [];
    for (let i = 0; i < 6; i++) {
      const q = BP.queuedOne(builds); if (!q) break;
      ok(BP.queuedBuilds(builds).length === 1, `${what}: one queued while the line drains`);
      order.push(q.id);
      builds = BP.settleQueue(BP.goLive(builds, q.id, { now: QNOW }).builds, { now: QNOW }).builds;
    }
    eq(order, ['b', 'c', 'd'], `${what}: the others run in line order`);
    eq([byId(builds, 'a').status, BP.stopOf(byId(builds, 'a'))?.kind, BP.queuedBuilds(builds).length], ['pending', kind, 0], `${what}: the Queue stays empty rather than take the stopped build`);
    // an owner brings it back: release puts a held build in line, queue lifts any stop
    const back = kind === 'hold' ? BP.release(builds, 'a', { by: 'brett', now: QNOW }) : BP.queue(builds, 'a', { by: 'console', now: QNOW });
    eq([back.ok, byId(back.builds, 'a').status, BP.isStopped(byId(back.builds, 'a'))], [true, 'queued', false], `${what}: Brett brings it back`);
  }
  // one queued, however many are sent: every queue() behind the first is refused, each go-live promotes exactly one
  let builds = start().map((b) => ({ ...b, status: 'pending', pipeline: undefined }));
  eq(['d', 'c', 'b', 'a'].map((id) => { const r = BP.queue(builds, id, { by: 'brett', now: QNOW }); builds = r.builds; return r.ok; }), [true, false, false, false], 'one queued: only the first queue() takes the slot');
  const ran = [];
  while (BP.queuedOne(builds)) { const id = BP.queuedOne(builds).id; ran.push(id); builds = BP.goLive(builds, id, { now: QNOW }).builds; ok(BP.queuedBuilds(builds).length <= 1, `one queued: after ${id} goes live`); }
  eq(ran, ['d', 'a', 'b', 'c'], 'one queued: the queued build first, then Pending oldest first');
}

if (WRITE) { writeFileSync(QFIXTURE, `${JSON.stringify(qfx, null, 2)}\n`); writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`); console.log(`build-pipeline: fixture written (${fixture.transition.length} transition + ${fixture.sessions.length} session + ${qfx.cases.length} queue cases)`); }
if (failed) { console.error(`build-pipeline: ${failed}/${n} checks failed`); process.exit(1); }
console.log(`build-pipeline: ${n}/${n} checks passed`);

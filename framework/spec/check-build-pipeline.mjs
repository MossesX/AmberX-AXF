#!/usr/bin/env node
/**
 * build-pipeline@1 checks: the exit transition and the slot hold. A session that ends cleanly with its phase done and
 * steps left keeps its slot and waits in phase-handoff ('phase-done'), ahead of every Queue build, and never counts as a
 * crash; a crash keeps the slot too until maxRuns crashes, then Pending with the slot released ('crash-limit'); Pending
 * otherwise only for a blocked upgrade, a session that needs Brett, or a stop mid-phase (the slot kept). The slot is
 * released only on merged / complete, failed, or a Brett action. pickNext() puts hand-off builds before the Queue and a
 * queued build never starts while one waits; free slots = max − holders. migrateSlots() gives the builds running when
 * the rule landed their hold. Golden cases live in fixtures/build-pipeline-exit.json: `transition` replays the pure
 * nextStatusOnExit(), `sessions` the dispatcher's endOutcome() on build records, `slots` slot operations in sequence,
 * `dispatch` pickNext(), `migration` migrateSlots(). Spec: BUILD-PIPELINE.md.
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
const pick = (r) => ({ status: r.status, outcome: r.outcome, reason: r.reason, crashes: r.crashes, keepQueue: r.keepQueue, slot: r.slot, state: r.state });
for (const c of fixture.transition) {
  const got = pick(BP.nextStatusOnExit(c.in, c.maxRuns ?? maxRuns));
  if (WRITE) c.out = got; else eq(got, c.out, `transition: ${c.name}`);
  ok(BP.EXIT_REASONS.includes(got.reason), `transition: ${c.name}: reason ${got.reason} is in EXIT_REASONS`);
  ok(got.keepQueue === (got.status === 'queued'), `transition: ${c.name}: keepQueue follows the Queue`);
  ok(['built', 'queued', 'pending'].includes(got.status), `transition: ${c.name}: never a status off the table`);
  // the slot hold: released only when the build failed (the crash limit); every other end keeps it
  eq(got.slot, got.outcome === 'failed' ? 'release' : 'keep', `transition: ${c.name}: the slot is released only on failed`);
  ok(BP.PIPELINE_STATES.includes(got.state), `transition: ${c.name}: state ${got.state} is in PIPELINE_STATES`);
  eq(got.state, got.status === 'queued' ? 'phase-handoff' : got.status === 'built' ? 'landing' : 'pending', `transition: ${c.name}: a queued end is a phase hand-off, a built one is landing`);
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
ok(/finished phase Schema with 2 steps left: keeps its slot \(phase hand-off, ahead of the Queue\), the next phase \(Opus\) starts by itself/.test(BP.outcomeLine(b, run)), `phase-done line: ${BP.outcomeLine(b, run)}`);
ok(/keeps its slot, retried ahead of the Queue \(run 2\)/.test(BP.outcomeLine(b, { ...run, exit: 1, reason: 'crash' })), 'crash line');
ok(/needs Brett's approval/.test(BP.outcomeLine(b, { ...run, outcome: 'returned', reason: 'upgrade-blocked' })), 'blocked upgrade line');
ok(/needs Brett: back in Pending/.test(BP.outcomeLine(b, { ...run, outcome: 'returned', reason: 'needs-brett' })), 'needs-brett line');
ok(/stopped on its own .* back in Pending for Brett/.test(BP.outcomeLine(b, { ...run, outcome: 'returned', reason: 'stopped' })), 'stopped line');
ok(/crash limit reached, failed: back in Pending for Brett/.test(BP.outcomeLine(b, { ...run, exit: 1, outcome: 'failed', reason: 'crash-limit' })), 'crash-limit line');

// ---------------- the dispatcher's endOutcome on build records
const fullStep = (s, i) => ({ id: s.id ?? `s${i + 1}`, uid: `u-${s.id ?? i}`, text: `${s.id ?? i} work`, model: s.model, estimate: '10 min', done: !!s.done, doneAt: s.done ? (s.doneAt ?? NOW) : '', skip: false, files: [], checks: [], session: 'same', agent: false, why: '', phase: s.phase ?? '', group: '', note: '' });
// records as the store holds them: every pipeline field in shape (normPipeline), as setPipeline() writes it; every one
// holds its slot from its first launch (a case may give `slot` itself: a string = a record from before the rule)
const HELD_SINCE = '2026-11-08T00:30:00.000Z';
const heldSlot = (id = 'x', account = 'w-max', model = 'Fable') => ({ holder: id, account, model, since: HELD_SINCE, entry: 'hl-x', released: null });
const fullBuild = (c) => ({ id: 'x', title: 'x', createdAt: NOW, updatedAt: NOW, notes: [], approvals: [], upgradeRequests: [], deleted: false, hidden: false, ...c.build, steps: c.build.steps.map(fullStep), pipeline: BP.normPipeline({ queuedAt: QUEUED_AT, slot: heldSlot(), ...(c.build.pipeline ?? {}) }) });
for (const c of fixture.sessions) {
  setUpgradePolicy({ approvalRequired: c.policy === 'on', source: 'check-build-pipeline' });
  const r = P.endOutcome(fullBuild(c), { exit: c.exit, now: NOW, needsBrett: !!c.needsBrett }, P.normSettings({ maxRuns }));
  const got = { status: r.status, outcome: r.outcome, reason: r.reason, crashes: r.crashes, keepQueue: r.keepQueue, phase: r.run.phase, queuedAtKept: !('queuedAt' in r.patch), slot: r.slot, state: r.state, held: !!r.patch.slot.holder, released: r.patch.slot.released?.why ?? '' };
  if (WRITE) c.out = got; else eq(got, c.out, `session: ${c.name}`);
  eq([r.run.reason, r.run.outcome, r.patch.crashes, r.patch.session, r.patch.slot.entry], [r.reason, r.outcome, r.crashes, '', ''], `session: ${c.name}: lastRun and the patch agree (the live slot entry cleared)`);
  ok(r.note.length > 10 && (r.outcome === 'finished' ? r.patch.note === '' : r.patch.note === r.note), `session: ${c.name}: note on the record unless finished`);
  // the slot hold through the dispatcher's end: kept on phase-done, crash, built and every stop; released on complete (merged) and the crash limit (failed)
  const legacy = typeof c.build.pipeline?.slot === 'string';
  if (!legacy) {
    eq(got.held, r.status !== 'complete' && r.outcome !== 'failed', `session: ${c.name}: the hold stays unless merged or failed`);
    eq(got.released, r.status === 'complete' ? 'merged' : r.outcome === 'failed' ? 'failed' : '', `session: ${c.name}: the release reason`);
    if (got.held) eq(r.patch.slot.since, HELD_SINCE, `session: ${c.name}: since is kept across the hand-off`);
  } else eq([got.held, r.patch.slot.entry], [false, ''], `session: ${c.name}: a string slot holds nothing and its entry is cleared`);
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

// ---------------- the slot hold: record shape
const T0 = fixture.now ?? '2026-11-17T03:00:00.000Z';
eq(BP.emptyPipeline().slot, BP.emptySlot(), 'emptyPipeline holds no slot');
eq(BP.normPipeline({ slot: 'hl-7' }).slot, { ...BP.emptySlot(), entry: 'hl-7' }, 'a string slot (older record) reads as the live entry, no hold');
eq(BP.normPipeline({ slot: { holder: 'b', account: 'w-max', model: 'Opus', since: T0, entry: 'hl-1', released: null } }).slot, { holder: 'b', account: 'w-max', model: 'Opus', since: T0, entry: 'hl-1', released: null }, 'a held slot keeps every field');
eq(BP.normSlot({ holder: '', account: 'w-max', model: 'Opus', since: T0, entry: '' }), BP.emptySlot(), 'no holder: account, model and since fall away');
eq(BP.normPipeline({ slot: { holder: 'b', released: { at: T0, by: 'x', why: 'nope' } } }).slot.released.why, 'cancelled', 'an unknown release reason reads as cancelled');
eq(BP.normSlot({ released: { at: 'not a date', by: 'x', why: 'merged' } }).released, null, 'a release without a date is none');
eq(BP.normPipeline({ slot: {} }), null, 'an empty slot leaves the record empty');
eq(BP.slotEntry({ slot: 'hl-3' }), 'hl-3', 'slotEntry reads the legacy string');
eq(BP.slotEntry({ slot: BP.takeSlot(null, { id: 'b', entry: 'hl-4', at: T0 }) }), 'hl-4', 'slotEntry reads the hold');
eq(BP.holdsSlot({ pipeline: { slot: 'hl-3' } }), false, 'a legacy string holds nothing');
eq(BP.holdsSlot({ pipeline: { slot: BP.takeSlot(null, { id: 'b', at: T0 }) } }), true, 'a taken slot is held');
eq(BP.holdsSlot({ deleted: true, pipeline: { slot: BP.takeSlot(null, { id: 'b', at: T0 }) } }), false, 'a deleted build holds nothing');
eq(BP.takeSlot(null, {}), BP.emptySlot(), 'takeSlot without a build id takes nothing');
eq(BP.SLOT_RELEASES, ['merged', 'failed', 'cancelled'], 'the three releases');
eq(BP.PIPELINE_STATES, ['pending', 'queued', 'phase-handoff', 'building', 'landing'], 'the pipeline states');
eq(Object.keys(BP.STATE_LABEL), BP.PIPELINE_STATES, 'every state has a label');

// ---------------- the slot hold: operations in sequence
for (const c of fixture.slots) {
  let slot = c.start; const got = [];
  for (const op of c.ops) {
    if (op.op === 'take') slot = BP.takeSlot(slot, op);
    else if (op.op === 'handoff') slot = BP.handoffSlot(slot);
    else if (op.op === 'release') slot = BP.releaseSlot(slot, op);
    else if (op.op === 'exit') { const r = BP.nextStatusOnExit(op, maxRuns); slot = BP.slotAfterExit(slot, r, { status: op.status ?? r.status, at: op.at }); }
    else throw new Error(`slots: ${c.name}: unknown op ${op.op}`);
    eq(slot, BP.normSlot(slot), `slots: ${c.name}: ${op.op} leaves the slot in shape`);
    got.push(slot);
  }
  if (WRITE) c.out = got; else eq(got, c.out, `slots: ${c.name}`);
}
// the rules, spelled out
{
  const first = BP.takeSlot(null, { id: 'b', account: 'hulu0241', model: 'Fable', entry: 'hl-1', at: T0 });
  eq([first.holder, first.since, first.entry], ['b', T0, 'hl-1'], 'the first launch starts the hold');
  const phaseEnd = BP.slotAfterExit(first, BP.nextStatusOnExit({ exit: 0, stepsLeft: 2, crashes: 0, phaseDone: true }), { at: '2026-11-17T04:00:00.000Z' });
  eq([phaseEnd.holder, phaseEnd.since, phaseEnd.entry, phaseEnd.released], ['b', T0, '', null], 'a phase end keeps the slot (hand-off: the live entry cleared, since kept)');
  const again = BP.takeSlot(phaseEnd, { id: 'b', account: 'w-pro', model: 'Opus', entry: 'hl-2', at: '2026-11-17T04:01:00.000Z' });
  eq([again.since, again.account, again.model, again.entry], [T0, 'w-pro', 'Opus', 'hl-2'], 'the next phase runs in the same hold: since kept, account and model follow the run');
  const crash = BP.slotAfterExit(again, BP.nextStatusOnExit({ exit: 1, stepsLeft: 2, crashes: 0 }), { at: '2026-11-17T04:30:00.000Z' });
  eq([crash.holder, crash.since, crash.entry], ['b', T0, ''], 'a crash under the limit keeps the slot: the retry runs in it');
  const limit = BP.slotAfterExit(again, BP.nextStatusOnExit({ exit: 1, stepsLeft: 2, crashes: 2 }), { at: '2026-11-17T04:40:00.000Z' });
  eq([limit.holder, limit.released?.why], ['', 'failed'], 'the crash limit releases the slot as failed');
  const built = BP.slotAfterExit(again, BP.nextStatusOnExit({ exit: 0, stepsLeft: 0 }), { status: 'built', at: '2026-11-17T05:00:00.000Z' });
  eq([built.holder, built.entry], ['b', ''], 'every step done with the PR open: the slot stays until the merge (landing)');
  const merged = BP.slotAfterExit(built, BP.nextStatusOnExit({ exit: 0, stepsLeft: 0 }), { status: 'complete', by: 'lander', at: '2026-11-17T05:30:00.000Z' });
  eq([merged.holder, merged.released], ['', { at: '2026-11-17T05:30:00.000Z', by: 'lander', why: 'merged' }], 'the merge releases the slot');
  const stop = BP.slotAfterExit(again, BP.nextStatusOnExit({ exit: 0, stepsLeft: 1, needsBrett: true }), { at: '2026-11-17T04:50:00.000Z' });
  eq(stop.holder, 'b', 'a stop for Brett keeps the slot');
  eq(BP.releaseSlot(stop, { by: 'brett', why: 'cancelled', at: T0 }).released, { at: T0, by: 'brett', why: 'cancelled' }, 'Brett cancels: released as cancelled');
  eq(BP.releaseSlot('hl-old', { at: T0 }), BP.emptySlot(), 'releasing a legacy string slot: nothing held, the entry cleared, no release recorded');
  eq(BP.releaseOnStatus('complete'), 'merged', 'complete releases as merged');
  eq(BP.releaseOnStatus('failed'), 'failed', 'failed releases as failed');
  eq([BP.releaseOnStatus('built'), BP.releaseOnStatus('queued'), BP.releaseOnStatus('pending')], ['', '', ''], 'built, queued and pending keep the hold');
  eq(BP.RELEASING_ACTIONS, ['unqueue', 'hold', 'archive', 'delete', 'release-slot'], 'the Brett actions that release');
  eq(['unqueue', 'hold', 'archive', 'delete', 'release-slot', 'release', 'unarchive', 'restore'].map(BP.actionReleasesSlot), [true, true, true, true, true, false, false, false], 'actionReleasesSlot');
}

// ---------------- the slot hold: states, tables, tabs, actions
{
  const stepsOpen = [{ id: 's1', done: false, skip: false, model: 'Opus' }];
  const hb = (status, slot = heldSlot('h')) => ({ id: 'h', status, createdAt: NOW, steps: stepsOpen, pipeline: BP.normPipeline({ queuedAt: QUEUED_AT, slot }) });
  eq(BP.stateOf(hb('queued')), 'phase-handoff', 'queued + held = phase-handoff');
  eq(BP.stateOf(hb('queued', 'hl-old')), 'queued', 'queued + legacy string = queued');
  eq(BP.stateOf(hb('queued', null)), 'queued', 'queued + no hold = queued');
  eq(BP.stateOf(hb('running')), 'building', 'running = building');
  eq(BP.stateOf(hb('waiting', null)), 'building', 'waiting = building');
  eq(BP.stateOf(hb('built')), 'landing', 'built + held = landing');
  eq(BP.stateOf(hb('built', null)), '', 'built without a hold is off the table');
  eq(BP.stateOf(hb('pending')), 'pending', 'pending + held = pending (the hold shows as a flag)');
  eq([BP.stateOf(hb('complete')), BP.stateOf(hb('failed')), BP.stateOf({ ...hb('queued'), deleted: true })], ['', '', ''], 'complete, failed and deleted have no state');
  eq(BP.isHandoff(hb('queued')), true, 'isHandoff');
  eq(BP.tableOf(hb('queued')), 'building', 'a hand-off build shows in the Building table: it is one of the running builds');
  eq(BP.tableOf(hb('queued', null)), 'queued', 'a plain queued build shows in the Queue table');
  eq(BP.tabOf(hb('queued')), 'active', 'a hand-off build is in the Active tab');
  eq(BP.tabOf(hb('queued', null)), 'queue', 'a plain queued build is in the Queue tab');
  ok(BP.actionsFor(hb('queued')).includes('release-slot'), 'Brett may take the slot back from a hand-off build');
  ok(BP.actionsFor(hb('built')).includes('release-slot'), 'and from a landing build');
  ok(BP.actionsFor(hb('pending')).includes('release-slot'), 'and from a Pending build that kept its hold');
  ok(!BP.actionsFor(hb('running')).includes('release-slot'), 'never from a live session');
  ok(!BP.actionsFor(hb('queued', null)).includes('release-slot'), 'nothing to release on a plain queued build');
  eq(BP.canReleaseSlot({ ...hb('queued'), deleted: true }), false, 'not on a deleted build');
  ok(BP.BUILD_ACTIONS.includes('release-slot'), 'release-slot is a build action');
  // a hand-off build is still queued for the store: canUnqueue / canHold stay as they were, and both release the slot (RELEASING_ACTIONS)
  eq([BP.canUnqueue(hb('queued')), BP.canHold(hb('queued'))], [true, true], 'the Queue actions still apply to a hand-off build');
}

// ---------------- dispatch order: hand-off builds before the Queue, free = max − holders
const dBuild = (d) => ({ id: d.id, status: d.status, createdAt: NOW, deleted: !!d.deleted, steps: Array.from({ length: d.steps }, (_, i) => ({ id: `s${i + 1}`, done: false, skip: false, model: 'Opus' })),
  pipeline: BP.normPipeline({ queuedAt: d.queuedAt, slot: d.since ? { holder: d.id, account: 'w-pro', model: 'Opus', since: d.since, entry: d.status === 'running' || d.status === 'waiting' ? `hl-${d.id}` : '', released: null } : '', ...(d.held ? { heldAt: NOW, heldBy: 'brett' } : {}) }) });
for (const c of fixture.dispatch) {
  const builds = c.builds.map(dBuild);
  const r = BP.pickNext(builds, { max: c.max });
  const got = { order: r.order, handoff: r.handoff, holders: r.holders, free: r.free, waits: r.waits.map((w) => ({ id: w.id, why: w.why })) };
  if (WRITE) c.out = got; else eq(got, c.out, `dispatch: ${c.name}`);
  eq(r.free, Math.max(0, c.max - r.holders.length), `dispatch: ${c.name}: free = max − holders`);
  ok(r.handoff.every((id, i) => r.order[i] === id), `dispatch: ${c.name}: every hand-off build comes first, in order`);
  const queuedPart = r.order.slice(r.handoff.length);
  ok(!r.handoff.length || !queuedPart.length, `dispatch: ${c.name}: no queued build starts while a hand-off waits`);
  ok(queuedPart.length <= r.free, `dispatch: ${c.name}: the Queue part never exceeds the free slots`);
  ok(queuedPart.every((id) => !r.holders.includes(id)), `dispatch: ${c.name}: a queued pick holds no slot`);
  ok(r.holders.every((id) => !['complete', 'failed', 'archived'].includes(builds.find((b) => b.id === id).status)), `dispatch: ${c.name}: a finished build is no holder`);
  const seen = new Set([...r.order, ...r.waits.map((w) => w.id)]);
  ok(builds.filter((b) => b.status === 'queued' && !b.deleted).every((b) => seen.has(b.id)), `dispatch: ${c.name}: every queued build is either picked or told why it waits`);
}
{
  const builds = fixture.dispatch[0].builds.map(dBuild);
  eq(BP.handoffs(builds).map((b) => b.id), ['hand-early', 'hand-late'], 'handoffs: oldest hold first');
  eq(BP.holders(builds).map((b) => b.id).sort(), ['hand-early', 'hand-late', 'run-1'], 'holders: running and hand-off builds');
  eq(BP.freeSlots(builds, 8), 5, 'freeSlots: 8 − 3 holders');
  eq(BP.freeSlots(builds, 2), 0, 'freeSlots never below 0');
  eq(BP.freeSlots(builds, 'x'), 0, 'a bad cap frees nothing');
  eq(BP.pickNext(null).order, [], 'pickNext on nothing');
  eq(BP.pickNext([], { max: 4 }).free, 4, 'pickNext with no builds: every slot free');
  ok(/running builds finish first/.test(BP.pickNext(builds, { max: 8 }).waits.find((w) => w.id === 'q-first').why), 'the queued build is told the running builds finish first');
}

// ---------------- the migration: every running build holds its slot
for (const c of fixture.migration) {
  const builds = c.builds.map((d) => ({ id: d.id, status: d.status, deleted: !!d.deleted, createdAt: NOW, steps: Array.from({ length: d.steps }, (_, i) => ({ id: `s${i + 1}`, done: false, skip: false, model: 'Opus' })), pipeline: BP.normPipeline({ queuedAt: QUEUED_AT, ...d.pipeline }) }));
  const got = BP.migrateSlots(builds, T0);
  if (WRITE) c.out = got; else eq(got, c.out, `migration: ${c.name}`);
  for (const m of got) {
    const b = builds.find((x) => x.id === m.id);
    eq(m.slot.holder, m.id, `migration: ${m.id} holds its own slot`);
    ok(!['pending', 'built', 'complete', 'failed', 'archived'].includes(b.status) && !b.deleted, `migration: ${m.id}: only running, waiting and requeued builds`);
    eq(m.slot, BP.normSlot(m.slot), `migration: ${m.id}: the slot is in shape`);
    ok(m.slot.since <= T0, `migration: ${m.id}: since is the launch (or the last run), never after now`);
  }
  const after = builds.map((b) => { const m = got.find((x) => x.id === b.id); return m ? { ...b, pipeline: { ...b.pipeline, slot: m.slot } } : b; });
  eq(BP.migrateSlots(after, T0), [], `migration: ${c.name}: idempotent`);
  const stillRunning = builds.filter((b) => (b.status === 'running' || b.status === 'waiting') && !b.deleted && !BP.holdsSlot(b)).map((b) => b.id);
  eq(got.map((m) => m.id).filter((id) => stillRunning.includes(id)), stillRunning, `migration: ${c.name}: every running build without a hold gets one`);
  // the migrated builds go first on the next tick: every hand-off before the fresh Queue
  const next = BP.pickNext(after, { max: 8 });
  ok(next.handoff.length > 0 && next.order.slice(0, next.handoff.length).every((id) => next.handoff.includes(id)) && !next.order.includes('fresh-e'), `migration: ${c.name}: the requeued builds hand off ahead of the fresh Queue build`);
}
eq(BP.migrateSlots(null), [], 'migration on nothing');

if (WRITE) { writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`); console.log(`build-pipeline: fixture written (${fixture.transition.length} transition + ${fixture.sessions.length} session + ${fixture.slots.length} slot + ${fixture.dispatch.length} dispatch + ${fixture.migration.length} migration cases)`); }
if (failed) { console.error(`build-pipeline: ${failed}/${n} checks failed`); process.exit(1); }
console.log(`build-pipeline: ${n}/${n} checks passed`);

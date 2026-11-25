#!/usr/bin/env node
/**
 * build-pipeline@1 checks: the exit transition. A session that ends cleanly with its phase done and steps left goes
 * back to the Queue ('phase-done'), keeps its place and never counts as a crash; a crash requeues until maxRuns
 * crashes, then Pending ('crash-limit'); Pending otherwise only for a blocked upgrade, a session that needs Brett, or
 * a stop mid-phase. Golden cases live in fixtures/build-pipeline-exit.json: `transition` replays the pure
 * nextStatusOnExit(), `sessions` replays the dispatcher's endOutcome() on build records.
 * Single Queued (Nov 25 2026): fixtures/build-pipeline.json replays queue / promote / stop / reconcile scenarios and
 * asserts on every op: at most one queued build, promotion only into a free Queue, hold / cancel / unqueue kept by
 * every automatic writer across a reconcile pass.
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

// ---------------- single Queued (Nov 25 2026): one queued max, promotion on go-live, hold / cancel / unqueue stick
const QFIXTURE = join(HERE, 'fixtures/build-pipeline.json');
const qfx = JSON.parse(readFileSync(QFIXTURE, 'utf8'));
eq(qfx.$axf, 'build-pipeline-queue@1', 'queue fixture schema');
const prio = (b) => b.priority || 'P2';
const line = (builds) => builds.map((b) => `${b.id}:${b.status}${BP.stopOf(b) ? `:${BP.stopOf(b).kind}` : ''}`).join(' ');
const queuedCount = (builds) => builds.filter((b) => b.status === 'queued' && !b.deleted).length;
/** One op of a scenario on its builds: { builds, res } (the engine's answer, trimmed to what a caller acts on). */
function replay(builds, o) {
  const one = (id) => builds.find((b) => b.id === id);
  const put = (nb) => builds.map((b) => (b.id === nb.id ? nb : b));
  if (o.op === 'queue') { const r = BP.queueOne(builds, o.id, { at: o.at, by: o.by, priorityOf: prio }); return { builds: r.builds, res: { ok: r.ok, why: r.why } }; }
  if (o.op === 'promote') { const r = BP.promote(builds, { at: o.at, by: o.by, priorityOf: prio }); return { builds: r.builds, res: { promoted: r.promoted, why: r.why } }; }
  if (o.op === 'settle') { const r = BP.settleQueue(builds, { at: o.at, by: o.by, priorityOf: prio }); return { builds: r.builds, res: { kept: r.kept, demoted: r.demoted } }; }
  // the dispatcher launched it: the status a launch writes (guardStop decides whether it may)
  if (o.op === 'live') { const nb = { ...one(o.id), status: 'running' }; const g = BP.guardStop(one(o.id), nb, 'dispatcher'); return { builds: g.ok ? put(nb) : builds, res: { ok: g.ok, why: g.why } }; }
  if (o.op === 'stop') { const r = BP.stopBuild(one(o.id), o.kind, { at: o.at, by: o.by, why: o.why }); return { builds: r.ok ? put(r.build) : builds, res: { ok: r.ok, why: r.why, kill: r.kill, ...(r.already ? { already: true } : {}) } }; }
  if (o.op === 'release') { const r = BP.releaseStop(one(o.id), { by: o.by }); return { builds: r.ok ? put(r.build) : builds, res: { ok: r.ok, why: r.why } }; }
  // the session ended: the exit transition proposed `status`; a stopped build rests in Pending instead
  if (o.op === 'exit') { const status = BP.stoppedExit(one(o.id), o.status); return { builds: put({ ...one(o.id), status }), res: { status } }; }
  if (o.op === 'guard') { const g = BP.guardStop(one(o.id), { ...one(o.id), status: o.status }, o.by); return { builds, res: { ok: g.ok, why: g.why } }; }
  if (o.op === 'reconcile') {
    const after = builds.map((b) => { let nb = { ...b, ...(o.set?.[b.id] ?? {}) }; if ((o.clearStop ?? []).includes(b.id)) { const { stop, ...pl } = nb.pipeline ?? {}; nb = { ...nb, pipeline: { ...pl, heldAt: '' } }; } return nb; });
    const r = BP.keepStops(builds, after, { by: o.by, at: o.at, priorityOf: prio });
    return { builds: r.builds, res: { kept: r.kept } };
  }
  throw new Error(`unknown op ${o.op}`);
}
let qops = 0;
for (const sc of qfx.scenarios) {
  let builds = sc.builds.map((b) => ({ deleted: false, hidden: false, ...b, pipeline: BP.normPipeline(b.pipeline) }));
  const stops = new Map(); // id → kind, while Brett's stop stands
  const got = [];
  sc.ops.forEach((o, i) => {
    const before = builds;
    const r = replay(builds, o); builds = r.builds; qops++;
    got.push({ ...r.res, after: line(builds) });
    const what = `queue: ${sc.name}: op ${i + 1} (${o.op}${o.id ? ` ${o.id}` : ''})`;
    // the contract, on every op of every scenario (not only the golden lines)
    ok(queuedCount(builds) <= BP.QUEUE_MAX || (sc.breach && o.op !== 'settle' && queuedCount(builds) <= queuedCount(before)), `${what}: at most ${BP.QUEUE_MAX} queued (${line(builds)})`);
    if (o.op === 'promote' && r.res.promoted) ok(queuedCount(before) === 0 && builds.find((b) => b.id === r.res.promoted).status === 'queued', `${what}: promotes only into a free Queue`);
    if (o.op === 'promote' && r.res.promoted) ok(!BP.isStopped(before.find((b) => b.id === r.res.promoted)), `${what}: never promotes a stopped build`);
    for (const b of builds) {
      const s = BP.stopOf(b); const had = stops.get(b.id);
      if (had && !BP.speaksForBrett(o.by ?? 'dispatcher')) {
        ok(s?.kind === had, `${what}: ${b.id} keeps its ${had} (automatic writer ${o.by ?? 'dispatcher'})`);
        const was = before.find((x) => x.id === b.id).status;
        ok(b.status === was || BP.STOPPED_MAY_BE.includes(b.status), `${what}: stopped ${b.id} only rests (${was} → ${b.status})`);
      }
      if (s) stops.set(b.id, s.kind); else stops.delete(b.id);
    }
  });
  if (WRITE) sc.out = got; else eq(got, sc.out, `queue: ${sc.name}`);
}
// the record keeps a stop, and nothing else new: an unstopped record is byte for byte what it was
const stopRec = { kind: 'cancel', at: NOW, by: 'console', why: 'x', from: 'running' };
eq(BP.normPipeline({ queuedAt: QUEUED_AT, stop: stopRec }).stop, stopRec, 'normPipeline keeps pipeline.stop');
ok(!('stop' in BP.normPipeline({ queuedAt: QUEUED_AT })), 'no stop key on a build that has none');
eq(BP.normPipeline({ stop: { kind: 'nope', at: NOW } }), null, 'an unknown stop kind is no stop');
eq(BP.normStop({ kind: 'hold', at: 'not a date' }), null, 'a stop without a time is no stop');
eq(BP.stopOf({ status: 'queued', pipeline: { heldAt: NOW, heldBy: 'console', heldWhy: 'w' } }), { kind: 'hold', at: NOW, by: 'console', why: 'w', from: 'queued' }, 'a hold from before the contract reads as a stop');
eq(['brett', 'console', 'rest', 'mcp', 'cli', 'voice', 'amberx', 'phone', 'console:brett'].map(BP.speaksForBrett), Array(9).fill(true), "Brett's surfaces speak for him");
eq(['dispatcher', 'pipeline', 'watchdog', 'reconciler', 'lander', 'auto', 'orchestrator', 'reaper', 'someone-new', '', undefined, 'clients'].map(BP.speaksForBrett), Array(12).fill(false), 'every other writer is automatic, also an unknown one');
eq(BP.stopBuild({ id: 'x', status: 'complete' }, 'cancel', { at: NOW, by: 'console' }).ok, false, 'a finished build is not cancelled');
eq(BP.stopBuild({ id: 'x', status: 'running' }, 'pause', { at: NOW, by: 'console' }).ok, false, 'an unknown stop is refused');
eq(BP.stopsFor({ id: 'x', status: 'queued' }), ['unqueue', 'hold'], 'a queued build: unqueue or hold');
eq(BP.stopsFor({ id: 'x', status: 'running' }), ['hold', 'cancel'], 'a live build: hold or cancel');
eq(BP.stoppedExit({ status: 'running' }, 'queued'), 'queued', 'an unstopped build follows its exit transition');
{ const done = { id: 'x', status: 'pending', steps: [{ id: 's1', done: true }], pipeline: { stop: { ...stopRec, kind: 'hold' } } };
  eq(BP.releaseStop(done, { by: 'console' }).build.status, 'landing', 'a held build that finished its steps lands once released');
  eq(BP.releaseStop({ ...done, pipeline: { stop: stopRec } }, { by: 'console' }).build.status, 'pending', 'a cancelled one stays in Pending');
  const q = BP.queueOne([{ id: 'x', status: 'pending', deleted: false, hidden: false, steps: [{ id: 's1', done: false }], pipeline: { stop: { ...stopRec, kind: 'unqueue' } } }], 'x', { at: NOW, by: 'console' });
  eq([q.ok, q.builds[0].status, BP.isStopped(q.builds[0])], [true, 'queued', false], 'Brett queueing a stopped build lifts its stop'); }

if (WRITE) { writeFileSync(QFIXTURE, `${JSON.stringify(qfx, null, 2)}\n`); writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`); console.log(`build-pipeline: fixture written (${fixture.transition.length} transition + ${fixture.sessions.length} session cases)`); }
if (failed) { console.error(`build-pipeline: ${failed}/${n} checks failed`); process.exit(1); }
console.log(`build-pipeline: ${n}/${n} checks passed`);

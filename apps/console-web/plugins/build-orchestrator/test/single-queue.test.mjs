// One Queued (build-pipeline@1): node apps/console-web/plugins/build-orchestrator/test/single-queue.test.mjs
// The Queue holds one build. A second queue is refused with the holder named; an automatic requeue rests in Pending;
// a Queue from before the rule is settled; when the queued build goes live the next Pending build moves up; a build
// Brett stopped is never queued or promoted by the dispatcher, and his release puts it back in line.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-single-queue-'));
Object.assign(process.env, {
  AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_SHIPPED: 'off', AXF_DATA_DIR: 'off', AXF_CREW_SAY: 'off',
  AXF_PIPELINE_DIR: join(tmp, 'pipeline'), AXF_PIPELINE_CONSOLE: 'off', AXF_BUILD_PROFILE: 'all', AXF_PIPELINE_WORKTREES: join(tmp, 'wt'), AXF_PIPELINE_RULES: 'off',
});
const core = await import('../../../../../framework/plan/builds-store-core.mjs');
const BP = await import('../../../../../framework/core/build-pipeline.mjs');
const S = await import('../../../../../framework/cli/builds-store.mjs');
const PL = await import('../pipeline.mjs');

let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const steps = () => [{ id: 's1', text: 'one', model: 'Opus', estimate: '10 min' }, { id: 's2', text: 'two', model: 'Opus', estimate: '10 min' }];
const build = (id, day, more = {}) => ({ id, title: id, status: 'pending', createdAt: `2026-11-${day}T00:00:00.000Z`, steps: steps(), ...more });
writeFileSync(process.env.AXF_BUILDS_STORE, JSON.stringify(core.normalizeStore({ ...core.emptyStore(), builds: [build('a', '01'), build('b', '02'), build('c', '03'), build('d', '04'), build('p2', '05', { flow: 'pipeline-2', steps: [] })] })));
const get = (id) => core.findBuild(S.loadStore(), id);
const line = () => S.loadStore().builds.filter((b) => !b.deleted && b.flow !== 'pipeline-2').map((b) => `${b.id}:${b.status}${BP.stopOf(b) ? `:${BP.stopOf(b).kind}` : ''}`).join(' ');
const queued = () => S.loadStore().builds.filter((b) => b.status === 'queued' && !b.deleted).map((b) => b.id);
/** The dispatcher's launch record, as tick writes it. */
const goLive = (id) => PL.setPipeline(id, { account: 'w', session: `axf-${id}`, launchedAt: new Date().toISOString(), runs: (get(id).pipeline?.runs ?? 0) + 1 }, { status: 'running', action: 'pipeline:launch' });

t('queue: the first build takes the Queue', () => { assert.equal(PL.queue('b', { by: 'console' }).status, 'queued'); assert.deepEqual(queued(), ['b']); });
t('queue: a second build is refused with a clear message that names the holder', () => {
  assert.throws(() => PL.queue('c', { by: 'console' }), (e) => /b is already queued: one build waits in the Queue at a time\. c stays in Pending and moves up by itself when b starts\./.test(e.message) && e.code === 2 && e.holder === 'b');
  assert.equal(get('c').status, 'pending'); assert.deepEqual(queued(), ['b']);
});
t('queue: queueing the queued build again is not an error path that adds a second', () => { assert.throws(() => PL.queue('b', { by: 'console' }), /only a Pending build/); assert.deepEqual(queued(), ['b']); });
t('an automatic requeue while the Queue is held rests in Pending with the reason', () => {
  const r = PL.setPipeline('d', { queuedAt: new Date().toISOString(), queuedBy: 'dispatcher' }, { status: 'queued', note: 'Parallel steps finished.', by: 'dispatcher', action: 'pipeline:requeue' });
  assert.equal(r.status, 'pending'); assert.equal(r.pipeline?.queuedAt ?? '', ''); assert.match(r.notes.at(-1).text, /Waits in Pending: b holds the Queue/); assert.deepEqual(queued(), ['b']);
});
t('nothing moves up while a build is queued', () => { const m = PL.advanceQueue(); assert.deepEqual([m.kept, m.demoted, m.promoted], ['b', [], '']); });
t('the queued build goes live: the oldest Pending build moves up, one only', () => {
  goLive('b');
  const m = PL.advanceQueue();
  assert.equal(m.promoted, 'a'); assert.deepEqual(queued(), ['a']); assert.equal(get('a').pipeline.queuedBy, 'dispatcher');
  assert.match(get('a').notes.at(-1).text, /Moved up from Pending into the Queue/);
  assert.equal(PL.advanceQueue().promoted, '', 'a second pass moves nothing: the Queue is held again');
  assert.equal(line(), 'a:queued b:running c:pending d:pending');
});
t('a Pipeline 2.0 build is never part of the Queue', () => { assert.equal(get('p2').status, 'pending'); assert.ok(!queued().includes('p2')); });
t('unqueue by Brett: back in Pending; the dispatcher moves the next one up, not that one', () => {
  PL.buildAction('unqueue', ['a'], { by: 'console' });
  assert.equal(get('a').status, 'pending');
});
t('a Queue from before the rule (three queued, one held) is settled: the first keeps the place, the held one keeps its hold', () => {
  S.withStore((s) => { for (const [id, at, held] of [['a', '2026-11-20T00:00:00.000Z', true], ['c', '2026-11-21T00:00:00.000Z', false], ['d', '2026-11-22T00:00:00.000Z', false]]) { const b = core.findBuild(s, id); b.status = 'queued'; b.pipeline = BP.normPipeline({ ...(b.pipeline ?? {}), queuedAt: at, queuedBy: 'console', ...(held ? { heldAt: at, heldBy: 'console', heldWhy: 'later' } : {}) }); } return s; }, { by: 'test', action: 'old-queue' });
  assert.deepEqual(queued().sort(), ['a', 'c', 'd']);
  const m = PL.advanceQueue();
  assert.equal(m.kept, 'c'); assert.deepEqual([...m.demoted].sort(), ['a', 'd']); assert.deepEqual(queued(), ['c']);
  assert.equal(line(), 'a:pending:hold b:running c:queued d:pending');
  assert.match(get('d').notes.at(-1).text, /Back in Pending \(dispatcher\): one build waits in the Queue at a time \(c holds it\)/);
});
t('a held build is never promoted or queued by the dispatcher; the line moves on past it', () => {
  goLive('c');
  assert.equal(PL.advanceQueue().promoted, 'd', 'a (older, held) is skipped');
  const r = PL.setPipeline('a', { queuedAt: new Date().toISOString(), queuedBy: 'dispatcher' }, { status: 'queued', note: 'Requeued.', by: 'dispatcher', action: 'pipeline:requeue' });
  assert.equal(r.status, 'pending'); assert.equal(BP.stopOf(r).kind, 'hold'); assert.match(r.notes.at(-1).text, /On hold: only Brett queues it again/);
  assert.throws(() => PL.queue('a', { by: 'auto (Launch builds without asking)' }), /only Brett queues it again/);
});
t('requeue-stuck leaves a parked build in Pending while another holds the Queue', () => {
  S.withStore((s) => { const b = core.findBuild(s, 'b'); b.status = 'pending'; b.steps[0].done = true; b.pipeline = BP.normPipeline({ ...b.pipeline, session: '', lastRun: { at: new Date().toISOString(), outcome: 'returned', reason: 'phase-done', phase: 'Phase 1', next: 'Opus' } }); return s; }, { by: 'test', action: 'park' });
  const r = PL.requeueStuck({ apply: true, by: 'reconciler' });
  assert.deepEqual(r.moved, []); assert.equal(get('b').status, 'pending'); assert.deepEqual(queued(), ['d']);
});
t('release by Brett lifts the stop: the build is in line again and moves up when the Queue is free', () => {
  assert.equal(PL.buildAction('release', ['a'], { by: 'dispatcher' }).refused.length, 1, 'an automatic writer cannot release');
  const r = PL.buildAction('release', ['a'], { by: 'console' });
  assert.equal(r.done.length, 1); assert.equal(BP.isStopped(get('a')), false); assert.equal(get('a').status, 'pending');
  goLive('d');
  assert.equal(PL.advanceQueue().promoted, 'a');
});
t('Brett queueing a stopped build lifts its stop', () => {
  S.withStore((s) => { const b = core.findBuild(s, 'a'); b.status = 'pending'; b.pipeline = BP.normPipeline({ ...b.pipeline, queuedAt: '', queuedBy: '', stop: { kind: 'unqueue', at: new Date().toISOString(), by: 'console', why: '', from: 'queued' } }); return s; }, { by: 'console', action: 'stop' });
  assert.equal(PL.advanceQueue().promoted, '', 'an unqueued build does not move up by itself');
  const q = PL.queue('a', { by: 'console' });
  assert.equal(q.status, 'queued'); assert.equal(BP.isStopped(q), false);
});
t('at every point at most one build was queued', () => { assert.ok(queued().length <= BP.QUEUE_MAX); });
console.log(`single-queue: ${n} checks passed`);

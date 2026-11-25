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
t('unqueue by Brett: back in Pending with his stop; the line moves on with the next build, not that one', () => {
  const r = PL.buildAction('unqueue', ['a'], { by: 'console' });
  assert.equal(r.done.length, 1); assert.equal(get('a').status, 'pending'); assert.deepEqual([BP.stopOf(get('a')).kind, BP.stopOf(get('a')).by, BP.stopOf(get('a')).from], ['unqueue', 'console', 'queued']);
  assert.equal(PL.advanceQueue().promoted, 'c', 'a (older) is skipped');
  assert.equal(line(), 'a:pending:unqueue b:running c:queued d:pending');
});
t('the store keeps a stop for every automatic writer: a raw requeue, a reconcile-style write, a launch', () => {
  const now = new Date().toISOString();
  const r1 = S.withStore((s) => { const b = core.findBuild(s, 'a'); b.status = 'queued'; b.pipeline = { ...b.pipeline, queuedAt: now, queuedBy: 'dispatcher' }; delete b.pipeline.stop; return s; }, { by: 'dispatcher', action: 'requeue' });
  assert.equal(get('a').status, 'pending'); assert.equal(BP.stopOf(get('a')).kind, 'unqueue'); assert.deepEqual(r1.stopsKept.map((x) => x.id), ['a']);
  const r2 = S.withStore((s) => { const b = core.findBuild(s, 'a'); b.status = 'running'; b.steps[0].done = true; b.pr = '#5'; return s; }, { by: 'reconciler', action: 'reconcile' });
  assert.equal(get('a').status, 'pending'); assert.equal(get('a').steps[0].done, true, 'what the write learned stays'); assert.equal(get('a').pr, '#5'); assert.match(r2.stopsKept[0].why, /reconciler may not move it to running/);
  const r3 = PL.setPipeline('a', { queuedAt: now, queuedBy: 'dispatcher' }, { status: 'queued', note: 'Requeued.', by: 'dispatcher', action: 'pipeline:requeue' });
  assert.equal(r3.status, 'pending'); assert.match(r3.notes.at(-1).text, /Back in Pending: only Brett queues it again/);
  assert.throws(() => PL.launch(get('a'), { account: 'w', model: 'Opus' }, {}), (e) => e.code === 'stopped' && /only Brett starts it again/.test(e.message));
  assert.throws(() => PL.queue('a', { by: 'auto (Launch builds without asking)' }), /only Brett queues it again/);
  assert.equal(line(), 'a:pending:unqueue b:running c:queued d:pending');
});
t('a Queue from before the rule (a second queued build, held the old way) is settled: the held one keeps its hold in Pending', () => {
  S.withStore((s) => { const b = core.findBuild(s, 'd'); b.status = 'queued'; b.pipeline = BP.normPipeline({ ...(b.pipeline ?? {}), queuedAt: '2026-11-20T00:00:00.000Z', queuedBy: 'console', heldAt: '2026-11-20T00:00:00.000Z', heldBy: 'console', heldWhy: 'later' }); return s; }, { by: 'console', action: 'old-queue' });
  assert.deepEqual(queued().sort(), ['c', 'd']);
  const m = PL.advanceQueue();
  assert.equal(m.kept, 'c'); assert.deepEqual(m.demoted, ['d']); assert.deepEqual(queued(), ['c']);
  assert.equal(line(), 'a:pending:unqueue b:running c:queued d:pending:hold');
  assert.match(get('d').notes.at(-1).text, /On hold: rests in Pending until Brett releases it/);
});
t('hold: a queued build rests in Pending and the line moves on; a live build finishes its step, then rests', () => {
  const r = PL.buildAction('hold', ['c'], { by: 'console', why: 'waiting on a design' });
  assert.equal(r.done[0].stop, 'hold'); assert.equal(get('c').status, 'pending'); assert.equal(BP.stopOf(get('c')).why, 'waiting on a design');
  assert.match(get('c').notes.at(-1).text, /On hold \(console\): waiting on a design\. It rests in Pending; nothing starts it until Brett releases it\./);
  assert.equal(PL.buildAction('hold', ['c'], { by: 'console' }).refused.length, 1, 'holding a held build is refused');
  PL.buildAction('hold', ['b'], { by: 'console' });
  assert.equal(get('b').status, 'running', 'the session keeps running'); assert.equal(BP.stopOf(get('b')).kind, 'hold');
  for (const exit of ['queued', 'built', 'running']) assert.equal(PL.setPipeline('b', { session: '' }, { status: exit, note: `Session ended (${exit}).`, by: 'pipeline', action: 'pipeline:end' }).status, 'pending', `the exit said ${exit}: a held build rests in Pending`);
  assert.equal(BP.stopOf(get('b')).kind, 'hold');
  assert.equal(PL.advanceQueue().promoted, '', 'every Pending build is stopped: nothing moves up');
});
t('release is Brett\'s: an automatic caller is refused; his release puts the build back in line', () => {
  const no = PL.buildAction('release', ['d'], { by: 'dispatcher' });
  assert.equal(no.refused.length, 1); assert.match(no.refused[0].error, /only Brett releases/);
  assert.equal(PL.buildAction('hold', ['d'], { by: 'watchdog' }).refused.length, 1, 'nor can one stop a build in his name');
  const r = PL.buildAction('release', ['d'], { by: 'console' });
  assert.equal(r.done.length, 1); assert.equal(BP.isStopped(get('d')), false); assert.equal(get('d').status, 'pending'); assert.equal(get('d').pipeline?.heldAt ?? '', '');
  assert.equal(PL.advanceQueue().promoted, 'd');
});
t('cancel: a live build is to be killed, rests in Pending, and no requeue or relaunch brings it back', () => {
  goLive('d');
  const r = PL.buildAction('cancel', ['d'], { by: 'console', why: 'wrong plan' });
  assert.deepEqual([r.done[0].stop, r.done[0].kill, r.done[0].session], ['cancel', true, 'axf-d']);
  assert.equal(get('d').status, 'pending'); assert.equal(BP.stopOf(get('d')).kind, 'cancel'); assert.equal(get('d').pipeline.session ?? '', '');
  assert.equal(PL.setPipeline('d', {}, { status: 'queued', note: 'Launch crashed: back in the Queue.', by: 'pipeline', action: 'pipeline:launch-retry' }).status, 'pending');
  assert.equal(PL.buildAction('cancel', ['d'], { by: 'console' }).refused.length, 1, 'cancelling it twice changes nothing');
  assert.equal(PL.buildAction('cancel', ['c'], { by: 'console' }).refused.length, 1, 'a held build is released first, not cancelled over its hold');
  assert.deepEqual(PL.requeueStuck({ apply: true, by: 'reconciler' }).moved, []);
});
t('Brett queueing a stopped build lifts its stop; the CLI names a caller it does not know behind its surface', () => {
  assert.equal(PL.stopActor('console'), 'console'); assert.equal(PL.stopActor('Brett Moss'), 'cli:Brett Moss'); assert.ok(BP.speaksForBrett(PL.stopActor('Brett Moss')));
  const q = PL.queue('a', { by: PL.stopActor('Brett Moss') });
  assert.equal(q.status, 'queued'); assert.equal(BP.isStopped(q), false); assert.equal(q.pipeline.queuedBy, 'cli:Brett Moss');
  assert.equal(line(), 'a:queued b:pending:hold c:pending:hold d:pending:cancel');
});
t('at every point at most one build was queued', () => { assert.ok(queued().length <= BP.QUEUE_MAX); });
console.log(`single-queue: ${n} checks passed`);

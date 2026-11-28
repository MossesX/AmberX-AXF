#!/usr/bin/env node
/**
 * Brett's stops stick (build-pipeline@1, the single-Queued contract) for every change made through orchestrator.mjs,
 * on a scratch store (no tmux, no slots):
 *   - queue puts one build in the Queue and refuses a second, naming the holder;
 *   - hold, unqueue and cancel rest the build in Pending with `pipeline.stop` on its record;
 *   - a writer that does not speak for Brett (a session ticking steps, the dispatcher setting a status) never moves a
 *     stopped build or drops its stop: its other changes are kept and the result says what was put back;
 *   - only an owner releases a stop; cancel twice is not an error;
 *   - Brett moving a stopped build himself (archive) lifts the stop with it; the same write from automation is put back.
 * Skipped when framework/core/build-pipeline.mjs is from before the contract.
 *   node apps/console-web/plugins/build-orchestrator/test/stops-stick.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-stops-'));
Object.assign(process.env, {
  AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILDS_EXPORT: '0', AXF_DATA_DIR: 'off', AXF_SHIPPED: 'off',
  AXF_SLOTS_DIR: join(tmp, 'slots'), AXF_SLOTS_TMUX: 'off', AXF_BUILD_LOCK_TMUX: 'off',
});
for (const k of ['AXF_APPROVER', 'AXF_APPROVER_VIA', 'AXF_ACTOR', 'AXF_ORCH_FILE']) delete process.env[k];

const BP = await import('../../../../../framework/core/build-pipeline.mjs');
if (typeof BP.stop !== 'function' || typeof BP.keepStop !== 'function') {
  console.log('stops-stick: skipped (build-pipeline@1 here has no stop transitions yet)');
  process.exit(0);
}
const step = (id) => ({ id, text: id, model: 'opus', done: false });
const build = (id, status, extra = {}) => ({ id, title: id, status, createdAt: `2026-11-0${id.length}T00:00:00.000Z`, steps: [step('s1'), step('s2')], notes: [], ...extra });
writeFileSync(process.env.AXF_BUILDS_STORE, JSON.stringify({ $axf: 'builds@1', rev: 1, updatedAt: '2026-11-28T00:00:00.000Z', rules: {}, meta: {}, drafts: {}, builds: [
  build('a', 'pending'), build('bb', 'pending'), build('ccc', 'running', { pipeline: { session: 'axf-ccc', slot: '2', account: 'acct' } }), build('dddd', 'pending'),
] }));
const O = await import('../orchestrator.mjs');
const get = (id) => JSON.parse(readFileSync(process.env.AXF_BUILDS_STORE, 'utf8')).builds.find((b) => b.id === id);
let n = 0; const ok = (cond, name) => { assert.ok(cond, name); n += 1; console.log(`  ✓ ${name}`); };

// one build in the Queue
let r = await O.queueMove('queue', ['a'], { by: 'console' });
ok(r.done[0]?.status === 'queued' && get('a').status === 'queued', 'queue: Pending → the Queue');
r = await O.queueMove('queue', ['bb'], { by: 'console' });
ok(!r.done.length && /a is already queued/.test(r.refused[0].error) && get('bb').status === 'pending', 'a second build is refused and the holder is named');

// hold: rests in Pending with the stop; automation cannot move it, its other changes are kept
r = await O.queueMove('hold', ['a'], { by: 'console', why: 'not now' });
ok(r.done[0].stop?.kind === 'hold' && get('a').status === 'pending' && get('a').pipeline.stop.why === 'not now', 'hold: Pending, the stop on the record with its reason');
let c = O.act({ action: 'status', id: 'a', status: 'queued' }, 'dispatcher');
ok(get('a').status === 'pending' && get('a').pipeline.stop.kind === 'hold' && c.stopsKept?.length === 1, 'the dispatcher setting a status does not move a held build');
c = O.act({ action: 'note', id: 'a', text: 'still here' }, 'session');
ok(!c.stopsKept && get('a').notes.some((x) => x.text === 'still here'), 'a change that touches no status passes untouched');
O.act({ action: 'step', id: 'a', step: 's1', done: true }, 'session');
c = O.act({ action: 'step', id: 'a', step: 's2', done: true }, 'session');
ok(get('a').steps.every((s) => s.done) && get('a').status === 'pending' && get('a').pipeline.stop.kind === 'hold', 'a session ticking every step: the ticks are kept, the build stays held in Pending');
r = await O.queueMove('release', ['a'], { by: 'watchdog' });
ok(!r.done.length && /only Brett releases/.test(r.refused[0].error) && get('a').pipeline.stop.kind === 'hold', 'automation cannot release a hold');

// unqueue sticks
r = await O.queueMove('queue', ['bb'], { by: 'console' });
r = await O.queueMove('unqueue', ['bb'], { by: 'console' });
ok(r.done[0].stop?.kind === 'unqueue' && get('bb').status === 'pending', 'unqueue: back in Pending with the stop');
O.act({ action: 'status', id: 'bb', status: 'queued' }, 'tick');
ok(get('bb').status === 'pending' && get('bb').pipeline.stop.kind === 'unqueue', 'a tick does not queue it again');
r = await O.queueMove('queue', ['bb'], { by: 'watchdog' });
ok(!r.done.length && get('bb').status === 'pending', 'automation cannot queue an unqueued build');
r = await O.queueMove('queue', ['bb'], { by: 'console' });
ok(r.done[0]?.status === 'queued' && !get('bb').pipeline.stop, "Brett's queue lifts the stop");

// cancel a running build: Pending, launch fields cleared, what to end handed back; twice is fine
r = await O.queueMove('cancel', ['ccc'], { by: 'console', why: 'wrong plan' });
ok(r.done[0].stop?.kind === 'cancel' && r.done[0].kill?.session === 'axf-ccc' && r.done[0].ended && get('ccc').status === 'pending' && !get('ccc').pipeline.session, 'cancel: Pending, the session and slot off the record, its sessions ended');
O.act({ action: 'status', id: 'ccc', status: 'running' }, 'session');
ok(get('ccc').status === 'pending' && get('ccc').pipeline.stop.kind === 'cancel', 'a relaunch or a late session write does not bring a cancelled build back');
r = await O.queueMove('cancel', ['ccc'], { by: 'console' });
ok(r.done.length === 1 && !r.refused.length, 'cancelling again is not an error');

// several at once: one refused build never stops the others
r = await O.queueMove('hold', ['dddd', 'nope'], { by: 'console' });
ok(r.done.map((d) => d.id).join() === 'dddd' && r.refused[0].id === 'nope', 'several builds: the unknown one is refused, the other is held');

// Brett moving a stopped build himself lifts the stop with it
const held = get('dddd'); const stops = O.stopsOf([held]);
const moved = { ...held, status: 'archived' };
ok(O.keepStops(stops, { builds: [moved] }, { by: 'Brett (console)', owner: true }).store.builds[0].status === 'archived' && !O.keepStops(stops, { builds: [moved] }, { owner: true }).store.builds[0].pipeline.stop,
  "Brett's own archive moves a held build and lifts the hold with it");
const back = O.keepStops(stops, { builds: [moved] }, { by: 'reconciler' });
ok(back.store.builds[0].status === 'pending' && back.store.builds[0].pipeline.stop.kind === 'hold' && back.kept.length === 1, 'the same write from the reconciler is put back');
r = await O.queueMove('release', ['a'], { by: 'console' });
ok(get('a').status === 'pending' && !get('a').pipeline?.stop, 'release by Brett: back in line, unmarked');

// the summary the CLI prints
const s = O.summary();
ok(s.$axf === 'pipeline-summary@1' && s.queued?.id === 'bb' && typeof s.counts.pending === 'number', 'summary: counts by status and the one queued build');
ok(O.summary('ccc').stop?.kind === 'cancel' && O.summary('ccc').steps.total === 2, "one build's status row carries its stop and step counts");
console.log(`stops-stick: ${n} checks passed`);

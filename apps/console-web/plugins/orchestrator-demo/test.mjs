/**
 * Orchestrator demo unit tests (node --test). Pure and in-memory: no console, no builds store on disk, no Claude.
 *
 *   node --test apps/console-web/plugins/orchestrator-demo/test.mjs
 *
 * Covers: the reference core against its fixture; the catalog is a valid demo-run@1; the ≥ 30 s gap in both modes;
 * Next → 30 s → the next act is focused; the sandbox guard refuses real builds; Stop cleans up every demo build and
 * leaves real ones alone; settings; the dependency check; the CLI's word → route map.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../../../../framework/core/live-demo.mjs';
import * as R from './runner.mjs';
import { createFixtures, findBuild, memoryAdapters, removeFixtures, updateDemoBuild } from './sandbox.mjs';
import { cleanupRun } from './cleanup.mjs';
import { fakeSessions } from './fake-session.mjs';
import { dryLander } from './dry-lander.mjs';
import { REQUIREMENTS, checkDeps } from './deps.mjs';
import { requestFor } from './cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const T0 = '2026-11-17T20:00:00.000Z';
const at = (ms) => new Date(Date.parse(T0) + ms).toISOString();
const REAL = { id: 'real-build-keep', title: 'A real build', status: 'queued', steps: [{ id: 's1', text: 'real', done: false }] };

/** Walk a fresh run from the overlay to the end of its first act. */
function firstActDone(pause) {
  let run = R.newDemoRun({ pause, now: T0, suffix: 'tst001' }).run;
  run = core.step(run, { type: 'continue', at: at(0), pause });
  run = core.step(run, { type: 'focused', at: at(1000) });
  run = core.step(run, { type: 'start', at: at(6000) });
  run = core.step(run, { type: 'finish', at: at(9000), result: { result: 'pass', observed: 'ok' } });
  return run;
}

test('the reference core matches its fixture (check-live-demo)', () => {
  const r = spawnSync(process.execPath, [join(REPO, 'framework/spec/check-live-demo.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('the act catalog is a valid demo-run@1 with a caption, focus and expect on every act', () => {
  const { run } = R.newDemoRun({ now: T0, suffix: 'tst002' });
  assert.deepEqual(core.validateRun(run), []);
  assert.equal(run.state, 'overlay');
  assert.ok(run.acts.length >= 16, `only ${run.acts.length} acts`);
  for (const a of run.acts) {
    assert.ok(a.caption, `${a.id} has no caption`);
    assert.ok(a.focus.address || a.focus.route, `${a.id} has no focus`);
    assert.ok(a.expect.kind, `${a.id} has no expect`);
    for (const b of a.builds) assert.ok(b.startsWith('demo-'), `${a.id} names a non-demo build ${b}`);
  }
});

test('at least 30 s between acts with Pause between steps off', () => {
  const run = firstActDone(false);
  assert.equal(run.state, 'cooldown');
  assert.ok(Date.parse(run.nextAt) - Date.parse(at(9000)) >= 30000, `gap ${Date.parse(run.nextAt) - Date.parse(at(9000))}`);
  assert.equal(core.step(run, { type: 'tick', at: at(9000 + 29999) }).state, 'cooldown');
  const next = core.step(run, { type: 'tick', at: at(9000 + 30000) });
  assert.equal(next.state, 'focusing');
  assert.equal(next.cursor, 1);
});

test('the gap can never be set below 30 s', () => {
  assert.equal(core.normGap(1000), 30000);
  assert.equal(core.newRun({ acts: [], minGapMs: 5 }).minGapMs, 30000);
});

test('Pause between steps on: waits for Next, then 30 s, then focuses the next act', () => {
  let run = firstActDone(true);
  assert.equal(run.state, 'waiting-next');
  // no tick moves it on while it waits, however long
  assert.equal(core.step(run, { type: 'tick', at: at(3600000) }).state, 'waiting-next');
  run = core.step(run, { type: 'next', at: at(60000) });
  assert.equal(run.state, 'cooldown');
  assert.ok(Date.parse(run.nextAt) - Date.parse(at(60000)) >= 30000);
  assert.equal(core.step(run, { type: 'tick', at: at(60000 + 29000) }).state, 'cooldown');
  run = core.step(run, { type: 'tick', at: at(60000 + 30000) });
  assert.equal(run.state, 'focusing');
  assert.equal(run.cursor, 1);
});

test('Next twice and hold / resume are harmless', () => {
  let rec = { run: firstActDone(true), driver: { held: false, log: [] } };
  rec = R.applyEvent(rec, 'next', { at: at(60000) });
  const again = R.applyEvent(rec, 'next', { at: at(61000) });
  assert.equal(again.run.nextAt, rec.run.nextAt);
  const held = R.applyEvent(rec, 'hold', { at: at(62000) });
  assert.equal(held.driver.held, true);
  assert.equal(R.applyEvent(held, 'resume', { at: at(63000) }).driver.held, false);
});

test('the sandbox guard refuses real builds', async () => {
  const m = memoryAdapters([REAL]);
  await assert.rejects(() => updateDemoBuild(m.store, REAL.id, (b) => { b.status = 'failed'; }), /not a demo build/);
  assert.throws(() => m.store.write((s) => { s.builds[0].status = 'failed'; return s; }));
  assert.throws(() => m.store.write((s) => { s.builds = []; return s; }));
  // a ledger that names a real build never gets it removed
  m.data.write('fixtures.json', { $axf: 'demo-fixtures@1', builds: [{ id: REAL.id, runId: 'x', at: T0 }] });
  const r = await removeFixtures({ store: m.store, data: m.data, sweep: true });
  assert.deepEqual(r.removed, []);
  assert.deepEqual(findBuild(m.store, REAL.id), REAL);
});

test('a real build named demo-* is never removed or changed by the demo', async () => {
  const named = { ...REAL, id: 'demo-sandbox-real-feature', source: 'console' };
  const lookalike = { ...REAL, id: 'demo-grid-abc123', source: 'console' };
  const m = memoryAdapters([named, lookalike]);
  m.data.write('fixtures.json', { $axf: 'demo-fixtures@1', builds: [{ id: named.id, runId: 'x', at: T0 }, { id: lookalike.id, runId: 'x', at: T0 }] });
  const r = await removeFixtures({ store: m.store, data: m.data, sweep: true });
  assert.deepEqual(r.removed, []);
  assert.deepEqual(m.store.read().builds.map((b) => b.id), [named.id, lookalike.id]);
  await assert.rejects(() => updateDemoBuild(m.store, lookalike.id, (b) => { b.status = 'failed'; }), /not one of the demo's own builds/);
});

test('Stop ends the run at once and cleans up every demo build, branch and alert; real builds untouched', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'od-test-'));
  try {
    const m = memoryAdapters([REAL]);
    const files = R.memoryFiles();
    const rec = R.newDemoRun({ pause: false, now: T0, suffix: 'tst003' });
    R.saveRun(files, rec);
    const ids = await createFixtures({ store: m.store, data: m.data, suffix: 'tst003', runId: rec.run.id, now: T0 });
    assert.ok(ids.length >= 3);
    const lander = dryLander({ data: m.data });
    const resolved = [];
    const stopped = R.applyEvent(R.loadRun(files), 'stop', { at: at(5000), why: 'test' });
    R.saveRun(files, stopped);
    assert.equal(stopped.run.state, 'stopped');
    const ctx = {
      clock: { nowMs: () => Date.parse(at(6000)), realMs: (v) => v }, now: () => at(6000), sleep: async () => {},
      store: m.store, data: m.data, ids: rec.driver.ids, logBuffer: [],
      sessions: fakeSessions({ dir: join(dir, 'sessions') }), lander,
      alerts: { resolve: async (keys) => { resolved.push(...keys); }, list: async () => [] },
      cleanup: cleanupRun,
    };
    const out = await R.driveOnce(ctx, files, rec.run.id);
    assert.equal(out.did, 'over');
    const end = R.loadRun(files, rec.run.id);
    assert.equal(end.driver.cleaned, true);
    assert.deepEqual(end.driver.cleanup.errors, []);
    assert.deepEqual([...end.driver.cleanup.removed].sort(), [...ids].sort());
    assert.ok(resolved.includes(`orchestrator-demo:notify:${rec.run.id}`));
    assert.deepEqual(m.store.read().builds.map((b) => b.id), [REAL.id]);
    assert.deepEqual(findBuild(m.store, REAL.id), REAL);
    // the summary is in the run record: one line per act, none run
    assert.equal(end.driver.summary.acts.length, rec.run.acts.length);
    assert.ok(end.driver.summary.acts.every((a) => ['not-run', 'skipped'].includes(a.result)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('settings: Pause between steps defaults on, the gap is reported as 30 s', () => {
  const files = R.memoryFiles();
  assert.deepEqual(R.readSettings(files), { $axf: 'orchestrator-demo-settings@1', pauseBetweenSteps: true, minGapMs: 30000 });
  assert.equal(R.writeSettings(files, { pauseBetweenSteps: false }).pauseBetweenSteps, false);
  assert.equal(R.writeSettings(files, { minGapMs: 1 }).minGapMs, 30000);
});

test('the dependency check names what is missing and passes when everything is there', () => {
  const root = mkdtempSync(join(tmpdir(), 'od-deps-'));
  try {
    const none = checkDeps({ root, env: {} });
    assert.equal(none.ok, false);
    assert.equal(none.missing.length, REQUIREMENTS.length);
    assert.match(none.reason, /can't start/);
    for (const r of REQUIREMENTS.filter((x) => x.file)) { mkdirSync(dirname(join(root, r.file)), { recursive: true }); writeFileSync(join(root, r.file), ''); }
    const p = join(root, 'apps/console-web/plugins/build-orchestrator'); // axf-plugin:build-orchestrator
    mkdirSync(join(p, 'web'), { recursive: true });
    writeFileSync(join(p, 'notify.json'), JSON.stringify({ $axf: 'notify-types@1', types: [{ id: 'build-live.broke' }] }));
    writeFileSync(join(p, 'web/index.tsx'), "dialogs: { 'build-live': { title: 'Broke' } }");
    assert.deepEqual(checkDeps({ root, env: {} }), { ok: true, missing: [], reason: '', skipped: '', source: 'live-build-status-real-time-grids-15' });
    assert.equal(checkDeps({ root: join(root, 'nowhere'), env: { AXF_DEMO_GAP_MS_TEST: '200' } }).ok, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the CLI maps every word to the same REST route', () => {
  assert.deepEqual(requestFor('start', ['--pause']), ['POST', '/start', { pause: true }]);
  assert.deepEqual(requestFor('start', []), ['POST', '/start', {}]);
  assert.deepEqual(requestFor('next'), ['POST', '/next', {}]);
  assert.deepEqual(requestFor('stop'), ['POST', '/stop', {}]);
  assert.deepEqual(requestFor('state'), ['GET', '/state']);
  assert.deepEqual(requestFor('summary'), ['GET', '/summary']);
  assert.deepEqual(requestFor('pause-between-steps', ['off']), ['PUT', '/pause-between-steps', { pause: false }]);
  assert.equal(requestFor('pause-between-steps', []), null);
  assert.equal(requestFor('bogus'), null);
});

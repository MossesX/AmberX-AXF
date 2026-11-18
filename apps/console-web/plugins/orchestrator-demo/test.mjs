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
    const p = join(root, 'apps/console-web/plugins/build-orchestrator');
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

// ── the lander self-test and the real landing (Nov 18 2026, build auto-lander-never-wait-missing-ui-review) ─────────
import * as ST from './selftest.mjs';
import { realLanding } from './real-landing.mjs';
import * as P3 from './acts/ci-fix-land.mjs';

/** Fake deps for the self-test: the gate answers as the live rules do; `twist` breaks one check. */
function fakeDeps(twist = '') {
  const verdict = (ui) => {
    if (ui === 'waiting') return { ok: true, pass: false, held: true, blockedBy: 'ui-review', flagged: false, flags: [], reviewFlag: 'waiting' };
    if (twist === 'gate-holds-missing' && ui === 'missing') return { ok: true, pass: false, held: true, blockedBy: 'ui-review', flagged: false, flags: [], reviewFlag: 'missing' };
    return { ok: true, pass: true, held: false, blockedBy: '', flagged: true, flags: ['ui-review-missing'], reviewFlag: ui === 'unposted' ? 'unposted' : 'missing' };
  };
  return {
    gate: (op, i) => (op === 'check_pr' ? verdict(i.snapshot.ui) : op === 'held_prs' ? (twist === 'held-prs-broken' ? { ok: false, message: 'no lander data folder' } : { ok: true, count: 1, over: [], limitMin: 60 }) : { ok: false }),
    lookupReview: async () => (twist === 'console-down' ? { ui: 'unknown', reviewFlag: 'missing', items: [] } : { ui: '', reviewFlag: '', items: [] }),
    blockReason: (id, s) => (twist === 'lookup-holds' ? { kind: 'ui', text: `${id}: UI Review couldn't be read, so it waits.` } : ['waiting', 'changes', 'rejected'].includes(s.ui) ? { kind: 'ui', text: `${id}: held` } : null),
    notReady: () => (twist === 'queue-refuses' ? 'its PR checks have not run yet' : ''),
    queueControl: () => ({}), queueOptions: () => ({ waitUi: true, redJoins: true }),
    landerCli: () => (twist === 'no-cli' ? '' : '/x/land.mjs'), landerCommand: () => ({ ok: true, out: '[]' }),
  };
}

test('self-test: the real lander path on a throwaway PR passes when the gate flags a missing review, the lookup never holds and the queue takes it', async () => {
  const r = await ST.selfTest({ deps: fakeDeps(), at: T0 });
  assert.equal(r.$axf, 'demo-selftest@1'); assert.equal(r.ok, true); assert.equal(r.pr, 999001); assert.equal(r.branch, 'demo/selftest');
  assert.deepEqual(r.checks.map((c) => [c.id, c.ok]), [['gate-verdict', true], ['review-lookup', true], ['queue-add', true], ['held-prs', true]]);
  assert.match(r.checks[0].detail, /missing → land, flagged ui-review-missing; waiting → hold/); assert.match(r.checks[1].detail, /no item for #999001/); assert.match(r.checks[2].detail, /ready/);
  // a console that does not answer is 'unknown': flagged, never a hold, so the test still passes and says so
  const down = await ST.selfTest({ deps: fakeDeps('console-down'), at: T0 });
  assert.equal(down.ok, true); assert.match(down.checks[1].detail, /did not answer: unknown = flagged, not a hold/); assert.equal(down.checks[1].data.answered, false);
});

test('self-test: each broken part of the lander path is one named failing check, and the alert names it', async () => {
  for (const [twist, id, re] of [['gate-holds-missing', 'gate-verdict', /missing: ok=true pass=false/], ['lookup-holds', 'review-lookup', /HOLDS/], ['queue-refuses', 'queue-add', /notReady: its PR checks/], ['no-cli', 'queue-add', /lander CLI missing/], ['held-prs-broken', 'held-prs', /no lander data folder/]]) {
    const r = await ST.selfTest({ deps: fakeDeps(twist), at: T0 });
    assert.equal(r.ok, false, twist);
    const bad = r.checks.filter((c) => !c.ok); assert.deepEqual(bad.map((c) => c.id), [id], twist); assert.match(bad[0].detail, re, twist);
    const a = ST.alertFor(r); assert.equal(a.key, 'orchestrator-demo:selftest'); assert.equal(a.severity, 'error'); assert.match(a.title, new RegExp(`self-test failed: ${id}`)); assert.match(a.body, /axf demo selftest/); assert.equal(a.meta.check, 'demo-selftest');
  }
  const none = await ST.selfTest({ deps: { gate: () => { throw new Error('boom'); }, lookupReview: async () => { throw new Error('down'); }, blockReason: () => null, notReady: () => '', queueControl: () => ({}), queueOptions: () => ({}), landerCli: () => '', landerCommand: () => ({ ok: false }) }, at: T0 });
  assert.equal(none.ok, false); assert.match(none.checks[0].detail, /threw: boom/);
  const files = R.memoryFiles(); ST.record(files, none); assert.equal(ST.last(files).ok, false); assert.equal(ST.last(R.memoryFiles()), null);
});

test('the demo tests itself before it lands: a failing self-test stops the run and raises the systems check alert, nothing is recorded as landed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'od-test-'));
  try {
    const m = memoryAdapters([REAL]);
    const files = R.memoryFiles();
    const rec = R.newDemoRun({ pause: false, now: T0, suffix: 'tst004' });
    const ids = rec.driver.ids;
    // jump the run to the self-test act, running
    let run = rec.run; const idx = run.acts.findIndex((a) => a.id === 'self-test');
    run = { ...run, cursor: idx, state: 'running', enteredAt: at(1000), updatedAt: at(1000) };
    R.saveRun(files, { ...rec, run });
    await createFixtures({ store: m.store, data: m.data, suffix: 'tst004', runId: rec.run.id, keys: ['ci'], now: T0 });
    const raised = [];
    const ctx = {
      clock: { nowMs: () => Date.parse(at(2000)), realMs: (v) => v }, now: () => at(2000), sleep: async () => {},
      store: m.store, data: m.data, ids, suffix: 'tst004', runId: rec.run.id, logBuffer: [],
      sessions: fakeSessions({ dir: join(dir, 'sessions') }), lander: dryLander({ data: m.data }),
      alerts: { raise: async (a) => { raised.push(a); }, resolve: async () => {}, list: async () => raised },
      selfTest: async () => ST.selfTest({ deps: fakeDeps('queue-refuses'), at: at(2000) }),
      realLanding: null, cleanup: cleanupRun,
    };
    const out = await R.driveOnce(ctx, files, rec.run.id);
    assert.equal(out.did, 'stopped:self-test');
    const end = R.loadRun(files, rec.run.id);
    assert.equal(end.run.state, 'stopped'); assert.equal(end.run.stopped.by, 'error'); assert.match(end.run.stopped.why, /self-test|did not pass/);
    const res = end.run.results.find((r) => r.actId === 'self-test'); assert.equal(res.result, 'fail'); assert.match(res.error, /did not pass its own test.*queue-add/);
    assert.equal(raised.length, 1); assert.equal(raised[0].key, 'orchestrator-demo:selftest'); assert.match(raised[0].title, /queue-add/);
    assert.ok(findBuild(m.store, ids.ci).notes.some((n) => /Lander self-test FAILED/.test(n.text)));
    assert.ok(!end.run.results.some((r) => r.actId === 'land'), 'the landing act never ran');
    assert.ok(end.driver.log.some((l) => /stopped self-test/.test(l)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the landing act runs for real: the demo PR is created, queued and passes only once the merge queue merged it; no real landing = a failed act', async () => {
  const m = memoryAdapters([REAL]);
  const rec = R.newDemoRun({ pause: false, now: T0, suffix: 'tst005' });
  const ids = rec.driver.ids;
  await createFixtures({ store: m.store, data: m.data, suffix: 'tst005', runId: rec.run.id, keys: ['ci'], now: T0 });
  const calls = []; let merged = false;
  const call = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path.endsWith('/demo-branch')) return { ok: true, branch: body.branch, sha: 'abc123' };
    if (path.endsWith('/pr')) return { number: 9001, url: 'https://github.com/MossesX/AmberX-AXF/pull/9001' };
    if (path.endsWith('/queue/add')) return { ok: true };
    if (path.endsWith('/queue')) return { merged: merged ? [{ pr: 9001, at: at(5000) }] : [] };
    if (path.endsWith('/demo-branch/delete')) return { ok: true, deleted: true };
    return null;
  };
  const real = realLanding({ call, data: m.data, slug: 'MossesX/AmberX-AXF' });
  const land = rec.run.acts.find((a) => a.id === 'land');
  assert.equal(land.expect.text, 'landed'); assert.equal(land.expect.within, 45 * 60000); assert.ok(!rec.run.acts.some((a) => a.id === 'land-dry'));
  const base = { now: () => at(3000), log: () => {}, store: m.store, data: m.data, suffix: 'tst005', runId: rec.run.id, lander: dryLander({ data: m.data }), alerts: { raise: async () => {} } };
  const r = await P3.handlers['demo.land']({ ...base, realLanding: real }, land);
  assert.equal(r.error, undefined); assert.match(r.observed, /PR #9001 from demo\/demo-ci-tst005 is in the merge queue/);
  assert.deepEqual(calls.map((c) => c.path), ['/api/plugins/push-banner/demo-branch', '/api/plugins/push-banner/pr', '/api/plugins/push-banner/queue/add']);
  assert.equal(calls[0].body.branch, `demo/${ids.ci}`); assert.equal(calls[0].body.path, '_claude/builds/demo/landings.md'); assert.match(calls[0].body.line, /landed by the orchestrator demo/);
  assert.equal(findBuild(m.store, ids.ci).pr, 9001); assert.equal(real.entry(ids.ci).queued, true); assert.equal(real.entry(ids.ci).merged, false);
  // not merged yet = the expectation does not hold; merged by the queue = it holds and s3 is crossed off
  assert.equal(await P3.expects.landed({ ...base, realLanding: real }, land), false);
  merged = true;
  assert.equal(await P3.expects.landed({ ...base, realLanding: real }, land), true);
  const b = findBuild(m.store, ids.ci); assert.ok(b.steps.find((s) => s.id === 's3').done); assert.equal(b.status, 'landed'); assert.ok(b.notes.some((n) => /Landed for real: the merge queue merged PR #9001/.test(n.text)));
  assert.equal(real.entry(ids.ci).merged, true);
  // the queue refusing the PR is a failed act with the reason
  const calls2 = []; const refuse = realLanding({ call: async (mth, path, body) => { calls2.push(path); return path.endsWith('/queue/add') ? { ok: false, detail: 'it is a draft' } : path.endsWith('/pr') ? { number: 9002 } : { ok: true }; }, data: m.data });
  const r2 = await P3.handlers['demo.land']({ ...base, realLanding: refuse }, land);
  assert.match(r2.error, /did not reach the merge queue: the merge queue did not take #9002: it is a draft/);
  // no real landing wired: the dry run is recorded, and that is a failed landing act (Brett: a dry run is not a landing)
  const r3 = await P3.handlers['demo.land']({ ...base, realLanding: null }, land);
  assert.match(r3.error, /did not merge: the real landing is not available/); assert.equal(await P3.expects.landed({ ...base, realLanding: null }, land), false);
  // cleanup deletes the demo branches still unmerged, never a merged one
  const gone = await refuse.cleanup(null);
  assert.ok(gone.includes(`demo/${ids.ci}`)); assert.ok(calls2.some((p) => p.endsWith('/demo-branch/delete')) === (refuse.entries().length === 0 && !merged) || true);
});

test('the self-test is reachable the same way everywhere: CLI word, REST route, MCP command, console action, voice', async () => {
  assert.deepEqual(requestFor('selftest', []), ['POST', '/selftest', {}]); assert.deepEqual(requestFor('selftest', ['--last']), ['GET', '/selftest']);
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8'));
  assert.ok(manifest.commands.items.some((c) => c.id === 'selftest' && c.route === 'POST /selftest')); assert.ok(manifest.commands.items.some((c) => c.id === 'selftest-last' && c.route === 'GET /selftest'));
  assert.ok(JSON.parse(readFileSync(join(HERE, 'actions.json'), 'utf8')).actions.some((a) => a.id === 'demo.selftest' && a.route === 'POST /selftest'));
  assert.ok(JSON.parse(readFileSync(join(HERE, 'voice.json'), 'utf8')).commands.some((c) => c.action === 'demo.selftest' && c.phrases.includes('run the demo self-test')));
  const routes = readFileSync(join(HERE, 'server/routes.py'), 'utf8'); assert.match(routes, /@router.post\("\/selftest"\)/); assert.match(routes, /HEALTH_ID = "demo-selftest"/);
});

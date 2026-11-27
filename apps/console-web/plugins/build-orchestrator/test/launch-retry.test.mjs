// Launch-crash retry tests: node apps/console-web/plugins/build-orchestrator/test/launch-retry.test.mjs
// A run that died at launch (E2BIG, an empty stream) goes back to the Queue with a backoff, not counted as a run; the
// plan skips it until the backoff ends, then the next launch picks it up; a run that gets going clears the record; a
// crash loop stops after LAUNCH_RETRY_MAX with a banner alert and ends the normal way.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-launch-retry-'));
Object.assign(process.env, {
  AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_SHIPPED: 'off', AXF_DATA_DIR: 'off', AXF_CREW_SAY: 'off',
  AXF_PIPELINE_DIR: join(tmp, 'pipeline'), AXF_PIPELINE_CONSOLE: 'off', AXF_BUILD_PROFILE: 'all', AXF_PIPELINE_WORKTREES: join(tmp, 'wt'), AXF_PIPELINE_RULES: 'off',
});
const core = await import('../../../../../framework/plan/builds-store-core.mjs');
const BP = await import('../../../../../framework/core/build-pipeline.mjs');
const S = await import('../../../../../framework/cli/builds-store.mjs');
const PC = await import('../pipeline-core.mjs');
const PL = await import('../pipeline.mjs');

let n = 0; const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const ID = 'crashy';
const wt = join(tmp, 'wt', ID); mkdirSync(wt, { recursive: true });
const find = () => core.findBuild(S.loadStore(), ID);
const steps = [{ id: 's1', text: 'one', model: 'Opus', estimate: '10 min' }, { id: 's2', text: 'two', model: 'Opus', estimate: '10 min' }];
writeFileSync(process.env.AXF_BUILDS_STORE, JSON.stringify(core.normalizeStore({ ...core.emptyStore(), builds: [{ id: ID, title: 'Crashy', status: 'queued', steps, pipeline: { queuedAt: '2026-11-17T00:00:00Z' } }] })));

/** The dispatcher's launch record, as tick writes it (run n on account w). */
const launched = () => PL.setPipeline(ID, { account: 'w', session: `axf-${ID}--a`, model: 'Opus', launchedAt: new Date().toISOString(), runs: (find().pipeline?.runs ?? 0) + 1 }, { status: 'running', action: 'pipeline:launch' });
/** What the launcher leaves: the run log and the stream file (truncated as claude starts). */
const ran = (log, stream) => { writeFileSync(join(wt, `${ID}.log`), log); writeFileSync(join(wt, `${ID}.jsonl`), stream); };
const accounts = [{ name: 'w', kind: 'subscription', usable: true, fable: true, parallel: 1, running: 0, free: 1 }];
const plan = (now) => PC.plan({ builds: S.loadStore().builds, accounts, slots: { free: 4, used: 0, cap: 8 }, now });

await t('pure: launchCrashOf reads E2BIG, a launcher error and an empty stream; a clean end never', () => {
  assert.match(PC.launchCrashOf({ exit: 126, tail: 'deploy/claude-headless.sh: line 416: /root/.local/bin/claude: Argument list too long' }).why, /Argument list too long/);
  assert.ok(PC.launchCrashOf({ exit: 1, tail: 'claude-headless: login copy failed' }));
  assert.equal(PC.launchCrashOf({ exit: 1, tail: '', streamBytes: 0 }).why, 'the session exited before its first output');
  assert.equal(PC.launchCrashOf({ exit: 1, tail: 'Error: test failed', streamBytes: 5000 }), null, 'a crash mid-run is not a launch crash');
  assert.equal(PC.launchCrashOf({ exit: 0, tail: 'Argument list too long' }), null);
  assert.equal(PC.launchCrashOf({ exit: 1, kind: 'phase-done', streamBytes: 0 }), null);
  assert.deepEqual([1, 2, 3, 4].map(PC.launchBackoffMin), [1, 4, 16, 60]);
});

await t('crash once → back in the Queue with a backoff, not counted as a run, the reason on the build', () => {
  launched(); ran('line 416: claude: Argument list too long\n', '');
  const r = PL.endRun(find(), { exit: 126 });
  assert.equal(r.outcome, 'requeued'); assert.equal(r.reason, 'launch-crash');
  const b = find();
  assert.equal(b.status, 'queued'); assert.equal(b.pipeline.runs, 0); assert.equal(b.pipeline.session, '');
  assert.equal(b.pipeline.launchRetry.count, 1); assert.match(b.pipeline.launchRetry.lastError, /Argument list too long/); assert.equal(b.pipeline.launchRetry.gaveUp, false);
  assert.ok(Date.parse(b.pipeline.launchRetry.retryAt) > Date.now());
  assert.match(b.notes.at(-1).text, /Launch crashed .*retry 1 of 3 in 1 min \(not counted as a run\)/);
});

await t('the plan waits out the backoff, then the next launch picks it up', () => {
  const lr = find().pipeline.launchRetry;
  const early = plan(Date.parse(lr.retryAt) - 1000);
  assert.ok(!early.launches.some((l) => l.id === ID)); assert.match(early.waits.find((w) => w.id === ID).why, /launch crashed .*retry 1/);
  const later = plan(Date.parse(lr.retryAt) + 1000);
  assert.deepEqual(later.launches.map((l) => l.id), [ID]);
});

await t('a run that gets going clears the record', () => {
  launched(); ran('working…\n', '{"type":"system"}\n{"type":"assistant"}\n');
  PL.endRun(find(), { exit: 0, kind: 'stopped' });
  assert.equal(find().pipeline.launchRetry, undefined);
});

await t('a crash loop stops after the retry cap with a banner alert and ends the normal way', () => {
  PL.setPipeline(ID, {}, { status: 'queued' });
  const alerts = [];
  for (let i = 1; i <= BP.LAUNCH_RETRY_MAX; i += 1) {
    launched(); ran('', '');
    const r = PL.endRun(find(), { exit: 1, alert: (k, d) => alerts.push([k, d]) });
    assert.equal(r.reason, 'launch-crash'); assert.equal(find().pipeline.launchRetry.count, i);
  }
  assert.equal(alerts.length, 0);
  launched(); ran('', '');
  const r = PL.endRun(find(), { exit: 1, alert: (k, d) => alerts.push([k, d]) });
  assert.notEqual(r.reason, 'launch-crash', 'past the cap: the normal crash path');
  const b = find();
  assert.equal(b.pipeline.launchRetry.gaveUp, true); assert.equal(b.pipeline.launchRetry.count, BP.LAUNCH_RETRY_MAX);
  const lc = alerts.find(([k]) => k === 'launch-crash');
  assert.ok(lc, `a launch-crash alert: ${JSON.stringify(alerts.map(([k]) => k))}`);
  const a = PC.alertFor('launch-crash', lc[1]);
  assert.equal(a.severity, 'error'); assert.match(a.title, /Keeps crashing at launch/); assert.match(a.body, /3 times in a row/);
});

console.log(`launch-retry: ${n} passed`);

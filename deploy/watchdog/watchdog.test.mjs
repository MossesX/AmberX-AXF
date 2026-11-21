// node --test deploy/watchdog/watchdog.test.mjs — layer 3, the schedules and the layer-2 pass on a plain JSON store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as cron from './cron.mjs';
import * as L2 from './layer2.mjs';
import * as L3 from './layer3.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const tmp = () => mkdtempSync(join(tmpdir(), 'axf-wd2-'));

test('install writes the 2.0 schedules, removes the retired ones, and is idempotent', () => {
  const d = tmp(); const env = { AXF_WATCHDOG2_CRON_DIR: d, AXF_WATCHDOG2_NO_SYSTEMCTL: '1' };
  for (const r of cron.RETIRED) writeFileSync(join(d, r), '* * * * * root true\n');
  const r = cron.install({ dir: '/opt/axf', env });
  assert.deepEqual(r.removed.sort(), [...cron.RETIRED].sort());
  for (const n of ['axf-orchestrator-tick', 'axf-watchdog-l2', 'axf-watchdog-audits', 'axf-watchdog-l3']) assert.ok(existsSync(join(d, n)), n);
  assert.match(readFileSync(join(d, 'axf-watchdog-audits'), 'utf8'), /^17,47 \* \* \* \* root .*nice -n 19 node \$S run/m);
  assert.match(readFileSync(join(d, 'axf-watchdog-l2'), 'utf8'), /flock -n \/run\/axf-watchdog-l2\.lock timeout 300/);
  assert.equal(cron.install({ dir: '/opt/axf', env }).written.length, 0);
  assert.equal(cron.status({ dir: '/opt/axf', env }).ok, true);
  writeFileSync(join(d, 'axf-pipeline'), 'x');
  assert.equal(cron.status({ dir: '/opt/axf', env }).ok, false);
});

test('layer 3: all alive is quiet; a stale layer 2 is healed; alert only after it failed 3 runs in a row', () => {
  const d = tmp();
  const alive = { cronUp: true, schedules: { ok: true }, layer2AgeMin: 1, tickAgeMin: 1, tickScript: true, layer2Procs: [], tickProcs: [] };
  const base = { AXF_WATCHDOG2_DIR: d, AXF_WATCHDOG2_DRY_EXEC: '1', AXF_WATCHDOG_NOTIFY_LOG: join(d, 'alerts.jsonl') };
  assert.equal(L3.run({ env: { ...base, AXF_WATCHDOG2_L3_FACTS: JSON.stringify(alive) } }).found.length, 0);
  const stale = { ...alive, layer2AgeMin: 20, layer2Procs: [{ pid: 999999, ageMin: 30 }] };
  const env = { ...base, AXF_WATCHDOG2_L3_FACTS: JSON.stringify(stale) };
  for (let i = 1; i <= 3; i += 1) {
    const r = L3.run({ env });
    assert.equal(r.healed[0].id, 'layer2'); assert.match(r.healed[0].did, /killed hung layer 2/);
    assert.equal(r.alerts.length, i === 3 ? 1 : 0, `run ${i}`);
  }
  assert.equal(L3.run({ env }).alerts.length, 0, 'not re-sent within 6 hours');
  assert.equal(readFileSync(join(d, 'alerts.jsonl'), 'utf8').trim().split('\n').length, 1);
  assert.match(readFileSync(join(d, 'actions.jsonl'), 'utf8'), /"by":"watchdog"/);
  // healed: the count and the alert stamp clear
  L3.run({ env: { ...base, AXF_WATCHDOG2_L3_FACTS: JSON.stringify(alive) } });
  assert.deepEqual(L3.l3Heartbeat(base).fails, {});
});

test('layer 3 problems: cron down, schedules off, tick stale', () => {
  const ids = L3.problems({ cronUp: false, schedules: { ok: false, files: {} }, layer2AgeMin: 1, tickAgeMin: 9, tickScript: true }).map((p) => p.id);
  assert.deepEqual(ids, ['cron', 'schedules', 'tick']);
});

test('layer 2 run on a plain JSON store: limit → failed, then retried on another account', () => {
  const d = tmp(); const store = join(d, 'store.json');
  const old = new Date(Date.now() - 10 * 60_000).toISOString();
  writeFileSync(store, JSON.stringify({ builds: [{ id: 'b', status: 'building', statusAt: old, notes: [], steps: [{ id: 's', status: 'building', statusAt: old, account: 'a1' }] }] }));
  const env = { ...process.env, AXF_WATCHDOG2_STORE: store, AXF_WATCHDOG2_DIR: join(d, 'wd'), AXF_WATCHDOG2_DRY_EXEC: '1', AXF_WATCHDOG_NOTIFY_LOG: join(d, 'al'),
    AXF_WATCHDOG2_PROBES: JSON.stringify({ 'b/s': { tmux: true, logTail: "You've hit your weekly limit" } }), AXF_WATCHDOG2_ACCOUNTS: JSON.stringify([{ name: 'a1', usable: false }, { name: 'a2', left: 0.4 }]) };
  const run = () => spawnSync('node', [join(HERE, 'layer2.mjs'), 'run'], { env, encoding: 'utf8' });
  assert.equal(run().status, 0);
  let s = JSON.parse(readFileSync(store, 'utf8')).builds[0].steps[0];
  assert.deepEqual([s.status, s.failedFrom], ['failed', 'building']);
  // make the failure old enough to retry
  const j = JSON.parse(readFileSync(store, 'utf8')); j.builds[0].steps[0].statusAt = old; writeFileSync(store, JSON.stringify(j));
  assert.equal(run().status, 0);
  const b = JSON.parse(readFileSync(store, 'utf8')).builds[0]; s = b.steps[0];
  assert.deepEqual([s.status, s.attempt, s.account], ['ready', 2, 'a2']);
  assert.ok(b.notes.every((n) => n.by === 'watchdog'));
  assert.ok(existsSync(join(d, 'wd', 'heartbeat.json')));
});

test('layer 2 probe names: a step without a recorded tmux is looked up as axf-<build>--<step>, never a guessed single-dash name', async () => {
  const L = await import('./layer2.mjs');
  const p = L.placeOf({ id: 'b' }, { id: 's6' }, { AXF_PIPELINE_WORKTREES: '/w' });
  assert.deepEqual([p.session, p.prefix, p.worktree], ['', 'axf-b--s6', '/w/b--s6']);
  assert.equal(L.placeOf({ id: 'b' }, { id: 's6', tmux: 'axf-b--s6--earl' }).session, 'axf-b--s6--earl');
});

test('layer 2 run, the dead builds of Nov 21: waiting builds behind a failed active build are left alone; a given-up one is ONE alert with the retry command', () => {
  const d = tmp(); const store = join(d, 'store.json');
  const old = new Date(Date.now() - 180 * 60_000).toISOString();
  const waiting = ['w1', 'w2'].map((id) => ({ id, flow: 'pipeline-2', status: 'split', statusAt: old, attempt: 1, notes: [], steps: [{ id: 's1', status: 'pending', statusAt: old }] }));
  const builds = [
    { id: 'act', flow: 'pipeline-2', status: 'failed', failedFrom: 'running-ci', attempt: 3, statusAt: old, notes: [], steps: [] },
    ...waiting,
    { id: 'dead', flow: 'pipeline-2', status: 'failed', failedFrom: 'split', attempt: 5, statusAt: old, notes: [], steps: [{ id: 's1', status: 'pending', statusAt: old }] },
  ];
  writeFileSync(store, JSON.stringify({ builds }));
  const env = { ...process.env, AXF_WATCHDOG2_STORE: store, AXF_WATCHDOG2_DIR: join(d, 'wd'), AXF_WATCHDOG2_DRY_EXEC: '1', AXF_WATCHDOG_NOTIFY_LOG: join(d, 'al'), AXF_WATCHDOG2_PROBES: '{}', AXF_WATCHDOG2_ACCOUNTS: '[]' };
  for (let i = 0; i < 3; i += 1) assert.equal(spawnSync('node', [join(HERE, 'layer2.mjs'), 'run'], { env, encoding: 'utf8' }).status, 0);
  const after = JSON.parse(readFileSync(store, 'utf8')).builds;
  assert.deepEqual(after.filter((b) => b.id.startsWith('w')).map((b) => [b.status, b.attempt, b.notes.length]), [['split', 1, 0], ['split', 1, 0]], 'three hours at split behind a failed build: not failed, not nudged, not noted');
  assert.deepEqual([after[3].status, after[3].attempt], ['failed', 5], 'the given-up build is not retried past the ceiling');
  const alerts = readFileSync(join(d, 'al'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(alerts.length, 1, 'one alert, however many passes');
  assert.match(alerts[0].title, /could not heal dead/);
  assert.ok(alerts[0].body.includes(L2.retryCommand('dead')) && / retry dead$/.test(L2.retryCommand('dead')), 'the alert carries the exact retry command');
});

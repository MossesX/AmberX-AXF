#!/usr/bin/env node
/**
 * Auto-lander tests (build auto-lander-controls-in-the-gate-plugin, Nov 15 2026).
 *   node apps/console-web/plugins/push-banner/land/auto-lander.test.mjs
 * 1. regression: with autoLand off (since Nov 4) a run said "auto-land is off" and handed the queue `fetched: true`
 *    although nothing had fetched; now the queue fetches itself and the run reports what it landed;
 * 2. the switch: off ends the run with reason switched-off and no queue round; the mode picks the path;
 * 3. run records: every blocking reason from the fixed list; the runs log is trimmed;
 * 4. the landing line: order, move up / down, skip (with reason, remembered), land now.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as A from './auto-lander-core.mjs';
import { runOnce } from './land.mjs';
import { readQueueConfig, readQueueControl } from './merge-queue.mjs';
import { act, cronHeal, healFile, lineOf, main as landerMain, readRuns, recordRun, setSetting, status } from './auto-lander.mjs';
process.env.AXF_CREW_SAY = 'off';

let ok = 0; let bad = 0;
const check = (c, m) => { if (c) { ok++; console.log(`  ✓ ${m}`); } else { bad++; console.log(`  ✗ ${m}`); } };
const dir = mkdtempSync(join(tmpdir(), 'axf-lander-test-'));
const s = { repo: dir, dataDir: dir, remote: 'origin', base: 'main', slug: 'o/r' };
const cfg = (c) => writeFileSync(join(dir, 'config.json'), JSON.stringify(c));
const gh = Object.assign(async () => [], { calls: 0, cached: 0, save() {}, left: () => 5000 });
const quiet = () => {};
const queueDoc = {
  at: '2026-11-15T05:00:00.000Z',
  items: [
    { pr: 686, title: 'A', build: 'a', state: 'testing', ci: 'running' },
    { pr: 633, title: 'Console app part 3', build: 'console-app-part-3', state: 'waiting', ci: '' },
    { pr: 637, title: 'Console Android app', build: 'console-android-app', state: 'waiting', ci: '' },
    { pr: 640, title: 'Console app part 4', build: 'console-app-part-4', state: 'waiting', ci: '', why: 'conflicts with PR 637 ahead of it in code' },
  ],
  merged: [{ pr: 683, at: '2026-11-15T05:00:00.000Z' }, { pr: 600, at: '2026-11-14T01:00:00.000Z' }],
};

try {
  // ---------------------------------------------------------------- 1. the regression
  console.log('regression: autoLand off no longer silences the run or skips the fetch');
  cfg({ autoLand: false, mergeQueue: true });
  let got = null; let printed = '';
  await runOnce({ s, gh, json: false, print: (o, t) => { printed = t; }, landRound: async () => ({ on: false, items: [] }), queue: async (o) => { got = o; return queueDoc; }, record: recordRun });
  check(got && got.fetched === false, 'the queue round fetches by itself when the builds round did not run');
  check(!/auto-land is off/.test(printed), `the run no longer reports "auto-land is off" (said: ${printed.split('\n')[0]})`);
  check(printed.includes('auto-lander on · serial · landed · landing ' + '#' + '686 · landed ' + '#' + '683'), 'the run says it is on, its mode and what it landed');
  got = null;
  await runOnce({ s, gh, print: quiet, landRound: async () => ({ on: true, items: [] }), queue: async (o) => { got = o; return queueDoc; }, record: () => {} });
  check(got?.fetched === true, 'after a builds round that fetched, the queue reuses that fetch');

  // ---------------------------------------------------------------- 2. the switch and the mode
  console.log('switch and mode');
  check(A.readLander({}).enabled === true && A.readLander({}).mode === 'serial', 'defaults: on, serial');
  check(A.readLander({ mergeQueue: false }).enabled === false, 'a config without autoLander follows mergeQueue');
  cfg({ mergeQueue: true, queueMode: 'batch', batchSize: 8 });
  setSetting(s, 'enabled', false);
  let called = false; let out = null;
  await runOnce({ s, gh, print: (o) => { out = o; }, queue: async () => { called = true; return {}; }, landRound: async () => { called = true; return {}; }, record: recordRun });
  check(!called, 'off: no builds round and no queue round');
  check(out?.run?.reason === 'switched-off' && out.run.result === 'skipped', 'off: the run record says switched-off');
  check(readQueueConfig(s).mergeQueue === false, 'off: the queue config the push banner reads is off too (one switch)');
  setSetting(s, 'enabled', true);
  check(readQueueConfig(s).mode === 'stack' && readQueueConfig(s).depth === 1, 'serial: the queue runs one PR deep on the real main');
  setSetting(s, 'mode', 'merge-queue');
  check(readQueueConfig(s).mode === 'batch' && readQueueConfig(s).batchSize === 8, 'merge-queue: the configured batch queue');
  setSetting(s, 'mode', 'queue');
  check(A.readLander(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))).mode === 'merge-queue', '"queue" is short for merge-queue');
  let threw = ''; try { setSetting(s, 'mode', 'yolo'); } catch (e) { threw = e.message; }
  check(/mode is one of/.test(threw), 'a bad mode is refused');
  setSetting(s, 'mode', 'serial');

  // ---------------------------------------------------------------- 3. run records
  console.log('run records: every reason');
  const rec = (f) => A.runRecord({ startedAt: 'a', finishedAt: 'b', mode: 'serial', ...f });
  check(rec({ enabled: false }).reason === 'switched-off', 'switched-off');
  check(rec({ locked: true }).reason === 'locked' && rec({ locked: true }).result === 'skipped', 'locked');
  check(rec({ tokenOk: false }).reason === 'token-missing' && rec({ tokenOk: false }).result === 'error', 'token-missing');
  check(rec({ error: 'boom' }).reason === 'error', 'error');
  check(rec({ queue: { items: [] } }).reason === 'queue-empty' && rec({ queue: { items: [] } }).result === 'idle', 'queue-empty');
  check(rec({ queue: { items: [queueDoc.items[0]] } }).reason === 'ci-waiting' && rec({ queue: { items: [queueDoc.items[0]] } }).landing?.pr === 686, 'ci-waiting, with the PR being landed');
  check(rec({ queue: { items: [queueDoc.items[3]] } }).reason === 'conflict', 'conflict');
  check(rec({ queue: queueDoc, at: queueDoc.at }).result === 'landed' && rec({ queue: queueDoc, at: queueDoc.at }).merged.join() === '683', 'landed: only this run\'s merges count');
  check(A.REASONS.every((r) => A.REASON_TEXT[r]), 'every reason has its sentence');
  for (let i = 0; i < 9; i++) recordRun(s, rec({ queue: { items: [] } }), 3);
  check(readRuns(s, 100).length <= 6, `the runs log is trimmed (${readRuns(s, 100).length} kept with keep=3)`);
  check(status(s).reason === 'queue-empty' && status(s).enabled === true, 'status.json carries the last run and the switch');

  // ---------------------------------------------------------------- 4. the landing line
  console.log('landing line');
  writeFileSync(join(dir, 'merge-queue.json'), JSON.stringify(queueDoc));
  let rows = lineOf(s);
  check(rows.map((r) => r.pr).join() === '686,633,637,640' && rows[0].position === 1, 'in queue order, numbered');
  check(rows[3].conflict === true && rows[1].conflict === false, 'conflict state per PR');
  let r = await act(s, 'move-up', 637);
  check(readQueueControl(s).order.slice(0, 3).join() === '686,637,633', 'move up: one place forward');
  r = await act(s, 'move-down', 686);
  check(readQueueControl(s).order[1] === 686, 'move down: one place back');
  threw = ''; try { await act(s, 'skip', 640, { why: 'waits for PR 637' }); } catch (e) { threw = e.message; }
  check(/needs confirm/.test(threw), 'skip without confirm is refused');
  threw = ''; try { await act(s, 'skip', 640, { confirm: true }); } catch (e) { threw = e.message; }
  check(/needs a reason/.test(threw), 'skip without a reason is refused');
  r = await act(s, 'skip', 640, { why: 'waits for PR 637', confirm: true });
  rows = lineOf(s);
  check(rows.find((x) => x.pr === 640)?.skipped?.why === 'waits for PR 637' && rows[rows.length - 1].pr === 640, 'skip: remembered with its reason, last in the line');
  await act(s, 'unskip', 640);
  check(!lineOf(s).find((x) => x.pr === 640)?.skipped, 'unskip: back in the line');
  let started = 0;
  r = await act(s, 'land-now', 637, { confirm: true, runNow: () => { started++; return { started: true }; } });
  check(readQueueControl(s).order[0] === 637 && started === 1 && r.run.started, 'land now: to the head and a run starts');
  threw = ''; try { await act(s, 'land-now', 999, { confirm: true, runNow: () => ({}) }); } catch (e) { threw = e.message; }
  check(/not in the landing line/.test(threw), 'a PR not in the line is refused');

  // CLI gives the same answer as the core
  const logs = []; const orig = console.log; console.log = (x) => logs.push(x);
  try { await landerMain(['status', '--json'], { s }); await landerMain(['line', '--json'], { s }); } finally { console.log = orig; }
  check(JSON.parse(logs[0]).mode === status(s).mode && JSON.parse(logs[1]).line.length === lineOf(s).length, 'the CLI prints the same status and line as the core');
  // ---------------------------------------------------------------- 5. the cron (replaces the axf-lander unit watch)
  console.log('cron health and heal');
  const cron = join(dir, 'cron.d'); mkdirSync(cron);
  let h = cronHeal(s, { cronDir: cron, dir: '/opt/axf' });
  const text = readFileSync(join(cron, 'axf-auto-land'), 'utf8');
  check(h.healed && text.includes(A.cronLine('/opt/axf')) && text.includes('flock -n /run/axf-auto-land.lock'), 'a missing cron line is put back, the same line install-console.sh writes');
  check(!cronHeal(s, { cronDir: cron }).healed, 'a present line is left alone');
  writeFileSync(healFile(s), '{}');
  check(cronHeal(s, { cronDir: cron }).healed && !existsSync(healFile(s)), "the console's Auto fix request reinstalls it once");
  const now = Date.parse('2026-11-15T05:00:00Z');
  check(A.cronHealth({ last: null, now }).autoFix === true, 'no run yet: warn, Auto fix');
  check(A.cronHealth({ last: { finishedAt: '2026-11-15T04:30:00Z', result: 'idle' }, now }).status === 'warn', 'last run 30 min ago: warn');
  check(A.cronHealth({ last: { finishedAt: '2026-11-15T04:58:00Z', result: 'landing', landing: { pr: 633 } }, now }).status === 'ok', 'fresh run: ok');
} finally { rmSync(dir, { recursive: true, force: true }); }

console.log(`\n${ok} passed, ${bad} failed`);
if (bad) process.exitCode = 1;

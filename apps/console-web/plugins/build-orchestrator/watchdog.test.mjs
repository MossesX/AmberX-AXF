// Self-test: node apps/console-web/plugins/build-orchestrator/watchdog.test.mjs
// The running-builds watchdog: classifier and actions on fake tmux / process / log state, then one check end to end on
// a scratch store with fake tmux sessions (AXF_SLOTS_TMUX is not off, so a fake `tmux` on PATH answers).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as W from './watchdog-core.mjs';
import * as P from './pipeline-core.mjs';
import { render } from '../../../../deploy/claude-stream.mjs';
import { hitOf } from '../../../../deploy/claude-workers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
let n = 0; const t = (name, fn) => { try { fn(); } catch (e) { console.error(`✗ ${name}`); throw e; } n += 1; };
const NOW = Date.parse('2026-11-09T01:00:00.000Z');
const min = (m) => NOW - m * 60e3;
const S = W.WATCHDOG_DEFAULTS;
const AUTH_TAIL = '\x1b[36m▸ Bash: npm test\x1b[0m\nFailed to authenticate: OAuth session expired and could not be refreshed\n\x1b[31m■ success\x1b[0m · 501 s · 37 turns\n';
const obs = (o = {}) => ({ id: 'b1', stepsLeft: 3, phaseSwitch: false, sessions: [], procs: 0, ended: false, slotQueued: false, log: null, lastEnd: null, lastSignMs: min(60), ...o });

// ---------------- log reading
t('auth failure: Claude\'s own line, not a tool echo', () => {
  assert.equal(W.authFailed(AUTH_TAIL), true);
  assert.match(W.authLine(AUTH_TAIL), /^Failed to authenticate: OAuth session expired/);
  assert.equal(W.authFailed('\x1b[36m▸ Bash: grep "Failed to authenticate" */*.log\x1b[0m\n  ↳ Failed to authenticate: x\n'), false);
  assert.equal(W.authFailed('■ done · 10 s\nall good'), false);
});
t('endLabel: done / error (an error result printed as "success") / none', () => {
  assert.equal(W.endLabel('x\n\x1b[1m■ done\x1b[0m · 1 s'), 'done');
  assert.equal(W.endLabel(AUTH_TAIL), 'error');
  assert.equal(W.endLabel('▸ Bash: ls'), '');
});
t('sessions: axf-<id> and axf-<id>--<agent>, not a longer id', () => {
  assert.deepEqual(W.sessionsOf('b1', ['axf-b1', 'axf-b1--sully', 'axf-b12', 'axf-b1-r2--earl']), ['axf-b1', 'axf-b1--sully']);
  assert.equal(W.idOfSession('axf-notes-tasks-calendar--earl'), 'notes-tasks-calendar');
  assert.equal(W.idOfSession('axf-x.modules'), 'x.modules');
  assert.equal(W.idOfSession('axf-signin-account-1'), '');
  assert.equal(W.idOfSession('molly'), '');
});

// ---------------- classify
t('alive and writing: ok; alive and silent past stallMin: stalled', () => {
  assert.equal(W.classify(obs({ procs: 1, log: { mtimeMs: min(1), tail: '' } }), S, NOW).kind, 'ok');
  assert.equal(W.classify(obs({ sessions: ['axf-b1'], log: { mtimeMs: min(2), tail: '' } }), S, NOW).kind, 'ok');
  const f = W.classify(obs({ sessions: ['axf-b1'], procs: 1, log: { mtimeMs: min(45), tail: '' } }), S, NOW);
  assert.equal(f.kind, 'stalled'); assert.match(f.why, /45 min/);
  assert.equal(W.classify(obs({ sessions: ['axf-b1'], procs: 1, log: { mtimeMs: min(45), tail: '' } }), { ...S, watchdogStallMin: 60 }, NOW).kind, 'ok');
});
t('a pane lingering after claude ended is not alive', () => {
  const f = W.classify(obs({ sessions: ['axf-b1--sully'], ended: true, lastEnd: { exit: 0, at: new Date(min(1)).toISOString() }, log: { mtimeMs: min(1), tail: '■ done' } }), S, NOW);
  assert.equal(f.kind, 'waiting');
});
t('waiting in agent slots: ok', () => assert.equal(W.classify(obs({ slotQueued: true }), S, NOW).kind, 'ok'));
t('every step done, nothing runs: finished', () => assert.equal(W.classify(obs({ stepsLeft: 0 }), S, NOW).kind, 'finished'));
t('log ends on a dead login: auth (even with exit 0)', () => {
  const f = W.classify(obs({ lastEnd: { exit: 0, at: new Date(min(30)).toISOString() }, log: { mtimeMs: min(30), tail: AUTH_TAIL } }), S, NOW);
  assert.equal(f.kind, 'auth'); assert.match(f.why, /dead Claude login/);
});
t('clean end with steps left: waiting, or phase-done when the next step is on another model', () => {
  const end = { lastEnd: { exit: 0, at: new Date(min(5)).toISOString() }, log: { mtimeMs: min(5), tail: '■ done · 1 s' } };
  assert.equal(W.classify(obs(end), S, NOW).kind, 'waiting');
  assert.equal(W.classify(obs({ ...end, phaseSwitch: true }), S, NOW).kind, 'phase-done');
});
t('non-zero exit: crashed at once', () => {
  const f = W.classify(obs({ lastEnd: { exit: 137, at: new Date(min(1)).toISOString() } }), S, NOW);
  assert.equal(f.kind, 'crashed'); assert.match(f.why, /exit 137/);
});
t('no trace: ok while recent (grace = stallMin), crashed after', () => {
  assert.equal(W.classify(obs({ lastSignMs: min(5) }), S, NOW).kind, 'ok');
  const f = W.classify(obs({ lastSignMs: min(90) }), S, NOW);
  assert.equal(f.kind, 'crashed'); assert.match(f.why, /90 min ago/);
});
t('no trace for over a day: stale → back to Pending, not relaunched', () => {
  const f = W.classify(obs({ lastSignMs: min(3 * 1440) }), S, NOW);
  assert.equal(f.kind, 'stale'); assert.match(f.why, /3 days ago/);
  assert.match(W.classify(obs({ lastSignMs: 0 }), S, NOW).why, /never on this VPS/);
  const a = W.decide(f, { title: 'B1', retries: 0, maxRetries: 2 }); assert.equal(a.status, 'pending'); assert.equal(a.retry, false);
});

// ---------------- decide
const ctx = (o = {}) => ({ title: 'B1', account: 'account-1', retries: 0, maxRetries: 2, healthy: true, sessions: ['axf-b1--earl'], ...o });
t('ok → nothing', () => assert.equal(W.decide({ id: 'b1', kind: 'ok', why: '' }, ctx()), null));
t('finished → built, complete when merged', () => {
  assert.equal(W.decide({ id: 'b1', kind: 'finished', why: 'x' }, ctx()).status, 'built');
  assert.equal(W.decide({ id: 'b1', kind: 'finished', why: 'x' }, ctx({ mergedAt: '2026-11-09T00:00:00Z' })).status, 'complete');
});
t('waiting → pending; phase-done → queued; neither counts a retry', () => {
  const w = W.decide({ id: 'b1', kind: 'waiting', why: 'x' }, ctx()); assert.equal(w.status, 'pending'); assert.equal(w.retry, false);
  const p = W.decide({ id: 'b1', kind: 'phase-done', why: 'x' }, ctx()); assert.equal(p.status, 'queued'); assert.equal(p.retry, false);
});
t('auth: account off the worker list; requeued when another account has room, else blocked; Brett told to sign in', () => {
  const a = W.decide({ id: 'b1', kind: 'auth', why: 'dead' }, ctx());
  assert.equal(a.status, 'queued'); assert.equal(a.retry, true); assert.equal(a.markAuth, 'account-1'); assert.match(a.alert.body, /Sign account-1 in/); assert.equal(a.alert.severity, 'error');
  const b = W.decide({ id: 'b1', kind: 'auth', why: 'dead' }, ctx({ healthy: false }));
  assert.equal(b.status, 'blocked'); assert.equal(b.markAuth, 'account-1'); assert.match(b.note, /blocked/);
  assert.equal(W.decide({ id: 'b1', kind: 'auth', why: 'dead' }, ctx({ retries: 2 })).status, 'blocked');
});
t('crashed / stalled: relaunch through the Queue up to maxRetries, then failed; stalled kills its session', () => {
  const c = W.decide({ id: 'b1', kind: 'crashed', why: 'x' }, ctx({ retries: 1 }));
  assert.equal(c.status, 'queued'); assert.equal(c.retry, true); assert.deepEqual(c.kill, []); assert.match(c.note, /2\/2/);
  assert.equal(W.decide({ id: 'b1', kind: 'crashed', why: 'x' }, ctx({ retries: 2 })).status, 'failed');
  const s = W.decide({ id: 'b1', kind: 'stalled', why: 'x' }, ctx());
  assert.equal(s.status, 'queued'); assert.deepEqual(s.kill, ['axf-b1--earl']);
  const z = W.decide({ id: 'b1', kind: 'stalled', why: 'x' }, ctx({ maxRetries: 0 })); assert.equal(z.status, 'failed'); assert.deepEqual(z.kill, ['axf-b1--earl']);
});
t('strays: a live session whose build is pending / queued / failed is fixed; built or running builds are left', () => {
  const builds = [{ id: 'a', status: 'queued' }, { id: 'b', status: 'running' }, { id: 'c', status: 'built' }, { id: 'd', status: 'failed', deleted: true }];
  assert.deepEqual(W.strays([{ id: 'a', session: 'axf-a--x' }, { id: 'b', session: 'axf-b' }, { id: 'c', session: 'axf-c' }, { id: 'd', session: 'axf-d' }, { id: 'zz', session: 'axf-zz' }], builds), [{ id: 'a', session: 'axf-a--x', was: 'queued' }]);
});
t('settings: watchdog keys in pipeline-settings@1 with limits', () => {
  const s = P.normSettings({});
  assert.equal(s.watchdogOn, true); assert.equal(s.watchdogEverySec, 60); assert.equal(s.watchdogStallMin, 20); assert.equal(s.watchdogMaxRetries, 2);
  const c = P.normSettings({ watchdogOn: false, watchdogEverySec: 5, watchdogStallMin: 9999, watchdogMaxRetries: 9 });
  assert.equal(c.watchdogOn, false); assert.equal(c.watchdogEverySec, 60); assert.equal(c.watchdogStallMin, 240); assert.equal(c.watchdogMaxRetries, 5);
  const a = P.alertFor('watchdog', { id: 'b1', severity: 'error', title: 'x', body: 'y' }); assert.equal(a.key, 'pipeline:watchdog:b1'); assert.equal(a.severity, 'error');
});
t('the stream says failed, never success, for an error result and a dead login', () => {
  assert.match(render({ type: 'result', subtype: 'success', is_error: true, result: 'Failed to authenticate: OAuth session expired' })[0], /failed \(login\)/);
  assert.match(render({ type: 'result', subtype: 'success', is_error: true, result: 'boom' })[0], /■ failed/);
  assert.match(render({ type: 'result', subtype: 'success', is_error: false, result: 'ok' })[0], /■ done/);
  assert.equal(hitOf(AUTH_TAIL, 0), 'auth');
  assert.equal(hitOf('▸ Bash: grep "Failed to authenticate" x', 0), '');
});

// ---------------- end to end: a scratch store, a fake tmux, fake logs and events
{
  const tmp = mkdtempSync(join(tmpdir(), 'axf-watchdog-'));
  const bin = join(tmp, 'bin'); mkdirSync(bin);
  const sessFile = join(tmp, 'sessions'); const killed = join(tmp, 'killed');
  // list-panes prints the fake sessions; kill-session records the name
  writeFileSync(join(bin, 'tmux'), `#!/bin/sh\ncase "$1" in\n list-panes) cat "${sessFile}" ;;\n kill-session) echo "$3" >> "${killed}" ;;\n has-session) exit 1 ;;\nesac\nexit 0\n`); chmodSync(join(bin, 'tmux'), 0o755);
  writeFileSync(sessFile, 'axf-live--earl|111|1793000000\naxf-stray|222|1793000000\n');
  const wt = join(tmp, 'wt'); const hdir = join(tmp, 'headless'); mkdirSync(hdir);
  const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
  const step = (id, model, done = false) => ({ id, text: `${id} work`, model, estimate: '20 min', done, doneAt: done ? iso(90) : '' });
  const mk = (id, status, steps, extra = {}) => ({ id, title: id, status, steps, createdAt: iso(200), updatedAt: iso(120), notes: [], profiles: ['all'], ...extra });
  const builds = [
    mk('live', 'running', [step('s1', 'Opus')]),
    mk('done', 'running', [step('s1', 'Opus', true)]),
    mk('authdead', 'running', [step('s1', 'Opus')]),
    mk('ghost', 'running', [step('s1', 'Opus')]),
    mk('ghost2', 'running', [step('s1', 'Opus')]),
    mk('stray', 'queued', [step('s1', 'Opus')]),
  ];
  const events = [];
  for (const id of ['live', 'authdead']) {
    mkdirSync(join(wt, id), { recursive: true });
    events.push({ event: 'session-start', session: `axf-${id}--earl`, name: id, model: 'opus', log: join(wt, id, `${id}.log`), at: iso(30) });
  }
  writeFileSync(join(wt, 'live', 'live.log'), '▸ Bash: ls\n');
  writeFileSync(join(wt, 'authdead', 'authdead.log'), AUTH_TAIL);
  events.push({ event: 'session-login', session: 'axf-authdead--earl', name: 'authdead', account: 'account-1', at: iso(30) });
  events.push({ event: 'session-end', session: 'axf-authdead--earl', name: 'authdead', exit: 0, at: iso(20) });
  writeFileSync(join(hdir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
  const storeDir = join(tmp, 'store'); mkdirSync(storeDir);
  const pipe = join(tmp, 'pipe'); mkdirSync(pipe);
  const workersDir = join(tmp, 'workers'); const accountsDir = join(tmp, 'accounts');
  for (const d of [workersDir, accountsDir, join(tmp, 'claude-home'), join(tmp, 'slots')]) mkdirSync(d, { recursive: true });
  for (const name of ['account-1', 'account-2']) { mkdirSync(join(accountsDir, name)); writeFileSync(join(accountsDir, name, '.credentials.json'), '{}'); }
  writeFileSync(join(workersDir, 'workers.json'), JSON.stringify({ workers: ['account-1', 'account-2'] }));
  writeFileSync(join(tmp, 'claude.json'), '{}');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, AXF_WATCHDOG_PROC: 'off', AXF_PIPELINE_WORKTREES: wt, AXF_HEADLESS_DIR: hdir, AXF_PIPELINE_DIR: pipe, AXF_PIPELINE_CONSOLE: 'off',
    AXF_BUILDS_STORE: join(storeDir, 'store.json'), AXF_BUILD_HOOKS: 'off', AXF_BUILDS_LIVE: '0', AXF_DATA_DIR: 'off', AXF_BUILD_PROFILE: 'all', AXF_SLOTS_DIR: join(tmp, 'slots'), AXF_SLOTS_MEM_GB: '8',
    AXF_CLAUDE_ACCOUNTS: accountsDir, AXF_CLAUDE_SEEN: join(workersDir, 'seen.json'), AXF_CLAUDE_WORKERS: workersDir, AXF_CLAUDE_HOME: join(tmp, 'claude-home'), AXF_CLAUDE_GLOBAL: join(tmp, 'claude.json'),
    AXF_PIPELINE_SETTINGS: JSON.stringify({ watchdogMaxRetries: 1 }) };
  delete env.AXF_SLOTS_TMUX;
  const storeJs = join(ROOT, 'framework/cli/builds-store.mjs');
  const node = (code) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, env, encoding: 'utf8' });
  for (const b of builds) spawnSync(process.execPath, [join(HERE, 'orchestrator.mjs'), 'act', JSON.stringify({ action: 'add', id: b.id, title: b.title, steps: b.steps.map((x) => ({ text: x.text, model: x.model, estimate: x.estimate })) })], { cwd: ROOT, env, encoding: 'utf8' });
  const setAll = (list) => node(`import { withStore } from '${storeJs}'; const L = ${JSON.stringify(list)}; withStore((s) => { for (const x of L) { const b = s.builds.find((y) => y.id === x.id); if (!b) throw new Error('no ' + x.id); b.status = x.status; b.updatedAt = x.updatedAt; b.steps.forEach((st, i) => { st.done = !!x.steps[i]?.done; st.doneAt = x.steps[i]?.doneAt || ''; }); } return s; }, { by: 'test', action: 'seed' });`);
  const seed = setAll(builds);
  const seeded = seed.status === 0;
  if (!seeded) console.log(`  (end to end skipped: could not seed a scratch store: ${(seed.stderr || '').trim().split('\n').pop()})`);
  else {
    const run = (...a) => spawnSync(process.execPath, [join(HERE, 'watchdog.mjs'), ...a], { cwd: ROOT, env, encoding: 'utf8' });
    const dry = run('check', '--force', '--dry', '--json');
    assert.equal(dry.status, 0, dry.stderr);
    const d = JSON.parse(dry.stdout.trim().split('\n').pop()).watchdog;
    t('e2e: findings per build', () => {
      const k = Object.fromEntries(d.findings.map((f) => [f.id, f.kind]));
      assert.deepEqual(k, { live: 'ok', done: 'finished', authdead: 'auth', ghost: 'crashed', ghost2: 'crashed' });
      assert.equal(d.marked, 5); assert.equal(d.real, 1);
      assert.ok(d.actions.some((a) => a.id === 'stray' && a.kind === 'stray'));
    });
    const r = run('check', '--force');
    assert.equal(r.status, 0, r.stderr);
    t('e2e: every action logged to the terminal', () => {
      assert.match(r.stdout, /watchdog: done: finished → built/);
      assert.match(r.stdout, /watchdog: authdead: auth → (?:blocked|queued) \(account-1 off the worker list\)/);
      assert.match(r.stdout, /watchdog: ghost: crashed → queued/);
      assert.match(r.stdout, /watchdog: stray: stray → running/);
    });
    t('e2e: store updated, watchdog.json written, retries counted', () => {
      const s = JSON.parse(readFileSync(join(storeDir, 'store.json'), 'utf8'));
      const st = Object.fromEntries(s.builds.map((b) => [b.id, b.status]));
      assert.equal(st.live, 'running'); assert.equal(st.done, 'built'); assert.equal(st.ghost, 'queued'); assert.equal(st.stray, 'running');
      assert.ok(['blocked', 'queued'].includes(st.authdead));
      assert.ok(s.builds.find((b) => b.id === 'ghost').notes.some((x) => /Watchdog: no session/.test(x.text)));
      const w = JSON.parse(readFileSync(join(pipe, 'watchdog.json'), 'utf8'));
      assert.equal(w.retries.ghost.length, 1); assert.ok(w.recent.length >= 4); assert.match(w.summary, /5 marked running, 1 really running/);
    });
    t('e2e: a build relaunched once that dies again fails at maxRetries', () => {
      setAll([{ ...builds.find((b) => b.id === 'ghost'), status: 'running' }]);
      const again = run('check', '--force');
      assert.match(again.stdout, /watchdog: ghost: crashed → failed/);
    });
    t('e2e: interval respected without --force', () => assert.match(run('check').stdout, /skipped: checked \d+ s ago/));
  }
}
console.log(`✓ watchdog: ${n} checks passed`);

#!/usr/bin/env node
/**
 * server-gate tests: one session per build and per worktree (a second launch is refused), duplicate sessions reaped
 * (the oldest kept), the gate log, the banner widget's place, and the merge fix that stopped the dispatcher's double
 * launch (a stale store copy can no longer erase a fresh launch record). Run: node framework/cli/server-gate.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from './server-gate.mjs';
import { mergeBuild, mergeRun, mergeStores } from '../plan/builds-merge-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'server-gate-'));
const sessionsFile = join(tmp, 'sessions.json');
const env = { ...process.env, AXF_GATE_DIR: join(tmp, 'gate'), AXF_GATE_ALERTS: 'off', AXF_GATE_SESSIONS: sessionsFile };
const wt = join(tmp, 'wt-alpha'); mkdirSync(wt); const wt2 = join(tmp, 'wt-beta'); mkdirSync(wt2);
const setSessions = (list) => writeFileSync(sessionsFile, JSON.stringify(list));
setSessions([]);
let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log(`ok ${name}`); };
const alive = (pid) => pid === 4242; // the only live process in these tests
const old = Date.now() - 10 * 60e3;

t('a build launch takes its build and worktree locks; a second launch of the same build is refused and logged', () => {
  const a = G.acquire({ build: 'alpha', worktree: wt, pid: 4242, by: 'dispatcher', env, alive });
  assert.equal(a.ok, true); assert.match(a.owner, /^g_/);
  const b = G.acquire({ build: 'alpha', worktree: wt, pid: 1, by: 'build manager', env, alive });
  assert.equal(b.ok, false); assert.match(b.why, /alpha is already running/); assert.match(b.why, /One session per build/);
  const log = G.readLog({}, env);
  assert.equal(log.counts['duplicate-launch'], 1); assert.equal(log.entries[0].build, 'alpha'); assert.equal(log.entries[0].by, 'build manager'); assert.equal(log.entries[0].action, 'refused the launch');
});

t('another build in the same worktree is refused too (per-worktree lock)', () => {
  const r = G.acquire({ build: 'gamma', worktree: wt, pid: 1, env, alive });
  assert.equal(r.ok, false); assert.match(r.why, /worktree .* is in use by alpha/);
  assert.equal(G.acquire({ build: 'gamma', worktree: wt, env, alive, log: false }).ok, false);
});

t('the same launch (its slot waiter, its inner run) passes with its owner tag and refreshes the lock', () => {
  const lock = G.status({ env, sessions: [] }).find((l) => l.build === 'alpha');
  const owner = JSON.parse(readFileSync(join(env.AXF_GATE_DIR, 'session-locks', `build-alpha.json`), 'utf8')).owner;
  assert.ok(lock);
  assert.equal(G.acquire({ build: 'alpha', worktree: wt, owner, pid: 4242, env, alive }).ok, true);
  G.hold({ build: 'alpha', worktree: wt, owner, session: 'axf-alpha', env });
  assert.equal(G.status({ env, sessions: [] }).find((l) => l.build === 'alpha').session, 'axf-alpha');
  assert.deepEqual(G.release({ build: 'alpha', worktree: wt, owner: 'g_not-the-owner', env }).released, [], 'only the owner releases');
  assert.deepEqual(G.release({ build: 'alpha', worktree: wt, owner, env }).released.sort(), ['build', 'worktree']);
  assert.equal(G.acquire({ build: 'alpha', worktree: wt, pid: 4242, env, alive }).ok, true, 'free again once the session ended');
});

t('a lock whose holder is gone is stale and is taken over', () => {
  const dir = join(env.AXF_GATE_DIR, 'session-locks');
  const f = join(dir, 'build-alpha.json'); const rec = JSON.parse(readFileSync(f, 'utf8'));
  writeFileSync(f, JSON.stringify({ ...rec, pid: 999999, session: 'axf-gone', at: new Date(old).toISOString() }));
  for (const name of ['worktree']) void name;
  const wf = join(dir, (G.status({ env, sessions: [] }).find((l) => l.file.startsWith('worktree-')) ?? {}).file);
  writeFileSync(wf, JSON.stringify({ ...JSON.parse(readFileSync(wf, 'utf8')), pid: 999999, session: 'axf-gone', at: new Date(old).toISOString() }));
  const r = G.acquire({ build: 'alpha', worktree: wt, pid: 4242, env, alive });
  assert.equal(r.ok, true, r.why);
});

t('a live tmux session of the build counts even without a lock (sessions started before the gate)', () => {
  setSessions([{ name: 'axf-beta', cwd: wt2, created: 100, build: '' }]);
  const r = G.acquire({ build: 'beta', worktree: wt2, pid: 4242, env, alive });
  assert.equal(r.ok, false); assert.match(r.why, /beta already has a live session \(axf-beta\)/);
  setSessions([{ name: 'axf-beta', cwd: wt2, created: 100, build: '', ended: true }]);
  assert.equal(G.acquire({ build: 'beta', worktree: wt2, pid: 4242, env, alive }).ok, true, 'a session whose run ended (closing) does not count');
});

t('session names: the build, its timestamped duplicate and its agent session match; another build does not', () => {
  const s = (name, extra = {}) => ({ name, cwd: '', created: 0, build: '', ...extra });
  assert.equal(G.sessionOfBuild(s('axf-alpha'), 'alpha'), true);
  assert.equal(G.sessionOfBuild(s('axf-alpha-031522'), 'alpha'), true);
  assert.equal(G.sessionOfBuild(s('axf-alpha--a7'), 'alpha'), true);
  assert.equal(G.sessionOfBuild(s('axf-alphabet'), 'alpha'), false);
  assert.equal(G.sessionOfBuild(s('axf-x', { build: 'alpha' }), 'alpha'), true);
});

t('the watchdog reaps duplicate sessions and keeps the oldest; each reap is logged', () => {
  setSessions([
    { name: 'axf-delta-031522', cwd: '', created: 300, build: 'delta' },
    { name: 'axf-delta', cwd: '', created: 100, build: 'delta' },
    { name: 'axf-delta--b2', cwd: '', created: 200, build: '' },
    { name: 'axf-solo', cwd: '', created: 50, build: 'solo' },
  ]);
  const dry = G.reap({ builds: ['delta', 'solo'], dry: true, env });
  assert.deepEqual(dry.duplicates, [{ build: 'delta', keep: 'axf-delta', end: ['axf-delta--b2', 'axf-delta-031522'] }]);
  const r = G.reap({ builds: ['delta', 'solo'], env });
  assert.equal(r.duplicates.length, 1);
  assert.deepEqual(JSON.parse(readFileSync(sessionsFile, 'utf8')).map((s) => s.name).sort(), ['axf-delta', 'axf-solo'], 'only the oldest delta session is left');
  const log = G.readLog({ gate: 'duplicate-reaped' }, env);
  assert.equal(log.matched, 2); assert.match(log.entries[0].action, /ended duplicate session .*, kept axf-delta/); assert.equal(log.entries[0].by, 'watchdog');
  assert.equal(G.reap({ builds: ['delta'], env }).duplicates.length, 0, 'nothing left to reap');
});

t('gate log: every gate kind, filters, counts, newest first; unknown gates file as main; survives as a file', () => {
  for (const gate of ['slot-limit', 'dispatch', 'main']) G.record({ gate, build: 'zeta', by: 'test', action: `${gate} hit` }, { env });
  G.record({ gate: 'nonsense', build: 'zeta', by: 'test', action: 'x' }, { env });
  const all = G.readLog({}, env);
  assert.deepEqual(Object.keys(all.counts), [...G.GATES]);
  assert.equal(all.counts.main, 2); assert.equal(all.counts['slot-limit'], 1); assert.equal(all.counts.dispatch, 1);
  assert.equal(all.entries[0].action, 'x');
  assert.equal(G.readLog({ build: 'zeta', gate: 'dispatch' }, env).entries.length, 1);
  assert.equal(G.readLog({ limit: 2 }, env).entries.length, 2);
  assert.ok(readFileSync(G.logFile(env), 'utf8').split('\n').filter(Boolean).every((l) => JSON.parse(l).$axf === G.SCHEMA_LOG));
});

t('CLI: acquire --sh refuses with exit 3; log, gates and banner answer', () => {
  const run = (...a) => spawnSync(process.execPath, [join(HERE, 'server-gate.mjs'), ...a], { env, encoding: 'utf8' });
  setSessions([{ name: 'axf-eta', cwd: '', created: 1, build: 'eta' }]);
  const r = run('acquire', '--sh', '--build', 'eta', '--worktree', tmp);
  assert.equal(r.status, 3); assert.match(r.stdout, /^gate_refused=1\nrefused: eta already has a live session/);
  const ok = run('acquire', '--sh', '--build', 'theta', '--worktree', join(tmp, 'gate'));
  assert.equal(ok.status, 0); assert.match(ok.stdout, /^gate_owner=g_[a-f0-9]+ gate_build=theta$/m);
  const none = run('acquire', '--sh', '--worktree', tmp);
  assert.equal(none.status, 0); assert.match(none.stdout, /^gate_owner= gate_build=$/m, 'not a build: no lock');
  assert.match(run('log').stdout, /Server gate log: \d+ hits/);
  assert.equal(JSON.parse(run('gates', '--json').stdout).gates.length, 5);
  assert.equal(JSON.parse(run('banner', '--json').stdout).place, 'own');
  assert.equal(JSON.parse(run('banner', '--place', 'approvals', '--by', 'voice', '--json').stdout).place, 'approvals');
  assert.equal(G.bannerPlace(env).place, 'approvals'); assert.equal(G.bannerPlace(env).by, 'voice');
  assert.equal(run('banner', '--place', 'bad place!').status, 2);
});

t('dispatcher double launch root cause: a stale session copy no longer erases the fresh launch record', () => {
  const step = (done, at) => ({ uid: 'u1', id: 's1', title: 'one', done, updatedAt: at });
  const base = { id: 'alpha', title: 'Alpha', status: 'queued', notes: [], rev: 1 };
  // the dispatcher launched it (host copy), the session ticked a step later from a worktree copy taken before the launch
  const host = { ...base, status: 'running', updatedAt: '2026-11-12T01:01:00.000Z', rev: 2, steps: [step(false, '2026-11-12T01:00:00.000Z'), { uid: 'u2', id: 's2', title: 'two', done: false, updatedAt: '2026-11-12T01:00:00.000Z' }], pipeline: { account: 'max-a', session: 'axf-alpha', slot: 'hl-1', model: 'Opus', launchedAt: '2026-11-12T01:01:00.000Z', runs: 1 } };
  const session = { ...base, status: 'running', updatedAt: '2026-11-12T01:05:00.000Z', rev: 2, steps: [step(true, '2026-11-12T01:05:00.000Z'), { uid: 'u2', id: 's2', title: 'two', done: false, updatedAt: '2026-11-12T01:00:00.000Z' }], pipeline: { note: 'planned' } };
  const m = mergeBuild(host, session);
  assert.equal(m.steps[0].done, true, 'the tick survives');
  assert.equal(m.pipeline.session, 'axf-alpha'); assert.equal(m.pipeline.slot, 'hl-1'); assert.equal(m.pipeline.launchedAt, host.pipeline.launchedAt); assert.equal(m.pipeline.runs, 1);
  assert.deepEqual(mergeBuild(session, host).pipeline.session, 'axf-alpha', 'either order');
  // the live publish to main and the pull back both go through mergeStores
  const store = (b) => ({ $axf: 'builds@1', rev: 1, builds: [b] });
  assert.equal(mergeStores(store(host), store(session)).store.builds[0].pipeline.session, 'axf-alpha');
  // a run that ended on the host (same launch, session cleared, newer) stays ended
  const ended = { ...host, updatedAt: '2026-11-12T02:00:00.000Z', pipeline: { ...host.pipeline, session: '', slot: '' } };
  assert.equal(mergeBuild(ended, host).pipeline.session, ''); assert.equal(mergeRun(ended.pipeline, host.pipeline), null);
  // a later launch wins over an older run record even when the older copy is newer overall
  const relaunch = { ...host, pipeline: { ...host.pipeline, session: 'axf-alpha', launchedAt: '2026-11-12T03:00:00.000Z', runs: 2 } };
  const staleNewer = { ...ended, updatedAt: '2026-11-12T03:30:00.000Z' };
  assert.equal(mergeBuild(staleNewer, relaunch).pipeline.runs, 2);
});

console.log(`server-gate: ${n} checks passed`);

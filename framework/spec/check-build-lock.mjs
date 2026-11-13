#!/usr/bin/env node
// build-lock@1: one live session per build. Session-name matching, lock freshness and expiry, acquire refusing a double
// dispatch, the launcher's tmux/pid check, and a real claude-like process in a worktree counting as live.
// node framework/spec/check-build-lock.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../cli/build-lock.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = join(ROOT, 'framework/cli/build-lock.mjs');
let n = 0; const t = (name, fn) => { try { fn(); } catch (e) { console.error(`✗ ${name}`); throw e; } n += 1; };
const tmp = mkdtempSync(join(tmpdir(), 'axf-build-lock-'));
const off = { ...process.env, AXF_BUILD_LOCK_TMUX: 'off', AXF_BUILD_LOCK_PIDS: 'off' };

t('session names: axf-<id>, axf-<id>--agent, the -HHMMSS duplicate; never another build', () => {
  for (const s of ['axf-foo', 'axf-foo--paulie', 'axf-foo-201530', 'axf-foo--gina-201530']) assert.ok(L.sessionOf('foo', s), s);
  for (const s of ['axf-foo-bar', 'axf-foo-bar--paulie', 'axf-foobar', 'axt-foo', 'foo', 'axf-foo-2015']) assert.ok(!L.sessionOf('foo', s), s);
  assert.ok(!L.sessionOf('Bad Id', 'axf-Bad Id'));
});
t('tmux sessions are matched per build', () => {
  const env = { ...off, AXF_BUILD_LOCK_TMUX: 'axf-a--earl,axf-a--gina-201500,axf-ab--x,axt-claude-console' };
  assert.deepEqual(L.tmuxSessions('a', env), ['axf-a--earl', 'axf-a--gina-201500']);
  assert.deepEqual(L.tmuxSessions('ab', env), ['axf-ab--x']);
});
t('lock freshness: a heartbeat within LOCK_STALE_MS is fresh, older has expired', () => {
  const now = Date.parse('2026-11-13T20:00:00Z');
  assert.ok(L.lockFresh({ beat: '2026-11-13T19:50:00Z' }, now));
  assert.ok(!L.lockFresh({ beat: '2026-11-13T19:30:00Z' }, now));
  assert.ok(!L.lockFresh(null, now)); assert.ok(!L.lockFresh({ beat: 'nope' }, now));
});
t('double dispatch: the second acquire is refused while the first lock is fresh; a stale lock is replaced', () => {
  const dir = join(tmp, 'wt-a'); mkdirSync(dir);
  const first = L.acquire('a', { dir, account: 'earl', env: off });
  assert.equal(first.build, 'a'); assert.ok(existsSync(join(dir, L.LOCK_FILE)));
  assert.throws(() => L.acquire('a', { dir, account: 'paulie', env: off }), (e) => e.code === 'live' && /already has a live session: lock/.test(e.message));
  // the heartbeat goes stale (the dispatcher died and nobody beat it): the next acquire takes over and records the expiry
  const old = new Date(Date.now() - L.LOCK_STALE_MS - 60e3).toISOString();
  writeFileSync(join(dir, L.LOCK_FILE), JSON.stringify({ ...first, beat: old }));
  const second = L.acquire('a', { dir, account: 'paulie', env: off });
  assert.equal(second.account, 'paulie'); assert.equal(second.expired, old);
});
t('double dispatch: a live tmux session refuses even with no lock; --no-lock ignores the lock only', () => {
  const dir = join(tmp, 'wt-b'); mkdirSync(dir);
  assert.throws(() => L.acquire('b', { dir, env: { ...off, AXF_BUILD_LOCK_TMUX: 'axf-b--gina' } }), (e) => e.code === 'live' && /tmux axf-b--gina/.test(e.message));
  L.acquire('b', { dir, env: off });
  assert.equal(L.liveness('b', { dir, env: off }).live, true);
  assert.equal(L.liveness('b', { dir, env: off, useLock: false }).live, false);
});
t('beat refreshes the heartbeat and keeps the session; release drops only this build\'s lock', () => {
  const dir = join(tmp, 'wt-c'); mkdirSync(dir);
  L.acquire('c', { dir, env: off });
  const b = L.beat('c', { dir, session: 'axf-c--earl' }); assert.equal(b.session, 'axf-c--earl');
  assert.equal(L.beat('c', { dir }).session, 'axf-c--earl');
  assert.equal(L.release('other', { dir }), false); assert.ok(existsSync(join(dir, L.LOCK_FILE)));
  assert.equal(L.release('c', { dir }), true); assert.ok(!existsSync(join(dir, L.LOCK_FILE)));
});
t('CLI: check exits 3 while live, 0 when free', () => {
  const dir = join(tmp, 'wt-d'); mkdirSync(dir);
  const run = (env, ...a) => spawnSync(process.execPath, [CLI, ...a], { env, encoding: 'utf8' });
  assert.equal(run(off, 'check', 'd', '--dir', dir).status, 0);
  const r = run({ ...off, AXF_BUILD_LOCK_TMUX: 'axf-d--paulie' }, 'check', 'd', '--dir', dir, '--json');
  assert.equal(r.status, 3); assert.deepEqual(JSON.parse(r.stdout).sessions, ['axf-d--paulie']);
  assert.equal(run(off, 'acquire', 'd', '--dir', dir).status, 0);
  assert.equal(run(off, 'acquire', 'd', '--dir', dir).status, 3, 'second dispatch refused');
  assert.equal(run(off, 'check', 'd', '--dir', dir, '--no-lock').status, 0);
  assert.equal(run(off, 'release', 'd', '--dir', dir).status, 0);
  assert.equal(run(off, 'check', 'nope!', '--dir', dir).status, 2);
});

// a real process named claude, running in the worktree, counts as a live session (the self-check's pid test)
const dir = join(tmp, 'wt-e'); mkdirSync(dir);
const bin = join(tmp, 'bin'); mkdirSync(bin); const fake = join(bin, 'claude');
writeFileSync(fake, 'setTimeout(() => {}, 30000);\n'); chmodSync(fake, 0o755);
const child = spawn(process.execPath, [fake], { cwd: dir, stdio: 'ignore', env: { ...process.env, AXF_BUILD_ID: 'other' } });
await new Promise((r) => setTimeout(r, 300));
try {
  t('pids: a claude process in the worktree (or carrying AXF_BUILD_ID) is live; the build stays locked', () => {
    if (!existsSync('/proc')) return;
    const pidEnv = { ...process.env, AXF_BUILD_LOCK_TMUX: 'off' };
    const l = L.liveness('e', { dir, env: pidEnv, useLock: false });
    assert.ok(l.pids.includes(child.pid), JSON.stringify(l));
    assert.throws(() => L.acquire('e', { dir, env: pidEnv }), (e) => e.code === 'live' && /claude pid/.test(e.message));
    assert.equal(L.liveness('f', { dir: join(tmp, 'wt-a'), env: pidEnv, useLock: false }).pids.length, 0, 'another worktree: not live');
    assert.equal(L.liveness('e', { dir, env: { ...pidEnv, AXF_BUILD_LOCK_PIDS: 'off' }, useLock: false }).live, false);
  });
} finally { child.kill('SIGKILL'); }

console.log(`build-lock: ${n} checks passed`);

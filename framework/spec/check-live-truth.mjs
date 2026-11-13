#!/usr/bin/env node
/**
 * check-live-truth — live-truth@1: the one source of truth for what runs (Brett, Nov 12 2026: the console showed 15 in
 * progress while the VPS had 8). A killed session leaves the count within seconds; a stale record is never active.
 *
 *   node framework/spec/check-live-truth.mjs
 *
 * Pure rules (framework/plan/live-truth-core.mjs) on fixed facts, the publish / read round trip through a scratch file,
 * and, where tmux is installed, a real axf-* tmux session with a process named `claude`: counted, killed, gone.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'axf-live-truth-'));
process.env.AXF_SLOTS_DIR = join(dir, 'slots');
process.env.AXF_LIVE_TRUTH_FILE = join(dir, 'slots', 'live.json');
process.env.AXF_BUILDS_STORE = join(dir, 'store.json');
process.env.AXF_BUILDS_LIVE = '0';
process.env.AXF_BUILD_HOOKS = 'off';

const core = await import('../plan/live-truth-core.mjs');
const lt = await import('../cli/live-truth.mjs');

let fails = 0; let n = 0;
const check = (ok, what) => { n++; if (!ok) { fails++; console.error(`✗ ${what}`); } };

const now = Date.parse('2026-11-12T03:00:00Z');
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const MIN = 60_000;
const build = (id, extra = {}) => ({ id, title: id, status: 'running', steps: [{ id: 's1', done: false }, { id: 's2', done: false }], pr: '', mergedAt: '', pipeline: { session: '', launchedAt: iso(30 * MIN) }, ...extra });

// ---------------------------------------------------------------- sessions
{
  const tmux = new Map([
    ['axf-alpha--earl', { pid: 11, created: now - 20 * MIN }],
    ['axf-beta-long-build-name-cut-by-the-launc--gina', { pid: 12, created: now - 20 * MIN }],
    ['axf-done--joey', { pid: 13, created: now - 20 * MIN }],
    ['axf-fresh--rhonda', { pid: 14, created: now - 10_000 }],
  ]);
  const claude = (pid) => pid === 11 || pid === 12;
  const slots = [
    { id: 'hl-1', build: 'alpha', name: 'alpha', session: 'axf-alpha--earl', state: 'running', startedAt: iso(20 * MIN) },
    { id: 'hl-2', build: 'killed', name: 'killed', session: 'axf-killed--paulie', state: 'running', startedAt: iso(20 * MIN) },
    { id: 'hl-3', build: 'done', name: 'done', session: 'axf-done--joey', state: 'running', startedAt: iso(20 * MIN) },
  ];
  const builds = [build('alpha'), build('beta-long-build-name-cut-by-the-launcher-at-48'), build('done'), build('killed'), build('fresh')];
  const s = core.liveSessions({ slots, tmux, claude, builds, now });
  const names = s.map((x) => x.session);
  check(names.includes('axf-alpha--earl') && s.find((x) => x.session === 'axf-alpha--earl').build === 'alpha', 'a slot holder whose tmux session runs claude is live, with its build');
  check(!names.includes('axf-killed--paulie'), 'a slot entry whose tmux session is gone (killed) is not live');
  check(!names.includes('axf-done--joey'), 'a tmux session with no claude process (finished, waits to close) is not live');
  const beta = s.find((x) => x.session.startsWith('axf-beta'));
  check(beta && beta.build === 'beta-long-build-name-cut-by-the-launcher-at-48' && !beta.registered, 'an unregistered session is matched to its build by the truncated name');
  check(s.find((x) => x.session === 'axf-fresh--rhonda')?.state === 'starting', 'a session seconds old without claude yet is starting');
  check(core.liveSessions({ slots, tmux: null, claude, builds, now }) === null, 'tmux unseen: no judgement (null)');
  check(core.liveSessions({ slots, tmux, claude: () => null, builds, now }).some((x) => x.session === 'axf-done--joey'), 'claude unknown (no ps): counted, never drop real work');
}

// ---------------------------------------------------------------- builds: stale records are never active
{
  const builds = [
    build('live'),
    build('stale'),
    build('stale-waiting', { status: 'waiting' }),
    build('all-done', { pr: '#9', steps: [{ id: 's1', done: true }] }),
    build('merged', { mergedAt: iso(MIN) }),
    build('just-launched', { pipeline: { session: 'axf-just-launched--earl', launchedAt: iso(30_000) } }),
    build('in-slot-queue'),
    build('queued-one', { status: 'queued' }),
  ];
  const sessions = [{ session: 'axf-live--earl', build: 'live', state: 'running', startedAt: iso(MIN) }];
  const t = core.truth({ at: new Date(now).toISOString(), host: 'h', slots: { cap: 8, queue: [{ id: 'hl-9', build: 'in-slot-queue', name: 'in-slot-queue' }] }, sessions, builds, now });
  const to = Object.fromEntries(t.stale.map((x) => [x.id, x.status]));
  check(t.count === 1 && t.slots.used === 1, `the count is the live sessions only (${t.count})`);
  check(JSON.stringify(t.builds.active.sort()) === JSON.stringify(['in-slot-queue', 'just-launched', 'live']), `active = live session, agent-slots queue, just launched (${t.builds.active})`);
  check(JSON.stringify(to) === JSON.stringify({ stale: 'pending', 'stale-waiting': 'pending', 'all-done': 'built', merged: 'complete' }), `stale records settle: no session -> pending, all steps done -> built, merged -> complete (${JSON.stringify(to)})`);
  for (const id of ['stale', 'stale-waiting', 'all-done', 'merged']) check(core.isActive(t, id) === false, `stale record ${id} is never active`);
  check(core.view(builds[1], t).status === 'pending' && core.view(builds[1], t).stale?.was === 'running', 'view(): a stale record shows its real status, marked stale');
  check(core.view(builds[0], t).status === 'running', 'view(): a live build stays running');
  check(core.view(builds[7], t) === builds[7], 'view(): records that do not claim to run are untouched');
  const unseen = core.truth({ at: new Date(now).toISOString(), sessions: null, builds, now });
  check(!unseen.seen && unseen.stale.length === 0 && core.isActive(unseen, 'stale') === null && core.view(builds[1], unseen) === builds[1], 'unseen VPS: nothing judged stale, records untouched');
}

// ---------------------------------------------------------------- killed session drops from the count (collect + publish + read)
{
  const builds = [build('one'), build('two')];
  const state = { running: [
    { id: 'hl-a', build: 'one', name: 'one', session: 'axf-one--earl', state: 'running', startedAt: iso(10 * MIN) },
    { id: 'hl-b', build: 'two', name: 'two', session: 'axf-two--gina', state: 'running', startedAt: iso(10 * MIN) },
  ], queue: [] };
  const tmux = new Map([['axf-one--earl', { pid: 21, created: now - 10 * MIN }], ['axf-two--gina', { pid: 22, created: now - 10 * MIN }]]);
  const before = lt.publish(lt.collect({ builds, tmux, claude: () => true, state, settings: { maxAgents: 8 }, now: Date.now() })); // wall clock: read() judges freshness by it
  tmux.delete('axf-two--gina'); // kill-session
  const t0 = Date.now();
  const after = lt.publish(lt.collect({ builds, tmux, claude: () => true, state, settings: { maxAgents: 8 }, now: Date.now() })); // wall clock: read() judges freshness by it
  check(before.count === 2 && after.count === 1, `killed session leaves the count on the next look (${before.count} -> ${after.count})`);
  check(after.stale.some((x) => x.id === 'two' && x.status === 'pending') && !after.builds.active.includes('two'), 'its build is a stale record, not active');
  process.env.AXF_SLOTS_TMUX = 'off'; // the console container: no tmux, reads the host's file
  const read = lt.read();
  check(read.source === 'published' && read.fresh && read.count === 1 && Date.now() - t0 < 5000, 'off the host, the published truth says 1 within seconds');
  const f = process.env.AXF_LIVE_TRUTH_FILE; const old = (Date.now() - 120_000) / 1000;
  writeFileSync(f, JSON.stringify({ ...after, at: new Date(Date.now() - 120_000).toISOString() })); utimesSync(f, old, old);
  const aged = lt.read();
  check(aged.seen && !aged.fresh && aged.ageSec >= 100, 'an old published truth is reported not fresh, with its age');
  check(lt.reconcile({ apply: true, t: aged }).applied === false, 'reconcile never writes from an old look');
  rmSync(f, { force: true });
  check(lt.read().seen === false, 'no published truth off the host: seen=false (callers say so, never guess)');
  delete process.env.AXF_SLOTS_TMUX;
}

// ---------------------------------------------------------------- a real tmux session (where tmux exists)
const hasTmux = !spawnSync('tmux', ['-V']).error && process.env.AXF_LIVE_TRUTH_TMUX !== 'off';
if (hasTmux) {
  const bin = join(dir, 'bin'); spawnSync('mkdir', ['-p', bin]);
  const sleepPath = spawnSync('sh', ['-c', 'command -v sleep'], { encoding: 'utf8' }).stdout.trim();
  symlinkSync(sleepPath, join(bin, 'claude'));
  const name = `axf-live-truth-check-${process.pid}--spec`;
  const id = `live-truth-check-${process.pid}`;
  const builds = [build(id)];
  const look = () => lt.collect({ builds, state: { running: [], queue: [] }, settings: { maxAgents: 8 } });
  spawnSync('tmux', ['new-session', '-d', '-s', name, `${join(bin, 'claude')} 120`]);
  let seenRunning = false;
  for (let i = 0; i < 20 && !seenRunning; i++) { seenRunning = look().sessions.some((x) => x.session === name && x.build === id && x.state === 'running'); if (!seenRunning) spawnSync('sleep', ['0.1']); }
  check(seenRunning, 'a real axf-* tmux session running claude is live and names its build');
  spawnSync('tmux', ['kill-session', '-t', `=${name}`]);
  const t0 = Date.now();
  const gone = !look().sessions.some((x) => x.session === name);
  check(gone && Date.now() - t0 < 3000, `killed: gone from the very next look (${Date.now() - t0} ms)`);
  check(look().stale.some((x) => x.id === id), 'killed: its build record is stale (never active)');
} else console.log('  (tmux not installed: the real-session check is skipped)');

rmSync(dir, { recursive: true, force: true });
if (fails) { console.error(`live-truth: ${fails}/${n} checks failed`); process.exit(1); }
console.log(`live-truth: ${n} checks passed`);

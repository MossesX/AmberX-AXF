#!/usr/bin/env node
/**
 * build-limit@1 checks: the hard build limit counts what really runs (claude -p trees, setups, reservations), refuses
 * the N+1st launch, is set by Brett only, the docker args, the slice unit, only Queued builds take slots (dispatch gate,
 * agent-slots, the dispatcher's plan), and deploy/claude-headless.sh end to end: with the soft cap switched off (the
 * incident), launch N, then the N+1st is refused by the VPS (real tmux sessions named axf-limittest-*, a fake claude).
 *   node framework/spec/check-build-limit.mjs
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
process.env.AXF_CREW_SAY ??= 'off'; // group-chat posts (crew-say.mjs) stay out of the real Breakroom

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = mkdtempSync(join(tmpdir(), 'axf-limit-'));
Object.assign(process.env, { AXF_SLOTS_DIR: join(tmp, 'store'), AXF_SLOTS_PREFIX: 'axf-limittest-', AXF_BUILD_LIMIT_ONLY: '^axf-limittest-', AXF_SLOTS_TMUX: 'off', AXF_SLOTS_MEM_GB: '8', AXF_SLOTS_SWAP_MB: '0' });
delete process.env.AXF_BUILD_ID; delete process.env.AXF_DISPATCH_TOKEN; delete process.env.AXF_BUILD_LIMIT;
const L = await import('../cli/build-limit.mjs');
const S = await import('../cli/agent-slots.mjs');
const G = await import('../cli/dispatch-gate.mjs');
let P = null; // the build orchestrator's pipeline core; null once that plugin is uninstalled
P = await import('../../apps/console-web/plugins/build-orchestrator/pipeline-core.mjs'); // axf-plugin:build-orchestrator

let n = 0; let failed = 0;
const ok = (cond, what) => { n++; if (!cond) { failed++; console.error(`FAIL ${what}`); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const throws = (fn, re, what) => { try { fn(); ok(false, `${what}: did not throw`); } catch (e) { ok(re.test(e.message), `${what}: ${e.message}`); } };

// config: defaults, clamps, Brett only
eq(L.normLimit({}).maxBuilds, 8, 'default limit 8');
eq(L.normLimit({ maxBuilds: 999 }).maxBuilds, 64, 'clamps high');
eq(L.normLimit({ maxBuilds: 0 }).maxBuilds, 1, 'clamps low');
eq(L.normLimit({ memoryMaxGb: 4, memoryHighGb: 9 }).memoryHighGb, 4, 'MemoryHigh never above MemoryMax');
eq(L.normLimit({ dockerImages: '(' }).dockerImages, L.DEFAULTS.dockerImages, 'bad image pattern dropped');
throws(() => L.saveLimit({ maxBuilds: 12 }, { by: 'claude' }), /only Brett/, 'a session (no owner) cannot set it');
eq(L.loadLimit().maxBuilds, 8, 'unchanged after the refused set');
eq(L.saveLimit({ maxBuilds: 3, bogus: 1 }, { by: 'brett', owner: true }).maxBuilds, 3, 'Brett sets it');
ok(readFileSync(join(process.env.AXF_SLOTS_DIR, 'build-limit.log.jsonl'), 'utf8').includes('"maxBuilds":[8,3]'), 'the change is journalled');
const cliSet = spawnSync(process.execPath, [join(ROOT, 'framework/cli/build-limit.mjs'), 'set', 'maxBuilds=20'], { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
eq(cliSet.status, 3, 'the CLI without a terminal (a headless session) is refused');
eq(L.loadLimit().maxBuilds, 3, 'and the limit stays');
eq([S.loadSettings().maxAgents, S.loadSettings().hardMax], [3, 3], 'the soft cap is capped at the hard limit');

// what counts
const claude = (pid, ppid, cwd = '/w') => ({ pid, ppid, comm: 'claude', argv: ['claude', '-p', '--model', 'opus'], cwd });
const sh = (pid, ppid) => ({ pid, ppid, comm: 'bash', argv: ['bash'] });
ok(L.isHeadlessClaude(claude(1, 0)), 'claude -p counts');
ok(!L.isHeadlessClaude({ pid: 2, ppid: 0, argv: ['claude'] }), 'interactive claude does not');
ok(L.isHeadlessClaude({ pid: 3, ppid: 0, argv: ['/bin/sh', '/tmp/bin/claude', '-p', 'x'] }), 'a claude script with -p counts');
ok(!L.isHeadlessClaude({ pid: 4, ppid: 0, argv: ['bash', '-c', 'claude -p x'] }), 'a shell running it is not counted twice');
const lim = L.normLimit({ maxBuilds: 3 });
const now = Date.now();
const tm = new Map([['axf-limittest-a', { pid: 100, created: now - 3600e3 }], ['axf-limittest-b', { pid: 200, created: now - 30e3 }], ['axf-limittest-c', { pid: 300, created: now - 3600e3 }]]);
const procs = [sh(100, 1), sh(101, 100), claude(102, 101), claude(103, 102) /* nested */, sh(200, 1), sh(300, 1), claude(400, 1, '/tmp/x'), sh(500, 1)];
const base = { procs, tmux: tm, finished: (nm) => nm === 'axf-limittest-c', now, alive: (p) => procs.some((x) => x.pid === p) };
let c = L.countLive(base, lim, {});
eq(c.items.map((i) => `${i.kind}:${i.name}`), ['session:axf-limittest-a', 'claude:pid 400 in /tmp/x'], 'run mode: one session (nested claude once) and one loose claude');
c = L.countLive(base, lim, { mode: 'launch' });
eq(c.items.map((i) => i.kind), ['session', 'claude', 'setup'], 'launch mode adds the young unfinished session (b); the finished one (c) is not counted');
c = L.countLive(base, lim, { mode: 'launch', self: 'axf-limittest-a' });
eq(c.live, 2, 'self is left out');
const res = [
  { id: 'r1', mode: 'launch', session: 'axf-limittest-b', at: new Date(now).toISOString() },          // its session exists: dropped
  { id: 'r2', mode: 'launch', session: 'axf-limittest-new', at: new Date(now).toISOString() },        // counts
  { id: 'r3', mode: 'run', pid: 101, at: new Date(now).toISOString() },                                // its claude runs: dropped
  { id: 'r4', mode: 'run', pid: 500, session: 'axf-limittest-d', at: new Date(now).toISOString() },  // alive, no claude yet: counts
  { id: 'r5', mode: 'run', pid: 999, at: new Date(now).toISOString() },                                // gone: dropped
  { id: 'r6', mode: 'launch', session: 'axf-limittest-old', at: new Date(now - 3600e3).toISOString() }, // expired
  { id: 'r7', mode: 'launch', pid: 998, session: 'axf-limittest-refused', at: new Date(now).toISOString() }, // launcher gone, no session: dropped
  { id: 'r8', mode: 'launch', pid: 500, session: 'axf-limittest-starting', at: new Date(now).toISOString() }, // launcher alive: counts
];
c = L.countLive({ ...base, reservations: res }, lim, {});
eq(c.keep.map((r) => r.id), ['r2', 'r4', 'r8'], 'reservations: open ones kept; a launch whose launcher died with no session is not (a refused launch never holds a place)');
eq(c.live, 5, 'run mode: session + loose claude + three reservations');
eq(L.decide(c, lim), { ok: false, live: 5, max: 3, free: 0 }, 'over the limit: refused');
// ghosts hold no place: a test stand-in from /tmp/axf-limit-*, a claude whose /tmp folder was deleted; a claude in a deleted build worktree still counts (the reaper judges it), and under `only` (this
// test's own end-to-end run) the stand-ins count as builds
const ghosts = [
  { pid: 600, ppid: 1, comm: 'sh', argv: ['/bin/sh', '/tmp/axf-limit-q1/bin/claude', '-p', 'x'], cwd: '/tmp/axf-limit-q1/a (deleted)' },
  { pid: 601, ppid: 1, comm: 'claude', argv: ['claude', '-p'], cwd: '/tmp/gone (deleted)' },
  { pid: 602, ppid: 1, comm: 'claude', argv: ['claude', '-p'], cwd: '/root/axf-builds/x (deleted)' },
];
c = L.countLive({ procs: ghosts, tmux: new Map(), now, alive: () => true }, lim, { mode: 'launch' });
eq(c.items.map((i) => i.pid), [602], 'ghosts: only the deleted-worktree claude counts; stand-ins and deleted /tmp folders do not');
eq(c.ignored.map((i) => i.pid), [600, 601], 'ghosts: listed as not counted, with why');
ok(/test stand-in/.test(c.ignored[0].why) && /deleted/.test(c.ignored[1].why), `ghosts: why ${JSON.stringify(c.ignored)}`);
eq(L.countLive({ procs: ghosts, tmux: new Map(), now, alive: () => true }, lim, { mode: 'launch', only: /axf-limit-/ }).items.map((i) => i.pid), [600], 'under only (the test itself) its stand-ins count');

// admit: N pass, N+1 refused, under one lock
rmSync(join(process.env.AXF_SLOTS_DIR, 'build-limit-res.json'), { force: true });
const empty = { procs: [], tmux: new Map(), now: Date.now(), alive: () => true };
const got = [1, 2, 3, 4].map((i) => L.admit({ mode: 'launch', session: `axf-limittest-x${i}`, pid: process.pid, facts: { ...empty, now: Date.now() } }));
eq(got.map((g) => g.ok), [true, true, true, false], 'limit 3: three admitted, the fourth refused');
ok(L.release(got[0].id), 'release a reservation');
ok(L.admit({ mode: 'launch', session: 'axf-limittest-x5', facts: { ...empty, now: Date.now() } }).ok, 'a released place is free again');
rmSync(join(process.env.AXF_SLOTS_DIR, 'build-limit-res.json'), { force: true });

// emergency slots: a second pool, counted apart from maxBuilds (orchestrator N + emergency 2), Brett only
{
  eq([L.DEFAULTS.emergencySlots, L.normLimit({}).emergencySlots, L.normLimit({ emergencySlots: 99 }).emergencySlots, L.normLimit({ emergencySlots: 0 }).emergencySlots], [2, 2, 8, 0], 'emergency slots: default 2, clamped, 0 switches the pool off');
  eq(L.normLimit({ emergencySlots: 2, maxBuilds: 4 }).maxBuilds, 4, 'emergency slots never change maxBuilds');
  eq(['axf-limittest-rush--s1', 'rush--s2', 'axf-rush', 'axf-limittest-rush2--s1', 'axf-limittest-other--s1', 'axf-limittest-rushed', ''].map((nm) => L.poolOf(nm, ['rush'])),
    ['emergency', 'emergency', 'emergency', 'builds', 'builds', 'builds', 'builds'], 'pool: a granted build\'s own sessions only (<build> or <build>--<step>)');
  eq(L.poolOf('axf-limittest-rush--s1', []), 'builds', 'pool: no grant, no emergency place');
  throws(() => L.grantEmergency('rush', { by: 'claude' }), /only Brett/, 'a session (no owner) cannot grant an emergency place');
  throws(() => L.grantEmergency('Bad Id', { by: 'brett', owner: true }), /not a build id/, 'a grant needs a build id');
  eq(L.loadEmergency(), [], 'nothing granted after the refusals');
  eq(L.grantEmergency('rush', { by: 'brett', owner: true }).map((g) => [g.id, g.by]), [['rush', 'brett']], 'Brett grants it');
  eq(L.grantEmergency('rush', { by: 'brett', owner: true }).length, 1, 'granting twice keeps one grant');
  ok(readFileSync(join(process.env.AXF_SLOTS_DIR, 'build-limit.log.jsonl'), 'utf8').includes('"granted":"rush"'), 'the grant is journalled');
  // counting: 3 ordinary sessions fill maxBuilds 3; emergency sessions are counted in their own pool
  const t0 = Date.now();
  const tmE = new Map([['axf-limittest-n1', { pid: 100, created: t0 - 3600e3 }], ['axf-limittest-n2', { pid: 200, created: t0 - 3600e3 }], ['axf-limittest-n3', { pid: 300, created: t0 - 3600e3 }], ['axf-limittest-rush--s1', { pid: 400, created: t0 - 3600e3 }]]);
  const prE = [sh(100, 1), claude(101, 100), sh(200, 1), claude(201, 200), sh(300, 1), claude(301, 300), sh(400, 1), claude(401, 400)];
  const fxE = { procs: prE, tmux: tmE, finished: () => false, now: t0, alive: (p) => prE.some((x) => x.pid === p), emergency: ['rush'] };
  const cE = L.countLive(fxE, lim, {});
  eq([cE.live, cE.emergency, cE.items.map((i) => i.pool)], [3, 1, ['builds', 'builds', 'builds', 'emergency']], 'counted apart: 3 in the builds pool, 1 in the emergency pool');
  eq([L.decide(cE, lim).ok, L.decide(cE, lim, 'emergency')], [false, { ok: true, live: 1, max: 2, free: 1 }], 'the builds pool is full, the emergency pool has a place');
  eq(L.countLive({ ...fxE, emergency: [] }, lim, {}).live, 4, 'without the grant the same session counts against maxBuilds');
  // admit: the pool follows the session name; neither pool lends to the other
  rmSync(join(process.env.AXF_SLOTS_DIR, 'build-limit-res.json'), { force: true });
  const fresh = () => ({ ...fxE, now: Date.now(), alive: () => true }); // the launcher of a reservation is this test: alive
  const refusedOrdinary = L.admit({ mode: 'launch', session: 'axf-limittest-n4', pid: process.pid, facts: fresh() });
  eq([refusedOrdinary.ok, refusedOrdinary.pool, refusedOrdinary.live, refusedOrdinary.max], [false, 'builds', 3, 3], 'orchestrator slots busy: an ordinary launch is refused, it never takes an emergency place');
  const e2 = L.admit({ mode: 'launch', session: 'axf-limittest-rush--s2', pid: process.pid, facts: fresh() });
  eq([e2.ok, e2.pool, e2.live, e2.max], [true, 'emergency', 1, 2], 'the emergency build starts anyway, in the emergency pool');
  const e3 = L.admit({ mode: 'launch', session: 'axf-limittest-rush--s3', pid: process.pid, facts: fresh() });
  eq([e3.ok, e3.pool, e3.live, e3.max], [false, 'emergency', 2, 2], 'emergency 2 of 2: the third emergency launch is refused');
  // the ordinary pool empties: an emergency build still may not take one of the orchestrator's places
  const idle = { procs: [sh(400, 1), claude(401, 400)], tmux: new Map([['axf-limittest-rush--s1', { pid: 400, created: t0 - 3600e3 }]]), finished: () => false, now: Date.now(), alive: () => true, emergency: ['rush'] };
  const lent = L.admit({ mode: 'launch', session: 'axf-limittest-rush--s3', pid: process.pid, facts: idle });
  eq([lent.ok, lent.pool, lent.live], [false, 'emergency', 2], 'emergency full with the orchestrator idle: still refused (the pools never lend)');
  rmSync(join(process.env.AXF_SLOTS_DIR, 'build-limit-res.json'), { force: true });
  const u = L.usage({ facts: fresh() });
  eq([u.live, u.max, u.free, u.emergency], [3, 3, 0, { live: 1, max: 2, free: 1 }], 'usage: both pools, each with its own cap');
  eq(JSON.parse(readFileSync(join(process.env.AXF_SLOTS_DIR, 'build-limit-live.json'), 'utf8')).emergency, { live: 1, max: 2 }, 'the snapshot the console reads carries the emergency pool');
  eq(L.saveLimit({ emergencySlots: 0 }, { by: 'brett', owner: true }).emergencySlots, 0, 'Brett can switch the pool off');
  eq(L.admit({ mode: 'launch', session: 'axf-limittest-rush--s2', pid: process.pid, facts: fresh() }).ok, false, 'pool off: no emergency place');
  L.saveLimit({ emergencySlots: 2 }, { by: 'brett', owner: true });
  throws(() => L.saveLimit({ emergencySlots: 6 }, { by: 'claude' }), /only Brett/, 'a session cannot resize the emergency pool');
  ok(L.revokeEmergency('rush', { by: 'test' }) && !L.revokeEmergency('rush'), 'a grant is taken back once');
  eq(L.poolOf('axf-limittest-rush--s1', L.emergencyIds()), 'builds', 'after the revoke its sessions are ordinary again');
  rmSync(join(process.env.AXF_SLOTS_DIR, 'build-limit-res.json'), { force: true });
}

// docker and the slice
eq(L.dockerArgs('node:22', L.normLimit({ dockerCpus: 1.5, dockerMemoryGb: 3 })), ['--cpus=1.5', '--memory=3g', '--memory-swap=3g', '--cgroup-parent=axf-builds.slice'], 'node:22 gets limits and the slice');
eq(L.dockerArgs('mcr.microsoft.com/playwright:v1.48.0', lim).length, 4, 'Playwright too');
eq(L.dockerArgs('postgres:15', lim), [], 'other images untouched');
eq([L.isTestRun({ autoRemove: true, restart: 'no' }), L.isTestRun({ autoRemove: false, restart: 'no', cgroupParent: 'axf-builds.slice' }), L.isTestRun({ autoRemove: false, restart: 'unless-stopped' }), L.isTestRun({ autoRemove: true, restart: 'always' }), L.isTestRun({ autoRemove: false, restart: 'no' })],
  [true, true, false, false, false], 'enforcer: only throwaway test runs get limits, never a service on a node image');
const unit = L.sliceUnit(L.normLimit({ cpuQuotaPct: 400, memoryMaxGb: 12, memoryHighGb: 10 }));
ok(/CPUQuota=400%/.test(unit) && /MemoryMax=12G/.test(unit) && /MemoryHigh=10G/.test(unit), 'slice unit from the config');
const shimBin = join(tmp, 'fakedocker'); mkdirSync(shimBin);
writeFileSync(join(shimBin, 'docker'), '#!/bin/sh\necho "REAL $*"\n'); chmodSync(join(shimBin, 'docker'), 0o755);
const shim = (...a) => spawnSync(join(ROOT, 'deploy/build-limit/docker'), a, { env: { ...process.env, PATH: `${join(ROOT, 'deploy/build-limit')}:${shimBin}:${process.env.PATH}` }, encoding: 'utf8' }).stdout.trim();
const withLimits = shim('run', '--rm', 'node:22', 'npm', 'test');
ok(/^REAL run --cpus=2 --memory=4g --memory-swap=4g( --cgroup-parent=axf-builds\.slice)? --rm node:22 npm test$/.test(withLimits), `docker shim adds limits to node:22: ${withLimits}`);
eq(shim('run', '--rm', '-m', '1g', 'postgres:15'), 'REAL run --rm -m 1g postgres:15', 'docker shim leaves other images alone');
ok(!/--memory=/.test(shim('run', '-m', '2g', 'node:22')), 'docker shim keeps a memory the command set');
eq(shim('ps', '-a'), 'REAL ps -a', 'other docker commands pass through');

// only Queued builds take slots
const rec = (tok) => ({ hash: createHash('sha256').update(tok).digest('hex'), account: 'w', model: 'Opus', at: new Date().toISOString(), used: '' });
ok(G.verdict({ b: { id: 'q', status: 'queued' }, name: 'q', token: 'axd_t', rec: rec('axd_t') }).ok, 'dispatch gate: a Queued build with its token passes');
const pend = G.verdict({ b: { id: 'p', status: 'pending' }, name: 'p', token: 'axd_t', rec: rec('axd_t') });
ok(!pend.ok && /only a Queued build takes a slot/.test(pend.why), 'dispatch gate: a Pending build is refused even with a valid token');
eq([G.still({ build: 'p', store: { builds: [{ id: 'p', status: 'pending' }] } }).ok, G.still({ build: 'r', store: { builds: [{ id: 'r', status: 'running' }] } }).ok, G.still({ name: 'chat-x', store: { builds: [] } }).ok], [false, true, true], 'still: Pending stops, Running and non-builds pass');
// agent-slots: a waiting entry whose build went back to Pending leaves the queue instead of starting
rmSync(join(process.env.AXF_SLOTS_DIR, 'state.json'), { force: true });
const facts = { alive: () => true, hard: false };
const statusOf = { b1: 'queued', b2: 'pending' };
const e1 = S.enqueue({ name: 'b1', build: 'b1' }, { ...facts, mayTake: (b) => statusOf[b] === 'queued' });
const e2 = S.enqueue({ name: 'b2', build: 'b2' }, { ...facts, mayTake: (b) => statusOf[b] === 'queued' });
eq([e1.started, e2.started, e2.reason], [true, false, 'notqueued'], 'agent-slots: the Pending build never takes a slot');
eq(S.status({ ...facts, tmux: new Map() }).queue.length, 0, 'and it is not left waiting');
// the dispatcher's plan: launches only Queued builds, and none past the hard limit
const step = (id) => ({ id, title: id, model: 'Opus', done: false });
const builds = [{ id: 'pend', status: 'pending', steps: [step('s')], pipeline: {} }, { id: 'que', status: 'queued', steps: [step('s')], pipeline: { queuedAt: '2026-11-12T00:00:00Z' } }];
const accounts = [{ name: 'w', kind: 'subscription', usable: true, fable: true, parallel: 5, running: 0, free: 5 }];
const plan = P.plan({ builds, accounts, slots: { free: 5, used: 0, cap: 8 } });
ok(!plan.launches.some((l) => l.id === 'pend'), 'plan: a Pending build is never launched');
const full = P.plan({ builds, accounts, slots: { free: 0, used: 2, cap: 8, hard: { max: 3, live: 3, free: 0 } } });
ok(!full.launches.length && /Builds at once reached \(3\/3 running/.test(full.waits.find((w) => w.id === 'que')?.why ?? ''), `plan: at the hard limit nothing launches: ${JSON.stringify(full.waits)}`);

// the build host: only the machine the enforcer runs on counts its own processes. The console container has `ps` too, and
// counting its (empty) process list as the host's read "0 builds running" while builds ran and overwrote the snapshot.
{
  const hostFile = join(process.env.AXF_SLOTS_DIR, 'build-limit-host.json'); const liveFile = join(process.env.AXF_SLOTS_DIR, 'build-limit-live.json');
  const { hostname } = await import('node:os');
  ok(L.isBuildHost(), 'no marker, own store: this side counts (a fresh host, a test)');
  writeFileSync(hostFile, JSON.stringify({ host: 'the-vps' }));
  eq([L.isBuildHost(), L.hostFacts()], [false, null], 'the marker names another machine: this side never counts its own processes');
  const snap = { $axf: 'build-limit-live@1', at: new Date().toISOString(), host: 'the-vps', live: 5, max: 6, emergency: { live: 1, max: 2 }, items: [{ kind: 'session', pool: 'builds', name: 'axf-x', pid: 1 }] };
  writeFileSync(liveFile, JSON.stringify(snap));
  const u = L.usage();
  eq([u.live, u.source, u.emergency.live, u.items.length], [5, 'snapshot', 1, 1], 'it reads the host\'s snapshot: 5 running, not 0');
  eq(JSON.parse(readFileSync(liveFile, 'utf8')).live, 5, 'and leaves the snapshot alone');
  eq(L.status().live, 5, 'status shows the same count');
  writeFileSync(liveFile, JSON.stringify({ ...snap, at: new Date(Date.now() - 10 * 60e3).toISOString() }));
  eq([L.usage().live, L.usage().source], [null, 'unknown'], 'a stale snapshot is unknown, never zero');
  writeFileSync(hostFile, JSON.stringify({ host: hostname() }));
  ok(L.isBuildHost() && L.hostFacts() !== null, 'the marker names this machine: it counts');
  process.env.AXF_BUILD_LIMIT_HOST = 'off'; ok(!L.isBuildHost(), 'AXF_BUILD_LIMIT_HOST=off overrides'); delete process.env.AXF_BUILD_LIMIT_HOST;
  rmSync(hostFile, { force: true }); rmSync(liveFile, { force: true });
}

// end to end: the real launcher, the soft cap switched off, real tmux, a fake claude. Limit 2: two start, the third is refused.
const hasTmux = !spawnSync('tmux', ['-V']).error && spawnSync('ps', ['-V']).status === 0;
if (hasTmux) {
  L.saveLimit({ maxBuilds: 2 }, { by: 'test', owner: true });
  delete process.env.AXF_SLOTS_TMUX;
  const bin = join(tmp, 'bin'); mkdirSync(bin);
  // the stand-in ends by itself once its folder is gone, this test is gone, or after 3 min: it can never outlive the run
  // (Nov 20 2026: stand-ins waiting on a "go" file in a deleted /tmp/axf-limit-* folder held real build places for hours)
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nd="$PWD"; n=0\nwhile [ ! -f "$d/go" ]; do\n  [ -d "$d" ] || exit 1; kill -0 ${process.pid} 2>/dev/null || exit 1\n  n=$((n + 1)); [ $n -gt 900 ] && exit 1\n  sleep 0.2\ndone\necho '{"type":"result","result":"done"}'\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, AXF_SLOTS: 'off', AXF_WATCH_LIVE: 'off', AXF_AGENT_BOOK: 'off', AXF_OWN_LOGIN: 'off', AXF_WORKERS: 'off', AXF_LOOK_GATE: 'off', AXF_ORIGIN: 'off', AXF_BUILD_SLICE: 'off', AXF_LOGIN_NOTE: 'off', AXF_BUILD_LIMIT_POLL: '1', AXF_BUILD_ID: '', AXF_AGENT: '', AXF_AGENT_NAME: '', HOME: join(tmp, 'home') }; // HOME: the launcher puts ~/.local/bin (the real claude) first on PATH
  mkdirSync(join(tmp, 'home'), { recursive: true });
  const tag = `limittest-${process.pid}`;
  const dirs = {};
  const launch = (k) => { const d = (dirs[k] = join(tmp, k)); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'brief.md'), 'hi'); return spawnSync('bash', [join(ROOT, 'deploy/claude-headless.sh'), '--name', `${tag}-${k}`, '--brief', 'brief.md', '--log', 'run.log', '--', '--model', 'opus'], { cwd: d, env, encoding: 'utf8', timeout: 60_000 }); };
  const until = async (fn, ms = 30_000) => { const t = Date.now() + ms; while (Date.now() < t) { if (fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
  const live = () => L.usage().live;
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  // every process started from this test's sandbox: a stand-in claude (argv) or anything with its cwd there
  const sandboxProcs = (under = tmp) => (spawnSync('ps', ['-e', '-o', 'pid=,args='], { encoding: 'utf8' }).stdout || '').split('\n').map((l) => /^\s*(\d+)\s+(.*)$/.exec(l)).filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), args: m[2] })).filter((p) => p.pid !== process.pid && (p.args.includes(under) || (() => { try { return readlinkSync(`/proc/${p.pid}/cwd`).startsWith(under); } catch { return false; } })()));
  try {
    const a = launch('a');
    ok(a.status === 0 && /^started axf-limittest-/m.test(a.stdout), `first launch starts: ${a.stdout}${a.stderr}`);
    ok(await until(() => live() === 1 && L.usage().items.some((i) => i.kind === 'session')), `its claude -p counts: ${JSON.stringify(L.usage().items)}`);
    const b = launch('b');
    ok(b.status === 0 && /^started axf-limittest-/m.test(b.stdout), `second launch starts: ${b.stdout}${b.stderr}`);
    ok(await until(() => L.usage().items.filter((i) => i.kind === 'session').length === 2), `both run: ${JSON.stringify(L.usage().items)}`);
    const c3 = launch('c');
    eq(c3.status, 3, `N+1: the third launch is refused (exit 3): ${c3.stdout}${c3.stderr}`);
    ok(/VPS hard build limit is reached \(2\/2/.test(c3.stdout), `and says why: ${c3.stdout}`);
    ok(spawnSync('tmux', ['has-session', '-t', `=axf-${tag}-c`]).status !== 0, 'no session was started for it');
    const direct = spawnSync(process.execPath, [join(ROOT, 'framework/cli/build-limit.mjs'), 'admit', '--mode', 'run', '--session', 'axf-limittest-direct'], { env, encoding: 'utf8' });
    eq(direct.status, 3, 'a direct claude -p launcher asking the gate is refused too');
    writeFileSync(join(dirs.a, 'go'), '');
    ok(await until(() => L.usage({ mode: 'run' }).items.filter((i) => i.kind === 'session').length === 1), 'one finished: one place free');
    for (const s of [`axf-${tag}-a`]) spawnSync('tmux', ['kill-session', '-t', `=${s}`]);
    ok(await until(() => live() === 1), `after it closes the count drops: ${JSON.stringify(L.usage().items)}`);
    const c4 = launch('d');
    ok(c4.status === 0 && /^started axf-limittest-/m.test(c4.stdout), `then a new launch starts: ${c4.stdout}${c4.stderr}`);
    // the launcher fix: a killed session ends its quiet claude (bash ran its HUP trap only after the pipeline ended, and
    // nothing in the pipeline got the HUP, so the claude, its pane and its build place stayed)
    const dClaude = () => L.usage({ mode: 'run' }).items.find((i) => i.kind === 'session' && i.name.startsWith(`axf-${tag}-d`))?.pid;
    ok(await until(() => dClaude()), `the fourth run's claude runs: ${JSON.stringify(L.usage().items)}`);
    const dPid = dClaude();
    spawnSync('tmux', ['kill-session', '-t', `=axf-${tag}-d`]);
    ok(await until(() => !alive(dPid), 10_000), `tmux kill-session ends its claude -p (pid ${dPid}), no "go" written`);
    ok(await until(() => !sandboxProcs(dirs.d).length, 10_000), `nothing of the killed session is left: ${JSON.stringify(sandboxProcs(dirs.d))}`);
    writeFileSync(join(dirs.b, 'go'), '');
  } finally {
    for (const k of ['a', 'b', 'c', 'd']) { if (dirs[k] && existsSync(dirs[k])) writeFileSync(join(dirs[k], 'go'), ''); }
    // a session renamed by the launcher is still ours: by prefix
    for (const n of (spawnSync('tmux', ['ls', '-F', '#S'], { encoding: 'utf8' }).stdout || '').split('\n')) if (n.startsWith(`axf-${tag}-`)) spawnSync('tmux', ['kill-session', '-t', `=${n}`]);
    // the folder goes only once nothing runs from it any more (a process left in a deleted folder is a ghost)
    await until(() => !sandboxProcs().length, 10_000);
    for (const p of sandboxProcs()) { try { process.kill(p.pid, 'SIGKILL'); } catch { /* gone */ } }
  }
  ok(!sandboxProcs().length, `no process outlives the test: ${JSON.stringify(sandboxProcs())}`);
} else console.log('(tmux or ps missing: skipped the claude-headless.sh end-to-end checks)');

rmSync(tmp, { recursive: true, force: true });
console.log(`build-limit: ${n - failed}/${n} checks passed`);
if (failed) process.exit(1);

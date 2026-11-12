#!/usr/bin/env node
/**
 * build-limit@1 checks: the hard build limit counts what really runs (claude -p trees, setups, reservations), refuses
 * the N+1st launch, is set by Brett only, the docker args, the slice unit, only Queued builds take slots (dispatch gate,
 * agent-slots, the dispatcher's plan), and deploy/claude-headless.sh end to end: with the soft cap switched off (the
 * incident), launch N, then the N+1st is refused by the VPS (real tmux sessions named axf-limittest-*, a fake claude).
 *   node framework/spec/check-build-limit.mjs
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const P = await import('../../apps/console-web/plugins/build-orchestrator/pipeline-core.mjs');

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
];
c = L.countLive({ ...base, reservations: res }, lim, {});
eq(c.keep.map((r) => r.id), ['r2', 'r4'], 'reservations: open ones kept');
eq(c.live, 4, 'run mode: session + loose claude + two reservations');
eq(L.decide(c, lim), { ok: false, live: 4, max: 3, free: 0 }, 'over the limit: refused');

// admit: N pass, N+1 refused, under one lock
rmSync(join(process.env.AXF_SLOTS_DIR, 'build-limit-res.json'), { force: true });
const empty = { procs: [], tmux: new Map(), now: Date.now(), alive: () => true };
const got = [1, 2, 3, 4].map((i) => L.admit({ mode: 'launch', session: `axf-limittest-x${i}`, pid: process.pid, facts: { ...empty, now: Date.now() } }));
eq(got.map((g) => g.ok), [true, true, true, false], 'limit 3: three admitted, the fourth refused');
ok(L.release(got[0].id), 'release a reservation');
ok(L.admit({ mode: 'launch', session: 'axf-limittest-x5', facts: { ...empty, now: Date.now() } }).ok, 'a released place is free again');
rmSync(join(process.env.AXF_SLOTS_DIR, 'build-limit-res.json'), { force: true });

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
ok(!full.launches.length && /hard build limit reached \(3\/3/.test(full.waits.find((w) => w.id === 'que')?.why ?? ''), `plan: at the hard limit nothing launches: ${JSON.stringify(full.waits)}`);

// end to end: the real launcher, the soft cap switched off, real tmux, a fake claude. Limit 2: two start, the third is refused.
const hasTmux = !spawnSync('tmux', ['-V']).error && spawnSync('ps', ['-V']).status === 0;
if (hasTmux) {
  L.saveLimit({ maxBuilds: 2 }, { by: 'test', owner: true });
  delete process.env.AXF_SLOTS_TMUX;
  const bin = join(tmp, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nwhile [ ! -f "$PWD/go" ]; do sleep 0.2; done\necho \'{"type":"result","result":"done"}\'\n');
  chmodSync(join(bin, 'claude'), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, AXF_SLOTS: 'off', AXF_WATCH_LIVE: 'off', AXF_AGENT_BOOK: 'off', AXF_OWN_LOGIN: 'off', AXF_WORKERS: 'off', AXF_LOOK_GATE: 'off', AXF_ORIGIN: 'off', AXF_BUILD_SLICE: 'off', AXF_LOGIN_NOTE: 'off', AXF_BUILD_LIMIT_POLL: '1', AXF_BUILD_ID: '', AXF_AGENT: '', AXF_AGENT_NAME: '', HOME: join(tmp, 'home') }; // HOME: the launcher puts ~/.local/bin (the real claude) first on PATH
  mkdirSync(join(tmp, 'home'), { recursive: true });
  const tag = `limittest-${process.pid}`;
  const dirs = {};
  const launch = (k) => { const d = (dirs[k] = join(tmp, k)); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'brief.md'), 'hi'); return spawnSync('bash', [join(ROOT, 'deploy/claude-headless.sh'), '--name', `${tag}-${k}`, '--brief', 'brief.md', '--log', 'run.log', '--', '--model', 'opus'], { cwd: d, env, encoding: 'utf8', timeout: 60_000 }); };
  const until = async (fn, ms = 30_000) => { const t = Date.now() + ms; while (Date.now() < t) { if (fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
  const live = () => L.usage().live;
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
    writeFileSync(join(dirs.b, 'go'), ''); if (dirs.d) writeFileSync(join(dirs.d, 'go'), '');
  } finally {
    for (const k of ['a', 'b', 'c', 'd']) { if (dirs[k] && existsSync(dirs[k])) writeFileSync(join(dirs[k], 'go'), ''); spawnSync('tmux', ['kill-session', '-t', `=axf-${tag}-${k}`]); }
  }
} else console.log('(tmux or ps missing: skipped the claude-headless.sh end-to-end checks)');

rmSync(tmp, { recursive: true, force: true });
console.log(`build-limit: ${n - failed}/${n} checks passed`);
if (failed) process.exit(1);

#!/usr/bin/env node
/**
 * land-lock@1 checks: one landing at a time on the VPS. The pure rules (first come first served, re-entrant by token,
 * stale holders and waiters go, the view never shows the token, the pre-push hook's ref test and patch), then the real
 * store across processes: a second lander waits for the first, merge-main waits while someone lands, `run` holds it for
 * a command, and the hook holds it for the life of its `git push` and lets go when that process ends.
 *   node framework/spec/check-land-lock.mjs
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = join(ROOT, 'framework/cli/land-lock.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'axf-landlock-'));
process.env.AXF_SLOTS_DIR = join(tmp, 'store');
delete process.env.AXF_LAND_LOCK_TOKEN;
const LL = await import('../cli/land-lock.mjs');

let n = 0; let failed = 0;
const ok = (c, what) => { n++; if (!c) { failed++; console.error(`FAIL ${what}`); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// ---- pure rules
const t0 = Date.parse('2026-11-18T08:00:00Z');
const facts = (dt = 0, alive = () => true) => ({ now: t0 + dt, host: 'vps', alive });
const st = LL.emptyLock();
const A = LL.request({ who: 'merge queue #1', kind: 'merge-queue', pr: 1, pid: 10, host: 'vps', token: 'ta' }, facts());
const B = LL.request({ who: 'build_land x', kind: 'git-push', pid: 20, host: 'vps', token: 'tb' }, facts());
const C = LL.request({ who: 'console merge #3', kind: 'console', pid: 30, host: 'box', token: 'tc', ttlSec: 300 }, facts());
ok(LL.tryAcquire(st, A, facts()).ok, 'A takes the free lock');
const b1 = LL.tryAcquire(st, B, facts(1000));
eq([b1.ok, b1.position, b1.holder.who], [false, 1, 'merge queue #1'], 'B waits first in line behind A');
eq(LL.tryAcquire(st, C, facts(2000)).position, 2, 'C waits second');
ok(LL.tryAcquire(st, { ...A, id: 'other' }, facts(2500)).reentrant, 're-entrant: the same token passes again (its own git push)');
ok(!LL.freeFor(st, 'tb') && LL.freeFor(st, 'ta'), 'merge-main: not free for others, free for the holder');
ok(LL.releaseLock(st, A.id, facts(3000)), 'A lets go');
ok(!LL.tryAcquire(st, C, facts(3100)).ok, 'C may not jump the line');
ok(LL.tryAcquire(st, B, facts(3200)).ok, 'B, first in line, gets it');
eq(st.waiting.map((w) => w.who), ['console merge #3'], 'C still waits');
// stale: a holder whose process is gone on this host goes; one on another host only by its ttl
LL.tryAcquire(st, C, facts(4000));
eq(LL.tryAcquire(st, C, facts(5000, (pid) => pid !== 20)).ok, true, 'B\'s git push ended: the lock passes to C');
eq(st.history.at(-1).how, 'released: process gone', 'and the history says why');
ok(!LL.tryAcquire(st, A, facts(6000, () => false)).ok, 'a holder on another host is not judged by pid');
ok(LL.tryAcquire(st, A, facts(6000 + 301_000, () => true)).ok, 'but past its ttl it goes');
// waiters that stop polling leave the line
const D = LL.request({ who: 'session d', pid: 40, host: 'vps', token: 'td' }, facts());
LL.tryAcquire(st, D, facts(400_000));
LL.prune(st, facts(400_000 + (LL.DEFAULTS.waiterStaleSec + 5) * 1000));
eq(st.waiting.length, 0, 'a waiter that stopped polling leaves the line');
// the view: no token, a line for people
const v = LL.view(st, facts(400_000));
ok(!JSON.stringify(v).includes('"token"'), 'the view never shows the token');
ok(/^landing lock held by merge queue #1 \(#1\)/.test(LL.sayLock(v)), `sayLock: ${LL.sayLock(v)}`);
// the hook's ref test and the hook patch
ok(LL.pushesMain('refs/heads/x abc refs/heads/main def\n'), 'a push to main is seen');
ok(!LL.pushesMain('refs/heads/x abc refs/heads/claude/x def\n'), 'a branch push is not');
const gate = '#!/bin/sh\n# axf main gate\ninput=$(cat)\ncase "$input" in *" refs/heads/main "*) ;; *) exit 0 ;; esac\nnode gate.mjs\n';
const once = LL.patchHook(gate, '/opt/axf/framework/cli/land-lock.mjs');
eq(LL.patchHook(once, '/opt/axf/framework/cli/land-lock.mjs'), once, 'install-hook is idempotent');
const at = once.indexOf('node "$ll" hook');
ok(at > once.indexOf('input=$(cat)') && at < once.indexOf('node gate.mjs'), 'the lock line runs after reading the refs and before the main gate');
ok(LL.patchHook(gate, ['/opt/axf/x.mjs', '/usr/local/lib/axf/x.mjs']).includes('for f in "/opt/axf/x.mjs" "/usr/local/lib/axf/x.mjs"'), 'the deployed copy is tried first, the installed one after');

// ---- the real store, across processes
const run = (args, o = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...(o.env || {}) }, input: o.input, timeout: 30_000 });
const status = () => JSON.parse(run(['status', '--json']).stdout);
eq(status().free, true, 'empty store: free');
// a child holds it (run -- sleep), a second lander waits and gets it after
const holder = spawn(process.execPath, [CLI, 'run', '--who', 'lander one', '--', 'sh', '-c', 'sleep 1.5'], { env: process.env, stdio: 'ignore' });
const until = async (fn, ms = 10_000) => { const t = Date.now() + ms; while (Date.now() < t) { if (fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
ok(await until(() => status().holder?.who === 'lander one'), 'run holds it while its command runs');
const t1 = Date.now();
const second = await LL.withLandLock({ who: 'lander two', waitSec: 20, pollMs: 100 }, () => status().holder?.who);
ok(second.ok && second.value === 'lander two' && Date.now() - t1 > 500, `the second lander waited, then held it (${Date.now() - t1} ms)`);
await new Promise((r) => holder.on('exit', r));
eq(status().free, true, 'released after');
// merge-main waits while someone lands, then goes; and times out when the landing doesn't end
const h = LL.acquireSync({ who: 'lander three', waitSec: 1 });
ok(h.ok, 'held in this process');
const wf = run(['wait-free', '--wait', '1'], { env: { AXF_LAND_LOCK_TOKEN: '' } });
eq(wf.status, 3, 'wait-free (merge-main) times out while another lander holds it');
eq(run(['wait-free', '--wait', '1']).status, 0, 'but the holder\'s own children pass (re-entrant token)');
const timed = run(['acquire', '--who', 'impatient', '--wait', '1', '--json'], { env: { AXF_LAND_LOCK_TOKEN: '' } });
eq([timed.status, JSON.parse(timed.stdout).holder?.who], [3, 'lander three'], 'acquire times out and says who holds it');
LL.releaseSync(h.id);
eq(run(['wait-free', '--wait', '1'], { env: { AXF_LAND_LOCK_TOKEN: '' } }).status, 0, 'free again: merge-main goes');
// the pre-push hook: a push to main holds it for the life of the git push process (here: a sleeping parent)
const push = spawn('sh', ['-c', `printf 'refs/heads/x a refs/heads/main b\\n' | "${process.execPath}" "${CLI}" hook --pid $$ origin url; sleep 1.5`], { env: { ...process.env, AXF_LAND_LOCK_TOKEN: '' }, stdio: 'ignore' });
ok(await until(() => status().holder?.kind === 'git-push'), 'the hook holds the lock for the git push');
await new Promise((r) => push.on('exit', r));
ok(await until(() => status().free), 'and it goes when the git push process ends');
eq(run(['hook', '--pid', String(process.pid)], { input: 'refs/heads/x a refs/heads/claude/x b\n' }).status, 0, 'a branch push takes nothing');
eq(status().free, true, 'still free');
// install-hook on a copy of the main gate hook
const hooks = join(tmp, 'hooks'); spawnSync('mkdir', ['-p', hooks]); writeFileSync(join(hooks, 'pre-push'), gate);
run(['install-hook', '--hooks', hooks, '--cli', '/opt/axf/framework/cli/land-lock.mjs']);
ok(readFileSync(join(hooks, 'pre-push'), 'utf8') === once, 'install-hook writes the patched hook');

rmSync(tmp, { recursive: true, force: true });
console.log(`land-lock: ${n - failed}/${n} checks passed`);
if (failed) process.exit(1);

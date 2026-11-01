#!/usr/bin/env node
/**
 * agent-slots@1 checks: the cap, queue order, priority, auto-start when a slot frees, finished sessions not counted and
 * closed, the memory guard, settings hot reload, the heavy lock, move up / cancel, and deploy/claude-headless.sh end to
 * end (a fake `claude` in real tmux sessions named axf-slotstest-*, so nothing real is touched).
 *   node framework/spec/check-agent-slots.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = mkdtempSync(join(tmpdir(), 'axf-slots-'));
Object.assign(process.env, { AXF_SLOTS_DIR: join(tmp, 'store'), AXF_SLOTS_TMUX: 'off', AXF_SLOTS_MEM_GB: '8', AXF_SLOTS_SWAP_MB: '0', AXF_SLOTS_PREFIX: 'axf-slotstest-' });
const S = await import('../cli/agent-slots.mjs');

let n = 0; let failed = 0;
const ok = (cond, what) => { n++; if (!cond) { failed++; console.error(`FAIL ${what}`); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const reset = (settings = {}) => { rmSync(process.env.AXF_SLOTS_DIR, { recursive: true, force: true }); S.saveSettings(settings); };
const alive = { alive: () => true };

// settings: defaults, limits, bad rules dropped
reset();
eq([S.loadSettings().maxAgents, S.loadSettings().maxHeavy, S.loadSettings().minFreeGb], [6, 3, 2], 'defaults 6 agents / 3 heavy / 2 GB');
eq(S.normSettings({ maxAgents: 999, minFreeGb: -1 }).maxAgents, 64, 'cap clamps high');
eq(S.normSettings({ minFreeGb: -1 }).minFreeGb, 0, 'floor clamps low');
eq(S.normSettings({ priorityRules: [{ match: '(', level: 'boss' }, { match: 'x', level: 'nope' }, { match: '^vip', level: 'urgent' }] }).priorityRules, [{ match: '^vip', level: 'urgent' }], 'bad rules dropped');
eq([S.levelFor('urgent-fix'), S.levelFor('boss-ask'), S.levelFor('plain'), S.levelFor('plain', 'low')], ['urgent', 'boss', 'normal', 'low'], 'priority rules + explicit');

// cap: the first N start, the rest queue in order
reset({ maxAgents: 2 });
const a = S.enqueue({ name: 'a' }, alive); const b = S.enqueue({ name: 'b' }, alive); const c = S.enqueue({ name: 'c' }, alive); const d = S.enqueue({ name: 'd' }, alive);
eq([a.started, b.started, c.started, d.started], [true, true, false, false], 'cap 2: two start, two queue');
eq([c.position, d.position], [1, 2], 'FIFO positions');
eq(S.status(alive).used, 2, 'used = 2');

// priority: urgent jumps the normal line, boss jumps urgent; FIFO within a level
const u = S.enqueue({ name: 'urgent-x' }, alive); const bs = S.enqueue({ name: 'y', priority: 'boss' }, alive);
eq(S.status(alive).queue.map((q) => q.name), ['y', 'urgent-x', 'c', 'd'], 'boss, urgent, then FIFO');
eq(bs.position, 1, 'boss is first in line');

// claim: a waiting entry can't start until a slot frees; then the first in line starts
eq(S.claim(c.id, {}, alive).started, false, 'no slot, no start');
S.finish(a.id, 0);
eq(S.status(alive).used, 1, 'finished session no longer counts');
eq(S.claim(c.id, {}, alive).started, false, 'c is behind boss and urgent');
eq(S.claim(bs.id, {}, alive).started, true, 'boss takes the freed slot');
eq(S.claim(u.id, {}, alive).started, false, 'cap full again');

// move up / cancel
S.up(d.id);
eq(S.status(alive).queue.map((q) => q.name), ['urgent-x', 'd', 'c'], 'move up past c');
S.up(d.id);
eq(S.status(alive).queue.map((q) => [q.name, q.priority]), [['d', 'urgent'], ['urgent-x', 'urgent'], ['c', 'normal']], 'move up past a higher level takes its priority');
S.cancel(c.id, 'test');
eq(S.claim(c.id, {}, alive).gone, true, 'cancelled entry is gone');
let threw = false; try { S.cancel(c.id); } catch { threw = true; } ok(threw, 'cancel twice refuses');

// auto-start: a waiter blocks until a slot frees
reset({ maxAgents: 1, pollSec: 2 });
const h1 = S.enqueue({ name: 'h1', pid: process.pid });
const h2 = S.enqueue({ name: 'h2', pid: process.pid });
eq([h1.started, h2.started], [true, false], 'one slot');
let started = false;
const w = S.waitFor(h2.id, { pid: process.pid, pollMs: 50 }).then((v) => { started = v; });
await new Promise((r) => setTimeout(r, 200));
ok(!started, 'waiter still waiting');
S.release(h1.id, 0);
await w;
ok(started, 'waiter starts when the slot frees');
eq(S.status().running.map((r) => r.name), ['h2'], 'h2 holds the slot');

// dead processes free their slot (past the start grace); entries of another host stay
reset({ maxAgents: 1 });
const now = Date.now();
const x = S.enqueue({ name: 'x', pid: 999999 }, { ...alive, now: now - 300_000 });
ok(x.started, 'x started');
eq(S.status({ alive: () => false, now }).used, 0, 'dead pid past the grace frees the slot');
const y = S.enqueue({ name: 'y', pid: 999999 }, { alive: () => false, now });
eq(S.status({ alive: () => false, now: now + 1000 }).used, 1, 'young slot counts before it is bound');
process.env.AXF_SLOTS_HOST = 'elsewhere';
eq(S.status({ alive: () => false, now: now + 600_000 }).used, 1, 'another host never drops it');
delete process.env.AXF_SLOTS_HOST;
S.release(y.id);

// memory guard: holds starts under the floor, records a trip, starts when memory is back
reset({ maxAgents: 4, minFreeGb: 2 });
const low = { ...alive, mem: { avail: 1 * 1024 ** 3, swapMb: 0 } };
const m = S.enqueue({ name: 'm' }, low);
eq([m.started, m.reason], [false, 'memory'], 'memory guard holds the start');
eq(S.status(low).guard.tripsLastHour, 1, 'trip recorded');
eq(S.claim(m.id, {}, { ...alive, mem: { avail: 4 * 1024 ** 3, swapMb: 0 } }).started, true, 'starts once memory is back');

// swap: in use since… (systems check reads it)
const sw = S.status({ ...alive, mem: { avail: 8 * 1024 ** 3, swapMb: 900 }, now: 1000 });
eq(sw.swap.since, 1000, 'swap in use since first seen');
eq(S.status({ ...alive, mem: { avail: 8 * 1024 ** 3, swapMb: 900 }, now: 5000 }).swap.since, 1000, 'swap since is kept');
eq(S.status({ ...alive, mem: { avail: 8 * 1024 ** 3, swapMb: 0 }, now: 6000 }).swap.since, null, 'swap back to idle clears it');

// settings hot reload: a new cap applies to the next check with nothing restarted
reset({ maxAgents: 1 });
S.enqueue({ name: 'p' }, alive);
const q2 = S.enqueue({ name: 'q' }, alive);
eq(q2.started, false, 'cap 1 queues q');
writeFileSync(join(process.env.AXF_SLOTS_DIR, 'settings.json'), JSON.stringify({ maxAgents: 3 }));
eq(S.claim(q2.id, {}, alive).started, true, 'raised cap applies on the next claim');
eq(S.status(alive).cap, 3, 'status shows the new cap');

// heavy lock: at most maxHeavy at once
reset({ maxHeavy: 2 });
let inside = 0; let peak = 0;
const job = () => S.withHeavy('t', async () => { inside++; peak = Math.max(peak, inside); await new Promise((r) => setTimeout(r, 80)); inside--; }, { pollMs: 20 });
await Promise.all([job(), job(), job(), job(), job()]);
eq(peak, 2, 'heavy lock caps at 2');
eq(S.status().heavy.used, 0, 'heavy lock released');

// withSlot (the swarm): queues, waits, runs, releases
reset({ maxAgents: 1 });
const holder = S.enqueue({ name: 'holder', pid: process.pid });
let queuedAt = 0;
const ws = S.withSlot({ name: 'swarm-job', kind: 'swarm', pollMs: 30, onQueued: (r) => { queuedAt = r.position; } }, async () => 'ran');
await new Promise((r) => setTimeout(r, 100));
eq(queuedAt, 1, 'swarm job waits for a desk at position 1');
S.release(holder.id);
eq(await ws, 'ran', 'swarm job runs after the slot frees');
eq(S.status().used, 0, 'swarm slot released');

// sweep: finished sessions past the grace are closed; unregistered ones are adopted, finished unregistered closed
reset({ maxAgents: 6, closeFinishedAfterSec: 60 });
const fin = S.enqueue({ name: 'fin' }, alive); S.bind(fin.id, { pid: process.pid, session: 'axf-slotstest-fin' }); S.finish(fin.id, 0);
const kills = [];
const tm = new Map([['axf-slotstest-fin', { pid: process.pid, created: 0 }], ['axf-slotstest-old', { pid: process.pid, created: Date.now() }], ['axf-slotstest-done', { pid: process.pid, created: 0 }]]);
const sweptEarly = S.sweep({ tmux: tm, finished: (n) => n === 'axf-slotstest-done', kill: (n) => kills.push(n), now: Date.now() });
eq(sweptEarly.closed.sort(), ['axf-slotstest-done'], 'grace not over: only the unregistered finished one closes');
eq(sweptEarly.adopted, ['axf-slotstest-old'], 'unregistered running session adopted');
const st1 = S.status({ tmux: new Map([...tm].filter(([k]) => k !== 'axf-slotstest-done')) });
eq(st1.used, 1, 'adopted session counts, the finished one does not');
S.sweep({ tmux: new Map([...tm].filter(([k]) => k !== 'axf-slotstest-done')), finished: () => false, kill: (k) => kills.push(k), now: Date.now() + 61_000 });
ok(kills.includes('axf-slotstest-fin'), 'finished session closed after the grace');

// summary shape for the console
const sm = S.status({ tmux: new Map() });
ok(['used', 'cap', 'queued', 'queue', 'heavy', 'memory', 'guard', 'swap', 'settings'].every((k) => k in sm), 'status has every field the console reads');

// claude-headless.sh end to end: real tmux, fake claude, cap 1
const hasTmux = !spawnSync('tmux', ['-V']).error;
if (hasTmux) {
  reset({ maxAgents: 1, closeFinishedAfterSec: 0, pollSec: 2 });
  delete process.env.AXF_SLOTS_TMUX;
  const bin = join(tmp, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nwhile [ ! -f "$PWD/go" ]; do sleep 0.2; done\necho \'{"type":"result","result":"done"}\'\n');
  chmodSync(join(bin, 'claude'), 0o755);
  const runIn = (name) => { const d = join(tmp, name); mkdirSync(d); writeFileSync(join(d, 'brief.md'), 'hi'); return d; };
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, AXF_WATCH_LIVE: 'off', HOME: process.env.HOME };
  const sh = (cwd, name) => spawnSync('bash', [join(ROOT, 'deploy/claude-headless.sh'), '--name', name, '--brief', 'brief.md', '--log', 'run.log', '--'], { cwd, env, encoding: 'utf8', timeout: 30_000 });
  const d1 = runIn('one'); const d2 = runIn('two');
  const tag = `slotstest-${process.pid}`;
  const r1 = sh(d1, `${tag}-a`);
  ok(/^started axf-slotstest-/m.test(r1.stdout), `first run starts: ${r1.stdout}${r1.stderr}`);
  const r2 = sh(d2, `${tag}-b`);
  ok(/^queued at position 1 \(hl-/m.test(r2.stdout), `second run says queued at position 1: ${r2.stdout}${r2.stderr}`);
  const until = async (fn, ms = 20_000) => { const t = Date.now() + ms; while (Date.now() < t) { if (fn()) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
  ok(await until(() => S.status().running.some((r) => r.state === 'running' && r.session.startsWith('axf-slotstest-'))), 'first run bound its tmux session');
  writeFileSync(join(d1, 'go'), '');
  ok(await until(() => existsSync(join(d2, 'run.log'))), 'queued run starts by itself when the first finishes');
  ok(await until(() => spawnSync('tmux', ['has-session', '-t', `=axf-${tag}-a`]).status !== 0), 'finished session closed by itself');
  ok(existsSync(join(d1, 'run.log')) && /finished|done/.test(readFileSync(join(d1, 'run.log'), 'utf8') + readFileSync(join(d1, 'run.jsonl'), 'utf8')), 'its log is kept');
  writeFileSync(join(d2, 'go'), '');
  ok(await until(() => S.status().used === 0), 'all slots free at the end');
  for (const s of [`axf-${tag}-a`, `axf-${tag}-b`]) spawnSync('tmux', ['kill-session', '-t', `=${s}`]);
} else console.log('(tmux missing: skipped the claude-headless.sh end-to-end checks)');

rmSync(tmp, { recursive: true, force: true });
console.log(`agent-slots: ${n - failed}/${n} checks passed`);
if (failed) process.exit(1);

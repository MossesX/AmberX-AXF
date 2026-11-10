// Self-test: node apps/console-web/plugins/build-orchestrator/stall.test.mjs
// The stall watchdog: what counts as stuck (stall-core.mjs), then the CLI end to end on a scratch store with a fake tick.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from './stall-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
let n = 0; const t = (name, fn) => { try { fn(); } catch (e) { console.error(`✗ ${name}`); throw e; } n += 1; };
const NOW = Date.parse('2026-11-10T23:30:00.000Z');
const ago = (min) => new Date(NOW - min * 60e3).toISOString();
const step = (id, done = false) => ({ id, text: `${id} work`, model: 'Opus', done, skip: false });
const b = (id, status, extra = {}) => ({ id, title: id, status, steps: [step('s1')], notes: [], ...extra });

// ---------------- detect
t('nothing stuck: a build runs, the tick is fresh', () => {
  const f = S.detect({ builds: [b('a', 'running', { pipeline: { session: 'axf-a', launchedAt: ago(30) } }), b('q', 'queued')], tick: { at: ago(1) }, alive: () => true, now: NOW });
  assert.deepEqual(f, []);
});
t('(a) idle: Queue has work and nothing runs', () => {
  const f = S.detect({ builds: [b('q', 'queued')], tick: { at: ago(0.5) }, waits: [{ id: 'q', why: 'no account takes Fable' }], now: NOW });
  assert.equal(f.length, 1); assert.equal(f[0].kind, 'idle'); assert.match(f[0].line, /1 build in the Queue/); assert.match(f[0].line, /no account takes Fable/);
});
t('(a) idle: an Urgent / High Pending build counts, a Normal one does not', () => {
  assert.equal(S.detect({ builds: [b('p', 'pending', { priority: 'P2' })], tick: { at: ago(0) }, now: NOW }).length, 0);
  const f = S.detect({ builds: [b('p', 'pending', { priority: 'P1' })], tick: { at: ago(0) }, now: NOW });
  assert.equal(f[0].kind, 'idle'); assert.match(f[0].line, /Urgent \/ High build in Pending/);
  assert.equal(S.detect({ builds: [b('p', 'pending', { priority: 'P0', steps: [step('s1', true)] })], tick: { at: ago(0) }, now: NOW }).length, 0, 'no open step: nothing to build');
});
t('(b) dead: running with its session gone; unknown (no tmux) and young sessions are not dead', () => {
  const run = (launched, alive) => S.detect({ builds: [b('r', 'running', { pipeline: { session: 'axf-r', account: 'w1', launchedAt: ago(launched) } })], tick: { at: ago(0) }, alive: () => alive, now: NOW });
  const f = run(10, false);
  assert.deepEqual(f.map((x) => x.kind), ['dead']); assert.deepEqual(f[0].ids, ['r']);
  assert.deepEqual(run(10, null), []); assert.deepEqual(run(1, false), []);
  // a dead build with Queue work behind it is also an idle dispatcher
  const g = S.detect({ builds: [b('r', 'running', { pipeline: { session: 'axf-r', launchedAt: ago(10) } }), b('q', 'queued')], tick: { at: ago(0) }, alive: () => false, now: NOW });
  assert.deepEqual(g.map((x) => x.kind), ['dead', 'idle']);
});
t('(c) tick: not finished for 3+ min, with the reason', () => {
  assert.deepEqual(S.detect({ builds: [], tick: { at: ago(2.5) }, now: NOW }), []);
  const f = S.detect({ builds: [], tick: { at: ago(9), error: 'Unterminated string in JSON at position 22' }, now: NOW });
  assert.equal(f[0].kind, 'tick'); assert.match(f[0].line, /9 min: the tick fails: Unterminated/);
  assert.match(S.detect({ builds: [], tick: { at: ago(9), runningMin: 9 }, now: NOW })[0].line, /running for 9 min/);
  assert.match(S.detect({ builds: [], tick: {}, now: NOW })[0].line, /for ever: no tick is running/);
});

// ---------------- decide and spells
t('decide: confirm for 2 min, then fix, then wait RETRY_MIN between rounds; force fixes at once', () => {
  const f = [{ kind: 'idle', key: 'idle', line: 'x' }];
  assert.equal(S.decide([], null, { now: NOW }).action, 'none');
  assert.equal(S.decide([], { since: ago(5) }, { now: NOW }).action, 'clear');
  assert.equal(S.decide(f, null, { now: NOW }).action, 'wait');
  assert.equal(S.decide(f, { since: ago(1) }, { now: NOW }).action, 'wait');
  assert.equal(S.decide(f, { since: ago(3) }, { now: NOW }).action, 'fix');
  assert.equal(S.decide(f, { since: ago(30), lastRound: ago(5) }, { now: NOW }).action, 'wait');
  assert.equal(S.decide(f, { since: ago(30), lastRound: ago(21) }, { now: NOW }).action, 'fix');
  assert.equal(S.decide(f, null, { now: NOW, force: true }).action, 'fix');
});
t('spellFor: opens once, keeps its id and since, gathers keys', () => {
  const s = S.spellFor([{ key: 'idle', line: 'a' }], null, NOW);
  assert.equal(s.since, new Date(NOW).toISOString()); assert.equal(s.rounds, 0);
  const s2 = S.spellFor([{ key: 'tick', line: 'b' }], s, NOW + 60e3);
  assert.equal(s2.id, s.id); assert.equal(s2.since, s.since); assert.deepEqual(s2.keys, ['idle', 'tick']); assert.deepEqual(s2.lines, ['b']);
});
t('autoQueueable: Urgent / High Pending only when the Queue is empty; a handed-back build waits for Brett', () => {
  const p0 = b('u', 'pending', { priority: 'P0' }); const p1 = b('h', 'pending', { priority: 'P1' }); const p2 = b('n', 'pending', { priority: 'P2' });
  const back = b('r', 'pending', { priority: 'P0', pipeline: { lastRun: { outcome: 'returned' } } });
  assert.deepEqual(S.autoQueueable([p0, p1, p2, back]).map((x) => x.id), ['u', 'h']);
  assert.deepEqual(S.autoQueueable([p0, b('q', 'queued')]), []);
});
t('urgentNew: a newly filed P0 build (never queued or run) auto-queues; others wait', () => {
  assert.equal(S.urgentNew(b('u', 'pending', { priority: 'P0' })), true);
  assert.equal(S.urgentNew(b('u', 'pending', { priority: 'P1' })), false);
  assert.equal(S.urgentNew(b('u', 'pending', { priority: 'P0', pipeline: { runs: 1 } })), false);
  assert.equal(S.urgentNew(b('u', 'pending', { priority: 'P0', pipeline: { queuedAt: ago(9) } })), false, 'Brett moved it back: leave it');
  assert.equal(S.urgentNew(b('u', 'pending', { priority: 'P0', steps: [] })), false, 'not split yet');
});
t('missing: a broken store, a stopped cron, the failed fixes', () => {
  const m = S.missing([{ kind: 'tick', error: 'Unterminated string in JSON at position 5' }], [{ fix: 'restart', error: 'exit 1' }]);
  assert.match(m[0], /store\.json\) does not parse/); assert.match(m[1], /Restart the dispatcher failed: exit 1/);
  assert.match(S.missing([{ kind: 'tick', error: '' }])[0], /cron/);
});
t('alertFor: per spell and attempt keys (each reaches the phone), escalation apart', () => {
  const a = S.alertFor('attempt', { spell: 'x', round: 1, fix: 'selfcheck', ok: false, result: 'nothing', still: 'idle' });
  assert.equal(a.key, 'pipeline:stall:x:1:selfcheck'); assert.equal(a.source, 'pipeline'); assert.match(a.title, /tried Pipeline self-check/);
  assert.equal(S.alertFor('fixed', { spell: 'x', what: 'w', by: 'b' }).severity, 'success');
  const e = S.alertFor('escalate', { spell: 'x', what: 'w', needs: ['a key'] });
  assert.equal(e.key, 'pipeline:stall-escalate:x'); assert.equal(e.severity, 'error'); assert.match(e.body, /- a key/);
  assert.throws(() => S.alertFor('nope'));
});
t('notify.json registers both stall types with the keys the alerts use', () => {
  const types = JSON.parse(readFileSync(join(HERE, 'notify.json'), 'utf8')).types;
  const stall = types.find((x) => x.id === 'pipeline.stall'); const esc = types.find((x) => x.id === 'pipeline.stall-escalate');
  assert.ok(S.alertFor('attempt', { spell: 's', round: 1, fix: 'release' }).key.startsWith(stall.match.keyPrefix)); assert.equal(stall.push, true);
  assert.ok(S.alertFor('escalate', { spell: 's' }).key.startsWith(esc.match.keyPrefix)); assert.equal(esc.priority, 'urgent');
  assert.ok(!S.alertFor('escalate', { spell: 's' }).key.startsWith(stall.match.keyPrefix), 'escalation is its own type');
});

// ---------------- end to end: scratch store, fake tick
{
  const tmp = mkdtempSync(join(tmpdir(), 'axf-stall-'));
  const storeFile = join(tmp, 'store.json'); const pipeDir = join(tmp, 'pipeline'); const note = join(tmp, 'notes', 'Automatic fixes', 'Dispatcher stalls.md');
  mkdirSync(pipeDir, { recursive: true });
  const env = { ...process.env, AXF_BUILDS_STORE: storeFile, AXF_BUILD_HOOKS: 'off', AXF_BUILDS_LIVE: '0', AXF_SHIPPED: 'off', AXF_PIPELINE_DIR: pipeDir, AXF_SLOTS_DIR: join(tmp, 'slots'), AXF_SLOTS_TMUX: 'off', AXF_HEADLESS_DIR: join(tmp, 'hl'),
    AXF_CLAUDE_ACCOUNTS: join(tmp, 'no-accounts'), AXF_PIPELINE_CONSOLE: 'off', AXF_PIPELINE_LOG: join(tmp, 'pipeline.log'), AXF_STALL_NOTE: note, AXF_STALL_PS: 'off', AXF_DATA_DIR: 'off', AXF_BUILD_PROFILE: 'all' };
  const run = (file, ...args) => { const r = spawnSync(process.execPath, [join(HERE, file), ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 }); if (r.status !== 0) throw new Error(`${file} ${args.join(' ')} failed (${r.status}):\n${r.stdout}\n${r.stderr}`); return r; };
  const json = (r) => JSON.parse(r.stdout.trim().split('\n').pop());
  const wd = (...a) => json(run('stall-watchdog.mjs', ...a, '--json'));
  const setState = (at) => writeFileSync(join(pipeDir, 'state.json'), JSON.stringify({ at, plan: { waits: [{ id: 'q1', why: 'no account is free' }] } }));
  const store = () => JSON.parse(readFileSync(storeFile, 'utf8'));
  run('orchestrator.mjs', 'act', JSON.stringify({ action: 'add', id: 'q1', title: 'Queued one', steps: [{ text: 'do it', model: 'Opus', estimate: '20 min' }] }));
  run('pipeline.mjs', 'queue', 'q1');
  setState(new Date().toISOString());

  t('e2e: first sight opens a spell and waits (no fix, no alert)', () => {
    const r = wd('run');
    assert.equal(r.action, 'wait'); assert.deepEqual(r.findings.map((f) => f.kind), ['idle']); assert.equal(r.attempts.length, 0); assert.equal(r.alerts.length, 0);
    assert.ok(wd('status').stalled); assert.ok(!existsSync(note), 'no note before a fix round');
  });
  t('e2e: every fix fails → each attempt logged and announced, then one escalation with what is missing', () => {
    env.AXF_STALL_TICK = `echo "pipeline: Unterminated string in JSON at position 9" >&2; exit 1`;
    writeFileSync(env.AXF_PIPELINE_LOG, 'tick 2026-11-10T23:00:00.000Z\npipeline: Unterminated string in JSON at position 9\n');
    setState(new Date(Date.now() - 10 * 60e3).toISOString());
    assert.ok(wd('request').requested);
    const r = wd('run');
    assert.equal(r.action, 'fix'); assert.deepEqual(r.attempts.map((a) => a.fix), S.FIXES);
    assert.ok(r.attempts.every((a) => !a.ok)); assert.match(r.attempts[3].error, /tick failed/);
    assert.equal(r.escalated, true);
    assert.deepEqual(r.alerts.map((a) => a.key.split(':').slice(0, 2).join(':')), ['pipeline:stall', 'pipeline:stall', 'pipeline:stall', 'pipeline:stall', 'pipeline:stall-escalate']);
    const text = readFileSync(note, 'utf8');
    assert.match(text, /^# Automatic fixes: dispatcher stalls/); assert.match(text, /## .* UTC · Builds stalled/); assert.match(text, /- Seen: The dispatcher has not finished a tick/);
    for (const l of Object.values(S.FIX_LABEL)) assert.ok(text.includes(`${l}: `), l);
    assert.match(text, /Every fix failed: told Brett\. Needed: The builds store/);
    // the next round waits RETRY_MIN, and no second escalation
    const again = wd('run'); assert.equal(again.action, 'wait'); assert.equal(again.alerts.length, 0);
  });
  t('e2e: a retry where the restart works → fixed, announced, spell closed, escalation resolved', () => {
    // the fake tick: writes a fresh state and "launches" q1 (running, a session)
    const tick = join(tmp, 'tick.mjs');
    writeFileSync(tick, `import { readFileSync, writeFileSync } from 'node:fs';
const s = JSON.parse(readFileSync(${JSON.stringify(storeFile)}, 'utf8'));
const b = s.builds.find((x) => x.id === 'q1'); b.status = 'running'; b.pipeline = { ...(b.pipeline ?? {}), session: 'axf-q1', account: 'w1', launchedAt: new Date().toISOString() };
writeFileSync(${JSON.stringify(storeFile)}, JSON.stringify(s));
writeFileSync(${JSON.stringify(join(pipeDir, 'state.json'))}, JSON.stringify({ at: new Date().toISOString(), plan: { waits: [] } }));
console.log('tick now\\nsplit 0 · ended none · launched q1 on w1 (Opus)');
`);
    env.AXF_STALL_TICK = `node ${tick}`;
    writeFileSync(env.AXF_PIPELINE_LOG, 'tick 2026-11-10T23:00:00.000Z\n');
    const r = wd('run', '--force');
    assert.equal(r.action, 'fix'); const last = r.attempts.at(-1);
    assert.equal(last.fix, 'restart'); assert.equal(last.ok, true); assert.match(last.result, /launched q1 on w1/);
    assert.ok(r.alerts.some((a) => a.key.endsWith(':fixed'))); assert.equal(r.spell, null);
    const st = wd('status'); assert.equal(st.stalled, false); assert.equal(st.history.at(-1).fixedBy, 'Restart the dispatcher'); assert.equal(st.history.at(-1).escalated, true);
    assert.match(readFileSync(note, 'utf8'), /Fixed by Restart the dispatcher\./);
    assert.equal(store().builds.find((x) => x.id === 'q1').status, 'running');
    assert.equal(wd('run').action, 'none');
    const ps = JSON.parse(run('pipeline.mjs', 'status', '--json').stdout.trim().split('\n').pop());
    assert.equal(ps.stall.stalled, false); assert.equal(ps.stall.last.fixedBy, 'Restart the dispatcher', 'GET /pipeline carries the watchdog');
  });
  t('e2e: release dead slots puts a build with a gone session back in the Queue (tmux answers "gone")', () => {
    // a tmux stand-in that says no session exists
    const bin = join(tmp, 'bin'); mkdirSync(bin, { recursive: true }); writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nexit 1\n'); chmodSync(join(bin, 'tmux'), 0o755);
    const s = store(); const q = s.builds.find((x) => x.id === 'q1'); q.pipeline.launchedAt = new Date(Date.now() - 10 * 60e3).toISOString(); writeFileSync(storeFile, JSON.stringify(s));
    setState(new Date().toISOString());
    const saved = { tmux: env.AXF_SLOTS_TMUX, path: env.PATH, tick: env.AXF_STALL_TICK };
    delete env.AXF_SLOTS_TMUX; env.PATH = `${bin}:${env.PATH}`; env.AXF_STALL_TICK = 'exit 0';
    try {
      const r = wd('run', '--force');
      assert.deepEqual(r.findings.map((f) => f.kind), ['dead']);
      const rel = r.attempts.find((a) => a.fix === 'release');
      assert.match(rel.result, /released q1/); assert.equal(rel.ok, false, 'back in the Queue, nothing runs: still idle');
      const b1 = store().builds.find((x) => x.id === 'q1'); assert.equal(b1.status, 'queued'); assert.equal(b1.pipeline.session ?? '', '');
    } finally { env.AXF_SLOTS_TMUX = saved.tmux; env.PATH = saved.path; env.AXF_STALL_TICK = saved.tick; }
  });
  t('e2e: intake queues a newly filed Urgent build by itself (Launch builds without asking off)', () => {
    run('orchestrator.mjs', 'act', JSON.stringify({ action: 'add', id: 'hot', title: 'Hot one', steps: [{ text: 'fix it', model: 'Opus', estimate: '20 min' }] }));
    const s = store(); s.builds.find((x) => x.id === 'hot').priority = 'P0'; writeFileSync(storeFile, JSON.stringify(s));
    run('orchestrator.mjs', 'act', JSON.stringify({ action: 'add', id: 'calm', title: 'Calm one', steps: [{ text: 'later', model: 'Opus', estimate: '20 min' }] }));
    const r = JSON.parse(spawnSync(process.execPath, [join(HERE, 'pipeline.mjs'), 'intake', '--json'], { cwd: ROOT, env: { ...env, AXF_PIPELINE_SETTINGS: JSON.stringify({ autoQueue: false, splitProvider: 'off' }) }, encoding: 'utf8' }).stdout.trim().split('\n').pop());
    assert.deepEqual(r.queued, ['hot']);
    assert.equal(store().builds.find((x) => x.id === 'hot').status, 'queued'); assert.equal(store().builds.find((x) => x.id === 'calm').status, 'pending');
  });
}
console.log(`stall watchdog: ${n} checks passed`);

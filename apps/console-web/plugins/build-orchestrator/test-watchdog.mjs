#!/usr/bin/env node
/**
 * Unit tests for watchdog.mjs (build-watchdog@1, IO side) against a temp builds store, temp pipeline / slots / headless
 * folders and a fake probe (AXF_WATCHDOG_PROBE), so nothing on the host is read or touched:
 *   killed 143 → requeued (retry) · exit 1 → retried · stale heartbeat → reset · a live build is untouched · past the
 *   cap → Pending · a usage limit → the next account · idle slots → a tick · one FYI per fix (each) / one per pass
 *   (batch) · a second pass does nothing · settings, status, recoveries, requeue after give-up.
 *   node apps/console-web/plugins/build-orchestrator/test-watchdog.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-watchdog-'));
const dirs = Object.fromEntries(['pipe', 'slots', 'headless', 'wt', 'workers'].map((d) => [d, join(tmp, d)]));
for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
const storeFile = join(tmp, 'store.json');
const notifyLog = join(tmp, 'notify.jsonl');
Object.assign(process.env, {
  AXF_BUILDS_STORE: storeFile, AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_SHIPPED: 'off', AXF_DATA_DIR: 'off', AXF_BUILD_PROFILE: 'all',
  AXF_PIPELINE_DIR: dirs.pipe, AXF_SLOTS_DIR: dirs.slots, AXF_HEADLESS_DIR: dirs.headless, AXF_PIPELINE_WORKTREES: dirs.wt, AXF_CLAUDE_WORKERS: dirs.workers,
  AXF_SLOTS_TMUX: 'off', AXF_BUILD_LOCK_PIDS: 'off', AXF_PIPELINE_CONSOLE: 'off', AXF_CREW_SAY: 'off', AXF_WATCHDOG_TICK: 'off',
  AXF_WATCHDOG_NOTIFY_LOG: notifyLog, AXF_WATCHDOG_ACCOUNTS: 'w-max,w-pro', AXF_WATCHDOG_CRON: join(tmp, 'cron.d', 'axf-watchdog'),
});
delete process.env.AXF_WATCHDOG_SETTINGS;
const W = await import('./watchdog/sessions.mjs');

let n = 0;
const t = async (name, fn) => { try { await fn(); } catch (e) { console.error(`✗ ${name}`); throw e; } n += 1; console.log(`  ✓ ${name}`); };
const now = Date.now();
const ago = (m) => new Date(now - m * 60e3).toISOString();
const build = (id, extra = {}) => ({
  id, title: `Build ${id}`, status: 'running', profiles: [],
  steps: [{ id: 's1', text: 'first', model: 'Opus', done: true, doneAt: ago(120) }, { id: 's2', text: 'second', model: 'Opus' }],
  pipeline: { session: `axf-${id}--amy`, launchedAt: ago(30), dispatchedAt: ago(30), account: 'w-max', queuedAt: ago(200), runs: 1 }, ...extra,
});
const seed = (builds) => writeFileSync(storeFile, JSON.stringify({ $axf: 'builds@1', version: 1, builds }));
const store = () => JSON.parse(readFileSync(storeFile, 'utf8'));
const find = (id) => store().builds.find((b) => b.id === id);
const probe = (map) => { process.env.AXF_WATCHDOG_PROBE = JSON.stringify(map); };
const fresh = () => { for (const f of ['build-watchdog.json', 'build-watchdog-settings.json', 'build-watchdog-request.json']) rmSync(join(dirs.pipe, f), { force: true }); rmSync(notifyLog, { force: true }); };
const sent = () => (existsSync(notifyLog) ? readFileSync(notifyLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const noFill = { slotsOf: () => ({ free: 0 }) };
const dead = { pid: false, tmux: false };

try {
  await t('killed 143: step reset, slot released, back in the Queue (retry 1), recovery recorded', () => {
    fresh(); seed([build('killed')]); probe({ killed: { ...dead, exit: 143, exitKind: 'stopped' } });
    const r = W.run({ fill: noFill });
    assert.equal(r.fixes.length, 1); assert.equal(r.fixes[0].cause, 'exit-killed'); assert.equal(r.fixes[0].action, 'retry');
    const b = find('killed');
    assert.equal(b.status, 'queued'); assert.equal(b.pipeline.session ?? '', ''); assert.equal(b.pipeline.slot ?? '', '');
    assert.equal(b.recoveries.length, 1); assert.equal(b.recoveries[0].exit, 143); assert.equal(b.recoveries[0].attempt, 1); assert.equal(b.recoveries[0].step, 's2');
    assert.match(b.steps[1].note, /Reset by the watchdog \(exit-killed, attempt 1\)/); assert.equal(b.steps[1].done, false);
    assert.equal(b.pipeline.lastRun.exit, 143); assert.equal(b.pipeline.lastRun.outcome, 'requeued');
    assert.match(b.notes.at(-1).text, /^Watchdog fixed Build killed/);
  });

  await t('a second pass does nothing (the build is no longer marked running)', () => {
    const before = JSON.stringify(find('killed'));
    const r = W.run({ fill: noFill });
    assert.equal(r.fixes.length, 0); assert.equal(JSON.stringify(find('killed')), before);
  });

  await t('exit 1 is retried; the retry count lives on the build (recoveries since the last ticked step)', () => {
    fresh(); seed([build('failed', { recoveries: [{ at: ago(20), buildId: 'failed', cause: 'exit-failed', exit: 1, action: 'retry', attempt: 1, step: 's2' }] })]);
    probe({ failed: { ...dead, exit: 1, exitKind: 'crash' } });
    const r = W.run({ fill: noFill });
    assert.equal(r.fixes[0].cause, 'exit-failed'); assert.equal(r.fixes[0].action, 'retry'); assert.equal(r.fixes[0].attempt, 2);
    const b = find('failed'); assert.equal(b.status, 'queued'); assert.equal(b.recoveries.length, 2); assert.equal(W.retriesOf(b), 2);
  });

  await t('a stale heartbeat with nothing alive is reset; one with the process alive is killed first', () => {
    fresh(); seed([build('quiet'), build('hung')]);
    probe({ quiet: { pid: null, tmux: null, lastSeenAt: ago(45) }, hung: { pid: true, tmux: true, lastSeenAt: ago(45) } });
    const r = W.run({ fill: noFill });
    const by = Object.fromEntries(r.fixes.map((f) => [f.buildId, f]));
    assert.equal(by.quiet.cause, 'stale-heartbeat'); assert.equal(by.quiet.action, 'retry');
    assert.equal(by.hung.cause, 'stale-heartbeat'); assert.equal(by.hung.action, 'kill-retry');
    assert.equal(find('quiet').status, 'queued'); assert.equal(find('hung').status, 'queued');
  });

  await t('a live build is never touched', () => {
    fresh(); seed([build('alive')]); probe({ alive: { pid: true, tmux: true, lastSeenAt: ago(1) } });
    const before = readFileSync(storeFile, 'utf8');
    const r = W.run({ fill: noFill });
    assert.equal(r.fixes.length, 0); assert.equal(r.scan.builds[0].decision.cause, 'live'); assert.equal(readFileSync(storeFile, 'utf8'), before);
    assert.equal(sent().length, 0);
  });

  await t('past maxRetries: back in Pending with the reason as its note, an alert, and the gave-up banner list', () => {
    fresh();
    const recs = [1, 2, 3].map((i) => ({ at: ago(30 - i * 5), buildId: 'capped', cause: 'exit-failed', exit: 1, action: 'retry', attempt: i, step: 's2' }));
    seed([build('capped', { recoveries: recs })]); probe({ capped: { ...dead, exit: 1 } });
    const r = W.run({ fill: noFill });
    assert.equal(r.fixes[0].action, 'give-up'); assert.equal(r.fixes[0].attempt, 4);
    const b = find('capped');
    assert.equal(b.status, 'pending'); assert.equal(b.pipeline.lastRun.outcome, 'failed'); assert.match(b.pipeline.note, /giving up: back in Pending/);
    const a = sent(); assert.equal(a.length, 1); assert.equal(a[0].key, 'watchdog:gave-up:capped'); assert.equal(a[0].severity, 'error');
    assert.deepEqual(W.gaveUp().map((g) => g.id), ['capped']);
    assert.equal(W.status().gaveUp.length, 1);
  });

  await t('requeue after a give-up: back in the Queue with a fresh retry count', () => {
    const r = W.requeueGaveUp(['capped']);
    assert.deepEqual(r.requeued, ['capped']); assert.equal(find('capped').status, 'queued');
    // relaunched and killed again: attempt 1, not 5
    const b = find('capped'); b.status = 'running'; b.pipeline = { ...b.pipeline, session: 'axf-capped--amy', launchedAt: ago(10) };
    seed([b]); probe({ capped: { ...dead, exit: 143 } });
    process.env.AXF_WATCHDOG_SETTINGS = JSON.stringify({ cooldownMin: 0 });
    const p = W.run({ fill: noFill });
    delete process.env.AXF_WATCHDOG_SETTINGS;
    assert.equal(p.fixes[0].action, 'retry'); assert.equal(p.fixes[0].attempt, 1);
  });

  await t('a usage limit goes to the next account: that account excluded and the retry planned on the next worker', () => {
    fresh(); seed([build('limited')]); probe({ limited: { ...dead, exit: 1, limit: 'usage' } });
    const r = W.run({ fill: noFill });
    assert.equal(r.fixes[0].cause, 'usage-limit'); assert.equal(r.fixes[0].action, 'retry-other-account'); assert.equal(r.fixes[0].next, 'w-pro');
    const b = find('limited');
    assert.equal(b.status, 'queued'); assert.deepEqual(b.pipeline.tried, ['w-max']); assert.equal(b.pipeline.planned.account, 'w-pro');
    assert.equal(b.recoveries[0].attempt, 0, 'account stops never count as a retry');
  });

  await t('every account tried: give-up', () => {
    fresh(); seed([build('spent', { pipeline: { ...build('x').pipeline, session: 'axf-spent', tried: ['w-pro'] } })]); probe({ spent: { ...dead, exit: 1, limit: 'usage' } });
    const r = W.run({ fill: noFill });
    assert.equal(r.fixes[0].action, 'give-up'); assert.equal(find('spent').status, 'pending');
  });

  await t('idle slots with Queue work trigger a tick; an idle spell nothing fixes is recorded as idle-slots', () => {
    fresh();
    const q = { ...build('waiting'), status: 'queued', pipeline: { queuedAt: ago(5) } };
    const ticks = [];
    const launched = W.fillSlots({ slotsOf: () => ({ free: 2 }), storeOf: () => ({ builds: [q] }), tickOf: () => { ticks.push(1); return { ran: true, launched: ticks.length === 1 ? ['waiting'] : [] }; } });
    assert.ok(ticks.length >= 1); assert.deepEqual(launched.launched, ['waiting']); assert.equal(launched.idle, null);
    const idle = W.fillSlots({ slotsOf: () => ({ free: 2 }), storeOf: () => ({ builds: [q] }), tickOf: () => ({ ran: true, launched: [] }) });
    assert.equal(idle.idle.cause, 'idle-slots'); assert.equal(idle.idle.action, 'tick'); assert.equal(idle.idle.queued, 1);
    assert.ok(existsSync(join(dirs.pipe, 'selfcheck-request.json')), 'the dispatcher self-check is asked for');
    const none = W.fillSlots({ slotsOf: () => ({ free: 0 }), storeOf: () => ({ builds: [q] }), tickOf: () => { throw new Error('no tick with no free slot'); } });
    assert.equal(none.rounds, 0); assert.equal(none.idle, null);
  });

  await t('one FYI per fix (fyi each), notified set on every record', () => {
    fresh(); seed([build('a'), build('b')]); probe({ a: { ...dead, exit: 143 }, b: { ...dead, exit: 1 } });
    process.env.AXF_WATCHDOG_SETTINGS = JSON.stringify({ fyi: 'each' });
    W.run({ fill: noFill });
    delete process.env.AXF_WATCHDOG_SETTINGS;
    const a = sent(); assert.equal(a.length, 2); assert.ok(a.every((x) => x.source === 'watchdog' && /^watchdog:fix:/.test(x.key) && x.severity === 'info'));
    assert.ok(find('a').recoveries[0].notified && find('b').recoveries[0].notified);
    assert.ok(a.every((x) => x.meta.cause && x.meta.action && Number.isInteger(x.meta.attempt)), 'build, cause, action and attempt ride along');
  });

  await t('batched (default): one push for the whole pass', () => {
    fresh(); seed([build('c'), build('d'), build('e')]); probe({ c: { ...dead, exit: 143 }, d: { ...dead, exit: 1 }, e: { ...dead, exit: 137 } });
    W.run({ fill: noFill });
    const a = sent(); assert.equal(a.length, 1); assert.equal(a[0].title, 'Watchdog fixed 3 builds'); assert.equal(a[0].meta.count, 3);
    assert.ok(['c', 'd', 'e'].every((id) => find(id).recoveries[0].notified));
  });

  await t('the watchdog off: stuck builds are reported, nothing is done', () => {
    fresh(); seed([build('off')]); probe({ off: { ...dead, exit: 143 } });
    W.saveSettings({ enabled: false }, { by: 'test' });
    const r = W.run({ fill: noFill });
    assert.equal(r.fixes.length, 0); assert.equal(r.scan.stuck.length, 1); assert.equal(find('off').status, 'running');
    assert.equal(W.cronPass().ran, false, 'the cron skips a pass while off');
    W.requestRun({ by: 'test' }); assert.equal(W.cronPass().ran, true, 'but runs one it is asked for');
  });

  await t('settings: unknown keys refused, values clamped, status stale until a pass', () => {
    fresh();
    assert.throws(() => W.saveSettings({ nope: 1 }), /unknown setting/);
    const s = W.saveSettings({ maxRetries: 99, staleMin: 0, fyi: 'each', retryOtherAccount: 'off' }, { by: 'test' });
    assert.equal(s.maxRetries, 10); assert.equal(s.staleMin, 1); assert.equal(s.fyi, 'each'); assert.equal(s.retryOtherAccount, false);
    assert.equal(W.status().stale, true);
    seed([]); W.run({ fill: noFill }); assert.equal(W.status().stale, false); assert.ok(W.status().lastPass);
  });

  await t('the cron file: install writes the one build-watchdog flock line (skipped once the plugin is gone), remove deletes it', () => {
    mkdirSync(join(tmp, 'cron.d'), { recursive: true });
    const r = W.installCron({ dir: '/opt/axf' }); assert.ok(r.ok && !r.skipped);
    const text = readFileSync(process.env.AXF_WATCHDOG_CRON, 'utf8');
    assert.match(text, /^\* \* \* \* \* root W=\/opt\/axf\/.*build-orchestrator\/watchdog\.mjs; \[ -f \$W \] && .*flock -n \/run\/axf-build-watchdog\.lock .*node \$W cron/m);
    assert.equal(W.removeCron().removed, true); assert.equal(existsSync(process.env.AXF_WATCHDOG_CRON), false);
  });

  console.log(`watchdog: ${n} checks passed`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

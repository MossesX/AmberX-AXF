/**
 * The build watchdog (build-watchdogs@1): the host (watchdog.mjs: registry, one pass, the caught log, alerts, settings)
 * and the stale-status watch (stale-status@1: the decision table and one pass on fake sources). No network, no store:
 *   node apps/console-web/plugins/build-orchestrator/test/watchdogs.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-watchdogs-'));
process.env.AXF_WATCHDOGS_DIR = tmp;
process.env.AXF_WATCHDOG_NOTIFY_LOG = join(tmp, 'alerts.jsonl');
process.env.AXF_WATCHDOG_CRON = 'off';

const H = await import('../watchdog.mjs');
const C = await import('../watchdog/stale-core.mjs');
const S = await import('../watchdog/stale.mjs');

let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n${e.stack}`); process.exitCode = 1; } };
const NOW = Date.parse('2026-11-21T12:00:00Z');
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const done = [{ id: 's1', done: true, doneAt: ago(5000) }];
const build = (o) => ({ id: 'b1', title: 'Build one', status: 'landing', branch: 'claude/b1', pr: '#10', steps: done, attempts: [], notes: [], ...o });
const SET = C.normSettings({});
const alerts = () => (existsSync(process.env.AXF_WATCHDOG_NOTIFY_LOG) ? readFileSync(process.env.AXF_WATCHDOG_NOTIFY_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

console.log('stale-status@1: the decision table');
await t('inside its limit, another flow, deleted: not stale', () => {
  assert.equal(C.decide(build({ steps: [{ id: 's1', done: true, doneAt: ago(30) }] }), { pr: { state: 'open' } }, { now: NOW, settings: SET }).stale, false);
  assert.equal(C.decide(build({ flow: 'pipeline-2' }), { pr: { state: 'open' } }, { now: NOW, settings: SET }).action, 'none');
  assert.equal(C.decide(build({ deleted: true }), {}, { now: NOW, settings: SET }).action, 'none');
  assert.equal(C.decide(build({ status: 'running' }), {}, { now: NOW, settings: SET }).action, 'none');
});
await t('movement is real progress, not updatedAt', () => {
  const b = build({ updatedAt: ago(1) });
  assert.equal(C.decide(b, { pr: { state: 'open' } }, { now: NOW, settings: SET }).stale, true, 'a bulk store write does not reset the clock');
  assert.equal(C.movedAt(build({ steps: [], updatedAt: ago(7) })), NOW - 7 * 60000, 'no mark at all: updatedAt');
});
await t('a live session, an attempt in flight, the cooldown and an unreadable PR all wait', () => {
  const f = { pr: { state: 'open' } };
  assert.equal(C.decide(build({}), { ...f, live: true }, { now: NOW, settings: SET }).action, 'wait');
  assert.equal(C.decide(build({ status: 'fixing', failure: { kind: 'ci-red', at: ago(500) }, attempts: [{ n: 1, result: 'started', startedAt: ago(10) }] }), f, { now: NOW, settings: { ...SET, limits: { ...SET.limits, fixing: 5 } } }).action, 'wait');
  assert.equal(C.decide(build({}), f, { now: NOW, settings: SET, pushedAt: ago(200) }).action, 'fail', 'cooldown over');
  assert.equal(C.decide(build({ steps: done }), f, { now: NOW, settings: { ...SET, cooldownMin: 300 }, pushedAt: ago(200) }).action, 'wait');
  const blind = C.decide(build({}), { pr: null }, { now: NOW, settings: SET });
  assert.equal(blind.action, 'wait'); assert.match(blind.why, /could not be read/);
});
await t('merged and the build never heard: record the merge', () => {
  const d = C.decide(build({}), { pr: { state: 'merged', mergedAt: ago(300), mergeCommit: 'a'.repeat(40) } }, { now: NOW, settings: SET });
  assert.equal(d.action, 'record-merge'); assert.equal(d.pr, 10); assert.equal(d.sha, 'a'.repeat(40));
  assert.equal(C.decide(build({}), { pr: { state: 'merged', mergedAt: ago(300), mergeCommit: '' } }, { now: NOW, settings: SET }).action, 'wait', 'no merge commit: nothing to record yet');
});
await t('merged: CI green lands, red is a ci-red failure, pending waits then escalates', () => {
  const b = build({ mergedAt: ago(300), landed: { pr: 10, sha: 'a'.repeat(40), mergedAt: ago(300) } });
  const f = { pr: { state: 'merged' } };
  assert.equal(C.decide(b, { ...f, ci: 'success' }, { now: NOW, settings: SET }).action, 'land');
  const red = C.decide(b, { ...f, ci: 'failure' }, { now: NOW, settings: SET });
  assert.equal(red.action, 'fail'); assert.equal(red.kind, 'ci-red'); assert.equal(red.head, 'a'.repeat(40));
  assert.equal(C.decide(b, { ...f, ci: 'pending' }, { now: NOW, settings: { ...SET, ciWaitMin: 600 } }).action, 'wait');
  assert.equal(C.decide(b, { ...f, ci: 'none' }, { now: NOW, settings: SET }).action, 'escalate');
  assert.equal(C.decide(b, { ...f, ci: null }, { now: NOW, settings: SET }).action, 'wait', 'CI unreadable: wait');
});
await t('merged, CI on the merge commit red or missing, main green now: landed with the proof named', () => {
  const b = build({ mergedAt: ago(300), landed: { pr: 10, sha: 'a'.repeat(40), mergedAt: ago(300) } });
  for (const ci of ['failure', 'none']) {
    const d = C.decide(b, { pr: { state: 'merged' }, ci, mainCi: 'success', mainHead: 'b'.repeat(40) }, { now: NOW, settings: SET });
    assert.equal(d.action, 'land'); assert.equal(d.via, 'main'); assert.equal(d.mainHead, 'b'.repeat(40));
  }
  assert.equal(C.decide(b, { pr: { state: 'merged' }, ci: 'failure', mainCi: 'failure', mainHead: 'b'.repeat(40) }, { now: NOW, settings: SET }).action, 'fail');
});
await t('merged, CI on the merge commit red or missing, CI on main still running or unreadable: wait for main`s result', () => {
  const b = build({ mergedAt: ago(300), landed: { pr: 10, sha: 'a'.repeat(40), mergedAt: ago(300) } });
  for (const ci of ['failure', 'none', 'pending']) for (const mainCi of ['pending', 'none', null, undefined]) {
    const d = C.decide(b, { pr: { state: 'merged' }, ci, mainCi, mainHead: 'b'.repeat(40) }, { now: NOW, settings: SET });
    assert.equal(d.action, 'wait', `${ci} / ${mainCi}`); assert.match(d.why, /that result decides/);
  }
  assert.equal(C.decide(b, { pr: { state: 'merged' }, ci: 'failure', mainCi: 'pending', mainHead: 'a'.repeat(40) }, { now: NOW, settings: SET }).action, 'fail', 'the merge commit IS main`s newest: its own red CI decides');
  assert.equal(C.decide(b, { pr: { state: 'merged' }, ci: 'none' }, { now: NOW, settings: SET }).action, 'escalate', 'main unknown altogether: no rung left');
});
await t('fixing: the ladder`s next rung, its escalation, and no failure at all', () => {
  const b = build({ status: 'fixing', failure: { kind: 'ci-red', at: ago(500), why: 'CI is red' } });
  const f = { pr: { state: 'open' } };
  const d = C.decide(b, f, { now: NOW, settings: SET, next: { strategy: 'fix', fixStrategy: 'targeted' } });
  assert.equal(d.action, 'ladder'); assert.equal(d.rung, 'fix:targeted');
  assert.equal(C.decide(b, f, { now: NOW, settings: SET, next: { strategy: 'fresh-session' } }).rung, 'fresh-session');
  assert.equal(C.decide(b, f, { now: NOW, settings: SET, next: { escalate: true, reason: 'every rung used' } }).action, 'escalate');
  assert.equal(C.decide(b, f, { now: NOW, settings: SET, next: { inFlight: true } }).action, 'wait');
  assert.equal(C.decide(build({ status: 'fixing' }), f, { now: NOW, settings: SET }).action, 'to-landing');
  assert.equal(C.decide(build({ status: 'fixing', steps: [{ id: 's1' }], updatedAt: ago(500) }), f, { now: NOW, settings: SET }).action, 'requeue');
});
await t('landing with the PR open, closed or missing: a failure the ladder answers', () => {
  assert.equal(C.decide(build({}), { pr: { state: 'open' } }, { now: NOW, settings: SET }).kind, 'stalled');
  assert.equal(C.decide(build({}), { pr: { state: 'closed' } }, { now: NOW, settings: SET }).kind, 'push-fail');
  assert.equal(C.decide(build({ pr: '' }), {}, { now: NOW, settings: SET }).kind, 'push-fail');
  assert.equal(C.decide(build({ status: 'merging' }), { pr: { state: 'open' } }, { now: NOW, settings: SET }).action, 'fail', 'merging is watched the same way');
});
await t('pick: the longest-standing first, maxPerPass, one launch at a time', () => {
  const ds = [{ id: 'a', stale: true, action: 'ladder', minutes: 50 }, { id: 'b', stale: true, action: 'fail', minutes: 90 }, { id: 'c', stale: true, action: 'land', minutes: 10 }, { id: 'd', stale: true, action: 'wait', minutes: 999 }, { id: 'e', stale: true, action: 'record-merge', minutes: 5 }];
  const p = C.pick(ds, { ...SET, maxPerPass: 2, maxLaunchPerPass: 1 });
  assert.deepEqual(p.act.map((d) => d.id), ['b', 'c']); assert.deepEqual(p.held.map((h) => h.id), ['a', 'e']);
  assert.equal(C.pick(ds, { ...SET, maxLaunchPerPass: 0 }).act.some((d) => C.LAUNCHES.includes(d.action)), false, '0 launches: bookkeeping only');
});
await t('settings: limits per status, clamped, an added status is watched', () => {
  const s = C.normSettings({ limits: { fixing: 5, waiting: 15 }, maxPerPass: 9999, cooldownMin: -3 });
  assert.equal(s.limits.fixing, 5); assert.equal(s.limits.waiting, 15); assert.equal(s.limits.landing, 90); assert.equal(s.maxPerPass, 100); assert.equal(s.cooldownMin, 0);
  assert.equal(C.watched({ id: 'x', status: 'waiting' }, s), true);
});

console.log('the stale watch: one pass on fake sources');
const fakeStore = { builds: [
  build({ id: 'merged', pr: '#11' }),
  build({ id: 'green', pr: '#12', mergedAt: ago(300), landed: { pr: 12, sha: 'c'.repeat(40), mergedAt: ago(300) } }),
  build({ id: 'fix-a', pr: '#13', status: 'fixing', failure: { kind: 'ci-red', at: ago(900), why: 'CI is red' } }),
  build({ id: 'fix-b', pr: '#14', status: 'fixing', failure: { kind: 'ci-red', at: ago(800), why: 'CI is red' } }),
  build({ id: 'fresh', pr: '#15', steps: [{ id: 's1', done: true, doneAt: ago(10) }] }),
  build({ id: 'p2', pr: '#16', flow: 'pipeline-2' }),
] };
const sources = {
  loadStore: () => fakeStore,
  prFacts: (bs) => ({ mainHead: 'd'.repeat(40), errors: [], ...Object.fromEntries(bs.map((b) => [b.id, { pr: b.id === 'merged' ? { state: 'merged', mergedAt: ago(200), mergeCommit: 'e'.repeat(40) } : { state: b.mergedAt ? 'merged' : 'open' }, live: false }])) }),
  ciOn: (sha) => (sha === 'c'.repeat(40) ? 'success' : 'none'),
  landerLive: () => false,
  nextRung: () => ({ strategy: 'fix', fixStrategy: 'targeted' }),
};
await t('scan decides for the late builds only and changes nothing', async () => {
  const sc = await S.scan({ now: NOW, sources });
  assert.equal(sc.watching, 5, 'the Pipeline 2.0 build is not watched');
  assert.deepEqual(Object.fromEntries(sc.decisions.map((d) => [d.id, d.action])), { merged: 'record-merge', green: 'land', 'fix-a': 'ladder', 'fix-b': 'ladder' });
  assert.equal(existsSync(join(tmp, 'watchdogs-stale.json')), false);
});
const applied = [];
const apply = Object.fromEntries(C.ACTIONS.map((a) => [a, (d) => { applied.push(`${d.id}:${a}`); return d.id === 'green' ? { ok: false, note: 'refused by the guard' } : { ok: true, note: 'ok' }; }]));
await t('run applies, caps launches at one per pass and remembers every push', async () => {
  const r = await S.run({ now: NOW, sources, apply });
  assert.deepEqual(applied.sort(), ['fix-a:ladder', 'green:land', 'merged:record-merge']);
  assert.equal(r.catches.length, 3); assert.equal(r.catches.find((c) => c.build === 'green').ok, false);
  assert.ok(r.skipped.some((s) => s.id === 'fix-b' && /one launch at a time/.test(s.why)));
  assert.ok(r.catches.every((c) => c.watch === 'stale' && c.cause && c.note));
  const mem = JSON.parse(readFileSync(join(tmp, 'watchdogs-stale.json'), 'utf8'));
  assert.deepEqual(Object.keys(mem.pushes).sort(), ['fix-a', 'green', 'merged']); assert.equal(mem.lastScan.stale.length, 4);
});
await t('a second pass leaves what it just pushed alone (cooldown) and takes the next in line', async () => {
  applied.length = 0;
  const r = await S.run({ now: Date.now(), sources, apply });
  assert.deepEqual(applied, ['fix-b:ladder']);
  assert.ok(r.skipped.some((s) => s.id === 'fix-a' && /pushed less than/.test(s.why)));
});
await t('settings: flat keys, unknown refused, saved and read back', async () => {
  await assert.rejects(() => S.saveSettings({ nope: 1 }), /unknown setting/);
  const s = await S.saveSettings({ 'limit.fixing': 15, maxLaunchPerPass: 0 }, { by: 'test' });
  assert.equal(s['limit.fixing'], 15); assert.equal((await S.loadSettings()).limits.fixing, 15); assert.equal((await S.loadSettings()).maxLaunchPerPass, 0);
});

console.log('watchdog.mjs: the host');
const runs = { a: 0, b: 0 };
const mk = (id, extra = {}) => ({ id, label: `Watch ${id}`, what: 'a test watch', schema: { enabled: { type: 'boolean', default: true, title: 'On' }, intervalMin: { type: 'integer', min: 1, max: 60, default: 1, title: 'Every' } },
  cfg: { enabled: true, intervalMin: 1 }, settings() { return this.cfg; }, set(p) { Object.assign(this.cfg, p); return this.cfg; },
  run: ({ only }) => { runs[id] += 1; return { watching: 3, catches: [{ build: only || `${id}-build`, title: `Title ${id}`, status: 'fixing', cause: 'stuck', action: 'retry', note: 'did it' }], skipped: [], errors: [] }; }, ...extra });
const wa = mk('wa'); const wb = mk('wb', { run: () => { throw new Error('boom'); } });
runs.wa = 0; runs.wb = 0;
H.register(wa); H.register(wb);
const mine = (r) => r.ran.filter((x) => ['wa', 'wb'].includes(x.id));
await t('the registry: built-in watches plus registered ones; a bad watch is refused', () => {
  assert.deepEqual(H.watchIds(), ['sessions', 'stale', 'rows', 'wa', 'wb']);
  assert.throws(() => H.register({ id: 'Bad Id', run() {} }), /needs an id/); assert.throws(() => H.register({ id: 'norun' }), /run\(\)/);
});
await t('one pass: each watch runs, a throwing watch never stops the next, catches reach the one log', async () => {
  const r = await H.pass({ only: 'wb', force: true });
  assert.equal(mine(r)[0].errors[0], 'boom');
  const r2 = await H.pass({ only: 'wa', force: true, by: 'test' });
  assert.equal(r2.catches.length, 1); assert.equal(r2.catches[0].$axf, 'watchdog-catch@1'); assert.equal(r2.catches[0].watch, 'wa');
  const log = await H.caught({ watch: 'wa' });
  assert.equal(log.length, 1); assert.equal(log[0].build, 'wa-build'); assert.ok(log[0].notified, 'the alert went out and the record says so');
  assert.equal((await H.caught({ build: 'nope' })).length, 0);
});
await t('due: a watch that just ran is not run again inside its interval; off is off; force runs anyway', async () => {
  const before = runs.wa;
  const r = await H.pass({ only: 'wa' });
  assert.equal(runs.wa, before); assert.match(r.notRun[0].why, /next run due/);
  wa.cfg.enabled = false;
  assert.match((await H.pass({ only: 'wa', now: Date.now() + 5 * 60000 })).notRun[0].why, /this watch is off/);
  await H.pass({ only: 'wa', force: true }); assert.equal(runs.wa, before + 1);
  wa.cfg.enabled = true;
});
await t('alerts: one FYI per pass, one each, none; a give-up always alerts', () => {
  const cs = [{ watch: 'wa', build: 'x', title: 'X', cause: 'c', action: 'retry', ok: true }, { watch: 'wb', build: 'y', title: 'Y', cause: 'c', action: 'requeue', ok: true }, { watch: 'wb', build: 'z', title: 'Z', cause: 'c', action: 'escalate', ok: true, gaveUp: true }];
  const batch = H.alertsFor(cs, { alerts: 'batch', at: 't' });
  assert.equal(batch.length, 2); assert.match(batch[0].title, /caught 2/); assert.equal(batch[1].severity, 'error'); assert.match(batch[1].link, /focus:watchdog\?build=z/);
  assert.equal(H.alertsFor(cs, { alerts: 'each' }).length, 3);
  assert.equal(H.alertsFor(cs, { alerts: 'off' }).length, 1, 'off still tells about a give-up');
  assert.equal(H.alertsFor(cs.map((c) => ({ ...c, notified: 't' })), { alerts: 'each' }).length, 0, 'what a watch already sent is not sent again');
  assert.equal(H.alertsFor([{ ...cs[0], ok: false }], { alerts: 'each' }).length, 0, 'a push that did not work is not announced as a fix');
});
await t('settings: one flat map over every watch; each key checked; the master switch stops every watch', async () => {
  const all = await H.allSettings();
  assert.equal(all.values.enabled, true); assert.equal(all.values['wa.intervalMin'], 1); assert.equal(all.schema['stale.limit.fixing'].watch, 'stale'); assert.ok('sessions.maxRetries' in all.values); assert.ok('rows.intervalMin' in all.values);
  await assert.rejects(() => H.setSettings({ 'wa.nope': 1 }), /no watchdog setting/);
  await assert.rejects(() => H.setSettings({ 'wa.intervalMin': 999 }), /whole number from 1 to 60/);
  await assert.rejects(() => H.setSettings({ alerts: 'loud' }), /one of batch, each, off/);
  const s = await H.setSettings({ 'wa.intervalMin': '7', alerts: 'each', enabled: 'off' }, { by: 'test' });
  assert.equal(s.values['wa.intervalMin'], 7); assert.equal(wa.cfg.intervalMin, 7); assert.equal(s.values.alerts, 'each'); assert.equal(s.values.enabled, false);
  assert.match((await H.pass({ only: 'wa', now: Date.now() + 60 * 60000 })).notRun[0].why, /the watchdog is off/);
  await H.setSettings({ enabled: true, 'wa.intervalMin': 1 });
});
await t('a requested pass runs on the next cron minute, for that watch and build, even when not due', async () => {
  const before = runs.wa;
  await H.requestPass({ by: 'console', watch: 'wa', build: 'asked-build' });
  assert.equal((await H.status()).request.build, 'asked-build');
  const r = await H.cronPass();
  assert.equal(runs.wa, before + 1); assert.equal(r.asked.by, 'console'); assert.equal(r.catches[0].build, 'asked-build');
  assert.equal((await H.status()).request, null);
});
await t('the cron file written by the deploy script (the line alone) counts as current', async () => {
  const cron = await import('../watchdog/cron.mjs');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const dir = join(tmp, 'cron.d'); mkdirSync(dir, { recursive: true });
  const keep = { d: process.env.AXF_CRON_DIR, w: process.env.AXF_WATCHDOG_CRON };
  process.env.AXF_CRON_DIR = dir; delete process.env.AXF_WATCHDOG_CRON;
  try {
    assert.equal(cron.status().installed, false);
    writeFileSync(join(dir, cron.NAME), `${cron.render().split('\n').filter((l) => l && !l.startsWith('#')).join('\n')}\n`);
    assert.equal(cron.status().current, true, 'the schedule line alone');
    writeFileSync(join(dir, cron.NAME), '*/5 * * * * root echo old\n'); assert.equal(cron.status().current, false, 'another schedule is out of date');
    writeFileSync(join(dir, 'axf-stale-watchdog'), 'old\n');
    const r = cron.install(); assert.ok(r.installed); assert.deepEqual(r.retired, ['axf-stale-watchdog']); assert.equal(cron.status().current, true);
  } finally { if (keep.d === undefined) delete process.env.AXF_CRON_DIR; else process.env.AXF_CRON_DIR = keep.d; if (keep.w !== undefined) process.env.AXF_WATCHDOG_CRON = keep.w; }
});
await t('status: per watch on/off, last run, caught, last error; stale without a pass', async () => {
  const s = await H.status();
  const a = s.watches.find((w) => w.id === 'wa'); const b = s.watches.find((w) => w.id === 'wb');
  assert.equal(s.stale, false); assert.ok(a.lastRun && a.caught >= 2 && a.enabled); assert.equal(b.lastError, 'boom');
  assert.ok(s.caught.length >= 2); assert.equal(s.caught[0].watch, 'wa');
  assert.equal((await H.status({ now: Date.now() + 30 * 60000 })).stale, true, 'no heartbeat for half an hour while on');
  // a cron minute with nothing due still beats: alive is judged on the heartbeat, not on a watch happening to be due
  const before = (await H.status()).lastPass;
  const idle = await H.pass({ only: 'wa' });
  assert.equal(idle.ran.length, 0); const after = await H.status();
  assert.equal(after.lastPass, before, 'lastPass is the last time a watch ran'); assert.ok(after.lastTick >= before && after.stale === false);
  assert.ok(alerts().length >= 2, 'alerts were written');
});
await t('scan: every watch`s dry run in one answer; a watch without one says so', async () => {
  wa.scan = () => ({ watching: 2, items: [{ build: 'x', cause: 'stuck', action: 'retry' }] });
  const sc = await H.scan({ only: 'wa' }); assert.equal(sc.items.length, 1); assert.equal(sc.items[0].watch, 'wa');
  assert.match((await H.scan({ only: 'wb' })).watches[0].note, /no dry run/);
});

rmSync(tmp, { recursive: true, force: true });
console.log(process.exitCode ? 'watchdogs: FAILED' : `watchdogs: ${n} checks passed`);
process.exit(process.exitCode ?? 0);

// Self-test: node apps/console-web/plugins/build-orchestrator/test/recover.test.mjs
// Auto-recovery (build auto-recover-stuck-builds): session-status@1 records (agent-slots), session liveness, the recovery
// executor against a scratch builds store with fake exit records (143, 1, a stale heartbeat, a healthy session, the cap
// reached, no session at all, a leaked slot, a normal exit 0), the usage-limit hint to another worker, the FYI per fix,
// retry / park by hand, the systems check item, and the dispatcher plan filling every free slot and holding backoff.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-recover-'));
Object.assign(process.env, {
  AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILDS_EXPORT: '0',
  AXF_PIPELINE_DIR: join(tmp, 'pipe'), AXF_SLOTS_DIR: join(tmp, 'slots'), AXF_SLOTS_TMUX: 'off', AXF_SLOTS_HOST: 'h1',
  AXF_CLAUDE_SETTINGS_FILE: join(tmp, 'claude-settings.json'), AXF_BUILD_LIMIT: 'off', AXF_PIPELINE_CONSOLE: 'off', AXF_CREW_SAY: 'off',
});
const slots = await import('../../../../../framework/cli/agent-slots.mjs');
const { liveness } = await import('../../../../../framework/cli/session-liveness.mjs');
const { loadStore } = await import('../../../../../framework/cli/builds-store.mjs');
const R = await import('../recover.mjs');
const P = await import('../pipeline-core.mjs');

let n = 0; const t = async (name, fn) => { try { await fn(); } catch (e) { console.error(`✗ ${name}`); throw e; } n += 1; };
const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60e3).toISOString();
const step = (id, done = false, extra = {}) => ({ id, title: id, text: `${id} work`, model: 'Opus', estimate: '10 min', done, doneAt: done ? ago(120) : '', ...extra });
const build = (id, extra = {}) => ({ id, title: `Build ${id}`, status: 'running', steps: [step('s1', true), step('s2', false, { note: 'half way there' })], pipeline: { session: `axf-${id}`, slot: `hl-${id}`, account: 'w1', launchedAt: ago(60) }, ...extra });
const writeStore = (builds) => writeFileSync(process.env.AXF_BUILDS_STORE, JSON.stringify({ $axf: 'builds@1', builds }));
const find = (id) => loadStore().builds.find((b) => b.id === id);
const rec = (session, o = {}) => ({ $axf: 'session-status@1', session, host: 'h1', state: 'ended', startedAt: ago(60), account: 'w1', ...o });

// ---------------- session-status@1 (claude-headless.sh writes these through agent-slots `session`)
await t('session records: start, heartbeat, end with exit 143 = SIGTERM; the first end wins', () => {
  slots.sessionStart('axf-demo--x', { build: 'demo', account: 'w1', pid: 4242, log: '/tmp/x.log' });
  slots.sessionBeat('axf-demo--x');
  let r = slots.readSessionStatuses().find((x) => x.session === 'axf-demo--x');
  assert.equal(r.state, 'running'); assert.equal(r.build, 'demo'); assert.equal(r.pid, 4242); assert.ok(r.heartbeatAt); assert.equal(r.log, '/tmp/x.log');
  slots.sessionEnd('axf-demo--x', { exit: 143 }); slots.sessionEnd('axf-demo--x', { exit: 0 });
  r = slots.readSessionStatuses().find((x) => x.session === 'axf-demo--x');
  assert.deepEqual([r.state, r.exit, r.signal], ['ended', 143, 'SIGTERM']);
  assert.equal(slots.signalOf(137), 'SIGKILL'); assert.equal(slots.signalOf(1), '');
  assert.throws(() => slots.writeSessionStatus('../evil', {}), /session/);
});

// ---------------- the scratch store: one build per stuck state
const builds = [
  build('killed'),
  build('failed1'),
  build('hung'),
  build('healthy'),
  build('capped', { recovery: { attempts: 3, lastAt: ago(30), lastCause: 'killed' } }),
  build('ghost', { pipeline: { account: 'w1', launchedAt: ago(60) } }),
  build('limit'),
  build('phase-done'),
  build('done-build', { status: 'built', steps: [step('s1', true)], pipeline: { account: 'w1' } }),
  build('queued-one', { status: 'queued', pipeline: { queuedAt: ago(5) } }),
];
writeStore(builds);
const limitLog = join(tmp, 'limit.log'); writeFileSync(limitLog, "working…\nYou've hit your weekly limit · resets 6pm\n");
const records = [
  rec('axf-killed', { exit: 143 }),
  rec('axf-failed1', { exit: 1 }),
  rec('axf-hung', { state: 'running', pid: 111, heartbeatAt: ago(45) }),
  rec('axf-healthy', { state: 'running', pid: 222, heartbeatAt: ago(1) }),
  rec('axf-capped', { exit: 143 }),
  rec('axf-limit', { exit: 1, log: limitLog }),
  rec('axf-phase-done', { exit: 0, endedAt: ago(2) }),
];
const alive = (pid) => pid === 111 || pid === 222;
const slotState = { running: [
  { id: 'hl-done', build: 'done-build', session: 'axf-done-build', state: 'running', startedAt: ago(30) },
  { id: 'hl-young', build: 'queued-one', session: 'axf-queued-one--x', state: 'running', startedAt: ago(1) },
], queue: [] };
const facts = { records, tmux: null, slots: slotState, alive, host: 'h1' };
const settings = R.loadRecoverySettings();

await t('liveness: the plan() input joins builds, records, heartbeats and slots', () => {
  const l = liveness({ ...facts, now: NOW });
  const row = (id) => l.rows.find((r) => r.build === id);
  assert.deepEqual([row('killed').state, row('killed').exit, row('killed').signal], ['killed', 143, 'SIGTERM']);
  assert.equal(row('failed1').state, 'failed');
  assert.equal(row('hung').state, 'stale-heartbeat'); assert.equal(row('hung').alive, true);
  assert.equal(row('healthy').state, ''); assert.equal(row('healthy').why, 'healthy');
  assert.equal(row('ghost').state, 'no-session'); assert.equal(row('ghost').recorded, false);
  assert.ok(!l.rows.some((r) => r.build === 'done-build'), 'built builds are not live');
});

await t('settings: defaults, set by name, refused when out of range', () => {
  assert.deepEqual(settings, { enabled: true, maxRetries: 3, staleHeartbeatMin: 20, backoffMin: '1,5,15', fyi: true });
  assert.throws(() => R.saveRecoverySettings({ maxRetries: 99 }), /maxRetries/);
  assert.throws(() => R.saveRecoverySettings({ nope: 1 }), /no Recovery setting/);
  assert.equal(R.saveRecoverySettings({ backoffMin: '2, 6' }).backoffMin, '2,6');
  R.saveRecoverySettings({ backoffMin: '1,5,15' });
  assert.deepEqual(R.policyOf(settings).backoffMs, [60e3, 300e3, 900e3]);
});

await t('dry run plans every stuck state and changes nothing', () => {
  const r = R.run({ dryRun: true, facts, settings, now: NOW, kill: () => assert.fail('no kill on a dry run'), release: () => assert.fail('no release on a dry run') });
  const by = Object.fromEntries(r.actions.map((a) => [a.build, a]));
  assert.equal(by.killed.action, 'retry'); assert.equal(by.failed1.action, 'retry'); assert.equal(by.hung.action, 'retry'); assert.equal(by.hung.kill, 'axf-hung');
  assert.equal(by.capped.action, 'park'); assert.equal(by.ghost.action, 'requeue'); assert.equal(by['done-build'].action, 'release-slot');
  assert.ok(!by.healthy, 'a healthy session is left alone'); assert.ok(!by['phase-done'], 'a fresh exit 0 is the dispatcher\'s to close');
  assert.ok(!by['queued-one'], 'a slot taken a moment ago is not leaked');
  assert.equal(find('killed').status, 'running');
});

const killed = []; const released = []; const sent = [];
let result;
await t('run: requeue / retry / park / release-slot applied through the store, journalled, notified', () => {
  result = R.run({ facts, settings, now: NOW, kill: (s) => killed.push(s), release: (id) => { released.push(id); return true; }, notify: (a) => sent.push(a), hit: { route: (ex) => (ex.includes('w1') ? 'w2' : 'w1') } });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(killed, ['axf-hung'], 'the hung session is ended first');
  for (const id of ['killed', 'failed1', 'hung', 'ghost', 'limit']) {
    const b = find(id);
    assert.equal(b.status, 'queued', id); assert.equal(b.recovery.attempts, 1, id); assert.ok(b.recovery.nextAt, `${id} waits its backoff`);
    assert.equal(b.steps[1].note, '', `${id}: the stuck step's note is reset`); assert.equal(b.steps[1].done, false);
    assert.equal(b.pipeline.session, ''); assert.equal(b.pipeline.queuedBy, 'auto-recovery');
    assert.equal(b.recovery.events.at(-1).$axf, 'recovery-event@1');
  }
  assert.equal(find('killed').recovery.lastExit, 143); assert.equal(find('killed').recovery.lastCause, 'killed');
  const c = find('capped'); assert.equal(c.status, 'pending'); assert.ok(c.recovery.parkedAt); assert.match(c.notes.at(-1).text, /Parked/);
  assert.equal(find('healthy').status, 'running'); assert.equal(find('phase-done').status, 'running');
  assert.ok(released.includes('hl-done'), 'the leaked slot is released'); assert.ok(released.includes('hl-killed'), 'a requeued build\'s slot is released');
  assert.ok(!released.includes('hl-young'));
  assert.deepEqual(sent.map((a) => a.build).sort(), ['capped', 'done-build', 'failed1', 'ghost', 'hung', 'killed', 'limit']);
  const log = readFileSync(join(process.env.AXF_PIPELINE_DIR, 'recovery.jsonl'), 'utf8');
  assert.match(log, /"event":"recovered".*"build":"killed"/);
  const state = JSON.parse(readFileSync(join(process.env.AXF_PIPELINE_DIR, 'recovery-state.json'), 'utf8')); assert.equal(state.ok, true);
});

await t('usage limit: the retry goes to another worker (hint on pipeline.planned, routeFor takes it)', () => {
  const b = find('limit');
  assert.equal(b.pipeline.planned.account, 'w2'); assert.match(b.pipeline.planned.why, /^auto-recovery: w1 stopped \(usage limit\)/);
  assert.deepEqual(P.recoveryHint(b), { from: 'w1', to: 'w2' });
  const acc = [{ name: 'w1', usable: true, free: 3, running: 0 }, { name: 'w2', usable: true, free: 1, running: 2 }, { name: 'w3', usable: true, free: 3, running: 0 }];
  assert.equal(P.routeFor(b, acc, 'Opus').account, 'w2');
  assert.equal(P.routeFor(b, acc.filter((a) => a.name !== 'w2'), 'Opus').account, 'w3', 'never back on the account that stopped while another can take it');
  assert.match(result.applied.find((a) => a.build === 'limit').line, /Moved off w1 \(usage limit\) to w2/);
});

await t('notify: one plain line per fix, parked builds always, FYI off silences the rest', () => {
  const out = [];
  const retryA = result.applied.find((a) => a.build === 'killed'); const parkA = result.applied.find((a) => a.build === 'capped');
  R.notify(retryA, { settings: { fyi: true }, send: (x) => out.push(x) });
  R.notify(retryA, { settings: { fyi: false }, send: (x) => out.push(x) });
  R.notify(parkA, { settings: { fyi: false }, send: (x) => out.push(x) });
  assert.deepEqual(out.map((x) => x.key), ['pipeline:recovered:killed:1', 'pipeline:recovery-parked:capped']);
  assert.match(out[0].body, /killed \(exit 143\).*try 1 of 3/); assert.equal(out[1].severity, 'error');
  assert.ok(Object.values(out[0].meta).every((v) => v !== null), 'the alerts API refuses null meta values');
  assert.match(out[0].link, /^view:/);
  const types = JSON.parse(readFileSync(new URL('../notify.json', import.meta.url), 'utf8')).types.map((x) => x.id);
  assert.ok(types.includes('build-recovered') && types.includes('build-recovery-parked'));
});

await t('backoff: nothing again while it runs; the dispatcher holds the build', () => {
  const again = R.run({ dryRun: true, facts, settings, now: NOW + 1000 });
  assert.ok(!again.actions.some((a) => a.build === 'killed'));
  const plan = P.plan({ builds: [find('killed')], accounts: [{ name: 'w1', usable: true, free: 3, running: 0 }], slots: { free: 3 }, now: NOW });
  assert.equal(plan.launches.length, 0); assert.match(plan.waits[0].why, /auto-recovery backoff/);
});

await t('the dispatcher plan fills every free slot from the Queue, not one per tick', () => {
  const q = (id, i) => ({ id, title: id, status: 'queued', steps: [step('s1')], pipeline: { queuedAt: ago(10 - i) } });
  const acc = [{ name: 'w1', usable: true, free: 2, running: 0 }, { name: 'w2', usable: true, free: 2, running: 0 }];
  const plan = P.plan({ builds: ['a', 'b', 'c', 'd'].map(q), accounts: acc, slots: { free: 3, used: 1, cap: 4 }, now: NOW });
  assert.equal(plan.launches.length, 3); assert.equal(plan.waits.length, 1); assert.match(plan.waits[0].why, /no free agent slot/);
});

await t('the systems check item: red while a build is parked; retry by hand clears it and resets the count', () => {
  let h = R.health(); assert.equal(h.status, 'error'); assert.match(h.summary, /1 build parked/);
  assert.throws(() => R.retry('nope'), /no build/);
  R.retry('capped', { by: 'brett' });
  const c = find('capped'); assert.equal(c.status, 'queued'); assert.equal(c.recovery.attempts, 0); assert.equal(c.recovery.parkedAt, ''); assert.equal(c.recovery.events.at(-1).action, 'reset');
  h = R.health(); assert.equal(h.status, 'ok');
});

await t('park by hand: back to Pending with the reason, red until retried', () => {
  R.park('ghost', { why: 'needs a design call', by: 'brett' });
  const g = find('ghost'); assert.equal(g.status, 'pending'); assert.ok(g.recovery.parkedAt); assert.match(g.notes.at(-1).text, /needs a design call/);
  assert.equal(R.state().builds.find((b) => b.id === 'ghost').parked, true);
  assert.equal(R.health().status, 'error');
});

await t('auto-recovery off: the tick plans nothing; the state answers what the Recovery log shows', () => {
  R.saveRecoverySettings({ enabled: false });
  const r = R.run({ facts, now: NOW }); assert.equal(r.ran, false); assert.match(r.why, /off/);
  R.saveRecoverySettings({ enabled: true });
  const s = R.state(); assert.ok(s.events.length >= 7); assert.ok(s.events[0].at >= s.events.at(-1).at, 'newest first'); assert.equal(s.settings.enabled, true);
});

console.log(`recover: ${n} checks passed`);

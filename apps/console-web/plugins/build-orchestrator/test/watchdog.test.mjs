// Stale-row watchdog tests: node apps/console-web/plugins/build-orchestrator/test/watchdog.test.mjs
// Table readers and apply actions against a temp builds store, a merge-queue fixture and UI Review fixtures: a dry run
// writes nothing, running builds are never touched, an open PR is never completed, a second run is a no-op.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-watchdog-'));
Object.assign(process.env, {
  AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_SHIPPED: 'off',
  AXF_WATCHDOG_DIR: join(tmp, 'watchdog'), AXF_WATCHDOG_CHANGES: 'off', AXF_PIPELINE_CONSOLE: 'off', AXF_WATCHDOG_CRON: 'off',
});
const core = await import('../../../../../framework/plan/builds-store-core.mjs');
const { buildFacts } = await import('../../../../../framework/cli/stale-facts.mjs');
const W = await import('../watchdog/rows.mjs');
const builds = await import('../watchdog/tables/builds.mjs');
const mq = await import('../watchdog/tables/merge-queue.mjs');
const ur = await import('../watchdog/tables/ui-review.mjs');
const log = await import('../watchdog/log.mjs');
const notify = await import('../watchdog/notify.mjs');

let n = 0; const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };

// ---------------------------------------------------------------- fixtures
const step = (id, done) => ({ id, uid: `u-${id}`, text: id, model: 'Opus', done, doneAt: done ? '2026-11-16T00:00:00Z' : '' });
const b = (id, status, pr, steps) => ({ id, title: id, status, pr, branch: `claude/${id}`, steps, notes: [] });
const store = core.normalizeStore({ ...core.emptyStore(), builds: [
  b('q-merged', 'queued', 'PR 101', [step('s1', true)]),           // queued, PR merged → complete
  b('q-open', 'queued', 'PR 102', [step('s1', false)]),            // PR still open → keeps
  b('r-merged', 'running', 'PR 103', [step('s1', true)]),          // running: never touched
  b('p-closed', 'pending', 'PR 104', [step('s1', false)]),         // PR closed → archived
  b('done', 'complete', 'PR 100', [step('s1', true)]),             // finished: no row
] });
writeFileSync(process.env.AXF_BUILDS_STORE, `${JSON.stringify(store)}\n`);
const queue = { $axf: 'merge-queue@1', items: [{ pr: 105, branch: 'claude/x', head: 'h105', state: 'queued' }], waiting: [{ pr: 106, branch: 'claude/q-open', head: 'h106', build: 'q-open', state: 'held' }, { pr: 105, head: 'h105' }] };
const control = { removed: {} };
const controlCalls = [];
const ctl = (pr, why) => { controlCalls.push(pr); control.removed[String(pr)] = { why, head: `h${pr}`, at: new Date().toISOString() }; };
const items = [
  { id: 'r1', status: 'waiting', pr: 101, branch: 'claude/q-merged', build: 'q-merged', name: 'a' },
  { id: 'r2', status: 'waiting', pr: 102, branch: 'claude/q-open', build: 'q-open', name: 'b' },
  { id: 'r3', status: 'approved', pr: 101, name: 'approved stays' },
  { id: 'pack:x', status: 'waiting', pr: 101 },
  { id: 'r4', status: 'changes', name: 'names nothing' },
];
const closeCalls = [];
const closeLanded = (ids, o) => { const changed = []; for (const it of items) if (ids.includes(it.id) && !it.landed) { it.landed = { ...o, at: 'now' }; changed.push(it.id); } closeCalls.push(...changed); return { changed, skipped: [] }; };
const pr = (number, state) => ({ number, state, mergedAt: state === 'merged' ? '2026-11-16T10:00:00Z' : '', mergeCommit: state === 'merged' ? `m${number}` : '', url: '', branch: '' });
const factsFor = () => ({
  prs: { 101: pr(101, 'merged'), 102: pr(102, 'open'), 103: pr(103, 'merged'), 104: pr(104, 'closed'), 105: pr(105, 'merged'), 106: pr(106, 'open') },
  main: null, branches: null, builds: buildFacts(JSON.parse(readFileSync(process.env.AXF_BUILDS_STORE, 'utf8')).builds, new Set()), github: { requests: 0, notModified: 0 }, errors: [],
});
const opts = () => ({ facts: factsFor(), read: { 'merge-queue': { state: queue, control }, 'ui-review': { items } }, applyCtx: { control: ctl, closeLanded }, post: (m, p, a) => { posts.push(a); return { ok: true }; } });  // axf-not-plugin:ui-review (the stale-row@1 row kind)
const posts = [];

// ---------------------------------------------------------------- table readers
await t('builds reader: pending / queued / building rows, finished and deleted builds are none', async () => {
  const r = await builds.read();
  assert.deepEqual(r.rows.map((x) => `${x.kind}:${x.id}`).sort(), ['building:r-merged', 'pending:p-closed', 'queued:q-merged', 'queued:q-open']);
  assert.equal(r.rows.find((x) => x.id === 'q-merged').pr, 101);
  assert.equal(builds.rowOf({ id: 'x', status: 'queued', deleted: true }), null);
  assert.equal(builds.rowOf({ id: 'x', status: 'blocked' }).kind, 'building');
});
await t('merge-queue reader: one row per PR, a PR already removed at its head is no row', () => {
  assert.deepEqual(mq.rowsFrom(queue).map((r) => r.id), ['105', '106']);
  assert.deepEqual(mq.rowsFrom(queue, { removed: { 105: { head: 'h105' } } }).map((r) => r.id), ['106']);
  assert.deepEqual(mq.rowsFrom(queue, { removed: { 105: { head: 'older' } } }).map((r) => r.id), ['105', '106'], 'a new head comes back');
});
await t('ui-review reader: open items naming a PR, branch or build; approved, design packs, closed and empty ones are none', () => {
  assert.deepEqual(ur.rowsFrom(items).map((r) => r.id), ['r1', 'r2']);
  assert.deepEqual(ur.rowsFrom([{ id: 'z', status: 'waiting', pr: 9, landed: { how: 'landed' } }]), []);
});

// ---------------------------------------------------------------- dry run
const before = readFileSync(process.env.AXF_BUILDS_STORE, 'utf8');
await t('dry run: the plan, and no writes anywhere', async () => {
  const r = await W.run({ ...opts(), dry: true, by: 'test' });
  assert.equal(r.ok, true, r.error); assert.equal(r.dry, true); assert.equal(r.cleaned, 0);
  const plan = Object.fromEntries(r.changes.map((c) => [`${c.table}:${c.id}`, `${c.action}/${c.reason}`]));
  assert.equal(plan['builds:q-merged'], 'complete/pr-merged');
  assert.equal(plan['builds:p-closed'], 'remove/pr-closed');
  assert.equal(plan['merge-queue:105'], 'complete/pr-merged');
  assert.equal(plan['ui-review:r1'], 'complete/pr-merged');
  assert.equal(plan['builds:q-open'], undefined);
  assert.equal(readFileSync(process.env.AXF_BUILDS_STORE, 'utf8'), before, 'store unchanged');
  assert.equal(controlCalls.length, 0); assert.equal(closeCalls.length, 0); assert.equal(posts.length, 0);
  assert.equal(existsSync(join(process.env.AXF_WATCHDOG_DIR, log.LOG)), false, 'no cleanup log on a dry run');
});

// ---------------------------------------------------------------- apply
let first;
await t('run: complete / archive builds under the store lock, remove queue entries, close review items', async () => {
  first = await W.run({ ...opts(), by: 'test' });
  assert.equal(first.ok, true, first.error);
  const s = JSON.parse(readFileSync(process.env.AXF_BUILDS_STORE, 'utf8'));
  const get = (id) => s.builds.find((x) => x.id === id);
  // done-means-merged@1: the watchdog records the merge (pr, mergedAt, landed.sha) and hands the build to the auto-lander
  // as landing; only CI green on the merge commit makes it landed, only a verify makes it complete
  assert.equal(get('q-merged').status, 'landing'); assert.equal(get('q-merged').mergedAt, '2026-11-16T10:00:00Z');
  assert.equal(get('q-merged').landed.sha, 'm101'); assert.equal(get('q-merged').landed.ci, 'unknown'); assert.equal(get('q-merged').landed.pr, 101);
  assert.ok(get('q-merged').notes.some((x) => /^Watchdog: Queued build q-merged → Complete.*\(queued → landing\)/.test(x.text)), 'build note');
  assert.ok(!get('q-merged').notes.some((x) => /^Refused /.test(x.text)), 'nothing the store had to refuse');
  assert.equal(get('p-closed').status, 'archived');
  assert.equal(get('q-open').status, 'queued');
  assert.deepEqual(controlCalls, [105]);
  assert.deepEqual(closeCalls, ['r1']);
  assert.equal(items.find((x) => x.id === 'r1').landed.how, 'landed');
  assert.ok(s.rev > store.rev, 'journalled store write');
});
await t('running builds are never touched (even with a merged PR)', () => {
  const s = JSON.parse(readFileSync(process.env.AXF_BUILDS_STORE, 'utf8'));
  const r = s.builds.find((x) => x.id === 'r-merged');
  assert.equal(r.status, 'running'); assert.equal(r.mergedAt ?? '', ''); assert.equal((r.notes ?? []).length, 0);
});
await t('an open PR is never completed in a list (build-complete with PR open is skipped)', async () => {
  const out = await mq.apply([{ table: 'merge-queue', row: { kind: 'merge-queue', id: '7', pr: 7 }, action: 'complete', reason: 'build-complete', prState: 'open', line: 'x' }], { control: () => assert.fail('must not remove') });
  assert.equal(out[0].applied, false); assert.match(out[0].why, /still open/);
  const o2 = await ur.apply([{ table: 'ui-review', row: { kind: 'ui-review', id: 'r2', pr: 102 }, action: 'complete', reason: 'build-complete', prState: 'open', line: 'x' }], { closeLanded: () => assert.fail('must not close') });  // axf-not-plugin:ui-review (the stale-row@1 row kind)
  assert.equal(o2[0].applied, false);
});
await t('cleanup log: one stale-row-log@1 record per applied row; build notes; one FYI', async () => {
  const recs = log.readLog({ dir: process.env.AXF_WATCHDOG_DIR, limit: 100 });
  assert.equal(recs.length, first.cleaned);
  const { validateRecord } = await import('../../../../../framework/core/stale-rows.mjs');
  for (const r of recs) assert.ok(validateRecord(r).ok, JSON.stringify(validateRecord(r)));
  assert.equal(log.readLog({ dir: process.env.AXF_WATCHDOG_DIR, kind: 'merge-queue' }).length, 1);
  const s = JSON.parse(readFileSync(process.env.AXF_BUILDS_STORE, 'utf8'));
  assert.ok(s.builds.find((x) => x.id === 'q-merged').notes.some((x) => /UI Review item r1/.test(x.text)), 'note from the review item on its build');
  assert.equal(posts.length, 1); assert.match(posts[0].title, /^Watchdog cleaned \d+ stale rows/); assert.equal(posts[0].source, 'pipeline'); assert.match(posts[0].key, /^watchdog:cleaned:/);
});
await t('second run is a no-op', async () => {
  const storeNow = readFileSync(process.env.AXF_BUILDS_STORE, 'utf8');
  const r = await W.run({ ...opts(), by: 'test' });
  assert.equal(r.ok, true, r.error); assert.equal(r.cleaned, 0);
  assert.equal(readFileSync(process.env.AXF_BUILDS_STORE, 'utf8'), storeNow);
  assert.deepEqual(controlCalls, [105]); assert.deepEqual(closeCalls, ['r1']); assert.equal(posts.length, 1);
});

// ---------------------------------------------------------------- settings, lock, rotation, notify
await t('settings: checked, stored, off skips the run, a table switched off is not read', async () => {
  assert.throws(() => W.writeSettings({ intervalMin: 0 }), /1 to 120/);
  assert.throws(() => W.writeSettings({ nope: 1 }), /no watchdog setting/);
  W.writeSettings({ enabled: 'off', 'tables.ui-review': false });
  assert.equal((await W.run(opts())).skipped, 'the watchdog is off');
  const r = await W.run({ ...opts(), force: true, dry: true });
  assert.equal(r.tables.find((x) => x.id === 'ui-review').on, false);  // axf-not-plugin:ui-review (the stale-row@1 row kind)
  W.writeSettings({ enabled: true, 'tables.ui-review': true });
});
await t('one run at a time: a held lock skips', async () => {
  const unlock = W.takeLock();
  assert.equal((await W.run(opts())).skipped, 'another run is still going');
  unlock();
});
await t('cron tick skips when not due', async () => {
  W.writeSettings({ intervalMin: 60 });
  assert.equal((await W.run({ ...opts(), cron: true })).skipped, 'not due yet');
  W.writeSettings({ intervalMin: 5 });
});
await t('log rotates monthly', () => {
  const d = mkdtempSync(join(tmpdir(), 'axf-wd-rot-'));
  log.appendLog(d, [{ at: '2026-10-31T23:00:00Z', kind: 'pending', rowId: 'a' }], '2026-10-31T23:00:00Z');
  log.appendLog(d, [{ at: '2026-11-01T01:00:00Z', kind: 'pending', rowId: 'b' }], '2026-11-01T01:00:00Z');
  assert.ok(existsSync(join(d, 'log-2026-10.jsonl')));
  assert.deepEqual(log.readLog({ dir: d }).map((r) => r.rowId), ['b', 'a']);
});
await t('notify: nothing cleaned = no alert; off = not sent', async () => {
  assert.equal(notify.alertOf({ changes: [{ applied: false }] }), null);
  assert.equal((await notify.notifyRun({ at: 'x', changes: [{ applied: true, table: 'builds', line: 'l' }] }, { enabled: false, post: () => assert.fail() })).sent, false);
});

console.log(`✓ watchdog: ${n} tests`);

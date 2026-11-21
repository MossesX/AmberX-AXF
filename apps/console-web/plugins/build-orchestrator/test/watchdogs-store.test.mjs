/**
 * The stale-status watch's real writes on a scratch builds store (no host, no network): the merge recorded, landed
 * under the done-means-merged guard, a failure recorded (fixing), fixing back to landing, a build that moved on left alone.
 *   node apps/console-web/plugins/build-orchestrator/test/watchdogs-store.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-watchdogs-store-'));
const dirs = Object.fromEntries(['pipe', 'slots', 'headless', 'wt', 'workers'].map((d) => [d, join(tmp, d)]));
for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
const storeFile = join(tmp, 'store.json');
Object.assign(process.env, {
  AXF_BUILDS_STORE: storeFile, AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_SHIPPED: 'off', AXF_DATA_DIR: 'off', AXF_BUILD_PROFILE: 'all',
  AXF_PIPELINE_DIR: dirs.pipe, AXF_SLOTS_DIR: dirs.slots, AXF_HEADLESS_DIR: dirs.headless, AXF_PIPELINE_WORKTREES: dirs.wt, AXF_CLAUDE_WORKERS: dirs.workers,
  AXF_SLOTS_TMUX: 'off', AXF_BUILD_LOCK_PIDS: 'off', AXF_PIPELINE_CONSOLE: 'off', AXF_CREW_SAY: 'off', AXF_WATCHDOGS_DIR: join(tmp, 'wd'), AXF_WATCHDOG_NOTIFY_LOG: join(tmp, 'alerts.jsonl'),
});
const S = await import('../watchdog/stale.mjs');

let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n${e.stack}`); process.exitCode = 1; } };
const now = Date.now();
const ago = (m) => new Date(now - m * 60e3).toISOString();
const SHA = 'a'.repeat(40); const MAIN = 'b'.repeat(40);
const build = (id, extra = {}) => ({ id, title: `Build ${id}`, status: 'landing', profiles: [], branch: `claude/${id}`, pr: '#10', steps: [{ id: 's1', text: 'only', model: 'Opus', done: true, doneAt: ago(900) }], ...extra });
const seed = (builds) => writeFileSync(storeFile, JSON.stringify({ $axf: 'builds@1', version: 1, builds }));
const find = (id) => JSON.parse(readFileSync(storeFile, 'utf8')).builds.find((b) => b.id === id);
const facts = (map) => ({
  loadStore: () => JSON.parse(readFileSync(storeFile, 'utf8')),
  prFacts: (bs) => ({ mainHead: MAIN, errors: [], ...Object.fromEntries(bs.map((b) => [b.id, { pr: map[b.id]?.pr ?? { state: 'open' }, live: false }])) }),
  ciOn: (sha) => (sha === MAIN ? map.main ?? 'success' : map.ci ?? 'none'),
  landerLive: () => false,
  nextRung: () => ({ strategy: 'retry' }),
});
const wipe = () => rmSync(join(tmp, 'wd'), { recursive: true, force: true });

console.log('the stale watch on a scratch store');
await t('a merged PR the build never heard of: the merge is recorded, the old failure cleared, status landing', async () => {
  seed([build('m', { status: 'fixing', failure: { kind: 'push-fail', at: ago(800), why: 'the push failed', head: 'c'.repeat(40) } })]);
  const r = await S.run({ sources: facts({ m: { pr: { state: 'merged', mergedAt: ago(700), mergeCommit: SHA } } }) });
  assert.equal(r.catches.length, 1); assert.equal(r.catches[0].action, 'record-merge'); assert.equal(r.catches[0].ok, true, r.catches[0].note);
  const b = find('m');
  assert.equal(b.status, 'landing'); assert.equal(b.landed.sha, SHA); assert.equal(b.landed.pr, 10); assert.ok(b.mergedAt); assert.equal(b.failure ?? null, null);
  assert.match(b.notes.at(-1).text, /^Watchdog: PR #10 merged/);
});
await t('the next pass (after the cooldown) reads CI on the merge commit: green means landed', async () => {
  wipe();
  const r = await S.run({ sources: facts({ ci: 'success' }) });
  assert.equal(r.catches[0].action, 'land'); assert.equal(r.catches[0].ok, true, r.catches[0].note);
  const b = find('m'); assert.equal(b.status, 'landed'); assert.equal(b.landed.ci, 'success'); assert.equal(b.landed.ciRun, `commit@${SHA}`);
});
await t('red on the merge commit but main green now: landed, and the record says which commit proved it', async () => {
  wipe(); seed([build('g', { mergedAt: ago(700), landed: { pr: 10, sha: SHA, mergedAt: ago(700) } })]);
  const r = await S.run({ sources: facts({ ci: 'failure', main: 'success' }) });
  assert.equal(r.catches[0].ok, true, r.catches[0].note);
  const b = find('g'); assert.equal(b.status, 'landed'); assert.equal(b.landed.ciRun, `main@${MAIN}`); assert.match(b.notes.at(-1).text, /main is green/);
});
await t('red on the merge commit and on main: a ci-red failure at the merge commit, status fixing', async () => {
  wipe(); seed([build('r', { mergedAt: ago(700), landed: { pr: 10, sha: SHA, mergedAt: ago(700) } })]);
  const r = await S.run({ sources: facts({ ci: 'failure', main: 'failure' }) });
  assert.equal(r.catches[0].action, 'fail'); assert.equal(r.catches[0].ok, true, r.catches[0].note);
  const b = find('r'); assert.equal(b.status, 'fixing'); assert.equal(b.failure.kind, 'ci-red'); assert.equal(b.failure.head, SHA);
});
await t('landing with the PR still open: a stalled failure the ladder answers; the watch remembers the push', async () => {
  wipe(); seed([build('o')]);
  const r = await S.run({ sources: facts({}) });
  assert.equal(r.catches[0].action, 'fail'); assert.equal(find('o').status, 'fixing'); assert.equal(find('o').failure.kind, 'stalled');
  const again = await S.run({ sources: facts({}) });
  assert.equal(again.catches.length, 0, 'the failure it just recorded is movement: nothing is pushed twice');
});
await t('fixing with no failure, every step done and a PR: back to landing', async () => {
  wipe(); seed([build('f', { status: 'fixing' })]);
  const r = await S.run({ sources: facts({}) });
  assert.equal(r.catches[0].action, 'to-landing'); assert.equal(r.catches[0].ok, true, r.catches[0].note); assert.equal(find('f').status, 'landing');
});
await t('a build that moved on between the scan and the write is left alone', async () => {
  wipe(); seed([build('x')]);
  const src = facts({});
  const moved = { ...src, prFacts: (bs) => { const out = src.prFacts(bs); seed([build('x', { status: 'queued' })]); return out; } };
  const r = await S.run({ sources: moved });
  assert.equal(r.catches[0].ok, false); assert.match(r.catches[0].note, /moved on since the scan/); assert.equal(find('x').status, 'queued');
});
await t('dry run (scan) writes nothing to the store', async () => {
  wipe(); seed([build('d')]); const before = readFileSync(storeFile, 'utf8');
  const sc = await S.scan({ sources: facts({}) });
  assert.equal(sc.decisions[0].action, 'fail'); assert.equal(readFileSync(storeFile, 'utf8'), before);
});

rmSync(tmp, { recursive: true, force: true });
console.log(process.exitCode ? 'watchdogs-store: FAILED' : `watchdogs-store: ${n} checks passed`);
process.exit(process.exitCode ?? 0);

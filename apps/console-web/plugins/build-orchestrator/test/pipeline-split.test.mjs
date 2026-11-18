#!/usr/bin/env node
/**
 * Split runs on the server (split-plan@1; build one-build-time-always-split-to-fill), on a scratch store with a fake
 * launcher: node apps/console-web/plugins/build-orchestrator/test/pipeline-split.test.mjs
 *
 *   intake auto-split        a Pending build goes through 'splitting' to a plan with a splitId, parts never share a file
 *   one at a time            the plan launches one build per tick; a held main lock or an active run gates every other
 *   dispatcher launch        launchSplit locks main on one sha, starts each part in its own slot with --account; a second
 *                            build cannot lock main while the first holds it
 *   gate                     the launcher's gate (model-gate.mjs launch) refuses a start with no splitId: exit 3, the build
 *                            on the Failed tab with gateReason and a gate-rejection@1 record, journalled
 *   all or nothing           one part failed for good fails the run whole: nothing combined, main unlocked
 *   roll-up                  the row's badge follows the parts (Queued, Building k/n, Combining) and the landing walk
 *                            (CI, Merging, Merged, Live, Finished); cancel needs confirm and lands nothing
 * The git-level combine (clean merge, clash) and the landing tick are in combine.test.mjs.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../../..');
const tmp = mkdtempSync(join(tmpdir(), 'axf-pipeline-split-'));
const launcher = join(tmp, 'launcher.sh');
writeFileSync(launcher, `#!/usr/bin/env bash
printf '%s|%s|%s\\n' "$AXF_SPLIT_ID" "$AXF_PART_ID" "$*" >> "${tmp}/launches.log"
name=""; while [[ $# -gt 0 ]]; do case "$1" in --name) name="$2"; shift 2;; *) shift;; esac; done
echo "started axf-$name--fake in $(pwd) (hl-$name)"
`); chmodSync(launcher, 0o755);
Object.assign(process.env, {
  AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_SHIPPED: 'off', AXF_DATA_DIR: 'off', AXF_CREW_SAY: 'off',
  AXF_PIPELINE_DIR: join(tmp, 'pipeline'), AXF_PIPELINE_CONSOLE: 'off', AXF_BUILD_PROFILE: 'all', AXF_PIPELINE_WORKTREES: join(tmp, 'wt'), AXF_PIPELINE_WORKTREE_MODE: 'mkdir',
  AXF_PIPELINE_RULES: 'off', AXF_PIPELINE_LAUNCHER: launcher, AXF_SLOTS_TMUX: 'off', AXF_SLOTS_DIR: join(tmp, 'slots'), AXF_HEADLESS_DIR: join(tmp, 'headless'),
  AXF_PIPELINE_SETTINGS: JSON.stringify({ splitProvider: 'off', autoQueue: false }), AXF_GATE_DIR: join(tmp, 'gate'), AXF_COMBINE_PUSH: 'off',
});
const core = await import('../../../../../framework/plan/builds-store-core.mjs');
const S = await import('../../../../../framework/core/build-split.mjs');
const Store = await import('../../../../../framework/cli/builds-store.mjs');
const PC = await import('../pipeline-core.mjs');
const PL = await import('../pipeline.mjs');
const C = await import('../combine.mjs');

let n = 0; const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const find = (id) => core.findBuild(Store.loadStore(), id);
const step = (id, files, extra = {}) => ({ id, text: `do ${id}`, model: 'Opus', estimate: '10 min', files, ...extra });
const seed = (builds, meta = {}) => writeFileSync(process.env.AXF_BUILDS_STORE, JSON.stringify(core.normalizeStore({ ...core.emptyStore(), meta, builds })));
const journal = () => { const d = Store.journalDir(); return existsSync(d) ? readdirSync(d, { recursive: true }).map(String).filter((f) => !existsSync(join(d, f)) || !readdirSync(d, { withFileTypes: true }).find((e) => e.name === f)?.isDirectory()).map((f) => { try { return readFileSync(join(d, f), 'utf8'); } catch { return ''; } }).join('\n') : ''; };
const accounts = [{ name: 'acc1', kind: 'subscription', usable: true, fable: true, parallel: 4, running: 0, free: 4 }, { name: 'acc2', kind: 'subscription', usable: true, fable: true, parallel: 4, running: 0, free: 4 }];
const rules = () => core.projectOrchestrator(Store.loadStore(), 'all').rules;

// ---------------------------------------------------------------- intake auto-split

await t('intake: a Pending build is split at once (splitting → a plan with a splitId), parts share no file, it stays Pending', () => {
  seed([{ id: 'alpha', title: 'Alpha', status: 'pending', steps: [step('s1', ['a.txt']), step('s2', ['b.txt']), step('s3', ['a.txt', 'c.txt']), step('s4', ['d.txt'])] }]);
  const r = PL.intake({ slots: { free: 3, used: 0, cap: 3 } });
  assert.deepEqual(r.split.map((x) => x.id), ['alpha']); assert.equal(r.split[0].ok, true, r.split[0].why);
  const b = find('alpha');
  assert.equal(b.status, 'pending', 'back to the status it came from, ready for the Queue');
  assert.equal(b.splitId, 'alpha.r1'); assert.equal(b.split.id, 'alpha.r1'); assert.ok(S.isSplitId(b.splitId));
  assert.ok(b.split.parts.length >= 2 && b.split.parts.length <= 3, `parts for the free slots (${b.split.parts.length})`);
  const owner = new Map();
  for (const p of b.split.parts) for (const f of p.files) { assert.ok(!owner.has(f), `${f} in ${owner.get(f)} and ${p.id}`); owner.set(f, p.id); }
  assert.deepEqual(b.split.parts.flatMap((p) => p.steps).sort(), ['s1', 's2', 's3', 's4'], 'every open step in exactly one part');
  const sa = b.split.parts.find((p) => p.steps.includes('s1')); assert.ok(sa.steps.includes('s3'), 's1 and s3 share a.txt: the same part');
  assert.ok(b.split.parts.every((p) => p.status === 'waiting' && S.PART_BRANCH_RE.test(p.branch)));
  assert.equal(PL.intake({ slots: { free: 3, used: 0, cap: 3 } }).split.length, 0, 'a build with a current plan is not split again');
});

// ---------------------------------------------------------------- one at a time

await t('dispatcher plan: one build a tick; an active run or a held main lock gates every other Queued build', () => {
  const now = Date.now(); const at = new Date(now).toISOString();
  const q = (id, o = 0) => ({ id, title: id, status: 'queued', steps: [step('s1', [`${id}.txt`])], pipeline: { queuedAt: new Date(now - 1e6 + o).toISOString() } });
  const builds = [q('q1'), q('q2', 1), q('q3', 2)].map((b) => core.normBuild(b));
  const free = PC.plan({ builds, accounts, slots: { free: 4, used: 0, cap: 4 }, now });
  assert.equal(free.launches.length, 1, 'one build at a time, however many slots are free'); assert.equal(free.launches[0].id, 'q1');
  const busy = PC.plan({ builds: [...builds, core.normBuild({ id: 'r1', title: 'r1', status: 'running', steps: [step('s1', ['r.txt'])] })], accounts, slots: { free: 4, used: 1, cap: 5 }, now });
  assert.equal(busy.launches.length, 0); assert.match(busy.waits.find((w) => w.id === 'q1').why, /one build at a time: r1/);
  const meta = { mainLock: { $axf: S.LOCK_SCHEMA, build: 'r2', splitId: 'r2.r1', base: 'a'.repeat(40), lockedAt: at, by: 'dispatcher' } };
  const locked = PC.plan({ builds: [...builds, core.normBuild({ id: 'r2', title: 'r2', status: 'landing', steps: [step('s1', ['r.txt'], { done: true })] })], accounts, slots: { free: 4, used: 0, cap: 4 }, meta, now });
  assert.equal(locked.launches.length, 0); assert.match(locked.waits.find((w) => w.id === 'q1').why, /main is locked by r2/);
});

await t('dispatcher launch: main locked on one sha, a branch per part from it, each part in its own slot with --account; a second build cannot lock main', () => {
  seed([
    { id: 'beta', title: 'Beta', status: 'queued', steps: [step('s1', ['x.txt']), step('s2', ['y.txt']), step('s3', ['z.txt'])], pipeline: { queuedAt: '2026-11-18T00:00:00Z' } },
    { id: 'gamma', title: 'Gamma', status: 'queued', steps: [step('s1', ['g.txt']), step('s2', ['h.txt'])], pipeline: { queuedAt: '2026-11-18T00:00:01Z' } },
  ]);
  for (const id of ['beta', 'gamma']) assert.equal(PL.planSplit(id, { slots: { free: 3, used: 0, cap: 3 } }).ok, true);
  const b = find('beta'); assert.equal(b.status, 'queued'); assert.equal(b.split.parts.length, 3);
  const r = PL.launchSplit(b, { account: 'acc1', model: 'Opus' }, { rules: rules(), accounts, sl: { free: 3, used: 0, cap: 3 } });
  assert.equal(r.parts.length, 3, JSON.stringify(r.errors)); assert.deepEqual(r.waiting, []);
  assert.equal(new Set(r.parts.map((p) => p.slot)).size, 3, 'one agent slot per part');
  const s = Store.loadStore(); const lock = s.meta.mainLock;
  assert.equal(lock.build, 'beta'); assert.equal(lock.splitId, 'beta.r1'); assert.ok(S.SHA_RE.test(lock.base));
  const plan = find('beta').split;
  assert.ok(plan.parts.every((p) => p.base === lock.base && p.status === 'building' && p.account), 'every part from the locked sha, launched, on an account');
  const lines = readFileSync(join(tmp, 'launches.log'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 3);
  for (const l of lines) { const [sid, pid, args] = l.split('|'); assert.equal(sid, 'beta.r1'); assert.match(pid, /^p\d$/); assert.match(args, /--account acc[12]/); assert.match(args, new RegExp(`--name beta--r1-${pid}`)); }
  assert.ok(lines.every((l) => existsSync(join(tmp, 'wt', `beta--r1-${l.split('|')[1]}`))), 'each part in its own worktree');
  assert.throws(() => PL.launchSplit(find('gamma'), { account: 'acc2', model: 'Opus' }, { rules: rules(), accounts, sl: { free: 3, used: 3, cap: 6 } }), (e) => e.code === 'locked' && /beta/.test(e.message));
  assert.equal(Store.loadStore().meta.mainLock.build, 'beta', 'the first run keeps main');
});

// ---------------------------------------------------------------- the gate

await t('gate: a start without a splitId is refused at the launcher (exit 3) and lands on the Failed tab with gateReason', () => {
  seed([{ id: 'nosplit', title: 'No split', status: 'queued', steps: [step('s1', ['n.txt'])] }]);
  const env = { ...process.env, AXF_BUILD_ID: 'nosplit', AXF_ACTOR: 'test-launcher' };
  const g = spawnSync(process.execPath, [join(ROOT, 'framework/cli/model-gate.mjs'), 'launch', '--build', 'nosplit', '--name', 'nosplit', '--model', 'opus', '--json'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60e3 });
  assert.equal(g.status, 3, `${g.status}: ${g.stdout}${g.stderr}`);
  const out = JSON.parse(g.stdout.trim().split('\n').pop()); assert.equal(out.gate, 'require-split-id'); assert.deepEqual(out.missing, ['split-id']);
  const b = find('nosplit');
  assert.equal(b.status, 'failed'); assert.match(b.gateReason, /require-split-id/); assert.equal(b.gateRejection.$axf, 'gate-rejection@1');
  assert.equal(b.gateRejection.by, 'test-launcher'); assert.deepEqual(b.gateRejection.missing, ['split-id']); assert.ok(b.gateRejection.at);
  assert.ok(PL.status().tabs.errors.some((row) => row.id === 'nosplit'), 'the Failed tab lists it');
  assert.match(PL.splitShow('nosplit').gateReason, /split id/);
  assert.match(journal(), /gate:rejected/, 'journalled');
  const none = spawnSync(process.execPath, [join(ROOT, 'framework/cli/model-gate.mjs'), 'launch', '--name', 'axf-build-stray-session', '--json'], { cwd: ROOT, env: { ...process.env, AXF_BUILD_ID: '' }, encoding: 'utf8', timeout: 60e3 });
  assert.equal(none.status, 3); assert.deepEqual(JSON.parse(none.stdout.trim().split('\n').pop()).missing, ['build-id', 'split-id']);
  assert.ok(Store.loadStore().builds.some((x) => x.status === 'failed' && /Rejected start/.test(x.title)), 'a start with no build at all shows up on Failed too');
});

// ---------------------------------------------------------------- all or nothing + roll-up

const runningSplit = (id, parts) => {
  const base = 'b'.repeat(40);
  const plan0 = S.planParts({ id, steps: parts.map((_, i) => step(`s${i + 1}`, [`${id}-${i}.txt`])) }, parts.length, {}, { base }).plan;
  const plan = S.normSplit({ ...plan0, base, run: 'building', parts: plan0.parts.map((p, i) => ({ ...p, base, ...parts[i] })) }, { build: id });
  const meta = S.lockMain({}, { build: id, splitId: plan.id, base }).meta;
  seed([{ id, title: id, status: 'running', steps: parts.map((_, i) => step(`s${i + 1}`, [`${id}-${i}.txt`])), splitId: plan.id, split: S.applyRollUp(plan).plan }], meta);
};

await t('all or nothing: one part failed for good fails the run whole, nothing is combined, main unlocks', () => {
  runningSplit('delta', [{ status: 'done', head: 'c'.repeat(40) }, { status: 'failed', rebuilds: 2, lastError: 'tests red' }, { status: 'building' }]);
  assert.equal(find('delta').split.run, 'failed', 'the roll-up fails the run');
  assert.equal(S.combineReady(find('delta').split).ok, false);
  const r = C.combineTick(); assert.deepEqual(r.failed.map((f) => f.id), ['delta']); assert.deepEqual(r.combined, []);
  const s = Store.loadStore(); const b = find('delta');
  assert.ok(!s.meta.mainLock, 'main unlocked'); assert.equal(b.split.combine.head, '', 'nothing combined'); assert.notEqual(b.status, 'landing');
});

await t('roll-up: the row follows the parts (Queued, Building k/n, Combining) and the landing (CI, Merging, Merged, Live, Finished)', () => {
  const parts = (...st) => st.map((status, i) => ({ id: `p${i + 1}`, status }));
  assert.equal(S.rollUpBadge({ run: 'queued', parts: parts('waiting', 'waiting') }).label, 'Queued');
  assert.equal(S.rollUpBadge({ run: 'building', parts: parts('done', 'testing', 'building', 'waiting') }).label, 'Building 1/4');
  assert.equal(S.rollUpBadge({ run: 'building', parts: parts('done', 'rebuilding') }).label, 'Building 1/2');
  assert.equal(S.rollUpBadge({ run: 'building', parts: parts('done', 'done') }).state, 'combining');
  runningSplit('eps', [{ status: 'done', head: 'd'.repeat(40) }, { status: 'done', head: 'e'.repeat(40) }]);
  let plan = find('eps').split; assert.equal(plan.run, 'combining'); assert.equal(S.rollUpBadge(plan).label, 'Combining');
  plan = S.normSplit({ ...plan, combine: { ...plan.combine, head: 'f'.repeat(40), branch: 'claude/eps' } }, { build: 'eps' });
  const at = '2026-11-18T12:00:00.000Z';
  const walk = [
    [{ pr: '#9' }, null, 'ci', 'CI'],
    [{ pr: '#9' }, { state: 'landing' }, 'merging', 'Merging'],
    [{ pr: '#9', mergedAt: at }, null, 'merged', 'Merged'],
    [{ pr: '#9', status: 'landed', landed: { pr: 9, mergedAt: at, ci: 'success', ciAt: at } }, null, 'live', 'Live'],
    [{ pr: '#9', status: 'complete', landed: { pr: 9, mergedAt: at, ci: 'success', ciAt: at, verifiedAt: at } }, null, 'finished', 'Finished'],
  ];
  for (const [rec, item, run, label] of walk) {
    const r = C.followLanding(plan, { id: 'eps', status: 'landing', ...rec }, { item, at }); plan = r.plan;
    assert.equal(plan.run, run); assert.equal(S.rollUpBadge(plan).label, label);
  }
  assert.deepEqual(plan.history.slice(-5).map((h) => h.to), ['ci', 'merging', 'merged', 'live', 'finished']);
  assert.equal(C.followLanding(plan, { id: 'eps', status: 'complete' }, { at }).change, null, 'finished stays finished');
});

await t('cancel: needs confirm; then every part stops, nothing lands, main unlocks, the build is back in Pending', () => {
  runningSplit('zeta', [{ status: 'building' }, { status: 'waiting' }]);
  assert.throws(() => PL.cancelRun('zeta', {}), /confirm/);
  assert.equal(Store.loadStore().meta.mainLock.build, 'zeta');
  const r = PL.cancelRun('zeta', { confirm: true, by: 'test', why: 'testing cancel' });
  assert.equal(r.status, 'pending'); assert.ok(!Store.loadStore().meta.mainLock); assert.equal(find('zeta').split.run, 'failed');
  assert.equal(PL.runActive().active, null, 'no active run left');
});

console.log(`pipeline-split: ${n} checks passed`);

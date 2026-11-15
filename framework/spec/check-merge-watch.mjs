#!/usr/bin/env node
/**
 * merge-watch@1 conformance: the VPS watches main and sends a shipped manifest for every merge.
 *   node framework/spec/check-merge-watch.mjs           check
 *   node framework/spec/check-merge-watch.mjs --write   regenerate fixtures/merge-watch.json's expected outputs
 *
 * 1. pure (framework/core/merge-watch.mjs): classification of real subjects from main, landings (PR merge, batch,
 *    build_land with its run, double build_land, direct runs by prefix, status / revert skipped), advance across two
 *    ticks (fold of a held direct landing into its build_land), idempotency by sha, due / retry / give-up, prune,
 *    manifest overlay, summary, validation, schema snapshots (fixture)
 * 2. IO (framework/cli/merge-watch-files.mjs): the one path resolver's chain, atomic write + normalised read
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as MW from '../core/merge-watch.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/merge-watch.json');
const WRITE = process.argv.includes('--write');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NOW = '2026-11-15T12:20:00Z';
const c = (sha, parents, subject, at) => ({ sha, parents, subject, at });

// main's first-parent line, Nov 13–15 2026, newest first (as `git rev-list --first-parent` prints), trimmed to the shapes that matter
const MAIN = [
  c('ce0ff527d32b33989c0fa1c0ac1201ceb12e9da8', ['deadbeef0123456789deadbeef0123456789dead'], 'Builds live: 1 build change(s): vps-sends-shipped-features-every-merge [skip ci]', '2026-11-15T12:18:07Z'),
  c('deadbeef0123456789deadbeef0123456789dead', ['56503d108aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], 'Hotfix: console deploy reads the build id from the worktree', '2026-11-15T12:00:00Z'),
  c('56503d108aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ['7539e01154d6b3832d9da0e585ea5987382d73f4', '32e55adee5601051a27afe133e2f639ac37ced8a'], 'Merge origin/main into claude/console-look-becomes-default-axhub-skin (build_land)', '2026-11-15T11:45:43Z'),
  c('7539e01154d6b3832d9da0e585ea5987382d73f4', ['f0db031964cd840b1ad52a4729b2be6024812fd4'], 'console-look-becomes-default-axhub-skin s6: hub default golden cases, checks extended, Kotlin twin deferred', '2026-11-14T23:58:39Z'),
  c('f0db031964cd840b1ad52a4729b2be6024812fd4', ['647b79e58aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], 'console-look-becomes-default-axhub-skin s5: hub-default resolution and composition', '2026-11-14T23:50:44Z'),
  c('647b79e58aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ['9160f6ac0008eb5ff51f7d1f79646c25fdb9667c', 'f425f32af323faf9d68d424adda88001cbcc7e78'], 'Merge pull request #654 from claude/own-token-sets-for-grids-and-tab-groups (merge queue: tested as queue/pr-654 abc)', '2026-11-14T22:33:14Z'),
  c('9160f6ac0008eb5ff51f7d1f79646c25fdb9667c', ['58496ad2a08cfed6a644213ee113ea0156a8d452'], 'Builds live: pending-tab-one-collapsed-row-per-2 s12 done (all) [skip ci]', '2026-11-14T22:00:00Z'),
  c('58496ad2a08cfed6a644213ee113ea0156a8d452', ['15371706a8cfed6a644213ee113ea0156a8d4522', 'c55bc9a2b08eefba3f20ec5d6592dedbba05dd70'], 'Merge origin/main into claude/main-ci-red-test-sandbox-profile-export (build_land)', '2026-11-13T23:39:09Z'),
  c('15371706a8cfed6a644213ee113ea0156a8d4522', ['9473799f1fc79cbbef3cb1eacdafb81ceb2ced8e', 'f64765508fd1cda73883c09f831a12418a26dbcc'], 'Merge origin/main into claude/main-ci-red-test-sandbox-profile-export (build_land)', '2026-11-13T23:39:05Z'),
  c('9473799f1fc79cbbef3cb1eacdafb81ceb2ced8e', ['237a293afaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], 'Builds: repo exports only for repo-registered profiles; drop the test-sandbox leak', '2026-11-13T21:26:21Z'),
  c('237a293afaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ['ec579ee23aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], 'Revert "Merge origin/main into claude/per-toolbar-settings-fix-failing-chrome (build_land)"', '2026-11-13T20:48:21Z'),
  c('ec579ee23aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ['6138f9d15aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'e5639b79f72430b3c443e6e6df94ef696f819d97'], 'Merge origin/main into claude/per-toolbar-settings-fix-failing-chrome (build_land)', '2026-11-13T20:44:51Z'),
  c('6138f9d15aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ['0cd9053f3f43617d2451e6f3404c60ed6289cd43', 'c82ae39237158fd7d9bed27503e6bdf6a41c086e'], 'Merge origin/main into claude/per-toolbar-settings-fix-failing-chrome (build_land)', '2026-11-13T20:44:48Z'),
  c('0cd9053f3f43617d2451e6f3404c60ed6289cd43', ['a987b8e0baaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], 'THREADS: per-toolbar-settings-fix-failing-chrome row, PR #650', '2026-11-13T20:29:54Z'),
  c('a987b8e0baaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ['4dbbdd96f9f2ffc09239616c1829be3720421ae2', 'ddf6d6f308ebfb9e5226949db534f0685ed3d4fa'], "Merge queue: main's status commits into the batch before it lands", '2026-11-13T06:36:32Z'),
  c('4dbbdd96f9f2ffc09239616c1829be3720421ae2', ['8ea73d3c819bdb789d495390f65f9f3761ebaf6e', '6afed2eec2882554bd5e4f82f13c3351896f2776'], 'Merge queue batch: #552 on top of #548, #549, #550, #551', '2026-11-13T06:28:07Z'),
  c('8ea73d3c819bdb789d495390f65f9f3761ebaf6e', ['d342201c45853e35fbab64492b1c88dc17eed5e7', '900d9f7c354baca9444e82f8e93a451c3393cb4a'], 'Merge queue batch: #551 on top of #548, #549, #550', '2026-11-13T06:27:58Z'),
  c('d342201c45853e35fbab64492b1c88dc17eed5e7', ['1234567890abcdef1234567890abcdef12345678'], 'Skin editor: live sandbox for token sets (#640)', '2026-11-13T06:00:00Z'),
  c('1234567890abcdef1234567890abcdef12345678', ['abcdefabcdefabcdefabcdefabcdefabcdefabcd'], 'orch-build-id-40-chars s2: aliases for legacy ids', '2026-11-13T05:00:00Z'),
  c('abcdefabcdefabcdefabcdefabcdefabcdefabcd', ['0000000000000000000000000000000000000001'], 'orch-build-id-40-chars s1: cap new ids', '2026-11-13T04:00:00Z'),
];
const TIP = '0000000000000000000000000000000000000001';
// a landing split across two ticks: the branch's plain commit is on main's tip first, its build_land merge comes next tick
const TICK1 = [c('1111111111111111111111111111111111111111', ['ce0ff527d32b33989c0fa1c0ac1201ceb12e9da8'], 'merge-watch-ship s1: the contract', '2026-11-15T12:19:00Z')];
const TICK2 = [
  c('2222222222222222222222222222222222222222', ['1111111111111111111111111111111111111111', '3333333333333333333333333333333333333333'], 'Merge origin/main into claude/merge-watch-ship (build_land)', '2026-11-15T12:21:00Z'),
];
const IN = { main: MAIN, tip: TIP, tick1: TICK1, tick2: TICK2, bad: [{ $axf: 'nope' }, { lastSeen: { sha: 'zz' }, entries: [] }, { entries: { abc1234: { sha: 'def5678', kind: 'x', state: 'sent', attempts: -1, at: 'yesterday' } } }, { entries: { abcdef1: { sha: 'abcdef1', state: 'skipped' } } }] };

const run = () => {
  const start = MW.startState({ from: { sha: TIP, at: '2026-11-13T03:00:00Z' }, now: '2026-11-13T03:00:00Z' });
  const a1 = MW.advance(start, MAIN, { now: NOW });
  const due0 = MW.due(a1.state, NOW).map((e) => e.sha.slice(0, 9));
  const first = due0[0]; const full = Object.keys(a1.state.entries).find((k) => k.startsWith(first));
  let s = MW.markFailed(a1.state, full, 'ship: store locked', NOW);
  const afterFail = { state: s.entries[full].state, attempts: s.entries[full].attempts, nextRetryAt: s.entries[full].nextRetryAt, dueNow: MW.due(s, NOW).map((e) => e.sha.slice(0, 9)), dueLater: MW.due(s, '2026-11-15T12:21:30Z').map((e) => e.sha.slice(0, 9)) };
  for (let i = 1; i < MW.MAX_ATTEMPTS; i++) s = MW.markFailed(s, full, `try ${i + 1}`, NOW);
  const gaveUp = { attempts: s.entries[full].attempts, nextRetryAt: s.entries[full].nextRetryAt, due: MW.due(s, '2027-01-01T00:00:00Z').map((e) => e.sha.slice(0, 9)) };
  s = MW.markSent(MW.reset(s, full, NOW), full, { id: 'sm-orch-build-id-40-chars', rev: 1 }, NOW);
  const again = MW.advance(s, MAIN, { now: '2026-11-15T12:30:00Z' });
  const b1 = MW.advance(again.state, TICK1, { now: '2026-11-15T12:19:30Z' });
  const b2 = MW.advance(b1.state, TICK2, { now: '2026-11-15T12:21:30Z' });
  const pruned = MW.prune(b2.state, { now: '2026-12-20T00:00:00Z', keepDays: 30 });
  const brief = (e) => ({ sha: e.sha.slice(0, 9), base: e.base.slice(0, 9), kind: e.kind, state: e.state, reason: e.reason, into: e.into.slice(0, 9), pr: e.pr, branch: e.branch, build: e.build, guess: e.guess, commits: e.commits.map((x) => x.slice(0, 9)), hold: e.nextRetryAt, at: e.at });
  return {
    classify: MAIN.map((x) => [x.subject.slice(0, 60), MW.classifyCommit(x)]),
    landings: MW.landingsOf(MAIN, { now: NOW }).map(brief),
    lastSeen: a1.state.lastSeen, startedFrom: a1.state.startedFrom, due0, afterFail, gaveUp, sent: (({ sha, state, attempts, manifest, sentAt, error }) => ({ sha: sha.slice(0, 9), state, attempts, manifest, sentAt, error }))(s.entries[full]),
    idempotent: { added: again.added.length, stillSent: again.state.entries[full].state, lastSeen: again.state.lastSeen.sha.slice(0, 9) },
    tick1: b1.added.map(brief), tick2: { added: b2.added.map(brief), folded: b2.folded.map((x) => x.slice(0, 9)), held: brief(b2.state.entries['1111111111111111111111111111111111111111']) },
    pruned: { before: Object.keys(b2.state.entries).length, after: Object.keys(pruned.entries).length, keptStates: [...new Set(Object.values(pruned.entries).map((e) => e.state))].sort() },
    overlay: Object.values(b2.state.entries).filter((e) => e.state !== 'skipped').map((e) => [e.sha.slice(0, 9), MW.toManifestOverlay(e, { known: new Set(['orch-build-id-40-chars']), byPr: { 552: 'skin-animations-swatches-skin-switch' } })]),
    fallbackSaid: MW.fallbackSaid(b2.state.entries['deadbeef0123456789deadbeef0123456789dead'], ['Hotfix: console deploy reads the build id from the worktree', 'a second line']),
    summary: MW.summaryOf(b2.state, '2026-11-15T12:40:00Z'),
    valid: MW.validateState(b2.state), bad: IN.bad.map((b) => MW.validateState(b).errors.map((e) => e.field)), normIdempotent: same(MW.normState(b2.state), b2.state),
  };
};
const actual = run();
const b2Entries = () => MW.advance(MW.startState({ from: { sha: TIP }, now: NOW }), MAIN, { now: NOW }).state.entries;
if (WRITE) { writeFileSync(FIX, `${JSON.stringify({ $axf: MW.SCHEMA, note: 'Generated by framework/spec/check-merge-watch.mjs --write; every port replays `in` and must answer `out`.', in: IN, out: actual }, null, 1)}\n`); console.log(`wrote ${FIX}`); }
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
t('fixture inputs are the ones in this file', () => assert.ok(same(fx.in, IN), 'inputs drifted: run with --write'));
for (const k of Object.keys(fx.out)) t(`fixture replay: ${k}`, () => assert.deepEqual(actual[k], fx.out[k]));

// ------------------------------------------------------------------ 1. the contract
const L = actual.landings; const by = (p) => L.find((e) => e.sha.startsWith(p));
t('status-only commits and the merge queue status fold never ship; a revert is recorded and skipped', () => {
  for (const p of ['ce0ff527d', '9160f6ac0', 'a987b8e0b']) assert.deepEqual([by(p).state, by(p).reason], ['skipped', 'status-only'], p);
  assert.deepEqual([by('237a293af').state, by('237a293af').reason], ['skipped', 'revert']);
});
t('a merge queue PR merge: PR and branch from the subject, the build from the branch, its work on the second parent (base..sha)', () => {
  const e = by('647b79e58'); assert.deepEqual([e.kind, e.pr, e.branch, e.build, e.base, e.commits], ['pr-merge', 654, 'claude/own-token-sets-for-grids-and-tab-groups', 'own-token-sets-for-grids-and-tab-groups', '9160f6ac0', ['647b79e58']]);
});
t('a build_land fast-forward: the run of branch commits before it joins the landing, keyed by the merge commit', () => {
  const e = by('56503d108'); assert.deepEqual([e.kind, e.build, e.base, e.commits], ['build-land', 'console-look-becomes-default-axhub-skin', '647b79e58', ['56503d108', '7539e0115', 'f0db03196']]);
});
t('two build_land merges of one branch seconds apart are one landing; the plain commits under them are the branch\'s (fast-forward)', () => {
  assert.equal(by('15371706a'), undefined); assert.equal(by('6138f9d15'), undefined);
  const e = by('58496ad2a'); assert.deepEqual([e.kind, e.base, e.commits], ['build-land', '237a293af', ['58496ad2a', '15371706a', '9473799f1']]);
  const p = by('ec579ee23'); assert.deepEqual([p.kind, p.build, p.base, p.commits], ['build-land', 'per-toolbar-settings-fix-failing-chrome', 'a987b8e0b', ['ec579ee23', '6138f9d15', '0cd9053f3']]);
});
t('merge queue batches: one landing per PR; a squash merge "(#N)" is a PR merge too', () => {
  assert.deepEqual([by('4dbbdd96f').kind, by('4dbbdd96f').pr, by('8ea73d3c8').pr], ['batch', 552, 551]);
  assert.deepEqual([by('d342201c4').kind, by('d342201c4').pr, by('d342201c4').build], ['pr-merge', 640, '']);
});
t('plain commits with no build_land after them: direct landings, one per subject prefix, keyed by the newest; old ones are not held', () => {
  const e = by('123456789'); assert.deepEqual([e.kind, e.guess, e.commits, e.base, e.hold], ['direct', 'orch-build-id-40-chars', ['123456789', 'abcdefabc'], '000000000', '']);
  const hf = by('deadbeef0'); assert.deepEqual([hf.kind, hf.guess, hf.commits, hf.base, hf.hold], ['direct', '', ['deadbeef0'], '56503d108', '']);
});
t('every landing + skipped commit is an entry and no first-parent commit is lost', () => {
  const all = new Set(L.flatMap((e) => e.commits)); for (const x of MAIN) assert.ok(all.has(x.sha.slice(0, 9)), x.subject);
  assert.equal(L.filter((e) => e.state !== 'skipped').length, 9);
});
t('lastSeen moves to the newest commit; the watch remembers where it started', () => { assert.equal(actual.lastSeen.sha, MAIN[0].sha); assert.equal(actual.startedFrom, TIP); });
t('due: oldest first, the subject-prefix guess ships only when the store knows the id, else main-<sha9>', () => {
  assert.equal(actual.due0[0], '123456789');
  const ov = Object.fromEntries(actual.overlay); assert.equal(ov['123456789'].build.id, 'orch-build-id-40-chars'); assert.equal(ov['deadbeef0'].build.id, 'main-deadbeef0'); assert.equal(ov['deadbeef0'].build.title.slice(0, 6), 'Hotfix');
  assert.equal(ov['56503d108'].build.id, 'console-look-becomes-default-axhub-skin'); assert.equal(ov['56503d108'].build.title, '');
  assert.equal(ov['4dbbdd96f'].build.id, 'skin-animations-swatches-skin-switch'); assert.equal(ov['8ea73d3c8'].build.id, 'main-8ea73d3c8');
  assert.equal(MW.buildIdOf(by('4dbbdd96f') && Object.values(b2Entries()).find((e) => e.pr === 552), null, new Map([[552, 'From Map']])), 'from-map');
  assert.deepEqual(ov['647b79e58'].pr, { repo: 'amberx-axf', number: 654 }); assert.equal(ov['647b79e58'].landedCommit, '647b79e58aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'); assert.equal(ov['647b79e58'].mergedAt, '2026-11-14T22:33:14Z');
  for (const [, o] of actual.overlay) assert.equal(o.said, undefined, 'the overlay never carries said');
});
t('retry: a failure backs off one minute, then grows; after MAX_ATTEMPTS it waits for a hand (no nextRetryAt, never due)', () => {
  assert.deepEqual([actual.afterFail.state, actual.afterFail.attempts, actual.afterFail.nextRetryAt], ['failed', 1, '2026-11-15T12:21:00Z']);
  assert.ok(!actual.afterFail.dueNow.includes('123456789')); assert.ok(actual.afterFail.dueLater.includes('123456789'));
  assert.deepEqual([actual.gaveUp.attempts, actual.gaveUp.nextRetryAt], [MW.MAX_ATTEMPTS, '']); assert.ok(!actual.gaveUp.due.includes('123456789'));
  assert.deepEqual([MW.RETRY_MINUTES[0], MW.RETRY_MINUTES.at(-1), MW.MAX_ATTEMPTS], [1, 1440, 8]);
});
t('sent is final: the manifest is recorded and a second pass over the same commits adds nothing and keeps it sent', () => {
  assert.deepEqual([actual.sent.state, actual.sent.manifest], ['sent', { id: 'sm-orch-build-id-40-chars', rev: 1 }]);
  assert.deepEqual(actual.idempotent, { added: 0, stillSent: 'sent', lastSeen: 'ce0ff527d' });
});
t('across ticks: a fresh plain commit is held, and the build_land merge of its branch in the next tick claims it (folded)', () => {
  assert.deepEqual([actual.tick1[0].kind, actual.tick1[0].hold], ['direct', '2026-11-15T12:29:30Z']);
  assert.deepEqual(actual.tick2.folded, ['111111111']); assert.deepEqual([actual.tick2.held.state, actual.tick2.held.reason, actual.tick2.held.into], ['skipped', 'folded', '222222222']);
  assert.deepEqual([actual.tick2.added[0].build, actual.tick2.added[0].commits, actual.tick2.added[0].base], ['merge-watch-ship', ['222222222', '111111111'], 'ce0ff527d']);
});
t('prune drops settled entries only; pending ones stay however old', () => { assert.deepEqual(actual.pruned.keptStates, ['pending']); assert.ok(actual.pruned.after < actual.pruned.before); });
t('fallback words are the subjects, never claimed verbatim', () => assert.deepEqual([actual.fallbackSaid.verbatim, actual.fallbackSaid.source, actual.fallbackSaid.text.split('\n').length], [false, 'git', 2]));
t('summary counts what a banner needs', () => { const s = actual.summary; assert.equal(s.counts.sent, 1); assert.ok(s.counts.pending >= 5); assert.equal(s.failed.length, 0); assert.ok(s.oldestPending); assert.equal(s.lastSeen.sha, '2222222222222222222222222222222222222222'); });
t('validation names the field; a good state round-trips through norm', () => {
  assert.equal(actual.valid.ok, true); assert.equal(actual.normIdempotent, true);
  assert.deepEqual(actual.bad[0], ['$axf']); assert.ok(actual.bad[1].includes('lastSeen.sha')); assert.ok(actual.bad[2].some((f) => f.endsWith('.kind')) && actual.bad[2].some((f) => f.endsWith('.attempts')) && actual.bad[2].some((f) => f.endsWith('.at'))); assert.ok(actual.bad[3].some((f) => f.endsWith('.reason')));
});
t('branches fold to claude/<id>; the build id is the branch minus claude/', () => {
  assert.equal(MW.normBranch('MossesX/claude/x-y'), 'claude/x-y'); assert.equal(MW.normBranch('refs/heads/claude/x.'), 'claude/x'); assert.equal(MW.buildOfBranch('claude/Foo_Bar'), 'foo-bar'); assert.equal(MW.buildOfBranch('main'), '');
});
t('schemas/merge-watch.json + schemas/json/merge-watch*.schema.json are current (run axf schemas)', () => { assert.ok(same(JSON.parse(rd('framework/schemas/merge-watch.json')), MW.REGISTRY)); for (const [name, s] of Object.entries(MW.jsonSchemas())) assert.ok(same(JSON.parse(rd(`framework/schemas/json/${name}`)), s), name); });
t('the registry carries the subject patterns, the idempotency key and the data dir chain for other ports', () => { assert.equal(MW.REGISTRY.subjects.prMerge, MW.SUBJECTS.prMerge.source); assert.ok(String(MW.REGISTRY.idempotencyKey).startsWith('sha')); assert.equal(MW.REGISTRY.dataDir.length, 5); });

// ------------------------------------------------------------------ 2. the one path resolver
const F = await import('../cli/merge-watch-files.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'mw-'));
t('resolver chain: AXF_MERGE_WATCH_DIR, then a scratch store sibling, then AXF_DATA_DIR (off = repo), then hub / repo', () => {
  assert.equal(F.mergeWatchDir({ AXF_MERGE_WATCH_DIR: '/x/mw', AXF_BUILDS_STORE: '/y/s.json', AXF_DATA_DIR: '/z' }), '/x/mw');
  assert.equal(F.mergeWatchDir({ AXF_BUILDS_STORE: '/y/s.json', AXF_DATA_DIR: '/z' }), '/y/s.merge-watch');
  assert.equal(F.mergeWatchDir({ AXF_DATA_DIR: '/z' }), '/z/_claude/builds/merge-watch');
  assert.equal(F.mergeWatchDir({ AXF_DATA_DIR: 'off' }), join(F.REPO_ROOT, '_claude/builds/merge-watch'));
  assert.equal(F.mergeWatchDir({}), join(F.REPO_ROOT, '_claude/builds/merge-watch'));
  assert.equal(F.stateFile({ AXF_DATA_DIR: '/z' }), '/z/_claude/builds/merge-watch/state.json');
  assert.deepEqual(F.whereIs({ AXF_DATA_DIR: '/z' }).via, 'AXF_DATA_DIR'); assert.equal(F.whereIs({ AXF_DATA_DIR: 'off' }).via, 'repo');
});
t('write is atomic and read normalises; nothing yet reads as null', () => {
  const env = { AXF_MERGE_WATCH_DIR: join(tmp, 'mw') };
  assert.equal(F.readState(env), null);
  const f = F.writeState(actual.summary && MW.startState({ from: { sha: TIP, at: '2026-11-13T03:00:00Z' }, now: NOW }), env);
  assert.equal(f, join(tmp, 'mw', 'state.json')); assert.ok(existsSync(f)); assert.ok(!existsSync(`${f}.tmp-${process.pid}`));
  assert.deepEqual(F.readState(env).lastSeen.sha, TIP);
  assert.throws(() => F.writeState({ $axf: 'nope' }, env), /merge-watch@1/);
});

console.log(`merge-watch@1: ${n} checks ok`);

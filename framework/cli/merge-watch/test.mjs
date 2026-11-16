#!/usr/bin/env node
/**
 * merge-watch host tests. Regression for the Nov 13-15 gap (report: _claude/builds/reports/vps-sends-shipped-features-every-merge.md):
 * the after-tick send (shipped.mjs shipLanded) must ship every landing on main, not only builds the store calls landed.
 *
 * A throwaway repo reproduces each miss: a PR merge hidden on the second parent of a build_land fast-forward, a phase
 * landing whose build is still running, a store-less hotfix branch, a second landing of an already shipped build, and
 * one already shipped landing that must not go out again.
 *
 *   node framework/cli/merge-watch/test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-merge-watch-'));
const repo = join(tmp, 'repo');
const store = join(tmp, 'store.json');
process.env.AXF_BUILDS_STORE = store;
process.env.AXF_BUILDS_EXPORTS = 'off';

const W = await import('./walk.mjs');
const { shipLanded, sentFor } = await import('../shipped.mjs');
const { readManifest } = await import('../shipped-files.mjs');

let n = 0; const T0 = Date.parse('2026-11-14T10:00:00Z');
const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: new Date(T0 + n * 60e3).toISOString(), GIT_COMMITTER_DATE: new Date(T0 + n * 60e3).toISOString() } }).trim();
const commit = (msg) => { n += 1; writeFileSync(join(repo, `f${n}.txt`), msg); git('add', '.'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
const mergeNoFf = (branch, msg) => { n += 1; git('merge', '-q', '--no-ff', branch, '-m', msg); return git('rev-parse', 'HEAD'); };

let failed = 0; let passed = 0;
const check = (name, fn) => { try { fn(); passed += 1; console.log(`  ✓ ${name}`); } catch (e) { failed += 1; console.log(`  ✗ ${name}\n    ${e.message.split('\n').join('\n    ')}`); } };

try {
  mkdirSync(repo);
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@example.invalid'); git('config', 'user.name', 'test');
  commit('base');
  // done-b lands by PR #10 (already shipped below), then again by PR #12 (a second landing)
  git('checkout', '-q', '-b', 'claude/done-b'); commit('done-b s1: first');
  git('checkout', '-q', 'main'); const pr10 = mergeNoFf('claude/done-b', 'Merge pull request #10 from MossesX/claude/done-b (merge queue: tested as queue/pr-10 aaaaaaaa)');
  // feat-a opens a phase branch
  git('checkout', '-q', '-b', 'claude/feat-a'); commit('feat-a s1: contract');
  // meanwhile main takes a store-less hotfix (#11) and done-b's second landing (#12)
  git('checkout', '-q', 'main');
  git('checkout', '-q', '-b', 'claude/hotfix-x'); commit('hotfix: one line');
  git('checkout', '-q', 'main'); const pr11 = mergeNoFf('claude/hotfix-x', 'Merge pull request #11 from MossesX/claude/hotfix-x (merge queue: tested as queue/pr-11 bbbbbbbb)');
  git('checkout', '-q', 'claude/done-b'); commit('done-b: report');
  git('checkout', '-q', 'main'); const pr12 = mergeNoFf('claude/done-b', 'Merge pull request #12 from MossesX/claude/done-b (merge queue: tested as queue/pr-12 cccccccc)');
  commit('Builds live: feat-a note (all) [skip ci]');
  // feat-a lands its phase by build_land: merge main into the branch, fast-forward main to it
  git('checkout', '-q', 'claude/feat-a'); commit('feat-a s2: engine');
  const land = mergeNoFf('main', 'Merge origin/main into claude/feat-a (build_land)');
  git('checkout', '-q', 'main'); git('merge', '-q', '--ff-only', 'claude/feat-a');

  const fp = git('rev-list', '--first-parent', 'main').split('\n');
  const landings = W.mainLandings({ ref: 'main', cwd: repo, now: '2026-11-14T12:00:00Z' }).filter((e) => e.state !== 'skipped');
  const bySha = new Map(landings.map((e) => [e.sha, e]));

  console.log('walk');
  check('the fast-forward hides the PR merges from main\'s first-parent line', () => { assert.ok(fp.includes(pr10), '#10 landed before feat-a branched'); for (const s of [pr11, pr12]) assert.ok(!fp.includes(s), `${s.slice(0, 9)} is on the first-parent line`); });
  check('the walk still finds every PR merge behind the build_land merge', () => { for (const [s, pr] of [[pr10, 10], [pr11, 11], [pr12, 12]]) assert.equal(bySha.get(s)?.pr, pr); });
  check('the build_land merge is one landing of feat-a with its own commits', () => { const e = bySha.get(land); assert.equal(e?.kind, 'build-land'); assert.equal(e.build, 'feat-a'); assert.equal(e.commits.length, 3); });
  check('status-only commits never become landings', () => assert.ok(!landings.some((e) => /^Builds live/.test(e.subject))));
  check('a branch merging a non-main branch is not followed', () => assert.equal(W.mergesMain({ parents: ['a', 'b'], subject: "Merge branch 'claude/other' into claude/feat-a" }), false));

  // store: feat-a still running with open steps; done-b complete and shipped for PR #10; hotfix-x unknown
  writeFileSync(store, JSON.stringify({ $axf: 'builds@1', builds: [
    { id: 'feat-a', title: 'Feat A', status: 'running', branch: 'claude/feat-a', steps: [{ id: 's1', title: 'contract', done: true }, { id: 's3', title: 'later' }] },
    { id: 'done-b', title: 'Done B', status: 'complete', branch: 'claude/done-b', pr: '#10', mergedAt: bySha.get(pr10).at, steps: [] },
  ] }));
  const pre = shipLanded({ landings: landings.filter((e) => e.sha === pr10), now: '2026-11-14T12:00:00Z', env: process.env });
  assert.equal(pre.shipped.length, 1, `seed ship: ${JSON.stringify(pre)}`);

  console.log('shipLanded (the after-tick send)');
  const r = shipLanded({ landings, now: '2026-11-14T12:00:00Z', env: process.env });
  const ids = r.shipped.map((s) => `${s.id}@${s.pr || s.sha.slice(0, 7)}`);
  check('no landing failed to send', () => assert.deepEqual(r.shipped.filter((s) => s.error), []));
  check('a phase landing of a running build ships', () => assert.ok(r.shipped.some((s) => s.id === 'feat-a' && s.sha === land), ids.join(', ')));
  check('a store-less hotfix PR ships under its branch', () => assert.ok(r.shipped.some((s) => s.id === 'hotfix-x' && s.pr === 11), ids.join(', ')));
  check('a second landing of a shipped build ships as rev 2', () => { const s = r.shipped.find((x) => x.pr === 12); assert.equal(s?.id, 'done-b'); assert.equal(s.rev, 2); });
  check('the already shipped landing (#10) does not go out again', () => assert.ok(!r.shipped.some((s) => s.pr === 10)));
  check('running it again sends nothing', () => assert.deepEqual(shipLanded({ landings, now: '2026-11-14T12:00:00Z', env: process.env }).shipped, []));
  check('the manifest names the landing sha', () => assert.equal(readManifest('feat-a')?.landedCommit, land));
  check('sentFor: an old manifest with no landedCommit matches a PR-less landing within 30 min', () => {
    assert.equal(sentFor({ landedCommit: '', landedAt: '2026-11-13T23:38:48Z', pr: { number: 661 } }, { sha: 'f'.repeat(40), pr: 0, at: '2026-11-13T23:39:14Z', commits: [] }), true);
    assert.equal(sentFor({ landedCommit: 'a'.repeat(40), landedAt: '2026-11-13T23:38:48Z' }, { sha: 'f'.repeat(40), pr: 0, at: '2026-11-13T23:39:14Z', commits: [] }), false);
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;

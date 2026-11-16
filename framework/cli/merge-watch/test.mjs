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
// the watch's own switches: no GitHub, no ledger, no alerts, no fetch, no background ticks; local sends only
Object.assign(process.env, { AXF_MERGE_WATCH_GITHUB: 'off', AXF_MERGE_WATCH_LEDGER: 'off', AXF_MERGE_WATCH_ALERTS: 'off', AXF_MERGE_WATCH_FETCH: 'off', AXF_MERGE_WATCH_KICK: 'off', AXF_MERGE_WATCH_SEND: 'local', AXF_MERGE_WATCH_DATA: join(tmp, 'mw'), AXF_MERGE_WATCH_REPO: repo, AXF_MERGE_WATCH_REF: 'main' });

const W = await import('./walk.mjs');
const { shipLanded, sentFor } = await import('../shipped.mjs');
const { readManifest } = await import('../shipped-files.mjs');

let n = 0; const T0 = Date.parse('2026-11-14T10:00:00Z');
const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: new Date(T0 + n * 60e3).toISOString(), GIT_COMMITTER_DATE: new Date(T0 + n * 60e3).toISOString() } }).trim();
const commit = (msg) => { n += 1; writeFileSync(join(repo, `f${n}.txt`), msg); git('add', '.'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
const mergeNoFf = (branch, msg) => { n += 1; git('merge', '-q', '--no-ff', branch, '-m', msg); return git('rev-parse', 'HEAD'); };

let failed = 0; let passed = 0;
const check = (name, fn) => { try { fn(); passed += 1; console.log(`  ✓ ${name}`); } catch (e) { failed += 1; console.log(`  ✗ ${name}\n    ${e.message.split('\n').join('\n    ')}`); } };
const acheck = async (name, fn) => { try { await fn(); passed += 1; console.log(`  ✓ ${name}`); } catch (e) { failed += 1; console.log(`  ✗ ${name}\n    ${e.message.split('\n').join('\n    ')}`); } };

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

  // ---------------------------------------------------------------- s15: mapper, builder, sender, retry, lock, backfill
  const MW = await import('../../core/merge-watch.mjs');
  const { mapCommit, buildOf } = await import('./map-commit.mjs');
  const { buildManifest } = await import('./build-manifest.mjs');
  const S = await import('./send.mjs');
  const R = await import('./retry.mjs');
  const CLI = await import('../merge-watch.mjs');
  const { loadStore } = await import('../builds-store.mjs');
  const entryOf = (sha) => { const [h, p, at, sub] = git('log', '-1', '--format=%H%x1f%P%x1f%cI%x1f%s', sha).split('\x1f'); return MW.landingsOf([{ sha: h, parents: p.split(' '), at, subject: sub }], { now: '2026-11-20T00:00:00Z' })[0]; };
  const gh = (routes) => async (path) => { for (const [re, body] of routes) if (re.test(path)) return body; return null; };

  console.log('mapper');
  git('checkout', '-q', 'main');
  git('checkout', '-q', '-b', 'claude/squash-c'); commit('squash-c: work'); git('checkout', '-q', 'main');
  git('merge', '-q', '--squash', 'claude/squash-c'); n += 1; git('commit', '-q', '-m', 'Squash C: one change (#21)'); const squash = git('rev-parse', 'HEAD');
  const push = commit('hotfix typo in a doc');
  await acheck('a merge commit: PR and branch from the subject, build by branch, files and areas from base..sha', async () => {
    const m = await mapCommit(bySha.get(pr11), { store: loadStore(), github: gh([]) });
    assert.equal(m.entry.pr, 11); assert.equal(m.entry.branch, 'claude/hotfix-x'); assert.equal(m.build.id, 'hotfix-x');
    assert.equal(m.files.length, 1, 'the hotfix branch\'s one file'); assert.match(m.files[0], /^f\d+\.txt$/); assert.ok(m.areas.length >= 1);
  });
  await acheck('a squash commit: the PR from "(#N)", the head branch from GitHub', async () => {
    const m = await mapCommit(entryOf(squash), { store: loadStore(), github: gh([[/\/pulls\/21$/, { number: 21, title: 'Squash C', head: { ref: 'claude/squash-c' }, merged_at: '2026-11-14T11:00:00Z', merge_commit_sha: squash }]]) });
    assert.equal(m.entry.pr, 21); assert.equal(m.entry.branch, 'claude/squash-c'); assert.equal(m.build.id, 'squash-c'); assert.equal(m.pr.mergedAt, '2026-11-14T11:00:00Z');
  });
  await acheck('a push with no PR: GitHub has none, no build, unlinked', async () => {
    const m = await mapCommit(entryOf(push), { store: loadStore(), github: gh([[/\/commits\/.*\/pulls$/, []]]) });
    assert.equal(m.pr, null); assert.equal(m.build.id, ''); assert.equal(m.entry.pr, 0);
  });
  check('build lookup order: branch, store PR link, store branch, build-origin, subject prefix', () => {
    const st = { builds: [{ id: 'one', pr: '#5' }, { id: 'two', branch: 'claude/other-name' }] };
    assert.deepEqual(buildOf({ branch: 'claude/one', pr: 0 }, { store: st }), { id: 'one', via: 'branch' });
    assert.deepEqual(buildOf({ branch: 'claude/x-report', pr: 5 }, { store: st }), { id: 'one', via: 'store-pr' });
    assert.deepEqual(buildOf({ branch: 'claude/other-name', pr: 0 }, { store: st }), { id: 'two', via: 'store-branch' });
    assert.deepEqual(buildOf({ branch: 'claude/said-only', pr: 0 }, { store: st, origins: { 'said-only': { said: 'x' } } }), { id: 'said-only', via: 'origin' });
    assert.deepEqual(buildOf({ branch: '', pr: 0, guess: 'two' }, { store: st }), { id: 'two', via: 'guess' });
  });

  console.log('builder');
  await acheck('a manifest: mergedAt from the PR, landedAt from the commit, CI runs and the report as tests, Brett\'s words from build-origin', async () => {
    const root = join(tmp, 'root'); mkdirSync(join(root, '_claude/builds/reports'), { recursive: true });
    writeFileSync(join(root, '_claude/builds/reports/squash-c.md'), '# Squash C\n\n## Tests\n\n- node test.mjs: 3 passed\n');
    const m = await mapCommit(entryOf(squash), { store: loadStore(), github: gh([[/\/pulls\/21$/, { number: 21, title: 'Squash C', head: { ref: 'claude/squash-c' }, merged_at: '2026-11-14T11:00:00Z', merge_commit_sha: squash }]]) });
    const b = await buildManifest(m, { store: loadStore(), root, origins: { 'squash-c': { said: 'make C one change', verbatim: true, source: 'voice', at: '2026-11-14T09:00:00Z' } },
      github: gh([[/actions\/runs/, { workflow_runs: [{ name: 'Android', run_number: 2, status: 'completed', conclusion: 'success', html_url: 'u' }, { name: 'Android', run_number: 1, status: 'completed', conclusion: 'failure' }] }]]) });
    assert.ok(b.valid.ok, JSON.stringify(b.valid.errors)); assert.equal(b.unlinked, false);
    assert.equal(b.manifest.mergedAt, '2026-11-14T11:00:00Z'); assert.equal(b.manifest.landedAt, entryOf(squash).at); assert.equal(b.manifest.landedCommit, squash);
    assert.deepEqual(b.manifest.tests.find((t) => t.name === 'CI: Android')?.result, 'pass'); assert.equal(b.manifest.tests.filter((t) => t.name === 'CI: Android').length, 1, 'newest run per workflow');
    assert.equal(b.manifest.report, '_claude/builds/reports/squash-c.md'); assert.equal(b.manifest.said.text, 'make C one change'); assert.equal(b.manifest.said.verbatim, true);
  });
  await acheck('a landing with no build goes out unlinked: main-<sha9>, its subject, not verbatim', async () => {
    const b = await buildManifest(await mapCommit(entryOf(push), { store: loadStore(), github: gh([]) }), { store: loadStore(), github: gh([]) });
    assert.ok(b.valid.ok); assert.equal(b.unlinked, true); assert.equal(b.id, `main-${push.slice(0, 9)}`); assert.equal(b.manifest.said.verbatim, false); assert.equal(b.manifest.said.source, 'git');
  });

  const ghSquash = gh([[/\/pulls\/21$/, { number: 21, title: 'Squash C', head: { ref: 'claude/squash-c' }, merged_at: '2026-11-14T11:00:00Z', merge_commit_sha: squash }]]);
  console.log('sender');
  await acheck('send twice gives one manifest: the second is skipped as already sent', async () => {
    const env = { ...process.env, AXF_SHIPPED_DIR: join(tmp, 'side-1') };
    let st = MW.startState({ ref: 'main', now: '2026-11-20T00:00:00Z' });
    const a = await S.sendOne(st, entryOf(squash), { store: loadStore(), env, github: ghSquash, now: '2026-11-20T00:00:00Z' }); st = a.state;
    const b = await S.sendOne(st, entryOf(squash), { store: loadStore(), env, github: ghSquash, now: '2026-11-20T00:01:00Z' });
    assert.equal(a.result.status, 'sent', a.result.error); assert.equal(b.result.status, 'skipped'); assert.equal(b.result.why, 'already sent');
    assert.equal(readManifest('squash-c', env).rev, 1);
  });
  await acheck('a fresh state finds the sidecar: skipped, recorded sent, no second rev', async () => {
    const env = { ...process.env, AXF_SHIPPED_DIR: join(tmp, 'side-1') };
    const r = await S.sendOne(MW.startState({ ref: 'main', now: '2026-11-20T00:00:00Z' }), entryOf(squash), { store: loadStore(), env, github: ghSquash, now: '2026-11-20T00:02:00Z' });
    assert.equal(r.result.why, 'in the sidecar'); assert.equal(r.state.entries[squash].state, 'sent'); assert.equal(readManifest('squash-c', env).rev, 1);
  });
  await acheck('an unlinked landing writes only the sidecar (no main-* build in the store)', async () => {
    const env = { ...process.env, AXF_SHIPPED_DIR: join(tmp, 'side-2') };
    const r = await S.sendOne(MW.startState({ ref: 'main', now: '2026-11-20T00:00:00Z' }), entryOf(push), { store: loadStore(), env, github: gh([]), now: '2026-11-20T00:00:00Z' });
    assert.equal(r.result.status, 'sent'); assert.ok(readManifest(`main-${push.slice(0, 9)}`, env)); assert.ok(!loadStore().builds.some((b) => b.id.startsWith('main-')));
  });
  await acheck('a failing transport records failed with a 1-minute retry', async () => {
    const off = S.registerTransport('boom', async () => { throw new Error('ledger down'); });
    try {
      const env = { ...process.env, AXF_SHIPPED_DIR: join(tmp, 'side-3'), AXF_MERGE_WATCH_SEND: 'boom' };
      const r = await S.sendOne(MW.startState({ ref: 'main', now: '2026-11-20T00:00:00Z' }), entryOf(push), { store: loadStore(), env, github: gh([]), now: '2026-11-20T00:00:00Z' });
      assert.equal(r.result.status, 'failed'); assert.match(r.result.error, /ledger down/); assert.equal(r.state.entries[push].nextRetryAt, '2026-11-20T00:01:00Z');
    } finally { off(); }
  });

  console.log('retry and alert');
  check('backoff 1, 5, 15, 60 min; the alert once at the 3rd failure; Retry resets and resolves it', () => {
    const env = { ...process.env, AXF_MERGE_WATCH_DATA: join(tmp, 'mw-alert') };
    let st = MW.normState({ ...MW.startState({ now: '2026-11-20T00:00:00Z' }), entries: { [push]: { ...entryOf(push), state: 'pending' } } });
    const posts = []; const post = (p) => posts.push(p); const waits = [];
    for (let i = 0; i < 4; i += 1) { const t = new Date(Date.parse('2026-11-20T00:00:00Z') + i * 3600e3).toISOString(); st = MW.markFailed(st, push, 'x', t); waits.push((Date.parse(st.entries[push].nextRetryAt) - Date.parse(t)) / 60e3); R.syncAlert(st, { env, post }); }
    assert.deepEqual(waits, [1, 5, 15, 60]); assert.deepEqual(posts, ['/api/alerts']);
    const back = R.retryAll(st); assert.equal(back.state.entries[push].state, 'pending'); R.syncAlert(back.state, { env, post }); assert.deepEqual(posts, ['/api/alerts', '/api/alerts/resolve']);
  });

  console.log('lock');
  check('one tick at a time: a held lock refuses, a dead holder\'s lock is taken', () => {
    const env = { ...process.env, AXF_MERGE_WATCH_DATA: join(tmp, 'mw-lock') };
    const un = CLI.takeLock(env); assert.ok(un); assert.equal(CLI.takeLock(env), null); un();
    mkdirSync(join(tmp, 'mw-lock'), { recursive: true }); writeFileSync(join(tmp, 'mw-lock', 'tick.lock'), JSON.stringify({ pid: 999999, at: '2026-11-20T00:00:00Z' }));
    const again = CLI.takeLock(env); assert.ok(again, 'stale lock taken'); again();
  });

  console.log('backfill range');
  await acheck('backfill --since takes only landings from that date on, and a second run sends nothing', async () => {
    const env = { ...process.env, AXF_MERGE_WATCH_DATA: join(tmp, 'mw-bf'), AXF_SHIPPED_DIR: join(tmp, 'side-bf') };
    const since = bySha.get(pr12).at;
    const a = await CLI.backfill({ since, env, now: '2026-11-20T00:00:00Z' });
    assert.ok(a.ok, JSON.stringify(a.results.filter((r) => r.status === 'failed')));
    assert.ok(a.results.every((r) => r.at >= since), 'nothing older than since'); assert.ok(!a.results.some((r) => r.sha === pr10 || r.sha === pr11));
    assert.ok(a.results.some((r) => r.sha === pr12 && r.status === 'sent')); assert.ok(a.results.some((r) => r.sha === land && r.status === 'sent'));
    const b = await CLI.backfill({ since, env, now: '2026-11-20T00:05:00Z' });
    assert.equal(b.results.filter((r) => r.status === 'sent').length, 0);
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;

#!/usr/bin/env node
/**
 * merge-confirm@1 IO against a fake GitHub (framework/cli/merge-confirm.mjs): the read-back decides, never the merge call.
 * Cases: MERGED with the merge commit on main, MERGED but the commit missing from main, still OPEN, an API error, the
 * timeout (--wait on a fake clock), ETag reuse (a 304 costs no call) and the poller tick.
 *   node framework/spec/check-merge-confirm-io.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confirm, getRecord, makeGitHub, recordCall, requestMerge, tick } from '../cli/merge-confirm.mjs';

const REPO = 'mossesx/amberx-axf';
const SHA = 'a'.repeat(40);
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`  ✓ ${name}`); };

/** A fake api.github.com: `prs[pr]` = the pull as GitHub returns it, `compare[sha]` = status | 404, `fail` = HTTP status. */
function fakeGitHub(world) {
  const seen = [];
  const json = (status, body, etag) => new Response(status === 304 ? null : JSON.stringify(body), { status, headers: { 'x-ratelimit-remaining': '4000', ...(etag ? { etag } : {}) } });
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    seen.push({ path, inm: init.headers['If-None-Match'] || '' });
    if (world.fail) return json(world.fail, { message: 'Server Error' });
    let m = /\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/.exec(path);
    if (m) {
      const pr = world.prs[m[1]];
      if (!pr) return json(404, { message: 'Not Found' });
      const etag = `"pr-${m[1]}-${pr.state}-${pr.merged}"`;
      if (init.headers['If-None-Match'] === etag) return json(304, null, etag);
      return json(200, { number: Number(m[1]), base: { ref: 'main' }, ...pr }, etag);
    }
    m = /\/compare\/([0-9a-f]{40})\.\.\.main$/.exec(path);
    if (m) {
      const c = world.compare[m[1]];
      return c === 404 || c === undefined ? json(404, { message: 'Not Found' }) : json(200, { status: c, commits: [] }, `"cmp-${m[1]}-${c}"`);
    }
    return json(404, { message: 'Not Found' });
  };
  return { fetchImpl, seen };
}

const dirs = [];
function setup(world, pr) {
  const dir = mkdtempSync(join(tmpdir(), 'mc-io-')); dirs.push(dir);
  const fake = fakeGitHub(world);
  const gh = makeGitHub({ dir, api: 'https://gh.test', token: () => 'test-token', fetchImpl: fake.fetchImpl });
  requestMerge({ repo: REPO, pr, path: 'script', by: 'check', at: '2026-11-13T10:00:00Z' }, dir);
  // the merge API's 200 with merged: true: a hint only
  recordCall(REPO, pr, { status: 200, merged: true, sha: SHA, message: 'Pull Request successfully merged' }, { at: '2026-11-13T10:00:01Z' }, dir);
  return { dir, gh, fake };
}
const merged = { state: 'closed', merged: true, merged_at: '2026-11-13T10:00:02Z', merge_commit_sha: SHA };

console.log('merge-confirm IO (fake GitHub)');
try {
  await t('the merge call alone leaves the record pending, never merged', async () => {
    const { dir } = setup({ prs: {}, compare: {} }, 1);
    const r = getRecord(REPO, 1, dir);
    assert.equal(r.state, 'pending-github-confirmation');
    assert.equal(r.label, 'Pending GitHub confirmation');
  });

  await t('MERGED with the merge commit on main = merged, with the evidence', async () => {
    const { dir, gh } = setup({ prs: { 2: merged }, compare: { [SHA]: 'ahead' } }, 2);
    const r = await confirm(REPO, 2, { gh, dir, now: () => '2026-11-13T10:00:05Z' });
    assert.equal(r.state, 'merged');
    assert.equal(r.evidence.mergeCommitSha, SHA);
    assert.equal(r.evidence.onMain, true);
  });

  await t('MERGED but the merge commit not on main = still pending, not merged', async () => {
    const { dir, gh } = setup({ prs: { 3: merged }, compare: { [SHA]: 404 } }, 3);
    const r = await confirm(REPO, 3, { gh, dir, now: () => '2026-11-13T10:00:05Z' });
    assert.equal(r.state, 'pending-github-confirmation');
    assert.notEqual(r.evidence?.onMain, true);
  });

  await t('still OPEN on GitHub = pending, whatever the merge call said', async () => {
    const { dir, gh } = setup({ prs: { 4: { state: 'open', merged: false, merge_commit_sha: null } }, compare: {} }, 4);
    const r = await confirm(REPO, 4, { gh, dir, now: () => '2026-11-13T10:00:05Z' });
    assert.equal(r.state, 'pending-github-confirmation');
  });

  await t('an API error never ends or merges a record', async () => {
    const { dir, gh } = setup({ prs: { 5: merged }, compare: { [SHA]: 'ahead' }, fail: 502 }, 5);
    const r = await confirm(REPO, 5, { gh, dir, now: () => '2026-11-13T10:00:05Z' });
    assert.equal(r.state, 'pending-github-confirmation');
    assert.equal(getRecord(REPO, 5, dir).state, 'pending-github-confirmation');
  });

  await t('timeout: still open at the deadline (--wait, fake clock) = merge-unconfirmed with the reason', async () => {
    const { dir, gh } = setup({ prs: { 6: { state: 'open', merged: false, merge_commit_sha: null } }, compare: {} }, 6);
    let clock = Date.parse('2026-11-13T10:00:05Z');
    const r = await confirm(REPO, 6, { gh, dir, wait: true, now: () => new Date(clock).toISOString(), sleep: async (ms) => { clock += ms; } });
    assert.equal(r.state, 'merge-unconfirmed');
    assert.match(r.why, /still open/);
    assert.match(r.history.at(-1).why, /no confirmation within 10 min/);
  });

  await t('ETag: a second read sends If-None-Match and the 304 costs no call', async () => {
    const world = { prs: { 7: { state: 'open', merged: false, merge_commit_sha: null } }, compare: {} };
    const { dir, gh, fake } = setup(world, 7);
    await confirm(REPO, 7, { gh, dir, now: () => '2026-11-13T10:00:05Z' });
    const calls = gh.calls;
    await confirm(REPO, 7, { gh, dir, now: () => '2026-11-13T10:00:30Z' });
    assert.equal(gh.calls, calls);
    assert.ok(gh.cached >= 1);
    assert.ok(fake.seen.at(-1).inm.startsWith('"pr-7'));
  });

  await t('tick: a pending merge GitHub later proves becomes merged; the open one stays pending', async () => {
    const world = { prs: { 8: { state: 'open', merged: false, merge_commit_sha: null }, 9: { state: 'open', merged: false, merge_commit_sha: null } }, compare: { [SHA]: 'identical' } };
    const { dir, gh } = setup(world, 8);
    requestMerge({ repo: REPO, pr: 9, path: 'merge-queue', at: '2026-11-13T10:00:00Z' }, dir);
    recordCall(REPO, 9, { status: 200, merged: true, sha: SHA }, { at: '2026-11-13T10:00:01Z' }, dir);
    world.prs[8] = merged;
    const out = await tick({ gh, dir, now: () => '2026-11-13T10:01:00Z' });
    assert.deepEqual(out.merged, [`${REPO}#8`]);
    assert.equal(getRecord(REPO, 9, dir).state, 'pending-github-confirmation');
    assert.equal(out.pending, 1);
  });
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
console.log(`check-merge-confirm-io: ${n} checks passed`);

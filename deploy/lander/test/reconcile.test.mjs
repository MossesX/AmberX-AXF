// node --test deploy/lander/test/reconcile.test.mjs — the builds reconciler's part of the lander repair (L2-01, L2-11):
// its GitHub token, git in the checkout wherever it is started, a failed run that still reports, and the lander's own
// rule for a PR merged or closed by hand. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sh, repo, github, build, clock, base } from './helpers.mjs';

const R = await import('../../../framework/cli/builds-reconcile.mjs');
const { tick, files } = await import('../run.mjs');
const G = await import('../git.mjs');
const { memoryStore } = await import('../store.mjs');

/** A checkout root whose token broker prints `token` (or fails when it is ''). */
function brokerRoot(token) {
  const root = mkdtempSync(join(tmpdir(), 'reconcile-broker-'));
  mkdirSync(join(root, 'framework', 'cli'), { recursive: true });
  writeFileSync(join(root, 'framework', 'cli', 'github-token.mjs'), token ? `console.log(${JSON.stringify(token)});\n` : 'console.error("no GitHub token"); process.exit(1);\n');
  return root;
}

test('L2-11: the reconciler takes the token broker\'s token (as the lander does), not whatever login the host has', () => {
  const env = { ...process.env, GITHUB_TOKEN: 'from-the-environment' };
  assert.equal(R.reconcileToken({ root: brokerRoot('from-the-broker'), env }), 'from-the-broker');
  const saved = process.env.GITHUB_TOKEN; process.env.GITHUB_TOKEN = 'old-order';
  try { assert.equal(R.reconcileToken({ root: brokerRoot('') }), 'old-order', 'no broker token: the old order still answers'); }
  finally { if (saved === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = saved; }
});

test('L2-11: git runs in the checkout wherever the reconciler is started; a failing fetch is reported, not swallowed', async () => {
  const r = repo({ 'claude/x': { 'x.txt': 'x\n' } });
  const outside = mkdtempSync(join(tmpdir(), 'reconcile-cwd-'));
  const cwd = process.cwd(); process.chdir(outside);
  try {
    assert.equal(R.gitIn(r.work, ['rev-parse', '--is-inside-work-tree']).out, 'true', 'started outside any repository, git still runs in the checkout');
    const bad = R.gitIn(outside, ['rev-parse', 'HEAD']);
    assert.equal(bad.ok, false); assert.match(bad.err, /not a git repository/);
    const gh = { json: async () => ({ data: { repository: { open: { nodes: [] }, done: { nodes: [{ number: 867, headRefName: 'lander/b', title: 't', body: '', state: 'MERGED', mergedAt: '2026-11-21T02:24:00Z', updatedAt: '2026-11-21T02:24:00Z' }] } } } }) };
    const ok = await R.gather({ gh, repo: 'o/r', root: r.work });
    assert.equal(ok.gitError, ''); assert.deepEqual(ok.branches.map((b) => b.name), ['claude/x']); assert.equal(ok.prs[0].state, 'merged');
    const broken = await R.gather({ gh, repo: 'o/r', root: outside });
    assert.match(broken.gitError, /git fetch in .*not a git repository/); assert.equal(broken.prs.length, 1, 'GitHub\'s side is still read');
  } finally { process.chdir(cwd); }
});

test('L2-11: a reconcile run that fails still leaves a report the systems check shows', () => {
  const rep = R.failedReport(new Error('GitHub 401: Bad credentials'), { at: '2026-11-21T10:00:00.000Z', repo: 'o/r' });
  assert.equal(rep.$axf, 'builds-reconcile@1'); assert.equal(rep.apply, true); assert.equal(rep.failed, true);
  assert.equal(rep.error, 'the reconcile run failed: GitHub 401: Bad credentials');
  assert.deepEqual(rep.orphans, { prs: [], branches: [] }); assert.deepEqual(rep.changes, []);
});

test('L2-01: the reconciler hands a landing build whose PR GitHub shows merged or closed to the lander\'s rule', async () => {
  const landing = (id, pr, more = {}) => ({ id, flow: 'pipeline-2', status: 'failed', steps: [{ id: 's1', status: 'in-pr', prNumber: pr }], ...more });
  const builds = [landing('stuck', 867), landing('open', 900), landing('done', 850, { landing: { merged: [850] } }), { id: 'old-flow', status: 'running', steps: [{ id: 's1', status: 'in-pr', prNumber: 867 }] }, landing('gone', 801)];
  const prs = [{ number: 867, state: 'merged' }, { number: 900, state: 'open' }, { number: 850, state: 'merged' }, { number: 801, state: 'closed' }];
  let calls = 0;
  const lander = { syncPrs: async () => { calls++; return { ok: true, actions: ['stuck: PR #867 was merged by hand (abc123def, CI success): recorded'], error: '', skipped: '' }; } };
  assert.deepEqual(await R.syncLanding(builds, prs, { apply: false, lander }), { asked: ['stuck', 'gone'], actions: [], error: '', skipped: 'dry run' });
  assert.equal(calls, 0, 'a dry run asks nothing');
  const done = await R.syncLanding(builds, prs, { apply: true, lander });
  assert.equal(calls, 1); assert.deepEqual(done.asked, ['stuck', 'gone']); assert.match(done.actions[0], /PR #867 was merged by hand/);
  assert.equal(await R.syncLanding([landing('open', 900)], prs, { apply: true, lander }), null, 'every PR in flight open: the lander is not asked');
  const boom = await R.syncLanding(builds, prs, { apply: true, lander: { syncPrs: async () => { throw new Error('store locked'); } } });
  assert.equal(boom.error, 'store locked', 'a failure is reported, never swallowed');
});

test('L2-01: sync-prs records a hand merge without working on anything, even while the lander is paused', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  let state = 'running'; const gh = github(r, () => state);
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  const opts = base(r, gh, store, now);
  await tick(opts);
  gh.mergeByHand(1); state = 'success'; now.add(1);
  G.writeJson(files(r.s).control, { paused: true });
  assert.equal((await tick(opts)).waiting, 'paused');
  assert.deepEqual(store.list[0].landing?.merged ?? [], [], 'a paused tick does nothing');
  const out = await tick({ ...opts, syncOnly: true });
  const b = store.list[0];
  assert.deepEqual(b.landing.merged, [1]); assert.equal(b.landing.lastMerge.byHand, true); assert.equal(b.landing.lastMerge.ci, 'success');
  assert.equal(b.status, 'merging-pr', 'recorded; the landing itself is the next tick\'s');
  assert.equal(out.build, ''); assert.ok(out.actions.some((a) => /^b: PR #1 was merged by hand/.test(a)));
  assert.equal(gh.calls.filter((c) => c.startsWith('PUT')).length, 0);
  await tick({ ...opts, syncOnly: true });
  assert.deepEqual(store.list[0].landing.merged, [1], 'asked twice, recorded once');
  G.writeJson(files(r.s).control, { paused: false }); now.add(1);
  await tick(opts);
  assert.equal(store.list[0].status, 'landed');
  assert.ok(sh(r.work, 'log', '--oneline', 'origin/main').includes('Merge #1'));
});

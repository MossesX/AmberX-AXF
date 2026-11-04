// Merge queue self-test: the pure rules (merge-queue-core.mjs) and one round of the runner against a real local git
// repo with a fake GitHub (no network, no model). Run: node apps/console-web/plugins/push-banner/land/merge-queue.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as q from './merge-queue-core.mjs';
import { queueRound, readQueue, queueControl } from './merge-queue.mjs';
import { makeGit } from './land.mjs';

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`ok ${name}`); };

// ------------------------------------------------------------------ pure rules

await t('not ready: draft, removed, kicked at the same head, UI Review, PR checks', () => {
  const pr = { number: 5, head: 'a', ci: 'success' };
  assert.equal(q.notReady(pr), '');
  assert.match(q.notReady({ ...pr, draft: true }), /draft/);
  assert.match(q.notReady(pr, { removed: { 5: { head: 'a' } } }), /by hand/);
  assert.equal(q.notReady({ ...pr, head: 'b' }, { removed: { 5: { head: 'a' } } }), '', 'a new commit puts it back');
  assert.match(q.notReady(pr, { kicked: { 5: { head: 'a', why: 'x' } } }), /kicked out/);
  assert.equal(q.notReady({ ...pr, head: 'b' }, { kicked: { 5: { head: 'a' } } }), '', 'a fix rejoins by itself');
  assert.equal(q.notReady(pr, { kicked: { 5: { head: 'a' } }, added: [5] }), '', 'Add puts a kicked PR back');
  assert.match(q.notReady({ ...pr, ui: 'waiting' }), /UI Review/);
  assert.equal(q.notReady({ ...pr, ui: 'waiting' }, {}, { waitUi: false }), '');
  assert.match(q.notReady({ ...pr, ci: 'failure' }), /red/);
  assert.match(q.notReady({ ...pr, ci: 'running' }), /running/);
});

await t('queue order: Brett first, then landing order, then oldest', () => {
  const prs = [{ number: 1, createdAt: '2026-11-01' }, { number: 2, createdAt: '2026-11-02' }, { number: 3, createdAt: '2026-11-03' }];
  assert.deepEqual(q.queueOrder(prs).map((p) => p.number), [1, 2, 3]);
  assert.deepEqual(q.queueOrder(prs, {}, { 3: 0 }).map((p) => p.number), [3, 1, 2]);
  assert.deepEqual(q.queueOrder(prs, { order: [2] }, { 3: 0 }).map((p) => p.number), [2, 3, 1]);
});

await t('stack holds only while order, heads and main hold', () => {
  const stack = [{ pr: 1, head: 'a', ahead: [], sha: 'q1' }, { pr: 2, head: 'b', ahead: [1], sha: 'q2' }, { pr: 3, head: 'c', ahead: [1, 2], sha: 'q3' }];
  const queue = [{ number: 1, head: 'a' }, { number: 2, head: 'b' }, { number: 3, head: 'c' }];
  assert.equal(q.keepStack(stack, queue).length, 3);
  assert.equal(q.keepStack(stack, queue, { mainMoved: true }).length, 0);
  assert.equal(q.keepStack(stack, [queue[0], { number: 2, head: 'B' }, queue[2]]).length, 1, 'a new commit rebuilds from there');
  assert.equal(q.keepStack(stack, [queue[1], queue[0], queue[2]]).length, 0, 'reordered: rebuilt');
  // #1 merged: #2 and #3 still hold (their runs included #1)
  assert.equal(q.keepStack(stack.slice(1), queue.slice(1), { merged: new Set([1]) }).length, 2);
  // #2 kicked out: #3 was built on it, so it is rebuilt
  assert.equal(q.keepStack(stack, [queue[0], queue[2]]).length, 1);
});

await t('decide: green head merges in order, red is blamed only when everything ahead passed', () => {
  const st = [{ pr: 1 }, { pr: 2 }, { pr: 3 }];
  assert.deepEqual(q.decide(st, { 1: 'success', 2: 'success', 3: 'running' }), { merge: [1, 2], kick: null, keep: 3 });
  assert.deepEqual(q.decide(st, { 1: 'running', 2: 'failure' }), { merge: [], kick: null, keep: 3 }, '#2 may be red because of #1: wait');
  assert.deepEqual(q.decide(st, { 1: 'success', 2: 'failure', 3: 'failure' }), { merge: [1], kick: 2, keep: 1 });
  assert.deepEqual(q.decide(st, { 1: 'failure', 2: 'success' }), { merge: [], kick: 1, keep: 0 });
});

await t('control: add, remove, move, kick; reasons and ETA', () => {
  let c = q.applyQueueControl({}, 'remove', 7, { head: 'h', why: 'not yet' });
  assert.equal(c.removed[7].head, 'h');
  c = q.applyQueueControl(c, 'add', '#7'); assert.equal(c.removed[7], undefined); assert.deepEqual(c.added, [7]);
  c = q.applyQueueControl(c, 'move', 9, { to: 0, current: [7, 8, 9] }); assert.deepEqual(c.order, [9, 7, 8]);
  c = q.applyQueueControl(c, 'move', 7, { to: 5, current: [9, 7, 8] }); assert.deepEqual(c.order, [9, 8, 7]);
  assert.throws(() => q.applyQueueControl(c, 'move', 7, { to: -1 }), /index/);
  assert.throws(() => q.applyQueueControl(c, 'add', 'x'), /PR number/);
  assert.deepEqual(q.pruneControl(c, [9]).order, [9]);
  assert.match(q.kickReason(4, { failing: ['console'], ahead: [2, 3] }), /#4 broke CI when tested on top of main \+ #2, #3 \(failed: console\)/);
  assert.equal(q.runMinutes([]), q.DEFAULT_RUN_MIN); assert.equal(q.runMinutes([10, 20]), 15);
  assert.ok(q.etaMinutes(4, { depth: 3, avg: 10 }) > q.etaMinutes(1, { depth: 3, avg: 10 }));
  assert.equal(q.chip({ items: [{}, {}], kicked: [] }).label, 'Merge queue: 2');
  assert.equal(q.sameCodeFiles(['_claude/builds/store.json']), true); assert.equal(q.sameCodeFiles(['a.js']), false);
});

// ------------------------------------------------------------------ one round: real git, fake GitHub

function sh(cwd, ...args) { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); }
const root = mkdtempSync(join(tmpdir(), 'mq-test-'));
const origin = join(root, 'origin.git'); const repo = join(root, 'repo'); const data = join(root, 'data');
mkdirSync(data);
sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
sh(root, 'clone', '-q', origin, repo);
const cfg = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const commit = (file, text, msg) => { writeFileSync(join(repo, file), text); sh(repo, 'add', file); sh(repo, ...cfg, 'commit', '-q', '-m', msg); };
commit('a.txt', 'base\n', 'base');
sh(repo, 'push', '-q', 'origin', 'HEAD:main');
const branch = (name, file, text) => { sh(repo, 'checkout', '-q', '-b', name, 'origin/main'); commit(file, text, name); sh(repo, 'push', '-q', 'origin', `HEAD:${name}`); sh(repo, 'checkout', '-q', '--detach'); return sh(repo, 'rev-parse', 'HEAD'); };
const heads = { 1: branch('b1', 'one.txt', '1\n'), 2: branch('b2', 'two.txt', '2\n'), 3: branch('b3', 'three.txt', '3\n') };
sh(repo, 'fetch', '-q', 'origin');

const s = { repo, slug: 'o/r', dataDir: data, remote: 'origin', base: 'main', archive: join(root, 'archive') };
const git = makeGit(repo);
const ciBySha = {}; const merges = []; const comments = []; const vars = [];
const open = () => [1, 2, 3].filter((x) => !merges.includes(x)).map((x) => ({ number: x, title: `PR ${x}`, html_url: `u/${x}`, created_at: `2026-11-0${x}`, base: { ref: 'main' }, head: { ref: `b${x}`, sha: heads[x], repo: { full_name: 'o/r' } }, user: { login: 'bot' } }));
const runs = (state) => [{ name: 'CI', app: { slug: 'github-actions' }, status: state === 'running' ? 'in_progress' : 'completed', conclusion: state === 'running' ? null : state, started_at: '2026-11-04T10:00:00Z', completed_at: '2026-11-04T10:12:00Z', html_url: 'run/1/job/2' }];
const gh = async (method, path, body) => {
  if (method === 'GET' && path.startsWith('/repos/o/r/pulls?')) return open();
  let m = path.match(/commits\/([0-9a-f]+)\/check-runs/);
  if (m) return { check_runs: runs(Object.values(heads).includes(m[1]) ? 'success' : ciBySha[m[1]] || 'running') };
  m = path.match(/pulls\/(\d+)\/merge$/);
  if (m && method === 'PUT') {
    // GitHub merges the PR head into main (a merge commit), here with plain git
    const x = Number(m[1]); assert.equal(body.sha, heads[x], 'merge pinned to the tested head');
    sh(repo, 'fetch', '-q', 'origin'); sh(repo, 'checkout', '-q', '--detach', 'origin/main'); sh(repo, ...cfg, 'merge', '-q', '--no-ff', '-m', `merge ${x}`, heads[x]);
    sh(repo, 'push', '-q', 'origin', 'HEAD:main'); merges.push(x);
    return { merged: true, sha: sh(repo, 'rev-parse', 'HEAD') };
  }
  if (path.includes('/issues/') && method === 'POST') { comments.push(body.body); return {}; }
  if (path.includes('/actions/variables')) { vars.push(body.value); return {}; }
  if (method === 'DELETE') return {};
  throw new Error(`unexpected ${method} ${path}`);
};
const api = async () => ({ hold: '' });
const queueRef = (x) => sh(origin, 'rev-parse', '-q', '--verify', `refs/heads/queue/pr-${x}`);

await t('round 1: three PRs are stacked on queue branches, each on top of the ones ahead', async () => {
  const st = await queueRound({ s, git, gh, api });
  assert.deepEqual(st.items.map((x) => [x.pr, x.state]), [[1, 'testing'], [2, 'testing'], [3, 'testing']]);
  assert.deepEqual(st.stack.map((e) => e.ahead), [[], [1], [1, 2]]);
  for (const x of [1, 2, 3]) assert.ok(queueRef(x));
  // queue/pr-3 holds all three PRs' files
  const files = sh(origin, 'ls-tree', '--name-only', `queue/pr-3`).split('\n');
  assert.deepEqual(files.sort(), ['a.txt', 'one.txt', 'three.txt', 'two.txt']);
  assert.deepEqual(vars, ['on'], 'the repo variable turns light PR checks on');
});

await t('round 2: #1 green merges, #2 red is kicked out, #3 is rebuilt without it; nothing is tested twice', async () => {
  const st0 = readQueue(s);
  ciBySha[st0.stack[0].sha] = 'success'; ciBySha[st0.stack[1].sha] = 'failure'; ciBySha[st0.stack[2].sha] = 'failure';
  const st = await queueRound({ s, git, gh, api });
  assert.deepEqual(merges, [1]);
  assert.equal(st.merged.at(-1).retested, false);
  assert.match(st.kicked.at(-1).why, /#2 broke CI when tested on top of main/);
  assert.match(comments[0], /Kicked out of the merge queue/);
  assert.deepEqual(st.items.map((x) => x.pr), [3]);
  assert.deepEqual(st.stack[0].ahead, [], '#3 now sits right on main (with #1 in it)');
  assert.ok(sh(origin, 'ls-tree', '--name-only', 'queue/pr-3').includes('one.txt'));
  assert.ok(!sh(origin, 'ls-tree', '--name-only', 'queue/pr-3').includes('two.txt'));
  assert.equal(st.waiting.find((w) => w.pr === 2).state, 'kicked');
});

await t('round 3: status-only main commits keep the stack; #3 green merges with no new queue commit', async () => {
  sh(repo, 'fetch', '-q', 'origin'); sh(repo, 'checkout', '-q', '--detach', 'origin/main');
  mkdirSync(join(repo, '_claude'), { recursive: true }); commit('_claude/store.json', '{}\n', 'Builds live [skip ci]'); sh(repo, 'push', '-q', 'origin', 'HEAD:main');
  const st0 = readQueue(s); const sha = st0.stack[0].sha; ciBySha[sha] = 'success';
  const st = await queueRound({ s, git, gh, api });
  assert.deepEqual(merges, [1, 3]);
  assert.equal(st.merged.at(-1).queueSha, sha, 'merged on the run that tested it');
  assert.deepEqual(st.items, []);
});

await t('remove + add + move go through the control file', async () => {
  queueControl(s, 'remove', 2, { why: 'later' });
  assert.equal(JSON.parse(readFileSync(join(data, 'merge-queue-control.json'), 'utf8')).removed[2].why, 'later');
  queueControl(s, 'add', 2);
  assert.deepEqual(JSON.parse(readFileSync(join(data, 'merge-queue-control.json'), 'utf8')).added, [2]);
});

console.log(`merge queue: ${n} checks passed`);

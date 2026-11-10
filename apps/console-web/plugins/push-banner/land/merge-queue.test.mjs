// Merge queue self-test: the pure rules (merge-queue-core.mjs) and one round of the runner against a real local git
// repo with a fake GitHub (no network, no model). Run: node apps/console-web/plugins/push-banner/land/merge-queue.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as q from './merge-queue-core.mjs';
import { queueRound, readQueue, queueControl, enlist } from './merge-queue.mjs';
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
  assert.match(q.notReady({ ...pr, ci: 'none' }), /not run yet/);
  assert.equal(q.notReady({ ...pr, ci: 'none', conflicted: true }), '', 'no PR checks because it conflicts: straight to its queue run');
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
writeFileSync(join(data, 'config.json'), JSON.stringify({ queueMode: 'stack' })); // the Nov 4 per-PR stack; batch mode is tested below
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

writeFileSync(join(data, 'config.json'), JSON.stringify({ queueMode: 'stack' })); // the Nov 4 stacked queue; batch mode is tested below

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

await t('priority: higher lands first, manual order wins, a running stack is never thrown away', () => {
  const prs = [{ number: 1, head: 'h1', createdAt: '1' }, { number: 2, head: 'h2', createdAt: '2', priority: 'P0' }, { number: 3, head: 'h3', createdAt: '3', priority: 'P3' }];
  assert.deepEqual(q.queueOrder(prs).map((x) => x.number), [2, 1, 3]);
  assert.deepEqual(q.queueOrder(prs, { order: [3] }).map((x) => x.number), [3, 2, 1]);
  const stack = [{ pr: 1, head: 'h1', sha: 's1', ahead: [] }, { pr: 3, head: 'h3', sha: 's3', ahead: [1] }];
  const line = q.queueOrder(prs, {}, {}, stack);
  assert.deepEqual(line.map((x) => x.number), [1, 3, 2]);
  assert.equal(q.keepStack(stack, line).length, 2);
  assert.deepEqual(q.queueOrder(prs, { order: [2] }, {}, stack).map((x) => x.number), [2, 1, 3]); // Brett's move still rebuilds it
});

await t('priority: the host copy of the rule matches framework/core/build-priority.mjs', async () => {
  const { effectivePriority } = await import('../../../../../framework/core/build-priority.mjs');
  for (const b of [{ id: 'x', title: 'Plain' }, { id: 'urgent-ci', title: 'CI' }, { id: 'x', title: 'Hotfix: y' }, { id: 'x', title: 'x', profiles: ['all'], priority: 'P0' },
    { id: 'x', title: 'x', detail: 'URGENT: down' }, { id: 'x', title: 'x', detail: 'not urgent' }, { id: 'x', title: 'x', detail: 'urgent\nnow' }, { id: 'urgent-x', title: 'x', priority: 'P3' }, null]) {
    assert.equal(q.buildPriority(b), effectivePriority(b), JSON.stringify(b));
  }
});

// ------------------------------------------------------------------ batch mode (Nov 10 2026): pure rules

await t('batch settings: batch of 5 by default, bounded, AI fallback off', () => {
  assert.deepEqual(q.queueSettings({}), { mergeQueue: true, depth: 3, mode: 'batch', batchSize: 5, aiResolve: false, waitUi: true });
  assert.equal(q.queueSettings({ batchSize: 11 }).batchSize, 5);
  assert.equal(q.queueSettings({ batchSize: 2, queueMode: 'stack', batchAiResolve: true }).mode, 'stack');
  assert.equal(q.queueSettings({ queueMode: 'nope' }).mode, 'batch');
  assert.ok(q.isQueueBranch('queue/batch-12') && q.isQueueBranch('queue/pr-3') && !q.isQueueBranch('queue/x'));
});

await t('batch pick, hold and decide: five at a time; a red batch is halved until one PR is to blame', () => {
  const line = [1, 2, 3, 4, 5, 6, 7].map((x) => ({ number: x, head: `h${x}` }));
  assert.deepEqual(q.pickBatch(line, { size: 5 }).map((p) => p.number), [1, 2, 3, 4, 5]);
  assert.deepEqual(q.pickBatch(line, { size: 5, suspects: [1, 2, 3, 4, 5] }).map((p) => p.number), [1, 2, 3]);
  assert.deepEqual(q.pickBatch(line, { size: 5, suspects: [4, 5] }).map((p) => p.number), [4]);
  const b = { id: 1, sha: 'x', members: [{ pr: 1, head: 'h1' }, { pr: 2, head: 'h2' }] };
  assert.equal(q.keepBatch(b, line), true);
  assert.equal(q.keepBatch(b, line, { mainMoved: true }), false);
  assert.equal(q.keepBatch(b, [{ number: 1, head: 'h1' }, { number: 2, head: 'NEW' }]), false, 'a new commit rebuilds it');
  assert.equal(q.keepBatch(b, line.slice(1)), false, 'a PR left: rebuilt');
  assert.deepEqual(q.decideBatch(b, 'success'), { action: 'merge' });
  assert.deepEqual(q.decideBatch(b, 'running'), { action: 'wait' });
  assert.deepEqual(q.decideBatch(b, 'failure'), { action: 'split', suspects: [1, 2] });
  assert.deepEqual(q.decideBatch({ members: [{ pr: 2 }] }, 'failure'), { action: 'kick', pr: 2 });
  assert.deepEqual(q.nextSuspects([1, 2, 3, 4], { members: [{ pr: 1 }, { pr: 2 }] }, 'merge'), [3, 4]);
  assert.deepEqual(q.nextSuspects([], { members: [{ pr: 1 }, { pr: 2 }] }, 'split'), [1, 2]);
  assert.match(q.batchTitle(3, [{ number: 1 }, { number: 2 }]), /^Merge queue batch 3: #1, #2$/);
  assert.match(q.batchBody(3, [{ number: 1, title: 'A' }], { left: [{ pr: 2, why: 'conflicts' }] }), /#1 A[\s\S]*Left for the next batch:\n- #2: conflicts/);
  assert.ok(q.batchEtaMinutes(5, { size: 5, avg: 10 }) > q.batchEtaMinutes(0, { size: 5, avg: 10 }));
});

// ------------------------------------------------------------------ batch mode: real git, fake GitHub

const root2 = mkdtempSync(join(tmpdir(), 'mq-batch-'));
const origin2 = join(root2, 'origin.git'); const repo2 = join(root2, 'repo'); const data2 = join(root2, 'data');
mkdirSync(data2);
sh(root2, 'init', '-q', '--bare', '-b', 'main', origin2);
sh(root2, 'clone', '-q', origin2, repo2);
const commit2 = (file, text, msg) => { writeFileSync(join(repo2, file), text); sh(repo2, 'add', file); sh(repo2, ...cfg, 'commit', '-q', '-m', msg); };
commit2('a.txt', 'base\n', 'base');
sh(repo2, 'push', '-q', 'origin', 'HEAD:main');
const branch2 = (name, file, text) => { sh(repo2, 'checkout', '-q', '-b', name, 'origin/main'); commit2(file, text, name); sh(repo2, 'push', '-q', 'origin', `HEAD:${name}`); sh(repo2, 'checkout', '-q', '--detach'); return sh(repo2, 'rev-parse', 'HEAD'); };
// #1–#6 touch their own files; #7 changes a.txt, and so does #8 (a code conflict between the two)
const heads2 = {};
for (const x of [1, 2, 3, 4, 5, 6]) heads2[x] = branch2(`c${x}`, `f${x}.txt`, `${x}\n`);
heads2[7] = branch2('c7', 'a.txt', 'seven\n'); heads2[8] = branch2('c8', 'a.txt', 'eight\n');
sh(repo2, 'fetch', '-q', 'origin');
writeFileSync(join(data2, 'config.json'), JSON.stringify({ batchSize: 5 }));

const s2 = { repo: repo2, slug: 'o/r', dataDir: data2, remote: 'origin', base: 'main', archive: join(root2, 'archive') };
const git2 = makeGit(repo2);
const ci2 = {}; const landed = new Set(); const closed = []; const comments2 = []; const batchPrs = {}; let nextPr = 100; let mainMerges = 0;
let openSet = [1, 2, 3, 4, 5, 6];
const open2 = () => openSet.filter((x) => !landed.has(x)).map((x) => ({ number: x, title: `PR ${x}`, html_url: `u/${x}`, created_at: `2026-11-${String(x).padStart(2, "0")}`, base: { ref: 'main' }, head: { ref: `c${x}`, sha: heads2[x], repo: { full_name: 'o/r' } }, user: { login: 'bot' } }));
const gh2 = async (method, path, body) => {
  if (method === 'GET' && path.startsWith('/repos/o/r/pulls?')) return open2();
  let m = path.match(/commits\/([0-9a-f]+)\/check-runs/);
  if (m) return { check_runs: runs(Object.values(heads2).includes(m[1]) ? 'success' : ci2[m[1]] || 'running') };
  if (method === 'POST' && path === '/repos/o/r/pulls') { const n = nextPr++; batchPrs[n] = body; return { number: n, html_url: `u/${n}` }; }
  m = path.match(/pulls\/(\d+)\/merge$/);
  if (m && method === 'PUT') {
    const n = Number(m[1]); const br = batchPrs[n].head;
    assert.equal(body.sha, sh(origin2, 'rev-parse', br), 'merged on the tested head');
    sh(repo2, 'fetch', '-q', 'origin'); sh(repo2, 'checkout', '-q', '--detach', 'origin/main'); sh(repo2, ...cfg, 'merge', '-q', '--no-ff', '-m', `merge ${br}`, body.sha);
    sh(repo2, 'push', '-q', 'origin', 'HEAD:main'); mainMerges++;
    return { merged: true, sha: sh(repo2, 'rev-parse', 'HEAD') };
  }
  m = path.match(/pulls\/(\d+)$/);
  if (m && method === 'GET') return { state: landed.has(Number(m[1])) ? 'closed' : 'open' };
  if (m && method === 'PATCH') { landed.add(Number(m[1])); closed.push(Number(m[1])); return {}; }
  if (path.includes('/issues/') && method === 'POST') { comments2.push(body.body); return {}; }
  if (path.includes('/actions/variables')) return {};
  if (method === 'DELETE') return {};
  throw new Error(`unexpected ${method} ${path}`);
};
const tree = (ref) => sh(origin2, 'ls-tree', '--name-only', ref).split('\n').sort();

await t('batch round 1: the first five ready PRs are combined into one branch on main; #6 waits', async () => {
  const st = await queueRound({ s: s2, git: git2, gh: gh2, api });
  assert.equal(st.mode, 'batch');
  assert.deepEqual(st.batch.members.map((m) => m.pr), [1, 2, 3, 4, 5]);
  assert.deepEqual(tree('queue/batch-1'), ['a.txt', 'f1.txt', 'f2.txt', 'f3.txt', 'f4.txt', 'f5.txt']);
  assert.deepEqual(st.items.map((x) => [x.pr, x.state]), [[1, 'testing'], [2, 'testing'], [3, 'testing'], [4, 'testing'], [5, 'testing'], [6, 'waiting']]);
  assert.deepEqual(st.items[0].with, [2, 3, 4, 5]);
});

await t('batch round 2: still running, a builds-live commit on main: the batch holds (no second run)', async () => {
  sh(repo2, 'fetch', '-q', 'origin'); sh(repo2, 'checkout', '-q', '--detach', 'origin/main');
  mkdirSync(join(repo2, '_claude'), { recursive: true }); commit2('_claude/store.json', '{}\n', 'Builds live [skip ci]'); sh(repo2, 'push', '-q', 'origin', 'HEAD:main');
  const sha = readQueue(s2).batch.sha;
  const st = await queueRound({ s: s2, git: git2, gh: gh2, api });
  assert.equal(st.batch.sha, sha);
  assert.equal(st.batch.id, 1);
});

await t('batch round 3: green: the batch merges as one PR, its five PRs are closed as landed, #6 starts batch 2', async () => {
  ci2[readQueue(s2).batch.sha] = 'success';
  const st = await queueRound({ s: s2, git: git2, gh: gh2, api });
  assert.equal(mainMerges, 1, 'one merge into main for five PRs');
  assert.deepEqual(closed, [1, 2, 3, 4, 5]);
  assert.match(comments2[0], /Landed in main.*batch 1/);
  assert.match(batchPrs[100].title, /^Merge queue batch 1: #1, #2, #3, #4, #5/);
  assert.deepEqual(st.merged.map((m) => m.pr), [1, 2, 3, 4, 5]);
  assert.ok(st.merged.every((m) => m.batch === 1 && m.retested === false));
  sh(repo2, 'fetch', '-q', 'origin');
  assert.deepEqual(tree('main'), ['_claude', 'a.txt', 'f1.txt', 'f2.txt', 'f3.txt', 'f4.txt', 'f5.txt']);
  assert.deepEqual(st.batch.members.map((m) => m.pr), [6]);
  assert.equal(st.batch.id, 2);
});

await t('batch: two PRs that conflict in code: the later one waits for the next batch (no AI by default)', async () => {
  ci2[readQueue(s2).batch.sha] = 'success';
  openSet = [6, 7, 8];
  const st = await queueRound({ s: s2, git: git2, gh: gh2, api });
  assert.ok(landed.has(6));
  assert.deepEqual(st.batch.members.map((m) => m.pr), [7]);
  assert.match(st.items.find((x) => x.pr === 8).why, /conflicts in code with #7 in batch 3 \(a\.txt\)/);
});

await t('batch: red batch of two is halved; the green half merges, the red one alone is kicked out', async () => {
  // #7 and #8 conflict, so use fresh PRs #9 and #10 for the halving
  heads2[9] = branch2('c9', 'f9.txt', '9\n'); heads2[10] = branch2('c10', 'f10.txt', '10\n');
  ci2[readQueue(s2).batch.sha] = 'success';
  openSet = [9, 10];
  let st = await queueRound({ s: s2, git: git2, gh: gh2, api }); // #7 merges; batch 4 = #9 + #10
  assert.deepEqual(st.batch.members.map((m) => m.pr), [9, 10]);
  ci2[st.batch.sha] = 'failure';
  st = await queueRound({ s: s2, git: git2, gh: gh2, api });
  assert.deepEqual(st.suspects, [9, 10]);
  assert.deepEqual(st.batch.members.map((m) => m.pr), [9], 'first half of the suspects');
  assert.equal(st.batches.at(-1).result, 'red');
  ci2[st.batch.sha] = 'success';
  st = await queueRound({ s: s2, git: git2, gh: gh2, api });
  assert.ok(landed.has(9));
  assert.deepEqual(st.batch.members.map((m) => m.pr), [10]);
  ci2[st.batch.sha] = 'failure';
  st = await queueRound({ s: s2, git: git2, gh: gh2, api });
  assert.match(st.kicked.at(-1).why, /#10 broke CI/);
  assert.equal(st.waiting.find((w) => w.pr === 10).state, 'kicked');
  assert.equal(st.batch, null);
  assert.deepEqual(st.suspects, []);
});

await t('batch: the AI fallback (when on) sends one agent job per PR head, never a model call from the queue', async () => {
  heads2[11] = branch2('c11', 'g.txt', 'eleven\n'); heads2[12] = branch2('c12', 'g.txt', 'twelve\n');
  writeFileSync(join(data2, 'config.json'), JSON.stringify({ batchSize: 5, batchAiResolve: true }));
  openSet = [11, 12];
  const jobs = []; const conflictJob = (input) => { jobs.push(input); return { exit: 0, session: 'gina-queue-conflict' }; };
  let st = await queueRound({ s: s2, git: git2, gh: gh2, api, conflictJob });
  assert.deepEqual(st.batch.members.map((m) => m.pr), [11]);
  assert.deepEqual(jobs, [{ branch: 'c12', pr: '12', with: 'c11', files: 'g.txt' }]);
  assert.match(st.items.find((x) => x.pr === 12).why, /sent an agent to resolve it/);
  st = await queueRound({ s: s2, git: git2, gh: gh2, api, conflictJob });
  assert.equal(jobs.length, 1, 'once per head');
});

await t('settings from the CLI: mode, size, AI fallback; bounds refused', async () => {
  const { writeQueueConfig } = await import('./merge-queue.mjs');
  assert.equal(writeQueueConfig(s2, { batchSize: 3 }).batchSize, 3);
  assert.equal(writeQueueConfig(s2, { queueMode: 'stack' }).mode, 'stack');
  assert.throws(() => writeQueueConfig(s2, { batchSize: 0 }), /1 to 10/);
  assert.throws(() => writeQueueConfig(s2, { queueMode: 'x' }), /batch or stack/);
  assert.equal(JSON.parse(readFileSync(join(data2, 'config.json'), 'utf8')).batchAiResolve, true, 'other keys kept');
});

// ------------------------------------------------------------------ batch mode: every finished build goes in (enforce-the-merge-queue)

await t('batch: red or missing PR checks still join (the batch run is the gate), green first, Brett\'s order wins', () => {
  assert.equal(q.notReady({ number: 1, head: 'a', ci: 'failure' }, {}, { redJoins: true }), '', 'batch mode: the batch run is the gate');
  assert.equal(q.notReady({ number: 1, head: 'a', ci: 'none' }, {}, { redJoins: true }), '');
  assert.match(q.notReady({ number: 1, head: 'a', ci: 'running' }, {}, { redJoins: true }), /running/);
  assert.deepEqual(q.greenFirst([{ number: 1, ci: 'failure' }, { number: 2, ci: 'none' }, { number: 3, ci: 'success' }]).map((p) => p.number), [3, 2, 1]);
  assert.deepEqual(q.greenFirst([{ number: 1, ci: 'failure' }, { number: 3, ci: 'success' }], { order: [1] }).map((p) => p.number), [1, 3], "Brett's order wins");
});

await t('enlist: a finished build pushed with no PR gets one; one with a PR, unpushed or with nothing to land does not', async () => {
  const root3 = mkdtempSync(join(tmpdir(), 'mq-enlist-'));
  const origin3 = join(root3, 'origin.git'); const repo3 = join(root3, 'repo');
  sh(root3, 'init', '-q', '--bare', '-b', 'main', origin3);
  sh(root3, 'clone', '-q', origin3, repo3);
  const commit3 = (file, text, msg) => { writeFileSync(join(repo3, file), text); sh(repo3, 'add', file); sh(repo3, ...cfg, 'commit', '-q', '-m', msg); };
  commit3('a.txt', 'base\n', 'base');
  sh(repo3, 'push', '-q', 'origin', 'HEAD:main');
  for (const b of ['b1', 'b2']) { sh(repo3, 'checkout', '-q', '-b', b, 'origin/main'); commit3(`${b}.txt`, `${b}\n`, b); sh(repo3, 'push', '-q', 'origin', `HEAD:${b}`); }
  sh(repo3, 'push', '-q', 'origin', 'origin/main:refs/heads/b3'); // nothing to land
  sh(repo3, 'fetch', '-q', 'origin');
  const builds = [{ id: 'one', title: 'Build one', branch: 'b1', status: 'built' }, { id: 'two', branch: 'b2', status: 'built' }, { id: 'three', branch: 'b3', status: 'built' }, { id: 'four', branch: 'b4', status: 'built' }];
  const opened = [];
  const gh3 = async (method, path, body) => { if (method === 'POST' && path.endsWith('/pulls')) { opened.push(body); return { number: 40 + opened.length }; } return {}; };
  const out = await enlist({ s: { repo: repo3, slug: 'o/r', remote: 'origin', base: 'main' }, git: makeGit(repo3), gh: gh3, builds, pulls: [{ head: { ref: 'b2' } }] });
  assert.deepEqual(out, [{ build: 'one', pr: 41 }]);
  assert.equal(opened[0].head, 'b1'); assert.equal(opened[0].base, 'main'); assert.match(opened[0].body, /merge queue/);
});


console.log(`merge queue: ${n} checks passed`);

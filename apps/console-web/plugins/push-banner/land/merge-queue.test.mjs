// Merge queue self-test: the pure rules (merge-queue-core.mjs) and one round of the runner against a real local git
// repo with a fake GitHub (no network, no model). Run: node apps/console-web/plugins/push-banner/land/merge-queue.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as q from './merge-queue-core.mjs';
import { chatLines, queueRound, readQueue, queueControl } from './merge-queue.mjs';
import { makeGit } from './land.mjs';
process.env.AXF_CREW_SAY = 'off'; // group-chat posts (crew-say.mjs) stay out of the real Breakroom

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

// ------------------------------------------------------------------ batch mode (default since Nov 10 2026)

await t('batch rules: members, holds, decide (land all / split in half / kick the one), green first', () => {
  const ready = [1, 2, 3, 4, 5].map((x) => ({ number: x, head: `h${x}` }));
  assert.deepEqual(q.batchMembers(ready, { size: 3 }).map((p) => p.number), [1, 2, 3]);
  assert.deepEqual(q.batchMembers(ready, { size: 3, split: [2, 3, 4, 5] }).map((p) => p.number), [2, 3], 'a red batch: first half of the suspects');
  assert.deepEqual(q.batchMembers(ready, { split: [9] }).map((p) => p.number), [1, 2, 3, 4, 5], 'suspects no longer ready: a normal batch');
  const b = { sha: 's', base: 'm', members: [{ pr: 1, head: 'h1' }, { pr: 2, head: 'h2' }] };
  assert.equal(q.batchHolds(b, ready), true);
  assert.equal(q.batchHolds(b, ready, { mainMoved: true }), false);
  assert.equal(q.batchHolds(b, [{ number: 1, head: 'h1' }, { number: 2, head: 'NEW' }]), false);
  assert.deepEqual(q.decideBatch(b, 'success', { split: [1, 2, 3] }), { land: [1, 2], kick: null, split: [3] });
  assert.deepEqual(q.decideBatch(b, 'failure'), { land: [], kick: null, split: [1, 2] });
  assert.deepEqual(q.decideBatch({ members: [{ pr: 2 }] }, 'failure', { split: [2, 3] }), { land: [], kick: 2, split: [3] });
  assert.deepEqual(q.decideBatch(b, 'running', { split: [7] }), { land: [], kick: null, split: [7] });
  assert.equal(q.notReady({ number: 1, head: 'a', ci: 'failure' }, {}, { redJoins: true }), '', 'batch mode: the batch run is the gate');
  assert.equal(q.notReady({ number: 1, head: 'a', ci: 'none' }, {}, { redJoins: true }), '');
  assert.match(q.notReady({ number: 1, head: 'a', ci: 'running' }, {}, { redJoins: true }), /running/);
  assert.deepEqual(q.greenFirst([{ number: 1, ci: 'failure' }, { number: 2, ci: 'none' }, { number: 3, ci: 'success' }]).map((p) => p.number), [3, 2, 1]);
  assert.deepEqual(q.greenFirst([{ number: 1, ci: 'failure' }, { number: 3, ci: 'success' }], { order: [1] }).map((p) => p.number), [1, 3], "Brett's order wins");
  assert.equal(q.isQueueBranch(q.BATCH_BRANCH), true);
});

{
  const root2 = mkdtempSync(join(tmpdir(), 'mq-batch-'));
  const origin2 = join(root2, 'origin.git'); const repo2 = join(root2, 'repo'); const data2 = join(root2, 'data');
  mkdirSync(data2);
  sh(root2, 'init', '-q', '--bare', '-b', 'main', origin2);
  sh(root2, 'clone', '-q', origin2, repo2);
  const commit2 = (file, text, msg) => { mkdirSync(join(repo2, file, '..'), { recursive: true }); writeFileSync(join(repo2, file), text); sh(repo2, 'add', file); sh(repo2, ...cfg, 'commit', '-q', '-m', msg); };
  // main's builds store: build b4 is finished and has no PR yet
  commit2('a.txt', 'base\n', 'base');
  commit2('_claude/builds/store.json', JSON.stringify({ builds: [{ id: 'four', title: 'Build four', branch: 'b4', status: 'built' }] }), 'store');
  sh(repo2, 'push', '-q', 'origin', 'HEAD:main');
  const branch2 = (name, file, text) => { sh(repo2, 'checkout', '-q', '-b', name, 'origin/main'); commit2(file, text, name); sh(repo2, 'push', '-q', 'origin', `HEAD:${name}`); sh(repo2, 'checkout', '-q', '--detach'); return sh(repo2, 'rev-parse', 'HEAD'); };
  const h = { 1: branch2('b1', 'one.txt', '1\n'), 2: branch2('b2', 'two.txt', '2\n'), 3: branch2('b3', 'three.txt', '3\n') };
  branch2('b4', 'four.txt', '4\n');
  sh(repo2, 'fetch', '-q', 'origin');
  const s2 = { repo: repo2, slug: 'o/r', dataDir: data2, remote: 'origin', base: 'main', archive: join(root2, 'archive') };
  const git2 = makeGit(repo2);
  const ci2 = {}; const opened = []; const comments2 = []; const deleted = [];
  const onMain = (sha) => spawnSync('git', ['merge-base', '--is-ancestor', sha, 'main'], { cwd: origin2 }).status === 0;
  const open2 = () => [1, 2, 3].filter((x) => !onMain(h[x])).map((x) => ({ number: x, title: `PR ${x}`, html_url: `u/${x}`, created_at: `2026-11-0${x}`, base: { ref: 'main' }, head: { ref: `b${x}`, sha: h[x], repo: { full_name: 'o/r' } }, user: { login: 'bot' } }));
  const gh2 = async (method, path, body) => {
    if (method === 'GET' && path.startsWith('/repos/o/r/pulls?')) return open2();
    if (method === 'POST' && path === '/repos/o/r/pulls') { opened.push(body.head); return { number: 40 + opened.length }; }
    const m = path.match(/commits\/([0-9a-f]+)\/check-runs/);
    if (m) return { check_runs: Object.values(h).includes(m[1]) ? runs('failure') : runs(ci2[m[1]] || 'running') }; // every PR's own light checks are red
    if (path.includes('/issues/') && method === 'POST') { comments2.push(body.body); return {}; }
    if (path.includes('/actions/variables')) return {};
    if (method === 'DELETE') { deleted.push(path.split('/heads/')[1]); return {}; }
    if (path.includes('/pulls/') && path.endsWith('/merge')) throw new Error('batch mode never merges PR by PR');
    throw new Error(`unexpected ${method} ${path}`);
  };
  const files = (ref) => sh(origin2, 'ls-tree', '--name-only', ref).split('\n').sort();

  await t('batch round 1: every ready PR combined into one commit on queue/batch; the finished build without a PR gets one', async () => {
    const st = await queueRound({ s: s2, git: git2, gh: gh2, api });
    assert.equal(st.mode, 'batch');
    assert.deepEqual(st.batch.members.map((m) => m.pr), [1, 2, 3], 'red PR checks still join: the batch run decides');
    assert.deepEqual(st.items.map((x) => [x.pr, x.state, x.inBatch]), [[1, 'testing', true], [2, 'testing', true], [3, 'testing', true]]);
    assert.deepEqual(files('queue/batch'), ['_claude', 'a.txt', 'one.txt', 'three.txt', 'two.txt']);
    assert.deepEqual(opened, ['b4'], 'every finished build goes into the queue');
  });

  await t('batch round 2: the batch is red, so it is split; the first half is tested as the next batch', async () => {
    ci2[readQueue(s2).batch.sha] = 'failure';
    const st = await queueRound({ s: s2, git: git2, gh: gh2, api });
    assert.deepEqual(st.batch.members.map((m) => m.pr), [1, 2]);
    assert.deepEqual(st.split, [1, 2, 3]);
    assert.equal(st.batch.bisect, true);
    assert.match(st.items.find((x) => x.pr === 3).why, /smaller batch/);
  });

  await t('batch round 3: the green half lands on main as the one tested commit; #3 is tested alone', async () => {
    const tested = readQueue(s2).batch.sha; ci2[tested] = 'success';
    const st = await queueRound({ s: s2, git: git2, gh: gh2, api });
    assert.equal(sh(origin2, 'rev-parse', 'main'), tested, 'main is exactly the commit CI ran on');
    assert.deepEqual(st.merged.map((m) => m.pr), [1, 2]);
    assert.ok(st.merged.every((m) => m.retested === false && m.queueSha === tested));
    assert.deepEqual(st.batch.members.map((m) => m.pr), [3]);
    assert.deepEqual(st.lastLanded, ['b1', 'b2']);
  });

  await t('batch round 4: a batch of one goes red and is kicked out with the reason; landed branches are tidied', async () => {
    ci2[readQueue(s2).batch.sha] = 'failure';
    const st = await queueRound({ s: s2, git: git2, gh: gh2, api });
    assert.match(st.kicked.at(-1).why, /#3 broke CI/);
    assert.match(comments2[0], /Kicked out of the merge queue/);
    assert.equal(st.batch, null);
    assert.equal(st.waiting.find((w) => w.pr === 3).state, 'kicked');
    assert.deepEqual(deleted.sort(), ['b1', 'b2']);
  });

  await t('batch: main moving in status only (skip ci) still lands, with the status commits merged in', async () => {
    // #3 gets a fix: a new head rejoins by itself
    sh(repo2, 'checkout', '-q', '--detach', h[3]); commit2('three.txt', '3 fixed\n', 'fix'); sh(repo2, 'push', '-q', 'origin', 'HEAD:b3'); h[3] = sh(repo2, 'rev-parse', 'HEAD');
    let st = await queueRound({ s: s2, git: git2, gh: gh2, api });
    assert.deepEqual(st.batch.members.map((m) => m.pr), [3]);
    const tested = st.batch.sha; ci2[tested] = 'success';
    sh(repo2, 'fetch', '-q', 'origin'); sh(repo2, 'checkout', '-q', '--detach', 'origin/main');
    commit2('_claude/status.md', 'x\n', 'Builds live [skip ci]'); sh(repo2, 'push', '-q', 'origin', 'HEAD:main');
    st = await queueRound({ s: s2, git: git2, gh: gh2, api });
    assert.equal(st.merged.at(-1).pr, 3);
    const main = sh(origin2, 'rev-parse', 'main');
    assert.equal(sh(origin2, 'diff', '--name-only', tested, main), '_claude/status.md', 'only status differs from what CI tested');
  });
}

// group chat (crew-sections@1): only what happened this round, as plain lines for the merge queue's owner
{
  const at = '2026-11-12T10:00:00.000Z'; const before = '2026-11-12T09:57:00.000Z';
  const st = { at, merged: [{ pr: 7, at }, { pr: 8, at }, { pr: 3, at: before }], kicked: [{ pr: 9, at, why: 'CI is red (lint).' }, { pr: 2, at: before, why: 'old' }],
    batch: { builtAt: at, sha: 'abcdef1234', members: [{ pr: 10 }, { pr: 11 }], state: '' }, stack: [] };
  const lines = chatLines({}, st);
  assert.deepEqual(lines.map((l) => l.event), ['done', 'failed', 'start']);
  assert.equal(lines[0].text, 'Landed #7, #8 on main.'); assert.match(lines[1].text, /^Kicked #9 out of the queue: CI is red/); assert.match(lines[2].text, /#10, #11 together/);
  const stuck = { at, merged: [], kicked: [], batch: { builtAt: before, members: [{ pr: 4 }], state: 'passed', why: 'GitHub refused the push' } };
  assert.equal(chatLines({}, stuck)[0].event, 'blocked');
  assert.deepEqual(chatLines({ batch: stuck.batch }, stuck), [], 'the same stuck batch is said once');
  n += 1; console.log('ok group chat lines: landed, kicked, started, stuck; nothing old said again');
}

console.log(`merge queue: ${n} checks passed`);

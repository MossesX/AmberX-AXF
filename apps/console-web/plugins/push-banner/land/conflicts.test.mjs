// Conflict watch self-test: the pure rules (conflicts-core.mjs) and full rounds against a real local git repo (no network,
// no model). Run: node apps/console-web/plugins/push-banner/land/conflicts.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as c from './conflicts-core.mjs';
import { conflictRound, conflictsControlFile, readConflicts } from './conflicts.mjs';
import { makeGit } from './land.mjs';

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`ok ${name}`); };

await t('merge-tree answers: clean, code, data only, git failed', () => {
  assert.deepEqual(c.parseMergeTree(0, 'abc\n'), { clean: true });
  assert.deepEqual(c.parseMergeTree(1, 'abc\nsrc/a.ts\nsrc/b.ts\n\nCONFLICT (content): src/a.ts\n'), { files: ['src/a.ts', 'src/b.ts'] });
  assert.deepEqual(c.parseMergeTree(1, 'abc\n_claude/THREADS.md\n\nCONFLICT\n'), { clean: true }, 'a log the queue settles is no conflict');
  assert.equal(c.parseMergeTree(128, ''), null);
});

const scan = (pr, head = `h${pr}`) => ({ pr, title: `T${pr}`, branch: `b${pr}`, url: '', head, build: '', files: ['a.ts'] });

await t('first scan is a baseline: one digest, no push per PR', () => {
  const r = c.reconcile(null, [scan(1), scan(2)]);
  assert.equal(r.digest, true); assert.equal(r.baseline, true); assert.equal(r.fresh.length, 2);
});

await t('after that one alert per new conflict, a burst is one digest, an old one is silent', () => {
  const prev = { at: 'x', items: [{ ...scan(1), since: 's' }] };
  const one = c.reconcile(prev, [scan(1), scan(2)]);
  assert.equal(one.digest, false); assert.deepEqual(one.fresh.map((x) => x.pr), [2]); assert.equal(one.items.find((x) => x.pr === 1).since, 's');
  assert.equal(c.reconcile(prev, [scan(1), scan(2), scan(3), scan(4), scan(5)]).digest, true);
  assert.equal(c.reconcile(prev, [scan(1, 'new-head')]).fresh.length, 0, 'a push that still conflicts is not news');
});

await t('gone = resolved; a fix that moved the head but still conflicts alerts again', () => {
  const prev = { at: 'x', items: [{ ...scan(1), fix: { state: 'running', head: 'h1' } }, scan(2)] };
  const r = c.reconcile(prev, [scan(1, 'moved')]);
  assert.deepEqual(r.resolved.map((x) => x.pr), [2]); assert.deepEqual(r.fresh.map((x) => x.pr), [1]); assert.equal(r.items[0].fix, null);
});

await t('a refused merge counts, without a scan hit', () => {
  const r = c.reconcile({ at: 'x', items: [] }, [], { refused: { 7: 'GitHub 405: Pull Request has merge conflicts' } });
  assert.equal(r.items[0].refused, true); assert.deepEqual(r.fresh.map((x) => x.pr), [7]);
  assert.equal(c.isConflictRefusal('GitHub 405: Pull Request has merge conflicts'), true); assert.equal(c.isConflictRefusal('GitHub 500'), false);
});

await t('Fix is pinned and only Brett asks', () => {
  assert.throws(() => c.applyControl({}, 'fix', 5, { by: 'brett' }), /pinned/);
  assert.throws(() => c.applyControl({}, 'fix', 5, { head: 'a' }), /own click/);
  const d = c.applyControl({}, 'fix', 5, { head: 'a', by: 'brett' });
  assert.deepEqual(c.fixesToRun(d, [{ pr: 5, head: 'a' }]).run.length, 1);
  assert.deepEqual(c.fixesToRun(d, [{ pr: 5, head: 'b' }]), { run: [], drop: [5] }, 'the PR moved: dropped');
  assert.deepEqual(c.fixesToRun(d, []).drop, [5], 'resolved already');
  assert.equal(c.fixesToRun(d, [{ pr: 5, head: 'a', fix: { state: 'running' } }]).run.length, 0, 'never two fixes');
});

await t('the build carries Brett\'s tap and the job names the build', () => {
  const it = { ...scan(9), files: ['x.ts'] };
  const b = c.fixBuild(it, { by: 'brett' });
  assert.equal(b.id, 'conflict-fix-pr-9'); assert.match(b.said, /Fix conflicts now.*brett/); assert.equal(b.steps[0].model, 'Opus');
  assert.deepEqual(c.fixJob(it).input, { pr: '9', branch: 'b9', build: 'conflict-fix-pr-9', files: 'x.ts' });
});

// ------------------------------------------------------------------ rounds on a real repo

const root = mkdtempSync(join(tmpdir(), 'conflicts-'));
const repo = join(root, 'r');
const sh = (...a) => { const r = spawnSync('git', a, { cwd: repo, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
mkdirSync(repo); sh('init', '-q', '-b', 'main'); sh('config', 'user.email', 't@t'); sh('config', 'user.name', 't');
const put = (f, s, m) => { writeFileSync(join(repo, f), s); sh('add', '-A'); sh('commit', '-qm', m); return sh('rev-parse', 'HEAD'); };
put('a.ts', '1\n', 'base'); put('other.ts', 'o\n', 'base2');
sh('checkout', '-qb', 'clash'); const clash = put('a.ts', 'branch\n', 'clash');
sh('checkout', '-q', 'main'); sh('checkout', '-qb', 'fine'); const fine = put('new.ts', 'x\n', 'fine');
sh('checkout', '-q', 'main'); let main = put('a.ts', 'main\n', 'main moved');
sh('update-ref', 'refs/remotes/origin/main', main);

const s = { repo, remote: 'origin', base: 'main', dataDir: join(root, 'd') };
const git = makeGit(repo);
const calls = []; const api = async (m, p, b) => { calls.push({ p, b }); return {}; };
const pr = (number, head, branch, extra = {}) => ({ number, head, branch, title: `T${number}`, url: '', build: '', ...extra });
const launched = []; const requeued = []; const settled = [];
const round = (prs) => conflictRound({ s, git, api, prs, mainSha: sh('rev-parse', 'origin/main'), launch: (it, r) => { launched.push({ pr: it.pr, by: r.by }); return { state: 'running', build: c.fixBuildId(it.pr), session: 's' }; }, requeue: (x) => requeued.push(x), settle: (_s, it, q) => { settled.push(it.pr); q(it.pr); } });

await t('first round: finds the real conflict, skips clean and drafts, one digest', async () => {
  const st = await round([pr(1, clash, 'clash'), pr(2, fine, 'fine'), pr(3, clash, 'clash2', { draft: true })]);
  assert.deepEqual(st.items.map((x) => x.pr), [1]); assert.deepEqual(st.items[0].files, ['a.ts']); assert.equal(st.clean[2], fine);
  assert.equal(calls.length, 1); assert.equal(calls[0].b.key, c.DIGEST_KEY);
});

await t('a status commit on main: no rescan answer changes, nothing pushed', async () => {
  calls.length = 0; mkdirSync(join(repo, '_claude'), { recursive: true });
  main = put('_claude/log.md', 'x\n', 'status'); sh('update-ref', 'refs/remotes/origin/main', main);
  const st = await round([pr(1, clash, 'clash'), pr(2, fine, 'fine')]);
  assert.equal(st.items.length, 1); assert.equal(calls.length, 0);
});

await t('Fix conflicts now: launched once, by whoever clicked; resolved PR requeued and cleared', async () => {
  writeFileSync(conflictsControlFile(s), JSON.stringify(c.applyControl({}, 'fix', 1, { head: clash, by: 'brett' })));
  let st = await round([pr(1, clash, 'clash'), pr(2, fine, 'fine')]);
  assert.deepEqual(launched, [{ pr: 1, by: 'brett' }]); assert.equal(st.items[0].fix.state, 'running');
  assert.deepEqual(JSON.parse(readFileSync(conflictsControlFile(s), 'utf8')).fix, {}, 'the ask is used up');
  st = await round([pr(1, clash, 'clash'), pr(2, fine, 'fine')]);
  assert.equal(launched.length, 1, 'never launched twice');
  calls.length = 0;
  sh('checkout', '-q', 'clash'); sh('merge', '-q', '-X', 'ours', '--no-edit', 'main'); const fixed = sh('rev-parse', 'HEAD'); sh('checkout', '-q', 'main');
  st = await round([pr(1, fixed, 'clash'), pr(2, fine, 'fine')]);
  assert.equal(st.items.length, 0); assert.deepEqual(requeued, [1]); assert.deepEqual(settled, [1]);
  const res = calls.find((x) => x.p === '/api/alerts/resolve'); assert.ok(res.b.keys.includes('conflict:1') && res.b.keys.includes(c.DIGEST_KEY));
  assert.equal(readConflicts(s).count, 0);
});

await t('a failed launch says why and Fix stays available', async () => {
  sh('checkout', '-q', 'main'); const head = (sh('checkout', '-qb', 'c2', 'HEAD~2'), put('a.ts', 'other\n', 'c2')); sh('checkout', '-q', 'main');
  await round([pr(4, head, 'c2')]);
  writeFileSync(conflictsControlFile(s), JSON.stringify(c.applyControl({}, 'fix', 4, { head, by: 'brett' })));
  calls.length = 0;
  const st = await conflictRound({ s, git, api, prs: [pr(4, head, 'c2')], mainSha: main, launch: () => ({ state: 'failed', build: 'b', why: 'no agent on duty' }) });
  assert.equal(st.items[0].fix.state, 'failed'); assert.ok(calls.some((x) => /didn't start/.test(x.b.title)));
  assert.deepEqual(c.fixesToRun(c.applyControl({}, 'fix', 4, { head, by: 'brett' }), st.items).run.length, 1, 'he can tap it again');
});

console.log(`conflict watch: ${n} checks passed`);

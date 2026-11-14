#!/usr/bin/env node
// land-one.mjs: one serial landing attempt on a temp git repo (origin bare + a checkout), recorded as land-run@1.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'land-one-'));
process.env.AXF_LAND_LOCK = join(root, 'lock.d');
process.env.AXF_CREW_SAY = 'off';
const { landOne, readRuns } = await import('./land-one.mjs');
const { makeGit, takeLandLock, dropLandLock } = await import('./land.mjs');
const lr = await import('../../../../../framework/core/land-run.mjs');

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`ok ${name}`); };
const sh = (args, cwd) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const origin = join(root, 'origin.git'); const repo = join(root, 'repo'); const data = join(root, 'data'); const work = join(root, 'work');
mkdirSync(data);
sh(['init', '-q', '--bare', '-b', 'main', origin], root);
sh(['clone', '-q', origin, work], root);
for (const [k, v] of [['user.name', 't'], ['user.email', 't@t']]) sh(['config', k, v], work);
const commit = (f, text, msg) => { writeFileSync(join(work, f), text); sh(['add', f], work); sh(['commit', '-qm', msg], work); };
commit('a.txt', 'one\n', 'a');
sh(['push', '-q', 'origin', 'HEAD:main'], work);
// a clean build: adds its own file; a clashing build: edits a.txt one way
sh(['checkout', '-qb', 'claude/clean'], work); commit('b.txt', 'b\n', 'b'); sh(['push', '-q', 'origin', 'claude/clean'], work);
sh(['checkout', '-q', 'main'], work); sh(['checkout', '-qb', 'claude/clash'], work); commit('a.txt', 'branch side\n', 'a branch'); sh(['push', '-q', 'origin', 'claude/clash'], work);
// main moves on: a new file and a.txt the other way
sh(['checkout', '-q', 'main'], work); commit('c.txt', 'c\n', 'c'); commit('a.txt', 'main side\n', 'a main'); sh(['push', '-q', 'origin', 'HEAD:main'], work);
sh(['clone', '-q', origin, repo], root);
for (const [k, v] of [['user.name', 't'], ['user.email', 't@t']]) sh(['config', k, v], repo);
const s = { repo, slug: 'o/r', dataDir: data, remote: 'origin', base: 'main', archive: join(root, 'archive') };
const git = makeGit(repo, { retryWait: 10 });
const at = new Date('2026-11-14T23:00:00Z');

await t('a clean build: main merged into its branch and pushed; the attempt is recorded as land-run@1, still going (CI next)', async () => {
  const r = await landOne({ s, git, build: { id: 'clean', branch: 'claude/clean', pr: 12 }, now: () => at });
  assert.equal(r.ran, true);
  assert.equal(r.run.build, 'clean'); assert.equal(r.run.pr, 12);
  assert.equal(r.run.base, sh(['rev-parse', 'origin/main'], repo));
  assert.ok(r.run.merged, 'merged sha recorded'); assert.equal(r.run.outcome, '');
  sh(['fetch', '-q', 'origin'], repo);
  assert.equal(sh(['rev-parse', 'origin/claude/clean'], repo), r.run.merged, 'the merged head is on the branch');
  assert.equal(sh(['merge-base', '--is-ancestor', 'origin/main', 'origin/claude/clean'], repo), '', 'the branch now holds main');
  const runs = readRuns(s, 'clean');
  assert.equal(runs.length, 1); assert.equal(runs[0].id, lr.newLandRunId('clean', at.toISOString()));
});

await t('a code clash: nothing pushed, the attempt ends as clash with the file listed', async () => {
  const before = sh(['rev-parse', 'origin/claude/clash'], repo);
  const r = await landOne({ s, git, build: { id: 'clash', branch: 'claude/clash' }, now: () => at });
  assert.equal(r.run.outcome, 'clash'); assert.deepEqual(r.run.unresolved, ['a.txt']);
  assert.ok(lr.validateLandRun(r.run).ok, 'a valid land-run@1');
  sh(['fetch', '-q', 'origin'], repo);
  assert.equal(sh(['rev-parse', 'origin/claude/clash'], repo), before, 'branch untouched');
});

await t('a missing branch is an error attempt, never a crash', async () => {
  const r = await landOne({ s, git, build: { id: 'gone', branch: 'claude/gone' }, now: () => at });
  assert.equal(r.run.outcome, 'error'); assert.match(r.run.error, /not on origin/);
});

await t('two at once: a second attempt is refused while the line is held, and runs once it is free', async () => {
  assert.equal(await takeLandLock({ who: 'other lander' }), true);
  const r = await landOne({ s, git, build: { id: 'clean', branch: 'claude/clean' }, now: () => at });
  assert.equal(r.ran, false); assert.match(r.owner, /other lander/);
  dropLandLock();
  const r2 = await landOne({ s, git, build: { id: 'clean', branch: 'claude/clean' }, now: () => at, dry: true });
  assert.equal(r2.ran, true);
});

await t('two land-one calls started together: exactly one runs', async () => {
  const slow = (o) => { spawnSync('sleep', ['0.3']); return { merged: true, sha: sh(['rev-parse', 'origin/claude/clean'], repo), conflicts: [] }; };
  const [a, b] = await Promise.all([
    landOne({ s, git, build: { id: 'clean', branch: 'claude/clean' }, merge: slow, dry: true }),
    landOne({ s, git, build: { id: 'clean', branch: 'claude/clean' }, merge: slow, dry: true }),
  ]);
  assert.equal([a, b].filter((x) => x.ran).length, 1);
});

rmSync(root, { recursive: true, force: true });
console.log(`land-one: ${n} checks passed`);

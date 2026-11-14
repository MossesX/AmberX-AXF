#!/usr/bin/env node
// supersede.mjs: which finished branches still hold work main lacks (git cherry + file level); superseded ones are kept
// as archive/<build> tags, their PRs closed, marked archived; unique ones flagged with their files. Real git.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AXF_CREW_SAY = 'off';
const { supersede, uniqueWork, noise } = await import('./supersede.mjs');
const { makeGit } = await import('./land.mjs');

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`ok ${name}`); };
const sh = (args, cwd) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const root = mkdtempSync(join(tmpdir(), 'supersede-'));
const origin = join(root, 'origin.git'); const work = join(root, 'work'); const repo = join(root, 'repo'); const data = join(root, 'data'); mkdirSync(data);
sh(['init', '-q', '--bare', '-b', 'main', origin], root);
sh(['clone', '-q', origin, work], root);
for (const [k, v] of [['user.name', 't'], ['user.email', 't@t']]) sh(['config', k, v], work);
const put = (f, text) => { mkdirSync(join(work, f, '..'), { recursive: true }); writeFileSync(join(work, f), text); sh(['add', f], work); };
const commit = (files, msg) => { for (const [f, x] of Object.entries(files)) put(f, x); sh(['commit', '-qm', msg], work); return sh(['rev-parse', 'HEAD'], work); };
commit({ 'src/a.ts': 'a\n', '_claude/builds/store.json': '{}\n' }, 'base');
sh(['push', '-q', 'origin', 'HEAD:main'], work);
const branch = (name, files, msg) => { sh(['checkout', '-q', '-b', `claude/${name}`, 'main'], work); const c = commit(files, msg); sh(['push', '-q', 'origin', `claude/${name}`], work); sh(['checkout', '-q', 'main'], work); return c; };
const picked = branch('picked', { 'src/p.ts': 'p\n' }, 'p');
branch('unique', { 'src/u.ts': 'u\n', '_claude/builds/store.json': '{"x":1}\n' }, 'u');
branch('status-only', { '_claude/builds/store.json': '{"y":1}\n' }, 'status');
branch('redone', { 'src/r.ts': 'r\n', 'src/a.ts': 'a2\n' }, 'r');
// main takes the picked commit as is, and redone's content in a different commit (a squash by hand)
sh(['cherry-pick', picked], work);
commit({ 'src/r.ts': 'r\n', 'src/a.ts': 'a2\n', 'src/other.ts': 'o\n' }, 'redone squashed with more');
sh(['push', '-q', 'origin', 'HEAD:main'], work);
sh(['clone', '-q', origin, repo], root);
const s = { repo, slug: 'o/r', dataDir: data, remote: 'origin', base: 'main' };
const git = makeGit(repo, { retryWait: 10 });
const rows = ['picked', 'unique', 'status-only', 'redone', 'gone'].map((id, i) => ({ id, branch: `claude/${id}`, pr: `#${10 + i}` }));

await t('status, log and generated files never count as unique work', async () => {
  assert.ok(noise('_claude/builds/store.json')); assert.ok(noise('_claude/THREADS.md')); assert.ok(!noise('src/a.ts'));
});

await t('git cherry + file level: picked, status-only and re-done branches are superseded; one with a new file is unique', async () => {
  const w = (b) => uniqueWork({ git, ref: `origin/claude/${b}`, main: 'origin/main' });
  assert.equal(w('picked').unique, false); assert.match(w('picked').why, /every commit is on main/);
  assert.equal(w('status-only').unique, false); assert.match(w('status-only').why, /status files/);
  assert.equal(w('redone').unique, false); assert.match(w('redone').why, /same content/);
  assert.deepEqual(w('unique').files, ['src/u.ts']);
});

await t('dry run: verdicts only, nothing tagged, closed or marked', async () => {
  const marks = [];
  const r = await supersede({ s, git, rows, mark: (...a) => { marks.push(a); return { ok: true }; } });
  assert.deepEqual(r.rows.map((x) => [x.id, x.verdict]), [['picked', 'superseded'], ['unique', 'unique'], ['status-only', 'superseded'], ['redone', 'superseded'], ['gone', 'missing']]);
  assert.equal(marks.length, 0); assert.equal(git(['ls-remote', '--tags', 'origin']).out, '');
});

await t('apply: superseded → tag archive/<build> at its head, PR closed with a note, marked archived; unique → flagged with its files', async () => {
  const marks = []; const calls = [];
  const gh = async (method, path, body) => { calls.push([method, path, body?.state || '']); return {}; };
  const r = await supersede({ s, git, gh, rows, apply: true, mark: (_s, id, state, note) => { marks.push([id, state, note]); return { ok: true }; } });
  const tags = git(['ls-remote', '--tags', 'origin']).out;
  for (const id of ['picked', 'status-only', 'redone']) assert.match(tags, new RegExp(`refs/tags/archive/${id}$`, 'm'));
  assert.doesNotMatch(tags, /archive\/unique/);
  assert.equal(git(['rev-parse', 'origin/claude/picked']).out, git(['ls-remote', 'origin', 'refs/tags/archive/picked']).out.split(/\s/)[0], 'the tag is the branch head');
  assert.deepEqual(calls.filter((c) => c[0] === 'PATCH').map((c) => [c[1], c[2]]), [['/repos/o/r/pulls/10', 'closed'], ['/repos/o/r/pulls/12', 'closed'], ['/repos/o/r/pulls/13', 'closed']]);
  assert.deepEqual(marks.map((m) => [m[0], m[1]]), [['picked', 'archived'], ['unique', 'flagged'], ['status-only', 'archived'], ['redone', 'archived']]);
  assert.match(marks[1][2], /src\/u\.ts/);
  assert.ok(r.applied);
  assert.equal(git(['rev-parse', '-q', '--verify', 'origin/claude/picked']).code, 0, 'nothing deleted: the branch is still there');
});

rmSync(root, { recursive: true, force: true });
console.log(`supersede: ${n} checks passed`);

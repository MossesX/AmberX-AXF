// node --test deploy/auto-lander/test/merge-main.test.mjs
// The clash resolver on a throwaway repo: a conflict in a generated file (tracker.json) resolves and is pushed; a
// conflict in a hand-written file aborts, logs a failed clash attempt and comes back as a red-CI-style `needs fix`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'al-merge-'));
process.env.AXF_AUTO_LANDER_DIR = join(root, 'data');
process.env.AXF_CREW_SAY = 'off';
const { mergeMainFor } = await import('../merge-main.mjs');
const A = await import('../attempts.mjs');

const origin = join(root, 'origin.git'); const work = join(root, 'work'); const svc = join(root, 'svc');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).trim();
const put = (p, t) => { mkdirSync(dirname(join(work, p)), { recursive: true }); writeFileSync(join(work, p), t); };
const commit = (m) => { git(work, 'add', '-A'); git(work, 'commit', '-qm', m); };

// main: the generator stubs the manifest names (tracker regenerates tracker.json from status.txt; the quick tests pass)
git(root, 'init', '-q', '--bare', '-b', 'main', origin);
git(root, 'clone', '-q', origin, work);
git(work, 'checkout', '-q', '-b', 'main');
put('framework/cli/tracker.mjs', "import { readFileSync, writeFileSync } from 'node:fs';\nwriteFileSync('tracker.json', JSON.stringify({ lines: readFileSync('status.txt', 'utf8').trim().split('\\n') }, null, 1) + '\\n');\n");
put('apps/console-web/scripts/control-inventory.mjs', 'process.exit(0);\n');
put('framework/spec/check-project-fixtures.mjs', 'process.exit(0);\n');
put('status.txt', 'a\n'); put('tracker.json', '{"lines":["a"]}\n');
put('src/app.js', 'export const x = 1;\n');
commit('base'); git(work, 'push', '-q', 'origin', 'main');

// two build branches off the base
for (const b of ['b-gen', 'b-code']) git(work, 'branch', `claude/${b}`, 'main');
git(work, 'checkout', '-q', 'claude/b-gen'); put('tracker.json', '{"lines":["a","branch"]}\n'); put('feature.txt', 'f\n'); commit('branch tracker'); git(work, 'push', '-q', 'origin', 'claude/b-gen');
git(work, 'checkout', '-q', 'claude/b-code'); put('src/app.js', 'export const x = 2; // branch\n'); commit('branch code'); git(work, 'push', '-q', 'origin', 'claude/b-code');
// main moves on both files
git(work, 'checkout', '-q', 'main'); put('status.txt', 'a\nmain\n'); put('tracker.json', '{"lines":["a","main"]}\n'); put('src/app.js', 'export const x = 3; // main\n'); commit('main moves'); git(work, 'push', '-q', 'origin', 'main');

// the service's own checkout (the private worktree is made off it)
git(root, 'clone', '-q', origin, svc);

test('a clash in a generated file is resolved, regenerated, pushed and logged ok', () => {
  const r = mergeMainFor({ build: 'b-gen', pr: 11, repo: svc });
  assert.equal(r.status, 'merged', r.log);
  assert.deepEqual(r.conflicts, []);
  assert.ok(r.resolved.includes('tracker.json'));
  assert.deepEqual(r.regenerated, ['tracker']);
  git(svc, 'fetch', '-q', 'origin');
  assert.equal(git(svc, 'rev-parse', 'origin/claude/b-gen'), r.sha);
  assert.equal(JSON.parse(git(svc, 'show', 'origin/claude/b-gen:tracker.json')).lines.join(','), 'a,main');
  assert.equal(git(svc, 'show', 'origin/claude/b-gen:feature.txt'), 'f');
  const l = A.list('b-gen');
  assert.equal(l.length, 1); assert.equal(l[0].kind, 'clash'); assert.equal(l[0].result, 'ok'); assert.equal(l[0].pr, 11); assert.equal(l[0].head, r.sha);
});

test('a second run finds nothing to merge (skipped, not a failure)', () => {
  const r = mergeMainFor({ build: 'b-gen', repo: svc });
  assert.equal(r.status, 'up-to-date');
  assert.equal(A.count('b-gen').clash.skipped, 1);
  assert.equal(A.count('b-gen').clash.failures, 0);
});

test('a clash in a hand-written file aborts, logs a failed attempt and returns needs-fix', () => {
  const before = git(svc, 'rev-parse', 'origin/claude/b-code');
  const r = mergeMainFor({ build: 'b-code', pr: 12, repo: svc });
  assert.equal(r.status, 'needs-fix');
  assert.deepEqual(r.conflicts, ['src/app.js']);
  assert.equal(r.ci, 'failure');
  assert.deepEqual(r.failing, ['merge main: conflict in src/app.js']);
  git(svc, 'fetch', '-q', 'origin');
  assert.equal(git(svc, 'rev-parse', 'origin/claude/b-code'), before, 'nothing pushed');
  const [a] = A.list('b-code');
  assert.equal(a.result, 'failed'); assert.equal(a.kind, 'clash'); assert.match(a.log, /src\/app\.js/);
  assert.equal(git(svc, 'worktree', 'list').split('\n').length, 1, 'private worktree removed');
});

test('a dry run merges but neither pushes nor logs', () => {
  const r = mergeMainFor({ build: 'b-code', repo: svc, dry: true });
  assert.equal(r.status, 'needs-fix');
  assert.equal(A.list('b-code').length, 1);
});

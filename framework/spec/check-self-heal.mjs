#!/usr/bin/env node
/**
 * Self-heal (framework/cli/self-heal.mjs): fake stale locks, a held lock, a young lock, a dead worktree's `locked`
 * marker, a git call refused on a lock, a merge blocked by stray log files (and one blocked by code, left alone),
 * crashed tmux sessions, and the fix log / FYI. Plain code only: the file must not import any model client.
 *   node framework/spec/check-self-heal.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from '../cli/self-heal.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const tmp = mkdtempSync(join(tmpdir(), 'axf-heal-'));
const git = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }); return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
const old = (p) => { if (!existsSync(p)) writeFileSync(p, ''); const s = (Date.now() - 10 * 60e3) / 1000; utimesSync(p, s, s); return p; };
const s = { ...H.settings(), dir: join(tmp, 'heal'), archive: join(tmp, 'archive'), builds: join(tmp, 'builds'), console: 'off', notes: false, lockAgeMs: 120000 };

// a repo with two build folders (linked worktrees), like /opt/axf + /root/axf-builds/*
const repo = join(tmp, 'repo'); mkdirSync(repo); mkdirSync(s.builds);
git(repo, 'init', '-q', '-b', 'main'); writeFileSync(join(repo, 'a.txt'), 'a\n'); writeFileSync(join(repo, 'build.log'), 'one\n'); writeFileSync(join(repo, 'code.mjs'), 'x\n');
git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'init');
const wtA = join(s.builds, 'build-a'); const wtB = join(s.builds, 'build-b'); const wtGone = join(s.builds, 'build-gone');
git(repo, 'worktree', 'add', '-q', '-b', 'a', wtA); git(repo, 'worktree', 'add', '-q', '-b', 'b', wtB); git(repo, 'worktree', 'add', '-q', '-b', 'g', wtGone);
const common = join(repo, '.git');
const roots = [repo, wtA, wtB];

t('gitDirsOf: main checkout and linked worktree', () => {
  assert.equal(H.gitDirsOf(repo).common, common);
  const g = H.gitDirsOf(wtA); assert.equal(g.common, common); assert.equal(g.gitDir, join(common, 'worktrees', 'build-a'));
  assert.equal(H.gitDirsOf(tmp), null);
});

t('stale locks: old ones removed, young and held ones kept, dead worktree marker removed', () => {
  writeFileSync(join(common, 'worktrees', 'build-gone', 'locked'), 'held by a crashed run\n'); rmSync(wtGone, { recursive: true, force: true });
  const stale = [old(join(common, 'index.lock')), old(join(common, 'HEAD.lock')), old(join(common, 'worktrees', 'build-a', 'index.lock'))];
  mkdirSync(join(common, 'refs', 'heads'), { recursive: true }); stale.push(old(join(common, 'refs', 'heads', 'a.lock')));
  const young = join(common, 'worktrees', 'build-b', 'index.lock'); writeFileSync(young, '');
  const heldP = join(common, 'packed-refs.lock'); writeFileSync(heldP, ''); old(heldP);
  const fd = openSync(heldP, 'r'); // this process holds it, like a live git writing it
  try {
    const found = H.findLocks([...roots, wtGone]);
    assert.equal(found.length, 7, found.map((l) => l.path).join('\n'));
    const r = H.clearStaleLocks({ roots: [...roots, wtGone], minAgeMs: s.lockAgeMs });
    assert.deepEqual(r.removed.map((l) => l.path).sort(), [...stale, join(common, 'worktrees', 'build-gone', 'locked')].sort());
    for (const p of stale) assert.ok(!existsSync(p), p);
    assert.deepEqual(r.young.map((l) => l.path), [young]); assert.ok(existsSync(young));
    assert.deepEqual(r.held.map((l) => l.path), [heldP]); assert.match(r.held[0].why, /has it open/);
    assert.equal(git(repo, 'worktree', 'prune').code, 0); assert.ok(!existsSync(join(common, 'worktrees', 'build-gone')));
  } finally { closeSync(fd); rmSync(heldP, { force: true }); rmSync(young, { force: true }); }
});

t('a live git process in the checkout holds its locks', () => {
  const lock = { path: join(common, 'worktrees', 'build-a', 'index.lock'), kind: 'worktree', scope: [wtA] };
  const procs = [{ pid: 9, ppid: 1, comm: 'git', cmd: 'git rebase main', cwd: join(wtA, 'sub'), fds: () => [] }];
  assert.match(H.holderOf(lock, procs), /git pid 9/);
  assert.equal(H.holderOf(lock, [{ ...procs[0], cwd: wtB }]), '');
  assert.equal(H.holderOf(lock, [{ ...procs[0], comm: 'node', cmd: 'node x' }]), '');
});

t('git errors: the lock and the blocking files are read', () => {
  assert.equal(H.lockFromError("fatal: Unable to create '/opt/axf/.git/index.lock': File exists.\n\nAnother git process seems to be running"), '/opt/axf/.git/index.lock');
  assert.equal(H.lockFromError("error: cannot lock ref 'refs/heads/x': Unable to create '/r/.git/refs/heads/x.lock': File exists."), '/r/.git/refs/heads/x.lock');
  assert.equal(H.lockFromError('fatal: not a git repository'), '');
  const b = H.blockersFromError('error: Your local changes to the following files would be overwritten by merge:\n\tassets.log\n\t_claude/builds/store.json\nPlease commit your changes or stash them before you merge.\nerror: The following untracked working tree files would be overwritten by merge:\n\t.axf-brief.md\nPlease move or remove them before you merge.\nAborting');
  assert.deepEqual(b, { tracked: ['assets.log', '_claude/builds/store.json'], untracked: ['.axf-brief.md'] });
  assert.ok(H.isStray('assets.log') && H.isStray('_claude/builds/store.json') && H.isStray('.axf-queue.log') && H.isStray('apps/x/_claude/builds/a.md'));
  assert.ok(!H.isStray('framework/cli/x.mjs') && !H.isStray('apps/x/src/a.ts'));
});

t('healGit: a git call refused on a stale lock clears it and retries once', () => {
  const lock = join(common, 'worktrees', 'build-a', 'index.lock'); writeFileSync(lock, ''); old(lock);
  const fixes = []; let calls = 0;
  const run = makeRun(wtA, () => { calls += 1; });
  const r = H.healGit(run, ['add', 'a.txt'], { cwd: wtA }, { cwd: wtA, procs: [], record: (f) => fixes.push(...f) });
  assert.equal(r.code, 0, r.err); assert.equal(calls, 2); assert.equal(r.healed[0].kind, 'lock'); assert.equal(fixes[0].path, lock);
  assert.ok(!existsSync(lock));
  // a held lock is left alone and the error comes back
  writeFileSync(lock, ''); old(lock);
  const fd = openSync(lock, 'r');
  try { const r2 = H.healGit(run, ['add', 'a.txt'], { cwd: wtA }, { cwd: wtA, record: () => assert.fail('nothing to record') }); assert.notEqual(r2.code, 0); assert.equal(r2.healed, undefined); }
  finally { closeSync(fd); rmSync(lock, { force: true }); }
});

function makeRun(cwd, spy = () => {}) { const g = H.makeGit(cwd); return (a, o = {}) => { spy(a); return g(a, o); }; }

t('healGit: a merge blocked by stray logs and sync files moves them aside and merges', () => {
  // main changes build.log and adds .axf-brief.md; build-b has local edits to the same log and an untracked brief
  writeFileSync(join(repo, 'build.log'), 'two\n'); writeFileSync(join(repo, '.axf-brief.md'), 'brief\n'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'main moves');
  writeFileSync(join(wtB, 'build.log'), 'local scribble\n'); writeFileSync(join(wtB, '.axf-brief.md'), 'local brief\n');
  const fixes = [];
  const r = H.healGit(makeRun(wtB), ['merge', '-q', '--no-edit', 'main'], { cwd: wtB }, { cwd: wtB, procs: [], record: (f) => fixes.push(...f), archive: s.archive });
  assert.equal(r.code, 0, r.err); assert.equal(fixes[0].kind, 'stray');
  assert.deepEqual(fixes[0].files.sort(), ['.axf-brief.md', 'build.log']);
  assert.equal(readFileSync(join(wtB, 'build.log'), 'utf8'), 'two\n');
  const kept = spawnSync('find', [s.archive, '-name', 'build.log'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(readFileSync(kept, 'utf8'), 'local scribble\n');
});

t('healGit: a merge blocked by code is never touched', () => {
  writeFileSync(join(repo, 'code.mjs'), 'y\n'); git(repo, 'commit', '-qam', 'code'); writeFileSync(join(wtB, 'code.mjs'), 'mine\n');
  const r = H.healGit(makeRun(wtB), ['merge', '-q', '--no-edit', 'main'], { cwd: wtB }, { cwd: wtB, procs: [], record: () => assert.fail('nothing to record'), archive: s.archive });
  assert.notEqual(r.code, 0); assert.equal(readFileSync(join(wtB, 'code.mjs'), 'utf8'), 'mine\n');
});

t('guardGit wraps a runner with the same signature', () => {
  const lock = join(common, 'worktrees', 'build-a', 'HEAD.lock'); writeFileSync(lock, ''); old(lock);
  const g = H.guardGit(H.makeGit(wtA), { procs: [], record: () => {} });
  assert.equal(g(['commit', '-q', '--allow-empty', '-m', 'x'], { cwd: wtA, env: { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).code, 0);
  assert.ok(!existsSync(lock));
});

t('crashed sessions: dead pane or empty shell = reset; live claude, grace, or session-end = left', () => {
  const now = Date.parse('2026-11-10T03:00:00Z'); const at = '2026-11-10T02:00:00Z';
  const b = (id, extra = {}) => ({ id, status: 'running', pipeline: { session: `axf-${id}`, launchedAt: at, ...extra } });
  const panes = { 'axf-dead': [{ pid: 10, dead: true }], 'axf-shell': [{ pid: 20, dead: false }], 'axf-live': [{ pid: 30, dead: false }], 'axf-ended': [{ pid: 40, dead: true }], 'axf-fresh': [{ pid: 50, dead: true }], 'axf-gone': [] };
  const procs = [
    { pid: 20, ppid: 1, comm: 'bash', cmd: '-bash' },
    { pid: 30, ppid: 1, comm: 'bash', cmd: 'bash deploy/claude-headless.sh --inner' }, { pid: 31, ppid: 30, comm: 'claude', cmd: 'claude -p' },
  ];
  const builds = [b('dead'), b('shell'), b('live'), b('ended'), b('fresh', { launchedAt: '2026-11-10T02:55:00Z' }), b('gone'), { id: 'q', status: 'queued', pipeline: { session: 'axf-dead', launchedAt: at } }];
  const out = H.findCrashed({ builds, panes: (x) => panes[x] ?? [], procs, now, ended: (ses) => ses === 'axf-ended' });
  assert.deepEqual(out.map((c) => c.id), ['dead', 'shell']);
  assert.match(out[0].why, /pane is dead/); assert.match(out[1].why, /no claude process/);
  assert.deepEqual(H.resetCrashed(out, { dry: true }).map((f) => f.kind), ['session', 'session']);
});

t('fix log: one line per fix, the build named, one FYI alert', () => {
  const alerts = [];
  const fixes = [{ kind: 'lock', path: join(common, 'worktrees', 'build-a', 'index.lock'), checkout: wtA, why: 'stale' }, { kind: 'session', build: 'build-c', session: 'axf-build-c', why: 'its tmux pane is dead' }];
  const r = H.recordFixes(fixes, { s, alert: (a) => (alerts.push(a), true) });
  assert.equal(r.logged, 2); assert.deepEqual(r.notedBuilds, ['build-a', 'build-c']); assert.ok(r.sent);
  assert.equal(alerts.length, 1); assert.match(alerts[0].body, /^FYI, nothing to approve/); assert.equal(alerts[0].severity, 'success');
  const log = H.readFixLog({ s }); assert.equal(log.length, 2); assert.equal(log[0].build, 'build-a'); assert.match(log[1].text, /Reset crashed session/);
});

t('healRound: one round over locks and sessions, dry run changes nothing', () => {
  const lock = join(common, 'index.lock'); writeFileSync(lock, ''); old(lock);
  const dry = H.healRound({ roots, s, dry: true, procs: [], ended: () => false });
  assert.equal(dry.fixes.length, 1); assert.ok(existsSync(lock));
  const recs = [];
  const r = H.healRound({ roots, s, procs: [], record: (f) => (recs.push(...f), { logged: f.length }), ended: () => false });
  assert.equal(r.fixes.length, 1); assert.ok(!existsSync(lock)); assert.equal(recs.length, 1);
});

t('plain code: self-heal imports no model client', () => {
  const src = readFileSync(join(ROOT, 'framework/cli/self-heal.mjs'), 'utf8');
  assert.ok(!/anthropic|openai|@google\/generative|claude-agent-sdk|from ['"][^'"]*llm/i.test(src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n')));
});

t('the FYI goes to the fix log when a plugin provides it (found by capability, not folder name)', () => {
  const pl = join(tmp, 'plugins'); mkdirSync(join(pl, 'aaa'), { recursive: true }); mkdirSync(join(pl, 'zz-log'), { recursive: true });
  writeFileSync(join(pl, 'aaa', 'plugin.json'), JSON.stringify({ provides: ['view:other'] }));
  assert.equal(H.fixLogProvider(pl), '', 'no provider: the plain alert is used');
  writeFileSync(join(pl, 'zz-log', 'plugin.json'), JSON.stringify({ provides: ['view:fix-log'] }));
  assert.equal(H.fixLogProvider(pl), 'zz-log');
});

rmSync(tmp, { recursive: true, force: true });
console.log(`self-heal: ${n} checks passed`);

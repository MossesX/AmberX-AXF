#!/usr/bin/env node
// keep-fresh.mjs (drift keeper): running builds get main merged in their own worktree; dirty or session-held ones wait;
// every running build's commits-behind-main is recorded. Real git (origin bare + checkout + worktrees).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

process.env.AXF_CREW_SAY = 'off';
const { keepFresh, sessionHold, HOLD_FILE } = await import('./keep-fresh.mjs');
const { makeGit } = await import('./land.mjs');

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`ok ${name}`); };
const sh = (args, cwd) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const root = mkdtempSync(join(tmpdir(), 'keep-fresh-'));
const origin = join(root, 'origin.git'); const repo = join(root, 'repo'); const data = join(root, 'data'); mkdirSync(data);
sh(['init', '-q', '--bare', '-b', 'main', origin], root);
sh(['clone', '-q', origin, repo], root);
for (const [k, v] of [['user.name', 't'], ['user.email', 't@t']]) sh(['config', k, v], repo);
const commit = (cwd, f, text, msg) => { writeFileSync(join(cwd, f), text); sh(['add', f], cwd); sh(['commit', '-qm', msg], cwd); };
commit(repo, 'a.txt', 'one\n', 'a'); sh(['push', '-q', 'origin', 'HEAD:main'], repo);
const ids = ['clean', 'dirty', 'locked', 'held', 'gone'];
const wts = {};
for (const id of ids.slice(0, 4)) {
  const wt = join(root, `wt-${id}`);
  sh(['worktree', 'add', '-q', '-b', `claude/${id}`, wt, 'main'], repo);
  commit(wt, `${id}.txt`, `${id}\n`, id); sh(['push', '-q', 'origin', `claude/${id}`], wt);
  wts[`claude/${id}`] = wt;
}
// main moves on by three commits
sh(['checkout', '-q', '-b', 'tmp-main', 'main'], repo);
for (const i of [1, 2, 3]) commit(repo, `m${i}.txt`, `${i}\n`, `main ${i}`);
sh(['push', '-q', 'origin', 'HEAD:main'], repo);
sh(['fetch', '-q', 'origin'], repo);
writeFileSync(join(wts['claude/dirty'], 'dirty.txt'), 'edited, not committed\n');
const gitDir = sh(['rev-parse', '--git-dir'], wts['claude/locked']);
writeFileSync(join(resolve(wts['claude/locked'], gitDir), 'index.lock'), '');
writeFileSync(join(wts['claude/held'], HOLD_FILE), 'mid-step\n');

const s = { repo, slug: 'o/r', dataDir: data, remote: 'origin', base: 'main' };
const git = makeGit(repo, { retryWait: 10 });
const builds = ids.map((id) => ({ id, branch: `claude/${id}`, status: 'running', steps: [{ id: 's1', done: false }] }));
const recorded = {};
const record = (_s, id, behind) => { recorded[id] = behind; return { ok: true }; };

await t('a session lock is seen: index.lock, the hold file; a plain worktree has none', async () => {
  assert.match(sessionHold(git, wts['claude/locked']), /git command/);
  assert.match(sessionHold(git, wts['claude/held']), /asked the keeper/);
  assert.equal(sessionHold(git, wts['claude/clean']), '');
});

let st;
await t('one turn: the clean running build gets main merged in and pushed; the others wait with the reason', async () => {
  st = keepFresh({ s, git, builds, wts, record, nowMs: Date.parse('2026-11-14T23:00:00Z') });
  assert.equal(st.builds.clean.state, 'merged'); assert.equal(st.builds.clean.behind, 0);
  assert.equal(sh(['merge-base', '--is-ancestor', 'origin/main', 'origin/claude/clean'], repo), '', 'main is in the pushed branch');
  assert.ok(readFileSync(join(wts['claude/clean'], 'm3.txt'), 'utf8'), 'and in its worktree');
  assert.equal(st.builds.dirty.state, 'skipped'); assert.match(st.builds.dirty.why, /uncommitted/);
  assert.equal(st.builds.locked.state, 'skipped'); assert.match(st.builds.locked.why, /git command/);
  assert.equal(st.builds.held.state, 'skipped'); assert.match(st.builds.held.why, /asked the keeper/);
  assert.equal(st.builds.gone.state, 'skipped'); assert.match(st.builds.gone.why, /no worktree/);
});

await t('behind main is recorded for every running build', async () => {
  assert.deepEqual(recorded, { clean: 0, dirty: 3, locked: 3, held: 3 });
});

await t('the 30-minute clock: the merged one waits; skipped ones are tried again next turn', async () => {
  rmSync(join(wts['claude/held'], HOLD_FILE));
  const st2 = keepFresh({ s, git, builds, wts, record, nowMs: Date.parse('2026-11-14T23:05:00Z') });
  assert.equal(st2.builds.clean.at, st.builds.clean.at, 'not touched again within 30 minutes');
  assert.equal(st2.builds.held.state, 'merged', 'the hold is gone: merged now');
});

await t('a finished build is no longer kept fresh (the lander takes it)', async () => {
  const st3 = keepFresh({ s, git, builds: builds.map((b) => (b.id === 'clean' ? { ...b, status: 'built', steps: [{ id: 's1', done: true }] } : b)), wts, record, force: true, nowMs: Date.parse('2026-11-14T23:40:00Z') });
  assert.equal(st3.builds.clean, undefined);
});

rmSync(root, { recursive: true, force: true });
console.log(`keep-fresh: ${n} checks passed`);

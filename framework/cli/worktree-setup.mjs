#!/usr/bin/env node
/**
 * Worktree guard (build stop-auto-lander-committing-tracking s5): a build worktree never commits tracking files
 * (framework/core/tracking-paths.mjs, tracking-paths@1). Run by deploy/claude-headless.sh before a session starts.
 *
 *   node framework/cli/worktree-setup.mjs guard [--dir <worktree>] [--json]   mark tracked ones skip-worktree, exclude untracked ones
 *   node framework/cli/worktree-setup.mjs clear [--dir <worktree>] [--json]   undo skip-worktree (before a local merge of main)
 *   node framework/cli/worktree-setup.mjs status [--dir <worktree>] [--json]  what is marked
 *   node framework/cli/worktree-setup.mjs paths [--json]                      the tracking-paths list (for shell and Python callers)
 *
 * Only in a linked worktree on a branch other than main: the main checkout (the console, /opt/axf) is where builds-live
 * publishes from and is never touched. Tracked files get `git update-index --skip-worktree` (a `git add -A` or
 * `commit -a` leaves them out); untracked ones (journal parts once the journal leaves git) get a line in the
 * repository's info/exclude. AXF_WORKTREE_GUARD=off skips it.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACKING_PATHS, excludeLines, trackingPathspecs } from '../core/tracking-paths.mjs';

const git = (dir, args) => { const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 16 << 20 }); return { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }; };

/** Is `dir` a linked worktree on a branch other than main? → { ok, why, branch } */
export function isBuildWorktree(dir) {
  const gd = git(dir, ['rev-parse', '--git-dir']).out; const cd = git(dir, ['rev-parse', '--git-common-dir']).out;
  if (!gd || !cd) return { ok: false, why: 'not a git checkout' };
  if (resolve(dir, gd) === resolve(dir, cd)) return { ok: false, why: 'the main checkout (never guarded)' };
  const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).out;
  if (branch === 'main') return { ok: false, why: 'on main', branch };
  return { ok: true, branch };
}

const tracked = (dir) => git(dir, ['ls-files', '--', ...trackingPathspecs()]).out.split('\n').filter(Boolean);
const skipped = (dir) => git(dir, ['ls-files', '-v', '--', ...trackingPathspecs()]).out.split('\n').filter((l) => /^S /.test(l)).map((l) => l.slice(2));

function excludeFile(dir) {
  const p = git(dir, ['rev-parse', '--git-path', 'info/exclude']).out;
  return p ? (isAbsolute(p) ? p : join(dir, p)) : '';
}

/** Mark the tracked tracking files skip-worktree and add the exclude lines. → { ok, skip: [files], excluded: [lines], why } */
export function guard(dir) {
  if (process.env.AXF_WORKTREE_GUARD === 'off') return { ok: false, why: 'AXF_WORKTREE_GUARD=off', skip: [], excluded: [] };
  const w = isBuildWorktree(dir); if (!w.ok) return { ok: false, why: w.why, skip: [], excluded: [] };
  const files = tracked(dir);
  // a modified one stays modified on disk but leaves `git add -A` / `commit -a` / `git status`: it is the hub's, never the build's
  if (files.length) { const r = git(dir, ['update-index', '--skip-worktree', '--', ...files]); if (r.code) return { ok: false, why: r.err.slice(-200), skip: [], excluded: [] }; }
  const ex = excludeFile(dir); const added = [];
  if (ex) {
    let text = ''; try { text = readFileSync(ex, 'utf8'); } catch { mkdirSync(dirname(ex), { recursive: true }); }
    const have = new Set(text.split('\n'));
    const want = excludeLines().filter((l) => !have.has(l));
    if (want.length) { appendFileSync(ex, `${text && !text.endsWith('\n') ? '\n' : ''}# tracking-paths@1 (framework/cli/worktree-setup.mjs): build worktrees never commit these\n${want.join('\n')}\n`); added.push(...want); }
  }
  return { ok: true, branch: w.branch, skip: files, excluded: added };
}

/** Undo skip-worktree on the tracking files (exclude lines stay: they only hide untracked files). */
export function clear(dir) {
  const files = skipped(dir);
  if (files.length) git(dir, ['update-index', '--no-skip-worktree', '--', ...files]);
  return { ok: true, cleared: files };
}

export function main(argv) {
  const json = argv.includes('--json');
  const i = argv.indexOf('--dir'); const dir = resolve(i >= 0 ? argv[i + 1] || '.' : '.');
  const cmd = argv.find((a) => !a.startsWith('--') && a !== (i >= 0 ? argv[i + 1] : null)) || 'status';
  const print = (o, text) => console.log(json ? JSON.stringify(o) : text);
  if (cmd === 'paths') return print({ $axf: 'tracking-paths@1', paths: TRACKING_PATHS.map(({ id, kind, glob, re }) => ({ id, kind, glob, re: re.source })) }, TRACKING_PATHS.map((t) => t.glob).join('\n'));
  if (cmd === 'guard') { const r = guard(dir); return print(r, r.ok ? `worktree guard: ${r.skip.length} tracking file(s) skip-worktree, ${r.excluded.length} exclude line(s) added` : `worktree guard: skipped (${r.why})`); }
  if (cmd === 'clear') { const r = clear(dir); return print(r, `worktree guard: cleared skip-worktree on ${r.cleared.length} file(s)`); }
  if (cmd === 'status') { const w = isBuildWorktree(dir); const s = skipped(dir); return print({ ...w, skip: s }, `${w.ok ? `build worktree (${w.branch})` : w.why}: ${s.length} tracking file(s) skip-worktree`); }
  throw new Error('usage: worktree-setup.mjs guard | clear | status | paths [--dir <worktree>] [--json]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}

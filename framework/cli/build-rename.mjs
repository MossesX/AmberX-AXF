#!/usr/bin/env node
/**
 * build-rename — move a build whose id is over 40 characters to a short id (build-renames@1), everywhere at once.
 *
 * axHub's vps.build_land / build_stop / build_clean accept only ^[a-z0-9][a-z0-9-]{0,39}$, so a build filed with a long
 * id can't be landed or cleaned by them. A rename moves, in this order:
 *   1. its branch's own files: _claude/builds/reports/<old>.md (and <old>/), _claude/builds/shipped/<old>.json, and its
 *      THREADS.md rows, committed on the build's branch ("Rename build <old> to <new>");
 *   2. the worktree folder (git worktree move <root>/<old> <root>/<new>) and the branch (claude/<old> → claude/<new>),
 *      pushed;
 *   3. its open PR: a new PR from claude/<new> with the same title, body, base, draft state and labels; the old PR gets
 *      a comment linking the new one and is closed; only then is the old remote branch deleted;
 *   4. the builds store (new record, old one kept as a soft-deleted tombstone, published to main by builds-live) and
 *      _claude/builds/renames.json { old: new }, so every lookup by the old id keeps working.
 * The title (display name) never changes. A build with a live session (tmux pane or Claude process inside its folder)
 * is never touched.
 *
 *   node framework/cli/build-rename.mjs plan [--json]                   long-named worktrees: short id or why skipped
 *   node framework/cli/build-rename.mjs apply <old> [<new>] [--dry]     rename one build (new id defaults to the plan's)
 *   node framework/cli/build-rename.mjs resolve <id>                    the build's current id
 *
 * Environment: AXF_PIPELINE_WORKTREES (worktree root, default /root/axf-builds), AXF_BUILD_RENAME_REPO (owner/name,
 * default: the origin remote), GITHUB_TOKEN / the github-app broker for GitHub.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, readlinkSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ID_MAX, ID_RE, addRename, renamesText, shortId } from '../core/build-renames.mjs';
import * as storeCore from '../plan/builds-store-core.mjs';
import { createGitHub } from './github.mjs';
import { loadStore, readRenames, renameBuildNow, renamesFile, resolveBuildId } from './builds-store.mjs';

const root = () => process.env.AXF_PIPELINE_WORKTREES || '/root/axf-builds';
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (cwd, ...args) => { try { return git(cwd, ...args); } catch { return null; } };
const isWorktree = (dir) => { try { return statSync(join(dir, '.git')).isFile(); } catch { return false; } };

function repoOf(dir) {
  if (process.env.AXF_BUILD_RENAME_REPO) return process.env.AXF_BUILD_RENAME_REPO;
  const url = tryGit(dir, 'remote', 'get-url', 'origin') ?? '';
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  if (!m) throw new Error('no GitHub origin remote (set AXF_BUILD_RENAME_REPO=owner/name)');
  return `${m[1]}/${m[2]}`;
}

/** Folders with a live session: tmux panes and Claude processes whose working directory is inside them. */
export function busyFolders() {
  const paths = [];
  try { paths.push(...execFileSync('tmux', ['list-panes', '-a', '-F', '#{pane_current_path}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')); } catch { /* no tmux server */ }
  for (const pid of readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (!/(^|\/)claude\0/.test(cmd)) continue;
      paths.push(readlinkSync(`/proc/${pid}/cwd`));
    } catch { /* gone or not ours */ }
  }
  const top = `${root().replace(/\/+$/, '')}/`;
  return new Set(paths.filter((p) => p.startsWith(top)).map((p) => p.slice(top.length).split('/')[0]));
}

/** Open PRs by head branch name (one paginated call). */
async function openPrs(gh, repo) {
  const list = await gh.paginate(`/repos/${repo}/pulls?state=open&per_page=100`, { maxPages: 10 });
  return new Map(list.map((p) => [p.head?.ref, p]));
}

/** Every long-named worktree with its short id, or why it is skipped. */
export async function plan({ gh = createGitHub(), store = loadStore() } = {}) {
  const dir = root();
  const folders = readdirSync(dir).filter((f) => isWorktree(join(dir, f)));
  const repo = repoOf(join(dir, folders[0] ?? '.'));
  const prs = await openPrs(gh, repo);
  const remote = new Set((tryGit(join(dir, folders[0] ?? '.'), 'ls-remote', '--heads', 'origin') ?? '').split('\n').map((l) => l.replace(/^.*refs\/heads\//, '')));
  const renames = readRenames();
  const busy = busyFolders();
  const taken = new Set([...store.builds.map((b) => b.id), ...folders, ...[...remote].map((b) => b.replace(/^claude\//, '')), ...Object.keys(renames), ...Object.values(renames)]);
  const rows = [];
  for (const f of folders.filter((x) => x.length > ID_MAX).sort()) {
    const b = storeCore.findBuild(store, f);
    const pr = prs.get(`claude/${f}`);
    const skip = busy.has(f) ? 'a session is running in it' : b?.mergedAt && !pr ? `landed (PR ${b.pr} merged)` : '';
    const to = skip ? '' : shortId(f, (x) => taken.has(x));
    if (to) taken.add(to);
    rows.push({ from: f, to, skip, title: b?.title ?? '', pr: pr ? `#${pr.number}` : '', inStore: !!b });
  }
  return rows;
}

/** Rename the build's own files on its branch and commit them. Returns the paths committed. */
function renameBranchFiles(dir, from, to) {
  const tracked = (p) => tryGit(dir, 'ls-files', '--error-unmatch', p) !== null;
  const dirty = (p) => (tryGit(dir, 'status', '--porcelain', '--', p) ?? '').trim() !== '';
  const idRe = new RegExp(`${from.replace(/[-]/g, '\\-')}(?![a-z0-9-])`, 'g');
  const paths = [];
  const moves = [[`_claude/builds/reports/${from}.md`, `_claude/builds/reports/${to}.md`], [`_claude/builds/reports/${from}`, `_claude/builds/reports/${to}`], [`_claude/builds/shipped/${from}.json`, `_claude/builds/shipped/${to}.json`]];
  for (const [a, b] of moves) {
    if (!existsSync(join(dir, a)) || !tracked(a) || dirty(a) || existsSync(join(dir, b))) continue;
    git(dir, 'mv', a, b); paths.push(a, b);
    const files = statSync(join(dir, b)).isDirectory() ? git(dir, 'ls-files', b).split('\n').filter(Boolean) : [b];
    for (const f of files) {
      const p = join(dir, f); const text = readFileSync(p, 'utf8');
      let next = text.replace(idRe, to);
      if (f.endsWith('.json') && f.includes('/shipped/')) { const m = JSON.parse(text); if (m?.build?.id === from) { m.build.id = to; next = `${JSON.stringify(m, null, 1)}\n`; } }
      if (next !== text) { writeFileSync(p, next); git(dir, 'add', f); }
    }
  }
  const threads = '_claude/THREADS.md';
  if (tracked(threads) && !dirty(threads)) {
    const text = readFileSync(join(dir, threads), 'utf8');
    const cut = text.indexOf('\n## Live build log'); // the live log is history written by builds-live: left as it is
    const head = cut >= 0 ? text.slice(0, cut) : text;
    const next = head.replace(idRe, to) + (cut >= 0 ? text.slice(cut) : '');
    if (next !== text) { writeFileSync(join(dir, threads), next); paths.push(threads); }
  }
  if (!paths.length) return [];
  git(dir, 'commit', '-q', '-m', `Rename build ${from} to ${to}\n\nBuild names are at most 40 characters (axHub build_land / build_stop / build_clean).\nThe report, shipped manifest and THREADS rows follow the new id; the title is unchanged.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, '--', ...paths);
  return paths;
}

/** Rename one build. With dry: the steps it would take, nothing changed. */
export async function apply(from, to, { dry = false, gh = createGitHub(), by = process.env.AXF_ACTOR || 'build-rename' } = {}) {
  const dir = root(); const src = join(dir, from); const dst = join(dir, to);
  if (!ID_RE.test(to)) throw new Error(`"${to}" is not a valid build name (≤ 40: a-z, 0-9, dashes)`);
  if (!isWorktree(src)) throw new Error(`no worktree ${src}`);
  if (existsSync(dst)) throw new Error(`${dst} already exists`);
  if (busyFolders().has(from)) throw new Error(`${from} has a running session: not renamed`);
  const oldBranch = `claude/${from}`; const newBranch = `claude/${to}`;
  const head = git(src, 'rev-parse', '--abbrev-ref', 'HEAD');
  if (head !== oldBranch) throw new Error(`${from} is on ${head}, not ${oldBranch}`);
  if (tryGit(src, 'rev-parse', '--verify', '--quiet', `refs/heads/${newBranch}`)) throw new Error(`branch ${newBranch} already exists`);
  const remoteHeads = git(src, 'ls-remote', '--heads', 'origin', oldBranch, newBranch);
  if (remoteHeads.includes(`refs/heads/${newBranch}`)) throw new Error(`origin already has ${newBranch}`);
  const store = loadStore();
  if (storeCore.findBuild(store, to)) throw new Error(`"${to}" is already a build`);
  const repo = repoOf(src);
  const old = (await gh.json('GET', `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${repo.split('/')[0]}:${oldBranch}`)}`))?.[0] ?? null;
  const record = storeCore.findBuild(store, from);
  const steps = [`commit the renamed report / shipped / THREADS rows on ${oldBranch}`, `git worktree move ${src} ${dst}`, `git branch -m ${oldBranch} ${newBranch}`, `push ${newBranch}`,
    old ? `open a PR from ${newBranch} replacing #${old.number}, close #${old.number}` : 'no open PR', remoteHeads.includes(`refs/heads/${oldBranch}`) ? `delete origin ${oldBranch}` : `origin has no ${oldBranch}`,
    record ? `store: ${from} → ${to} (old record kept as a tombstone)` : 'not in the store', `renames.json: ${from} → ${to}`];
  if (dry) return { from, to, dry: true, steps };

  const committed = renameBranchFiles(src, from, to);
  git(src, 'worktree', 'move', src, dst);
  git(dst, 'branch', '-m', oldBranch, newBranch);
  git(dst, 'push', '-q', '-u', 'origin', `${newBranch}:${newBranch}`);
  let pr = null;
  if (old) {
    const note = `Replaces #${old.number}: the branch was renamed ${oldBranch} → ${newBranch} (build names are at most 40 characters, so axHub build_land can take it).`;
    pr = await gh.json('POST', `/repos/${repo}/pulls`, { title: old.title, body: `${old.body ?? ''}\n\n${note}`.trim(), head: newBranch, base: old.base.ref, draft: !!old.draft, maintainer_can_modify: true });
    const labels = (old.labels ?? []).map((l) => l.name).filter(Boolean);
    if (labels.length) await gh.json('POST', `/repos/${repo}/issues/${pr.number}/labels`, { labels });
    await gh.json('POST', `/repos/${repo}/issues/${old.number}/comments`, { body: `Superseded by #${pr.number}: the branch was renamed to \`${newBranch}\` (build names are at most 40 characters). Same commits, title and description.` });
    await gh.json('PATCH', `/repos/${repo}/pulls/${old.number}`, { state: 'closed' });
  }
  if (remoteHeads.includes(`refs/heads/${oldBranch}`)) git(dst, 'push', '-q', 'origin', '--delete', oldBranch);
  if (record) renameBuildNow(from, to, { branch: newBranch, ...(pr ? { pr: `#${pr.number}` } : {}), by });
  else writeRenameOnly(from, to);
  return { from, to, branch: newBranch, folder: dst, pr: pr ? `#${pr.number}` : '', replaced: old ? `#${old.number}` : '', committed, inStore: !!record };
}

/** A build that isn't in the store (started outside the orchestrator): only renames.json learns the new id. */
function writeRenameOnly(from, to) {
  const f = renamesFile(); const tmp = `${f}.tmp-${process.pid}`;
  writeFileSync(tmp, renamesText(addRename(readRenames(), from, to))); renameSync(tmp, f);
}

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => !a.startsWith('--'));
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const [cmd = 'plan', a, b] = args;
  if (cmd === 'resolve') { const id = resolveBuildId(a ?? ''); return out({ ok: true, id }, id); }
  if (cmd === 'plan') {
    const rows = await plan();
    return out({ ok: true, rows }, rows.map((r) => (r.skip ? `skip   ${r.from}: ${r.skip}` : `rename ${r.from} → ${r.to}${r.pr ? ` (${r.pr})` : ''}`)).join('\n') || 'No long build names.');
  }
  if (cmd === 'apply') {
    if (!a) throw new Error('apply <old> [<new>] [--dry]');
    const to = b || (await plan()).find((r) => r.from === a)?.to;
    if (!to) throw new Error(`no short id planned for "${a}" (skipped or not a long-named worktree)`);
    const r = await apply(a, to, { dry: argv.includes('--dry') });
    return out({ ok: true, ...r }, r.dry ? [`${a} → ${to} would:`, ...r.steps.map((s) => `  ${s}`)].join('\n') : `${r.from} → ${r.to}${r.pr ? ` · PR ${r.pr} (replaces ${r.replaced})` : ''}${r.committed.length ? ` · ${r.committed.length} path(s) renamed on the branch` : ''}`);
  }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(`build-rename: ${e.message}`);
    process.exitCode = 1;
  });
}

/**
 * merge-watch@1 host: main's landings read from git.
 *
 * Main's first-parent line is not the whole story. A build_land fast-forward (or a branch that merged main and was then
 * fast-forwarded) makes the branch's own line main's first parent; every PR merge that reached main while the branch
 * was open then sits on the SECOND parent of that "Merge origin/main into claude/<branch>" commit. Root cause of the
 * Nov 13-15 gap (report: _claude/builds/reports/vps-sends-shipped-features-every-merge.md): #687 #693 #696 #689 #324
 * were only reachable that way.
 *
 * So the walk takes main's first-parent line and, for every merge commit on it that is not a PR merge / batch (those
 * carry the branch on parent 2), the main line behind its second parent (`--first-parent p2 ^p1`), recursively.
 * Each line becomes landings through the pure engine (framework/core/merge-watch.mjs landingsOf) on its own, so a
 * side line's plain commits never fold into the branch's build_land landing.
 *
 *   commitsOf({ ref, since, stop, cwd })  → [{ sha, parents, at, subject }] for one line, newest first
 *   mainLines({ ref, since, stop, cwd })  → [{ via, commits }]  the first-parent line, then each side line
 *   mainLandings({ ref, since, stop, cwd, now }) → merge-watch-entry@1 list, oldest first, unique by sha
 *
 * `stop` = a sha already processed (lastSeen); `since` = an ISO date. git runs through `git` (injectable for tests).
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as MW from '../../core/merge-watch.mjs';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
/** The checkout git runs in and reports are read from: AXF_MERGE_WATCH_REPO (a container's clone), else this code's repo. */
export const gitRoot = (env = process.env) => env.AXF_MERGE_WATCH_REPO || REPO_ROOT;
const SEP = '\x1f';
const MAX_DEPTH = 4;

export function runGit(args, { cwd = gitRoot() } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw Object.assign(new Error(`git ${args[0]}: ${(r.stderr || '').trim().slice(0, 300) || `exit ${r.status}`}`), { code: 1 });
  return r.stdout;
}

const parse = (out) => String(out || '').split('\n').filter(Boolean).map((l) => {
  const [sha, parents, at, ...s] = l.split(SEP);
  return { sha, parents: parents ? parents.split(' ') : [], at: MW.normEntry({ sha, at })?.at || at, subject: s.join(SEP) };
});

/** One line of history, newest first. `exclude` = shas whose ancestors are left out (already-seen main, the branch side). */
export function commitsOf({ tip, exclude = [], since = '', git = runGit, cwd = gitRoot() } = {}) {
  const args = ['log', '--first-parent', `--format=%H${SEP}%P${SEP}%cI${SEP}%s`];
  if (since) args.push(`--since=${since}`);
  args.push(tip, ...exclude.filter(Boolean).map((x) => `^${x}`), '--');
  return parse(git(args, { cwd }));
}

const carriesBranch = (c) => { const k = MW.classifyCommit(c).kind; return k === 'pr-merge' || k === 'batch'; };
/** A merge whose second parent is main's line: build_land, "Merge origin/main into …", "Merge branch 'main' …". */
export const mergesMain = (c) => c.parents.length > 1 && !carriesBranch(c) && /\b(origin\/main|'main'|branch main)\b|\(build_land\)/.test(c.subject);

/** Main's first-parent line plus the main line behind each non-PR merge's second parent, recursively. */
export function mainLines({ ref = MW.DEFAULT_REF, since = '', stop = '', git = runGit, cwd = gitRoot() } = {}) {
  const lines = []; const seen = new Set();
  const walk = (tip, exclude, via, depth) => {
    const cs = commitsOf({ tip, exclude, since, git, cwd }).filter((c) => !seen.has(c.sha));
    if (!cs.length) return;
    for (const c of cs) seen.add(c.sha);
    lines.push({ via, commits: cs });
    if (depth >= MAX_DEPTH) return;
    for (const c of cs) if (mergesMain(c)) walk(c.parents[1], [c.parents[0], stop], c.sha, depth + 1);
  };
  walk(ref, [stop], '', 0);
  return lines;
}

/** Every landing on main in range, oldest first, one per sha. */
export function mainLandings({ now = new Date().toISOString(), ...o } = {}) {
  const out = new Map();
  for (const line of mainLines(o)) for (const e of MW.landingsOf(line.commits, { now })) if (!out.has(e.sha)) out.set(e.sha, line.via ? { ...e, via: line.via } : e);
  return [...out.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

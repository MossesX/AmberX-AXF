/**
 * Tracking paths (build stop-auto-lander-committing-tracking): the one list of files that carry build status rather
 * than a build's work. builds-live writes them on main as status-only `[skip ci]` commits; the hub data store holds
 * the live copies. A build branch never commits them:
 *   - the auto-lander resets them in a build worktree to the branch's merge-base copy instead of committing them
 *     (push-banner land/land.mjs cleanWorktree)
 *   - a lander merge of main into a build takes main's copy on a conflict (land.mjs resolveConflicts)
 *   - a headless session's worktree marks them skip-worktree / excluded (deploy/claude-headless.sh, worktree-guard)
 *   - CI fails a PR that changes them outside builds-live status commits (framework/cli/check-tracking-files.mjs)
 *
 * Pure: no IO. Every consumer (Node, the Python resolver through `node … --json`, the shell guard) reads this list.
 * Open registry: add a pattern here and every consumer follows; nothing else lists these files.
 */

export const TRACKING_FRAME = 'tracking-paths@1';

/**
 * Each entry: id, a git pathspec glob (for `git checkout`, `git update-index`, .git/info/exclude) and the anchored
 * regex the same files match. `kind` says who owns the file: builds (the builds store and its exports) or plan (the
 * pending list and build queue exports synced with the hub).
 */
export const TRACKING_PATHS = Object.freeze([
  { id: 'builds-store', kind: 'builds', glob: '_claude/builds/store.json', re: /^_claude\/builds\/store\.json$/ },
  { id: 'origins', kind: 'builds', glob: '_claude/builds/origins.json', re: /^_claude\/builds\/origins\.json$/ },
  { id: 'journal', kind: 'builds', glob: '_claude/builds/journal/*.jsonl', re: /^_claude\/builds\/journal\/[^/]+\.jsonl$/ },
  { id: 'pending', kind: 'plan', glob: 'framework/plan/pending.json', re: /^framework\/plan\/pending\.json$/ },
  { id: 'build-queue', kind: 'plan', glob: 'framework/plan/build-queue.json', re: /^framework\/plan\/build-queue\.json$/ },
]);

/**
 * Retired tracking files: they carried build status once and exist nowhere now. The orchestrator.json status file
 * (Nov 25 2026, Brett: "We don't need that file. All the status states exist in the database."): status is a row of
 * the builds store. A retired file is deleted wherever it turns up: a merge never keeps it (whichever side still has
 * it), nothing writes it, a worktree stops hiding it, and its removal never counts as a build's work.
 */
export const RETIRED_PATHS = Object.freeze([
  { id: 'orchestrator', kind: 'builds', glob: '_claude/builds/orchestrator.json', re: /^_claude\/builds\/orchestrator\.json$/ },
  { id: 'orchestrator-profile', kind: 'builds', glob: '_claude/builds/profiles/*/orchestrator.json', re: /^_claude\/builds\/profiles\/[^/]+\/orchestrator\.json$/ },
]);

const clean = (p) => String(p || '').trim().replace(/^"|"$/g, '').replace(/^\.\//, '');

/** Is this repo path a tracking file? */
export const isTracking = (path) => { const p = clean(path); return TRACKING_PATHS.some((t) => t.re.test(p)); };

/** Is this repo path a retired tracking file (deleted wherever it turns up)? */
export const isRetired = (path) => { const p = clean(path); return RETIRED_PATHS.some((t) => t.re.test(p)); };

/** The git pathspecs of the retired files. */
export const retiredPathspecs = () => RETIRED_PATHS.map((t) => `:(glob)${t.glob}`);

/** The entry a path matches, or null. */
export const trackingEntry = (path) => { const p = clean(path); return TRACKING_PATHS.find((t) => t.re.test(p)) || null; };

/** Split a list of paths into { tracking, other }. */
export function splitTracking(paths) {
  const out = { tracking: [], other: [] };
  for (const p of paths || []) (isTracking(p) ? out.tracking : out.other).push(clean(p));
  return out;
}

/** The git pathspecs for every tracking file (`git checkout <base> -- …`, `git ls-files -- …`). */
export const trackingPathspecs = () => TRACKING_PATHS.map((t) => `:(glob)${t.glob}`);

/** The lines a worktree's .git/info/exclude gets for the untracked ones (the journal once it leaves git). */
export const excludeLines = () => TRACKING_PATHS.map((t) => `/${t.glob}`);

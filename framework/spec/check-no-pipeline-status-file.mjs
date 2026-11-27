#!/usr/bin/env node
/**
 * No pipeline status file (Brett, Nov 25 2026: "We don't need that file. All the status states exist in the
 * database."). The old whole-document export of every build, `_claude/builds/orchestrator.json` (and each profile's
 * copy under `_claude/builds/profiles/<id>/`), is retired: a build's status is its row in the builds store on Postgres.
 * This guard fails CI when the file comes back, in any of three ways:
 *
 *   1. the file exists      a file with that name anywhere in the checkout (tracked or not; node_modules and .git are
 *                           not walked), or tracked in git under any folder
 *   2. the file is named    a source file refers to it by name. The files that still name it today (the code that
 *                           retires it, tests that assert it stays away, the old migration) are counted per file in
 *                           `pipeline-status-file.baseline.json`; a file not in it that names the status file fails,
 *                           and so does a count that goes up. Counts only go down: `--update` rewrites the baseline
 *                           and refuses to raise one or to add a file unless `--allow-raise` (a reviewer sees it).
 *   3. a new big document   a tracked runtime .json under `_claude/builds` over SIZE_CAP. The two documents builds-live
 *                           still carries on main (EXEMPT) are named here with the reason; nothing else may grow into
 *                           the next status file.
 *
 * Scope of 2: tracked source and config (js, ts, py, sh, yaml, json, toml, kt, .gitattributes). Not read: this guard and
 * its baseline, history and notes (`changes/`, `sessions/`, `_claude/`, `assets.log`), plan data (`framework/plan/*.json`:
 * build briefs quote whatever Brett said), baked framework copies (`apps/<app>/src/axf/`, regenerated from
 * framework/core) and markdown.
 *
 *   node framework/spec/check-no-pipeline-status-file.mjs             check (CI)
 *   node framework/spec/check-no-pipeline-status-file.mjs --list      every line that names the file
 *   node framework/spec/check-no-pipeline-status-file.mjs --update    rewrite the baseline (lower counts only)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SELF = 'framework/spec/check-no-pipeline-status-file.mjs';
const BASELINE_REL = 'framework/spec/pipeline-status-file.baseline.json';

/** The retired file's name, as a file on disk. */
export const STATUS_FILE = 'orchestrator.json';
/** The name inside source text: plain, or escaped in a regex; never as the tail of another name (build-orchestrator.json). */
export const NAME = /(?<![\w-])orchestrator\\{0,2}\.json(?![\w-])/g;
/** Tracked files that are source or config. */
export const SOURCE = /\.(mjs|cjs|js|jsx|ts|tsx|mts|py|sh|ya?ml|json|toml|kt|kts)$|(^|\/)\.gitattributes$/;
/** History, notes and baked copies: they may tell the story of the file, they can't bring it back. */
export const SKIP = /^(changes|sessions|_claude)\/|(^|\/)(node_modules|dist|build|__pycache__)\/|^apps\/[^/]+\/src\/axf\/|^framework\/plan\/.*\.json$|^assets\.log$/;
/** The most a tracked runtime .json under _claude/builds may weigh. */
export const SIZE_CAP = 2 * 1024 * 1024;
/** Runtime documents: everything under _claude/builds but each build's report folder (evidence, not state). */
const RUNTIME = /^_claude\/builds\/(?!reports\/).*\.json$/;
/**
 * Documents over the cap that main still carries today. They are the builds store's tracking files (tracking-paths@1),
 * published by builds-live as status-only commits; untracking them belongs to the Postgres migration, not this guard.
 */
export const EXEMPT = Object.freeze({
  '_claude/builds/store.json': 'builds-store tracking file (tracking-paths@1): the store itself is on Postgres',
  '_claude/builds/origins.json': 'origins tracking file (tracking-paths@1): becomes the build_origins table',
});

/** How many times a source text names the status file, and on which lines: [{ line, text }]. */
export function scan(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const n = lines[i].match(NAME)?.length ?? 0;
    for (let k = 0; k < n; k += 1) out.push({ line: i + 1, text: lines[i].trim().slice(0, 160) });
  }
  return out;
}

/** Is this repo path read by check 2? */
export const inScope = (file) => SOURCE.test(file) && !SKIP.test(file) && file !== SELF && file !== BASELINE_REL;

/** Files named like the status file under a folder (not node_modules, not .git): repo-relative paths. */
export function findOnDisk(root) {
  const hits = [];
  const walk = (dir, rel) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), r);
      else if (e.name === STATUS_FILE) hits.push(r);
    }
  };
  walk(root, '');
  return hits.sort();
}

/**
 * The three checks over a checkout. `tracked` is the list of tracked paths (git ls-files); `baseline` the allowed
 * counts per file. → { failures: [string], counts: { file: n }, lines: [{ file, line, text }], lowered: [file] }
 */
export function check({ root = ROOT, tracked, baseline = {} }) {
  const failures = [];
  // 1. the file exists
  const present = new Set([...findOnDisk(root), ...tracked.filter((f) => f.split('/').pop() === STATUS_FILE)]);
  for (const f of [...present].sort()) failures.push(`${f}: the pipeline status file is back. Delete it (git rm); build status is a row of the builds store.`);
  // 2. the file is named
  const counts = {}; const lines = [];
  for (const file of tracked) {
    if (!inScope(file)) continue;
    let text = '';
    try { text = readFileSync(join(root, file), 'utf8'); } catch { continue; }
    if (!text.includes('orchestrator')) continue;
    const found = scan(text);
    if (!found.length) continue;
    counts[file] = found.length;
    for (const x of found) lines.push({ file, ...x });
  }
  for (const [file, n] of Object.entries(counts)) {
    const allowed = baseline[file] ?? 0;
    if (n > allowed) {
      const where = lines.filter((x) => x.file === file).map((x) => x.line).join(', ');
      failures.push(allowed
        ? `${file}: names the pipeline status file ${n} times, the baseline allows ${allowed} (lines ${where}). Read and write build status through the builds store.`
        : `${file}: names the pipeline status file (line ${where}). Nothing reads or writes it: use the builds store (readBuild / withBuild / queryBuilds, data_store.builds_page / build_update).`);
    }
  }
  const lowered = Object.keys(baseline).filter((f) => (counts[f] ?? 0) < baseline[f]).sort();
  // 3. a new big document
  for (const file of tracked) {
    if (!RUNTIME.test(file) || EXEMPT[file]) continue;
    let size = 0;
    try { size = statSync(join(root, file)).size; } catch { continue; }
    if (size > SIZE_CAP) failures.push(`${file}: ${(size / 1048576).toFixed(1)} MB, over the ${(SIZE_CAP / 1048576).toFixed(0)} MB cap for a tracked runtime .json under _claude/builds. State that size belongs in the builds store, not in a file.`);
  }
  return { failures, counts, lines, lowered };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = new Set(process.argv.slice(2));
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 << 20 }).split('\0').filter(Boolean)
    .filter((f) => existsSync(join(ROOT, f)) || f.split('/').pop() === STATUS_FILE);
  const file = join(ROOT, BASELINE_REL);
  const doc = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { files: {} };
  const r = check({ tracked, baseline: doc.files ?? {} });
  if (args.has('--list')) {
    for (const x of r.lines) console.log(`${x.file}:${x.line}  ${x.text}`);
    console.log(`${r.lines.length} line(s) in ${Object.keys(r.counts).length} file(s) name the pipeline status file`);
  } else if (args.has('--update')) {
    const raised = Object.entries(r.counts).filter(([f, n]) => n > (doc.files?.[f] ?? 0)).map(([f]) => f);
    if (raised.length && !args.has('--allow-raise')) {
      console.error(`refused: the baseline would grow for ${raised.join(', ')}. Counts only go down (--allow-raise to override, and say why in the commit).`);
      process.exit(1);
    }
    const files = Object.fromEntries(Object.keys(r.counts).sort().map((f) => [f, r.counts[f]]));
    writeFileSync(file, `${JSON.stringify({ $axf: 'pipeline-status-file-baseline@1', note: doc.note ?? '', files }, null, 1)}\n`); // axf-data: not data (a CI baseline in the repo, written by hand with --update)
    console.log(`baseline: ${Object.keys(files).length} file(s), ${Object.values(files).reduce((a, n) => a + n, 0)} mention(s)`);
  } else {
    for (const f of r.failures) console.error(`✗ ${f}`);
    if (r.failures.length) { console.error(`\ncheck-no-pipeline-status-file: ${r.failures.length} failure(s)`); process.exit(1); }
    if (r.lowered.length) console.log(`note: ${r.lowered.length} file(s) name it less than the baseline allows; run with --update to lower it (${r.lowered.slice(0, 5).join(', ')}${r.lowered.length > 5 ? ', …' : ''})`);
    console.log(`check-no-pipeline-status-file: no status file in the checkout, no new mention (${Object.keys(r.counts).length} baselined file(s)), no tracked runtime .json under _claude/builds over ${(SIZE_CAP / 1048576).toFixed(0)} MB`);
  }
}

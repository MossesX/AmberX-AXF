#!/usr/bin/env node
/**
 * persist — where the framework's live data lives (claude-fs@1, axHub decisions #71-#76).
 *
 * Live data (the paths in `_memory/data.json`: pending list, plan + media, build queue, catalog status +
 * libraries index, tracker.json) is read and written in the project's data folder on the hub:
 *
 *   /Claude/projects/amberx-axf/data/<same path as in the repo>
 *   e.g. /Claude/projects/amberx-axf/data/framework/plan/pending.json
 *
 * Resolution of the data folder:
 *   AXF_DATA_DIR set         → that folder exactly ('off' forces the repo copy, e.g. in CI)
 *   AXF_PERSIST_DIR set      → <that>/<AXF_PERSIST_REPO> (older setups; 'off' forces the repo copy)
 *   else /Claude exists      → /Claude/projects/<AXF_PERSIST_REPO>/data (CLAUDE_ROOT overrides /Claude)
 *   else                     → the repo copy (laptops, CI, fresh clones)
 * AXF_PERSIST_REPO overrides the project name (default: amberx-axf).
 *
 * A file missing on the hub is seeded from the repo copy the first time it is read. The repo copies at the
 * original paths are synced snapshots: `claude-sync sync` keeps them in step (three-way, conflicts held), and
 * they are committed.
 *
 *   node framework/cli/persist.mjs            where each live file is read from
 *   node framework/cli/persist.mjs push       copy repo → hub for files the hub doesn't have yet (--force: overwrite)
 *   node framework/cli/persist.mjs pull       copy hub → repo, to commit a snapshot
 */
import { cpSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const CLAUDE_ROOT = process.env.CLAUDE_ROOT || '/Claude';
const PROJECT = () => process.env.AXF_PERSIST_REPO || 'amberx-axf';

/** Built-in list, used when `_memory/data.json` is missing or unreadable. */
const DEFAULT_LIVE_DATA = [
  'framework/plan/pending.json',
  'framework/plan/plan.json',
  'framework/plan/build-queue.json',
  'framework/plan/media/',
  'framework/catalog/status.json',
  'framework/catalog/libraries.json',
  'tracker.json',
];

/** Live data, as paths relative to the repo root (directories end with '/'), from `_memory/data.json` (claude-data@1). */
export const LIVE_DATA = (() => {
  try {
    const map = JSON.parse(readFileSync(join(REPO_ROOT, '_memory', 'data.json'), 'utf8'));
    const paths = (map.paths ?? []).filter((p) => typeof p === 'string' && p && !p.startsWith('/') && !p.split('/').includes('..'));
    return paths.length ? paths : DEFAULT_LIVE_DATA;
  } catch { return DEFAULT_LIVE_DATA; }
})();

/** The hub folder holding this repo's data, or null when data stays in the repo. */
export function persistRoot() {
  const exact = process.env.AXF_DATA_DIR;
  if (exact !== undefined) return exact && exact !== 'off' ? exact : null;
  const legacy = process.env.AXF_PERSIST_DIR;
  if (legacy !== undefined) return legacy && legacy !== 'off' ? join(legacy, PROJECT()) : null;
  return existsSync(CLAUDE_ROOT) ? join(CLAUDE_ROOT, 'projects', PROJECT(), 'data') : null;
}

/**
 * Absolute path to read/write one live data file (`rel` relative to the repo root).
 * On the hub, a missing file is seeded from the repo copy; parent folders are created so writes succeed.
 */
export function dataPath(rel) {
  const repoPath = join(REPO_ROOT, rel);
  const root = persistRoot();
  if (!root) return repoPath;
  const p = join(root, rel);
  if (!existsSync(p)) {
    mkdirSync(rel.endsWith('/') ? p : dirname(p), { recursive: true });
    if (existsSync(repoPath)) cpSync(repoPath, p, { recursive: true });
  }
  return p;
}

function copy(from, to, force) {
  if (!existsSync(from)) return 'missing';
  if (existsSync(to) && !force && !statSync(from).isDirectory()) return 'kept';
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, force });
  return 'copied';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2] ?? 'status';
  const force = process.argv.includes('--force');
  const root = persistRoot();
  if (!root) {
    console.log(`Live data is read from the repo (no ${CLAUDE_ROOT} folder here; set AXF_DATA_DIR to use another one).`);
    process.exit(cmd === 'status' ? 0 : 1);
  }
  console.log(`Hub data folder: ${root}`);
  for (const rel of LIVE_DATA) {
    const repo = join(REPO_ROOT, rel), hub = join(root, rel);
    if (cmd === 'push') console.log(`${copy(repo, hub, force).padEnd(8)} ${rel}`);
    else if (cmd === 'pull') console.log(`${copy(hub, repo, true).padEnd(8)} ${rel}`);
    else console.log(`${existsSync(hub) ? 'hub     ' : 'seed    '} ${rel}`);
  }
}

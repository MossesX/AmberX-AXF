#!/usr/bin/env node
/**
 * persist — where the framework's live data lives.
 *
 * Live data (the pending build list, the plan + its media, the build queue, catalog status + libraries index,
 * tracker.json) is read
 * and written in the hub's persist folder on the VPS, in a subfolder named after this repo:
 *
 *   <AXF_PERSIST_DIR>/<AXF_PERSIST_REPO>/<same path as in the repo>
 *   e.g. /opt/axhub/persist/amberx-axf/framework/plan/pending.json
 *
 * Resolution of the persist folder:
 *   AXF_PERSIST_DIR set      → that folder ('off' or '' forces the repo copy, e.g. in CI)
 *   else /opt/axhub/persist  → used when it exists (the hub's folder on the VPS)
 *   else                     → the repo copy (laptops, CI, fresh clones): behaviour is unchanged
 * AXF_PERSIST_REPO overrides the subfolder name (default: amberx-axf).
 *
 * A file missing on the hub is seeded from the repo copy the first time it is read, so nothing is lost on switch-over.
 * The repo copies stay as the seed and as committed snapshots (`pull`), since the repo is also the shared memory.
 *
 *   node framework/cli/persist.mjs            where each live file is read from
 *   node framework/cli/persist.mjs push       copy repo → hub for files the hub doesn't have yet (--force: overwrite)
 *   node framework/cli/persist.mjs pull       copy hub → repo, to commit a snapshot
 */
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const DEFAULT_HUB_PERSIST = '/opt/axhub/persist';

/** Live data, as paths relative to the repo root. Directories end with '/'. */
export const LIVE_DATA = [
  'framework/plan/pending.json',
  'framework/plan/plan.json',
  'framework/plan/build-queue.json',
  'framework/plan/media/',
  'framework/catalog/status.json',
  'framework/catalog/libraries.json',
  'tracker.json',
];

/** The hub folder holding this repo's data, or null when data stays in the repo. */
export function persistRoot() {
  const env = process.env.AXF_PERSIST_DIR;
  let base;
  if (env !== undefined) base = env === 'off' ? '' : env;
  else base = existsSync(DEFAULT_HUB_PERSIST) ? DEFAULT_HUB_PERSIST : '';
  return base ? join(base, process.env.AXF_PERSIST_REPO || 'amberx-axf') : null;
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
    console.log(`Live data is read from the repo (no hub persist folder: set AXF_PERSIST_DIR or create ${DEFAULT_HUB_PERSIST}).`);
    process.exit(cmd === 'status' ? 0 : 1);
  }
  console.log(`Hub persist folder: ${root}`);
  for (const rel of LIVE_DATA) {
    const repo = join(REPO_ROOT, rel), hub = join(root, rel);
    if (cmd === 'push') console.log(`${copy(repo, hub, force).padEnd(8)} ${rel}`);
    else if (cmd === 'pull') console.log(`${copy(hub, repo, true).padEnd(8)} ${rel}`);
    else console.log(`${existsSync(hub) ? 'hub     ' : 'seed    '} ${rel}`);
  }
}

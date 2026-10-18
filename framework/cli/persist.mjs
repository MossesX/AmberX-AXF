#!/usr/bin/env node
/**
 * persist — where the framework's shared data lives.
 *
 * Shared data is what the repo's project manifest (project.manifest.json) lists under data.shared: the pending
 * build list, the plan + its media, the build queue, catalog status + libraries index, the project rules,
 * tracker.json. On the VPS it is read and written in the hub's projects tree, in the project's _data folder,
 * at the same path as in the repo (axhub-projects@1):
 *
 *   /projects/<manifest name>/_data/<same path as in the repo>
 *   e.g. /projects/amberx-axf/_data/framework/plan/pending.json
 *
 * Resolution of the data folder:
 *   AXF_DATA_DIR set             → exactly that folder ('off' or '' forces the repo copy, e.g. in CI)
 *   AXF_PERSIST_DIR set          → legacy: <that>/<name> ('off' = repo)
 *   /projects exists             → /projects/<name>/_data (AXHUB_PROJECTS_DIR overrides /projects): the
 *                                  axhub-projects volume, mounted in the Dev Console container
 *   /opt/axhub/persist/<name>    → legacy folder, while the installer hasn't moved it yet
 *   else                         → the repo copy (laptops, CI, fresh clones)
 *
 * A file missing there is seeded from the repo copy the first time it is read, so nothing is lost on switch-over.
 * The repo copies stay as the seed and as committed snapshots (claude-sync sync, or `pull` here, then commit).
 *
 *   node framework/cli/persist.mjs            where each shared file is read from
 *   node framework/cli/persist.mjs push       copy repo → hub for files the hub doesn't have yet (--force: overwrite)
 *   node framework/cli/persist.mjs pull       copy hub → repo, to commit a snapshot
 */
import { cpSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const DEFAULT_HUB_PERSIST = '/opt/axhub/persist';
export const DEFAULT_PROJECTS_DIR = '/projects';

/** Used when the manifest can't be read (it is validated elsewhere; this module only needs its name and paths). */
const FALLBACK_DATA = [
  'framework/plan/pending.json',
  'framework/plan/plan.json',
  'framework/plan/build-queue.json',
  'framework/plan/media/',
  'framework/catalog/status.json',
  'framework/catalog/libraries.json',
  'framework/schemas/project-rules.json',
  'tracker.json',
];

function rootManifest() {
  try { return JSON.parse(readFileSync(join(REPO_ROOT, 'project.manifest.json'), 'utf8')); } catch { return {}; }
}
const MANIFEST = rootManifest();
/** The project's name = its folder in the hub's /projects. */
export const PROJECT_NAME = typeof MANIFEST.name === 'string' && MANIFEST.name ? MANIFEST.name : 'amberx-axf';
/** Shared data, as paths relative to the repo root (directories end with '/'): the manifest's data.shared. */
export const LIVE_DATA = Array.isArray(MANIFEST.data?.shared) && MANIFEST.data.shared.length ? MANIFEST.data.shared.filter((p) => typeof p === 'string') : FALLBACK_DATA;

/** The folder holding this project's shared data, or null when data stays in the repo. */
export function persistRoot() {
  const exact = process.env.AXF_DATA_DIR;
  if (exact !== undefined) return exact && exact !== 'off' ? exact : null;
  const legacy = process.env.AXF_PERSIST_DIR;
  if (legacy !== undefined) return legacy && legacy !== 'off' ? join(legacy, process.env.AXF_PERSIST_REPO || PROJECT_NAME) : null;
  const projects = process.env.AXHUB_PROJECTS_DIR || DEFAULT_PROJECTS_DIR;
  if (existsSync(projects)) return join(projects, PROJECT_NAME, '_data');
  const old = join(DEFAULT_HUB_PERSIST, PROJECT_NAME);
  return existsSync(old) ? old : null;
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
    console.log(`Shared data is read from the repo (no ${DEFAULT_PROJECTS_DIR} here; set AXF_DATA_DIR to use another folder).`);
    process.exit(cmd === 'status' ? 0 : 1);
  }
  console.log(`Shared data folder: ${root}`);
  for (const rel of LIVE_DATA) {
    const repo = join(REPO_ROOT, rel), hub = join(root, rel);
    if (cmd === 'push') console.log(`${copy(repo, hub, force).padEnd(8)} ${rel}`);
    else if (cmd === 'pull') console.log(`${copy(hub, repo, true).padEnd(8)} ${rel}`);
    else console.log(`${existsSync(hub) ? 'hub     ' : 'seed    '} ${rel}`);
  }
}

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
 * Build profiles (build-profiles@1): the work data (pending, plan + media, queue, catalog status, tracker) belongs to
 * the active build profile; see the section below and framework/cli/profiles.mjs.
 *
 *   node framework/cli/persist.mjs            where each shared file is read from
 *   node framework/cli/persist.mjs push       copy repo → hub for files the hub doesn't have yet (--force: overwrite)
 *   node framework/cli/persist.mjs pull       copy hub → repo, to commit a snapshot
 */
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
export const LIVE_DATA = Array.isArray(MANIFEST.data?.shared) && MANIFEST.data.shared.length ? MANIFEST.data.shared.filter((p) => typeof p === 'string' && p && !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..')) : FALLBACK_DATA;

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
 * Absolute path to read/write one shared file at its plain location, ignoring build profiles (the profile registry
 * itself and data no profile owns). On the hub, a missing file is seeded from the repo copy.
 */
export function baseDataPath(rel) {
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

// ------------------------------------------------------------------ build profiles (build-profiles@1)
/*
 * A build profile is one complete set of work data: pending builds, plan + media, build queue, catalog status,
 * tracker, and the Build orchestrator's tracker. Brett picks one (console → Build profiles, or
 * `node framework/cli/profiles.mjs select <id>`); every CLI, the console server and the plugins then read and write
 * that profile's copy. The base profile ("main-framework") keeps the original paths, so nothing moved when profiles
 * arrived; every other profile lives under framework/plan/profiles/<id>/<same path>.
 *
 * Registry: framework/plan/profiles.json (shared data, on the hub), never profiled itself. Per-session override:
 * AXF_BUILD_PROFILE=<id> (a session working on one profile while the console shows another).
 */
export const PROFILES_REL = 'framework/plan/profiles.json';
export const PROFILES_DIR_REL = 'framework/plan/profiles/';
export const BASE_PROFILE = 'main-framework';
/** Shared data a profile owns (paths relative to the repo root; folders end with '/'). Open list: add here. */
export const PROFILED = [
  'framework/plan/pending.json',
  'framework/plan/plan.json',
  'framework/plan/build-queue.json',
  'framework/plan/media/',
  'framework/catalog/status.json',
  'tracker.json',
];
/** The orchestrator tracker is a repo file (synced by claude-sync, committed), profiled the same way. */
export const ORCHESTRATOR_REL = '_claude/builds/orchestrator.json';
export const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function readProfiles() {
  const f = baseDataPath(PROFILES_REL);
  let reg = null;
  try { reg = JSON.parse(readFileSync(f, 'utf8')); } catch { /* missing or damaged → defaults */ }
  const list = Array.isArray(reg?.profiles) ? reg.profiles.filter((p) => p && PROFILE_ID.test(p.id)) : [];
  if (!list.some((p) => p.id === BASE_PROFILE)) list.unshift({ id: BASE_PROFILE, name: 'Main framework', base: true });
  for (const p of list) p.base = p.id === BASE_PROFILE;
  const active = list.some((p) => p.id === reg?.active) ? reg.active : BASE_PROFILE;
  return { $axf: 'build-profiles@1', updatedAt: reg?.updatedAt ?? '', active, profiles: list };
}

/** The profile in force: AXF_BUILD_PROFILE (when it names a known profile), else the saved pick. */
export function activeProfile() {
  const reg = readProfiles();
  const env = process.env.AXF_BUILD_PROFILE;
  const id = env && reg.profiles.some((p) => p.id === env) ? env : reg.active;
  return reg.profiles.find((p) => p.id === id);
}

/** Which PROFILED entry `rel` belongs to (exact file or inside a profiled folder), or null. */
export function profiledEntry(rel) {
  return PROFILED.find((p) => (p.endsWith('/') ? rel === p || rel.startsWith(p) : rel === p)) ?? null;
}

/** Path of `rel` inside profile `id` (relative to the data root / repo). The base profile = `rel` itself. */
export function profileRel(id, rel) {
  return id === BASE_PROFILE ? rel : `${PROFILES_DIR_REL}${id}/${rel}`;
}

/** Empty starting content for a profiled file (null = nothing to write; folders are just created). */
export function emptyProfileFile(rel, now = new Date().toISOString()) {
  switch (rel) {
    case 'framework/plan/pending.json': return { $axf: 'pending@1', updatedAt: now, artifact: '', items: [] };
    case 'framework/plan/plan.json': return { $axf: 'plan@1', generatedAt: now, statuses: ['built', 'partial', 'in-progress', 'placeholder', 'planned', 'blocked', 'dropped'], features: [] };
    case 'framework/plan/build-queue.json': return { $axf: 'build-queue@1', order: [], steps: {}, dirty: false, updatedAt: now, history: [] };
    case 'framework/catalog/status.json': return {};
    case 'tracker.json': return { $axf: 'tracker@1', frameworkVersion: '', generatedAt: now, summary: {}, items: [] };
    default: return null;
  }
}

/**
 * Absolute path to read/write one live data file (`rel` relative to the repo root), in the active build profile.
 * Files a profile owns resolve inside that profile; a missing one is seeded from the profile's repo snapshot, else
 * started empty (never from another profile). Everything else: baseDataPath.
 */
export function dataPath(rel) {
  const entry = profiledEntry(rel);
  if (!entry) return baseDataPath(rel);
  const prof = activeProfile();
  if (prof.base) return baseDataPath(rel);
  const prel = profileRel(prof.id, rel);
  const root = persistRoot();
  const p = join(root ?? REPO_ROOT, prel);
  if (!existsSync(p)) {
    const snapshot = join(REPO_ROOT, prel);
    mkdirSync(rel.endsWith('/') ? p : dirname(p), { recursive: true });
    if (root && existsSync(snapshot)) cpSync(snapshot, p, { recursive: true });
    else if (!rel.endsWith('/')) { const empty = emptyProfileFile(rel); if (empty) writeFileSync(p, JSON.stringify(empty, null, 1) + '\n'); }
  }
  return p;
}

/** The orchestrator tracker of the active profile (a repo file). */
export function orchestratorPath(id = activeProfile().id) {
  return join(REPO_ROOT, id === BASE_PROFILE ? ORCHESTRATOR_REL : `_claude/builds/profiles/${id}/orchestrator.json`);
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

/**
 * merge-watch-files — where merge-watch@1 state lives: ONE path resolver, so the watch moves with the orchestrator.
 *
 *   <data root>/_claude/builds/merge-watch/state.json       the one state file (merge-watch@1)
 *
 * The data root, first match wins (every other merge-watch reader and writer goes through mergeWatchDir, nothing else
 * builds this path):
 *   AXF_MERGE_WATCH_DIR          exactly that folder (tests, another host)
 *   AXF_BUILDS_STORE=<file>      a scratch builds store: <file minus .json>.merge-watch/ next to it (tests)
 *   AXF_DATA_DIR                 <that folder> ('off' / '' = the repo); this is the axf-data root the orchestrator
 *                                will read when it moves into axf-molly: set it there and nothing else changes
 *   hub                          /projects/<project>/_data (persist.mjs persistRoot: the axhub-projects volume on the VPS today)
 *   repo                         the checkout itself (laptops, CI); the folder is git-ignored, the state is runtime data
 *
 * Light on purpose: no builds store import. Reads normalise (merge-watch@1 in shape or null); writes are atomic.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normState, STATE_REL } from '../core/merge-watch.mjs';
import { persistRoot } from './persist.mjs';

export const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const MERGE_WATCH_REL = dirname(STATE_REL);

/** The folder holding merge-watch@1 state (see the header for the chain). */
export function mergeWatchDir(env = process.env) {
  if (env.AXF_MERGE_WATCH_DIR) return env.AXF_MERGE_WATCH_DIR;
  if (env.AXF_BUILDS_STORE) return `${env.AXF_BUILDS_STORE.replace(/\.json$/, '')}.merge-watch`;
  if (env.AXF_DATA_DIR !== undefined) return env.AXF_DATA_DIR && env.AXF_DATA_DIR !== 'off' ? join(env.AXF_DATA_DIR, MERGE_WATCH_REL) : join(REPO_ROOT, MERGE_WATCH_REL);
  const hub = env === process.env ? persistRoot() : null;
  return join(hub || REPO_ROOT, MERGE_WATCH_REL);
}
export const stateFile = (env = process.env) => join(mergeWatchDir(env), 'state.json');
/** Where the state is read from, as words for `status` lines and the doc. */
export function whereIs(env = process.env) {
  const f = stateFile(env);
  const via = env.AXF_MERGE_WATCH_DIR ? 'AXF_MERGE_WATCH_DIR' : env.AXF_BUILDS_STORE ? 'AXF_BUILDS_STORE' : env.AXF_DATA_DIR !== undefined ? (env.AXF_DATA_DIR && env.AXF_DATA_DIR !== 'off' ? 'AXF_DATA_DIR' : 'repo') : f.startsWith(REPO_ROOT) ? 'repo' : 'hub';
  return { file: f, via, exists: existsSync(f) };
}

/** The stored state (normalised), or null when there is none yet. */
export function readState(env = process.env) {
  try { return normState(JSON.parse(readFileSync(stateFile(env), 'utf8'))); } catch { return null; }
}
/** Write the state (atomic). Returns its path. */
export function writeState(state, env = process.env) {
  const s = normState(state); if (!s) throw new Error('not a merge-watch@1 state');
  const f = stateFile(env); mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(s, null, 1)}\n`); renameSync(tmp, f);
  return f;
}

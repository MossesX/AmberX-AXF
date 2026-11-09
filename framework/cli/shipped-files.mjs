/**
 * shipped-files — the shipped-manifest@1 sidecar: one file per landed build, next to the builds store.
 *
 *   _claude/builds/shipped/<build id>.json      the latest manifest of that build (committed; git keeps earlier revs)
 *
 * Light on purpose (no builds store import): the orchestrator writes these on the host, the Shipped features ledger
 * reads them in the console. A scratch store (AXF_BUILDS_STORE=<file>) keeps them in <file minus .json>.shipped/,
 * a scratch data folder (AXF_DATA_DIR) under it; AXF_SHIPPED_DIR points anywhere (tests).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normManifest } from '../core/shipped-manifest.mjs';

export const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const SHIPPED_REL = '_claude/builds/shipped';
export function shippedDir(env = process.env) {
  if (env.AXF_SHIPPED_DIR) return env.AXF_SHIPPED_DIR;
  if (env.AXF_BUILDS_STORE) return `${env.AXF_BUILDS_STORE.replace(/\.json$/, '')}.shipped`;
  if (env.AXF_DATA_DIR && env.AXF_DATA_DIR !== 'off') return join(env.AXF_DATA_DIR, SHIPPED_REL);
  return join(REPO_ROOT, SHIPPED_REL);
}
const safe = (id) => String(id || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
export const manifestFile = (buildId, env = process.env) => join(shippedDir(env), `${safe(buildId)}.json`);

/** The stored manifest of a build (normalised), or null. */
export function readManifest(buildId, env = process.env) {
  const id = safe(buildId); if (!id) return null;
  try { return normManifest(JSON.parse(readFileSync(manifestFile(id, env), 'utf8'))); } catch { return null; }
}
/** Write a manifest (atomic). Returns its path. */
export function writeManifest(manifest, env = process.env) {
  const m = normManifest(manifest); if (!m) throw new Error('not a shipped-manifest@1 (no build id)');
  const f = manifestFile(m.build.id, env); mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(m, null, 1)}\n`); renameSync(tmp, f);
  return f;
}
/** Every stored manifest (normalised), newest landing first. */
export function listManifests(env = process.env) {
  const d = shippedDir(env); if (!existsSync(d)) return [];
  const out = [];
  for (const f of readdirSync(d).filter((x) => x.endsWith('.json')).sort()) { try { const m = normManifest(JSON.parse(readFileSync(join(d, f), 'utf8'))); if (m) out.push(m); } catch { /* a torn file is skipped */ } }
  return out.sort((a, b) => (b.landedAt || b.shippedAt).localeCompare(a.landedAt || a.shippedAt) || a.build.id.localeCompare(b.build.id));
}

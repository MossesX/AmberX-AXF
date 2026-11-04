#!/usr/bin/env node
/**
 * shared-assets — every app ships every shareable asset (Nov 1 2026, Brett: "They all gotta ship all assets that can be
 * shared"), so the one look on axHub never names an id an app lacks.
 *
 * The shared set is generated, never hand-copied:
 *   roots    every framework/assets file of a shared type (asset-types.json: a type is shared unless it says
 *            `"shared": false`) + the extra roots in framework/schemas/shared-assets.json (brand-library entries apps use)
 *   closure  every asset those need (app-assets.mjs: design packages → themes, branding → marks, toolbars → widgets…),
 *            from framework/assets, then framework/brand-library
 * It is baked into each listed app at src/axf/assets/<type>/<id>.json (with the rest of the baked framework, recorded in
 * axf.lock.json). An app's own src/assets keeps only what is truly its own (its menus, toolbar, help, access policy:
 * ids no other app has); src/assets-overrides holds the few shared ids an app tunes for itself (same id, so the hub's
 * pick still resolves everywhere). Apps load src/axf/assets, then src/assets, then src/assets-overrides.
 *
 *   node framework/cli/shared-assets.mjs list [--json]             the shared set (type/id)
 *   node framework/cli/shared-assets.mjs bake <app dir>|--all      write src/axf/assets in the app(s)
 *   node framework/cli/shared-assets.mjs check [<app dir>|--all]   CI: baked set current, no own copy of a shared id,
 *                                                                  every shared id present, main.tsx loads the baked set
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closure } from './app-assets.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CONFIG = join(ROOT, 'framework/schemas/shared-assets.json');
const BAKED_ASSETS = 'src/axf/assets';
const posix = (p) => p.split(sep).join('/');
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; }) : []);
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

export function config(root = ROOT) {
  const c = readJson(join(root, 'framework/schemas/shared-assets.json'));
  return { apps: c.apps ?? [], roots: c.roots ?? [] };
}

/** Asset types whose assets every app ships (asset-types.json `shared`, default true). */
export function sharedTypes(root = ROOT) {
  const spec = readJson(join(root, 'framework/schemas/asset-types.json'));
  return Object.entries(spec.types).filter(([, t]) => t.shared !== false).map(([id]) => id);
}

/** The shared set: ref (`type/id`) → source file. Throws when a root or dependency exists nowhere. */
export function sharedSet(root = ROOT) {
  const types = new Set(sharedTypes(root));
  const refs = [];
  const fw = join(root, 'framework/assets');
  for (const t of readdirSync(fw)) {
    if (!types.has(t) || !statSync(join(fw, t)).isDirectory()) continue;
    for (const n of readdirSync(join(fw, t))) if (n.endsWith('.json')) refs.push(`${t}/${n.slice(0, -5)}`);
  }
  refs.push(...config(root).roots);
  const { assets, missing } = closure(refs);
  // A shared asset may name an app's own chrome (AmberX's day/night packages pick AmberX's own toolbar and navigation):
  // apps that don't have it skip that one slot, as for any package. It must exist in some app, though.
  const own = new Set(config(root).apps.flatMap((a) => idsIn(join(root, a, 'src/assets')).map((x) => x.ref)));
  const nowhere = missing.filter((r) => !own.has(r));
  if (nowhere.length) throw new Error(`shared assets name assets that exist nowhere: ${nowhere.join(', ')}`);
  const out = new Map();
  for (const a of assets.sort((x, y) => (x.ref < y.ref ? -1 : 1))) if (types.has(a.ref.split('/')[0])) out.set(a.ref, a.file);
  return out;
}

/** rel path under src/axf → hash, for the shared set as it should be baked. */
export function sharedTree(root = ROOT) {
  const out = {};
  for (const [ref, file] of sharedSet(root)) out[`assets/${ref}.json`] = sha(readFileSync(file));
  return out;
}

/** Write the shared set into one app (src/axf/assets, replaced whole). Returns how many files. */
export function bake(dir, root = ROOT) {
  const appDir = resolve(root, dir);
  const target = join(appDir, BAKED_ASSETS);
  rmSync(target, { recursive: true, force: true });
  let n = 0;
  for (const [ref, file] of sharedSet(root)) {
    const to = join(target, `${ref}.json`);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, readFileSync(file));
    n++;
  }
  return n;
}

function idsIn(d) {
  return walk(d).filter((f) => f.endsWith('.json')).map((f) => {
    try { const a = readJson(f); return a && a.$axf === 'asset@1' ? { ref: `${a.type}/${a.id}`, file: f } : null; } catch { return null; }
  }).filter(Boolean);
}

/**
 * Every asset an app registers, the way its main.tsx loads them: the baked shared set, then its own, then its
 * overrides (a later folder's copy of the same type/id wins). `type/id` → { file, asset }. For checks and tools that
 * read an app's assets from disk.
 */
export function appAssetFiles(dir, root = ROOT) {
  const appDir = resolve(root, dir);
  const out = new Map();
  for (const d of [BAKED_ASSETS, 'src/assets', 'src/assets-overrides']) {
    for (const f of walk(join(appDir, d)).filter((x) => x.endsWith('.json')).sort()) {
      try { const a = readJson(f); if (a && a.$axf === 'asset@1') out.set(`${a.type}/${a.id}`, { file: f, asset: a }); } catch { /* not an asset */ }
    }
  }
  return out;
}

/** The assets of one type an app registers (see appAssetFiles), in id order. */
export function appAssetsOfType(dir, type, root = ROOT) {
  return [...appAssetFiles(dir, root).entries()].filter(([ref]) => ref.split('/')[0] === type).sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v.asset);
}

/** Problems with one app (empty = fine). */
export function check(dir, root = ROOT) {
  const appDir = resolve(root, dir);
  const name = posix(relative(root, appDir));
  const problems = [];
  const want = sharedTree(root);
  const have = {};
  for (const f of walk(join(appDir, BAKED_ASSETS))) have[posix(relative(join(appDir, 'src/axf'), f))] = sha(readFileSync(f));
  const missing = Object.keys(want).filter((k) => !(k in have));
  const changed = Object.keys(want).filter((k) => k in have && have[k] !== want[k]);
  const extra = Object.keys(have).filter((k) => !(k in want));
  if (missing.length) problems.push(`${name}: ${missing.length} shared assets not baked (${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ', …' : ''}): run node framework/cli/shared-assets.mjs bake ${name}`);
  if (changed.length) problems.push(`${name}: ${changed.length} baked shared assets differ from the framework (${changed.slice(0, 4).join(', ')}): re-bake; change the framework copy, never the baked one`);
  if (extra.length) problems.push(`${name}: ${extra.length} baked files are not in the shared set (${extra.slice(0, 4).join(', ')}): re-bake`);
  const shared = new Set(sharedSet(root).keys());
  for (const { ref, file } of idsIn(join(appDir, 'src/assets'))) {
    if (shared.has(ref)) problems.push(`${name}: ${posix(relative(root, file))} is its own copy of shared asset ${ref}: delete it (the baked one is used), or move it to src/assets-overrides if the app really tunes it`);
  }
  for (const { ref, file } of idsIn(join(appDir, 'src/assets-overrides'))) {
    if (!shared.has(ref)) problems.push(`${name}: ${posix(relative(root, file))} overrides ${ref}, which is not a shared asset: it belongs in src/assets`);
  }
  const main = join(appDir, 'src/main.tsx');
  if (existsSync(main)) {
    const src = readFileSync(main, 'utf8');
    if (!src.includes("'./axf/assets/**/*.json'")) problems.push(`${name}: src/main.tsx doesn't load the baked shared assets (import.meta.glob('./axf/assets/**/*.json'))`);
  }
  return problems;
}

function main(argv) {
  const [cmd = 'check', ...rest] = argv;
  const json = rest.includes('--json');
  // app dirs on the command line are relative to where it runs (CI bakes with `bake .` inside the app); listed ones to the repo
  const named = rest.filter((a) => !a.startsWith('--')).map((a) => resolve(process.cwd(), a));
  const targets = (rest.includes('--all') || !named.length) ? config().apps.map((a) => resolve(ROOT, a)) : named;
  if (cmd === 'list') {
    const s = [...sharedSet().keys()];
    if (json) console.log(JSON.stringify(s, null, 2)); else console.log(`${s.length} shared assets\n${s.join('\n')}`);
    return 0;
  }
  if (cmd === 'bake') {
    for (const t of targets) console.log(`baked ${bake(t)} shared assets into ${posix(relative(ROOT, t)) || '.'}/${BAKED_ASSETS}`);
    return 0;
  }
  if (cmd === 'check') {
    const problems = targets.flatMap((t) => check(t));
    if (json) console.log(JSON.stringify({ ok: !problems.length, problems }, null, 2));
    else if (problems.length) console.error(problems.map((p) => `✗ ${p}`).join('\n'));
    else console.log(`✓ shared assets: ${targets.length} apps ship all ${sharedSet().size} shared assets, no own copies`);
    return problems.length ? 1 : 0;
  }
  console.error('usage: shared-assets.mjs list|bake|check [<app dir>|--all] [--json]');
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));

#!/usr/bin/env node
/**
 * check-screen-layouts — three layouts per plugin screen (screen-layouts@1; Brett, Nov 4 2026: "From now on, all plugin
 * screens get three layouts, and come with a toolbar to select which one, with the toolbar hidden by default."
 * "Not old ones, only new ones.").
 *
 * For every plugin (apps/<app>/plugins/<folder>, apps/amberx-droid/src/plugins/<folder>; "_" folders are the templates
 * and are checked too), every view its web/index.tsx declares (`views: { … }`) must have an entry in plugin.json
 * `screens` with at least 3 layouts and a default that is one of them — unless `<folder>/<view>` is in the grandfather
 * baseline (framework/spec/screen-layouts-baseline.json: the screens that existed when the rule landed). A declared
 * screen is always checked for shape, grandfathered or not. The baseline can only shrink: a screen that gains its
 * layouts comes off it (`--update-baseline` rewrites it with what still lacks layouts; it never adds a new screen).
 *
 *   node framework/cli/check-screen-layouts.mjs [--json] [--update-baseline] [plugin dirs…]
 *
 * Exit 1 on any finding (file + what to add).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_LAYOUTS, checkScreens, grandfathered, viewIdsInSource } from '../core/engines/screen-layouts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const BASELINE = 'framework/spec/screen-layouts-baseline.json';
const args = process.argv.slice(2);
const json = args.includes('--json');
const update = args.includes('--update-baseline');
const dirs = args.filter((a) => !a.startsWith('--'));

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

/** A sibling module a web/index.tsx imports (`./keys` → keys.ts / keys.tsx / keys.mjs / keys/index.ts), or null. */
export function readSibling(webDir, rel) {
  const base = resolve(webDir, rel);
  for (const f of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.mjs`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    try { if (statSync(f).isFile()) return readFileSync(f, 'utf8'); } catch { /* next */ }
  }
  return null;
}

/** Every plugin folder with a plugin.json: console-style (apps/<app>/plugins/*) and AmberX (apps/amberx-droid/src/plugins/*). */
export function pluginFolders(root = ROOT) {
  const out = [];
  const apps = join(root, 'apps');
  const roots = [];
  for (const app of existsSync(apps) ? readdirSync(apps) : []) {
    roots.push(join(apps, app, 'plugins'));
    roots.push(join(apps, app, 'src', 'plugins'));
  }
  for (const r of roots) {
    if (!existsSync(r)) continue;
    for (const n of readdirSync(r)) {
      const d = join(r, n);
      if (!n.startsWith('.') && statSync(d).isDirectory() && existsSync(join(d, 'plugin.json'))) out.push(d);
    }
  }
  return out;
}

/** One plugin's screens: its manifest, the views in its web code, and the problems. */
export function checkPluginFolder(dir, baseline, root = ROOT) {
  const rel = relative(root, dir);
  const folder = dir.split(/[\\/]/).pop();
  let manifest;
  try { manifest = readJson(join(dir, 'plugin.json')); } catch (e) { return { folder: rel, views: [], problems: [`${rel}/plugin.json: not JSON (${e.message})`], lacking: [] }; }
  const index = join(dir, 'web', 'index.tsx');
  const views = existsSync(index) ? viewIdsInSource(readFileSync(index, 'utf8'), (rel2) => readSibling(join(dir, 'web'), rel2)) : [];
  const gf = [...views, ...Object.keys(manifest.screens ?? {})].filter((v) => grandfathered(baseline, folder, v) || grandfathered(baseline, rel, v));
  const problems = checkScreens(manifest, { enforceCount: true, views, grandfathered: [...new Set(gf)], where: `${rel}/plugin.json` });
  // what still lacks layouts (for --update-baseline): views without a 3+ declaration
  const lacking = views.filter((v) => !(Array.isArray(manifest.screens?.[v]?.layouts) && manifest.screens[v].layouts.length >= MIN_LAYOUTS));
  return { folder: rel, views, problems, lacking };
}

export function run({ root = ROOT, only = [], updateBaseline = false } = {}) {
  const baseFile = join(root, BASELINE);
  const baseline = existsSync(baseFile) ? readJson(baseFile) : { $axf: 'screen-layouts-baseline@1', screens: [] };
  const folders = only.length ? only.map((d) => resolve(root, d)) : pluginFolders(root);
  const results = folders.map((d) => checkPluginFolder(d, baseline, root));
  const problems = results.flatMap((r) => r.problems);
  let baselineOut = null;
  if (updateBaseline) {
    // only shrink: keep a baseline entry when its screen still lacks layouts; never add one
    const still = new Set(results.flatMap((r) => r.lacking.map((v) => `${r.folder.split(/[\\/]/).pop()}/${v}`)));
    const kept = (baseline.screens ?? []).filter((s) => still.has(s) || s.endsWith('/*'));
    baselineOut = { ...baseline, screens: kept.sort() };
    writeFileSync(baseFile, JSON.stringify(baselineOut, null, 2) + '\n');
  }
  return { plugins: results.length, screens: results.reduce((n, r) => n + r.views.length, 0), grandfathered: (baseline.screens ?? []).length, problems, baseline: baselineOut };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = run({ only: dirs, updateBaseline: update });
  if (json) console.log(JSON.stringify(r, null, 2));
  else if (r.problems.length) { for (const p of r.problems) console.log(`✗ ${p}`); console.log(`\n✗ ${r.problems.length} screen layout problem(s) in ${r.plugins} plugin(s): every new plugin screen declares ${MIN_LAYOUTS} layouts in plugin.json "screens" (framework/spec/SCREEN-LAYOUTS.md)`); }
  else console.log(`✓ screen layouts — ${r.screens} plugin screen(s) in ${r.plugins} plugin(s): new screens declare ${MIN_LAYOUTS}+ layouts, ${r.grandfathered} grandfathered${r.baseline ? ' (baseline rewritten)' : ''}`);
  process.exit(r.problems.length ? 1 : 0);
}

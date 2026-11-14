#!/usr/bin/env node
/**
 * skin-upgrade@1 (core/engines/skin-upgrade.mjs): every shipped skin reaches every asset type the upgrader carries.
 * First type: picker@1 (spec/PICKER.md; Brett: "skins have to touch them").
 *
 *   node framework/cli/skin-upgrade.mjs [paths…]        add the missing defaults (assets.picker, parts.picker) to every
 *                                                        skin under framework/assets/skin, apps/*\/src/assets/skin and
 *                                                        apps/*\/src/assets-overrides/skin (or the files / folders given)
 *   node framework/cli/skin-upgrade.mjs --check [paths…] CI: fail on a skin that still lacks them, change nothing
 *   add --json for machine output
 *
 * After an upgrade of a framework skin run `node framework/cli/shared-assets.mjs bake --all` so the baked copies follow.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKIN_UPGRADE_CONTRACT, skinUpgradeGaps, upgradeSkin } from '../core/engines/skin-upgrade.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const args = process.argv.slice(2);
const check = args.includes('--check');
const json = args.includes('--json');
const given = args.filter((a) => !a.startsWith('--'));

/** The picker starters that ship, and each dialog starter's variant (what the rules pick by). */
function context() {
  const pickerDir = join(ROOT, 'framework/assets/picker');
  const starters = existsSync(pickerDir) ? readdirSync(pickerDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : [];
  const dialogVariant = (id) => { const f = join(ROOT, 'framework/assets/dialog', `${id}.json`); return existsSync(f) ? String(readJson(f)?.data?.variant ?? '') : ''; };
  return { starters, dialogVariant };
}

/** Every skin file: the framework's, each app's own and each app's overrides (or what was given). */
export function skinFiles(paths = given) {
  const out = [];
  const addDir = (d) => { if (existsSync(d) && statSync(d).isDirectory()) for (const f of readdirSync(d)) if (f.endsWith('.json')) out.push(join(d, f)); };
  if (paths.length) {
    for (const p of paths) { const a = resolve(p); if (existsSync(a) && statSync(a).isDirectory()) addDir(a); else if (existsSync(a)) out.push(a); }
    return out;
  }
  addDir(join(ROOT, 'framework/assets/skin'));
  const apps = join(ROOT, 'apps');
  if (existsSync(apps)) for (const app of readdirSync(apps)) { addDir(join(apps, app, 'src/assets/skin')); addDir(join(apps, app, 'src/assets-overrides/skin')); }
  return out;
}

export function run({ write = !check, paths = given } = {}) {
  const ctx = context();
  const rows = [];
  for (const file of skinFiles(paths)) {
    const asset = readJson(file);
    if (asset?.type !== 'skin' || typeof asset.data !== 'object') continue;
    const { data, changed } = upgradeSkin(asset.data, { id: asset.id, starters: ctx.starters, dialogVariant: ctx.dialogVariant(asset.data?.assets?.dialog) });
    const gaps = skinUpgradeGaps(write ? data : asset.data);
    if (write && changed.length) writeFileSync(file, JSON.stringify({ ...asset, data }, null, 2) + '\n');
    rows.push({ file: relative(ROOT, file), id: asset.id, changed: write ? changed : [], wouldChange: write ? [] : changed, gaps, picker: data.assets?.picker ?? '' });
  }
  return rows;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = run();
  const gaps = rows.filter((r) => r.gaps.length);
  if (json) console.log(JSON.stringify({ contract: SKIN_UPGRADE_CONTRACT, ok: gaps.length === 0, rows }));
  else {
    for (const r of rows) console.log(`  ${r.id.padEnd(16)} picker ${String(r.picker).padEnd(14)} ${r.changed.length ? `+ ${r.changed.join(', ')}` : r.wouldChange.length ? `needs ${r.wouldChange.join(', ')}` : 'ok'}  (${r.file})`);
    console.log(`skin-upgrade: ${rows.length} skin(s) · ${rows.filter((r) => r.changed.length).length} upgraded · ${gaps.length} with gaps`);
    for (const r of gaps) console.error(`  ✗ ${r.id}: missing ${r.gaps.join(', ')} (${r.file})`);
    if (rows.some((r) => r.changed.length && r.file.startsWith('framework/assets/skin/'))) console.log('  framework skins changed: run `node framework/cli/shared-assets.mjs bake --all`');
  }
  if (gaps.length) process.exit(1);
}

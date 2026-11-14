#!/usr/bin/env node
/**
 * Skins carry look, layout and behaviour (build skins-are-a-complete-rework-look-layout-behavior). For every shipped
 * skin (framework/assets/skin) this check fails if
 *   - a section (colorTheme, styleTheme, layoutTheme, behaviorTheme) or an `assets` slot names an asset that does not ship,
 *   - a skin tagged `professional` leaves any of the four sections unset (those are the reference skins: look, layout
 *     and behaviour all swap with the skin).
 *
 *   node framework/spec/check-skin-sections.mjs
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '../assets');
const SECTIONS = { colorTheme: 'color-theme', styleTheme: 'style-theme', layoutTheme: 'layout', behaviorTheme: 'behavior-theme' };
const ships = (type, id) => existsSync(join(ASSETS, type, `${id}.json`));
const problems = [];
let professional = 0;
const files = readdirSync(join(ASSETS, 'skin')).filter((f) => f.endsWith('.json'));
for (const f of files) {
  const a = JSON.parse(readFileSync(join(ASSETS, 'skin', f), 'utf8'));
  const d = a.data ?? {};
  const pro = (a.tags ?? []).includes('professional');
  if (pro) professional++;
  for (const [field, type] of Object.entries(SECTIONS)) {
    if (d[field]) { if (!ships(type, d[field])) problems.push(`${a.id}: ${field} "${d[field]}" is not a shipped ${type}`); }
    else if (pro) problems.push(`${a.id}: professional skin without ${field}`);
  }
  for (const [type, id] of Object.entries(d.assets ?? {})) if (!ships(type, id)) problems.push(`${a.id}: assets.${type} "${id}" does not ship`);
  if (d.iconPack && !ships('icon-pack', d.iconPack)) problems.push(`${a.id}: iconPack "${d.iconPack}" does not ship`);
}
if (professional < 5) problems.push(`only ${professional} professional skins ship (5 expected)`);
if (problems.length) { console.error(`skin sections: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log(`skin sections: ok (${files.length} skins, ${professional} professional with look, layout and behaviour)`);

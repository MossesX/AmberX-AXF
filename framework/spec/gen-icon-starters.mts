/**
 * Writes the starter icon assets (spec/ICON-MAP.md, build icon-packs-with-drag-drop-pack-designer):
 *   framework/assets/icon-map/default.json      every spot of the inventory (spec/icon-inventory.json, cli/icon-map.mjs scan)
 *   framework/assets/icon-pack/default.json     the framework glyph set as a pack (core/engines/icon-glyphs.mjs)
 *   framework/assets/icon-pack/outline.json     a lighter outline variant, extends default
 *   framework/assets/icon-pack/filled.json      a filled variant (closed shapes filled, open lines stroked), extends default
 *   framework/assets/icon-pack/generated-ember.json  a generated duotone pack (icon-gen@1, seed "ember") for every glyph name
 *                                                     the inventory asks for plus its badge and app-icon spots, extends default
 * Deterministic: running it twice changes nothing.
 *   npx -y tsx framework/spec/gen-icon-starters.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRAMEWORK_GLYPHS, FRAMEWORK_GLYPH_GRID, FRAMEWORK_GLYPH_STROKE } from '../core/engines/icon-glyphs.mjs';
import { generatePack } from '../core/engines/icon-gen';
import { validateAsset } from '../core/validate';

const root = new URL('..', import.meta.url).pathname;
const inv = JSON.parse(readFileSync(join(root, 'spec/icon-inventory.json'), 'utf8')) as { spots: { id: string; app: string; area: string; slot: string; kind: 'icon' | 'badge' | 'app-icon'; glyph: string; dynamic?: boolean; files: string[] }[] };
const envelope = (type: string, id: string, name: string, description: string, tags: string[], data: unknown) => ({ $axf: 'asset@1', type, id, name, version: '1.0.0', description, author: 'AmberX AXF', tags, data });
const write = (rel: string, asset: unknown) => {
  const v = validateAsset(asset);
  if (!v.ok) throw new Error(`${rel}: ${v.errors.join('; ')}`);
  mkdirSync(join(root, 'assets', rel.split('/')[0]), { recursive: true });
  writeFileSync(join(root, 'assets', rel), JSON.stringify(asset, null, 2) + '\n');
  console.log(`✓ assets/${rel}`);
};

/* ---- icon-map/default: every spot of the inventory ---- */
const spots: Record<string, unknown> = {};
for (const s of [...inv.spots].sort((a, b) => a.id.localeCompare(b.id))) {
  const entry: Record<string, unknown> = { kind: s.kind };
  if (s.glyph) entry.glyph = s.glyph; else entry.dynamic = true;
  entry.tags = [s.app, s.area.replace(/^(plugin|view|lib|pane|module|studio|windows)-/, ''), ...(s.kind !== 'icon' ? [s.kind] : [])].filter((t, i, a) => a.indexOf(t) === i).slice(0, 12);
  // source files stay in spec/icon-inventory.json (the designer reads them from there): the baked map stays small
  spots[s.id] = entry;
}
write('icon-map/default.json', envelope('icon-map', 'default', 'Default icon map', `Every icon, badge and app-icon spot found in the apps' source (${inv.spots.length} spots, framework/cli/icon-map.mjs scan). Components register their spots at run time too; this map is the designed list the coverage report and the designer tree start from.`, ['default', 'all'], { app: 'all', spots, generatedAt: '2026-11-16T00:00:00Z' }));

/* ---- icon-pack/default: the framework glyph set ---- */
const glyphs = Object.fromEntries(Object.entries(FRAMEWORK_GLYPHS).map(([k, d]) => [k, { d }]));
write('icon-pack/default.json', envelope('icon-pack', 'default', 'Framework default', 'The framework glyph set as a pack: every built-in icon on the 24 grid, 1.8 stroke, round caps. The floor every other pack extends; a name it lacks is a framework icon all the same.', ['default', 'framework', 'outline'], {
  style: 'outline', grid: FRAMEWORK_GLYPH_GRID, stroke: FRAMEWORK_GLYPH_STROKE, linecap: 'round', fallback: 'framework', glyphs,
  source: { kind: 'builtin' }, license: { id: 'MIT', holder: 'AmberX AXF' },
}));

/* ---- outline and filled: style variants over the same glyphs ---- */
write('icon-pack/outline.json', envelope('icon-pack', 'outline', 'Outline light', 'The framework glyphs with a lighter 1.5 stroke and round caps (extends default: every name comes from the default pack).', ['outline', 'light'], {
  style: 'outline', grid: FRAMEWORK_GLYPH_GRID, stroke: 1.5, linecap: 'round', fallback: 'framework', extends: 'default',
  glyphs: { x: { d: 'M17 7 7 17M7 7l10 10' }, check: { d: 'M19 7 9.5 16.5 5 12' }, plus: { d: 'M12 6v12M6 12h12' } },
  source: { kind: 'builtin' }, license: { id: 'MIT', holder: 'AmberX AXF' },
}));
write('icon-pack/filled.json', envelope('icon-pack', 'filled', 'Filled', 'The framework glyphs as a filled set: closed shapes are filled, open lines (checks, crosses, arrows) stay stroked at 2 (extends default).', ['filled', 'solid'], {
  style: 'filled', grid: FRAMEWORK_GLYPH_GRID, stroke: 2, linecap: 'round', fallback: 'framework', extends: 'default',
  glyphs: { star: { d: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z', fill: true }, bell: { d: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9zM13.7 21a2 2 0 0 1-3.4 0', fill: true }, home: { d: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', fill: true } },
  source: { kind: 'builtin' }, license: { id: 'MIT', holder: 'AmberX AXF' },
}));

/* ---- generated-ember: icon-gen@1 over every name the inventory asks for ---- */
const names = [...new Set(inv.spots.map((s) => s.glyph).filter(Boolean))].sort();
const special = inv.spots.filter((s) => s.kind !== 'icon' && s.glyph).map((s) => ({ id: s.id, kind: s.kind, glyph: s.glyph }));
const gen = generatePack('ember', names, { style: 'duotone', spots: special, extends: 'default', id: 'generated-ember', name: 'Generated Ember (duotone)' });
write('icon-pack/generated-ember.json', envelope('icon-pack', gen.id, gen.name, `A generated pack (icon-gen@1, seed "ember", duotone): one glyph for each of the ${names.length} names the inventory asks for, plus app-icon and badge spots; re-roll it from the designer with the same seed for the same glyphs. Extends default.`, ['generated', 'duotone', 'ember'], gen.data));

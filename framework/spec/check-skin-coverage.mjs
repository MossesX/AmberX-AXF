#!/usr/bin/env node
/**
 * skin-coverage@1: every asset type registered in schemas/asset-types.json says how a skin reaches it (Brett, Nov 7
 * 2026: "add a CI check that fails if a registered asset type has no skin coverage"; Nov 9 2026: every type carries an
 * explicit `skin` entry, so nothing merges without one). Plain node, no build step: the same engine the runtime, the
 * build engine and the skins CLI use (core/engines/skin-coverage.mjs) is run over the registry and the style targets
 * (schemas/customize.json), and the check fails on
 *   - a type with no `skin: { by: … }` entry on its registry entry,
 *   - an entry outside the kinds list, a `none` without a why, a `reference` without a via, `parts` / `ingredient` on
 *     anything but a slot,
 *   - an entry that says parts (by "parts", or "parts": true on a slot) with no style target to draw them under, and a
 *     style target the entry doesn't mention,
 *   - a widget or attachable type declared as one slot, a slot a skin never sets declared as a slot,
 *   - an entry naming a `via` that is neither `iconPack` nor a registered type (references) or not one of the skin's
 *     theme fields (ingredients), and a skin theme field no ingredient claims,
 *   - a style target naming a type that isn't registered (a stale target would hide a gap),
 * and prints the coverage table so a reviewer sees how each type is reached.
 *
 *   node framework/spec/check-skin-coverage.mjs [--json] [--quiet]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COVERAGE_KINDS, SKIN_THEME_FIELDS, coverageSummary, coverageTable, ingredientOfField, partsTypes, skinIngredients } from '../core/engines/skin-coverage.mjs';
import { SKIN_NEVER } from '../core/engines/skin-rules.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const json = process.argv.includes('--json');
const quiet = process.argv.includes('--quiet') || json;

const spec = readJson(join(ROOT, 'schemas/asset-types.json')).types;
const customize = readJson(join(ROOT, 'schemas/customize.json'));
const targets = customize.targets ?? {};

const rows = coverageTable(spec, targets, SKIN_NEVER);
const problems = [];
for (const r of rows) if (r.by === 'uncovered') problems.push(`${r.type}: ${r.why}`);
for (const [type, t] of Object.entries(spec)) {
  const via = t?.skin?.via;
  if (t?.skin?.by === 'reference' && via && via !== 'iconPack' && !spec[via]) problems.push(`${type}: skin.via "${via}" is neither iconPack nor a registered type`);
}
// a skin contains a colour theme section (and a style and a layout theme): each theme field belongs to one ingredient
for (const field of SKIN_THEME_FIELDS) if (!ingredientOfField(spec, field)) problems.push(`no asset type is the skin's ${field} (an ingredient with "via": "${field}")`);
for (const type of Object.keys(targets)) if (!spec[type]) problems.push(`customize target "${type}" is not a registered asset type`);
// every `text` selector names a class the framework renders (react + libs), so a type's text parts land somewhere
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(tsx|ts)$/.test(name)) out.push(readFileSync(p, 'utf8'));
  }
  return out;
}
const code = [...walk(join(ROOT, 'react')), ...walk(join(ROOT, 'libs'))].join('\n');
for (const [type, t] of Object.entries(targets)) {
  if (t.text === undefined) continue;
  if (typeof t.text !== 'string' || !t.text.trim()) { problems.push(`customize target "${type}": text must be a comma list of selectors`); continue; }
  for (const sel of t.text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const cls = (sel.match(/\.(fx-[a-z0-9_-]+)/) || [])[1];
    if (!cls || !new RegExp(`(["'\`\\s{])${cls}(["'\`\\s$}])`).test(code)) problems.push(`customize target "${type}": text selector ${sel} names a class nothing renders`);
  }
}
// the kinds list is the contract (docs, the UI's legend and the CLI print it)
if (JSON.stringify(COVERAGE_KINDS) !== JSON.stringify(['slot', 'parts', 'reference', 'bundle', 'none'])) problems.push('COVERAGE_KINDS changed: update spec/APPEARANCE-SOURCE.md and the Appearance panel legend');

const summary = coverageSummary(rows);
if (json) {
  console.log(JSON.stringify({ ok: problems.length === 0, summary, problems, rows, partsTypes: partsTypes(spec, targets), ingredients: skinIngredients(spec) }));
} else {
  if (!quiet) {
    const w = Math.max(...rows.map((r) => r.type.length));
    for (const r of rows) console.log(`  ${r.type.padEnd(w)}  ${r.by.padEnd(10)}${r.also.length ? `+${r.also.join('+')}` : '          '}  ${r.elements.length ? r.elements.join('/') : '-'}${r.ingredient ? '  ingredient' : ''}${r.via ? `  via ${r.via}` : ''}`);
  }
  console.log(`check-skin-coverage: ${summary.total} types · slot ${summary.slot} (${skinIngredients(spec).length} ingredients) · parts ${summary.parts} · reference ${summary.reference} · bundle ${summary.bundle} · none ${summary.none} · uncovered ${summary.uncovered}`);
  for (const p of problems) console.error(`  ✗ ${p}`);
}
if (problems.length) { console.error(`check-skin-coverage: ${problems.length} problem(s). Every type in schemas/asset-types.json needs a "skin": { "by": … } entry; a type styled with parts also needs a style target in schemas/customize.json.`); process.exit(1); }

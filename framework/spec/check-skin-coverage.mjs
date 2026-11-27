#!/usr/bin/env node
/**
 * skin-coverage@1: every asset type registered in schemas/asset-types.json has skin coverage (Brett, Nov 7 2026: "add
 * a CI check that fails if a registered asset type has no skin coverage"). Plain node, no build step: the same engine
 * the runtime, the build engine and the skins CLI use (core/engines/skin-coverage.mjs) is run over the registry and
 * the style targets (schemas/customize.json), and the check fails on
 *   - a widget or attachable type with no style target (a skin couldn't style its copies on banners and toolbars),
 *   - a type excluded from appearance slots with no `skin: { by: … }` declaration on its registry entry,
 *   - a declaration outside the kinds list, a `none` without a why, a `reference` without a via,
 *   - a declaration naming a `via` that is neither `iconPack` nor a registered type,
 *   - a style target naming a type that isn't registered (a stale target would hide a gap),
 *   - the scope chain not ending in the hub default skin (plugin → ui → app → global → default), or a chrome-settings@1
 *     kind (what a skin's `chrome` block names) that a skin can't pick as a slot,
 * and prints the coverage table so a reviewer sees how each type is reached.
 *
 *   node framework/spec/check-skin-coverage.mjs [--json] [--quiet]
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COVERAGE_KINDS, SKIN_SCOPE_DEFAULT, SKIN_SCOPE_KINDS, coverageSummary, coverageTable, declarationErrors, partsTypes, skinScopeChain } from '../core/engines/skin-coverage.mjs';
import { SKIN_NEVER, normalizeSkinChrome, skinChromeErrors } from '../core/engines/skin-rules.mjs';
import { CHROME_TYPES } from '../core/engines/chrome-settings-rules.mjs';

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
  for (const e of declarationErrors(type, t)) if (!problems.some((p) => p.startsWith(`${type}:`))) problems.push(e);
  const via = t?.skin?.via;
  if (t?.skin?.by === 'reference' && via && via !== 'iconPack' && !spec[via]) problems.push(`${type}: skin.via "${via}" is neither iconPack nor a registered type`);
}
for (const type of Object.keys(targets)) if (!spec[type]) problems.push(`customize target "${type}" is not a registered asset type`);
// the kinds list is the contract (docs, the UI's legend and the CLI print it)
if (JSON.stringify(COVERAGE_KINDS) !== JSON.stringify(['slot', 'parts', 'reference', 'bundle', 'none'])) problems.push('COVERAGE_KINDS changed: update spec/APPEARANCE-SOURCE.md and the Appearance panel legend');
// the scope chain is the contract too (build console-look-becomes-default-axhub-skin): the hub default skin is its root
if (JSON.stringify(SKIN_SCOPE_KINDS) !== JSON.stringify(['default', 'global', 'app', 'ui', 'plugin'])) problems.push('SKIN_SCOPE_KINDS changed: update spec/APPEARANCE-SOURCE.md (resolve order) and the Skins screen');
if (JSON.stringify(skinScopeChain({ app: 'x', ui: 'home', plugin: 'notes' })) !== JSON.stringify(['plugin:notes', 'ui:home', 'app', 'global', SKIN_SCOPE_DEFAULT])) problems.push('skinScopeChain must run plugin → ui → app → global → default');
// a skin's chrome block names chrome-settings@1 kinds: every one must be a registered type a skin reaches as a slot (never an unreachable type)
for (const kind of CHROME_TYPES) {
  const row = rows.find((r) => r.type === kind);
  if (!row) problems.push(`chrome kind "${kind}" (skin chrome block) is not a registered asset type`);
  else if (row.by !== 'slot') problems.push(`chrome kind "${kind}" (skin chrome block) is covered by ${row.by}, not as a slot: a skin could set its settings but not pick its asset`);
}
const chromeOk = Object.keys(normalizeSkinChrome({ toolbar: { interface: 'chrome-toolbar' }, nope: { interface: 'x' } }));
if (JSON.stringify(chromeOk) !== JSON.stringify(['toolbar'])) problems.push('normalizeSkinChrome must keep chrome-settings@1 kinds only');
if (!skinChromeErrors({ nope: {} }).length) problems.push('skinChromeErrors must refuse a kind outside chrome-settings@1');

const summary = coverageSummary(rows);
if (json) {
  console.log(JSON.stringify({ ok: problems.length === 0, summary, problems, rows, partsTypes: partsTypes(spec, targets) }));
} else {
  if (!quiet) {
    const w = Math.max(...rows.map((r) => r.type.length));
    for (const r of rows) console.log(`  ${r.type.padEnd(w)}  ${r.by.padEnd(10)}${r.also.length ? `+${r.also.join('+')}` : '          '}  ${r.elements.length ? r.elements.join('/') : '-'}${r.declared ? '  (declared)' : ''}${r.via ? `  via ${r.via}` : ''}`);
  }
  console.log(`check-skin-coverage: ${summary.total} types · slot ${summary.slot} · parts ${summary.parts} · reference ${summary.reference} · bundle ${summary.bundle} · none ${summary.none} · uncovered ${summary.uncovered}`);
  for (const p of problems) console.error(`  ✗ ${p}`);
}
if (problems.length) { console.error(`check-skin-coverage: ${problems.length} problem(s). Give the type a style target in schemas/customize.json (widgets) or a "skin": { "by": … } declaration on its asset-types.json entry.`); process.exit(1); }

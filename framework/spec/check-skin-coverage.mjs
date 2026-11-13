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
 *   - a bad behaviour axis declaration (skin@2, core/engines/skin-behaviour.mjs): a kind outside choice / switch /
 *     number, a choice without values or with a default outside them, a number without min < max, an `of` naming no type,
 *   - with --strict-skins (CI from build professional-skins s14): a shipped skin (framework/assets/skin, and any
 *     --skins <dir>) whose look leaves a slot / parts / reference type unreached or whose behaviour leaves an axis
 *     unset (Brett, Nov 13 2026: every professional skin covers every type). A skin tagged `partial` is only reported.
 *     Without the flag those gaps are printed as warnings,
 * and prints the coverage table (with each type's behaviour axes) so a reviewer sees how each type is reached.
 *
 *   node framework/spec/check-skin-coverage.mjs [--json] [--quiet] [--skins <dir>]… [--no-skins] [--strict-skins]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COVERAGE_KINDS, coverageSummary, coverageTable, declarationErrors, partsTypes, skinUncoveredBy } from '../core/engines/skin-coverage.mjs';
import { BEHAVIOUR_KINDS, behaviourDeclarationErrors, behaviourTable } from '../core/engines/skin-behaviour.mjs';
import { SKIN_NEVER } from '../core/engines/skin-rules.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const argv = process.argv.slice(2);
const json = argv.includes('--json');
const quiet = argv.includes('--quiet') || json;
const skinDirs = argv.includes('--no-skins') ? [] : [join(ROOT, 'assets/skin'), ...argv.flatMap((a, i) => (a === '--skins' && argv[i + 1] ? [resolve(argv[i + 1])] : []))];
const strictSkins = argv.includes('--strict-skins');
const warnings = [];

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
  problems.push(...behaviourDeclarationErrors(type, spec, targets));
}
for (const type of Object.keys(targets)) if (!spec[type]) problems.push(`customize target "${type}" is not a registered asset type`);
// the kinds lists are the contract (docs, the UI's legend and the CLI print them)
if (JSON.stringify(COVERAGE_KINDS) !== JSON.stringify(['slot', 'parts', 'reference', 'bundle', 'none'])) problems.push('COVERAGE_KINDS changed: update spec/APPEARANCE-SOURCE.md and the Appearance panel legend');
if (JSON.stringify(BEHAVIOUR_KINDS) !== JSON.stringify(['choice', 'switch', 'number'])) problems.push('BEHAVIOUR_KINDS changed: update spec/APPEARANCE-SOURCE.md and the skin schema');

// shipped skins: every one covers every type's look and behaviour (a skin tagged `partial` is only reported)
const skins = [];
for (const dir of skinDirs) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    let a; try { a = readJson(join(dir, f)); } catch { problems.push(`${f}: not JSON`); continue; }
    if (a?.type !== 'skin' || !a.data) continue;
    const uncovered = skinUncoveredBy(a.data, spec, targets, SKIN_NEVER);
    const partial = Array.isArray(a.tags) && a.tags.includes('partial');
    skins.push({ id: a.id, file: join(dir, f), partial, uncovered: uncovered.map((r) => ({ type: r.type, why: r.why })) });
    if (uncovered.length && !partial) (strictSkins ? problems : warnings).push(`skin ${a.id}: ${uncovered.length} type(s) uncovered — ${uncovered.slice(0, 6).map((r) => `${r.type} (${r.why})`).join('; ')}${uncovered.length > 6 ? '; …' : ''}`);
  }
}

const summary = coverageSummary(rows);
const behaviour = behaviourTable(spec, targets);
if (json) {
  console.log(JSON.stringify({ ok: problems.length === 0, summary, problems, warnings, rows, partsTypes: partsTypes(spec, targets), behaviour, skins }));
} else {
  if (!quiet) {
    const w = Math.max(...rows.map((r) => r.type.length));
    for (const r of rows) console.log(`  ${r.type.padEnd(w)}  ${r.by.padEnd(10)}${r.also.length ? `+${r.also.join('+')}` : '          '}  ${(r.elements.length ? r.elements.join('/') : '-').padEnd(20)}${r.behaviour.length ? `  behaviour: ${r.behaviour.join(', ')}` : ''}${r.declared ? '  (declared)' : ''}${r.via ? `  via ${r.via}` : ''}`);
    for (const s of skins) console.log(`  skin ${s.id.padEnd(w - 5)}  ${s.uncovered.length ? `${s.uncovered.length} uncovered${s.partial ? ' (partial)' : ''}` : 'covers every type'}`);
  }
  console.log(`check-skin-coverage: ${summary.total} types · slot ${summary.slot} · parts ${summary.parts} · reference ${summary.reference} · bundle ${summary.bundle} · none ${summary.none} · uncovered ${summary.uncovered} · ${summary.behaviour} with behaviour (${behaviour.reduce((n, r) => n + r.axes.length, 0)} axes) · ${skins.length} shipped skin(s)`);
  for (const w of warnings) console.warn(`  ! ${w}`);
  for (const p of problems) console.error(`  ✗ ${p}`);
}
if (problems.length) { console.error(`check-skin-coverage: ${problems.length} problem(s). Give the type a style target in schemas/customize.json (widgets) or a "skin": { "by": … } declaration on its asset-types.json entry; fix the behaviour axis declaration; or make the skin set the slot, parts or axis it leaves out.`); process.exit(1); }

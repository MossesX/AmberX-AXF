/**
 * typography@1 + density@1 + sizing@1 (core/engines/scale.ts, rules core/engines/scale-rules.mjs): the three scale
 * assets are registered (types, optional, late-optional, in the shared appearance slots, style-package members), the
 * registry's defaults equal the framework's own look, normalize clamps and fills, errors name the field, the compiled
 * tokens are regular (--fx-type-*, --fx-dens-*, --fx-size-*) and match the fixture, the build engine's validator is the
 * same function, every starter and every app's copy validates, the schemas carry every field, and the defaults name a
 * starter of each type.
 *   npx -y tsx framework/spec/check-scale.mts
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
import { appearanceSlotTypes, mergeAppearance, parseAppearance, resolveAppearance, serializeAppearance } from '../core/engines/appearance';
import { STYLE_PACKAGE_MEMBERS } from '../core/engines/stylepackage';
import {
  DEFAULT_DENSITY, DEFAULT_SIZING, DEFAULT_TYPOGRAPHY, SCALE_ENUMS, SCALE_FIELDS, SCALE_PREFIX, SCALE_TYPES, densityVars, normalizeScale, scaleErrors, scaleThemeVars, scaleToken, scaleVars, sizingVars, typographyVars,
} from '../core/engines/scale';
import * as engine from '../cli/build-engine.mjs';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

/* ---- registered everywhere ---- */
eq([...SCALE_TYPES], ['typography', 'density', 'sizing'], 'three scale types');
for (const t of SCALE_TYPES) {
  ok(ASSET_TYPES.includes(t as never), `${t} is an asset type`);
  ok(OPTIONAL_TYPES.includes(t as never), `${t} is optional (older apps still validate)`);
  ok(appearanceSlotTypes().includes(t), `${t} is a shared appearance slot (axHub carries it to every app)`);
  ok(!STYLE_PACKAGE_MEMBERS.includes(t), `${t} is not a style-package member (control sets stay controls; a design package carries it in extras.slots)`);
}
const spec = read('framework/schemas/asset-types.json');
const specTypes = Object.keys(spec.types);
eq(specTypes, [...ASSET_TYPES], 'asset-types.json lists the types in the TS order (Kotlin reads the same file)');
for (const t of SCALE_TYPES) { eq(spec.types[t].required, [], `${t}: nothing required (every field defaults)`); ok(spec.types[t].optional === true, `${t} optional in the registry`); }
ok(specTypes.indexOf('typography') < specTypes.indexOf('uac-policy'), 'uac-policy stays last');

/* ---- defaults = the framework's own look ---- */
eq(normalizeScale('typography', null), DEFAULT_TYPOGRAPHY, 'typography defaults');
eq(normalizeScale('density', undefined), DEFAULT_DENSITY, 'density defaults');
eq(normalizeScale('sizing', {}), DEFAULT_SIZING, 'sizing defaults');
eq(DEFAULT_TYPOGRAPHY.headings!.h1, 1.42, 'page title 1.42em (Oct 30 compact frame)');
eq(DEFAULT_SIZING.chip!.radius, 'sm', 'chips square-ish by default');
eq(DEFAULT_DENSITY.gap!.md, 0.75, 'fx-row gap 0.75 space');
for (const t of SCALE_TYPES) {
  for (const [path, [def, min, max]] of Object.entries(SCALE_FIELDS[t])) ok(def >= min && def <= max, `${t}.${path} default ${def} inside [${min}, ${max}]`);
  for (const [path, allowed] of Object.entries(SCALE_ENUMS[t])) ok(allowed.length >= 2, `${t}.${path} enum has choices`);
}

/* ---- normalize: fills, clamps, rounds, ignores unknown fields ---- */
const partial = normalizeScale('typography', { headings: { h1: 3 }, eyebrow: { case: 'normal' }, unknown: { x: 1 }, scale: { sm: 'big' } });
eq(partial.headings!.h1, 3, 'set value kept');
eq(partial.eyebrow!.case, 'normal', 'enum kept');
eq(partial.scale!.sm, 0.86, 'bad value → default');
ok(!('unknown' in partial), 'unknown group dropped');
eq(normalizeScale('density', { gap: { xl: 99, xs: -1 } }).gap, { ...DEFAULT_DENSITY.gap, xl: 6, xs: 0 }, 'numbers clamp into range');
eq(normalizeScale('sizing', { pageHead: { descriptionLines: 3.7 } }).pageHead!.descriptionLines, 4, 'int fields round');
eq(normalizeScale('sizing', { chip: { radius: 'round' } }).chip!.radius, 'sm', 'bad enum → default');

/* ---- errors name the field; unknown fields never fail ---- */
eq(scaleErrors('typography', { headings: { h1: 3 }, nope: 1 }), [], 'valid + unknown → no errors');
eq(scaleErrors('density', { gap: { xl: 99 } }), ['data.gap.xl must be a number from 0 to 6'], 'range error names the field');
eq(scaleErrors('sizing', { chip: { radius: 'round' } }), ['data.chip.radius must be one of sm, md, pill'], 'enum error');
eq(scaleErrors('sizing', { pageHead: { descriptionLines: 2.5 } }), ['data.pageHead.descriptionLines must be a whole number'], 'int error');
eq(scaleErrors('sizing', { card: 'big' }), ['data.card must be an object'], 'group must be an object');
eq(scaleErrors('typography', 7), ['data must be an object'], 'data must be an object');
eq(scaleErrors('button', { shape: 'x' }), [], 'other types: not this validator');

/* ---- tokens: regular names, one per field, every unit compiles ---- */
const vars = scaleThemeVars({});
const fieldCount = SCALE_TYPES.reduce((s, t) => s + Object.keys(SCALE_FIELDS[t]).length + Object.keys(SCALE_ENUMS[t]).length, 0);
eq(Object.keys(vars).length, fieldCount, 'one token per field');
for (const t of SCALE_TYPES) for (const k of Object.keys(scaleVars(t, null))) ok(k.startsWith(`--fx-${SCALE_PREFIX[t]}-`) && /^--fx-[a-z]+(-[a-z0-9]+)+$/.test(k), `${k} is a regular kebab token`);
eq(scaleToken('sizing', 'iconButton.size'), '--fx-size-icon-button-size', 'camelCase fields kebab in tokens');
eq(vars['--fx-type-headings-h1'], '1.42em', 'em unit');
eq(vars['--fx-dens-gap-md'], 'calc(var(--fx-space) * 0.75)', 'space unit');
eq(vars['--fx-size-button-height'], 'calc(var(--fx-font-size) * 2.1)', 'font unit');
eq(vars['--fx-type-weights-strong'], '600', 'plain number');
eq(vars['--fx-size-page-head-description-lines'], '2', 'int');
eq(vars['--fx-size-chip-radius'], 'var(--fx-radius-sm)', 'enum → theme radius');
eq(vars['--fx-type-eyebrow-case'], 'uppercase', 'enum → css word');
eq(sizingVars({ chip: { radius: 'pill' } })['--fx-size-chip-radius'], '999px', 'pill');
eq(typographyVars({ headings: { h1: 2 } })['--fx-type-headings-h1'], '2em', 'typography override');
eq(densityVars({ row: { list: 3.5 } })['--fx-dens-row-list'], 'calc(var(--fx-font-size) * 3.5)', 'density override');

/* ---- fixture (ports replay it) ---- */
const fx = read('framework/spec/fixtures/scale.json');
eq(fx.types, [...SCALE_TYPES], 'fixture types');
eq(fx.defaultVars, vars, 'fixture default tokens = engine');
for (const t of SCALE_TYPES) eq(fx.defaults[t], normalizeScale(t, null), `fixture defaults ${t}`);
for (const [k, c] of Object.entries(fx.starters as Record<string, { normalized: unknown; vars: unknown }>)) {
  const [t, id] = k.split(':') as [typeof SCALE_TYPES[number], string];
  const a = read(`framework/assets/${t}/${id}.json`);
  eq(normalizeScale(t, a.data), c.normalized, `fixture ${k} normalized`);
  eq(scaleVars(t, a.data), c.vars, `fixture ${k} vars`);
}
for (const [k, errs] of Object.entries(fx.errors as Record<string, string[]>)) ok(Array.isArray(errs), `fixture error case ${k}`);

/* ---- starters: one per type at least, a compact one (the default look), distinct, and every copy validates ---- */
const dirs = ['framework/assets', ...['console-web', 'axhub-web', 'patches-web', 'amberx-droid', 'walkthrough-studio'].map((a) => `apps/${a}/src/assets`)];
const defaults = read('framework/defaults.json');
for (const t of SCALE_TYPES) {
  const files = readdirSync(new URL(`framework/assets/${t}/`, root)).filter((f) => f.endsWith('.json'));
  ok(files.length >= 3, `${t}: at least three starters (${files.length})`);
  ok(files.includes('compact.json'), `${t}: a "compact" starter (the framework's own look)`);
  const compact = read(`framework/assets/${t}/compact.json`);
  eq(normalizeScale(t, compact.data), normalizeScale(t, null), `${t}/compact equals the defaults (changes nothing)`);
  const seen = new Set<string>();
  for (const f of files) {
    const a = read(`framework/assets/${t}/${f}`);
    const key = JSON.stringify(normalizeScale(t, a.data));
    ok(!seen.has(key), `${t}/${f} is distinct`); seen.add(key);
  }
  eq(defaults[t], 'compact', `defaults.json names ${t} compact`);
}
for (const dir of dirs) for (const t of SCALE_TYPES) {
  const d = new URL(`${dir}/${t}/`, root);
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d)) {
    const a = read(`${dir}/${t}/${f}`);
    const core = validateAsset(a); const be = engine.validateAsset(a);
    ok(core.ok, `${dir}/${t}/${f} validates (core): ${core.errors.join('; ')}`);
    eq(be.errors, core.errors, `${dir}/${t}/${f}: build engine agrees`);
  }
}
/* ---- both validators are one function ---- */
for (const t of SCALE_TYPES) {
  const bad = { $axf: 'asset@1', type: t, id: 'bad-one', name: 'Bad', version: '1.0.0', data: { nope: 'x', ...(t === 'density' ? { gap: { xl: 99 } } : t === 'sizing' ? { chip: { radius: 'round' } } : { eyebrow: { case: 'loud' } }) } };
  const c = validateAsset(bad), b = engine.validateAsset(bad);
  ok(!c.ok && !b.ok, `${t}: a bad asset fails both validators`);
  eq(b.errors, c.errors, `${t}: both validators report the same errors`);
}

/* ---- one change everywhere: the shared look on axHub carries the three slots to every app ---- */
const saved = mergeAppearance({ $axf: 'appearance@1' }, { slots: { typography: 'reader', density: 'dense', sizing: 'touch', 'color-theme': 'obsidian' } }, 'axf-console', '2026-10-30T12:00:00Z');
const wire = serializeAppearance(saved);
const back = parseAppearance(wire);
eq(back?.slots?.typography, 'reader', 'typography slot survives the wire');
const resolved = resolveAppearance(back, (t, id) => ['typography:reader', 'density:dense', 'sizing:touch', 'color-theme:obsidian'].includes(`${t}:${id}`));
eq([resolved.slots.typography, resolved.slots.density, resolved.slots.sizing], ['reader', 'dense', 'touch'], 'an app that ships the assets follows the hub');
const without = resolveAppearance(back, (t, id) => `${t}:${id}` === 'color-theme:obsidian');
ok(!without.slots.typography && without.skipped.some((x) => x.startsWith('typography:reader')), 'an app without the asset keeps its default (reported, never broken)');
const fxApp = read('framework/spec/fixtures/appearance.json');
for (const t of SCALE_TYPES) ok(fxApp.slotTypes.includes(t), `appearance fixture lists ${t} as a shared slot (Kotlin replays it)`);

/* ---- schemas carry every field ---- */
for (const t of SCALE_TYPES) {
  const schema = read(`framework/schemas/json/${t}.schema.json`);
  const props = schema.properties.data.properties;
  for (const path of [...Object.keys(SCALE_FIELDS[t]), ...Object.keys(SCALE_ENUMS[t])]) {
    const [g, f] = path.split('.') as [string, string];
    ok(props[g]?.properties?.[f], `${t} schema has ${path}`);
  }
}

console.log(`✓ scale assets — ${n} checks (typography, density, sizing: registry, defaults, normalize, errors, tokens, fixture, starters, validators, schemas)`);

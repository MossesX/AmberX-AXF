/**
 * shape@1 (core/engines/shape-rules.mjs): normalizeShape / shapeErrors / shapeRadius / shapeClip / shapeSquare /
 * shapeStyle against spec/fixtures/shape.json, plus: every starter passes both validators and normalizes to itself, every
 * kind in asset-types.json is one the engine knows, the registry row is a slot (Appearance → Assets, skins), and the
 * default (the `pill` starter, framework/defaults.json) compiles to the look every banner widget had before shapes were
 * assets: a 999px radius, no clip, no square box. `npx -y tsx framework/spec/check-shape.mts [--write]`
 * (--write regenerates the fixture's expected values from the reference engine; review the diff).
 * The Kotlin twin is deferred (spec/PORTING.md): the fixture is what it will replay.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHAPE_DEFAULT_KIND, SHAPE_KINDS, SHAPE_RADII, SHAPE_TYPE, normalizeShape, shapeClip, shapeErrors, shapeRadius, shapeSquare, shapeStyle } from '../core/engines/shape-rules.mjs';
import { bannerWidgetView, normalizeBannerWidgetPref, patchBannerWidget } from '../core/engines/bannerwidgets';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
import { validateAsset } from '../core/validate';
import { validateAsset as cliValidate } from '../cli/build-engine.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, 'fixtures/shape.json');
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
const run = {
  normalizeShape: (i: unknown) => normalizeShape(i),
  shapeErrors: (i: unknown) => shapeErrors(SHAPE_TYPE, i),
  shapeRadius: (i: unknown) => shapeRadius(i),
  shapeClip: (i: unknown) => shapeClip(i),
  shapeSquare: (i: unknown) => shapeSquare(i),
  shapeStyle: (i: unknown) => shapeStyle(i),
} as Record<string, (i: unknown) => unknown>;
let ok = 0;
const check = (c: unknown, msg: string) => { assert.ok(c, msg); ok++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); ok++; };
if (process.argv.includes('--write')) {
  for (const c of fx.cases) c.expected = run[c.fn]!(c.input);
  writeFileSync(FIX, `${JSON.stringify(fx, null, 2)}\n`);
  console.log(`wrote ${fx.cases.length} expected values`);
}
for (const c of fx.cases) eq(run[c.fn]!(c.input), c.expected, `${c.fn} ${c.name}`);

// the registry: a Controls slot, optional, every kind known to the engine, in the same place in both type lists
const spec = JSON.parse(readFileSync(join(here, '../schemas/asset-types.json'), 'utf8')).types;
eq(spec[SHAPE_TYPE].enums.kind, [...SHAPE_KINDS], 'registry kinds = engine kinds');
check(spec[SHAPE_TYPE].optional === true && !spec[SHAPE_TYPE].attachable && !spec[SHAPE_TYPE].widget, 'shape is an optional slot, not a widget');
eq(Object.keys(spec).indexOf(SHAPE_TYPE), (ASSET_TYPES as readonly string[]).indexOf(SHAPE_TYPE), 'ASSET_TYPES order matches the registry');
check((OPTIONAL_TYPES as readonly string[]).includes(SHAPE_TYPE), 'shape is optional (an app may ship none)');
check(SHAPE_RADII.includes('pill') && SHAPE_RADII.includes('none'), 'radius steps span none to pill');

// starters: both validators pass, normalize to themselves; the default is today's look
const dflt = JSON.parse(readFileSync(join(here, '../defaults.json'), 'utf8'))[SHAPE_TYPE];
eq(dflt, SHAPE_DEFAULT_KIND, 'the default slot pick is the default kind');
const starters = readdirSync(join(here, '../assets', SHAPE_TYPE)).map((f) => JSON.parse(readFileSync(join(here, '../assets', SHAPE_TYPE, f), 'utf8')));
check(starters.some((a) => a.id === dflt), 'the default starter ships');
for (const a of starters) {
  eq(validateAsset(a).errors, [], `${a.id} passes core validation`);
  eq(cliValidate(a).errors, [], `${a.id} passes the build engine`);
  eq(normalizeShape(a.data), a.data, `${a.id} normalizes to itself`);
}
eq(shapeStyle(starters.find((a) => a.id === dflt)!.data), shapeStyle(undefined), 'the default starter = no asset at all');
eq(shapeStyle(undefined).vars, { '--fx-widget-radius': '999px', '--fx-widget-clip': 'none', '--fx-widget-corner': 'round', '--fx-widget-aspect': 'auto' }, "no asset = today's look (a 999px pill, nothing clipped)");

// both validators say the same about a bad asset
const bad = { $axf: 'asset@1', type: SHAPE_TYPE, id: 'x', name: 'X', version: '1', data: { kind: 'blob', corners: { tl: 'huge', zz: 'sm' }, mask: 'url(javascript:1)', square: 'yes' } };
eq(validateAsset(bad).errors, cliValidate(bad).errors, 'core and build engine agree on a bad shape');
check(validateAsset(bad).errors.length >= 5, 'every bad field is named');

// banner widgets carry a per-instance shape (the id of a shape asset); junk is dropped, null goes back to the slot
eq(normalizeBannerWidgetPref({ shape: 'hexagon' }).shape, 'hexagon', 'a widget pref keeps a shape id');
eq(normalizeBannerWidgetPref({ shape: 'Bad Id' }).shape, undefined, 'a bad shape id is dropped');
eq(bannerWidgetView('status', { shape: 'tag' }, null).shape, 'tag', 'the hint sets the default shape');
eq(bannerWidgetView('status', { shape: 'tag' }, { shape: 'square' }).shape, 'square', 'the pick beats the hint');
eq(bannerWidgetView('status', null, null).shape, '', 'no pick, no hint = the active shape slot');
eq(patchBannerWidget({ 'status:a': { shape: 'square' } }, 'status:a', { shape: null }), {}, 'null clears the per-instance shape');

console.log(`check-shape: ok (${ok} checks, ${fx.cases.length} fixture cases)`);

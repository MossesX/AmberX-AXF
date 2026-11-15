/**
 * shape@1 (core/engines/shape-rules.mjs + core/engines/shape.ts): normalizeShape / shapeErrors / shapeRadius / shapeSquare
 * / shapeClip / shapeMask / compileShape against spec/fixtures/shape.json, plus: every starter passes both validators and
 * normalizes to itself, every kind in asset-types.json is one the engine knows, the registry row is a slot (Appearance →
 * Assets, skins), and the default (the `pill` starter, framework/defaults.json) compiles to the look every banner widget
 * had before shapes were assets: a 999px radius, no clip, no mask, no square box.
 *   npx -y tsx framework/spec/check-shape.mts [--write]
 * (--write regenerates the fixture's expected values from the reference engine; review the diff).
 * The Kotlin twin is deferred (spec/PORTING.md): the fixture is what it will replay.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHAPE_DEFAULT_KIND, SHAPE_KINDS, SHAPE_RADII, SHAPE_TYPE, normalizeShape, shapeErrors, shapeRadius, shapeSquare } from '../core/engines/shape-rules.mjs';
import { SHAPE_POLYGONS, compileShape, shapeClip, shapeMask, shapeToken, squirclePath, squirclePolygon, superellipsePoints } from '../core/engines/shape';
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
  shapeMask: (i: unknown) => shapeMask(i),
  shapeSquare: (i: unknown) => shapeSquare(i),
  compileShape: (i: unknown) => compileShape(i),
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

// the registry: a Controls slot, optional, every kind known to the engine, in the same place in both type lists, declared `by: slot`
const spec = JSON.parse(readFileSync(join(here, '../schemas/asset-types.json'), 'utf8')).types;
eq(spec[SHAPE_TYPE].enums.kind, [...SHAPE_KINDS], 'registry kinds = engine kinds');
check(spec[SHAPE_TYPE].optional === true && !spec[SHAPE_TYPE].attachable && !spec[SHAPE_TYPE].widget, 'shape is an optional slot, not a widget');
eq(spec[SHAPE_TYPE].skin?.by, 'slot', 'the registry declares how a skin reaches a shape: the slot');
eq(Object.keys(spec).indexOf(SHAPE_TYPE), (ASSET_TYPES as readonly string[]).indexOf(SHAPE_TYPE), 'ASSET_TYPES order matches the registry');
check((OPTIONAL_TYPES as readonly string[]).includes(SHAPE_TYPE), 'shape is optional (an app may ship none)');
check(SHAPE_RADII.includes('pill') && SHAPE_RADII.includes('none'), 'radius steps span none to pill');
const schema = JSON.parse(readFileSync(join(here, '../schemas/json/shape.schema.json'), 'utf8'));
eq(schema.properties.data.properties.kind.enum, [...SHAPE_KINDS], 'the JSON Schema lists every kind');
for (const k of ['corners', 'mask', 'viewBox', 'square']) check(k in schema.properties.data.properties, `the JSON Schema types ${k}`);

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
eq(compileShape(starters.find((a) => a.id === dflt)!.data), compileShape(undefined), 'the default starter = no asset at all');
eq(compileShape(undefined).vars, { '--fx-shape-widget-radius': '999px 999px 999px 999px', '--fx-shape-widget-clip': 'none', '--fx-shape-widget-mask': 'none', '--fx-shape-widget-corner': 'round', '--fx-shape-widget-aspect': 'auto' }, "no asset = today's look (a 999px pill, nothing clipped or masked)");
eq(compileShape(undefined).attrs, { 'data-fx-shape-widget': 'pill' }, 'the root attribute names the slot and the kind');
eq(shapeToken('radius', 'Bad Slot'), '--fx-shape-widget-radius', 'a bad slot name falls back to the widget slot');

// geometry: every polygon kind is in percentages (it scales with the chip); the squircle is a superellipse path served as a mask
for (const k of ['hexagon', 'diamond', 'tag']) check(SHAPE_POLYGONS[k]!.startsWith('polygon(') && !/px/.test(SHAPE_POLYGONS[k]!), `${k} is a percentage polygon`);
const pts = superellipsePoints();
check(pts.length === 48 && pts.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100), 'squircle points stay inside the box');
check(pts.every(([x, y]) => !((x < 1 || x > 99) && (y < 1 || y > 99))), 'squircle points never touch a corner');
check(/^M [\d. L]+ Z$/.test(squirclePath()) && squirclePath().split(' L ').length === 96, 'the squircle path is closed path data, 96 points');
check(shapeErrors(SHAPE_TYPE, { kind: 'mask', mask: squirclePath() }).length === 0, 'the squircle path passes the mask rules (a port may ship it as a mask asset)');
const sq = compileShape({ kind: 'squircle' });
check(sq.vars['--fx-shape-widget-clip'] === 'none' && sq.vars['--fx-shape-widget-mask']!.startsWith('url("data:image/svg+xml,') && sq.vars['--fx-shape-widget-corner'] === 'squircle', 'squircle = mask + corner-shape hint, no clip');
check(squirclePolygon().startsWith('polygon(') && squirclePolygon().split(',').length === 48, 'the squircle polygon is there for stylesheets that clip');
for (const k of SHAPE_KINDS) {
  const v = compileShape({ kind: k, ...(k === 'mask' ? { mask: 'M 0 0 L 100 0 L 100 100 Z' } : {}), ...(k === 'corners' ? { corners: { tl: 'sm' } } : {}) }).vars;
  check(v['--fx-shape-widget-radius']!.split(' ').length === 4, `${k}: four corner radii`);
  check(!/\d+px/.test(v['--fx-shape-widget-radius']!.replace(/999px/g, '')), `${k}: radii are tokens (or 0 / 999px)`);
  check((v['--fx-shape-widget-clip'] === 'none') || (v['--fx-shape-widget-mask'] === 'none'), `${k}: clip and mask never both cut`);
}
check(shapeMask({ kind: 'mask', mask: 'M 0 0 L 100 0 L 100 100 Z' }).startsWith('url("data:image/svg+xml,') && shapeMask({ kind: 'mask', mask: 'M 0 0 L 100 0 L 100 100 Z' }).includes("preserveAspectRatio='none'"), 'a mask is a data-URI svg stretched over the chip');
check(!/<|>|"/.test(shapeMask({ kind: 'mask', mask: 'M 0 0 L 100 0 L 100 100 Z' }).slice(5, -2)), 'the data URI has no raw <, > or quotes');

// both validators say the same about a bad asset
const bad = { $axf: 'asset@1', type: SHAPE_TYPE, id: 'x', name: 'X', version: '1', data: { kind: 'blob', corners: { tl: 'huge', zz: 'sm' }, mask: 'url(javascript:1)', square: 'yes' } };
eq(validateAsset(bad).errors, cliValidate(bad).errors, 'core and build engine agree on a bad shape');
check(validateAsset(bad).errors.length >= 5, 'every bad field is named');
check(new Set(validateAsset(bad).errors).size === validateAsset(bad).errors.length, 'no message is repeated (the kind is named once)');

// shape-validate.json: whole assets, good and bad, through the reference validator (core/validate.ts) and its build-engine
// twin (cli/build-engine.mjs); `ok` and the exact messages must agree, and every port's validator replays the same file
const VFIX = join(here, 'fixtures/shape-validate.json');
const vfx = JSON.parse(readFileSync(VFIX, 'utf8'));
if (process.argv.includes('--write')) {
  for (const c of vfx.cases) c.result = validateAsset(c.asset);
  writeFileSync(VFIX, `${JSON.stringify(vfx, null, 2)}\n`);
  console.log(`wrote ${vfx.cases.length} validation results`);
}
for (const c of vfx.cases) {
  eq(validateAsset(c.asset), c.result, `validate ${c.name} (core)`);
  eq(cliValidate(c.asset).errors, c.result.errors, `validate ${c.name} (build engine twin)`);
  eq(c.result.ok, c.good === true, `validate ${c.name}: ${c.good ? 'good' : 'bad'} as labelled`);
  for (const frag of c.expect ?? []) check(c.result.errors.some((e: string) => e.includes(frag)), `validate ${c.name} names "${frag}"`);
}
check(vfx.cases.filter((c: { good?: boolean }) => c.good).length >= 6 && vfx.cases.filter((c: { good?: boolean }) => !c.good).length >= 10, 'the validation fixture has good and bad cases');

// banner widgets carry a per-instance shape (the id of a shape asset); junk is dropped, null goes back to the slot
eq(normalizeBannerWidgetPref({ shape: 'hexagon' }).shape, 'hexagon', 'a widget pref keeps a shape id');
eq(normalizeBannerWidgetPref({ shape: 'Bad Id' }).shape, undefined, 'a bad shape id is dropped');
eq(bannerWidgetView('status', { shape: 'tag' }, null).shape, 'tag', 'the hint sets the default shape');
eq(bannerWidgetView('status', { shape: 'tag' }, { shape: 'square' }).shape, 'square', 'the pick beats the hint');
eq(bannerWidgetView('status', null, null).shape, '', 'no pick, no hint = the active shape slot');
eq(patchBannerWidget({ 'status:a': { shape: 'square' } }, 'status:a', { shape: null }), {}, 'null clears the per-instance shape');

console.log(`check-shape: ok (${ok} checks, ${fx.cases.length} fixture cases)`);

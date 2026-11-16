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
import { SHAPE_WIDGET_TOKENS, SHAPE_DEFAULT_KIND, SHAPE_KINDS, SHAPE_RADII, SHAPE_TYPE, normalizeShape, shapeErrors, shapeRadius, shapeSquare } from '../core/engines/shape-rules.mjs';
import { SHAPE_HISTORY_MAX, SHAPE_LEVELS, SHAPE_POLYGONS, compileShape, forgetShapeEdit, normalizeShapeHistory, previousShape, recordShapeEdit, resolveShape, resolveShapeAt, restorePreviousShape, shapeClip, shapeMask, shapeScopeChain, shapeScopeKey, shapeScopeLevel, shapeToken, squirclePath, squirclePolygon, superellipsePoints } from '../core/engines/shape';
import { bannerWidgetView, normalizeBannerWidgetPref, patchBannerWidget } from '../core/engines/bannerwidgets';
import { normalizeSkin, skinCoverage, skinCovers, skinErrors, skinSlots } from '../core/engines/skin';
import { CUSTOM_TARGETS, customizableTypes } from '../core/engines/customize';
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
eq(Object.keys(compileShape(null).vars), [...SHAPE_WIDGET_TOKENS], 'the written-out widget tokens = what the engine compiles');
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

// resolve: instance → app → skin → global, the child overrides the parent; nothing anywhere = the default kind
eq(shapeScopeChain({ widget: 'status:a' }), ['axf.banner.widget.status:a.shape', 'app', 'skin', 'global'], 'the chain runs from the widget to the hub');
eq(shapeScopeChain(null), ['app', 'skin', 'global'], 'no widget = three levels');
eq(shapeScopeLevel('axf.banner.widget.status:a.shape'), { level: 'instance', widget: 'status:a' }, 'an instance key names its widget');
eq(shapeScopeLevel('axf.banner.widget..shape'), null, 'a bad instance key is no level');
assert.throws(() => shapeScopeKey('instance', 'Bad Key'), 'an instance level needs a widget key');
const at = (widget: string, instance: string, app: string, skin: string, global: string) => resolveShape([{ key: shapeScopeKey('instance', widget), id: instance }, { key: 'app', id: app }, { key: 'skin', id: skin }, { key: 'global', id: global }]);
eq(at('status:a', 'hexagon', 'square', 'rounded', 'circle').id, 'hexagon', 'the widget beats everything');
eq(at('status:a', '', 'square', 'rounded', 'circle'), { id: 'square', from: 'app', level: 'app', chain: [{ key: 'axf.banner.widget.status:a.shape', id: '' }, { key: 'app', id: 'square' }] }, 'the app beats the skin and the hub');
eq(at('status:a', '', '', 'rounded', 'circle').from, 'skin', 'the skin beats the hub');
eq(at('status:a', '', '', '', 'circle').level, 'global', 'the hub decides when nothing nearer does');
eq(at('status:a', '', '', '', '').id, SHAPE_DEFAULT_KIND, 'nothing anywhere = the default kind');
eq(at('status:a', 'Bad Id', '', '', 'circle').id, 'circle', 'junk at a level inherits');
eq(resolveShape([{ key: 'nope', id: 'square' }, { key: 'global', id: 'circle' }]).chain.length, 1, 'unknown keys are skipped');
eq(resolveShapeAt({ widget: 'status:a' }, (k) => ({ 'axf.banner.widget.status:a.shape': 'tag', global: 'circle' } as Record<string, string>)[k]).id, 'tag', 'resolveShapeAt reads per-key picks');
eq(resolveShapeAt(null, () => undefined).level, 'default', 'resolveShapeAt with nothing picked = the default');

// history: the previous value per key, Restore previous edit swaps it back (and is itself restorable)
let hist = recordShapeEdit({}, 'app', '', 'hexagon', 't1');
eq(hist, { app: { previous: '', current: 'hexagon', at: 't1' } }, 'an edit records what the level held before');
eq(recordShapeEdit(hist, 'app', 'hexagon', 'hexagon', 't2'), hist, 'an edit that changes nothing is not recorded');
eq(recordShapeEdit(hist, 'nope', '', 'hexagon', 't2'), hist, 'a key that is not a level is not recorded');
hist = recordShapeEdit(hist, 'app', 'hexagon', 'square', 't3');
eq(previousShape(hist, 'app'), 'hexagon', 'only the last edit is kept');
eq(previousShape(hist, 'skin'), null, 'no edit, nothing to restore');
const restored = restorePreviousShape(hist, 'app', 't4')!;
eq(restored.id, 'hexagon', 'restore puts the previous value back');
eq(restored.history.app, { previous: 'square', current: 'hexagon', at: 't4' }, 'restore is itself an edit (a second restore redoes)');
eq(restorePreviousShape(restored.history, 'app', 't5')!.id, 'square', 'restore twice = back where it was');
eq(restorePreviousShape(hist, 'global', 't4'), null, 'restore on a key with no history = null');
eq(forgetShapeEdit(hist, 'app'), {}, 'forget drops the key');
eq(normalizeShapeHistory({ app: { previous: 'a-b', current: 'xx', at: 't' }, nope: { previous: '', current: 'xx', at: 't' }, skin: { previous: 'xx', current: 'xx', at: 't' }, global: 'junk', instance: { previous: 'x', current: 'xx', at: 't' } }), { app: { previous: 'a-b', current: 'xx', at: 't' } }, 'normalize drops unknown keys, no-op edits, one-letter ids and junk');
const many = Object.fromEntries(Array.from({ length: SHAPE_HISTORY_MAX + 5 }, (_, i) => [`axf.banner.widget.status:w${i}.shape`, { previous: '', current: 'square', at: `2026-01-01T00:00:${String(i).padStart(2, '0')}` }]));
const trimmed = normalizeShapeHistory(many);
check(Object.keys(trimmed).length === SHAPE_HISTORY_MAX && !('axf.banner.widget.status:w0.shape' in trimmed) && 'axf.banner.widget.status:w104.shape' in trimmed, 'the history is capped, the oldest edits go first');

// shape-engine.json (gen-fixtures.mts): the golden outputs every port replays for compile (every kind, per-corner radii,
// masks, slots), the resolve chain (all four levels, the default, junk) and Restore previous edit
const efx = JSON.parse(readFileSync(join(here, 'fixtures/shape-engine.json'), 'utf8'));
eq(efx.contract, 'shape@1', 'engine fixture contract');
eq(efx.levels, [...SHAPE_LEVELS], 'engine fixture levels');
eq(efx.historyMax, SHAPE_HISTORY_MAX, 'engine fixture history cap');
eq(efx.polygons, SHAPE_POLYGONS, 'engine fixture polygons');
eq(efx.squirclePath, squirclePath(), 'engine fixture squircle path');
check(SHAPE_KINDS.every((k) => efx.compile.some((c: { name: string }) => c.name === k)), 'engine fixture compiles every kind');
for (const c of efx.compile) eq(compileShape(c.input, c.slot), c.output, `engine fixture compile ${c.name}`);
for (const c of efx.resolve) eq(resolveShape(c.chain), c.output, `engine fixture resolve ${c.name}`);
check(['instance', 'app', 'skin', 'global', 'default'].every((l) => efx.resolve.some((c: { output: { level: string } }) => c.output.level === l)), 'engine fixture resolves at every level and the default');
const efxStateOf = (k: string) => (efx.resolveAt.picks as Record<string, string>)[k];
eq(resolveShapeAt({ widget: 'status:a' }, efxStateOf), efx.resolveAt.widget, 'engine fixture resolveAt widget');
eq(resolveShapeAt({ widget: 'counter:b' }, efxStateOf), efx.resolveAt.other, 'engine fixture resolveAt other widget');
eq(resolveShapeAt(null, efxStateOf), efx.resolveAt.app, 'engine fixture resolveAt app');
const efxOps = { recordShapeEdit, previousShape, restorePreviousShape, forgetShapeEdit, normalizeShapeHistory } as Record<string, (...a: never[]) => unknown>;
for (const s of efx.history) eq(efxOps[s.op.split(' ')[0]!]!(...(s.args as never[])), s.out, `engine fixture history ${s.op}`);
check(efx.history.some((s: { op: string }) => s.op.startsWith('restorePreviousShape')), 'engine fixture covers Restore previous edit');

// skin@1 carries the shape slot (assets.shape) and the style target reaches the chips the shape cuts (.fx-shaped)
const skinned = normalizeSkin({ layoutTheme: 'a-b', colorTheme: 'a-b', styleTheme: 'a-b', assets: { shape: 'hexagon', button: 'a-b' } });
eq(skinned.assets.shape, 'hexagon', 'a skin keeps its shape pick');
eq(skinSlots(skinned).shape, 'hexagon', 'the shape is one of the slots a skin sets');
eq(skinErrors({ layoutTheme: 'a-b', colorTheme: 'a-b', styleTheme: 'a-b', assets: { shape: 'hexagon' } }), [], 'assets.shape validates');
eq(skinErrors({ layoutTheme: 'a-b', colorTheme: 'a-b', styleTheme: 'a-b', assets: { shape: 'Bad Id' } }), ['data.assets.shape must be an asset id'], 'a bad shape id in a skin is named');
eq(skinCovers(skinned).find((c) => c.type === SHAPE_TYPE)?.covered, true, 'skinCovers: the skin reaches the shape');
eq(CUSTOM_TARGETS[SHAPE_TYPE]?.root, '.fx-shaped', 'the shape style target is the shaped chips');
check(customizableTypes().includes(SHAPE_TYPE), 'the shape slot is customizable');
const coverage = skinCoverage().find((r) => r.type === SHAPE_TYPE)!;
eq({ by: coverage.by, also: coverage.also, declared: coverage.declared }, { by: 'slot', also: ['parts'], declared: true }, 'skin coverage: shape = slot + parts, declared');
eq(skinErrors({ layoutTheme: 'a-b', colorTheme: 'a-b', styleTheme: 'a-b', assets: {}, parts: { shape: { textColor: 'accent' } } }), [], 'a skin may style the shaped chips through parts.shape');

// banner widgets carry a per-instance shape (the id of a shape asset); junk is dropped, null goes back to the slot
eq(normalizeBannerWidgetPref({ shape: 'hexagon' }).shape, 'hexagon', 'a widget pref keeps a shape id');
eq(normalizeBannerWidgetPref({ shape: 'Bad Id' }).shape, undefined, 'a bad shape id is dropped');
eq(bannerWidgetView('status', { shape: 'tag' }, null).shape, 'tag', 'the hint sets the default shape');
eq(bannerWidgetView('status', { shape: 'tag' }, { shape: 'square' }).shape, 'square', 'the pick beats the hint');
eq(bannerWidgetView('status', null, null).shape, '', 'no pick, no hint = the active shape slot');
eq(patchBannerWidget({ 'status:a': { shape: 'square' } }, 'status:a', { shape: null }), {}, 'null clears the per-instance shape');

console.log(`check-shape: ok (${ok} checks, ${fx.cases.length} fixture cases)`);

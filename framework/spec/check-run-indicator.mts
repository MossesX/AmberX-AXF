/**
 * run-indicator@1 (core/engines/run-indicator.ts, rules core/engines/run-indicator-rules.mjs): the type is registered
 * (optional, late-optional, a shared appearance slot, before uac-policy, skin by slot), the defaults equal the pulse
 * starter, normalize clamps and fills, errors name the field, the compiled --fx-run-* tokens are opacity and colour-mix
 * over the theme only (never a colour literal), reduced motion stops every animation and keeps the tints the fallback
 * says, the fixture matches, every starter validates through both validators, the schema carries every field, the
 * default names a starter, every shared app ships the starters, and axf.css reads only the tokens.
 *   npx -y tsx framework/spec/check-run-indicator.mts
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
import { appearanceSlotTypes } from '../core/engines/appearance';
import { coverageOf } from '../core/engines/skin-coverage.mjs';
import { SKIN_NEVER } from '../core/engines/skin-rules.mjs';
import {
  DEFAULT_RUN_INDICATOR, RUN_ANIMATIONS, RUN_DEFAULTS, RUN_INDICATOR_TYPE, RUN_PREFIX, RUN_RANGES, RUN_REDUCED, RUN_STATES, RUN_TONES,
  normalizeRunIndicator, runIndicatorAttrs, runIndicatorErrors, runIndicatorStyle, runIndicatorVars, runStateAttr,
} from '../core/engines/run-indicator';
import * as engine from '../cli/build-engine.mjs';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

/* ---- registered everywhere ---- */
ok(ASSET_TYPES.includes(RUN_INDICATOR_TYPE as never), 'run-indicator is an asset type');
ok(OPTIONAL_TYPES.includes(RUN_INDICATOR_TYPE as never), 'run-indicator is optional (older apps still validate)');
ok(appearanceSlotTypes().includes(RUN_INDICATOR_TYPE), 'run-indicator is a shared appearance slot (axHub carries it to every app)');
const spec = read('framework/schemas/asset-types.json');
const specTypes = Object.keys(spec.types);
eq(specTypes, [...ASSET_TYPES], 'asset-types.json lists the types in the TS order (Kotlin reads the same file)');
ok(specTypes.indexOf(RUN_INDICATOR_TYPE) === specTypes.indexOf('uac-policy') - 1, 'run-indicator sits right before uac-policy, which stays last');
const ts = spec.types[RUN_INDICATOR_TYPE];
eq(ts.required, ['animation', 'icon', 'tones'], 'required fields');
eq(ts.enums.animation, [...RUN_ANIMATIONS], 'registry animation enum = the engine\'s');
eq(ts.enums.reducedMotion, [...RUN_REDUCED], 'registry reducedMotion enum = the engine\'s');
eq(ts.nested.tones, ['running', 'broke'], 'tones: running and broke required');
ok(ts.optional === true, 'optional in the registry');
eq(ts.skin, { by: 'slot', why: ts.skin.why }, 'skin coverage declared by slot');
eq(coverageOf(RUN_INDICATOR_TYPE, spec.types, read('framework/schemas/customize.json').targets ?? {}, SKIN_NEVER).by, 'slot', 'skin-coverage@1 reaches it as a slot');

/* ---- defaults, normalize, errors ---- */
eq(normalizeRunIndicator(null), DEFAULT_RUN_INDICATOR, 'defaults');
eq(DEFAULT_RUN_INDICATOR, { ...RUN_DEFAULTS, tones: { ...RUN_DEFAULTS.tones } }, 'the default is the pulse look');
const pulse = read('framework/assets/run-indicator/pulse.json');
eq(normalizeRunIndicator(pulse.data), DEFAULT_RUN_INDICATOR, 'the pulse starter equals the defaults (an app without the asset looks the same)');
const partial = normalizeRunIndicator({ animation: 'glow', tones: { running: 'info' } });
eq(partial.animation, 'glow', 'partial keeps what it sets');
eq(partial.tones, { running: 'info', broke: 'danger', stale: 'warning', done: 'success' }, 'partial tones fill from the defaults');
const clamped = normalizeRunIndicator({ speed: 9000, durationMs: 1, intensity: -4 });
eq([clamped.speed, clamped.durationMs, clamped.intensity], [RUN_RANGES.speed[1], RUN_RANGES.durationMs[0], RUN_RANGES.intensity[0]], 'numbers clamp to their ranges');
eq(normalizeRunIndicator({ animation: 'wobble', icon: 'Not An Icon', tones: 'red' }), DEFAULT_RUN_INDICATOR, 'junk reads as the default, never a claim');
eq(runIndicatorErrors('run-indicator', RUN_DEFAULTS), [], 'defaults validate');
ok(runIndicatorErrors('run-indicator', { tones: { running: '#ff0000' } }).some((e) => e.includes('never a colour')), 'a colour literal in a tone is refused');
ok(runIndicatorErrors('run-indicator', { tones: { idle: 'accent' } }).some((e) => e.includes('not a live state')), 'an unknown state in tones is refused');
ok(runIndicatorErrors('run-indicator', { speed: 1 }).some((e) => e.startsWith('data.speed')), 'a number out of range names the field');
eq(runIndicatorErrors('button', { animation: 'wobble' }), [], 'other types are not checked here');

/* ---- tokens: opacity and colour-mix over the theme only ---- */
const vars = runIndicatorVars(pulse.data);
const names = Object.keys(vars);
ok(names.every((k) => k.startsWith(RUN_PREFIX)), 'every token is --fx-run-*');
for (const s of RUN_STATES) { eq(vars[`${RUN_PREFIX}${s}`], `var(--fx-${(pulse.data.tones as Record<string, string>)[s]})`, `${s} tone is a theme var`); ok(vars[`${RUN_PREFIX}${s}-bg`].includes('color-mix(') && vars[`${RUN_PREFIX}${s}-bg`].includes('var(--fx-opacity-tint)'), `${s} background is a colour-mix at the theme tint opacity`); }
eq(vars[`${RUN_PREFIX}broke-bg`], 'color-mix(in srgb, var(--fx-run-broke) calc(var(--fx-opacity-tint) * 100%), var(--fx-surface))', 'the pink background is the danger tone mixed over the surface');
eq(vars[`${RUN_PREFIX}duration`], '2400ms', 'duration at speed 100 is the cycle');
eq(runIndicatorVars({ speed: 200 })[`${RUN_PREFIX}duration`], 'calc(2400ms * 0.500)', 'speed scales the cycle');
eq(vars[`${RUN_PREFIX}flash-min`], '0.650', 'flash-min = 1 - intensity');
const literal = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;
for (const f of readdirSync(new URL('framework/assets/run-indicator/', root))) {
  const a = read(`framework/assets/run-indicator/${f}`);
  const v = runIndicatorVars(a.data);
  ok(!Object.values(v).some((x) => literal.test(x)), `${f}: no colour literal in any token`);
  ok(Object.values(v).every((x) => /^(var\(|color-mix\(|calc\(|\d)/.test(x)), `${f}: every token is a var, a colour-mix, a calc or a number`);
}
for (const tone of RUN_TONES) ok(runIndicatorVars({ tones: { running: tone } })[`${RUN_PREFIX}running`] === `var(--fx-${tone})`, `tone ${tone} compiles to its theme var`);

/* ---- reduced motion ---- */
const red = runIndicatorStyle(pulse.data, true);
eq(red.vars[`${RUN_PREFIX}duration`], '0ms', 'reduced motion: no cycle');
eq([red.attrs['data-fx-run-anim'], red.attrs['data-fx-run-icon-anim'], red.attrs['data-fx-run-broke-anim']], ['none', 'none', 'none'], 'reduced motion: every animation reads none');
eq(red.attrs['data-fx-run-reduced'], 'still', 'reduced motion: the fallback is told');
eq(runIndicatorAttrs(pulse.data)['data-fx-run-reduced'], '', 'motion on: no fallback attribute value');
eq(runIndicatorAttrs(pulse.data)['data-fx-run-icon'], 'refresh', 'the icon rides as an attribute');
eq(runIndicatorStyle({ reducedMotion: 'off' }, true).attrs['data-fx-run-reduced'], 'off', 'off fallback');
eq(runStateAttr('broke'), { 'data-fx-run-state': 'broke' }, 'row attribute for a live state');
eq(runStateAttr('idle'), {}, 'idle draws nothing');

/* ---- fixture ---- */
const fx = read('framework/spec/fixtures/run-indicator.json');
eq(fx.defaults, DEFAULT_RUN_INDICATOR, 'fixture: defaults');
eq(fx.defaultStyle, runIndicatorStyle(undefined), 'fixture: default style');
for (const [id, s] of Object.entries(fx.starters as Record<string, { normalized: unknown; style: unknown; reduced: unknown }>)) {
  const a = read(`framework/assets/run-indicator/${id}.json`);
  eq(normalizeRunIndicator(a.data), s.normalized, `fixture: ${id} normalized`);
  eq(runIndicatorStyle(a.data), s.style, `fixture: ${id} style`);
  eq(runIndicatorStyle(a.data, true), s.reduced, `fixture: ${id} reduced`);
}
eq(fx.styles.fast, runIndicatorStyle({ speed: 200 }), 'fixture: fast');
eq(fx.errors['bad-tones'], runIndicatorErrors('run-indicator', { tones: { running: '#ff0000', idle: 'accent' } }), 'fixture: bad tones');

/* ---- starters, both validators, schema, defaults, shared apps ---- */
const starters = readdirSync(new URL('framework/assets/run-indicator/', root)).filter((f) => f.endsWith('.json'));
eq(starters.sort(), ['flash.json', 'glow.json', 'pulse.json'], 'three starters: pulse (default), flash, glow');
for (const f of starters) {
  const a = read(`framework/assets/run-indicator/${f}`);
  eq(validateAsset(a).errors, [], `${f} validates (core)`);
  const r = engine.validateAsset(a) as { ok: boolean; errors: string[] };
  eq(r.errors, [], `${f} validates (build engine)`);
}
const bad = { ...pulse, id: 'bad', data: { ...pulse.data, tones: { running: '#f00' }, speed: 1 } };
eq(validateAsset(bad).errors, (engine.validateAsset(bad) as { errors: string[] }).errors, 'both validators say the same thing');
ok(validateAsset(bad).errors.some((e) => e.includes('data.tones.running')) && validateAsset(bad).errors.some((e) => e.startsWith('data.speed')) && validateAsset(bad).errors.some((e) => e.includes('data.tones.broke')), 'the bad asset gets the tone, speed and missing-broke errors');
const schema = read('framework/schemas/json/run-indicator.schema.json');
eq(Object.keys(schema.properties.data.properties).sort(), ['animation', 'brokeAnimation', 'durationMs', 'icon', 'iconAnimation', 'intensity', 'reducedMotion', 'speed', 'tones'], 'the schema carries every field');
eq(schema.properties.data.properties.tones.properties.running.enum, [...RUN_TONES], 'the schema holds tones to token ids');
const defaults = read('framework/defaults.json');
eq(defaults[RUN_INDICATOR_TYPE], 'pulse', 'the framework default names the pulse starter');
for (const app of read('framework/schemas/shared-assets.json').apps as string[]) for (const f of starters) ok(existsSync(new URL(`${app}/src/axf/assets/run-indicator/${f}`, root)), `${app} ships run-indicator/${f} (node framework/cli/shared-assets.mjs bake)`);

/* ---- the stylesheet reads tokens only ---- */
const css = readFileSync(new URL('framework/ui/axf.css', root), 'utf8');
const block = css.slice(css.indexOf('/* run indicator (run-indicator@1'), css.indexOf('/* Banner settings dialog */'));
ok(block.includes('[data-fx-run-state=\'broke\']') && block.includes('@keyframes fx-run-flash') && block.includes('@keyframes fx-run-pulse') && block.includes('@keyframes fx-run-glow'), 'axf.css draws the states and the keyframes');
ok(!literal.test(block), 'axf.css run indicator block has no colour literal');
ok(!/\b\d+(\.\d+)?m?s\b/.test(block), 'axf.css run indicator block has no fixed duration (reads --fx-run-duration)');
ok(block.includes('prefers-reduced-motion') && block.includes("[data-fx-motion='reduced']"), 'axf.css stops the animations under reduced motion');

console.log(`✓ run-indicator: ${n} checks passed`);

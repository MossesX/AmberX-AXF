/**
 * design-package@1 + behavior-theme@1 (+ context-menu/amber): package rules (normalize, errors, capture, apply plan,
 * converting an old appearance package), behaviour rules (defaults, enums, ranges, compiled vars/attrs, reduced
 * motion, confirm-before-delete, vibration), the build engine's mirrored validator agrees, every starter and every
 * app's copy validates, and the console's Amber menu shows only its own items with the Plugins live list.
 *   npx -y tsx framework/spec/check-design-package.mts
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
import {
  DESIGN_THEMES, captureDesignPackage, designPackageErrors, designPackageSlots, fromAppearancePackage, isAppearanceSetting,
  normalizeDesignPackage, packageSettingsPlan, registerAppearanceSettingPrefix,
} from '../core/engines/designpackage';
import { BEHAVIOR_ENUMS, BEHAVIOR_RANGES, BEHAVIOR_SWITCHES, DEFAULT_BEHAVIOR, behaviorErrors, behaviorStyle, confirmBeforeDelete, normalizeBehavior, vibrationPattern } from '../core/engines/behavior';
import * as engine from '../cli/build-engine.mjs';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

/* ---- types ---- */
ok(ASSET_TYPES.includes('behavior-theme' as never) && ASSET_TYPES.includes('design-package' as never), 'both types registered');
ok(!ASSET_TYPES.includes('appearance-package' as never), 'appearance-package retired');
ok(OPTIONAL_TYPES.includes('behavior-theme' as never) && OPTIONAL_TYPES.includes('design-package' as never), 'both optional (older apps still validate)');
const spec = read('framework/schemas/asset-types.json');
const types = spec.types ?? spec;
eq(types['design-package'].required, [...DESIGN_THEMES], 'registry requires the four themes');
eq(types['behavior-theme'].required, ['motion', 'interaction', 'windows', 'feedback'], 'registry requires the four groups');
eq(engine.DESIGN_THEMES, [...DESIGN_THEMES], 'build engine knows the same four themes');
eq(engine.BEHAVIOR_ENUMS, BEHAVIOR_ENUMS, 'build engine mirrors the behaviour enums');
eq(engine.BEHAVIOR_RANGES, BEHAVIOR_RANGES, 'build engine mirrors the behaviour ranges');
eq(engine.BEHAVIOR_SWITCHES, [...BEHAVIOR_SWITCHES], 'build engine mirrors the behaviour switches');

/* ---- starters and every app's copies validate (core validator = build engine validator) ---- */
const dirs = ['framework/assets', ...['console-web', 'axhub-web', 'patches-web', 'amberx-droid', 'walkthrough-studio'].map((a) => `apps/${a}/src/assets`)];
let files = 0;
for (const base of dirs) for (const t of ['behavior-theme', 'design-package']) {
  const dir = new URL(`${base}/${t}/`, root);
  ok(existsSync(dir), `${base}/${t} exists`);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const a = read(`${base}/${t}/${f}`);
    eq(validateAsset(a).errors, [], `${base}/${t}/${f} validates`);
    eq(engine.validateAsset(a).errors, [], `${base}/${t}/${f} validates in the build engine`);
    if (t === 'design-package') for (const th of DESIGN_THEMES) ok(existsSync(new URL(`${base}/${th}/${a.data[th]}.json`, root)) || existsSync(new URL(`framework/assets/${th}/${a.data[th]}.json`, root)), `${base}/${t}/${f}: its ${th} ${a.data[th]} exists`);
    files++;
  }
  ok(!existsSync(new URL(`${base}/appearance-package/`, root)), `${base} has no appearance-package folder left`);
}
ok(files >= 30, `starters checked (${files})`);
eq(normalizeBehavior(read('framework/assets/behavior-theme/standard.json').data), DEFAULT_BEHAVIOR, 'standard = the framework default (nothing changes)');

/* ---- design package rules ---- */
const full = { 'style-theme': 's', 'color-theme': 'c', layout: 'l', 'behavior-theme': 'b' };
eq(designPackageErrors(full), [], 'four themes is a whole package');
eq(designPackageErrors({ ...full, layout: 'Bad Id' }), ['data.layout must be a layout asset id'], 'bad theme id');
eq(designPackageErrors({ 'style-theme': 's' }), ['data.color-theme must be a color-theme asset id', 'data.layout must be a layout asset id', 'data.behavior-theme must be a behavior-theme asset id'], 'missing themes');
eq(designPackageErrors({ ...full, extras: { slots: { 'uac-policy': 'x', layout: 'y', toolbar: 'ok' } } }), ['data.extras.slots.uac-policy: a package never sets uac-policy', "data.extras.slots.layout: layout is one of the package's own themes"], 'extras slot rules');
eq(designPackageErrors({ ...full, extras: { spacing: 'huge', settings: { other: 1 } } }), ['data.extras.spacing must be tight, compact or regular', 'data.extras.settings.other is not an appearance setting'], 'extras spacing + foreign setting');
eq(designPackageErrors({ ...full, extras: 3 }), ['data.extras must be an object'], 'extras must be an object');
eq(normalizeDesignPackage({ ...full, layout: 7, extras: { slots: { 'uac-policy': 'a', toolbar: 'b', 'color-theme': 'z' }, spacing: 'huge', settings: { other: 1, 'axf.roll.slot.x': false } } }),
  { 'style-theme': 's', 'color-theme': 'c', layout: '', 'behavior-theme': 'b', extras: { slots: { toolbar: 'b' }, settings: { 'axf.roll.slot.x': false } } }, 'normalize drops bad fields');
eq(designPackageSlots({ ...full, extras: { slots: { toolbar: 't', layout: 'x' } } }), { toolbar: 't', layout: 'l', 'style-theme': 's', 'color-theme': 'c', 'behavior-theme': 'b' }, 'apply slots: themes win');
eq(designPackageSlots({ ...full, layout: '' }), { 'style-theme': 's', 'color-theme': 'c', 'behavior-theme': 'b' }, 'empty theme skipped');
ok(isAppearanceSetting('axf.custom.button') && isAppearanceSetting('axf.banners.prefs') && isAppearanceSetting('axf.roll.slot.layout'), 'look keys count');
ok(!isAppearanceSetting('axf.appearance.spacing') && !isAppearanceSetting('axf.appearance.package') && !isAppearanceSetting('axf.appearance.design') && !isAppearanceSetting('app.secret'), 'spacing, the applied picks and other keys never do');
registerAppearanceSettingPrefix('mylib.look.');
ok(isAppearanceSetting('mylib.look.x'), 'prefix registry is open');
const env = { active: { 'color-theme': 'a', 'style-theme': 's', layout: 'l', 'behavior-theme': 'b', toolbar: 't', 'uac-policy': 'p', 'design-package': 'fresh' }, types: ['color-theme', 'style-theme', 'layout', 'behavior-theme', 'toolbar', 'uac-policy', 'design-package'], spacing: 'compact', hidden: { toolbar: true }, values: { 'axf.custom.button': { all: true }, other: 1, 'axf.appearance.spacing': 'compact', 'axf.roll.slot.x': null } };
const cap = captureDesignPackage(env);
eq(cap, { 'style-theme': 's', 'color-theme': 'a', layout: 'l', 'behavior-theme': 'b', extras: { slots: { toolbar: 't' }, spacing: 'compact', hidden: { toolbar: true }, settings: { 'axf.custom.button': { all: true } } } }, 'capture: four themes + the rest as extras');
eq(captureDesignPackage(env, false), { 'style-theme': 's', 'color-theme': 'a', layout: 'l', 'behavior-theme': 'b' }, 'capture themes only');
eq(designPackageErrors(cap), [], 'a captured package validates');
eq(packageSettingsPlan(cap, ['axf.custom.button', 'axf.roll.slot.x', 'other']), { set: { 'axf.custom.button': { all: true } }, clear: ['axf.roll.slot.x'] }, 'with extras: the whole look (clears the rest of the look only)');
eq(packageSettingsPlan(full, ['axf.custom.button']), { set: {}, clear: [] }, 'without extras: other settings untouched');
const old = { slots: { 'style-theme': 's', 'color-theme': 'c', layout: 'l', toolbar: 't', 'uac-policy': 'p' }, spacing: 'tight', hidden: { toolbar: false } };
eq(fromAppearancePackage(old), { 'style-theme': 's', 'color-theme': 'c', layout: 'l', 'behavior-theme': 'standard', extras: { slots: { toolbar: 't' }, spacing: 'tight', hidden: { toolbar: false } } }, 'old appearance package converts');

/* ---- behaviour rules ---- */
eq(normalizeBehavior(null), DEFAULT_BEHAVIOR, 'nothing = defaults');
eq(normalizeBehavior({ motion: { speed: 'warp', easing: 'spring' }, interaction: { longPressMs: 99999 }, windows: { snap: 'yes' } }).motion.speed, 'theme', 'bad enum falls back');
eq(normalizeBehavior({ interaction: { longPressMs: 99999 } }).interaction.longPressMs, 1500, 'range clamps');
eq(normalizeBehavior({ windows: { snap: 'yes' } }).windows.snap, false, 'bad switch falls back');
eq(behaviorErrors({ motion: { speed: 'warp' }, interaction: { longPressMs: 1 }, windows: { snap: 'yes' }, feedback: 2 }), [
  'data.feedback must be an object', 'data.motion.speed must be one of theme, instant, fast, normal, slow, relaxed',
  'data.interaction.longPressMs must be a number from 250 to 1500', 'data.windows.snap must be true or false'], 'behaviour errors');
eq(behaviorErrors({}), [], 'every field optional in the engine');
eq(engine.validateAsset({ $axf: 'asset@1', type: 'behavior-theme', id: 'xy', name: 'X', version: '1.0.0', data: { motion: { speed: 'warp' }, interaction: {}, windows: {}, feedback: {} } }).errors, ['data.motion.speed must be one of theme, instant, fast, normal, slow, relaxed'], 'build engine reports the same');
const std = behaviorStyle(DEFAULT_BEHAVIOR);
ok(!('--fx-motion' in std.vars), 'speed "theme" keeps the style theme motion');
eq(std.attrs['data-fx-motion'], 'theme', 'motion attr');
eq(std.vars['--fx-longpress-ms'], '550ms', 'long-press var (the old fixed 550 ms)');
eq(behaviorStyle({ motion: { speed: 'fast' } }).vars['--fx-motion'], '90ms', 'speed sets motion');
const reduced = behaviorStyle({ motion: { speed: 'slow', reduced: 'system' }, windows: { dialogOpen: 'scale' } }, true);
eq([reduced.vars['--fx-motion'], reduced.attrs['data-fx-motion'], reduced.attrs['data-fx-dialog-anim']], ['0ms', 'reduced', 'none'], 'system reduced motion wins');
ok(!('data-fx-backdrop' in std.attrs) && !('data-fx-toast-pos' in std.attrs) && !('data-fx-dialog-anim' in std.attrs), 'asset = the dialog / pop-up asset keeps its own attributes');
eq([behaviorStyle({ windows: { dialogOpen: 'slide-up', backdrop: 'blur' }, feedback: { toastPosition: 'top' } }).attrs['data-fx-dialog-anim'], behaviorStyle({ windows: { backdrop: 'blur' } }).attrs['data-fx-backdrop'], behaviorStyle({ feedback: { toastPosition: 'top' } }).attrs['data-fx-toast-pos']], ['slide', 'blur', 'top-center'], 'overrides map onto the asset attributes');
eq(behaviorStyle({ motion: { reduced: 'never' } }, true).attrs['data-fx-motion'], 'theme', 'never ignores the system');
eq([confirmBeforeDelete(DEFAULT_BEHAVIOR, false), confirmBeforeDelete(DEFAULT_BEHAVIOR, true), confirmBeforeDelete({ feedback: { confirmDelete: 'always' } }, true), confirmBeforeDelete({ feedback: { confirmDelete: 'never' } }, false)], [true, false, true, false], 'confirm before delete');
eq([vibrationPattern(DEFAULT_BEHAVIOR), vibrationPattern({ feedback: { vibration: 'light' } }), vibrationPattern({ feedback: { vibration: 'strong' } }, 'success')], [[], [12], [30, 40, 30]], 'vibration');
for (const id of ['standard', 'calm', 'snappy', 'minimal-motion', 'playful']) eq(behaviorErrors(read(`framework/assets/behavior-theme/${id}.json`).data), [], `starter ${id} ok`);
eq(behaviorStyle(read('framework/assets/behavior-theme/minimal-motion.json').data).attrs['data-fx-motion'], 'reduced', 'minimal-motion is reduced always');

/* ---- console Amber menu (carried over from check-appearance-package) ---- */
const amber = read('apps/console-web/src/assets/context-menu/amber.json').data;
const items = amber.targets.default as { id: string; provider?: string; spacer?: boolean; action?: string }[];
eq(validateAsset(read('apps/console-web/src/assets/context-menu/amber.json')).errors, [], 'amber validates');
eq(amber.contributions, false, 'amber shows only its own items');
eq(items[0]?.provider, 'amber.plugins', 'Plugins live list first');
eq(items.slice(-2).map((i) => i.spacer ?? i.action), [true, 'app.settings'], 'spacer then Settings at the bottom');
for (const a of ['ashes.toggle', 'terminal.new', 'claude-handoff.open', 'plugin-switches.open', 'edit.cut', 'edit.copy', 'edit.paste', 'swap:color-theme:next', 'swap:color-theme:prev']) ok(items.some((i) => i.action === a), `amber has ${a}`);
console.log(`check-design-package: ${n} checks passed`);

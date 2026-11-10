/**
 * behavior-theme@1 (+ context-menu/amber): behaviour rules (defaults, enums, ranges, compiled vars/attrs, reduced motion,
 * confirm-before-delete, vibration), the build engine's mirrored validator agrees, every starter and every app's copy
 * validates, the window manager follows the theme's `windows` group, and the console's Amber menu shows only its own
 * items with the Plugins live list. Was check-design-package.mts until design packages folded into skins (Nov 10 2026);
 * the look-settings rules that lived with the package engine are checked here too.
 *   npx -y tsx framework/spec/check-behavior-theme.mts
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
import { isAppearanceSetting, isRetiredLookSetting, registerAppearanceSettingPrefix } from '../core/engines/looksettings';
import { BEHAVIOR_ENUMS, BEHAVIOR_RANGES, BEHAVIOR_SWITCHES, DEFAULT_BEHAVIOR, behaviorErrors, behaviorStyle, confirmBeforeDelete, normalizeBehavior, vibrationPattern } from '../core/engines/behavior';
import * as engine from '../cli/build-engine.mjs';
import { DEFAULT_WINDOW_PLACEMENT, WindowManager, minimizeTargetFor, placeNewWindow, snapCoord } from '../core/engines/windows';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

/* ---- types ---- */
ok(ASSET_TYPES.includes('behavior-theme' as never), 'behavior-theme registered');
ok(!ASSET_TYPES.includes('appearance-package' as never) && !ASSET_TYPES.includes('design-package' as never) && !ASSET_TYPES.includes('style-package' as never), 'appearance, design and style packages retired (skins)');
ok(OPTIONAL_TYPES.includes('behavior-theme' as never), 'optional (older apps still validate)');
const spec = read('framework/schemas/asset-types.json');
const types = spec.types ?? spec;
eq(types['behavior-theme'].required, ['motion', 'interaction', 'windows', 'feedback'], 'registry requires the four groups');
eq(types['behavior-theme'].section, 'behavior', 'the behaviour theme is the skin\'s behaviour section');
ok(!('design-package' in types) && !('style-package' in types), 'the registry has no package types');
eq(engine.BEHAVIOR_ENUMS, BEHAVIOR_ENUMS, 'build engine mirrors the behaviour enums');
eq(engine.BEHAVIOR_RANGES, BEHAVIOR_RANGES, 'build engine mirrors the behaviour ranges');
eq(engine.BEHAVIOR_SWITCHES, [...BEHAVIOR_SWITCHES], 'build engine mirrors the behaviour switches');

/* ---- starters and every app's copies validate (core validator = build engine validator) ---- */
const appAssets = (a: string) => (['console-web', 'axhub-web', 'amberx-droid'].includes(a) ? `apps/${a}/src/axf/assets` : `apps/${a}/src/assets`); // shared set baked there (shared-assets.mjs)
const dirs = ['framework/assets', ...['console-web', 'axhub-web', 'amberx-droid', 'walkthrough-studio'].map(appAssets)];
let files = 0;
for (const base of dirs) for (const t of ['behavior-theme', 'skin']) {
  const dir = new URL(`${base}/${t}/`, root);
  if (base !== 'framework/assets' && t === 'skin' && !existsSync(dir)) continue; // an app without shared assets keeps no skins of its own
  ok(existsSync(dir), `${base}/${t} exists`);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const a = read(`${base}/${t}/${f}`);
    eq(validateAsset(a).errors, [], `${base}/${t}/${f} validates`);
    eq(engine.validateAsset(a).errors, [], `${base}/${t}/${f} validates in the build engine`);
    if (t === 'skin') for (const [field, th] of [['colorTheme', 'color-theme'], ['styleTheme', 'style-theme'], ['layoutTheme', 'layout'], ['behaviorTheme', 'behavior-theme']]) if (a.data[field]) ok(existsSync(new URL(`${base}/${th}/${a.data[field]}.json`, root)) || existsSync(new URL(`framework/assets/${th}/${a.data[field]}.json`, root)), `${base}/${t}/${f}: its ${th} ${a.data[field]} exists`);
    files++;
  }
  for (const gone of ['appearance-package', 'design-package', 'style-package']) ok(!existsSync(new URL(`${base}/${gone}/`, root)), `${base} has no ${gone} folder left`);
}
ok(files >= 30, `starters checked (${files})`);
eq(normalizeBehavior(read('framework/assets/behavior-theme/standard.json').data), DEFAULT_BEHAVIOR, 'standard = the framework default (nothing changes)');

/* ---- look settings (were the design package engine's rules) ---- */
ok(isAppearanceSetting('axf.custom.button') && isAppearanceSetting('axf.banners.prefs') && isAppearanceSetting('axf.roll.slot.layout'), 'look keys count');
ok(!isAppearanceSetting('axf.appearance.spacing') && !isAppearanceSetting('axf.appearance.package') && !isAppearanceSetting('axf.appearance.design') && !isAppearanceSetting('app.secret'), 'spacing, the retired package picks and other keys never do');
ok(isAppearanceSetting('axf.appearance.overrides') && isRetiredLookSetting('axf.appearance.overrides'), 'the retired overrides key still rides a document (so it is cleaned) but is never applied');
registerAppearanceSettingPrefix('mylib.look.');
ok(isAppearanceSetting('mylib.look.x'), 'prefix registry is open');
ok(isRetiredLookSetting('axf.look') && isRetiredLookSetting('axf.custom.button') && isRetiredLookSetting('axf.roll.slot.x') && isRetiredLookSetting('axf.appearance.design') && isRetiredLookSetting('axf.appearance.overrides'), 'Sliders, per-asset tokens, rolls and the design package keys are retired');
ok(!isRetiredLookSetting('axf.banners.look') && !isRetiredLookSetting('axf.banners.prefs') && !isRetiredLookSetting('axf.lookout'), 'plugin look settings are not');

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

/* ---- windows: the behaviour theme's `windows` group drives the window manager (Fable rebuild s5r4) ---- */
eq(DEFAULT_WINDOW_PLACEMENT, { stack: DEFAULT_BEHAVIOR.windows.stack, snap: DEFAULT_BEHAVIOR.windows.snap, snapGrid: DEFAULT_BEHAVIOR.windows.snapGrid, minimize: DEFAULT_BEHAVIOR.windows.minimize }, 'window placement defaults = the behaviour defaults');
const snapOn = { ...DEFAULT_WINDOW_PLACEMENT, snap: true, snapGrid: 8 };
eq([snapCoord(37, DEFAULT_WINDOW_PLACEMENT), snapCoord(37, snapOn), snapCoord(36, snapOn), snapCoord(37, { ...snapOn, snapGrid: 1 })], [37, 40, 40, 37], 'snap to grid only when on and the grid is > 1');
const size = { width: 300, height: 200 }; const vp = { width: 1000, height: 800 };
eq(placeNewWindow(DEFAULT_WINDOW_PLACEMENT, 0, size), { x: 24, y: 72 }, 'first window cascades from the origin (no viewport)');
eq(placeNewWindow(DEFAULT_WINDOW_PLACEMENT, 2, size), { x: 80, y: 128 }, 'third window two steps on');
eq(placeNewWindow({ ...DEFAULT_WINDOW_PLACEMENT, stack: 'center' }, 5, size, vp), { x: 350, y: 300 }, 'center ignores the index');
eq(placeNewWindow({ ...DEFAULT_WINDOW_PLACEMENT, stack: 'remember' }, 5, size, vp, { x: 410, y: 90 }), { x: 410, y: 90 }, 'remember reuses the last place');
eq(placeNewWindow({ ...DEFAULT_WINDOW_PLACEMENT, stack: 'remember' }, 1, size, vp, null), { x: 52, y: 100 }, 'remember with nothing remembered cascades');
eq(placeNewWindow({ ...snapOn, stack: 'center' }, 0, { width: 301, height: 201 }, vp), { x: 352, y: 296 }, 'centred then snapped (349.5/8 and 299.5/8 rounded)');
eq(placeNewWindow(DEFAULT_WINDOW_PLACEMENT, 0, { width: 2000, height: 2000 }, vp), { x: 0, y: 0 }, 'a window bigger than the viewport sits at the origin');
const far = placeNewWindow(DEFAULT_WINDOW_PLACEMENT, 40, size, vp);
ok(far.x + size.width <= vp.width && far.y + size.height <= vp.height, 'cascade wraps inside the viewport');
eq([minimizeTargetFor(DEFAULT_WINDOW_PLACEMENT, 'floating-toolbar'), minimizeTargetFor({ ...DEFAULT_WINDOW_PLACEMENT, minimize: 'dock' }, 'floating-toolbar'), minimizeTargetFor({ ...DEFAULT_WINDOW_PLACEMENT, minimize: 'none' }, 'corner-titlebar')], ['floating-toolbar', 'corner-titlebar', null], 'minimize target per rule');
{
  const wm = new WindowManager();
  wm.viewport = vp;
  wm.setPlacement({ stack: 'center', snap: true, snapGrid: 10 });
  const id = wm.openFloating([{ id: 't', title: 'T', kind: 'x' }], 'Win', 'floating', 301, 201);
  const w = wm.state.windows.find((x) => x.id === id)!;
  eq([w.x, w.y], [350, 300], 'openFloating places through the rules');
  wm.moveTo(id, 123, 77); wm.settle(id);
  const w2 = wm.state.windows.find((x) => x.id === id)!;
  eq([w2.x, w2.y], [120, 80], 'settle snaps a dragged window');
  wm.resize(id, 333, 222);
  eq([wm.state.windows.find((x) => x.id === id)!.width, wm.state.windows.find((x) => x.id === id)!.height], [330, 220], 'resize snaps too');
  wm.setPlacement({ stack: 'remember' });
  const id2 = wm.openFloating([{ id: 't2', title: 'T', kind: 'x' }], 'Win', 'floating', 301, 201);
  eq([wm.state.windows.find((x) => x.id === id2)!.x, wm.state.windows.find((x) => x.id === id2)!.y], [120, 80], 'remember: a window with the same title opens where the last one was left');
  wm.setPlacement({ minimize: 'none' });
  ok(!wm.canMinimize, 'minimize none = no minimizing');
  wm.minimize(id, 'floating-toolbar'); wm.minimizeToNextCorner(id);
  eq(wm.state.windows.find((x) => x.id === id)!.minimized, null, 'minimize requests are refused under none');
  wm.setPlacement({ minimize: 'dock' });
  wm.minimize(id, 'floating-toolbar', 5, 5);
  eq(wm.state.windows.find((x) => x.id === id)!.minimized, 'corner-titlebar', 'dock turns a cursor minimize into a corner title bar');
}

/* ---- console Amber menu (carried over from check-appearance-package) ---- */
const amber = read('apps/console-web/src/assets/context-menu/amber.json').data;
const items = amber.targets.default as { id: string; provider?: string; spacer?: boolean; action?: string }[];
eq(validateAsset(read('apps/console-web/src/assets/context-menu/amber.json')).errors, [], 'amber validates');
eq(amber.contributions, false, 'amber shows only its own items');
eq(items[0]?.provider, 'amber.plugins', 'Plugins live list first');
eq(items.slice(-2).map((i) => i.spacer ?? i.action), [true, 'app.settings'], 'spacer then Settings at the bottom');
for (const a of ['ashes.toggle', 'terminal.new', 'claude-handoff.open', 'plugin-switches.open', 'edit.cut', 'edit.copy', 'edit.paste', 'skin.next', 'skin.prev']) ok(items.some((i) => i.action === a), `amber has ${a}`);
ok(!items.some((i) => /^swap:(color-theme|style-theme|layout)|design\.package/.test(i.action ?? '')), 'amber steps skins, never a theme on its own');
console.log(`check-behavior-theme: ${n} checks passed`);

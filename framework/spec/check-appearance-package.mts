/**
 * appearance-package@1 + context-menu/amber: package rules (normalize, errors, capture, apply plan), the starters
 * validate, and the console's Amber menu shows only its own items with the Plugins live list.
 *   npx -y tsx framework/spec/check-appearance-package.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAsset } from '../core/validate';
import { capturePackage, isAppearanceSetting, normalizePackage, packageErrors, packageSettingsPlan, registerAppearanceSettingPrefix } from '../core/engines/appearancepackage';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const read = (p: string) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));

for (const p of ['framework/assets/appearance-package/amberx.json', 'apps/console-web/src/assets/appearance-package/amberx.json', 'apps/console-web/src/assets/context-menu/amber.json']) {
  eq(validateAsset(read(p)).errors, [], `${p} validates`);
}
ok(isAppearanceSetting('axf.custom.button') && isAppearanceSetting('axf.banners.prefs') && isAppearanceSetting('axf.roll.slot.layout'), 'look keys count');
ok(!isAppearanceSetting('axf.appearance.spacing') && !isAppearanceSetting('axf.appearance.package') && !isAppearanceSetting('app.secret'), 'spacing, the applied pick and other keys never do');
registerAppearanceSettingPrefix('mylib.look.');
ok(isAppearanceSetting('mylib.look.x'), 'prefix registry is open');
eq(packageErrors({ slots: { 'uac-policy': 'x' } }), ['data.slots.uac-policy: a package never sets uac-policy'], 'policy refused');
eq(packageErrors({ slots: {}, spacing: 'huge' }), ['data.spacing must be tight, compact or regular'], 'bad spacing');
eq(packageErrors({ slots: {}, settings: { other: 1 } }), ['data.settings.other is not an appearance setting'], 'foreign setting refused');
eq(normalizePackage({ slots: { 'uac-policy': 'a', layout: 'b', x: 3 }, spacing: 'huge', settings: { other: 1, 'axf.roll.slot.x': false } }), { slots: { layout: 'b' }, settings: { 'axf.roll.slot.x': false } }, 'normalize drops bad fields');
const cap = capturePackage({ active: { 'color-theme': 'a', 'uac-policy': 'p', 'appearance-package': 'amberx' }, types: ['color-theme', 'uac-policy', 'appearance-package'], spacing: 'compact', hidden: { toolbar: true }, values: { 'axf.custom.button': { all: true }, other: 1, 'axf.appearance.spacing': 'compact', 'axf.roll.slot.x': null } });
eq(cap, { slots: { 'color-theme': 'a' }, spacing: 'compact', hidden: { toolbar: true }, settings: { 'axf.custom.button': { all: true } } }, 'capture');
eq(packageSettingsPlan(cap, ['axf.custom.button', 'axf.roll.slot.x', 'other']), { set: { 'axf.custom.button': { all: true } }, clear: ['axf.roll.slot.x'] }, 'apply plan clears the rest of the look only');

const amber = read('apps/console-web/src/assets/context-menu/amber.json').data;
const items = amber.targets.default as { id: string; provider?: string; spacer?: boolean; action?: string }[];
eq(amber.contributions, false, 'amber shows only its own items');
eq(items[0]?.provider, 'amber.plugins', 'Plugins live list first');
eq(items.slice(-2).map((i) => i.spacer ?? i.action), [true, 'app.settings'], 'spacer then Settings at the bottom');
for (const a of ['ashes.toggle', 'terminal.new', 'claude-handoff.open', 'plugin-switches.open', 'edit.cut', 'edit.copy', 'edit.paste', 'swap:color-theme:next', 'swap:color-theme:prev']) ok(items.some((i) => i.action === a), `amber has ${a}`);
console.log(`check-appearance-package: ${n} checks passed`);

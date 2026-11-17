/**
 * toolbar-override@1 (core/engines/toolbar-override.ts; Brett, Nov 17 2026: every toolbar blank, one settings gear,
 * edited per toolbar): the per-toolbar switch `axf.toolbar.<id>.override` is off by default; off = the shared defaults
 * and not edited; on = editable; switching off resets that toolbar's own keys. Run: npx -y tsx framework/spec/check-toolbar-override.mts
 */
import assert from 'node:assert/strict';
import { TOOLBAR_OVERRIDE_CONTRACT, TOOLBAR_OVERRIDE_FIELD, isToolbarEdited, isToolbarOverrideOn, isToolbarOwnKey, resetToolbar, setToolbarOverride, toolbarGet, toolbarGetter, toolbarOverrideKey, toolbarOverrideList, toolbarOverrideState, toolbarOwnKeys } from '../core/engines/toolbar-override';
import { CHROME_INSTANCE_ASSET_KEY, CHROME_INSTANCE_INTERFACE_KEY, CHROME_INSTANCE_KEY } from '../core/engines/chrome-settings-rules.mjs';
import { TAP_KEYS, tapConfigFor } from '../core/engines/tapconfirm';

let n = 0;
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg); n++; };
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); n++; };
const getOf = (saved: Record<string, unknown>) => (k: string) => saved[k];

/* ---- the contract and the key ---- */
eq(TOOLBAR_OVERRIDE_CONTRACT, 'toolbar-override@1', 'contract');
eq(toolbarOverrideKey('main'), 'axf.toolbar.main.override', 'the switch key');
eq(toolbarOverrideKey('settings.main'), 'axf.toolbar.settings.main.override', 'a dotted toolbar id keeps its dots');
ok(TOOLBAR_OVERRIDE_FIELD === 'override' && `${TAP_KEYS.perToolbar}x.override` === toolbarOverrideKey('x'), 'the same per-toolbar prefix tapconfirm.ts uses');

/* ---- off by default ---- */
eq(isToolbarOverrideOn(getOf({}), 'main'), false, 'off when nothing is stored');
eq(isToolbarOverrideOn(getOf({ 'axf.toolbar.main.override': 'true' }), 'main'), false, 'only the boolean true switches it on');
eq(isToolbarOverrideOn(getOf({ 'axf.toolbar.main.override': 1 }), 'main'), false, 'a number is not on');
eq(isToolbarOverrideOn(getOf({ 'axf.toolbar.main.override': true }), 'main'), true, 'true is on');
eq(isToolbarOverrideOn(getOf({ 'axf.toolbar.Bad Id.override': true }), 'Bad Id'), false, 'an id outside the rules is never on');

/* ---- own keys ---- */
const main = 'main';
const stray = {
  [CHROME_INSTANCE_KEY('toolbar', main)]: { variant: 'labels', density: 'roomy' },
  [CHROME_INSTANCE_ASSET_KEY('toolbar', main)]: 'minimal-glass',
  [CHROME_INSTANCE_INTERFACE_KEY('toolbar', main)]: 'chrome-toolbar-molly',
  'axf.toolbar.main.tapConfirm': 'off',
  'axf.toolbar.main.someNewField': 7,
  'axf.toolbar.main.empty': '',
  'axf.toolbar.main.emptyObj': {},
  'axf.toolbar.main.nested.field': 'x',
  'axf.toolbar.collapsed': { main: true },
  'axf.toolbar.other.tapConfirm': 'on',
  [CHROME_INSTANCE_KEY('toolbar', 'other')]: { variant: 'icons' },
  [CHROME_INSTANCE_KEY('tab-group', main)]: { style: 'pills' },
  'axf.toolbars.tapConfirm': false,
};
eq(toolbarOwnKeys(stray, main), [CHROME_INSTANCE_KEY('toolbar', main), CHROME_INSTANCE_ASSET_KEY('toolbar', main), CHROME_INSTANCE_INTERFACE_KEY('toolbar', main), 'axf.toolbar.main.someNewField', 'axf.toolbar.main.tapConfirm'], 'own keys: the chrome instance override and picks, then every one-segment field that holds a value (new fields need no code)');
ok(isToolbarOwnKey(main, 'axf.toolbar.main.tapConfirm') && !isToolbarOwnKey(main, toolbarOverrideKey(main)), 'a field is own; the switch itself is not');
ok(!isToolbarOwnKey(main, 'axf.toolbar.main.nested.field'), 'a nested key is not a field of this toolbar');
ok(!isToolbarOwnKey(main, 'axf.toolbar.collapsed') && !isToolbarOwnKey('collapsed', 'axf.toolbar.collapsed'), 'the per-device fold map is nobody\'s own key');
ok(!isToolbarOwnKey(main, 'axf.toolbar.other.tapConfirm') && !isToolbarOwnKey(main, CHROME_INSTANCE_KEY('toolbar', 'other')), 'another toolbar\'s keys are not this one\'s');
ok(!isToolbarOwnKey(main, CHROME_INSTANCE_KEY('tab-group', main)) && !isToolbarOwnKey(main, 'axf.toolbars.tapConfirm'), 'a tab group\'s key and the all-toolbars switch are not a toolbar\'s own');
ok(!isToolbarOwnKey('settings', 'axf.toolbar.settings.main.tapConfirm') && isToolbarOwnKey('settings.main', 'axf.toolbar.settings.main.tapConfirm'), 'a dotted id matches exactly, never as a prefix of a longer id');
eq(toolbarOwnKeys(null, main), [], 'no settings: no keys');
eq(toolbarOwnKeys(stray, 'Bad Id'), [], 'a bad id: no keys');

/* ---- off = the shared defaults, not edited, whatever is stored ---- */
eq(isToolbarEdited(stray, main), false, 'stray own keys with the switch off: NOT edited');
eq(toolbarOverrideState(stray, main), { id: main, override: false, edited: false, keys: toolbarOwnKeys(stray, main) }, 'state while off: the keys are listed (what a reset would clear) but edited is false');
eq(toolbarGet(getOf(stray), main, 'axf.toolbar.main.tapConfirm'), undefined, 'a reader sees the default for an own key while off');
eq(toolbarGet(getOf(stray), main, CHROME_INSTANCE_KEY('toolbar', main)), undefined, 'the chrome instance override reads as the default while off');
eq(toolbarGet(getOf(stray), main, 'axf.toolbar.collapsed'), { main: true }, 'a key that is not the toolbar\'s own reads as stored');
eq(toolbarGet(getOf(stray), main, 'axf.toolbar.other.tapConfirm'), 'on', 'another toolbar\'s key reads as stored');
eq(toolbarGet(getOf(stray), main, toolbarOverrideKey(main)), undefined, 'the switch reads as stored (unset here)');
// tapconfirm through the wrapped getter: the toolbar's stored "off" is ignored while the switch is off
eq(tapConfigFor(toolbarGetter(getOf({ ...stray, 'axf.toolbars.tapConfirm': true }), main), 'toolbar', main).enabled, true, 'tap-to-confirm follows the all-toolbars switch, not the stray per-toolbar "off"');

/* ---- on = editable ---- */
const turnedOn = setToolbarOverride(stray, main, true);
eq(turnedOn.cleared, [], 'switching on clears nothing');
eq(turnedOn.saved, { ...stray, [toolbarOverrideKey(main)]: true }, 'switching on stores the switch and nothing else moves');
eq(turnedOn.state, { id: main, override: true, edited: true, keys: toolbarOwnKeys(stray, main) }, 'on with own keys: edited');
eq(isToolbarEdited(turnedOn.saved, main), true, 'isEdited: on + a value');
eq(toolbarGet(getOf(turnedOn.saved), main, 'axf.toolbar.main.tapConfirm'), 'off', 'a reader sees the own value while on');
eq(toolbarGet(getOf(turnedOn.saved), main, CHROME_INSTANCE_KEY('toolbar', main)), { variant: 'labels', density: 'roomy' }, 'the chrome instance override applies while on');
eq(tapConfigFor(toolbarGetter(getOf({ ...turnedOn.saved, 'axf.toolbars.tapConfirm': true }), main), 'toolbar', main).enabled, false, 'tap-to-confirm honours the per-toolbar "off" once the switch is on');
const onClean = setToolbarOverride({}, main, true);
eq(onClean.state, { id: main, override: true, edited: false, keys: [] }, 'on with no own key: editable but not edited');
eq(isToolbarEdited(onClean.saved, main), false, 'isEdited: on but nothing set = not edited');

/* ---- off again = reset to the defaults ---- */
const turnedOff = setToolbarOverride(turnedOn.saved, main, false);
eq([...turnedOff.cleared].sort(), [toolbarOverrideKey(main), ...toolbarOwnKeys(stray, main), 'axf.toolbar.main.empty', 'axf.toolbar.main.emptyObj'].sort(), 'switching off clears the switch and every own key, empty ones included');
eq(turnedOff.saved, { 'axf.toolbar.main.nested.field': 'x', 'axf.toolbar.collapsed': { main: true }, 'axf.toolbar.other.tapConfirm': 'on', [CHROME_INSTANCE_KEY('toolbar', 'other')]: { variant: 'icons' }, [CHROME_INSTANCE_KEY('tab-group', main)]: { style: 'pills' }, 'axf.toolbars.tapConfirm': false }, 'everything that is not this toolbar\'s own stays: the fold map, other toolbars, tab groups, the all-toolbars switch');
eq(turnedOff.state, { id: main, override: false, edited: false, keys: [] }, 'state after the reset: off, not edited, no keys');
eq(resetToolbar(turnedOn.saved, main), turnedOff, 'resetToolbar is switching off');
eq(setToolbarOverride(turnedOff.saved, main, false), { saved: turnedOff.saved, cleared: [], state: turnedOff.state }, 'switching off twice is safe');
eq(setToolbarOverride(stray, 'Bad Id', false), { saved: stray, cleared: [], state: { id: 'Bad Id', override: false, edited: false, keys: [] } }, 'a bad id changes nothing');
eq(setToolbarOverride(undefined, main, true).saved, { [toolbarOverrideKey(main)]: true }, 'no settings yet: just the switch');
ok(turnedOn.saved !== stray && turnedOff.saved !== turnedOn.saved && !(toolbarOverrideKey(main) in stray), 'pure: the input maps are never mutated');

/* ---- the list ---- */
eq(toolbarOverrideList({ ...stray, 'axf.toolbar.other.override': true }), [
  { id: main, override: false, edited: false, keys: toolbarOwnKeys(stray, main) },
  // ids may carry dots, so `axf.toolbar.main.nested.field` reads as toolbar `main.nested`, field `field` (the last segment is always the field)
  { id: 'main.nested', override: false, edited: false, keys: ['axf.toolbar.main.nested.field'] },
  { id: 'other', override: true, edited: true, keys: [CHROME_INSTANCE_KEY('toolbar', 'other'), 'axf.toolbar.other.tapConfirm'] },
], 'every toolbar with a switch or own keys, by id, with its state');
eq(toolbarOverrideList({ 'axf.toolbar.collapsed': { main: true }, 'axf.toolbars.tapConfirm': false, [CHROME_INSTANCE_KEY('tab-group', 'x')]: { style: 'pills' } }), [], 'the fold map, the all-toolbars switch and tab groups list no toolbar');
eq(toolbarOverrideList({ 'axf.toolbar.gone.override': false }), [], 'a switch stored as false with no own key is not listed');
eq(toolbarOverrideList({ [CHROME_INSTANCE_ASSET_KEY('toolbar', 'settings.main')]: 'touch-dock' }), [{ id: 'settings.main', override: false, edited: false, keys: [CHROME_INSTANCE_ASSET_KEY('toolbar', 'settings.main')] }], 'a dotted id is found from its chrome pick key');
eq(toolbarOverrideList(null), [], 'no settings: empty');

console.log(`✓ toolbar-override@1: ${n} checks`);

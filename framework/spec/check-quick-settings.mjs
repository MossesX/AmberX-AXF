#!/usr/bin/env node
/** quick-settings@1 engine: scopes, keys, asset overrides, the notice and the quick.* action grammar. */
import assert from 'node:assert/strict';
import {
  QUICK_ACTIONS, isQuickScope, normalizeQuickAssets, parseQuickAction, quickAssetTypes, quickAssetsKey, quickCollapsedKey, quickHandleOf,
  quickKindOf, quickNotice, quickOverrides, quickScopeId, quickSkinScopeKey, quickSkinUiId, setQuickAsset,
} from '../core/engines/quick-settings.mjs';
import { isSubScopeKey } from '../core/engines/skin-coverage.mjs';
import { checkQuickSettings } from '../cli/check-quick-settings.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; };

t('scope ids', () => {
  assert.equal(quickScopeId('chrome.tab-group.Settings Tabs'), 'chrome.tab-group.settings-tabs');
  assert.equal(quickScopeId('  '), '');
  assert.equal(quickScopeId(42), '');
  assert.ok(isQuickScope('plugin.notes'));
  assert.ok(!isQuickScope('Plugin Notes'));
});

t('kinds and asset types (navigation menu first on console Settings)', () => {
  assert.equal(quickKindOf('settings'), 'settings');
  assert.equal(quickKindOf('plugin.notes'), 'plugin');
  assert.equal(quickKindOf('chrome.toolbar.app'), 'chrome');
  assert.equal(quickKindOf('window.main'), 'settings');
  assert.deepEqual(quickAssetTypes('settings'), ['nav-menu', 'toolbar', 'tab-group', 'settings']);
  assert.ok(!quickAssetTypes('chrome.toolbar.app').includes('nav-menu'));
});

t('keys: collapsed + assets per interface, skin level is a skin-coverage UI scope', () => {
  assert.equal(quickCollapsedKey('settings'), 'axf.quick.settings.collapsed');
  assert.equal(quickAssetsKey('plugin.notes'), 'axf.quick.plugin.notes.assets');
  assert.ok(isSubScopeKey(quickSkinScopeKey('chrome.tab-group.settings.tabs')));
  assert.equal(quickSkinScopeKey('settings'), `ui:${quickSkinUiId('settings')}`);
});

t('handle style falls back to arrow', () => {
  assert.equal(quickHandleOf('bar'), 'bar');
  assert.equal(quickHandleOf('zig'), 'arrow');
});

t('asset override map', () => {
  assert.deepEqual(normalizeQuickAssets({ 'nav-menu': 'rail', bogus: 'x', toolbar: 3 }, 'settings'), { 'nav-menu': 'rail' });
  assert.deepEqual(normalizeQuickAssets({ 'nav-menu': 'rail' }, 'chrome.toolbar.app'), {});
  assert.deepEqual(setQuickAsset({}, 'settings', 'tab-group', 'pills'), { 'tab-group': 'pills' });
  assert.deepEqual(setQuickAsset({ 'tab-group': 'pills' }, 'settings', 'tab-group', 'off'), {});
  assert.deepEqual(setQuickAsset({}, 'settings', 'banner', 'x'), {});
});

t('override list + notice', () => {
  assert.equal(quickNotice(quickOverrides({})), '');
  assert.equal(quickNotice(quickOverrides({ skin: 'windows' })), 'This is overriding the current skin.');
  assert.equal(quickNotice(quickOverrides({ assets: { toolbar: 'x' } })), 'This is overriding the current defaults.');
  const both = quickOverrides({ skin: 'windows', assets: { 'nav-menu': 'rail' } });
  assert.deepEqual(both, [{ kind: 'skin', id: 'windows' }, { kind: 'asset', type: 'nav-menu', id: 'rail' }]);
  assert.equal(quickNotice(both), 'This is overriding the current skin and defaults.');
});

t('action grammar', () => {
  assert.equal(QUICK_ACTIONS.length, 7);
  assert.deepEqual(parseQuickAction('quick.collapse', ['settings']), { op: 'collapse', scope: 'settings', value: 'toggle' });
  assert.deepEqual(parseQuickAction('quick.collapse', ['settings', 'on']), { op: 'collapse', scope: 'settings', value: 'on' });
  assert.deepEqual(parseQuickAction('quick.skin', ['plugin.notes', 'windows']), { op: 'skin', scope: 'plugin.notes', skin: 'windows' });
  assert.deepEqual(parseQuickAction('quick.skin', ['plugin.notes', 'off']), { op: 'skin', scope: 'plugin.notes', skin: null });
  assert.deepEqual(parseQuickAction('quick.asset', ['settings', 'nav-menu', 'rail']), { op: 'asset', scope: 'settings', type: 'nav-menu', id: 'rail' });
  assert.deepEqual(parseQuickAction('quick.asset', ['settings', 'nav-menu', 'off']), { op: 'asset', scope: 'settings', type: 'nav-menu', id: null });
  assert.ok('error' in parseQuickAction('quick.asset', ['chrome.toolbar.app', 'nav-menu', 'rail']));
  assert.ok('error' in parseQuickAction('quick.skin', ['Bad Scope', 'x']));
  assert.deepEqual(parseQuickAction('quick.handle', ['bar']), { op: 'handle', handle: 'bar' });
  assert.ok('error' in parseQuickAction('quick.handle', ['zig']));
  assert.deepEqual(parseQuickAction('quick.state', []), { op: 'state', scope: '' });
  assert.deepEqual(parseQuickAction('quick.open', ['chrome.nav-menu.app']), { op: 'open', scope: 'chrome.nav-menu.app' });
  assert.deepEqual(parseQuickAction('quick.reset', ['settings']), { op: 'reset', scope: 'settings' });
});

t('every settings interface in the repo draws the pane (check-quick-settings)', () => {
  const r = checkQuickSettings();
  assert.ok(r.ok, JSON.stringify(r.problems));
  assert.ok(r.interfaces >= 6);
});

console.log(`✓ quick-settings@1 — ${n} checks`);

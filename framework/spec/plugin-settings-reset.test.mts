/**
 * Engine tests for plugin-settings@1 and settings-reset@1, and the console routing that makes a plugin's Settings open
 * its own window (build separate-settings-per-plugin-reset). The fixtures are replayed by check-plugin-settings.mts and
 * check-settings-reset.mts; these are the behaviours the UI and the API lean on, case by case.
 *
 *   npx -y tsx framework/spec/plugin-settings-reset.test.mts
 *
 * The live press (gear → window, never console Settings) is apps/console-web/scripts/plugin-gear.e2e.mjs (Playwright).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatedPluginSettings, parseSettingsOwner, pluginSettingsErrors, pluginSettingsId, resolveSettingsInterface, settingsInterfaceIsOwn } from '../core/engines/plugin-settings';
import { applyResetToLook, changedAssets, keyOwner, parseResetScope, planSettingsReset, resetRequestErrors, type ResetState } from '../core/engines/settings-reset';
import { SETTINGS_PLUGIN_DIALOG, SETTINGS_TAB_DIALOG, settingsOpenRoute } from '../core/engines/settingsopen';
import type { SettingsGroup, SettingsTab } from '../core/settings';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; void name; };

const tabs: SettingsTab[] = [
  { id: 'appearance', label: 'Appearance', icon: 'palette', order: 10 },
  { id: 'plugins', label: 'Plugins', icon: 'package', order: 40 },
  { id: 'gate', label: 'Gate', icon: 'shield', order: 1, parent: 'plugins', plugin: 'ai.x.gate' },
  { id: 'gate.more', label: 'More', icon: 'shield', order: 2, parent: 'gate' },
  { id: 'skins', label: 'Skins', icon: 'palette', order: 3, parent: 'plugins', plugin: 'ai.x.skins' },
];
const groups: SettingsGroup[] = [
  { id: 'axf.display', label: 'Display', tab: 'appearance', settings: [{ key: 'axf.display.fontScale', label: 'Text size', kind: 'slider', default: 100 }] },
  { id: 'gate.main', label: 'Gate', tab: 'gate', settings: [{ key: 'gate.mode', label: 'Mode', kind: 'choice', default: 'normal' }] },
  { id: 'gate.extra', label: 'Extra', tab: 'gate.more', settings: [{ key: 'gate.extra', label: 'Extra', kind: 'toggle', default: false }] },
  { id: 'skins.main', label: 'Skins', tab: 'skins', settings: [{ key: 'skins.grid', label: 'Grid', kind: 'toggle', default: true }] },
];

test('a plugin resolves to its own asset when it has one, else a generated default; never the app pick', () => {
  const own = { id: pluginSettingsId('ai.x.gate'), data: { scope: 'plugin', owner: 'ai.x.gate', layout: 'tabs-top' } };
  const app = { id: 'console', data: { scope: 'app', layout: 'list' } };
  const r = resolveSettingsInterface({ kind: 'plugin', id: 'ai.x.gate' }, { assets: [app, own], appPick: 'console', tabs, groups });
  assert.equal(r.source, 'asset'); assert.equal(r.id, own.id); assert.equal(r.ui.layout, 'tabs-top'); assert.ok(settingsInterfaceIsOwn(r));
  const g = resolveSettingsInterface({ kind: 'plugin', id: 'ai.x.skins' }, { assets: [app, own], appPick: 'console', tabs, groups });
  assert.equal(g.source, 'generated'); assert.equal(g.ui.owner, 'ai.x.skins'); assert.notEqual(g.id, 'console'); assert.ok(settingsInterfaceIsOwn(g));
  assert.deepEqual(g.ui.tabs.map((t) => t.id), ['skins']);
  const a = resolveSettingsInterface({ kind: 'app' }, { assets: [app, own], appPick: 'console', tabs, groups });
  assert.equal(a.id, 'console'); assert.equal(a.ui.scope, 'app');
});

test("the generated default holds only the plugin's tabs and keys, at Basic, level toolbar on", () => {
  const d = generatedPluginSettings('ai.x.gate', tabs, groups) as { tabs: { id: string }[]; levelOf: Record<string, string>; levels: boolean };
  assert.deepEqual(d.tabs.map((t) => t.id), ['gate', 'gate.more']);
  assert.ok(d.levels);
  assert.ok('gate.mode' in d.levelOf && 'gate.extra' in d.levelOf);
  assert.ok(!('skins.grid' in d.levelOf) && !('axf.display.fontScale' in d.levelOf), "never another owner's keys");
});

test('owners and scopes parse the same way people and the API say them', () => {
  assert.deepEqual(parseSettingsOwner('console'), { kind: 'app' });
  assert.deepEqual(parseSettingsOwner('plugin:ai.x.gate'), { kind: 'plugin', id: 'ai.x.gate' });
  assert.deepEqual(parseResetScope('ai.x.gate'), { kind: 'plugin', id: 'ai.x.gate' });
  assert.equal(parseResetScope('bad scope!'), null);
  assert.deepEqual(resetRequestErrors({ scope: 'console', includeAssets: 'yes' }), ['includeAssets must be true or false']);
});

test('a plugin settings tab opens its own window; app tabs open the settings tab dialog', () => {
  const r = settingsOpenRoute({ tab: 'gate', plugin: 'ai.x.gate', view: 'home' });
  assert.equal(r.via, 'dialog'); assert.equal(r.via === 'dialog' && r.dialog, SETTINGS_PLUGIN_DIALOG); assert.equal(r.via === 'dialog' && r.plugin, 'ai.x.gate');
  const onSettings = settingsOpenRoute({ tab: 'gate', plugin: 'ai.x.gate', view: 'settings' });
  assert.equal(onSettings.via, 'dialog', "even on the Settings view a plugin's tab opens its own window");
  const app = settingsOpenRoute({ tab: 'appearance', view: 'home' });
  assert.equal(app.via === 'dialog' && app.dialog, SETTINGS_TAB_DIALOG);
});

const state = (): ResetState => ({
  values: { 'axf.display.fontScale': 120, 'gate.mode': 'strict', 'gate.extra': true, 'skins.grid': false, 'axf.plugin.ai.x.gate.look': '{}', 'axf.hide.toolbar': true },
  tabs, groups,
  look: { default: { slots: { 'color-theme': 'dark' } }, own: { slots: { 'color-theme': 'light' } }, skin: { use: false }, scopes: { 'plugin:ai.x.gate': { use: 'on', id: 'neon' }, 'ui:builds': { use: 'off' } } },
});

test("a plugin's reset clears only its keys; the switch off keeps every asset", () => {
  const p = planSettingsReset({ kind: 'plugin', id: 'ai.x.gate' }, false, state());
  assert.deepEqual(p.settings.map((r) => r.key), ['gate.extra', 'gate.mode']);
  assert.deepEqual(p.apply.clear, ['gate.extra', 'gate.mode']);
  assert.equal(p.apply.look, null);
  assert.ok(p.assets.length > 0 && p.assets.every((r) => r.scope === 'plugin:ai.x.gate'), 'its assets are listed (kept) in its scope only');
  assert.match(p.summary, /kept/);
});

test("with the switch on a plugin's reset also drops only its look and its skin scope", () => {
  const p = planSettingsReset({ kind: 'plugin', id: 'ai.x.gate' }, true, state());
  assert.ok(p.apply.clear.includes('axf.plugin.ai.x.gate.look') && !p.apply.clear.includes('axf.hide.toolbar'));
  assert.equal(p.apply.look, 'drop-scope'); assert.deepEqual(p.apply.scopes, ['plugin:ai.x.gate']);
  const look = applyResetToLook(state().look as never, p, '2026-11-17T00:00:00Z') as { scopes: Record<string, unknown>; undo: { scope: string } };
  assert.ok(!('plugin:ai.x.gate' in look.scopes) && 'ui:builds' in look.scopes); assert.equal(look.undo.scope, 'plugin:ai.x.gate');
});

test("the console's reset never touches a plugin's keys or scopes", () => {
  const p = planSettingsReset({ kind: 'console' }, true, state());
  assert.deepEqual(p.settings.map((r) => r.key), ['axf.display.fontScale']);
  assert.ok(!p.apply.clear.some((k) => k.startsWith('gate.') || k.startsWith('skins.') || k.includes('ai.x.gate')));
  assert.equal(p.apply.look, 'restore'); assert.deepEqual(p.apply.scopes, ['ui:builds']);
  assert.equal(keyOwner('skins.grid', state()), 'ai.x.skins');
  assert.ok(changedAssets(state()).some((r) => r.kind === 'slot' && r.scope === 'console'));
});

test('an empty plan says so (the dialog disables Reset)', () => {
  const p = planSettingsReset({ kind: 'plugin', id: 'ai.x.skins' }, false, { values: {}, tabs, groups, look: null });
  assert.ok(p.empty); assert.equal(p.summary, 'Nothing to reset');
});

test('the console routes every plugin settings opener to its own window', () => {
  const src = (f: string) => readFileSync(join(ROOT, f), 'utf8');
  const gear = src('apps/console-web/src/PluginSettingsGear.tsx');
  assert.match(gear, /plugin\.settings\.open:\$\{folder\}/, 'the gear opens plugin.settings.open:<folder>');
  assert.doesNotMatch(gear, /dispatch\(`settings\.open:\$\{tab\}`\)/, 'the gear never opens Settings → Plugins → <tab>');
  const actions = src('apps/console-web/src/pluginSettingsActions.ts');
  assert.match(actions, /settings\.plugin:\$\{p\.manifest\.id\}/, 'plugin.settings.open opens settings.plugin:<id>');
  assert.doesNotMatch(actions, /settings\.open:\$\{tab\}/);
  const lib = src('framework/libs/settings/index.tsx');
  assert.match(lib, /pluginOfSettingsTab\(rt, tab\)/, 'settings.open:<plugin tab> asks which plugin the tab is');
  assert.match(lib, /!pluginOfSettingsTab\(rt, t\.id\)/, "the app's Settings never renders a plugin's tab");
});

console.log(`✓ plugin-settings + settings-reset — ${n} tests (resolver, generated default, scopes, open route, reset plans, console routing)`);

/**
 * plugin-settings@1 (core/engines/plugin-settings.ts, spec/PLUGIN-SETTINGS.md): replays spec/fixtures/plugin-settings.json
 * (the Kotlin twin replays the same file), then holds the framework's own settings starters to the contract: every
 * plugin-* asset is a plugin interface with the right owner and id, the console's pick is an app interface, and no
 * plugin page ever resolves to the console's interface. `npx -y tsx framework/spec/check-plugin-settings.mts`.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATED_LEVEL, PLUGIN_SETTINGS_CONTRACT, PLUGIN_SETTINGS_PREFIX, SETTINGS_INTERFACE_KEY, generatedPluginSettings, isPluginSettingsAsset, parseSettingsOwner, pluginSettingsErrors, pluginSettingsGroups, pluginSettingsId, pluginSettingsTabs, pluginSlug, resolveSettingsInterface, settingsInterfaceId, settingsInterfaceIsOwn, settingsOwnerKey, settingsOwnerOf } from '../core/engines/plugin-settings';
import { validateAsset } from '../core/validate';

const root = new URL('..', import.meta.url).pathname;
const f = JSON.parse(readFileSync(join(root, 'spec/fixtures/plugin-settings.json'), 'utf8'));
let checks = 0;
const norm = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const eq = (a: unknown, b: unknown, what: string) => { assert.deepEqual(norm(a), norm(b), what); checks++; };

/* ---------- 1. fixture replay ---------- */
eq(PLUGIN_SETTINGS_CONTRACT, f.contract, 'contract');
eq(PLUGIN_SETTINGS_PREFIX, f.prefix, 'prefix');
eq(SETTINGS_INTERFACE_KEY, f.interfaceKey, 'interface key');
eq(GENERATED_LEVEL, f.generatedLevel, 'generated level');
for (const c of f.ids) { eq(pluginSlug(c.pluginId), c.slug, `slug ${c.pluginId}`); eq(pluginSettingsId(c.pluginId), c.assetId, `asset id ${c.pluginId}`); }
for (const c of f.owners) {
  const o = parseSettingsOwner(c.input);
  eq(o, c.owner, `owner ${JSON.stringify(c.input)}`);
  eq(o ? settingsOwnerKey(o) : null, c.key, `owner key ${JSON.stringify(c.input)}`);
  eq(o ? settingsInterfaceId(o, 'console') : null, c.interfaceId, `interface id ${JSON.stringify(c.input)}`);
}
assert.ok(f.resolve.some((c: { name: string }) => c.name.startsWith('plugin with no asset')), 'fixture has the generated case'); checks++;
for (const c of f.tabs) {
  // the plugin's tabs and groups are the generated interface's levelOf keys
  const g = f.generated[c.pluginId] ?? generatedPluginSettings(c.pluginId, [], []);
  for (const t of c.tabs) { assert.ok(t in g.levelOf, `tab ${t} of ${c.pluginId} is in its generated levelOf`); checks++; }
  for (const gid of c.groups) { assert.ok(gid in g.levelOf, `group ${gid} of ${c.pluginId} is in its generated levelOf`); checks++; }
}
eq(generatedPluginSettings('none', [], []), f.generated.none, 'generated: nothing registered');
for (const c of f.resolve) {
  eq(settingsInterfaceIsOwn(c.result), c.own, `own ${c.name}`);
  if (c.owner.kind === 'plugin') {
    assert.equal(c.result.ui.scope, 'plugin', `${c.name}: a plugin page never renders through a non-plugin interface`); checks++;
    assert.equal(c.result.ui.owner, c.owner.id, `${c.name}: a plugin page renders through its own owner's interface`); checks++;
    assert.equal(c.result.id, pluginSettingsId(c.owner.id), `${c.name}: id is plugin-<slug>`); checks++;
    assert.notEqual(c.result.id, c.appPick, `${c.name}: never the app pick`); checks++;
  } else {
    assert.equal(c.result.ui.scope, 'app', `${c.name}: an app page never renders through a plugin or chrome interface`); checks++;
    assert.ok(!c.result.id.startsWith(PLUGIN_SETTINGS_PREFIX), `${c.name}: an app page never gets a plugin-* id`); checks++;
  }
  assert.ok(c.own, `${c.name}: every page resolves to its own interface`); checks++;
}
assert.ok(f.errors.all.length >= 3, 'errors: the rogue, orphan and reserved-id assets are reported'); checks++;
assert.ok(f.errors.badPick.some((e: string) => e.includes('scope app')), 'errors: a plugin interface as the app pick is reported'); checks++;
eq(f.errors.clean, [], 'errors: clean set');
assert.ok(f.errors.twoForOne.some((e: string) => e.includes('one per plugin')), 'errors: two interfaces for one plugin'); checks++;

/* ---------- 2. resolution replay with the fixture's inputs ---------- */
{
  const base = { layout: 'list', header: 'compact', search: true, descriptions: true, levels: true, defaultLevel: 'basic' };
  const own = { id: 'plugin-molly-guide', data: { ...base, scope: 'plugin', owner: 'molly-guide' } };
  const console_ = { id: 'console', data: { ...base, scope: 'app' } };
  const r = resolveSettingsInterface({ kind: 'plugin', id: 'molly-guide' }, { assets: [console_, own], appPick: 'console' });
  eq([r.id, r.source, r.ui.owner], ['plugin-molly-guide', 'asset', 'molly-guide'], 'own asset wins');
  const g = resolveSettingsInterface({ kind: 'plugin', id: 'other' }, { assets: [console_, own], appPick: 'console', tabs: [{ id: 'other', label: 'Other', icon: 'x', order: 1, parent: 'plugins', plugin: 'other' }], groups: [{ id: 'other.g', label: 'G', tab: 'other', settings: [{ key: 'other.k', label: 'K', kind: 'toggle' }] }] });
  eq([g.id, g.source, g.ui.owner, g.ui.levels, g.ui.levelOf], ['plugin-other', 'generated', 'other', true, { other: 'basic', 'other.g': 'basic', 'other.k': 'basic' }], 'generated from tabs and keys, level toolbar on');
  eq(pluginSettingsTabs('other', [{ id: 'other', label: 'Other', icon: 'x', order: 1, parent: 'plugins' }]).map((t) => t.id), ['other'], 'a tab with the plugin id counts as its own');
  eq(pluginSettingsGroups('other', [], []), [], 'no tabs = no groups');
  const a = resolveSettingsInterface({ kind: 'app' }, { assets: [console_, own], appPick: 'plugin-molly-guide' });
  eq([a.id, a.source, a.ui.scope], ['standard', 'default', 'app'], 'the app never uses a plugin interface');
  eq(isPluginSettingsAsset(own, 'molly-guide'), true, 'is own');
  eq(isPluginSettingsAsset(own, 'other'), false, 'not own');
  eq(settingsOwnerOf({ for: 'toolbar', layout: 'list' }), { kind: 'chrome', for: 'toolbar' }, 'chrome owner');
  eq(settingsOwnerOf({ scope: 'plugin' }), null, 'plugin interface with no owner belongs to nobody');
}

/* ---------- 3. the framework's starters ---------- */
const starters = readdirSync(join(root, 'assets/settings')).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets/settings', n), 'utf8')));
for (const a of starters) { const v = validateAsset(a); assert.ok(v.ok, `settings/${a.id}: ${v.errors.join('; ')}`); checks++; }
eq(pluginSettingsErrors(starters, 'console'), [], 'starters: no plugin-settings@1 errors');
const consoleAsset = starters.find((a) => a.id === 'console');
assert.ok(consoleAsset && settingsOwnerOf(consoleAsset.data)?.kind === 'app', 'settings/console is an app interface'); checks++;
for (const a of starters) {
  const o = settingsOwnerOf(a.data);
  if (a.id.startsWith('chrome-')) { assert.equal(o?.kind, 'chrome', `settings/${a.id} is a chrome interface`); checks++; }
}
// no plugin page ever lands on the console's interface, whatever the starters hold
for (const id of ['molly-guide', 'feature-matrix', 'wake-listener', 'build-orchestrator']) {
  const r = resolveSettingsInterface({ kind: 'plugin', id }, { assets: starters, appPick: 'console' });
  assert.notEqual(r.id, 'console', `plugin ${id} never renders through settings/console`); checks++;
  assert.ok(settingsInterfaceIsOwn(r), `plugin ${id} renders through its own interface`); checks++;
}

console.log(`check-plugin-settings: ${checks} checks passed`);

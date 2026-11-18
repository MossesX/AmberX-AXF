#!/usr/bin/env node
/**
 * settings-iface@1 (core/engines/settings-iface-rules.mjs; build settings-iface-default-all, Nov 18 2026): replays
 * spec/fixtures/settings-iface.json through the reference rules (the Kotlin twin is deferred, spec/PORTING.md) and
 * checks the repo (framework/cli/settings-iface.mjs check): every asset type and console plugin ships its default,
 * every settings asset carries a valid builtFor, asset-types.json requires it.
 *   node framework/spec/check-settings-iface.mjs           check
 *   node framework/spec/check-settings-iface.mjs --write   regenerate the fixture's expected outputs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as si from '../core/engines/settings-iface-rules.mjs';
import { check as repoCheck } from '../cli/settings-iface.mjs';

const root = new URL('../', import.meta.url).pathname;
const FIXTURE = join(root, 'spec/fixtures/settings-iface.json');
const TYPES = ['toolbar', 'settings', 'banner', 'tab-group'];
const ASSETS = [
  { id: 'default-toolbar', name: 'Toolbar settings (default)', data: { builtFor: 'asset:toolbar' } },
  { id: 'toolbar-compact', name: 'Compact', data: { builtFor: 'asset:toolbar' } },
  { id: 'toolbar-big', name: 'Big', data: { builtFor: 'asset:toolbar' } },
  { id: 'default-sample-notes', name: 'Sample notes settings (default)', data: { builtFor: 'plugin:sample-notes' } },
  { id: 'sample-notes-rows', name: 'Rows', data: { builtFor: 'plugin:sample-notes' } },
  { id: 'sample-rules-cards', name: 'Cards', data: { builtFor: 'plugin:sample-rules' } },
  { id: 'default-settings-plugin', name: 'Settings plugin (default)', data: { builtFor: 'plugin:settings' } },
  { id: 'chrome-toolbar', name: 'Toolbar dialog', data: { for: 'toolbar' } },
  { id: 'standard', name: 'Standard', data: {} },
];

function compute() {
  const owners = ['asset:toolbar', 'plugin:sample-notes', 'plugin:sample-rules', 'plugin:settings', 'asset:settings', 'chrome:toolbar', 'app', 'plugin:nope'];
  return {
    contract: si.SETTINGS_IFACE_CONTRACT,
    kinds: si.SETTINGS_IFACE_KINDS,
    parse: Object.fromEntries(['app', 'asset:toolbar', 'plugin:sample-notes', 'chrome:tab-group', 'plugin:', 'nope:x', 'asset:Bad Name', 'plugin:a:b', ''].map((v) => [v || '(empty)', si.parseBuiltFor(v)])),
    errors: Object.fromEntries([['missing', undefined], ['ok', 'plugin:sample-rules'], ['bad', 'plugin'], ['number', 3]].map(([k, v]) => [k, si.builtForErrors(v)])),
    pluginNames: Object.fromEntries(['ai.amberx.axf.console.sample-notes', 'ai.amberx.axf.settings', 'Weird_Name!!', '', 'x'].map((m) => [m || '(empty)', si.pluginIfaceName(m)])),
    defaultIds: Object.fromEntries(owners.map((o) => [o, si.ifaceDefaultId(o, TYPES)])),
    keys: Object.fromEntries(owners.map((o) => [o, si.ifaceKey(o)])),
    keyOwners: Object.fromEntries(['axf.settings.iface.plugin.sample-notes', 'axf.settings.iface.asset.tab-group', 'axf.settings.iface.app', 'axf.settings.iface.nope', 'axf.other'].map((k) => [k, si.ownerOfIfaceKey(k)])),
    builtForOf: Object.fromEntries(ASSETS.map((a) => [a.id, si.builtForOf(a, TYPES)])),
    defaultAsset: si.ifaceDefaultAsset('plugin:sample-notes', { label: 'Sample notes', assetTypes: TYPES }),
    defaultAssetClash: si.ifaceDefaultAsset('plugin:settings', { assetTypes: TYPES })?.id ?? null,
    choices: Object.fromEntries(owners.map((o) => [o, si.ifaceChoices(o, ASSETS, TYPES)])),
    picks: {
      none: si.ifacePick(undefined, 'asset:toolbar', ASSETS, TYPES),
      picked: si.ifacePick('toolbar-big', 'asset:toolbar', ASSETS, TYPES),
      otherOwner: si.ifacePick('sample-notes-rows', 'asset:toolbar', ASSETS, TYPES),
      gone: si.ifacePick('toolbar-gone', 'asset:toolbar', ASSETS, TYPES),
      theDefault: si.ifacePick('default-toolbar', 'asset:toolbar', ASSETS, TYPES),
    },
    sets: {
      default: si.ifaceSet('asset:toolbar', 'default', ASSETS, TYPES),
      empty: si.ifaceSet('asset:toolbar', '', ASSETS, TYPES),
      defaultId: si.ifaceSet('asset:toolbar', 'default-toolbar', ASSETS, TYPES),
      pick: si.ifaceSet('asset:toolbar', 'toolbar-compact', ASSETS, TYPES),
      shared: si.ifaceSet('plugin:sample-rules', 'sample-notes-rows', ASSETS, TYPES),
      badOwner: si.ifaceSet('plugin:', 'x', ASSETS, TYPES),
    },
    args: {
      plugin: si.parseIfaceArgs(['plugin', 'sample-notes', 'sample-notes-rows']),
      asset: si.parseIfaceArgs(['asset', 'toolbar', 'default']),
      app: si.parseIfaceArgs(['app', 'standard']),
      bad: si.parseIfaceArgs(['nope', 'x', 'y']),
      noWhich: si.parseIfaceArgs(['plugin', 'sample-rules']),
    },
    layer: {
      plain: si.layerIface({ layout: 'tabs-side', header: 'full', search: true, descriptions: true, hide: ['a'], levelOf: { a: 'basic' }, levels: true }, { layout: 'list', descriptions: false, hide: ['b', 'a'], levelOf: { b: 'developer' } }),
      empty: si.layerIface(null, null),
    },
    pickList: si.ifacePickList({ 'axf.settings.iface.plugin.sample-rules': 'sample-rules-cards', 'axf.settings.iface.asset.toolbar': 'toolbar-big', 'axf.settings.iface.asset.banner': '', 'axf.other': 'x' }),
  };
}

const write = process.argv.includes('--write');
const got = JSON.parse(JSON.stringify(compute()));
if (write) {
  writeFileSync(FIXTURE, `${JSON.stringify({ $comment: 'settings-iface@1 golden outputs (node framework/spec/check-settings-iface.mjs --write). Inputs live in the check.', ...got }, null, 2)}\n`);
  console.log('wrote', FIXTURE);
  process.exit(0);
}
const want = JSON.parse(readFileSync(FIXTURE, 'utf8'));
delete want.$comment;
let checks = 0;
for (const k of Object.keys(got)) { assert.deepEqual(got[k], want[k], `fixture ${k}`); checks++; }
assert.deepEqual(Object.keys(want).sort(), Object.keys(got).sort(), 'fixture keys'); checks++;

// invariants the fixture alone doesn't pin
for (const o of ['asset:toolbar', 'plugin:sample-notes']) {
  const c = si.ifaceChoices(o, ASSETS, TYPES);
  assert.ok(c.every((x) => si.builtForOf(ASSETS.find((a) => a.id === x.id), TYPES) === o), `${o}: only its own interfaces (no sharing)`); checks++;
  assert.equal(c[0]?.isDefault, true, `${o}: default first`); checks++;
}
assert.equal(si.ifaceDefaultId('plugin:settings', TYPES) === si.ifaceDefaultId('asset:settings', TYPES), false, 'a plugin named like an asset type never shares its default id'); checks++;
const spec = JSON.parse(readFileSync(join(root, 'schemas/asset-types.json'), 'utf8'));
assert.ok(spec.types.settings.required.includes(si.SETTINGS_IFACE_FIELD), 'asset-types.json: settings requires builtFor'); checks++;

const problems = repoCheck();
assert.deepEqual(problems, [], `repo: ${problems.join('; ')}`); checks++;
console.log(`settings-iface: ${checks} checks ok`);

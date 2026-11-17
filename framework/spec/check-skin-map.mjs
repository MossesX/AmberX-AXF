#!/usr/bin/env node
/**
 * skin-map@1 conformance (core/engines/skin-map.mjs): the generated, read-only map of what every skin@1 slot controls
 * and where every dataset and layout lives. Plain node, no build step.
 *   - fixture replay: spec/fixtures/skin-map.json's inputs give the same map, errors, finds and helper results
 *   - the real map (the same inputs cli/build-engine.mjs reads) validates, lists every registered type a skin reaches,
 *     every skin-slots@1 slot, every app that ships the shared set (a look, a Default skin and a skin-config dataset
 *     each) and every layout type, and every dataset says where it lives (hub, repo, data store)
 *   - the snapshot schemas/skin-map.json and schemas/json/skin-map.schema.json are current (node framework/cli/axf.mjs schemas)
 *
 *   node framework/spec/check-skin-map.mjs [--json] [--quiet]
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKIN_MAP_CONTROLS, SKIN_MAP_FRAME, SKIN_MAP_ROW_KINDS, cssReaders, dataStoreKey, hubPlace, skinMap, skinMapErrors, skinMapFind, skinMapFor, skinMapJsonSchema, skinMapRowValue, tokensBySource } from '../core/engines/skin-map.mjs';
import { SKIN_SLOT_KEYS } from '../core/engines/skin-slots.mjs';
import { SKIN_NEVER } from '../core/engines/skin-rules.mjs';
import { coverageTable } from '../core/engines/skin-coverage.mjs';
import { skinMapInputs } from '../cli/build-engine.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const json = process.argv.includes('--json');
const quiet = process.argv.includes('--quiet') || json;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let n = 0;
const problems = [];
const t = (name, fn) => { try { fn(); n++; if (!quiet) console.log(`  ✓ ${name}`); } catch (e) { problems.push(`${name}: ${e.message}`); if (!quiet) console.log(`  ✗ ${name}\n    ${e.message}`); } };

const fx = readJson('framework/spec/fixtures/skin-map.json');
t('fixture replay: the same inputs give the same map', () => assert.ok(same(skinMap(fx.inputs), fx.map), 'map differs from the fixture (regenerate: npx -y tsx framework/spec/gen-fixtures.mts)'));
t('fixture replay: errors', () => { assert.deepEqual(skinMapErrors(fx.map), []); assert.deepEqual(skinMapErrors({}), fx.errors.empty); assert.ok(fx.errors.badRow.length >= 3); assert.ok(fx.errors.badDataset.length >= 1); });
t('fixture replay: find by token, key and label', () => { assert.deepEqual(skinMapFind(fx.map, '--fx-grid-').map((r) => r.slot), fx.find.token); assert.deepEqual(skinMapFind(fx.map, 'axf.hooks.').map((r) => r.slot), fx.find.key); assert.deepEqual(fx.find.none, []); assert.deepEqual(fx.find.empty, []); });
t('fixture replay: helpers', () => {
  const p = fx.inputs.dataStorePaths;
  assert.deepEqual(dataStoreKey(p, 'projects', '_shared/_data/settings/looks/app-a.json'), fx.helpers.dataStore.shared);
  assert.equal(fx.helpers.dataStore.shared, 'settings/looks/app-a.json');
  assert.equal(fx.helpers.dataStore.local, null);
  assert.deepEqual(hubPlace(p, 'shared', 'settings/looks/app-a.json'), fx.helpers.hubPlace.look);
  assert.equal(fx.helpers.hubPlace.look.mount, '/projects/_shared/_data/settings/looks/app-a.json');
  assert.deepEqual(cssReaders(fx.inputs.sheets['framework/ui/axf.css'], 'var(--fx-accent'), fx.helpers.cssReaders.token);
  assert.deepEqual(fx.helpers.cssReaders.token, ['.fx-btn']);
  assert.deepEqual(fx.helpers.cssReaders.attr, ["[data-fx-motion-toolbar-enter='rise'] .fx-toolbar"]);
  assert.deepEqual(tokensBySource(fx.inputs.tokens, /^color-theme:/), fx.helpers.tokensBySource.colour);
});

const inputs = skinMapInputs(ROOT);
const map = skinMap(inputs);
t('the real map validates and is generated / read-only', () => { assert.deepEqual(skinMapErrors(map), []); assert.equal(map.$axf, SKIN_MAP_FRAME); assert.equal(map.generated, true); assert.equal(map.readOnly, true); });
t('every registered type a skin reaches has a row (slot or section), bundles and none are listed too', () => {
  const rows = coverageTable(inputs.registry.types, inputs.customize.targets ?? {}, SKIN_NEVER);
  for (const r of rows) assert.ok(map.slots.some((s) => s.type === r.type), `${r.type} has no row`);
});
t('every skin-slots@1 slot has a row of its own kind', () => { for (const k of SKIN_SLOT_KEYS) assert.ok(map.slots.some((s) => s.slot === k && s.kind === k), `${k} missing`); });
t('every row has a kind and controls from the contract', () => { for (const s of map.slots) { assert.ok(SKIN_MAP_ROW_KINDS.includes(s.kind), `${s.slot}: ${s.kind}`); for (const c of s.controls) assert.ok(SKIN_MAP_CONTROLS.includes(c), `${s.slot}: ${c}`); } });
t('every app that ships the shared set has a look, a Default skin and a skin-config dataset, each with a hub path, a repo path and a data-store namespace', () => {
  assert.ok(inputs.apps.length >= 3, 'shared-assets.json lists the apps');
  for (const a of inputs.apps) for (const kind of ['look', 'default-skin', 'skin-config']) {
    const d = map.datasets.find((x) => x.id === `${kind}:${a.id}`);
    assert.ok(d, `${kind}:${a.id} missing`);
    assert.ok(d.hub && d.repo && d.dataStore, `${d.id} does not say where it lives`);
    assert.ok(d.dataStore.startsWith('settings/'), `${d.id} lands in the settings namespace`);
  }
  const ap = map.datasets.find((x) => x.id === 'appearance');
  assert.equal(ap.hub, 'shared:settings/appearance.json');
  assert.equal(ap.dataStore, 'settings/appearance.json');
});
t('every layout type with assets is listed with its ids, repo path and pick', () => {
  for (const type of ['layout', 'dock-layout']) { const l = map.layouts.find((x) => x.type === type); assert.ok(l, `${type} missing`); assert.ok(l.ids.length > 0, `${type} has assets`); assert.equal(l.repo, `framework/assets/${type}/<id>.json`); assert.equal(l.pick.field, `slots.${type}`); }
  assert.ok(map.layouts.find((x) => x.type === 'layout').tokens.length > 0, 'the layout theme writes tokens');
});
t('the motion, grid and dialog rows name the tokens, attributes and selectors the stylesheet reads', () => {
  const motion = map.slots.find((s) => s.slot === 'motion');
  assert.ok(motion.tokens.includes('--fx-motion-fast') && motion.tokens.includes('--fx-motion-dialog-dur'));
  assert.ok(motion.selectors.length > 0 && motion.selectors.includes('.fx-ctx'), 'the context menu reads the motion tokens');
  const grid = map.slots.find((s) => s.slot === 'grid');
  assert.ok(grid.tokens.includes('--fx-grid-row-height') && grid.selectors.some((s) => s.includes('.axf-grid')));
  const dialog = map.slots.find((s) => s.slot === 'dialog');
  assert.ok(dialog.tokens.includes('--fx-dialog-w') && dialog.settings.includes('axf.chrome.dialog'));
});
t('skinMapFor: the map read through one skin (values, filled count, one slot), the document itself untouched', () => {
  const skin = { layoutTheme: 'l', colorTheme: 'c', styleTheme: 's', assets: { toolbar: 'tb' }, parts: { toolbar: { gap: 'xs' } }, iconPack: 'ip', motion: { reduced: 'system' } };
  const one = skinMapFor(map, 'x', skin, 'toolbar');
  assert.deepEqual(one.slots.map((r) => [r.slot, r.value]), [['assets.toolbar', 'tb'], ['parts.toolbar', { gap: 'xs' }]]);
  assert.equal(one.skin.filled, 2);
  assert.equal(skinMapRowValue(map.slots.find((r) => r.slot === 'motion'), skin).reduced, 'system');
  assert.equal(skinMapRowValue(map.slots.find((r) => r.slot === 'iconPack'), skin), 'ip');
  assert.equal(skinMapRowValue(map.slots.find((r) => r.slot === 'colorTheme'), skin), 'c');
  assert.equal(skinMapFor(map, '', null).skin, null);
  assert.ok(!('value' in map.slots[0]), 'the generated document carries no skin values');
});
t('the snapshot schemas/skin-map.json and schemas/json/skin-map.schema.json are current (run: node framework/cli/axf.mjs schemas)', () => {
  assert.ok(same(readJson('framework/schemas/skin-map.json'), map), 'schemas/skin-map.json is stale');
  assert.ok(same(readJson('framework/schemas/json/skin-map.schema.json'), skinMapJsonSchema()), 'schemas/json/skin-map.schema.json is stale');
});

if (json) console.log(JSON.stringify({ ok: problems.length === 0, checks: n, problems, summary: map.summary }));
else if (problems.length) { console.error(`✗ skin-map@1: ${problems.length} problem(s)`); for (const p of problems) console.error(`  - ${p}`); }
else console.log(`✓ skin-map@1: ${n} checks passed (${map.summary.slots} slots, ${map.summary.datasets} datasets, ${map.summary.layouts} layout types, ${map.summary.tokens} tokens, ${map.summary.settings} settings keys)`);
process.exitCode = problems.length ? 1 : 0;

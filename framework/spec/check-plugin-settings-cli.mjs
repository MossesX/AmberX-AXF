#!/usr/bin/env node
/** Self-test of framework/cli/check-plugin-settings.mjs on throw-away plugins: each failure is named with file:line. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAll } from '../cli/check-plugin-settings.mjs';

const repo = mkdtempSync(join(tmpdir(), 'axf-pss-'));
const root = join(repo, 'apps/console-web/plugins');
const plugin = (folder, manifest, web) => {
  mkdirSync(join(root, folder, 'web'), { recursive: true });
  writeFileSync(join(root, folder, 'plugin.json'), JSON.stringify({ $axf: 'plugin@1', id: `ai.test.${folder}`, name: folder, ...manifest }, null, 2));
  writeFileSync(join(root, folder, 'web/index.tsx'), web);
};
const block = (tab, gear, options = []) => ({ settings: { $axf: 'plugin-settings@1', tab, parent: 'plugins', sections: ['enable', 'info', 'logs'], options, gear } });
let n = 0;
try {
  plugin('good', { provides: ['view:good', 'settings-tab:good'], ...block('good', true) }, "const FOLDER = 'good';\nexport const plugin = { views: { good: {} } };\nconst H = () => <PluginScreenHeader tab={FOLDER} title=\"Good\" />;\n");
  plugin('quiet', { provides: ['settings-tab:quiet'], ...block('quiet', false) }, 'export const plugin = {};\n');
  plugin('noblock', { provides: ['settings-tab:noblock'] }, 'export const plugin = {};\n');
  plugin('nogear', { provides: ['view:nogear', 'settings-tab:nogear'], ...block('nogear', true) }, "export const plugin = {\n  views: { nogear: {} },\n};\n");
  plugin('handgear', { provides: ['view:handgear', 'settings-tab:handgear'], ...block('handgear', true) },
    "const H = () => <PluginScreenHeader tab=\"handgear\" title=\"H\" />;\nconst X = () => (\n  <IconButton icon=\"settings\" label=\"S\" onClick={() => rt.dispatch('settings.open:handgear')} />\n);\n");
  plugin('othertab', { provides: ['view:othertab', 'settings-tab:othertab'], ...block('othertab', true) }, "export const plugin = { views: { othertab: {} } };\nconst H = () => <PluginSettingsGear tab=\"elsewhere\" />;\n");
  const by = Object.fromEntries(checkAll({ root, repo }).map((r) => [r.folder, r]));
  const t = (name, fn) => { fn(); n += 1; };
  t('a plugin with its block and the shared header passes', () => assert.deepEqual(by.good.errors, []));
  t('a plugin without a screen needs no gear', () => assert.deepEqual(by.quiet.errors, []));
  t('a missing block fails at plugin.json', () => { assert.equal(by.noblock.errors.length, 1); assert.match(by.noblock.errors[0].at, /noblock\/plugin\.json:1$/); assert.match(by.noblock.errors[0].message, /"settings" is missing/); });
  t('a screen without the gear fails where its views are registered', () => { assert.equal(by.nogear.errors.length, 1); assert.match(by.nogear.errors[0].at, /nogear\/web\/index\.tsx:2$/); assert.match(by.nogear.errors[0].message, /no PluginSettingsGear/); });
  t('a hand-made gear fails at its line', () => { assert.equal(by.handgear.errors.length, 1); assert.match(by.handgear.errors[0].at, /handgear\/web\/index\.tsx:3$/); assert.match(by.handgear.errors[0].message, /hand-made settings gear/); });
  t('a gear for another tab does not count', () => { assert.equal(by.othertab.errors.length, 1); assert.match(by.othertab.errors[0].message, /other tabs: .*elsewhere/); });
} finally { rmSync(repo, { recursive: true, force: true }); }
console.log(`✓ check-plugin-settings: ${n} cases`);

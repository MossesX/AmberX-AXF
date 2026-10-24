/**
 * Settings interface asset (engines/settingsui.ts, settings-ui@1): normalizeSettingsUi / settingsUiErrors /
 * arrangeSettingsTabs / filterSettingsGroup / settingsUiGroups / settingMatches against spec/fixtures/settings-ui.json,
 * plus every starter passes the asset validator with no engine errors and every enum in asset-types.json is one the
 * engine knows. `npx -y tsx framework/spec/check-settings-ui.mts [--write]` (--write regenerates expected values;
 * review the diff). The Kotlin twin is deferred (spec/PORTING.md): the fixture is what it will replay.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrangeSettingsTabs, filterSettingsGroup, normalizeSettingsUi, settingMatches, settingsUiErrors, settingsUiGroups } from '../core/engines/settingsui';
import { validateAsset } from '../core/validate';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, 'fixtures/settings-ui.json');
const TABS = [
  { id: 'appearance', label: 'Appearance', icon: 'palette', order: 10 },
  { id: 'account', label: 'Account & security', icon: 'shield', order: 20 },
  { id: 'connections', label: 'Connections', icon: 'cloud', order: 30 },
  { id: 'plugins', label: 'Plugins', icon: 'package', order: 40 },
  { id: 'banners', label: 'Banners', icon: 'bell', order: 1, parent: 'plugins' },
  { id: 'about', label: 'About', icon: 'info', order: 90 },
];
const GROUP = { id: 'axf.display', label: 'Display', tab: 'appearance', settings: [
  { key: 'axf.display.fontScale', label: 'Text size', kind: 'slider' },
  { key: 'axf.display.animations', label: 'Animations', kind: 'toggle', description: 'Off reduces motion.' },
] };
const CASES: { name: string; fn: string; input: unknown }[] = [
  { name: 'nothing = defaults', fn: 'normalize', input: null },
  { name: 'bad enums fall back', fn: 'normalize', input: { layout: 'grid', header: 7, search: 'yes', descriptions: false } },
  { name: 'tabs: bad ids + duplicates dropped', fn: 'normalize', input: { layout: 'list', header: 'none', search: true, descriptions: true, tabs: [{ id: 'about' }, { id: 'about', label: 'Again' }, { id: 'bad id' }, 7, { id: 'dev', label: 'Developer', icon: 'code', parent: 'dev', hidden: 'x' }] } },
  { name: 'groups: data-only kinds, options, defaults', fn: 'normalize', input: { layout: 'tabs-side', header: 'compact', search: false, descriptions: true, groups: [
    { id: 'g', label: 'G', tab: 'dev', settings: [
      { key: 'a', label: 'A', kind: 'toggle', default: 'no' },
      { key: 'b', label: 'B', kind: 'secret' },
      { key: 'c', label: 'C', kind: 'choice', default: 'z', options: [{ value: 'x', label: 'X' }, { value: '', label: 'Empty' }] },
      { key: 'd', label: 'D', kind: 'slider', min: 5, max: 1, step: -1, default: 3 },
      { key: 'e', label: 'E', kind: 'link', target: 'javascript:alert(1)' },
      { key: 'f', label: 'F', kind: 'link', target: 'https://example.com' },
      { key: 'a', label: 'A again', kind: 'text' },
      { key: 'm', label: 'M', kind: 'multi_choice', default: ['x', 'q'], options: [{ value: 'x', label: 'X' }] },
    ] },
    { id: 'empty', label: 'Empty', tab: 'dev', settings: [{ key: 'z', label: 'Z', kind: 'custom' }] },
  ] } },
  { name: 'errors: clean asset', fn: 'errors', input: { layout: 'tabs-top', header: 'full', search: false, descriptions: true } },
  { name: 'errors: dropped entries', fn: 'errors', input: { layout: 'tabs-top', header: 'full', search: false, descriptions: true, tabs: [{ id: '!' }], hide: 'about', groups: [{ id: 'g', label: 'G', tab: 't', settings: [{ key: 'k', label: 'K', kind: 'toggle' }, { key: 'x', kind: 'toggle' }] }, { id: 'h' }] } },
  { name: 'arrange: defaults keep the app order', fn: 'arrange', input: {} },
  { name: 'arrange: asset order first, relabel, hide, new tab', fn: 'arrange', input: { tabs: [{ id: 'plugins', label: 'Add-ons' }, { id: 'dev', label: 'Developer', icon: 'code' }, { id: 'nolabel' }, { id: 'appearance' }], hide: ['account'] } },
  { name: 'arrange: hiding a parent hides its sub-tabs', fn: 'arrange', input: { tabs: [{ id: 'plugins', hidden: true }] } },
  { name: 'arrange: explicit order wins', fn: 'arrange', input: { tabs: [{ id: 'about', order: 0 }, { id: 'connections', order: 15 }] } },
  { name: 'filter: setting key hidden', fn: 'filter', input: { hide: ['axf.display.fontScale'] } },
  { name: 'filter: whole group hidden', fn: 'filter', input: { hide: ['axf.display'] } },
  { name: 'filter: every setting hidden', fn: 'filter', input: { hide: ['axf.display.fontScale', 'axf.display.animations'] } },
  { name: 'groups: owned by the asset', fn: 'groups', input: { groups: [{ id: 'g', label: 'G', tab: 'dev', settings: [{ key: 'k', label: 'K', kind: 'toggle', default: true }] }] } },
  { name: 'match: every word must hit', fn: 'match', input: 'reduces anim' },
  { name: 'match: option labels', fn: 'match', input: 'xyz' },
  { name: 'match: empty query', fn: 'match', input: '  ' },
];
const run: Record<string, (i: never) => unknown> = {
  normalize: (i) => normalizeSettingsUi(i),
  errors: (i) => settingsUiErrors(i),
  arrange: (i) => arrangeSettingsTabs(TABS, normalizeSettingsUi(i)),
  filter: (i) => filterSettingsGroup(GROUP as never, normalizeSettingsUi(i)),
  groups: (i) => settingsUiGroups(normalizeSettingsUi(i), 'shared'),
  match: (i) => GROUP.settings.map((s) => settingMatches(s as never, i)),
};
let ok = 0;
const fail = (m: string) => { console.error(`FAIL: ${m}`); process.exit(1); };
if (process.argv.includes('--write') || !existsSync(FIX)) {
  const out = { $comment: 'settings-ui@1 golden outputs from framework/core/engines/settingsui.ts (check-settings-ui.mts --write). Tabs/group used by arrange/filter/match are in the checker.', tabs: TABS, group: GROUP, cases: CASES.map((c) => ({ ...c, expected: run[c.fn]!(c.input as never) })) };
  writeFileSync(FIX, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${CASES.length} expected values`);
}
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
for (const c of fx.cases) {
  const got = JSON.stringify(run[c.fn]!(c.input as never));
  if (got !== JSON.stringify(c.expected)) fail(`${c.fn} ${c.name}: got ${got}, want ${JSON.stringify(c.expected)}`);
  ok++;
}
const spec = JSON.parse(readFileSync(join(here, '../schemas/asset-types.json'), 'utf8')).types.settings;
for (const f of readdirSync(join(here, '../assets/settings'))) {
  const a = JSON.parse(readFileSync(join(here, '../assets/settings', f), 'utf8'));
  const v = validateAsset(a);
  if (!v.ok) fail(`settings/${f}: ${v.errors.join('; ')}`);
  const e = settingsUiErrors(a.data);
  if (e.length) fail(`settings/${f}: ${e.join('; ')}`);
  ok += 2;
}
for (const [field, values] of Object.entries(spec.enums as Record<string, string[]>)) {
  for (const v of values) if ((normalizeSettingsUi({ [field]: v }) as unknown as Record<string, unknown>)[field] !== v) fail(`settings.${field} = ${v} is in asset-types.json but the engine drops it`);
  ok++;
}
console.log(`check-settings-ui: ${ok} checks passed`);

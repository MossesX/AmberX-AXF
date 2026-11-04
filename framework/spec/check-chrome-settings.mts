/**
 * chrome-settings@1 (core/engines/chrome-settings-rules.mjs; build tab-group-assets, Nov 4 2026): replays
 * spec/fixtures/chrome-settings.json through the reference rules (the Kotlin twin is deferred, spec/PORTING.md), checks
 * the six shared default settings interfaces ship and validate, every field a dialog edits is a real field of its asset
 * type (asset-types.json enums agree), every app in shared-assets.json + Expenses has a custom copy per type that
 * extends the default, and `extends` folding (inherit@1) keeps an unedited copy equal to its default.
 *   npx -y tsx framework/spec/check-chrome-settings.mts
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cs from '../core/engines/chrome-settings-rules.mjs';
import { normalizeSettingsUi, settingsUiErrors } from '../core/engines/settingsui';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES } from '../core/types';
// @ts-expect-error plain .mjs (the build engine's own validator)
import { validateAsset as engineValidate } from '../cli/build-engine.mjs';
// @ts-expect-error plain .mjs
import { checkApp, defaultApps, sharedDefaults } from '../cli/chrome-settings.mjs';

const root = new URL('../', import.meta.url).pathname;
const f = JSON.parse(readFileSync(join(root, 'spec/fixtures/chrome-settings.json'), 'utf8'));
const spec = JSON.parse(readFileSync(join(root, 'schemas/asset-types.json'), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg); checks++; };

/* ---- registry ---- */
eq(f.contract, cs.CHROME_SETTINGS_CONTRACT, 'contract');
eq(f.types, cs.CHROME_TYPES, 'types'); eq(f.labels, cs.CHROME_LABELS, 'labels'); eq(f.many, cs.CHROME_MANY, 'many'); eq(f.targets, cs.CHROME_TARGETS, 'targets'); eq(f.moves, cs.CHROME_MOVES, 'moves'); eq(f.tabs, cs.CHROME_SETTINGS_TABS, 'tabs'); eq(f.fields, cs.CHROME_FIELDS, 'fields');
for (const t of cs.CHROME_TYPES) {
  ok((ASSET_TYPES as readonly string[]).includes(t), `${t} is an asset type`);
  ok(cs.CHROME_FIELDS[t].length > 0, `${t} has dialog fields`);
  // every field a dialog edits exists on the asset type, and every choice is in the type's enum when the schema has one
  const ts = spec.types[t];
  const known = new Set([...(ts.required ?? []), ...Object.keys(ts.optional_fields ?? {}), ...Object.keys(ts.enums ?? {}), ...Object.keys(ts.nested ?? {})]);
  for (const fd of cs.CHROME_FIELDS[t]) {
    ok(known.has(fd.key), `${t}.${fd.key} is a field of the ${t} asset type`);
    if (fd.kind === 'choice' && ts.enums?.[fd.key]) eq(fd.options, ts.enums[fd.key], `${t}.${fd.key} options = asset-types.json enum`);
    ok(['look', 'behaviour'].includes(fd.group) && ['simple', 'basic', 'developer', 'administrator'].includes(fd.level), `${t}.${fd.key} group + level`);
  }
  const m = cs.CHROME_MOVES[t];
  for (const p of m.positions) ok(p in cs.POSITION_LABELS, `${t} move ${p} labelled`);
  if (m.via === 'instance') ok(cs.CHROME_FIELDS[t].some((x) => x.key === m.field), `${t} move field is a dialog field`);
  if (m.via === 'layout') eq(spec.types.layout.enums[m.field], m.positions, `${t} move = layout enum ${m.field}`);
}
ok(cs.CHROME_TYPES.every((t) => cs.CHROME_TARGETS[t].every((x) => cs.chromeTypeOfTarget(x) === t)), 'every target maps back to its type');
eq(f.targetTypes, Object.fromEntries(['tab-group', 'toolbar', 'banner', 'axf-banner', 'nav', 'nav-item', 'app-menu', 'menubar', 'canvas', 'default', ''].map((t) => [t || '(empty)', cs.chromeTypeOfTarget(t)])), 'target → type fixture');
ok(spec.types.settings.optional_fields.for && spec.types.settings.optional_fields.extends, 'asset-types.json documents settings.for + settings.extends');

/* ---- ids, keys, slugs ---- */
eq(f.ids, Object.fromEntries(cs.CHROME_TYPES.map((t) => [t, { default: cs.chromeSettingsDefaultId(t), custom: cs.chromeSettingsCustomId(t, 'axf-console'), typeOfDefault: cs.chromeTypeOfSettingsId(cs.chromeSettingsDefaultId(t)), typeOfCustom: cs.chromeTypeOfSettingsId(cs.chromeSettingsCustomId(t, 'axf-console')) }])), 'ids fixture');
for (const t of cs.CHROME_TYPES) eq(cs.chromeTypeOfSettingsId(cs.chromeSettingsCustomId(t, 'molly')), t, `custom id of ${t} resolves to ${t} (nav-menu vs app-menu never confused)`);
eq(cs.chromeTypeOfSettingsId('chrome-tab-group-tab-group'), 'tab-group', 'longest type wins');
eq(cs.chromeTypeOfSettingsId('standard'), null, 'a plain settings asset is no chrome interface');
eq(f.keys, { pick: cs.CHROME_SETTINGS_PICK_KEY('tab-group'), patch: cs.CHROME_SETTINGS_PATCH_KEY('tab-group'), instance: cs.CHROME_INSTANCE_KEY('tab-group', 'ui-review.sections'), instanceAsset: cs.CHROME_INSTANCE_ASSET_KEY('tab-group', 'ui-review.sections'), last: cs.TAB_GROUP_LAST_KEY('ui-review.sections'), fold: cs.TAB_GROUP_FOLD_KEY('ui-review.sections') }, 'keys fixture');
eq(f.slugs, { 'Dev Console': cs.appSlug('Dev Console'), 'axf-console': cs.appSlug('axf-console'), '': cs.appSlug(''), '  Weird__Name!!': cs.appSlug('  Weird__Name!!') }, 'slugs fixture');
ok(cs.isChromeInstanceId('ui-review.sections') && cs.isChromeInstanceId('plugin:build-manager/tabs') && !cs.isChromeInstanceId('') && !cs.isChromeInstanceId('.x') && !cs.isChromeInstanceId('a b'), 'instance ids');

/* ---- shared defaults ---- */
const defaults = sharedDefaults() as Record<string, { id: string; name: string; data: Record<string, unknown> }>;
for (const t of cs.CHROME_TYPES) {
  const a = defaults[t];
  ok(a, `shared default ${cs.chromeSettingsDefaultId(t)} ships`);
  if (!a) continue;
  const r = validateAsset(a as never); ok(r.ok, `${a.id} validates (TS): ${r.ok ? '' : r.errors.join('; ')}`);
  const e = engineValidate(a); ok(e.ok, `${a.id} validates (build engine): ${e.ok ? '' : e.errors.join('; ')}`);
  eq(settingsUiErrors(a.data), [], `${a.id}: no settings-ui engine errors`);
  eq(cs.chromeSettingsErrors(a), [], `${a.id}: no chrome-settings errors`);
  eq(a.data.for, t, `${a.id}.data.for`);
  ok(a.data.extends === undefined, `${a.id} extends nothing (it is the root)`);
  const ui = normalizeSettingsUi(a.data);
  eq(ui.tabs.map((x) => x.id), cs.CHROME_SETTINGS_TABS.map((x) => x.id), `${a.id} declares the four chrome tabs`);
  ok(ui.levels && ui.levelOf.interface === 'developer', `${a.id}: levels on, Interface at Developer`);
}

/* ---- custom copies ---- */
eq(f.customCopy, cs.customCopy(defaults['tab-group']!, { id: 'axf-console', name: 'Dev Console' }), 'customCopy fixture');
const copy = cs.customCopy(defaults['tab-group']!, { id: 'axf-console', name: 'Dev Console' });
ok(copy.id === 'chrome-tab-group-axf-console' && copy.data.extends === 'chrome-tab-group' && copy.data.for === 'tab-group', 'copy id, extends, for');
ok(validateAsset(copy as never).ok && engineValidate(copy).ok, 'a copy validates');
assert.throws(() => cs.customCopy({ id: 'standard', data: { layout: 'list' } } as never, 'x'), 'copying a non-chrome settings asset throws'); checks++;

/* ---- inherit@1 chain ---- */
const edited = { ...copy, id: 'chrome-tab-group-edited', data: { ...copy.data, layout: 'tabs-side', tabs: [], hide: ['interface'], levelOf: { look: 'basic' } } };
const get = (id: string) => ({ ...Object.fromEntries(Object.values(defaults).map((a) => [a.id, a])), [copy.id]: copy, [edited.id]: edited, loop1: { id: 'loop1', data: { for: 'toolbar', extends: 'loop2' } }, loop2: { id: 'loop2', data: { for: 'toolbar', extends: 'loop1', header: 'none' } } } as Record<string, cs.AssetLike>)[id] ?? null;
eq(f.chain, { custom: cs.resolveSettingsChain(get, copy.id), edited: cs.resolveSettingsChain(get, edited.id), default: cs.resolveSettingsChain(get, 'chrome-tab-group'), loop: cs.resolveSettingsChain(get, 'loop1'), missing: cs.resolveSettingsChain(get, 'nope') }, 'chain fixture');
const own = { ...defaults['tab-group']!.data };
eq(cs.resolveSettingsChain(get, copy.id), own, 'an unedited copy resolves to exactly the default (follows it)');
const ed = cs.resolveSettingsChain(get, edited.id)!;
ok(ed.layout === 'tabs-side' && (ed.hide as string[])[0] === 'interface' && (ed.tabs as unknown[]).length === 4 && (ed.levelOf as Record<string, string>).look === 'basic' && (ed.levelOf as Record<string, string>).interface === 'developer' && ed.extends === undefined, 'edited fields win, empty arrays fall through, objects merge, extends dropped');
ok(cs.resolveSettingsChain(get, 'loop1')!.header === 'none' && cs.resolveSettingsChain(get, 'nope') === null, 'cycles stop, missing = null');

/* ---- picks + choices ---- */
eq(f.picks, { unset: cs.chromeSettingsPick(undefined, 'tab-group', ['chrome-tab-group', copy.id]), custom: cs.chromeSettingsPick(copy.id, 'tab-group', ['chrome-tab-group', copy.id]), gone: cs.chromeSettingsPick('chrome-tab-group-old', 'tab-group', ['chrome-tab-group', copy.id]), wrongType: cs.chromeSettingsPick('chrome-toolbar', 'tab-group', ['chrome-tab-group', 'chrome-toolbar']), noDefault: cs.chromeSettingsPick(undefined, 'tab-group', [copy.id]) }, 'picks fixture');
eq(cs.chromeSettingsPick(undefined, 'tab-group', ['chrome-tab-group', copy.id]), 'chrome-tab-group', 'the shared default is selected by default (Brett, addendum 3)');
eq(cs.chromeSettingsPick(copy.id, 'tab-group', ['chrome-tab-group', copy.id]), copy.id, 'the custom copy only when picked');
eq(f.choices, cs.chromeSettingsChoices('tab-group', [edited, defaults.toolbar!, copy, defaults['tab-group']!]), 'choices fixture');
ok(cs.chromeSettingsChoices('tab-group', [edited, defaults.toolbar!, copy, defaults['tab-group']!])[0]!.id === 'chrome-tab-group', 'the picker offers the shared default first');

/* ---- instance overrides ---- */
eq(f.overrides, { clean: cs.normalizeInstanceOverride('tab-group', { style: 'pills', position: 'left', badges: false, bogus: 1, density: 'huge', sticky: 'yes' }), number: cs.normalizeInstanceOverride('banner', { height: 999.6, surface: 'raised' }), empty: cs.normalizeInstanceOverride('toolbar', null), unknownType: cs.normalizeInstanceOverride('clock', { format: '12h' }), data: cs.chromeInstanceData('tab-group', { style: 'underline', align: 'start' }, { style: 'pills', bogus: true }), value: [cs.chromeFieldValue('tab-group', { style: 'underline' }, { style: 'pills' }, 'style'), cs.chromeFieldValue('tab-group', { style: 'underline' }, {}, 'style'), cs.chromeFieldValue('tab-group', {}, {}, 'style')] }, 'overrides fixture');
eq(cs.normalizeInstanceOverride('tab-group', { style: 'pills', position: 'left', badges: false, bogus: 1, density: 'huge', sticky: 'yes' }), { style: 'pills', position: 'left', badges: false }, 'unknown fields and bad values dropped');
eq(cs.normalizeInstanceOverride('banner', { height: 999.6, surface: 'raised' }), { height: 48, surface: 'raised' }, 'numbers clamped + rounded');

/* ---- errors ---- */
eq(f.errors, { ok: cs.chromeSettingsErrors(copy), badFor: cs.chromeSettingsErrors({ id: 'chrome-x', data: { for: 'clock' } }), self: cs.chromeSettingsErrors({ id: 'chrome-toolbar-a', data: { for: 'toolbar', extends: 'chrome-toolbar-a' } }), badName: cs.chromeSettingsErrors({ id: 'my-settings', data: { for: 'toolbar' } }), notAsset: cs.chromeSettingsErrors(null) }, 'errors fixture');
ok(cs.chromeSettingsErrors({ id: 'chrome-x', data: { for: 'clock' } }).length === 2 && cs.chromeSettingsErrors({ id: 'chrome-toolbar-a', data: { for: 'toolbar', extends: 'chrome-toolbar-a' } }).length === 1, 'error counts');

/* ---- plan + every app (shared-assets apps + Expenses) ---- */
eq(f.plan, cs.chromeSettingsPlan('molly'), 'plan fixture');
eq(f.missing, cs.chromeSettingsMissing('molly', ['chrome-tab-group', 'chrome-tab-group-molly', 'chrome-toolbar']), 'missing fixture');
const apps = defaultApps() as string[];
ok(apps.length >= 5, `at least five apps carry copies (${apps.length})`);
for (const d of apps) {
  const r = checkApp(d, defaults) as { app: { id: string }; dir: string; findings: string[] };
  eq(r.findings, [], `${d.replace(root, '')} (${r.app.id}): custom copies present + valid`);
  for (const t of cs.CHROME_TYPES) {
    const file = join(r.dir, `${cs.chromeSettingsCustomId(t, r.app.id)}.json`);
    if (!existsSync(file)) continue;
    const a = JSON.parse(readFileSync(file, 'utf8'));
    ok(validateAsset(a).ok && engineValidate(a).ok, `${a.id} validates`);
  }
}
// an app's custom copies never shadow a shared default's id
for (const d of apps) {
  const dir = join(d, 'src/assets/settings');
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir)) ok(!cs.CHROME_TYPES.some((t) => file === `${cs.chromeSettingsDefaultId(t)}.json`), `${d.replace(root, '')}/${file}: an app never ships a shared default under its own assets`);
}

console.log(`✓ chrome-settings@1: ${checks} checks`);

#!/usr/bin/env node
/**
 * skin-config@1 conformance (core/engines/skin-config-rules.mjs): the permission tree Brett sets before the AI makes a
 * skin, and the Default skin it is held to.
 *   node framework/spec/check-skin-config.mjs           check
 *   node framework/spec/check-skin-config.mjs --write   regenerate fixtures/skin-config.json's expected outputs
 *
 * The fixture replays a small registry of its own (`in.registry`, `in.customize`), so a port answers the same tree,
 * modes, limits, change report, merge and Default skin from the same inputs; the second half runs the engine over the
 * real registry and fails when a declaration is wrong or the snapshot (schemas/skin-config.json) is stale.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../core/engines/skin-config-rules.mjs';
import { coverageTable } from '../core/engines/skin-coverage.mjs';
import { SKIN_NEVER } from '../core/engines/skin-rules.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/skin-config.json');
const WRITE = process.argv.includes('--write');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------------------------------------------------------------- inputs (the port replays these) */

const registry = {
  types: {
    'color-theme': { label: 'Colour theme', group: 'Themes', required: ['tokens', 'scheme'], nested: { tokens: ['bg', 'fg', 'accent'] }, enums: { scheme: ['light', 'dark'] } },
    menu: { label: 'Menu', group: 'Navigation', hideable: true, required: ['menus'], optional_fields: { compact: 'Compact rows — fewer pixels per item' }, skinConfig: { limits: { depth: { label: 'Menu levels the AI may build (1 = flat)', measure: 'depth', min: 1, max: 4, default: 2 } } } },
    'context-menu': { label: 'Context menu', group: 'Navigation', hideable: true, required: ['targets'], nested: { targets: ['default'] }, skinConfig: { limits: { depth: { measure: 'depth', root: 'targets', min: 1, max: 3, default: 1 } } } },
    toolbar: { label: 'Toolbar', group: 'Navigation', hideable: true, required: ['groups'], skinConfig: { limits: { groups: { label: 'Toolbar groups', measure: 'count:groups', min: 1, max: 6, default: 3 } } } },
    button: { label: 'Button', group: 'Controls', required: ['variant'], enums: { variant: ['solid', 'outline'] } },
    badge: { label: 'Badge', group: 'Widgets', widget: true, required: ['tone'] },
    'icon-pack': { label: 'Icon pack', group: 'Brand', required: ['glyphs'], skin: { by: 'reference', via: 'iconPack' } },
    'logo-mark': { label: 'Logo mark', group: 'Brand', required: ['paths'], skin: { by: 'reference', via: 'branding' } },
    branding: { label: 'Branding', group: 'Brand', required: ['name'] },
    skin: { label: 'Skin', group: 'System', required: ['assets'], skin: { by: 'bundle', why: 'the whole look' } },
    'uac-policy': { label: 'Access policy', group: 'System', required: ['roles'], skin: { by: 'none', why: 'no look' } },
    orphan: { label: 'Orphan widget', group: 'Widgets', widget: true, required: ['x'] },
  },
  skinConfig: { extras: { label: 'Look extras', section: 'Look', groupLabel: 'The look as a whole', options: { spacing: 'Spacing (tight, compact or regular)', settings: 'Look settings and token overrides the skin carries' } } },
};
const customize = {
  tokens: [
    { key: 'fontSize', label: 'Font size', group: 'Text', kind: 'scale' },
    { key: 'textColor', label: 'Text colour', group: 'Colour', kind: 'color' },
    { key: 'radius', label: 'Corners', group: 'Shape', kind: 'choice' },
    { key: 'itemGap', label: 'Item gap', group: 'Layout', kind: 'scale', types: ['menu', 'toolbar'] },
    { key: 'hover', label: 'Hover', group: 'Hover', kind: 'choice' },
    { key: 'broken' },
  ],
  targets: { menu: { root: '.m', item: '.m-i' }, 'context-menu': { root: '.c', item: '.c-i' }, toolbar: { root: '.t', item: '.t-i' }, button: { root: '.b' }, badge: { root: '.bd' } },
};
const never = ['uac-policy', 'skin'];

const config = {
  $axf: 'skin-config@1', app: 'demo', default: 'allow',
  categories: {
    'color-theme': { mode: 'lock' },
    menu: { groups: { pick: { mode: 'ask' }, 'parts.layout': { options: { itemGap: 'lock' } } }, limits: { depth: 1 } },
    'context-menu': { limits: { depth: 9 } },
    toolbar: { groups: { chrome: { mode: 'lock' } } },
    extras: { groups: { look: { options: { settings: 'lock' } } } },
    nothing: { mode: 'lock' },
    button: { groups: { fields: { options: { nope: 'lock', variant: 'maybe' } } }, limits: { depth: 2 } },
  },
  updatedBy: 'brett',
};
const junk = { $axf: 'skin-config@1', app: 'demo', default: 'sometimes', categories: { 'color-theme': { mode: 'never' }, menu: { groups: { fields: 'x', pick: { options: { asset: 'lock', other: 'lock' } } }, limits: { depth: 0, width: 3 } }, ghost: {} } };

const base = { layoutTheme: 'classic', colorTheme: 'night', styleTheme: 'hub', assets: { menu: 'standard', 'context-menu': 'flat', toolbar: 'icons', button: 'rounded', branding: 'amberx' }, iconPack: 'outline', parts: { menu: { itemGap: 2, fontSize: 100 }, button: { radius: 'md' } }, extras: { spacing: 'tight', hidden: { toolbar: false }, settings: { 'axf.tokens.button': { radius: 'md' } } } };
const generated = { layoutTheme: 'classic', colorTheme: 'day', styleTheme: 'hub', assets: { menu: 'deep', 'context-menu': 'nested', toolbar: 'wide', button: 'rounded', branding: 'amberx' }, iconPack: 'filled', parts: { menu: { itemGap: 4, fontSize: 110 }, button: { radius: 'lg', hover: 'lift' } }, extras: { spacing: 'regular', hidden: { toolbar: true, menu: true }, settings: { 'axf.tokens.button': { radius: 'lg' } } } };
const assets = {
  menu: { standard: { menus: [{ id: 'file', items: [{ id: 'open' }] }], compact: false }, deep: { menus: [{ id: 'file', items: [{ id: 'recent', items: [{ id: 'a' }] }] }], compact: true } },
  'context-menu': { flat: { targets: { default: [{ id: 'copy' }] } }, nested: { targets: { default: [{ id: 'more', items: [{ id: 'x', items: [{ id: 'y' }] }] }] } } },
  toolbar: { icons: { groups: [{ id: 'a' }, { id: 'b' }] }, wide: { groups: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] } },
};
const assetOf = (type, id) => assets[type]?.[id] ?? null;

const lookPart = { slots: { layout: 'classic', 'color-theme': 'night', 'style-theme': 'hub', menu: 'standard', button: 'rounded', 'uac-policy': 'admin', skin: 'windows', 'Bad Id': 'x' }, spacing: 'tight', hidden: { toolbar: false, menu: 'yes' }, settings: { 'axf.tokens.button': { radius: 'md' } } };
const fill = { layout: 'fallback-layout', 'color-theme': 'fallback-colour', 'style-theme': 'fallback-style' };

const IN = { registry, customize, never, config, junk, base, generated, assets, lookPart, fill };

/* ---------------------------------------------------------------- outputs */

const tree = S.skinConfigTree(registry, customize, never);
const normalized = S.normalizeSkinConfig(config, tree);
const defaultSkin = S.defaultSkinOf('demo', lookPart, {}, never);
const out = {
  tree,
  summary: S.treeSummary(tree),
  optionPaths: S.optionPaths(tree),
  limitDeclarationErrors: { menu: S.limitDeclarationErrors('menu', registry.types.menu), bad: S.limitDeclarationErrors('bad', { skinConfig: { limits: { depth: { measure: 'width', root: 3 }, groups: { measure: 'count', max: 'x' }, n: { measure: 'count:groups', min: 5, max: 2 } } } }), notObject: S.limitDeclarationErrors('odd', { skinConfig: 'yes' }) },
  normalized,
  errors: { config: S.skinConfigErrors(config, tree), junk: S.skinConfigErrors(junk, tree), notObject: S.skinConfigErrors('x', tree) },
  parse: { junk: S.parseSkinConfig(JSON.stringify(junk), tree), bad: S.parseSkinConfig('{', tree), big: S.parseSkinConfig('x'.repeat(S.SKIN_CONFIG_MAX_BYTES + 1), tree) },
  effective: S.effectiveConfig(normalized, tree),
  fresh: S.effectiveConfig(S.newSkinConfig('demo'), tree).counts,
  moves: (() => {
    let c = S.newSkinConfig('demo');
    const steps = [];
    c = S.setConfigMode(c, tree, 'menu', 'lock'); steps.push(c);
    c = S.setConfigMode(c, tree, 'menu/pick', 'ask'); steps.push(c);
    c = S.setConfigMode(c, tree, 'menu/pick/asset', 'allow'); steps.push(c);
    c = S.setConfigLimit(c, tree, 'toolbar', 'groups', 99); steps.push(c);
    c = S.setConfigDefault(c, 'ask'); steps.push(c);
    c = S.setConfigMode(c, tree, 'menu/pick/asset', null); steps.push(c);
    c = S.setConfigMode(c, tree, 'menu/pick', null); c = S.setConfigMode(c, tree, 'menu', null); steps.push(c);
    c = S.setConfigLimit(c, tree, 'toolbar', 'groups', null); steps.push(c);
    steps.push(S.resetSkinConfig({ ...c, updatedBy: 'brett' }));
    return steps;
  })(),
  badMoves: ['nowhere', 'menu/nowhere', 'menu/pick/nowhere', 'a/b/c/d'].map((p) => { try { S.setConfigMode(S.newSkinConfig('demo'), tree, p, 'lock'); return ''; } catch (e) { return e.message; } }),
  depth: {
    menuFlat: S.measureAsset(assets.menu.standard, S.findLimit(tree, 'menu', 'depth')),
    menuDeep: S.measureAsset(assets.menu.deep, S.findLimit(tree, 'menu', 'depth')),
    contextFlat: S.measureAsset(assets['context-menu'].flat, S.findLimit(tree, 'context-menu', 'depth')),
    contextNested: S.measureAsset(assets['context-menu'].nested, S.findLimit(tree, 'context-menu', 'depth')),
    contextEmpty: S.measureAsset({ targets: {} }, S.findLimit(tree, 'context-menu', 'depth')),
    toolbarCount: S.measureAsset(assets.toolbar.wide, S.findLimit(tree, 'toolbar', 'groups')),
    none: S.measureAsset(assets.toolbar.wide, null),
  },
  report: S.skinChangeReport(generated, base, normalized, tree, assetOf),
  merge: S.mergeWithDefault(generated, base, normalized, tree, assetOf),
  mergeAllAllowed: S.mergeWithDefault(generated, base, S.newSkinConfig('demo'), tree, assetOf).skin,
  brief: { config: S.skinConfigBrief(normalized, tree), fresh: S.skinConfigBrief(S.newSkinConfig('demo'), tree), lockAll: S.skinConfigBrief(S.setConfigMode(S.setConfigDefault(S.newSkinConfig('demo'), 'lock'), tree, 'button', 'allow'), tree) },
  schema: (() => { const s = S.skinConfigSchema(tree); return { required: s.required, defs: Object.keys(s.$defs), categories: Object.keys(s.properties.categories.properties), menu: s.properties.categories.properties.menu }; })(),
  snapshot: S.skinConfigSnapshot(tree),
  defaultSkin,
  defaultSkinFilled: S.defaultSkinOf('demo', { slots: { button: 'rounded' } }, fill, never),
  defaultSkinGlobal: S.defaultSkinOf('global', { spacing: 'compact' }, fill, never),
  defaultSkinErrors: { good: S.defaultSkinErrors(defaultSkin), bare: S.defaultSkinErrors(S.defaultSkinOf('demo', {}, {}, never)), notDefault: S.defaultSkinErrors({ ...defaultSkin, protected: false }) },
  deletion: { defaultSkin: S.skinDeleteError(defaultSkin), other: S.skinDeleteError({ type: 'skin', id: 'windows' }), forged: S.skinDeleteError({ ...defaultSkin, id: 'default-other' }) },
  migration: {
    create: S.defaultSkinMigration('demo', lookPart, null, {}, never),
    keep: S.defaultSkinMigration('demo', lookPart, { ...defaultSkin, updatedAt: '2026-11-13T00:00:00Z', updatedBy: 'skins-cli' }, {}, never),
    update: S.defaultSkinMigration('demo', { ...lookPart, spacing: 'regular' }, defaultSkin, {}, never),
    replaceForeign: S.defaultSkinMigration('demo', lookPart, { type: 'skin', id: 'default-demo', data: {} }, {}, never),
    skip: S.defaultSkinMigration('demo', { slots: {} }, null, {}, never),
  },
};

if (WRITE) { writeFileSync(FIX, `${JSON.stringify({ $axf: S.SKIN_CONFIG_CONTRACT, note: 'Generated by framework/spec/check-skin-config.mjs --write; every port replays `in` and must answer `out`.', in: IN, out }, null, 1)}\n`); console.log(`wrote ${FIX}`); }
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
t('fixture inputs are the ones in this file', () => assert.ok(same(fx.in, IN), 'inputs drifted: run with --write'));
t('fixture outputs match the engine', () => { for (const k of Object.keys(out)) assert.ok(same(fx.out[k], out[k]), `out.${k} differs: run with --write and review the diff`); assert.deepEqual(Object.keys(fx.out), Object.keys(out)); });

/* ---------------------------------------------------------------- the tree over the small registry */

t('every category is a type a skin can reach (slot / parts / reference) or the extras; bundle, none and uncovered types are not categories', () => {
  const rows = coverageTable(registry.types, customize.targets, never);
  const reachable = rows.filter((r) => ['slot', 'parts', 'reference'].includes(r.by)).map((r) => r.type);
  assert.deepEqual(tree.categories.map((c) => c.type), [...reachable, 'extras']);
  assert.ok(!tree.categories.some((c) => ['skin', 'uac-policy', 'orphan'].includes(c.type)));
});
t('categories keep registry order and take the registry group as their section', () => { assert.equal(tree.categories[0].type, 'color-theme'); assert.equal(tree.categories[0].section, 'Themes'); assert.equal(S.findCategory(tree, 'badge').section, 'Widgets'); });
t('a slot type gets pick + fields; nested keys are one option each; enums are named', () => {
  const g = S.findGroup(tree, 'color-theme', 'fields');
  assert.deepEqual(g.options.map((o) => o.id), ['tokens.bg', 'tokens.fg', 'tokens.accent', 'scheme']);
  assert.match(S.findOption(tree, 'color-theme', 'fields', 'scheme').label, /light \/ dark/);
  assert.ok(S.findGroup(tree, 'color-theme', 'pick'));
});
t('a widget type gets only parts groups, one per customize group, tokens filtered by type', () => {
  const badge = S.findCategory(tree, 'badge');
  assert.deepEqual(badge.groups.map((g) => g.id), ['parts.text', 'parts.colour', 'parts.shape', 'parts.hover', 'parts.other']);
  assert.ok(badge.groups.every((g) => g.kind === 'parts'));
  assert.ok(!badge.groups.some((g) => g.options.some((o) => o.id === 'itemGap')), 'itemGap is for menus and toolbars only');
  assert.ok(S.findOption(tree, 'menu', 'parts.layout', 'itemGap'));
  assert.equal(S.findOption(tree, 'badge', 'parts.other', 'broken').kind, 'token', 'a token without a group lands in Other as a plain token');
});
t('hideable types get a chrome group; others do not', () => { assert.ok(S.findGroup(tree, 'menu', 'chrome')); assert.ok(S.findGroup(tree, 'toolbar', 'chrome')); assert.equal(S.findGroup(tree, 'button', 'chrome'), null); });
t('reference types pick through their via', () => { assert.equal(S.findGroup(tree, 'icon-pack', 'pick').options[0].id, 'iconPack'); assert.equal(S.findGroup(tree, 'logo-mark', 'pick').options[0].id, 'branding'); });
t('the extras category comes from the registry declaration, last', () => { const x = tree.categories.at(-1); assert.equal(x.type, 'extras'); assert.deepEqual(x.groups[0].options.map((o) => o.id), ['spacing', 'settings']); });
t('limits: declared ones only, clamped defaults, root kept for depth', () => {
  assert.deepEqual(S.findCategory(tree, 'menu').limits.map((l) => [l.id, l.measure, l.min, l.max, l.default]), [['depth', 'depth', 1, 4, 2]]);
  assert.equal(S.findLimit(tree, 'context-menu', 'depth').root, 'targets');
  assert.deepEqual(S.findCategory(tree, 'toolbar').limits.map((l) => [l.measure, l.field]), [['count', 'groups']]);
  assert.deepEqual(S.findCategory(tree, 'button').limits, []);
});
t('no registry at all gives an empty tree', () => assert.deepEqual(S.skinConfigTree(null).categories, []));

/* ---------------------------------------------------------------- documents and modes */

t('normalize drops unknown categories, options and modes, clamps limits, keeps who saved it', () => {
  assert.ok(!normalized.categories.nothing);
  assert.ok(!normalized.categories.button, 'button had only junk: an unknown option, a bad mode, a limit it has not');
  assert.equal(normalized.categories['context-menu'].limits.depth, 3);
  assert.equal(normalized.updatedBy, 'brett');
  assert.equal(S.normalizeSkinConfig({ $axf: 'other@1' }, tree), null);
});
t('errors name every problem of the junk document', () => {
  const e = out.errors.junk;
  assert.ok(e.some((m) => m.startsWith('default must be')));
  assert.ok(e.some((m) => m.includes('categories.color-theme.mode')));
  assert.ok(e.some((m) => m.includes('groups.fields must be an object')));
  assert.ok(e.some((m) => m.includes('options.other: not an option')));
  assert.ok(e.some((m) => m.includes('limits.depth must be an integer 1–4')));
  assert.ok(e.some((m) => m.includes('limits.width: menu has no such limit')));
  assert.ok(e.some((m) => m.includes('categories.ghost: not a category')));
  assert.equal(out.errors.notObject.length, 1);
});
t('the most specific setting wins: option > group > category > default', () => {
  assert.deepEqual([S.optionMode(normalized, 'color-theme', 'pick', 'asset'), S.optionModeFrom(normalized, 'color-theme', 'pick', 'asset')], ['lock', 'category']);
  assert.deepEqual([S.optionMode(normalized, 'menu', 'pick', 'asset'), S.optionModeFrom(normalized, 'menu', 'pick', 'asset')], ['ask', 'group']);
  assert.deepEqual([S.optionMode(normalized, 'menu', 'parts.layout', 'itemGap'), S.optionModeFrom(normalized, 'menu', 'parts.layout', 'itemGap')], ['lock', 'option']);
  assert.deepEqual([S.optionMode(normalized, 'menu', 'parts.layout', 'fontSize'), S.optionModeFrom(normalized, 'menu', 'parts.layout', 'fontSize')], ['allow', 'default']);
  assert.equal(S.optionMode(null, 'menu', 'pick', 'asset'), 'allow');
});
t('a fresh config allows everything and takes every limit default', () => {
  assert.equal(out.fresh.lock + out.fresh.ask, 0);
  assert.equal(out.fresh.allow, out.summary.options);
  assert.deepEqual(S.effectiveConfig(S.newSkinConfig('demo'), tree).limits, { 'menu/depth': 2, 'context-menu/depth': 1, 'toolbar/groups': 3 });
  assert.equal(S.newSkinConfig('Not An Id').app, 'global');
});
t('limits in force are the document’s, clamped', () => { assert.equal(S.limitValue(normalized, tree, 'menu', 'depth'), 1); assert.equal(S.limitValue(normalized, tree, 'context-menu', 'depth'), 3); assert.equal(S.limitValue(normalized, tree, 'toolbar', 'groups'), 3); assert.equal(S.limitValue(normalized, tree, 'button', 'depth'), null); });
t('the panel’s moves: set, inherit again, clamp, reset; the document never keeps empty nodes', () => {
  const [a, b, c, d, e, f, g, h, reset] = out.moves;
  assert.equal(a.categories.menu.mode, 'lock');
  assert.equal(b.categories.menu.groups.pick.mode, 'ask');
  assert.equal(S.optionMode(c, 'menu', 'pick', 'asset'), 'allow');
  assert.equal(d.categories.toolbar.limits.groups, 6);
  assert.equal(e.default, 'ask');
  assert.ok(!f.categories.menu.groups.pick.options);
  assert.ok(!g.categories.menu);
  assert.ok(!h.categories.toolbar);
  assert.deepEqual(reset, { ...S.newSkinConfig('demo'), updatedBy: 'brett' });
  assert.throws(() => S.setConfigMode(S.newSkinConfig('demo'), tree, 'menu', 'maybe'));
  assert.throws(() => S.setConfigLimit(S.newSkinConfig('demo'), tree, 'menu', 'depth', 1.5));
  assert.throws(() => S.setConfigLimit(S.newSkinConfig('demo'), tree, 'button', 'depth', 1));
  assert.throws(() => S.setConfigDefault(S.newSkinConfig('demo'), 'no'));
  assert.ok(out.badMoves.every(Boolean));
});

/* ---------------------------------------------------------------- limits measured on assets */

t('depth: 1 = flat for every menu type (root lists count as the first level), 0 = nothing built', () => assert.deepEqual([out.depth.menuFlat, out.depth.menuDeep, out.depth.contextFlat, out.depth.contextNested, out.depth.contextEmpty, out.depth.toolbarCount, out.depth.none], [1, 2, 1, 3, 0, 4, 0]));

/* ---------------------------------------------------------------- a generated skin against the Default */

t('the change report names every difference with the option that governs it and its mode', () => {
  const by = Object.fromEntries(out.report.map((r) => [r.path, r]));
  assert.equal(by['color-theme/pick/asset'].mode, 'lock');
  assert.equal(by['menu/pick/asset'].mode, 'ask');
  assert.equal(by['menu/fields/compact'].mode, 'allow');
  assert.equal(by['menu/parts.layout/itemGap'].mode, 'lock');
  assert.equal(by['menu/parts.text/fontSize'].mode, 'allow');
  assert.equal(by['toolbar/chrome/hidden'].mode, 'lock');
  assert.equal(by['menu/chrome/hidden'].mode, 'allow');
  assert.equal(by['icon-pack/pick/iconPack'].mode, 'allow');
  assert.equal(by['extras/look/spacing'].mode, 'allow');
  assert.equal(by['extras/look/settings'].mode, 'lock');
  assert.equal(by['button/parts.shape/radius'].mode, 'allow');
  assert.ok(!by['button/pick/asset'], 'the button slot did not move');
});
t('a new asset over a limit is a lock row with the measure: the menu went two levels deep under a limit of 1, the toolbar built 4 groups under 3', () => {
  const menu = out.report.find((r) => r.path === 'menu/limits/depth'); assert.deepEqual([menu.mode, menu.value, menu.max], ['lock', 2, 1]);
  const tb = out.report.find((r) => r.path === 'toolbar/limits/groups'); assert.deepEqual([tb.mode, tb.value, tb.max], ['lock', 4, 3]);
  assert.ok(!out.report.some((r) => r.path === 'context-menu/limits/depth'), 'three context-menu levels are within the clamped limit of 3');
});
t('merge: locked changes go back to the Default, asks stay and are listed, allowed changes stay', () => {
  const m = out.merge;
  assert.equal(m.skin.colorTheme, 'night');
  assert.equal(m.skin.assets.menu, 'standard', 'over the depth limit → the Default’s menu');
  assert.equal(m.skin.assets.toolbar, 'icons', 'over the groups limit → the Default’s toolbar');
  assert.equal(m.skin.assets['context-menu'], 'nested', 'within its limit and allowed');
  assert.equal(m.skin.iconPack, 'filled');
  assert.deepEqual(m.skin.parts.menu, { itemGap: 2, fontSize: 110 });
  assert.deepEqual(m.skin.parts.button, { radius: 'lg', hover: 'lift' });
  assert.deepEqual(m.skin.extras, { spacing: 'regular', hidden: { toolbar: false, menu: true }, settings: { 'axf.tokens.button': { radius: 'md' } } });
  assert.deepEqual(m.asks.map((r) => r.path), ['menu/pick/asset']);
  assert.ok(m.kept.length >= 5);
  assert.deepEqual(m.patches, [], 'the menu whose field changed was itself reverted, so its patch is moot');
});
t('merge with everything allowed keeps every change, but the default limits still hold (context menu 3 levels under 1, toolbar 4 groups under 3 go back; the menu at 2 levels under 2 stays)', () => {
  assert.deepEqual(out.mergeAllAllowed, { ...generated, assets: { ...generated.assets, 'context-menu': 'flat', toolbar: 'icons' } });
});
t('merge survives junk', () => { const r = S.mergeWithDefault(null, null, null, tree); assert.deepEqual(r.skin, { assets: {} }); assert.deepEqual(r.kept, []); });

/* ---------------------------------------------------------------- the words */

t('the brief spells out only the exceptions to the default, then the limits', () => {
  // the item gap is the only layout part a menu has, so the whole group is named; the extras group is split by option
  assert.ok(out.brief.config[0].startsWith('Locked, keep exactly as the Default skin has it: Colour theme; Menu · Style parts · Layout; Toolbar · Shown or hidden; Look extras · The look as a whole · Look settings'));
  assert.ok(out.brief.config[1].startsWith('Ask before changing (propose, do not apply): Menu · Pick another menu.'));
  assert.equal(out.brief.config[2], 'Everything else in the skin you may change.');
  assert.ok(out.brief.config.some((l) => l === 'Menu: menu levels the AI may build (1 = flat) at most 1.'));
  assert.equal(out.brief.fresh[0], 'You may change everything in the skin.');
  assert.ok(out.brief.lockAll[0].startsWith('You may change: Button.'));
  assert.equal(out.brief.lockAll[1], 'Everything else stays exactly as the Default skin has it.');
});
t('the JSON Schema enumerates the tree and shares one mode definition', () => {
  assert.deepEqual(out.schema.required, ['$axf', 'app']);
  assert.deepEqual(out.schema.defs, ['mode']);
  assert.deepEqual(out.schema.categories, tree.categories.map((c) => c.type));
  assert.deepEqual(out.schema.menu.properties.limits.properties.depth, { type: 'integer', minimum: 1, maximum: 4, default: 2, description: 'Menu levels the AI may build (1 = flat)' });
  assert.equal(out.schema.menu.properties.groups.properties.pick.properties.options.properties.asset.$ref, '#/$defs/mode');
});

/* ---------------------------------------------------------------- the Default skin */

t('the Default skin is the saved look as a protected skin@1 asset: themes from the slots, never-slots and bad ids dropped, extras kept', () => {
  assert.equal(defaultSkin.id, 'default-demo');
  assert.equal(defaultSkin.name, 'Default');
  assert.ok(defaultSkin.protected && defaultSkin.app === 'demo' && defaultSkin.roll === false);
  assert.deepEqual([defaultSkin.data.layoutTheme, defaultSkin.data.colorTheme, defaultSkin.data.styleTheme], ['classic', 'night', 'hub']);
  assert.deepEqual(defaultSkin.data.assets, { menu: 'standard', button: 'rounded' });
  assert.deepEqual(defaultSkin.data.extras, { spacing: 'tight', hidden: { toolbar: false }, settings: { 'axf.tokens.button': { radius: 'md' } } });
  assert.ok(S.isDefaultSkin(defaultSkin));
  assert.deepEqual(out.defaultSkinErrors.good, []);
});
t('themes the look lacks come from the fill; a bare look is skipped with every missing theme named', () => {
  assert.deepEqual([out.defaultSkinFilled.data.layoutTheme, out.defaultSkinFilled.data.colorTheme, out.defaultSkinFilled.data.styleTheme], ['fallback-layout', 'fallback-colour', 'fallback-style']);
  assert.equal(out.defaultSkinErrors.bare.length, 3);
  assert.equal(out.migration.skip.action, 'skip');
});
t('the hub-wide Default is default-global', () => { assert.equal(out.defaultSkinGlobal.id, 'default-global'); assert.equal(out.defaultSkinGlobal.app, 'global'); assert.equal(out.defaultSkinGlobal.data.extras.spacing, 'compact'); });
t('the Default skin can’t be deleted; a forged marker does not count', () => { assert.ok(out.deletion.defaultSkin); assert.equal(out.deletion.other, ''); assert.equal(out.deletion.forged, ''); assert.ok(!S.canDeleteSkin(defaultSkin)); assert.ok(out.defaultSkinErrors.notDefault.length === 1); });
t('the migration is idempotent: create, then keep (stamps ignored), update when the look moved or the hub copy is foreign', () => {
  assert.equal(out.migration.create.action, 'create');
  assert.equal(out.migration.keep.action, 'keep');
  assert.equal(out.migration.update.action, 'update'); assert.equal(out.migration.update.skin.data.extras.spacing, 'regular');
  assert.equal(out.migration.replaceForeign.action, 'update');
  assert.ok(same(out.migration.create.skin, defaultSkin), 'two runs over the same look give the same document');
});

/* ---------------------------------------------------------------- the real registry */

const real = readJson('framework/schemas/asset-types.json');
const realCustomize = readJson('framework/schemas/customize.json');
const realTree = S.skinConfigTree(real, realCustomize, SKIN_NEVER);
t('every skinConfig declaration in asset-types.json is valid', () => { for (const [type, spec] of Object.entries(real.types)) assert.deepEqual(S.limitDeclarationErrors(type, spec), []); });
t('the real tree covers every type a skin can reach, in registry order, plus the extras', () => {
  const reachable = coverageTable(real.types, realCustomize.targets, SKIN_NEVER).filter((r) => ['slot', 'parts', 'reference'].includes(r.by)).map((r) => r.type);
  assert.deepEqual(realTree.categories.map((c) => c.type), [...reachable, S.SKIN_CONFIG_EXTRAS]);
});
t('every hideable type has a chrome group; every type with a style target has parts groups; every declared limit is in its category', () => {
  for (const [type, spec] of Object.entries(real.types)) {
    const cat = S.findCategory(realTree, type);
    if (!cat) continue;
    if (spec.hideable === true) assert.ok(S.findGroup(realTree, type, 'chrome'), `${type} is hideable but has no chrome group`);
    if (realCustomize.targets[type]) assert.ok(cat.groups.some((g) => g.kind === 'parts'), `${type} has a style target but no parts groups`);
    assert.deepEqual(cat.limits.map((l) => l.id), Object.keys(spec.skinConfig?.limits ?? {}));
  }
});
t('menu types declare a depth limit the AI is held to (every type with nested menu items)', () => {
  const menuTypes = Object.entries(real.types).filter(([, s]) => (s.required ?? []).some((k) => ['menus', 'targets', 'sections'].includes(k)) && S.findCategory(realTree, s) !== undefined).map(([k]) => k);
  for (const type of menuTypes) if (S.findCategory(realTree, type)) assert.ok(S.findLimit(realTree, type, 'depth'), `${type} builds nested items but declares no depth limit`);
});
t('the snapshot schemas/skin-config.json and schemas/json/skin-config.schema.json are current (run: node framework/cli/axf.mjs schemas)', () => {
  assert.ok(same(readJson('framework/schemas/skin-config.json'), S.skinConfigSnapshot(realTree)), 'schemas/skin-config.json is stale');
  assert.ok(same(readJson('framework/schemas/json/skin-config.schema.json'), S.skinConfigSchema(realTree)), 'schemas/json/skin-config.schema.json is stale');
});
t('the vocabularies are the contract (docs and the panel print them)', () => {
  assert.deepEqual(S.SKIN_CONFIG_MODES, ['allow', 'lock', 'ask']);
  assert.deepEqual(S.SKIN_CONFIG_GROUP_KINDS, ['pick', 'fields', 'parts', 'chrome', 'look']);
  assert.deepEqual(S.SKIN_CONFIG_MEASURES, ['depth', 'count']);
  assert.equal(S.skinConfigPath('axf-console'), 'settings/skin-config/axf-console.json');
  assert.equal(S.defaultSkinPath('axf-console'), 'settings/skins/axf-console.json');
});

console.log(`✓ skin-config@1: ${n} checks passed (${out.summary.options} options in the fixture tree, ${S.treeSummary(realTree).options} in the real one)`);

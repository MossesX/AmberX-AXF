/**
 * skin@2 + app-look@1: the format and its rules against spec/fixtures/skin.json (sections written in the skin or as
 * presets, the conversion of design and style packages, the capture, the legacy-look migration), the build engine's
 * validator agrees, every framework skin resolves against framework assets, and the runtime behaviour: landing changes
 * nothing on screen (snapshot = the current look), a skin stays in its own app, off gives the app's look back,
 * overrides, Restore + one undo, inline sections registered as presets.
 *   npx -y tsx framework/spec/check-skin.mts
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { backToSkin, captureSkin, composeLook, composeLookAt, coverageSummary, coverageTable, declarationErrors, globalSkinOf, lookAfterChange, migrateLegacyLook, newAppLook, normalizeAppLook, normalizeSkin, normalizeSkinScope, partElements, partsErrors, partsTypes, resolveLookSkin, resolveSkinChain, scopeEntries, scopeState, setInheritSkin, setScopeOverride, setScopeSkin, skinCoverage, skinCoverageSummary, skinCovers, skinPartsTypes, skinScopeChain, skinScopeKey, skinScopeKind, skinScopeSelector, skinUncovered, uncoveredTypes, parseAppLook, pickSkin, restoreAppDefault, setUseSkin, skinErrors, skinFromDesignPackage, skinFromStylePackage, skinSectionAssets, skinSectionErrors, skinSlots, snapshotLook, undoRestore, SKIN_SECTIONS, type AppLookDocument, type AppLookStore } from '../core/engines/skin';
import { validateAsset } from '../core/validate';
import { AxfRuntime, type AppearanceSource } from '../core/runtime';
import { mergeAppearance, parseAppearance, type AppearanceDocument, type AppearanceSourceState } from '../core/engines/appearance';
import type { AxfManifest } from '../core/types';
import * as engine from '../cli/build-engine.mjs';

const root = new URL('../', import.meta.url).pathname;
{ const m = new Map<string, string>(); (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; }
let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };

/* ---- the contract: same results as the golden file (ids in fixtures are the fixture's own) ---- */
const fx = JSON.parse(readFileSync(join(root, 'spec/fixtures/skin.json'), 'utf8'));
const skin = fx.normalize.good;
eq(normalizeSkin(fx.normalize.good), skin, 'normalize keeps a good skin');
ok(!('uac-policy' in fx.normalize.junk.assets) && !('layout' in fx.normalize.junk.assets) && !fx.normalize.junk.extras?.spacing, 'junk is dropped');
eq(skinErrors(skin), [], 'a good skin passes');
eq(skinSlots(skin), fx.slots, 'slots = themes + assets');
for (const bad of [{ assets: {} }, { ...skin, assets: { 'uac-policy': 'x', layout: 'y' } }, { ...skin, extras: { spacing: 'huge', hidden: { a: 1 } } }, 7, { ...skin, preview: 1 }]) {
  eq((engine as unknown as { skinErrors(d: unknown): string[] }).skinErrors(bad), skinErrors(bad), 'build engine agrees');
  ok(skinErrors(bad).length, 'bad skin refused');
}
eq(skinFromDesignPackage({ 'style-theme': 's', 'color-theme': 'c', layout: 'l', 'behavior-theme': 'b', extras: { slots: { button: 'x', 'style-package': 'pack' }, spacing: 'tight', hidden: { toolbar: true } } }, (id) => (id === 'pack' ? { button: 'pack-button', dialog: 'pack-dialog' } : null)), fx.fromDesignPackage, 'a design package reads as a skin (its style package expanded, its own slots winning)');
eq(fx.fromDesignPackage.behaviorTheme, 'b', 'the behaviour theme is the behaviour section');
eq(fx.fromDesignPackage.assets, { button: 'x', dialog: 'pack-dialog' }, 'the style package members are assets');
eq(skinFromStylePackage({ slots: { button: 'bb', container: 'cc' }, tone: 'formal' }, normalizeSkin(skin)), fx.fromStylePackage, 'a style package reads as the base skin with its controls');
/* ---- skin@2 sections ---- */
eq(SKIN_SECTIONS, { colors: 'color-theme', style: 'style-theme', layout: 'layout', behavior: 'behavior-theme' }, 'four sections, each a section preset type');
eq(fx.normalize.sectioned.sections.colors.scheme, 'dark', 'an inline colour section is kept');
eq(fx.normalize.sectioned.behaviorTheme, 'snappy', 'the behaviour preset is kept');
eq(fx.normalize.legacyBehavior.behaviorTheme, 'calm', 'skin@1 kept the behaviour in assets: read as the behaviour section');
ok(!('behavior-theme' in fx.normalize.legacyBehavior.assets), 'and it is no longer an asset');
ok(!('design-package' in fx.normalize.junk.assets), 'a retired package slot in assets is dropped');
eq(fx.errors.sectioned, [], 'a skin with an inline section validates');
eq(fx.errors.inlineOnly, [], 'a skin made only of inline sections validates (no preset ids needed)');
ok(fx.errors.badSections.length >= 4 && fx.errors.badSections.some((e: string) => e.includes('data.sections.colors.scheme')) && fx.errors.badSections.some((e: string) => e.includes('data.sections.layout')) && fx.errors.badSections.some((e: string) => e.includes('data.sections.behavior: data.motion.speed')) && fx.errors.badSections.some((e: string) => e.includes('data.sections.nope')), 'every bad section is named with its own validator\'s message');
eq(fx.errors.sectionNotObject, ['data.sections.colors must be an object (color-theme data)'], 'a section must be an object');
ok(fx.errors.never.some((e: string) => e.includes('style-package')), 'a retired package in assets is refused');
eq(fx.sectionedSlots['color-theme'], 'skin-windows', 'an inline section resolves to the preset named after the skin');
eq(fx.sectionedSlots['behavior-theme'], 'snappy', 'the behaviour section is a slot too');
eq(fx.sectionAssets.map((a: { type: string; id: string }) => [a.type, a.id]), [['color-theme', 'skin-windows']], 'one section asset per inline section');
for (const bad of [{ ...skin, sections: { colors: { scheme: 'neon' } } }, { assets: {}, sections: { colors: 3 } }]) eq((engine as unknown as { skinErrors(d: unknown): string[] }).skinErrors(bad), skinErrors(bad), 'build engine agrees on sections');
eq(skinSectionErrors('style', { fontFamily: 'x' }).length > 3, true, 'a style section needs the style theme\'s fields');
/* ---- capture + the legacy look ---- */
eq(fx.capture.extras.settings, { 'axf.banners.prefs': { a: 1 } }, 'capture keeps only look settings');
eq([fx.capture.colorTheme, fx.capture.behaviorTheme, Object.keys(fx.capture.assets)], ['a', 'b', ['toolbar']], 'capture: the four sections, every other slot as an asset (never the policy or the skin)');
eq(fx.legacyLook.read.skin.id, 'fresh-night', 'an old look naming design packages reads with that skin picked (the own pick beats the snapshot\'s)');
ok(!fx.legacyLook.read.skin.use, 'but Use skin stays as it was: the section slots still resolve, so nothing moves');
ok(!('design-package' in fx.legacyLook.read.default.slots) && !('style-package' in fx.legacyLook.read.default.slots) && !('design-package' in fx.legacyLook.read.own.slots), 'the retired slots are gone');
eq(fx.legacyLook.read.default.slots['color-theme'], 'hub-night', 'the section slots stay');
eq(migrateLegacyLook(fx.legacyLook.read), fx.legacyLook.read, 'idempotent');

const shared = fx.look.shared as AppearanceDocument;
// the fixture's shared document still names a design package (an older build wrote it): composing drops that retired slot
const sharedSlots = Object.fromEntries(Object.entries(shared.slots ?? {}).filter(([t]) => t !== 'design-package'));
const look0 = newAppLook('app', snapshotLook(shared));
eq(look0.default, fx.look.snapshot, 'snapshot');
eq(composeLook(shared, look0, null), fx.look.off, 'skin off = the snapshot');
eq(composeLook(shared, look0, null).slots, sharedSlots, 'snapshot = no visual change (the retired package slot dropped)');
eq(composeLook(shared, look0, null).hidden, shared.hidden, 'snapshot keeps chrome');
eq(composeLook(fx.look.shared && { ...shared, slots: { ...shared.slots, 'color-theme': 'other-theme' }, settings: { 'axf.tokens.button': 'y', 'axf.banners.group': 'other' } }, look0, null), fx.look.offSharedMoved, 'a moved shared document changes only shared tokens');
const on = setUseSkin(pickSkin(look0, 'windows'), true);
eq(composeLook(shared, on, skin), fx.look.on, 'skin on');
eq(composeLook(shared, on, null), fx.look.unknownSkin, 'an unknown skin reads as off');
const over = lookAfterChange(on, { slots: { 'color-theme': 'aurora-night' } }, skin);
eq(over, fx.look.overridden.doc, 'a pick overrides just that part');
eq(composeLook(shared, over, skin), fx.look.overridden.composed, 'override wins');
eq(composeLook(shared, backToSkin(over, 'color-theme'), skin), fx.look.overridden.backToSkin, 'back to skin');
eq(lookAfterChange(over, { slots: { 'color-theme': skin.colorTheme } }, skin).skin.overrides, {}, "picking the skin's own theme drops the override");
eq(lookAfterChange(look0, { slots: { button: 'terminal' }, hidden: { toolbar: false } }, null), fx.look.own.doc, 'no skin: picks are the app\'s own');
const restored = restoreAppDefault(over, '2026-11-05T00:00:00Z');
eq(restored, fx.look.restored.doc, 'restore keeps one undo');
eq(composeLook(shared, restored, null).slots, sharedSlots, 'restore = the snapshot');
eq(undoRestore(restored).skin, fx.look.restored.undone, 'undo');
eq(undoRestore(undoRestore(restored)), undoRestore(restored), 'one undo only');
eq(parseAppLook(JSON.stringify(restored)), restored, 'round trip');
ok(parseAppLook('{"$axf":"appearance@1"}') === null, 'wrong frame refused');

/* ---- every framework skin is real assets ---- */
const assets: Record<string, unknown>[] = [];
for (const t of readdirSync(join(root, 'assets'))) {
  const dir = join(root, 'assets', t);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir)) if (f.endsWith('.json')) assets.push(JSON.parse(readFileSync(join(dir, f), 'utf8')));
}
const win = assets.find((a) => a.type === 'skin' && a.id === 'windows');
const skinsShipped = assets.filter((a) => a.type === 'skin');
ok(skinsShipped.length >= 40, `${skinsShipped.length} skins ship (every former design package and style package is one)`);
for (const sk of skinsShipped) {
  eq(validateAsset(sk).errors, [], `skin ${sk.id} validates`);
  for (const [t, id] of Object.entries(skinSlots(normalizeSkin(sk.data), sk.id as string))) ok(assets.some((a) => a.type === t && a.id === id) || skinSectionAssets(sk.id as string, normalizeSkin(sk.data)).some((a) => a.type === t && a.id === id), `${sk.id}: ${t} ${id} exists`);
}
ok(!assets.some((a) => a.type === 'design-package' || a.type === 'style-package'), 'no design or style package assets left');
for (const id of ['fresh', 'hub-default', 'fresh-night', 'boardroom', 'amberx-signature-day']) ok(skinsShipped.some((a) => a.id === id), `former package ${id} is a skin with the same id`);

const bar = (assets.find((a) => a.type === 'banner' && a.id === 'windows-titlebar')!.data) as { logo: { text: string }; attach: { type: string; id: string; order?: number; widget?: { overflow?: boolean } }[] };
eq(bar.logo.text, '{app}', "the title bar shows each app's own name");
const winButtons = bar.attach.filter((x) => x.type === 'action-button');
eq(winButtons.map((x) => x.id), ['win-minimize', 'win-maximize', 'win-close'], 'minimize, maximize, close, in that order');
ok(winButtons.every((x) => (x.order ?? 0) >= 100000 && x.widget?.overflow === false), 'the window buttons stay last on the bar and never go in the ⋯ menu');
const bannerSource = readFileSync(join(root, 'react/components/Banner.tsx'), 'utf8');
ok(/namesApp = data\.logo\?\.text === BANNER_APP_NAME/.test(bannerSource) && /brand\.mode === 'mark'/.test(bannerSource), "a banner that names the app never draws the brand's lockup");
const iconSource = readFileSync(join(root, 'react/components/Icon.tsx'), 'utf8');
for (const x of winButtons) { const icon = (assets.find((a) => a.type === 'action-button' && a.id === x.id)!.data as { icon: string }).icon; ok(new RegExp(`^  '?${icon}'?:`, 'm').test(iconSource), `${x.id}: the icon "${icon}" exists`); }

/* ---- the runtime: two apps on one shared document ---- */
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const manifest = (id: string): AxfManifest => ({ $axf: 'manifest@1', app: { id, name: id, version: '0' }, framework: { version: '0.2.0', template: 'react-ts' }, targets: ['web'], defaults } as unknown as AxfManifest);
class Store implements AppLookStore {
  doc: AppLookDocument | null = null; listeners = new Set<() => void>(); st: ReturnType<AppLookStore['status']> = 'missing';
  get() { return this.doc; } status() { return this.st; }
  save(d: AppLookDocument) { this.doc = d; this.st = 'ready'; }
  subscribe(f: () => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
}
class Source implements AppearanceSource {
  st: AppearanceSourceState = { status: 'ready', version: 'v' }; saved: unknown[] = [];
  listeners = new Set<Parameters<AppearanceSource['subscribe']>[0]>();
  constructor(readonly appLook: Store, readonly doc: AppearanceDocument | null) {}
  state() { return this.st; }
  subscribe(l: Parameters<AppearanceSource['subscribe']>[0]) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  start() { for (const l of this.listeners) { l({ state: this.st }); l({ doc: this.doc, version: 'v' }); } }
  stop() {} refresh() {} save(c: unknown) { this.saved.push(c); }
}
const hubDoc = { $axf: 'appearance@1', slots: { 'color-theme': 'arctic-daylight', 'style-theme': 'hub', layout: 'focus-top', button: 'rounded-solid' }, spacing: 'tight', hidden: { toolbar: true }, settings: { 'axf.banners.group': 'x' } } as unknown as AppearanceDocument;
const boot = (id: string) => {
  const rt = new AxfRuntime({ manifest: manifest(id), assets: assets as never, storageKey: `skin-${id}` });
  const store = new Store();
  const src = new Source(store, hubDoc);
  rt.attachAppearanceSource(src);
  return { rt, store, src, active: () => ({ ...rt.getState().active }) as Record<string, string> };
};
const a = boot('app-a'); const b = boot('app-b');
const plain = new AxfRuntime({ manifest: manifest('app-c'), assets: assets as never, storageKey: 'skin-app-c' });
class Older extends Source { declare appLook: Store; }
const older = new Older(new Store(), hubDoc); delete (older as { appLook?: unknown }).appLook;
plain.attachAppearanceSource(older);
const before = a.active();
eq(before, { ...plain.getState().active }, 'landing changes nothing: same slots as with the shared document alone');
ok(a.store.doc?.default.slots?.['style-theme'] === 'hub', 'the first read saves the snapshot');
eq(a.src.saved, [], 'the snapshot writes nothing to the shared document');

ok(a.rt.useSkin(true, 'windows'), 'Use skin on');
eq(a.active()['color-theme'], 'windows-light', 'the skin colour is on');
eq(a.active()['style-theme'], 'windows', 'the skin style section is on');
eq(a.active().layout, 'windows-explorer', 'the skin layout is on');
eq(a.active().button, 'windows', 'the skin assets are on');
eq(b.active(), before, 'the other app did not move');
eq(a.src.saved, [], 'a skin writes nothing to the shared document');

a.rt.swap('color-theme' as never, 'aurora-night');
eq(a.active()['color-theme'], 'aurora-night', 'a pick overrides the skin');
eq(a.rt.skinOverrides(), ['color-theme'], 'the overridden dot');
eq(a.active()['style-theme'], 'windows', 'the rest stays the skin');
ok(a.rt.backToSkin('color-theme'), 'Back to skin');
eq(a.active()['color-theme'], 'windows-light', 'the skin colour is back');

ok(a.rt.useSkin(false), 'Use skin off');
eq(a.active(), before, 'off = the app\'s own look');
ok(a.store.doc?.skin.id === 'windows', 'off keeps the pick');

a.rt.swap('color-theme' as never, 'aurora-night');
eq(b.active()['color-theme'], before['color-theme'], "no skin: a pick stays in this app");
eq(a.src.saved, [], 'no skin: a pick does not reach the shared document');
a.rt.useSkin(true, 'windows');
a.rt.restoreDefaultAppearance();
eq(a.active(), before, 'Restore = the snapshot, nothing else');
ok(a.rt.appLook()?.undo, 'one undo is kept');
ok(a.rt.undoRestoreDefault(), 'undo');
eq(a.active()['color-theme'], 'windows-light', 'undo brings the skin back');
ok(!a.rt.undoRestoreDefault(), 'a second undo does nothing');
a.rt.restoreDefaultAppearance();

ok(a.rt.useSkin(true, 'hub-default'), 'a former design package is a skin');
ok(!a.rt.useSkin(true, 'no-such-skin'), 'an unknown skin is refused');
a.rt.restoreDefaultAppearance();
eq(a.active(), before, 'and back');

/* the picker's preview draws the skin and saves nothing */
const docBefore = JSON.stringify(a.store.doc);
ok(a.rt.previewSkin('windows'), 'preview a skin');
eq(a.active()['color-theme'], 'windows-light', 'the preview is on screen');
eq(a.rt.previewedSkin(), 'windows', 'the preview is known');
eq(JSON.stringify(a.store.doc), docBefore, 'a preview saves nothing');
eq(a.src.saved, [], 'a preview writes nothing to the shared document');
eq(b.active(), before, 'a preview stays in its own app');
ok(a.rt.previewSkin(null), 'cancel the preview');
eq(a.active(), before, 'cancel puts the look back');
ok(!a.rt.previewSkin('no-such-skin'), 'an unknown skin has no preview');
a.rt.previewSkin('windows');
a.rt.useSkin(true, 'windows');
eq(a.rt.previewedSkin(), null, 'Apply ends the preview');
eq(a.store.doc?.skin.use, true, 'Apply saves the skin');
a.rt.previewSkin('hub-default');
a.rt.restoreDefaultAppearance();
eq(a.rt.previewedSkin(), null, 'Reset ends the preview');
eq(a.active(), before, 'Reset = the snapshot');
const scope = a.rt.scoped('skin-scope', a.rt.registry.list('interface' as never)[0]?.id ?? '');
scope.previewSkin('windows');
eq(a.rt.previewedSkin(), 'windows', 'a preview from a scoped view reaches the app');
scope.previewSkin(null);
eq(a.active(), before, 'and goes away again');

/* a broken document: nothing is written, the shared one is not touched */
const c = boot('app-d');
c.store.st = 'failed'; c.store.doc = null;
c.rt.swap('color-theme' as never, 'aurora-night');
eq(c.src.saved, [], 'an unreadable look document never falls through to the shared one');

/* an app without a hub keeps it in a setting */
const local = new AxfRuntime({ manifest: manifest('app-e'), assets: assets as never, storageKey: 'skin-app-e' });
const localBefore = { ...local.getState().active } as Record<string, string>;
ok(local.useSkin(true, 'windows'), 'local Use skin');
eq((local.getState().active as Record<string, string>)['color-theme'], 'windows-light', 'local skin on');
local.useSkin(false);
eq({ ...local.getState().active, skin: '' }, { ...localBefore, skin: '' }, 'local skin off');

/* the toolbar and title bar actions exist */
ok(['skin.use', 'skin.off', 'skin.restore', 'skin.undo', 'skin.window.minimize', 'skin.window.maximize', 'skin.window.close'].every((id) => a.rt.actions.list().some((x) => x.id === id)), 'the skin actions are registered');
console.log(`check-skin: ${n} checks passed`);

/* ---- skin-coverage@1 (build skins-asset-types): every registered type is covered, scopes, parts, icon pack ---- */
{
  const cv = fx.coverage;
  const types = { button: { label: 'Button', group: 'Controls' }, label: { label: 'Label', group: 'Widgets', widget: true, attachable: true }, badge: { label: 'Badge', group: 'Chrome', attachable: true }, 'icon-pack': { label: 'Icon pack', group: 'Brand', skin: { by: 'reference', via: 'iconPack', why: 'named by the skin' } }, 'uac-policy': { label: 'Access policy', group: 'System', skin: { by: 'none', why: 'no look' } }, help: { label: 'Help', group: 'System' }, 'design-package': { label: 'Design package', group: 'System', skin: { by: 'bundle' } }, mystery: { label: 'Mystery', group: 'Data', skin: { by: 'sometimes' } }, hush: { label: 'Hush', group: 'System', skin: { by: 'none' } } };
  const targets = { button: { root: '.fx-btn' }, label: { root: '.fx-widget-label' }, toolbar: { root: '.fx-toolbar', item: '.fx-toolbar .fx-btn' } };
  const never = ['uac-policy', 'help', 'skin', 'design-package', 'interface'];
  const table = coverageTable(types as never, targets, never);
  eq(table, cv.table, 'coverage table = fixture');
  eq(uncoveredTypes(types as never, targets, never).map((r) => r.type), ['badge', 'help', 'mystery', 'hush'], 'uncovered: an attachable without a target, an excluded type with no declaration, bad declarations');
  eq(table.find((r) => r.type === 'button')!.by, 'slot', 'a plain type is a slot');
  eq(table.find((r) => r.type === 'button')!.also, ['parts'], 'a slot with a style target also takes parts');
  eq(table.find((r) => r.type === 'label')!.by, 'parts', 'a widget is covered by parts');
  eq(table.find((r) => r.type === 'icon-pack')!.by, 'reference', 'a declared reference');
  eq(coverageSummary(table), cv.summary, 'summary');
  eq(partsTypes(types as never, targets), ['button', 'label'], 'parts types = registered types with a target');
  eq(partElements(targets.toolbar), ['box', 'text', 'icon', 'items'], 'composite elements with items');
  eq(partElements(targets.button), ['box', 'text', 'icon'], 'composite elements without items');
  eq(partsErrors({ nope: {}, badge: { x: 1 }, label: 7 }, types as never, targets), cv.partsErrors.bad, 'parts errors');
  eq(declarationErrors('mystery', types.mystery), ['mystery: skin.by must be one of slot, parts, reference, bundle, none'], 'a kind outside the list');
  eq(declarationErrors('hush', types.hush), ['hush: skin.by "none" needs a why'], 'none needs a why');

  // the real registry: nothing uncovered (CI: spec/check-skin-coverage.mjs says the same from plain node)
  eq(skinUncovered().map((r) => `${r.type}: ${r.why}`), [], 'every registered asset type has skin coverage');
  const real = skinCoverage();
  eq(real.map((r) => r.type), Object.keys(JSON.parse(readFileSync(join(root, 'schemas/asset-types.json'), 'utf8')).types), 'coverage lists every type in registry order');
  ok(real.filter((r) => r.by === 'parts').every((r) => r.elements.length >= 3), 'every widget has box, text and icon parts');
  ok(skinPartsTypes().includes('label') && skinPartsTypes().includes('badge') && skinPartsTypes().includes('button'), 'labels, badges and buttons take parts');
  ok(skinCoverageSummary().uncovered === 0 && skinCoverageSummary().total === real.length, 'summary counts');

  // scopes: plugin → ui → app → global, the child overrides the parent
  const sc = fx.scopes;
  const place = { app: 'app', ui: 'home', plugin: 'notes' };
  eq(skinScopeChain(place), ['plugin:notes', 'ui:home', 'app', 'global'], 'chain from the leaf');
  eq(skinScopeChain({ app: 'app' }), ['app', 'global'], 'the app chain');
  eq([skinScopeKey(place), skinScopeKey({ app: 'app', ui: 'home' }), skinScopeKey({ app: 'app' })], ['plugin:notes', 'ui:home', 'app'], 'keys');
  eq(['global', 'app', 'ui:home', 'plugin:notes'].map(skinScopeKind), ['global', 'app', 'ui', 'plugin'], 'kinds');
  eq(skinScopeSelector('plugin:ai.amberx.notes'), '[data-fx-scope="skin-plugin-ai-amberx-notes"]', 'a plugin scope is drawn under its scope root');
  eq(skinScopeSelector('ui:home'), '[data-fx-scope="skin-ui-home"]', 'a UI scope is drawn under its view root');
  eq(skinScopeSelector('app'), '', 'the app is the page itself');
  eq(normalizeSkinScope({ app: 'App!', ui: 'home', plugin: 'ai.amberx.notes' }), { app: '', ui: 'home', plugin: 'ai.amberx.notes' }, 'bad ids drop');
  eq(resolveSkinChain(['a', 'b', 'c'], (k) => ({ a: { use: 'inherit' }, b: { use: 'on', id: 'x', overrides: { button: 'b' } }, c: { use: 'on', id: 'y', overrides: { button: 'c', dialog: 'c' } } } as never)[k]), { id: 'x', overrides: { button: 'b' }, from: 'b' }, 'the first deciding level wins; the overrides of a parent level belong to its own skin');
  eq(resolveSkinChain(['a', 'b'], () => ({ use: 'inherit' })), { id: '', overrides: {}, from: '' }, 'all inherit = nothing');
  eq(resolveSkinChain(['a', 'b'], (k) => (k === 'a' ? { use: 'off' } : { use: 'on', id: 'x' })), { id: '', overrides: {}, from: 'a' }, 'off at the leaf hides the parent skin');
  const skinned = normalizeSkin(sc.skinned);
  eq(skinned, sc.skinned, 'a skin with parts and an icon pack normalizes');
  eq(skinned.iconPack, 'lucide-sharp', 'icon pack kept');
  eq(Object.keys(skinned.parts!), ['button', 'label'], 'parts kept only for types with a target and real values');
  eq(skinErrors({ ...skin, iconPack: 'Bad', parts: { nothing: { radius: 'pill' } } }).length, 2, 'bad icon pack and unknown parts type refused');
  eq((engine as unknown as { skinErrors(d: unknown): string[] }).skinErrors({ ...skin, iconPack: 'Bad', parts: { nothing: { radius: 'pill' }, 'uac-policy': {} } }), skinErrors({ ...skin, iconPack: 'Bad', parts: { nothing: { radius: 'pill' }, 'uac-policy': {} } }), 'build engine agrees on icon pack and parts');
  const skins: Record<string, typeof skinned> = { windows: skinned, aurora: normalizeSkin({ ...skin, colorTheme: 'aurora-night' }) };
  const skinOf = (id: string) => skins[id] ?? null;
  const inherit = setInheritSkin(look0, true);
  const withGlobal = { ...shared, skin: { id: 'aurora', overrides: { button: 'global-button' } } };
  eq(resolveLookSkin(look0, null, place), sc.resolve.appOff, 'no skin anywhere');
  eq(resolveLookSkin(look0, globalSkinOf(withGlobal as never), place).id, '', 'an app that does not inherit ignores the hub-wide skin');
  eq(resolveLookSkin(inherit, globalSkinOf(withGlobal as never), place), { id: 'aurora', overrides: { button: 'global-button' }, from: 'global' }, 'inherit takes the hub-wide skin');
  eq(resolveLookSkin(inherit, null, place).id, '', 'inherit with no hub-wide skin = none');
  const pluginOn = setScopeSkin(setUseSkin(pickSkin(look0, 'windows'), true), 'plugin:notes', 'on', 'aurora');
  eq(resolveLookSkin(pluginOn, null, place), { id: 'aurora', overrides: {}, from: 'plugin:notes' }, 'a plugin skin beats the app skin inside the plugin');
  eq(resolveLookSkin(pluginOn, null, { app: 'app', ui: 'home' }), { id: 'windows', overrides: {}, from: 'app' }, 'outside the plugin the app skin holds');
  eq(resolveLookSkin(setScopeSkin(setUseSkin(pickSkin(look0, 'windows'), true), 'plugin:notes', 'off'), null, place).id, '', 'a plugin can switch skins off for itself');
  const uiOver = setScopeOverride(setUseSkin(pickSkin(look0, 'windows'), true), 'ui:home', 'button', 'ui-button');
  eq(resolveLookSkin(uiOver, null, place), { id: 'windows', overrides: { button: 'ui-button' }, from: 'app' }, 'a UI override rides the app skin');
  eq(sc.resolve, { appOff: sc.resolve.appOff, appOn: resolveLookSkin(setUseSkin(pickSkin(look0, 'windows'), true), null, place), inheritNoGlobal: resolveLookSkin(inherit, null, place), inheritGlobal: resolveLookSkin(inherit, globalSkinOf(withGlobal as never), place), ownBeatsGlobal: resolveLookSkin(look0, globalSkinOf(withGlobal as never), place), pluginOn: resolveLookSkin(pluginOn, null, place), pluginOff: sc.resolve.pluginOff, pluginInheritsApp: resolveLookSkin(pluginOn, null, { app: 'app', ui: 'home' }), uiOverride: resolveLookSkin(uiOver, null, place), chainOverrides: sc.resolve.chainOverrides }, 'resolution = fixture');
  const composedApp = composeLookAt(shared as never, setUseSkin(pickSkin(look0, 'windows'), true), skinOf);
  eq(composedApp, sc.composed.app, 'composed app = fixture');
  eq(composedApp.doc.slots, composeLook(shared as never, setUseSkin(pickSkin(look0, 'windows'), true), skinned).slots, 'composeLookAt at the app = composeLook');
  eq(composedApp.doc.settings!['axf.icons.pack.app'], 'lucide-sharp', 'the skin puts its icon pack in force at the app');
  eq(composedApp.parts, skinned.parts, 'the parts ride along');
  const composedPlugin = composeLookAt(shared as never, pluginOn, skinOf, place);
  eq(composedPlugin.doc.slots!['color-theme'], 'aurora-night', 'inside the plugin: the plugin skin');
  eq(composedPlugin.scopeKey, 'plugin:notes', 'scope key');
  eq(composedPlugin.skin.from, 'plugin:notes', 'who decided');
  eq(composeLookAt(withGlobal as never, inherit, skinOf).doc.slots!.button, 'global-button', 'the hub-wide override reaches an inheriting app');
  eq(composeLookAt(shared as never, setUseSkin(pickSkin(look0, 'nope'), true), skinOf).doc.slots, composeLook(shared as never, look0, null).slots, 'an unknown skin reads as none');
  eq(scopeEntries(pluginOn), [{ key: 'plugin:notes', use: 'on', id: 'aurora', overrides: {} }], 'entries');
  eq(scopeState(inherit, 'app'), { use: 'inherit', id: look0.skin.id, overrides: {} }, 'the app level as a state (the pick the legacy slot left is kept)');
  eq(setScopeSkin(pluginOn, 'plugin:notes', 'inherit', '').scopes, {}, 'inherit with nothing else drops the entry');
  eq(parseAppLook(JSON.stringify(pluginOn)), pluginOn, 'scopes round trip');
  eq(restoreAppDefault(pluginOn, 'now').scopes, {}, 'Restore clears the scopes');
  eq(undoRestore(restoreAppDefault(pluginOn, 'now')).scopes, pluginOn.scopes, 'and undo brings them back');
  eq(skinCovers(skinned).find((c) => c.type === 'label'), { type: 'label', by: 'parts', covered: true, how: ['parts textColor'] }, 'what this skin covers: a label through parts');
  eq(skinCovers(skinned).find((c) => c.type === 'icon-pack')!.how, ['iconPack lucide-sharp'], 'the icon pack reference');
  ok(skinCovers(skinned).find((c) => c.type === 'nav-menu')!.covered === false, 'a type the skin does not set is shown as not covered by it');
  eq(globalSkinOf({ $axf: 'appearance@1', skin: { id: 'Bad Id' } } as never), null, 'a junk hub-wide skin is none');
  // the hub-wide skin survives the shared document's parser and merge
  const parsed = parseAppearance(JSON.stringify(withGlobal));
  eq(parsed?.skin, { id: 'aurora', overrides: { button: 'global-button' } }, 'appearance@1 keeps the hub-wide skin');
  eq(mergeAppearance(parsed, { skin: null }, 'test', 'now').skin, undefined, 'a null change clears it');
  eq(mergeAppearance(parsed, { skin: { id: 'windows' } }, 'test', 'now').skin, { id: 'windows' }, 'a pick replaces it');
}
console.log(`check-skin (coverage + scopes): ${n} checks passed`);

/* ---- the runtime: scopes, the hub-wide skin, parts and the icon pack ---- */
{
  const f = boot('app-f');
  const g = (() => {
    const rt = new AxfRuntime({ manifest: manifest('app-g'), assets: assets as never, storageKey: 'skin-app-g' });
    const store = new Store();
    const src = new Source(store, { ...hubDoc, skin: { id: 'windows' } } as AppearanceDocument);
    rt.attachAppearanceSource(src);
    return { rt, store, src, active: () => ({ ...rt.getState().active }) as Record<string, string> };
  })();
  eq(g.active()['color-theme'], before['color-theme'], 'a hub-wide skin changes nothing in an app that does not follow it');
  eq(g.rt.globalSkin(), { id: 'windows', overrides: {} }, 'the hub-wide skin is read from the shared document');
  ok(g.rt.skinInherit(true), 'follow the hub-wide skin');
  eq(g.active()['color-theme'], 'windows-light', 'following = the hub-wide skin is on');
  eq(g.rt.skinInForce().from, 'global', 'the global level decided');
  eq(g.rt.skinAt().id, 'windows', 'skinAt() agrees');
  g.rt.swap('color-theme' as never, 'aurora-night');
  eq(g.rt.skinOverrides(), [], "overrides while following: the app's own Use skin is off, so the dot list is empty");
  eq(g.active()['color-theme'], 'aurora-night', 'a pick while following overrides that part');
  eq(g.src.saved, [], 'nothing reaches the shared document');
  ok(g.rt.skinInherit(false), 'stop following');
  eq(g.active()['color-theme'], before['color-theme'], 'own look again');

  // a plugin can switch the skin off for itself, a UI can take another skin; the rest of the app keeps its skin
  ok(f.rt.useSkin(true, 'windows'), 'skin on');
  eq(f.rt.skinScoped('plugin:ai.amberx.notes'), null, 'a plugin that inherits needs no scope of its own');
  ok(f.rt.scopeSkin('plugin:ai.amberx.notes', 'off'), 'no skin inside the notes plugin');
  const pv = f.rt.skinScoped('plugin:ai.amberx.notes');
  ok(pv, 'the plugin gets a scoped view');
  eq((pv!.getState().active as Record<string, string>)['color-theme'], before['color-theme'], "inside the plugin: the app's own look");
  eq(f.active()['color-theme'], 'windows-light', 'outside it: the skin');
  ok(pv!.scopeCss().includes('[data-fx-scope="skin-plugin-ai-amberx-notes"]'), 'its vars are scoped under its root');
  eq(pv!.appliedInterface(), f.rt.appliedInterface(), 'a skin scope is not an interface');
  eq(f.rt.skinScopes(), [{ key: 'plugin:ai.amberx.notes', use: 'off', id: '', overrides: {} }], 'the scopes list');
  eq(f.rt.skinAt({ plugin: 'ai.amberx.notes' }), { id: '', overrides: {}, from: 'plugin:ai.amberx.notes' }, 'skinAt the plugin');
  ok(f.rt.scopeSkin('ui:home', 'on', 'hub-default'), 'the home UI takes another skin');
  const uv = f.rt.skinScoped('ui:home');
  ok(uv && (uv.getState().active as Record<string, string>)['style-theme'] !== 'windows', 'inside home: the other skin');
  ok(!f.rt.scopeSkin('ui:home', 'on', 'no-such-skin'), 'an unknown skin is refused for a scope');
  ok(!f.rt.scopeSkin('nope', 'on'), 'a bad key is refused');
  ok(f.rt.scopeSkin('ui:home', 'inherit'), 'back to inherit');
  eq(f.rt.skinScoped('ui:home'), null, 'inheriting = no scope of its own');
  ok(['skin.inherit', 'skin.scope'].every((id) => f.rt.actions.list().some((x) => x.id === id)), 'the scope actions are registered');
  f.rt.dispatch('skin.scope:plugin:ai.amberx.notes:inherit');
  ok(!f.rt.skinScopes().some((s) => s.key === 'plugin:ai.amberx.notes'), 'skin.scope:…:inherit drops an entry with nothing left to remember');
  f.rt.dispatch('skin.scope:ui:home:on:windows');
  eq(f.rt.skinScopes()[0]?.id, 'windows', 'skin.scope:…:on:<skin> sets it');
  f.rt.restoreDefaultAppearance();
  eq(f.rt.skinScopes(), [], 'Restore clears the scopes');

  // parts and the icon pack ride the skin
  ok(f.rt.useSkin(true, 'windows'), 'skin on again');
  ok(f.rt.customSheet().includes('.fx-widget-label'), "the Windows skin's label parts are in the sheet");
  ok(f.rt.customSheet().includes('.fx-badge') || f.rt.customSheet().includes('fx-badge'), "and its badge parts");
  eq(f.rt.skinIconPack(), 'amberx-outline', 'the skin puts its icon pack in force');
  ok(f.rt.brandGlyph('settings') !== null || f.rt.brandGlyph('home') !== null || f.rt.brandGlyph('search') !== null, 'icons resolve through the skin pack');
  const covers = f.rt.skinCovers('windows');
  ok(covers.find((c) => c.type === 'label')?.covered === true && covers.find((c) => c.type === 'icon-pack')?.covered === true, 'skinCovers: labels through parts, the icon pack by reference');
  eq(f.rt.skinCoverage().length, Object.keys(JSON.parse(readFileSync(join(root, 'schemas/asset-types.json'), 'utf8')).types).length, 'skinCoverage lists every registered type');
  f.rt.useSkin(false);
  ok(!f.rt.customSheet().includes('.fx-widget-label'), 'skin off: the parts go');
  eq(f.rt.skinIconPack(), '', 'skin off: no skin pack');

  // an inline section: registered as a preset named after the skin, drawn like any preset
  const inline = { $axf: 'asset@1', type: 'skin', id: 'inline-test', name: 'Inline test', version: '1.0.0', data: fx.normalize.sectioned };
  const h = new AxfRuntime({ manifest: manifest('app-h'), assets: [...assets, inline] as never, storageKey: 'skin-app-h' });
  ok(h.useSkin(true, 'inline-test'), 'a skin with an inline colour section goes on');
  eq((h.getState().active as Record<string, string>)['color-theme'], 'skin-inline-test', 'the colour slot is the inline section');
  eq(h.compileStyles().vars['--fx-accent'], fx.normalize.sectioned.sections.colors.tokens.accent, 'the inline colours compile');
  eq((h.getState().active as Record<string, string>)['behavior-theme'], 'snappy', 'the behaviour preset is in force');
  ok(h.registry.has('color-theme' as never, 'skin-inline-test'), 'the section preset is registered');
  ok(h.skinCovers('inline-test').find((c) => c.type === 'color-theme')!.how[0]!.includes('written in the skin'), 'covers says the section is written in the skin');
  // the retired design-package setting becomes the skin pick once
  const i = new AxfRuntime({ manifest: manifest('app-i'), assets: assets as never, storageKey: 'skin-app-i' });
  i.settings.set('axf.appearance.design', 'fresh-night' as never);
  eq(i.appLook()?.skin.id, 'fresh-night', 'axf.appearance.design is read once as the skin pick');
  eq(i.settings.get('axf.appearance.design'), null, 'and the setting goes');
  ok(!i.appLook()?.skin.use, 'without turning the skin on (the look on screen is unchanged)');
  // applySkin steps and the old names
  ok(i.applySkin('next') && i.appliedSkin() !== '', 'applySkin next');
  ok(i.applyDesignPackage('windows') && i.appliedSkin() === 'windows', 'applyDesignPackage is applySkin');
  eq(i.appliedDesignPackage(), 'windows', 'appliedDesignPackage is appliedSkin');
  i.dispatch('skin.use:fresh');
  eq(i.appliedSkin(), 'fresh', 'skin.use:<id>');
  for (const act of ['skin.next', 'skin.prev', 'skin.random', 'design.package', 'style.package']) ok(i.actions.list().some((x) => x.id === act), `action ${act} registered`);
}
console.log(`check-skin (runtime scopes): ${n} checks passed`);

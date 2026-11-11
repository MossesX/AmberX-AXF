/**
 * skin@1 + app-look@1: the format and its rules against spec/fixtures/skin.json, the build engine's validator agrees,
 * the Windows skin resolves against framework assets, and the runtime behaviour: landing changes nothing on screen
 * (snapshot = the current look), a skin stays in its own app, off gives the app's look back, overrides, Restore + one undo.
 *   npx -y tsx framework/spec/check-skin.mts
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { backToSkin, composeLook, composeLookAt, coverageSummary, coverageTable, declarationConflicts, declarationErrors, globalSkinOf, ingredientOfField, lookAfterChange, newAppLook, normalizeSkin, normalizeSkinScope, partElements, partsErrors, partsTypes, resolveLookSkin, resolveSkinChain, scopeEntries, scopeState, setInheritSkin, setScopeOverride, setScopeSkin, skinCoverage, skinCoverageSummary, skinCovers, skinPartsTypes, skinScopeChain, skinScopeKey, skinScopeKind, skinScopeSelector, skinUncovered, uncoveredTypes, NO_SKIN_ENTRY, SKIN_THEME_FIELDS, parseAppLook, pickSkin, restoreAppDefault, setUseSkin, skinErrors, skinFromDesignPackage, skinIngredients, skinSlots, snapshotLook, undoRestore, type AppLookDocument, type AppLookStore } from '../core/engines/skin';
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
eq(skinFromDesignPackage({ 'style-theme': 's', 'color-theme': 'c', layout: 'l', 'behavior-theme': 'b', extras: { slots: { button: 'x' }, spacing: 'tight', hidden: { toolbar: true } } }), fx.fromDesignPackage, 'a design package reads as a skin');

const shared = fx.look.shared as AppearanceDocument;
const look0 = newAppLook('app', snapshotLook(shared));
eq(look0.default, fx.look.snapshot, 'snapshot');
eq(composeLook(shared, look0, null), fx.look.off, 'skin off = the snapshot');
eq(composeLook(shared, look0, null).slots, shared.slots, 'snapshot = no visual change');
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
// Brett, Nov 9 2026: "Changing the colour theme applies inside the current skin and never creates a new skin."
eq({ use: over.skin.use, id: over.skin.id, overrides: over.skin.overrides }, { use: true, id: 'windows', overrides: { 'color-theme': 'aurora-night' } }, 'a colour theme pick lands inside the current skin: same skin, one override');
eq(over.own, on.own, "a colour theme pick under a skin leaves the app's own picks alone");
eq({ ...composeLook(shared, over, skin).slots, 'color-theme': skin.colorTheme }, composeLook(shared, on, skin).slots, 'only the colour theme section moved: every other part is still the skin\'s');
eq(lookAfterChange(look0, { slots: { button: 'terminal' }, hidden: { toolbar: false } }, null), fx.look.own.doc, 'no skin: picks are the app\'s own');
const restored = restoreAppDefault(over, '2026-11-05T00:00:00Z');
eq(restored, fx.look.restored.doc, 'restore keeps one undo');
eq(composeLook(shared, restored, null).slots, shared.slots, 'restore = the snapshot');
eq(undoRestore(restored).skin, fx.look.restored.undone, 'undo');
eq(undoRestore(undoRestore(restored)), undoRestore(restored), 'one undo only');
eq(parseAppLook(JSON.stringify(restored)), restored, 'round trip');
ok(parseAppLook('{"$axf":"appearance@1"}') === null, 'wrong frame refused');

/* ---- the Windows skin is real assets ---- */
const assets: Record<string, unknown>[] = [];
for (const t of readdirSync(join(root, 'assets'))) {
  const dir = join(root, 'assets', t);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir)) if (f.endsWith('.json')) assets.push(JSON.parse(readFileSync(join(dir, f), 'utf8')));
}
const win = assets.find((a) => a.type === 'skin' && a.id === 'windows');
eq(validateAsset(win).errors, [], 'the Windows skin validates');
for (const [t, id] of Object.entries(skinSlots(normalizeSkin(win!.data)))) ok(assets.some((a) => a.type === t && a.id === id), `windows: ${t} ${id} exists`);

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
const hubDoc = { $axf: 'appearance@1', slots: { 'design-package': 'hub-default', 'color-theme': 'arctic-daylight', 'style-theme': 'hub', layout: 'focus-top', button: 'rounded-solid' }, spacing: 'tight', hidden: { toolbar: true }, settings: { 'axf.banners.group': 'x' } } as unknown as AppearanceDocument;
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
const skinsBefore = a.rt.skinList().map((e) => e.id);
eq(a.active()['color-theme'], 'windows-light', 'the skin colour is on');
eq(a.active()['style-theme'], 'windows', 'the skin style beats the design package');
eq(a.active().layout, 'windows-explorer', 'the skin layout is on');
eq(a.active().button, 'windows', 'the skin assets are on');
eq(b.active(), before, 'the other app did not move');
eq(a.src.saved, [], 'a skin writes nothing to the shared document');

a.rt.swap('color-theme' as never, 'aurora-night');
eq(a.active()['color-theme'], 'aurora-night', 'a pick overrides the skin');
eq(a.rt.skinOverrides(), ['color-theme'], 'the overridden dot');
eq(a.active()['style-theme'], 'windows', 'the rest stays the skin');
eq(a.rt.skinAt(), { id: 'windows', overrides: { 'color-theme': 'aurora-night' }, from: 'app' }, 'a colour theme change applies inside the current skin');
eq(a.rt.skinList().map((e) => e.id), skinsBefore, 'a colour theme change never creates a new skin');
eq(a.store.doc?.own.slots?.['color-theme'], undefined, "the colour theme pick is the skin's, not the app's own");
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

ok(a.rt.useSkin(true, 'hub-default'), 'a design package works as a skin');
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
  const types = { 'color-theme': { label: 'Color theme', group: 'Themes', skin: { by: 'slot', ingredient: true, via: 'colorTheme', why: "the skin's colour theme section" } }, button: { label: 'Button', group: 'Controls', skin: { by: 'slot', parts: true } }, label: { label: 'Label', group: 'Widgets', widget: true, attachable: true, skin: { by: 'parts' } }, badge: { label: 'Badge', group: 'Chrome', attachable: true, skin: { by: 'parts' } }, 'icon-pack': { label: 'Icon pack', group: 'Brand', skin: { by: 'reference', via: 'iconPack', why: 'named by the skin' } }, 'uac-policy': { label: 'Access policy', group: 'System', skin: { by: 'none', why: 'no look' } }, help: { label: 'Help', group: 'System' }, 'design-package': { label: 'Design package', group: 'System', skin: { by: 'bundle' } }, mystery: { label: 'Mystery', group: 'Data', skin: { by: 'sometimes' } }, hush: { label: 'Hush', group: 'System', skin: { by: 'none' } }, dialog: { label: 'Dialog', group: 'Overlays', skin: { by: 'slot' } }, clock: { label: 'Clock', group: 'Widgets', widget: true, skin: { by: 'slot' } }, interface: { label: 'Interface', group: 'System', skin: { by: 'slot' } }, density: { label: 'Density', group: 'Themes', skin: { by: 'slot', ingredient: true, parts: true } } };
  const targets = { button: { root: '.fx-btn' }, label: { root: '.fx-widget-label' }, toolbar: { root: '.fx-toolbar', item: '.fx-toolbar .fx-btn' }, dialog: { root: '.fx-dialog' } };
  const never = ['uac-policy', 'help', 'skin', 'design-package', 'interface'];
  const table = coverageTable(types as never, targets, never);
  eq(table, cv.table, 'coverage table = fixture');
  eq(uncoveredTypes(types as never, targets, never).map((r) => r.type), ['badge', 'help', 'mystery', 'hush', 'dialog', 'clock', 'interface', 'density'], 'uncovered: parts without a target, no skin entry, bad entries, a target the entry leaves out, a widget as a slot, a slot a skin never sets, an ingredient with parts');
  eq(table.find((r) => r.type === 'help')!.why, NO_SKIN_ENTRY, 'a type with no skin entry is uncovered: nothing is derived');
  eq(table.find((r) => r.type === 'button')!.by, 'slot', 'a declared slot');
  eq(table.find((r) => r.type === 'button')!.also, ['parts'], 'a slot declared with parts also takes parts');
  eq(table.find((r) => r.type === 'label')!.by, 'parts', 'a widget is covered by parts');
  eq(table.find((r) => r.type === 'icon-pack')!.by, 'reference', 'a declared reference');
  eq(table.find((r) => r.type === 'color-theme'), { type: 'color-theme', label: 'Color theme', group: 'Themes', also: [], elements: [], declared: true, ingredient: true, via: 'colorTheme', why: "the skin's colour theme section", by: 'slot' }, 'the colour theme is a skin ingredient: a slot, never parts');
  eq(coverageSummary(table), cv.summary, 'summary');
  eq(partsTypes(types as never, targets), ['button', 'label', 'dialog'], 'parts types = registered types with a target');
  eq(partElements(targets.toolbar), ['box', 'text', 'icon', 'items'], 'composite elements with items');
  eq(partElements(targets.button), ['box', 'text', 'icon'], 'composite elements without items');
  eq(partsErrors({ nope: {}, badge: { x: 1 }, label: 7 }, types as never, targets), cv.partsErrors.bad, 'parts errors');
  eq(declarationErrors('mystery', types.mystery), ['mystery: skin.by must be one of slot, parts, reference, bundle, none'], 'a kind outside the list');
  eq(declarationErrors('hush', types.hush), ['hush: skin.by "none" needs a why'], 'none needs a why');
  eq(declarationErrors('density', types.density), ['density: a skin ingredient is picked, not styled with parts'], 'an ingredient never takes parts');
  eq(declarationErrors('x', { skin: { by: 'parts', parts: true } }), ['x: skin.parts is for a slot that also takes style parts (skin.by "parts" already says it)'], 'parts: true only on a slot');
  eq(declarationErrors('x', { skin: { by: 'none', why: 'w', ingredient: true } }), ['x: a skin ingredient is a slot the skin picks (skin.by "slot")'], 'an ingredient is a slot');
  eq(declarationErrors('x', { skin: { by: 'slot', ingredient: true, via: 'assets' } }), ["x: an ingredient's skin.via names a theme field of the skin (layoutTheme, colorTheme, styleTheme)"], "an ingredient's via is a theme field");
  eq(declarationErrors('x', { skin: { by: 'slot', parts: 'yes' } }), ['x: skin.parts must be true or false'], 'parts is a boolean');
  eq(['badge', 'dialog', 'clock', 'interface'].flatMap((t) => declarationConflicts(t, (types as Record<string, unknown>)[t], (targets as Record<string, unknown>)[t], never)), cv.declarationConflicts, 'conflicts = fixture');
  eq(declarationConflicts('badge', types.badge, undefined, never), ['badge: declares style parts but has no style target (schemas/customize.json targets)'], 'parts need a style target');
  eq(declarationConflicts('dialog', types.dialog, targets.dialog, never), ['dialog: has a style target its skin entry doesn\'t mention (skin.by "parts", or "parts": true on a slot)'], 'a style target must be declared');
  eq(skinIngredients(types as never), ['color-theme'], 'ingredients: valid entries only');
  eq(ingredientOfField(types as never, 'colorTheme'), 'color-theme', "the skin's colour theme section belongs to color-theme");
  eq(ingredientOfField(types as never, 'styleTheme'), '', 'a theme field nobody declares');

  // the real registry: nothing uncovered (CI: spec/check-skin-coverage.mjs says the same from plain node)
  eq(skinUncovered().map((r) => `${r.type}: ${r.why}`), [], 'every registered asset type has skin coverage');
  const real = skinCoverage();
  eq(real.map((r) => r.type), Object.keys(JSON.parse(readFileSync(join(root, 'schemas/asset-types.json'), 'utf8')).types), 'coverage lists every type in registry order');
  ok(real.filter((r) => r.by === 'parts').every((r) => r.elements.length >= 3), 'every widget has box, text and icon parts');
  ok(skinPartsTypes().includes('label') && skinPartsTypes().includes('badge') && skinPartsTypes().includes('button'), 'labels, badges and buttons take parts');
  ok(skinCoverageSummary().uncovered === 0 && skinCoverageSummary().total === real.length, 'summary counts');
  ok(real.every((r) => r.declared), 'every registered type carries its own skin entry (nothing derived)');
  // Brett, Nov 9 2026: "a skin controls everything and contains a colour theme section"
  const realSpec = JSON.parse(readFileSync(join(root, 'schemas/asset-types.json'), 'utf8')).types;
  eq(SKIN_THEME_FIELDS.map((f) => ingredientOfField(realSpec, f)), ['layout', 'color-theme', 'style-theme'], "the skin's three theme sections are the layout, colour theme and style theme types");
  eq(skinIngredients(realSpec), ['color-theme', 'style-theme', 'layout', 'behavior-theme', 'typography', 'density', 'sizing'], 'what a skin is made of');
  ok(real.filter((r) => r.ingredient).every((r) => r.by === 'slot' && !r.also.length && !r.elements.length), 'ingredients are picked, never styled with parts');
  ok(real.filter((r) => r.elements.length).every((r) => r.by === 'parts' || r.also.includes('parts')), 'every type with a style target says it takes parts');

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
  eq(scopeState(inherit, 'app'), { use: 'inherit', id: '', overrides: {} }, 'the app level as a state');
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
  ok(f.rt.scopeSkin('ui:home', 'on', 'hub-default'), 'the home UI takes a design package as its skin');
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
}
console.log(`check-skin (runtime scopes): ${n} checks passed`);

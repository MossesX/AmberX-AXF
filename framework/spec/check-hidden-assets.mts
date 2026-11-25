/**
 * hidden-assets@1 (Brett, Nov 17 2026, build rebuild-fresh-main-hide-any-asset: "hide toolbars and tab groups and all
 * that and be able to see what's hidden"): the engine against spec/fixtures/hidden-assets.json, and the rules in words:
 * hide, unhide, unhide all, an unknown kind is refused, an old document with no list reads as nothing hidden, the list
 * rides with the app's own look (a pick keeps it, Restore to default clears it, undo brings it back), the kinds come
 * from the chrome-settings kind list plus widget, and the app-look JSON Schema carries the list.
 *   npx -y tsx framework/spec/check-hidden-assets.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HIDDEN_ASSETS_CONTRACT, HIDDEN_ASSETS_FIELD, HIDDEN_ASSETS_MAX, HIDDEN_ASSET_WIDGET_KIND, hide, hiddenAssetKey, hiddenAssetKinds, hiddenAssetTarget, hiddenAssetTargetError, hiddenAssetsSchema, hiddenCount, hiddenEntry, hiddenOfKind, isHidden, isHiddenAssetKind, listHidden, normalizeHiddenAssets, parseHiddenAssetKey, setHidden, unhide, unhideAll, type HiddenAsset } from '../core/engines/hidden-assets';
import { appLookSchema, lookAfterChange, newAppLook, normalizeAppLook, normalizeLookPart, parseAppLook, restoreAppDefault, undoRestore, type AppLookDocument } from '../core/engines/skin';
import { CHROME_INSTANCE_ASSET_KEY as CHROME_INSTANCE_ASSET_KEY_, CHROME_TARGETS, CHROME_TYPES } from '../core/engines/chrome-settings-rules.mjs';
import { hideableTypes } from '../core/engines/hide';

const root = new URL('../', import.meta.url).pathname;
let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };

/* ---- the contract: the same results as the golden file ---- */
const fx = JSON.parse(readFileSync(join(root, 'spec/fixtures/hidden-assets.json'), 'utf8'));
eq(fx.contract, HIDDEN_ASSETS_CONTRACT, 'contract');
eq(hiddenAssetKinds(), fx.kinds, 'kinds as the fixture has them');
eq(HIDDEN_ASSETS_MAX, fx.max, 'cap');
eq(hiddenAssetKey('toolbar', 'main'), fx.targets.key, 'key');
eq(parseHiddenAssetKey('toolbar:main'), fx.targets.parsed, 'parse a key');
eq(parseHiddenAssetKey('grid:main'), fx.targets.badKind, 'an unknown kind does not parse');
eq(parseHiddenAssetKey('toolbar:Bad Id'), fx.targets.badId, 'a bad id does not parse');
eq({ ok: hiddenAssetTargetError('toolbar:main'), kind: hiddenAssetTargetError('grid:main'), id: hiddenAssetTargetError({ kind: 'banner', id: '' }), contextMenu: hiddenAssetTargetError('context-menu:main') }, fx.targets.errors, 'errors in words');
const at = '2026-11-17T14:50:00Z';
eq(normalizeHiddenAssets([{ kind: 'toolbar', id: 'main', assetRef: 'standard-icons', hiddenAt: at, by: 'axf-console' }]), fx.normalize.good, 'a good entry is kept whole');
eq(normalizeHiddenAssets([{ kind: 'grid', id: 'x', hiddenAt: at, by: 'y' }, { kind: 'toolbar', id: 'Bad Id', hiddenAt: at, by: 'y' }, { kind: 'toolbar', id: 'main', hiddenAt: 'yesterday', by: 7, assetRef: 'Bad Ref' }, { kind: 'toolbar', id: 'main', hiddenAt: at, by: 'second' }, 'toolbar:main', null]), fx.normalize.junk, 'junk is dropped, the first of a pair stands');
eq(fx.normalize.junk, [{ kind: 'toolbar', id: 'main', hiddenAt: '', by: '' }], 'a bad time / by / assetRef is blanked, the entry kept');
eq(normalizeHiddenAssets({ kind: 'toolbar', id: 'main' }), fx.normalize.notAList, 'not a list = nothing hidden');
eq(fx.normalize.capped, { length: HIDDEN_ASSETS_MAX, first: 't3', last: `t${HIDDEN_ASSETS_MAX + 2}` }, 'over the cap the oldest fall off');

const look0 = newAppLook('app', { slots: { toolbar: 'standard-icons' } });
eq(look0, fx.look.empty.doc, 'a new look');
eq(listHidden(look0), [], 'nothing hidden');
eq(hiddenCount(look0), 0, 'count 0');
const one = hide(look0, { kind: 'toolbar', id: 'main' }, { at, by: 'axf-console', assetRef: 'standard-icons' });
eq(one, fx.look.one.doc, 'hide one');
eq(listHidden(one), fx.look.one.list, 'the list after one hide');
eq(listHidden(one), [{ kind: 'toolbar', id: 'main', hiddenAt: at, by: 'axf-console', assetRef: 'standard-icons' }], 'the entry: kind, id, hiddenAt, by, assetRef');
ok(isHidden(one, 'toolbar:main') && isHidden(one, { kind: 'toolbar', id: 'main' }), 'hidden by key and by target');
ok(!isHidden(one, 'toolbar:other') && !isHidden(one, 'tab-group:main'), 'another id or kind is not hidden');
eq(hiddenEntry(one, { kind: 'toolbar', id: 'main' }), fx.look.one.entry, 'the entry of a hidden piece');
eq(hiddenEntry(one, 'toolbar:other'), null, 'no entry when not hidden');
const two = hide(one, 'tab-group:settings.tabs', { at: '2026-11-17T14:51:00Z', by: 'axf-console' });
const three = hide(two, { kind: 'widget', id: 'clock' }, { at: '2026-11-17T14:52:00Z', by: 'plugin:clock' });
eq(three, fx.look.three.doc, 'three hidden');
eq(listHidden(three).map((e) => hiddenAssetKey(e.kind, e.id)), ['toolbar:main', 'tab-group:settings.tabs', 'widget:clock'], 'oldest first');
eq(hiddenOfKind(three, 'toolbar'), fx.look.three.ofKind, 'of one kind');
eq(hiddenCount(three), 3, 'count 3');
ok(hide(three, 'toolbar:main', { at: '2026-11-18T00:00:00Z', by: 'later' }) === three, 'hiding what is hidden returns the same document');
eq(listHidden(hide(three, 'toolbar:main', { at: '2026-11-18T00:00:00Z', by: 'later' })), fx.look.again.list, 'the first hide stands');

/* ---- an unknown kind is refused ---- */
ok(hide(three, 'grid:main', { at }) === three, 'an unknown kind is refused: same document');
ok(hide(three, 'context-menu:main', { at }) === three, 'a context menu has no region: refused');
ok(hide(three, { kind: 'toolbar', id: 'Bad Id' }, { at }) === three, 'a bad id is refused');
ok(hide(three, { kind: 'toolbar', id: '' }, { at }) === three, 'an empty id is refused');
ok(hide(three, '' as never, { at }) === three && hide(three, null as never, { at }) === three, 'nothing is refused');
eq(listHidden(hide(look0, 'banner:top', { at, by: 'x', assetRef: 'Bad Ref' })), fx.look.refused.badRef, 'a bad assetRef is dropped, the hide kept');
ok(!isHidden(three, 'grid:main'), 'an unknown kind is never hidden');
ok(hiddenAssetTargetError('grid:main')!.includes('grid') && hiddenAssetTargetError('grid:main')!.includes(hiddenAssetKinds().join(', ')), 'the error names the kind and lists the kinds');
eq(hiddenAssetTarget('widget:clock'), { kind: 'widget', id: 'clock' }, 'a key as a target');
eq(hiddenAssetTarget({ kind: 'widget', id: 'clock', extra: 1 } as never), { kind: 'widget', id: 'clock' }, 'a target is trimmed to kind + id');

/* ---- unhide, unhide all ---- */
const back = unhide(three, 'toolbar:main');
eq(back, fx.look.unhide.doc, 'unhide');
eq(listHidden(back).map((e) => e.id), ['settings.tabs', 'clock'], 'the others stay, in order');
ok(!isHidden(back, 'toolbar:main'), 'not hidden any more');
ok(unhide(three, 'toolbar:other') === three, 'unhiding what is not hidden: same document');
ok(unhide(three, 'grid:main') === three, 'unhiding an unknown kind: same document');
eq(unhide(one, 'toolbar:main').own, fx.look.unhideLast, 'the last unhide drops the field');
ok(!(HIDDEN_ASSETS_FIELD in unhide(one, 'toolbar:main').own), 'no empty list is kept');
const all = unhideAll(three);
eq(all, fx.look.unhideAll.doc, 'unhide all');
eq(all.own, fx.look.unhideAll.own, 'unhide all leaves the other own picks');
eq(listHidden(all), [], 'nothing hidden after unhide all');
ok(unhideAll(look0) === look0, 'unhide all with nothing hidden: same document');
eq(listHidden(setHidden(look0, 'nav-menu:side', true, { at, by: 'x' })), fx.look.setHidden.on, 'setHidden on');
eq(listHidden(setHidden(one, 'toolbar:main', false)), fx.look.setHidden.off, 'setHidden off');
ok(three.own.slots === look0.own.slots || JSON.stringify(three.own.slots) === JSON.stringify(look0.own.slots), 'hide never touches the other own picks');
eq(three.default, look0.default, 'hide never touches the default snapshot');
eq(three.skin, look0.skin, 'hide never touches the skin state');

/* ---- the list rides with the app's own look ---- */
eq(listHidden(lookAfterChange(three, { slots: { button: 'terminal' } }, null)), fx.look.withPick, 'a pick keeps the hidden list');
eq(listHidden(lookAfterChange(three, { slots: { button: 'terminal' } }, null)).length, 3, 'all three still hidden after a pick');
const restored = restoreAppDefault(three, at);
eq(listHidden(restored), [], 'Restore to default shows everything');
eq(listHidden(undoRestore(restored)), fx.look.restored.undone, 'undo brings the hidden list back');
eq(listHidden(undoRestore(restored)), listHidden(three), 'undone = as it was');

/* ---- old documents: no list reads as nothing hidden ---- */
const oldRaw = { $axf: 'app-look@1', app: 'app', default: {}, own: { slots: { button: 'x' } }, skin: { use: false, inherit: false, id: '', overrides: {} }, scopes: {} };
const old = normalizeAppLook(oldRaw)!;
eq(old, fx.look.old.doc, 'an old document normalises as before');
ok(!(HIDDEN_ASSETS_FIELD in old.own), 'no field is added to an old document');
eq(listHidden(old), [], 'an old document has nothing hidden');
ok(!isHidden(old, 'toolbar:main'), 'nothing is hidden in an old document');
eq(listHidden(hide(old, 'toolbar:main', { at, by: 'x' })).length, 1, 'an old document takes a hide');
eq(listHidden(null), [], 'no document: nothing hidden');
ok(!isHidden(undefined, 'toolbar:main') && hiddenCount(null) === 0, 'no document: never hidden');
eq(parseAppLook(JSON.stringify(three)), fx.look.roundTrip, 'round trip through the writer keeps the list');
eq(listHidden(parseAppLook(JSON.stringify(three))), listHidden(three), 'round trip: the same entries');
eq(listHidden(parseAppLook(JSON.stringify({ ...three, own: { ...three.own, hiddenAssets: [...three.own.hiddenAssets!, { kind: 'grid', id: 'x' }, { kind: 'toolbar', id: 'main', by: 'dup' }] } }))), fx.look.cleaned, 'a saved list with junk is cleaned on read');
eq(fx.look.cleaned.length, 3, 'junk and a twin are dropped on read');
eq(normalizeLookPart({ hiddenAssets: 'nope' }), {}, 'a part whose list is not a list has none');
eq(normalizeLookPart({ hiddenAssets: [] }), {}, 'an empty list is not kept');
eq(listHidden({ ...look0, default: { hiddenAssets: [{ kind: 'toolbar', id: 'main', hiddenAt: at, by: 'x' }] } } as AppLookDocument), fx.look.snapshotNeverHides, 'a snapshot never hides anything: only own counts');

/* ---- kinds: the chrome-settings kind list (with a target on the page) plus widget, no app list ---- */
const kinds = hiddenAssetKinds();
eq(kinds, [...CHROME_TYPES.filter((k) => CHROME_TARGETS[k].length > 0), HIDDEN_ASSET_WIDGET_KIND], 'kinds are derived from the chrome kind list');
ok(!kinds.includes('context-menu'), 'a context menu is not hideable here (no region on the page)');
ok(kinds.includes('widget'), 'a widget can be hidden');
for (const k of kinds.filter((k) => k !== HIDDEN_ASSET_WIDGET_KIND)) ok(hideableTypes().includes(k), `${k} is a hideable chrome type in asset-types.json`);
ok(kinds.every(isHiddenAssetKind) && !isHiddenAssetKind('app') && !isHiddenAssetKind(''), 'isHiddenAssetKind');
const code = (f: string) => readFileSync(join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
ok(!/console|axhub|amberx|molly/i.test(code('core/engines/hidden-assets-rules.mjs')) && !/console|axhub|amberx|molly/i.test(code('core/engines/hidden-assets.ts')), 'no app is named in the engine code');

/* ---- the schema: app-look@1 carries the list on every look part ---- */
const schema = appLookSchema() as { properties: Record<string, { properties?: Record<string, unknown> }> };
eq(hiddenAssetsSchema(), fx.schema, 'the list schema as the fixture has it');
ok(schema.properties.own!.properties![HIDDEN_ASSETS_FIELD], 'own carries hiddenAssets');
ok(schema.properties.default!.properties![HIDDEN_ASSETS_FIELD], 'default carries hiddenAssets');
eq((fx.schema.items.properties.kind as { enum: string[] }).enum, kinds, 'the schema enum is the kind list');
eq(fx.schema.items.required, ['kind', 'id', 'hiddenAt', 'by'], 'required fields');
const written = JSON.parse(readFileSync(join(root, 'schemas/json/app-look.schema.json'), 'utf8'));
eq(written, appLookSchema(), 'schemas/json/app-look.schema.json is current (axf schemas)');
const doc = JSON.parse(readFileSync(join(root, 'schemas/asset-types.json'), 'utf8'));
eq(doc.hiddenAssets?.field, HIDDEN_ASSETS_FIELD, 'asset-types.json documents the field');
eq(doc.hiddenAssets?.max, HIDDEN_ASSETS_MAX, 'asset-types.json documents the cap');
eq(Object.keys(doc.hiddenAssets?.entry ?? {}), ['kind', 'id', 'assetRef', 'hiddenAt', 'by'], 'asset-types.json documents the entry');
const entry: HiddenAsset = listHidden(one)[0]!;
ok(entry.kind === 'toolbar' && entry.id === 'main', 'typed entry');

console.log(`check-hidden-assets: ${n} checks passed`);

/* ---- the runtime: rt.hidden / rt.hide / rt.unhide / rt.unhideAll read and write the app's look document through the look
   writer (so the state survives reloads and reaches the hub), repaint without a skin-switch sweep, refresh on focus ---- */
{
  const { AxfRuntime } = await import('../core/runtime');
  type AppearanceSource = import('../core/runtime').AppearanceSource;
  type AppLookStore = import('../core/engines/skin').AppLookStore;
  type AppearanceDocument = import('../core/engines/appearance').AppearanceDocument;
  type AppearanceSourceState = import('../core/engines/appearance').AppearanceSourceState;
  const { readdirSync, statSync } = await import('node:fs');
  const assets: Record<string, unknown>[] = [];
  for (const t of readdirSync(join(root, 'assets'))) {
    const dir = join(root, 'assets', t);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) if (f.endsWith('.json')) assets.push(JSON.parse(readFileSync(join(dir, f), 'utf8')));
  }
  const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
  const manifest = (id: string) => ({ $axf: 'manifest@1', app: { id, name: id, version: '0' }, framework: { version: '0.2.0', template: 'react-ts' }, targets: ['web'], defaults }) as never;
  { const m = new Map<string, string>(); (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; }
  class Store implements AppLookStore {
    doc: AppLookDocument | null = null; listeners = new Set<() => void>(); st: ReturnType<AppLookStore['status']> = 'missing'; saves = 0; refreshes = 0;
    get() { return this.doc; } status() { return this.st; }
    save(d: AppLookDocument) { this.doc = d; this.st = 'ready'; this.saves++; }
    subscribe(f: () => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
    refresh() { this.refreshes++; }
    /** another tab or the CLI wrote the document: the hub feed says so */
    arrive(d: AppLookDocument) { this.doc = d; this.st = 'ready'; for (const f of this.listeners) f(); }
  }
  class Source implements AppearanceSource {
    st: AppearanceSourceState = { status: 'ready', version: 'v' }; saved: unknown[] = []; refreshes = 0;
    listeners = new Set<Parameters<AppearanceSource['subscribe']>[0]>();
    constructor(readonly appLook: Store, readonly doc: AppearanceDocument | null) {}
    state() { return this.st; }
    subscribe(l: Parameters<AppearanceSource['subscribe']>[0]) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
    start() { for (const l of this.listeners) { l({ state: this.st }); l({ doc: this.doc, version: 'v' }); } }
    stop() {} refresh() { this.refreshes++; } save(c: unknown) { this.saved.push(c); }
  }
  const hubDoc = { $axf: 'appearance@1', slots: { 'color-theme': 'arctic-daylight', 'style-theme': 'soft-studio', layout: 'focus-top', button: 'rounded-solid' }, spacing: 'tight', hidden: {}, settings: {} } as unknown as AppearanceDocument;
  const rt = new AxfRuntime({ manifest: manifest('app-h'), assets: assets as never, storageKey: 'hidden-app-h' });
  const store = new Store();
  const src = new Source(store, hubDoc);
  rt.attachAppearanceSource(src);
  const swaps = () => rt.getState().swaps;

  eq(rt.hidden(), [], 'nothing hidden to start');
  eq(rt.hiddenCount(), 0, 'count 0');
  eq(rt.hideableKinds(), hiddenAssetKinds(), 'the runtime names the same kinds');
  ok(!rt.isHidden('toolbar:main'), 'not hidden');
  const saves0 = store.saves; const s0 = swaps();
  ok(rt.hide('toolbar:main'), 'hide a toolbar');
  ok(rt.isHidden('toolbar:main') && rt.isHidden({ kind: 'toolbar', id: 'main' }), 'hidden by key and by target');
  eq(rt.hidden().map((e) => `${e.kind}:${e.id}`), ['toolbar:main'], 'listed');
  eq(rt.hidden()[0]!.by, 'app-h', 'by = this app');
  ok(rt.hidden()[0]!.assetRef === rt.getState().active.toolbar, "assetRef = the toolbar the app draws (the kind's slot)");
  ok(/^\d{4}-\d{2}-\d{2}T/.test(rt.hidden()[0]!.hiddenAt), 'hiddenAt is set');
  ok(store.saves === saves0 + 1, 'saved once through the look writer');
  eq(listHidden(store.doc).map((e) => e.id), ['main'], 'the look document on the hub carries it');
  ok(store.doc!.updatedBy === 'app-h', 'the look writer stamps the app');
  ok(swaps() === s0 + 1, 'one repaint');
  eq(src.saved, [], 'nothing goes to the shared appearance document');
  ok(rt.hide('toolbar:main'), 'hiding again is fine');
  ok(store.saves === saves0 + 1 && swaps() === s0 + 1, 'and writes and repaints nothing');
  ok(!rt.hide('grid:main'), 'an unknown kind is refused');
  ok(!rt.hide('context-menu:main'), 'a context menu is refused');
  ok(!rt.hide({ kind: 'toolbar', id: 'Bad Id' }), 'a bad id is refused');
  ok(store.saves === saves0 + 1, 'a refusal writes nothing');
  rt.settings.set(CHROME_INSTANCE_ASSET_KEY_('tab-group', 'settings.tabs'), 'chips');
  ok(rt.hide('tab-group:settings.tabs', { by: 'api:rest' }), 'hide a tab row with its own pick, from the API');
  eq(rt.hidden().at(-1), { kind: 'tab-group', id: 'settings.tabs', hiddenAt: rt.hidden().at(-1)!.hiddenAt, by: 'api:rest', assetRef: 'chips' }, "the entry: the caller and the row's own asset pick");
  ok(rt.hide('widget:clock', { assetRef: 'clock-plain' }), 'hide a widget with the asset named by the caller');
  eq(rt.hidden().at(-1)!.assetRef, 'clock-plain', 'the named asset is kept');
  ok(rt.hide('banner:top'), 'hide a banner');
  eq(rt.hiddenCount(), 4, 'four hidden');
  ok(rt.unhide('toolbar:main'), 'unhide');
  ok(!rt.isHidden('toolbar:main'), 'shown again');
  eq(rt.hidden().map((e) => e.id), ['settings.tabs', 'clock', 'top'], 'the others stay');
  ok(rt.unhide('toolbar:main'), 'unhiding what is shown is fine');
  ok(!rt.unhide('grid:main'), 'unhiding an unknown kind is refused');
  ok(rt.setHidden('nav-menu:side', true) && rt.isHidden('nav-menu:side') && rt.setHidden('nav-menu:side', false) && !rt.isHidden('nav-menu:side'), 'setHidden on / off');
  const savesBefore = store.saves;
  ok(rt.unhideAll(), 'unhide all');
  eq(rt.hidden(), [], 'nothing hidden');
  ok(store.saves === savesBefore + 1 && !('hiddenAssets' in store.doc!.own), 'one write, the field dropped');
  ok(rt.unhideAll() && store.saves === savesBefore + 1, 'unhide all with nothing hidden writes nothing');

  // survives a reload: a fresh runtime on the same (hub) document sees the same list
  ok(rt.hide('toolbar:main') && rt.hide('banner:top'), 'hide two');
  const again = new AxfRuntime({ manifest: manifest('app-h'), assets: assets as never, storageKey: 'hidden-app-h-2' });
  const store2 = new Store(); store2.doc = JSON.parse(JSON.stringify(store.doc)); store2.st = 'ready';
  again.attachAppearanceSource(new Source(store2, hubDoc));
  eq(again.hidden().map((e) => `${e.kind}:${e.id}`), ['toolbar:main', 'banner:top'], 'a reload reads the same hidden list from the look document');
  ok(again.isHidden('banner:top'), 'hidden after the reload');

  // the look rides along: a pick keeps the list, Restore to default clears it, undo brings it back
  rt.swap('button' as never, 'terminal');
  eq(rt.hidden().length, 2, 'a pick keeps the hidden list');
  rt.restoreDefaultAppearance();
  eq(rt.hidden(), [], 'Restore to default shows everything');
  ok(rt.undoRestoreDefault(), 'undo');
  eq(rt.hidden().length, 2, 'undo brings the hidden list back');

  // fresh on focus: refreshFromSaved re-reads the look document; a change that arrives from the hub repaints
  const r0 = store.refreshes; const sw = swaps();
  rt.refreshFromSaved();
  ok(store.refreshes === r0 + 1 && src.refreshes >= 1, 'refreshFromSaved asks the look store and the appearance source');
  store.arrive(unhideAll(store.doc!));
  eq(rt.hidden(), [], 'a document that arrives from the hub (another tab, the CLI) is read at once');
  ok(swaps() > sw, 'and repaints');
  const stale = new Store(); delete (stale as { refresh?: unknown }).refresh;
  const rt2 = new AxfRuntime({ manifest: manifest('app-j'), assets: assets as never, storageKey: 'hidden-app-j' });
  rt2.attachAppearanceSource(new Source(stale, hubDoc));
  rt2.refreshFromSaved();
  ok(true, 'a store without refresh is fine');

  // without a hub source the list lives in the local look setting
  const local = new AxfRuntime({ manifest: manifest('app-k'), assets: assets as never, storageKey: 'hidden-app-k' });
  ok(local.hide('toolbar:main') && local.isHidden('toolbar:main'), 'local hide');
  ok(local.unhide('toolbar:main') && !local.isHidden('toolbar:main'), 'local unhide');

  // the web look store re-reads on refresh
  const hubStore = readFileSync(join(root, 'react/hubAppLook.ts'), 'utf8');
  ok(/refresh\(\): void \{/.test(hubStore) && /this\.read\(\)/.test(hubStore), 'HubAppLookStore.refresh re-reads the document');
  const sync = readFileSync(join(root, 'react/editorSync.ts'), 'utf8');
  ok(/refreshFromSaved\(\)/.test(sync) && /'focus'/.test(sync) && /visibilitychange/.test(sync), 'useEditorSync refreshes on focus and when the tab is visible again');
  const runtimeSrc = readFileSync(join(root, 'core/runtime.ts'), 'utf8');
  ok(/lookStoreRef\?\.refresh\?\.\(\)/.test(runtimeSrc), 'refreshFromSaved re-reads the look document');
  ok(/changeLook\(\(cur\) => hideAsset\(cur, t, [\s\S]*?\}\), false\)/.test(runtimeSrc) && /changeLook\(\(cur\) => unhideAsset\(cur, t\), false\)/.test(runtimeSrc), 'a hide or unhide repaints without the skin-switch sweep');

  // s6 reflow: the app-wide chrome (instance `app`) hidden as a piece leaves the layout grid like a hidden slot; widgets leave their row
  const flow = new AxfRuntime({ manifest: manifest('app-r'), assets: assets as never, storageKey: 'hidden-app-r' });
  ok(!flow.slotHidden('toolbar'), 'the app toolbar is drawn');
  ok(flow.hide('toolbar:app') && flow.slotHidden('toolbar') && flow.hiddenSlots().includes('toolbar'), 'toolbar:app hidden → its layout region goes (hiddenSlots)');
  ok(!flow.slotHiddenOwn('toolbar') && typeof flow.settings.get('axf.hide.toolbar') !== 'boolean', 'the slot choice itself is untouched');
  ok(!flow.slotHidden('nav-menu') && flow.hide('nav-menu:app') && flow.slotHidden('nav-menu'), 'nav-menu:app the same');
  ok(flow.hide('toolbar:page.tools') && flow.hiddenAppChrome().join() === 'toolbar,nav-menu', 'a page toolbar is not the app slot');
  ok(flow.unhide('toolbar:app') && !flow.slotHidden('toolbar'), 'unhide → the region is back');
  ok(flow.hide('widget:clock:main') && flow.widgetHidden('clock:main') && !flow.bannerWidgetShown('clock:main'), 'a hidden widget is not shown on the banner');
  ok(!flow.widgetHidden('clock:other'), 'other widgets stay');
  const shell = readFileSync(join(root, 'react/hidden.tsx'), 'utf8');
  ok(/export function useHidden\(/.test(shell) && /export function Hideable\(/.test(shell) && /installHiddenChrome/.test(readFileSync(join(root, 'react/AxfProvider.tsx'), 'utf8')), 'useHidden, Hideable and the DOM pass are installed');
  for (const [f, re] of [['react/components/TabGroup.tsx', /useHidden\('tab-group', id\)/], ['react/components/Chrome.tsx', /useHidden\('toolbar', id\)/], ['react/components/BannerSettings.tsx', /useHidden\('banner', id\)/]] as const) ok(re.test(readFileSync(join(root, f), 'utf8')), `${f} draws nothing while hidden`);
  ok(/\[data-axf-hidden-piece\] \{ display: none !important; \}/.test(readFileSync(join(root, 'ui/axf.css'), 'utf8')), 'a hand-drawn hidden piece takes no room');

  // s7 right-click Hide: the shared chrome block offers Hide on every kind, the action toasts with Undo
  const cc = readFileSync(join(root, 'react/components/ChromeContext.tsx'), 'utf8');
  ok(/rt\.hideableKinds\(\)\.includes\(type\)\) items\.push\(\{ id: `chrome-hide-\$\{type\}`/.test(cc), 'chromeMenu has Hide <kind> for every hideable kind');
  ok(/register\('chrome\.hide'/.test(cc) && /register\('chrome\.unhide'/.test(cc) && /\{ label: 'Undo', action: `chrome\.unhide:\$\{kind\}:\$\{id\}` \}/.test(cc), 'chrome.hide / chrome.unhide, with an Undo toast');
  ok(/t\.act && <Button/.test(readFileSync(join(root, 'react/components/Overlays.tsx'), 'utf8')), 'a toast draws its action button');
  const t0 = flow.getState().toasts.length;
  flow.toast('x', 'info', 'Hidden', { label: 'Undo', action: 'chrome.unhide:toolbar:app' });
  eq(flow.getState().toasts.at(-1)!.act, { label: 'Undo', action: 'chrome.unhide:toolbar:app' }, 'a toast keeps its action');
  ok(flow.getState().toasts.length === t0 + 1, 'one toast');

  // s8 the Hidden list: grouped by kind, Unhide per row, Unhide all with confirm, empty state; in Appearance and as a dialog
  const panel = readFileSync(join(root, 'libs/settings/HiddenAssetsPanel.tsx'), 'utf8');
  const lib = readFileSync(join(root, 'libs/settings/index.tsx'), 'utf8');
  ok(/export function groupHidden/.test(panel) && /chrome\.unhide:\$\{key\}/.test(panel) && /chrome\.unhideAll/.test(panel) && /Tap again to unhide all/.test(panel) && /Nothing is hidden in this app/.test(panel), 'panel: groups, Unhide, Unhide all with confirm, empty state');
  ok(!/#[0-9a-f]{3,8}\b|\d+px/.test(panel.replace(/\/\*[\s\S]*?\*\//g, '')), 'panel: no literal colours or sizes');
  ok(/\[HIDDEN_ASSETS_DIALOG\]: \{ title: 'Hidden items'/.test(lib) && /HIDDEN_ASSETS_PANEL_ID, tab: 'appearance'/.test(lib) && /HIDDEN_ASSETS_DIALOG = 'axf\.hidden-assets'/.test(panel), 'mounted in Settings → Appearance and as the dialog axf.hidden-assets');

  // s9 the Assets menu: Hidden items… with the live count badge, Unhide all, Hide ▸ every visible piece; canvas Hidden items…
  flow.unhideAll(); flow.hide('banner:top'); flow.hide('tab-group:x.tabs');
  eq(flow.badge('hidden-assets.count'), 2, 'the Assets badge is the live hidden count');
  ok(/menu: 'assets', menuLabel: 'Assets'/.test(cc) && /action: 'chrome\.hidden', badge: HIDDEN_ASSETS_BADGE/.test(cc) && /action: 'chrome\.unhideAll'/.test(cc) && /provider: HIDEABLE_PROVIDER/.test(cc), 'Assets menu: Hidden items… (badge), Unhide all, Hide ▸');
  ok(/target: 'canvas'/.test(cc) && /register\('chrome\.hidden'/.test(cc), 'Hidden items… on the page menu too (reachable with the menu bar hidden)');
  ok(/data-axf-target="panel:hidden-assets"/.test(panel) && /data-axf-target=\{`row:\$\{key\}`\}/.test(panel) && /id="hidden\.unhide-all"/.test(panel) && /id=\{`hidden\.unhide\./.test(panel), 'console-control targets: panel, rows, both buttons');

  // s10–s11 the API: REST routes, MCP tools, console actions and the deep links
  const repo = join(root, '..');
  const rest = readFileSync(join(repo, 'apps/console-web/server/hidden_assets.py'), 'utf8');
  ok(['@r.get("/api/hidden-assets")', '"/api/hidden-assets/hide"', '"/api/hidden-assets/unhide"', '"/api/hidden-assets/unhide-all"'].every((x) => rest.includes(x)), 'REST: list, hide, unhide, unhide-all');
  const mcp = readFileSync(join(repo, 'apps/console-web/server/mcp_server.py'), 'utf8');
  ok(['hidden_assets_list', 'hidden_assets_hide', 'hidden_assets_unhide', 'hidden_assets_unhide_all'].every((x) => mcp.includes(`async def ${x}(`)), 'MCP: the four tools');
  ok(['chrome.hide', 'chrome.unhide', 'chrome.unhideAll', 'chrome.hidden'].every((x) => cc.includes(`register('${x}'`)), 'console actions: chrome.hide / unhide / unhideAll / hidden');
  const exe = readFileSync(join(repo, 'apps/console-web/src/control/executor.ts'), 'utf8');
  ok(/export function splitAnchor/.test(exe) && /SETTINGS_TAB_LINK/.test(exe) && /getElementById\(`axf-\$\{anchor\}`\)/.test(exe) && /id=\{`axf-\$\{HIDDEN_ASSETS_ANCHOR\}`\}/.test(panel), 'deep link view:settings/tab:appearance#hidden lands on the panel');

  // s12 CLI + voice: axf hidden …, and the spoken phrases press the same console actions (console-control voice engine; the AmberX Android app was retired on main)
  ok(/case 'hidden': \{/.test(readFileSync(join(root, 'cli/axf.mjs'), 'utf8')), 'axf hidden is wired into axf.mjs');
  const { voiceIntent } = await import('../core/engines/console-control-voice.mjs');
  eq(voiceIntent('hide the toolbar'), { verb: 'press', address: 'function:chrome.hide', value: 'toolbar:app' }, 'voice: hide the toolbar');
  eq(voiceIntent("show what's hidden"), { verb: 'press', address: 'function:chrome.hidden' }, "voice: show what's hidden");
  eq(voiceIntent('unhide everything'), { verb: 'press', address: 'function:chrome.unhideAll' }, 'voice: unhide everything');
  eq(voiceIntent('unhide the menu bar'), { verb: 'press', address: 'function:chrome.unhide', value: 'app-menu:app' }, 'voice: unhide the menu bar');
  console.log(`check-hidden-assets (runtime): ${n} checks passed`);
}

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
import { CHROME_TARGETS, CHROME_TYPES } from '../core/engines/chrome-settings-rules.mjs';
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

#!/usr/bin/env node
/**
 * designer@1 (core/engines/designer-rules.mjs + designer-doc.mjs, build ui-asset-designer, Nov 7 2026): replays
 * spec/fixtures/designer.json — the add-on model (the six built-in add-ons, manifests → add-ons, merging, choices,
 * provides), the designer interface (fields, defaults, errors, inherit chain, picks), the embed asset (normalizing,
 * errors), designed@1 manifests (uid, revision, hash, registry item, library entry + path, id rules), the asset
 * context section + info in every mode, and the document: every starter of the six families round-trips through
 * docFromAsset / assetFromDoc unchanged and validates, ops, selection, canvas, drops, history and the context menu.
 * Then the spec: the hard-coded type lists equal asset-types.json, both validators agree, the shipped assets are all
 * there (designer/default + one copy per add-on, settings/designer + one per add-on, embed starters), the JSON
 * Schemas exist and the ui-registry item is a valid ui-registry@1 item when that engine is present. Exit 1 on any
 * difference.
 *
 *   node framework/spec/check-designer.mjs [--write]     (--write regenerates the expected outputs from the fixture's inputs)
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import * as R from '../core/engines/designer-rules.mjs';
import * as D from '../core/engines/designer-doc.mjs';
import { validateAsset as engineValidate } from '../cli/build-engine.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const FILE = join(here, 'fixtures', 'designer.json');
const write = process.argv.includes('--write');
const fx = JSON.parse(readFileSync(FILE, 'utf8'));
const spec = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/asset-types.json'), 'utf8'));
let fails = 0; let n = 0;
const check = (name, ok, detail = '') => { n++; if (!ok) { fails++; console.error(`✗ ${name}${detail ? `\n  ${detail}` : ''}`); } };
const expect = (name, got, key) => {
  if (write) { fx.expected[key] = got; return; }
  check(name, isDeepStrictEqual(JSON.parse(JSON.stringify(got ?? null)), fx.expected[key] ?? null), `got ${JSON.stringify(got).slice(0, 500)}`);
};
fx.expected ??= {};
const readAsset = (type, id) => JSON.parse(readFileSync(join(ROOT, 'framework/assets', type, `${id}.json`), 'utf8'));
const list = (type) => (existsSync(join(ROOT, 'framework/assets', type)) ? readdirSync(join(ROOT, 'framework/assets', type)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(ROOT, 'framework/assets', type, f), 'utf8'))) : []);
const canon = (v) => JSON.parse(JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x)));

/* ---- add-on model */
expect('DESIGNER_ADDONS: the six Brett named, every field filled', R.DESIGNER_ADDONS, 'addons');
check('every built-in add-on normalizes to itself and has no errors', R.DESIGNER_ADDONS.every((a) => isDeepStrictEqual(R.normalizeDesignerAddon(a), a) && R.designerAddonErrors(a).length === 0));
expect('addonsFromPluginManifest: a designer block + designer: provides, plugin / folder defaults', R.addonsFromPluginManifest(fx.manifest, 'my-designer'), 'fromManifest');
expect('designerAddonErrors: the bad declaration', R.designerAddonErrors(fx.badAddon), 'badAddonErrors');
check('normalizeDesignerAddon: nothing without an id or a type', R.normalizeDesignerAddon({ label: 'x', types: ['toolbar'] }) === null && R.normalizeDesignerAddon({ id: 'x' }) === null);
expect('mergeAddons: a declared add-on with a built-in id replaces it, new ones join', R.mergeAddons([{ id: 'toolbar', label: 'My toolbar designer', types: ['toolbar'], plugin: 'ai.amberx.axf.console.my-toolbar' }, { id: 'tabs', types: ['tab-group'] }]).map((a) => ({ id: a.id, label: a.label, plugin: a.plugin, types: a.types })), 'merged');
check('addonForType', R.addonForType(R.DESIGNER_ADDONS, 'clock')?.id === 'widget' && R.addonForType(R.DESIGNER_ADDONS, 'toolbar')?.id === 'toolbar' && R.addonForType(R.DESIGNER_ADDONS, 'color-theme') === null);
expect('designerAddonChoices: installed flags', R.designerAddonChoices(R.DESIGNER_ADDONS, ['ai.amberx.axf.console.toolbar-designer']), 'choices');
expect('addonProvides', R.DESIGNER_ADDONS.map((a) => R.addonProvides(a)), 'provides');

/* ---- the designer interface */
expect('DESIGNER_FIELDS', R.DESIGNER_FIELDS, 'fields');
expect('DESIGNER_DEFAULT', R.DESIGNER_DEFAULT, 'default');
expect('normalizeDesigner: bad values fall back, unknown fields dropped', R.normalizeDesigner(fx.designerPartial), 'normalizedDesigner');
expect('designerInterfaceErrors', R.designerInterfaceErrors(fx.designerPartial), 'designerErrors');
check('designerInterfaceErrors: the default has none', R.designerInterfaceErrors(R.DESIGNER_DEFAULT).length === 0 && R.designerErrors('designer', { canvas: { grid: 7 } }).length === 0 && R.designerErrors('toolbar', { canvas: { grid: 999 } }).length === 0);
const lib = { default: readAsset('designer', 'default'), toolbar: readAsset('designer', 'toolbar'), edited: { id: 'edited', data: { extends: 'toolbar', canvas: { grid: 16 }, panels: { preview: 'float' } } } };
expect('resolveDesignerChain: an unedited copy equals the default; an edited one folds (depth 2)', { copy: R.resolveDesignerChain((id) => lib[id], 'toolbar'), edited: R.resolveDesignerChain((id) => lib[id], 'edited') }, 'chain');
check('an unedited add-on copy resolves to exactly the default interface', isDeepStrictEqual({ ...R.resolveDesignerChain((id) => lib[id], 'toolbar'), for: undefined }, { ...R.normalizeDesigner(lib.default.data), for: undefined }));
expect('designerInterfacePick', { own: R.designerInterfacePick('toolbar', ['default', 'toolbar']), fallback: R.designerInterfacePick('banner', ['default', 'toolbar']), none: R.designerInterfacePick('banner', ['toolbar']) }, 'picks');
expect('designerSettingsErrors', { ok: R.designerSettingsErrors(readAsset('settings', 'designer-toolbar')), host: R.designerSettingsErrors(readAsset('settings', 'designer')), badFor: R.designerSettingsErrors({ id: 'designer-x', data: { for: 'designer:X Y' } }), badId: R.designerSettingsErrors({ id: 'my-settings', data: { for: 'designer:toolbar', extends: 'designer' } }), badExtends: R.designerSettingsErrors({ id: 'designer-toolbar', data: { for: 'designer:toolbar' } }), chrome: R.designerSettingsErrors({ id: 'chrome-toolbar', data: { for: 'toolbar' } }) }, 'settingsErrors');
expect('designerPlan + designerMissing', { plan: R.designerPlan(), missing: R.designerMissing(['default'], ['designer', 'designer-toolbar']) }, 'plan');

/* ---- the embed asset */
expect('normalizeEmbed', fx.embeds.map((e) => R.normalizeEmbed(e)), 'embeds');
expect('embedAssetErrors', fx.embeds.map((e) => R.embedAssetErrors(e)), 'embedErrors');
check('a url embed is always sandboxed', R.normalizeEmbed({ target: { kind: 'url', url: 'https://x.y' }, sandbox: false }).sandbox === true);
expect('designerSchemaProperties', { designer: R.designerSchemaProperties('designer'), embed: R.designerSchemaProperties('embed') }, 'schemaProps');

/* ---- designed@1 */
const toolbar = readAsset('toolbar', 'standard-icons');
const designedAsset = { ...toolbar, id: 'my-bar', name: 'My bar', version: '1.0.0' };
const m1 = R.makeDesigned({ asset: designedAsset, addon: R.DESIGNER_ADDONS[2], app: 'axf-console-web', by: 'Brett', now: '2026-11-07T10:00:00.000Z', uid: 'dz-fixed01', origin: { said: 'make me a toolbar', source: 'voice' }, extras: { placement: 'top', junk: { no: 1 } } });
const m2 = R.makeDesigned({ asset: { ...designedAsset, data: { ...designedAsset.data, align: 'center' } }, addon: 'toolbar', now: '2026-11-07T11:00:00.000Z', previous: m1, output: { version: 'minor' } });
expect('makeDesigned: first revision', m1, 'manifest1');
expect('makeDesigned: a later save keeps uid / createdAt / origin, bumps revision + version, new hash', m2, 'manifest2');
check('designedHash: stable, order-free, 8 hex', R.designedHash({ a: 1, b: [1, 2] }) === R.designedHash({ b: [1, 2], a: 1 }) && /^[0-9a-f]{8}$/.test(R.designedHash(toolbar.data)) && R.designedHash({ a: 1 }) !== R.designedHash({ a: 2 }));
check('designedUid: fixed with rand, matches the pattern', R.designedUid(1_000_000, 0.5) === R.designedUid(1_000_000, 0.5) && R.DESIGNED_UID.test(R.designedUid()) && R.designedUid(1_000_000, 0.5) !== R.designedUid(1_000_000, 0.6));
const withM = R.withDesigned(designedAsset, m1);
check('withDesigned / designedOf', R.designedOf(withM) === m1 && R.designedOf(toolbar) === null && withM.version === m1.version);
expect('designedErrors: a good manifest has none; the broken ones', { ok: R.designedErrors(m1, designedAsset), wrongAsset: R.designedErrors(m1, toolbar), changed: R.designedErrors(m1, { ...designedAsset, data: { ...designedAsset.data, align: 'center' } }), bad: R.designedErrors(fx.badManifest) }, 'manifestErrors');
check('validators refuse a tampered designed asset (TS + build engine agree)', engineValidate({ ...withM, data: { ...withM.data, align: 'center' } }).errors.some((e) => e.includes('designed.hash')) && engineValidate(withM).ok);
expect('designedRegistryItem', R.designedRegistryItem(m1), 'registryItem');
expect('designedLibraryEntry + paths', { entry: R.designedLibraryEntry(m1), app: R.designedLibraryPath(m1, 'app', 'console-web'), framework: R.designedLibraryPath(m1, 'framework'), hub: R.designedLibraryPath(m1, 'hub') }, 'library');
expect('normalizeDesignerLibrary + upsert: one row per uid, newest wins, a rename keeps the row', R.upsertDesignerLibrary({ items: [R.designedLibraryEntry(m1), { uid: 'dz-other', ref: 'banner/x', updatedAt: '2026-01-01T00:00:00Z' }, { bad: true }] }, R.designedLibraryEntry({ ...m2, id: 'renamed', ref: 'toolbar/renamed' })), 'libraryIndex');
expect('designedIdErrors + suggestAssetId', { bad: R.designedIdErrors('X', { prefix: 'my-' }), builtin: R.designedIdErrors('standard-icons', { builtin: ['standard-icons'] }), exists: R.designedIdErrors('my-bar', { existing: ['my-bar'] }), ok: R.designedIdErrors('my-bar-2', { existing: ['my-bar'], prefix: 'my-' }), suggest: [R.suggestAssetId('My Bar!', { existing: ['my-bar', 'my-bar-2'] }), R.suggestAssetId('', {}), R.suggestAssetId('Builds', { prefix: 'cw-' })] }, 'ids');

/* ---- asset-context@1 */
const ctxAssets = ['toolbar/standard-icons', 'banner/amberx-thin', 'nav-menu/sidebar-list', 'app-menu/standard-desktop', 'context-menu/compact-classic', 'tab-group/underline', 'clock/digital-12h', 'embed/docs-page', 'dialog/centered-modal'].map((r) => readAsset(...r.split('/')));
expect('assetSummary per type', ctxAssets.map((a) => ({ ref: `${a.type}/${a.id}`, summary: R.assetSummary(a) })), 'summaries');
expect('assetInfo in every mode (a designed asset)', Object.fromEntries(R.ASSET_INFO_MODES.map((mode) => [mode, R.assetInfo(withM, mode, { usedIn: ['Dev Console › main toolbar'] })])), 'info');
expect('assetInfo for a built-in asset', R.assetInfo(toolbar, 'hover-card'), 'infoBuiltin');
expect('assetContextSection: default interface, with an add-on', R.assetContextSection(withM, { addon: R.DESIGNER_ADDONS[2], usedIn: ['Dev Console › main toolbar'] }), 'contextDesigned');
expect('assetContextSection: chrome kind (no Change), preview off, help off', R.assetContextSection(toolbar, { isChrome: true, interface: { context: { preview: false, help: false } } }), 'contextChrome');
check('assetContextSection: a theme is not a UI asset', R.assetContextSection({ type: 'color-theme', id: 'x', name: 'X', data: {} }).length === 0);
check('assetRef / parseAssetRef / assetRefFromAttr', R.parseAssetRef('toolbar/standard-icons')?.id === 'standard-icons' && R.parseAssetRef('Toolbar/x') === null && R.parseAssetRef('toolbar') === null && R.assetRefFromAttr('embed/docs-page')?.type === 'embed');

/* ---- the document: round trips */
const families = ['toolbar', 'banner', 'nav-menu', 'app-menu', 'context-menu'];
for (const type of families) for (const a of list(type)) {
  const doc = D.docFromAsset(a, 'x');
  const back = D.assetFromDoc(doc, a);
  check(`${type}/${a.id}: round trip keeps the data`, isDeepStrictEqual(canon(back.data), canon(a.data)), JSON.stringify(back.data).slice(0, 300));
  check(`${type}/${a.id}: document has no errors`, D.docErrors(doc).length === 0, D.docErrors(doc).join('; '));
  check(`${type}/${a.id}: the written asset validates`, engineValidate(back).ok, engineValidate(back).errors.join('; '));
}
for (const t of R.DESIGNER_WIDGET_TYPES.concat(['embed', 'tab-group'])) for (const a of list(t)) { const back = D.assetFromDoc(D.docFromAsset(a), a); check(`${t}/${a.id}: flat round trip`, isDeepStrictEqual(canon(back.data), canon(a.data)) && D.familyOf(t).id === 'flat'); }
expect('families: kinds, accepts, props, labels', Object.fromEntries(families.map((t) => [t, { family: D.familyOf(t).id, kinds: D.nodeKinds(t), accepts: Object.fromEntries(D.nodeKinds(t).concat([D.ROOT]).map((k) => [k, D.acceptsKinds(t, k)])), props: Object.fromEntries(D.nodeKinds(t).map((k) => [k, D.nodeProps(t, k)])), labels: Object.fromEntries(D.nodeKinds(t).map((k) => [k, D.nodeKindLabel(t, k)])), palette: D.palette(t) }])), 'families');
expect('docFromAsset: the toolbar starter as a document', D.docFromAsset(toolbar, 'toolbar'), 'toolbarDoc');

/* ---- the document: ops, selection, canvas */
let doc = D.docFromAsset(toolbar, 'toolbar');
const g0 = doc.nodes[D.ROOT].children[0];
const added = D.addNode(doc, g0, 'item', { label: 'Hello', icon: 'zap', action: 'x.y' }, 0);
check('addNode: asset id made from the label, placed at the index', added && added.doc.nodes[added.id].props.id === 'hello' && added.doc.nodes[g0].children[0] === added.id);
check('addNode: refused where the parent does not take the kind / unknown parent', D.addNode(doc, g0, 'group') === null && D.addNode(doc, 'nope', 'item') === null);
doc = added.doc;
const dup = D.duplicate(doc, [added.id]);
check('duplicate: right after the original, unique asset id, selected', dup.ids.length === 1 && dup.doc.nodes[g0].children[1] === dup.ids[0] && dup.doc.nodes[dup.ids[0]].props.id === 'hello-copy' && isDeepStrictEqual(dup.doc.selection, dup.ids));
const moved = D.moveNodes(dup.doc, [dup.ids[0]], doc.nodes[D.ROOT].children[1], 0);
check('moveNodes: into another group at index 0', moved && moved.nodes[doc.nodes[D.ROOT].children[1]].children[0] === dup.ids[0] && moved.nodes[dup.ids[0]].parent === doc.nodes[D.ROOT].children[1]);
check('moveNodes: refused into itself / where the kind is not taken', D.moveNodes(doc, [g0], g0) === null && D.moveNodes(doc, [added.id], D.ROOT) === null);
const removed = D.removeNodes(moved, [g0]);
check('removeNodes: the group and its items go, selection cleaned', !removed.nodes[g0] && !removed.nodes[added.id] && !removed.nodes[D.ROOT].children.includes(g0));
check('setProps / setData / renameDoc', D.setProps(doc, [added.id], { label: 'Hi', icon: '' }).nodes[added.id].props.label === 'Hi' && !('icon' in D.setProps(doc, [added.id], { icon: '' }).nodes[added.id].props) && D.setData(doc, { align: 'center' }).data.align === 'center' && D.renameDoc(doc, 'New', 'new-bar').id === 'new-bar' && D.renameDoc(doc, 'New', 'X').id === doc.id);
const am = D.docFromAsset(readAsset('app-menu', 'standard-desktop'), 'app-menu');
const menu0 = am.nodes[D.ROOT].children[0]; const [a1, a2] = am.nodes[menu0].children;
const grp = D.group(am, [a1, a2], 'item', { label: 'More' });
check('group: siblings wrapped in a submenu item, selected', grp && grp.doc.nodes[grp.id].children.length === 2 && grp.doc.nodes[menu0].children[0] === grp.id && isDeepStrictEqual(grp.doc.selection, [grp.id]));
check('group: refused across parents or where the wrapper is not taken', D.group(am, [a1, am.nodes[D.ROOT].children[1]], 'item') === null && D.group(doc, [added.id], 'group') === null);
const ung = D.ungroup(grp.doc, grp.id);
check('ungroup: puts the children back in place', ung && isDeepStrictEqual(ung.nodes[menu0].children.slice(0, 2), [a1, a2]) && !ung.nodes[grp.id]);
check('lock / hide / step', D.lockNodes(doc, [added.id]).nodes[added.id].locked === true && !('locked' in D.lockNodes(D.lockNodes(doc, [added.id]), [added.id], false).nodes[added.id]) && D.hideNodes(doc, [added.id]).nodes[added.id].hidden === true && D.stepNodes(doc, [added.id], 'forward').nodes[g0].children[1] === added.id && D.stepNodes(doc, [added.id], 'backward').nodes[g0].children[0] === added.id);
check('hidden nodes are left out of the written asset', !D.assetFromDoc(D.hideNodes(doc, [added.id]), toolbar).data.groups[0].items.some((i) => i.id === 'hello'));
const items = doc.nodes[g0].children;
check('select: single / add / toggle / range', isDeepStrictEqual(D.select(doc, items[0]).selection, [items[0]]) && D.select(D.select(doc, items[0]), items[2], { add: true }).selection.length === 2 && D.select(D.select(doc, items[0]), items[0], { toggle: true }).selection.length === 0 && D.select(D.select(doc, items[0]), items[2], { range: true }).selection.length === 3);
check('selectAll / selectKind / clearSelection / topSelection', D.selectAll(doc, g0).selection.length === items.length && D.selectKind(doc, 'group').selection.length === doc.nodes[D.ROOT].children.filter((c) => doc.nodes[c].kind === 'group').length && D.clearSelection(D.selectAll(doc)).selection.length === 0 && isDeepStrictEqual(D.topSelection({ ...doc, selection: [g0, items[0]] }), [g0]));
const laid = D.autoLayout(doc);
expect('autoLayout: a flow grid for the root children', laid.canvas, 'autoLayout');
const ui = R.normalizeDesigner({ canvas: { grid: 8, snap: true } });
expect('place / nudge / align / distribute / bounds', (() => { let d = D.place(laid, g0, { x: 13, y: 9 }, ui); const ids = d.nodes[D.ROOT].children.slice(0, 3); d = D.nudge(d, [g0], 2, -1, ui); const al = D.align(d, ids, 'left', ui); const di = D.distribute(D.place(D.place(al, ids[1], { x: 20 }, ui), ids[2], { x: 500 }, ui), ids, 'x', ui); return { placed: d.canvas[g0], aligned: ids.map((id) => al.canvas[id].x), distributed: ids.map((id) => di.canvas[id].x), bounds: D.selectionBounds(di, ids) }; })(), 'canvasOps');
check('snapTo / zoomSteps / zoomFit', D.snapTo(13, 8) === 16 && D.snapTo(13, 8, false) === 13 && isDeepStrictEqual(D.zoomSteps(ui), [25, 33, 50, 67, 75, 100, 125, 150, 200, 300, 400]) && D.zoomFit({ x: 0, y: 0, w: 400, h: 200 }, { w: 848, h: 648 }, ui) === 200 && D.zoomFit(null, { w: 1, h: 1 }) === 100 && D.zoomFit({ x: 0, y: 0, w: 4000, h: 200 }, { w: 148, h: 148 }, ui) === 25);

/* ---- the document: drops */
expect('parseDrop: every payload shape', fx.drops.map((d) => ({ in: d, out: D.parseDrop(d.types, d.files) })), 'parsedDrops');
const addon = R.DESIGNER_ADDONS[2];
expect('canDrop + applyDrop on the toolbar', fx.drops.map((d) => { const p = D.parseDrop(d.types, d.files); const target = d.target.node === 'group' ? { node: g0, position: d.target.position } : d.target.node === 'root' ? { node: D.ROOT, position: 'inside' } : d.target; const can = D.canDrop(doc, addon, p, target); const ap = can.ok ? D.applyDrop(doc, addon, p, target, ui) : null; return { can, node: ap?.ids?.length ? { kind: ap.doc.nodes[ap.ids[0]].kind, props: ap.doc.nodes[ap.ids[0]].props, canvas: ap.doc.canvas[ap.ids[0]] ?? null, parent: ap.doc.nodes[ap.ids[0]].parent === g0 ? 'group' : ap.doc.nodes[ap.ids[0]].parent } : ap?.error ?? null }; }), 'drops');
check('canDrop: an add-on that does not take the kind, a locked target, a node into itself', !D.canDrop(doc, R.DESIGNER_ADDONS[3], { kind: 'action', action: 'x.y' }, { node: g0, position: 'inside' }).ok && !D.canDrop(D.lockNodes(doc, [g0]), addon, { kind: 'action', action: 'x.y' }, { node: g0, position: 'inside' }).ok && !D.canDrop(doc, addon, { kind: 'node', ids: [g0] }, { node: g0, position: 'inside' }).ok);
check('applyDrop: a node drop moves', (() => { const r = D.applyDrop(doc, addon, { kind: 'node', ids: [items[0]] }, { node: doc.nodes[D.ROOT].children[1], position: 'inside' }); return !r.error && r.doc.nodes[items[0]].parent === doc.nodes[D.ROOT].children[1]; })());
check('a JSON manifest file drops only on an embed document', D.canDrop(D.newDoc({ type: 'embed', id: 'e' }), R.DESIGNER_ADDONS[4], { kind: 'file', name: 'x.json', type: 'application/json' }, { node: D.ROOT, position: 'inside' }).as === 'manifest' && !D.canDrop(doc, addon, { kind: 'file', name: 'x.json' }, { node: D.ROOT, position: 'inside' }).ok);
check('nodeDragPayload / DESIGNER_DROP_MIME', JSON.parse(D.nodeDragPayload([items[0], items[0]])).ids.length === 1 && R.DESIGNER_DROP_MIME.startsWith('application/'));

/* ---- history */
let h = D.createHistory(doc, 3);
h = D.commit(h, dup.doc, { label: 'Duplicate', at: 1 }); h = D.commit(h, moved, { label: 'Move', at: 2 }); h = D.commit(h, removed, { label: 'Delete', at: 3 });
check('commit / undo / redo / labels', D.canUndo(h) && !D.canRedo(h) && D.historyLabels(h).undo === 'Delete' && D.undo(h).present === moved && D.historyLabels(D.undo(h)).redo === 'Delete' && D.redo(D.undo(h)).present === removed && D.undo(D.undo(D.undo(h))).present === doc && !D.canUndo(D.undo(D.undo(D.undo(h)))));
h = D.commit(h, D.setData(removed, { align: 'end' }), { label: 'Align', at: 4 });
check('history: the limit drops the oldest state', h.past.length === 3 && D.undo(D.undo(D.undo(h))).present === dup.doc);
let hc = D.createHistory(doc);
hc = D.commit(hc, D.setProps(doc, [items[0]], { label: 'A' }), { label: 'Label', at: 100, coalesceMs: 400 });
hc = D.commit(hc, D.setProps(doc, [items[0]], { label: 'AB' }), { label: 'Label', at: 300, coalesceMs: 400 });
hc = D.commit(hc, D.setProps(doc, [items[0]], { label: 'ABC' }), { label: 'Label', at: 900, coalesceMs: 400 });
check('history: quick edits of one label coalesce, a pause starts a new step', hc.past.length === 2 && D.undo(hc).present.nodes[items[0]].props.label === 'AB');
check('commit: the same document is no step', D.commit(hc, hc.present, { label: 'x', at: 1000 }) === hc);

/* ---- the designer context menu + keys */
expect('designerContextMenu: a node (several selected), the canvas, a locked node, flow mode', { node: D.designerContextMenu({ ...doc, selection: items.slice(0, 2) }, addon, { node: items[0] }, R.DESIGNER_DEFAULT, { clipboard: true, history: h }), canvas: D.designerContextMenu(doc, addon, {}, R.DESIGNER_DEFAULT, { clipboard: false, history: null }), locked: D.designerContextMenu(D.lockNodes(doc, [g0]), addon, { node: g0 }), flow: D.designerContextMenu(doc, addon, {}, R.normalizeDesigner({ canvas: { mode: 'flow' }, context: { insert: false, clipboard: false } })) }, 'contextMenus');
check('designerContextMenu: every entry has an id and every action is a designer / help verb', [{ node: items[0] }, {}].flatMap((c) => D.designerContextMenu(doc, addon, c)).flatMap((e) => [e, ...(e.items ?? [])]).every((e) => e.id && (e.separator || e.items || /^(designer|help)\./.test(e.action ?? ''))));
expect('DESIGNER_KEYS + verbs', { keys: D.DESIGNER_KEYS, verbs: D.DESIGNER_VERBS }, 'keys');

/* ---- the spec: lists equal asset-types.json, validators, shipped assets, schemas */
check('ASSET_ID_PATTERN = envelope.idPattern', R.ASSET_ID_PATTERN === spec.envelope.idPattern);
check('DESIGNER_WIDGET_TYPES = the widget types of asset-types.json, in order', isDeepStrictEqual(R.DESIGNER_WIDGET_TYPES, Object.keys(spec.types).filter((t) => spec.types[t].widget === true)));
check('UI_ASSET_TYPES: every drawn type (Navigation / Overlays / Controls / Chrome / Widgets groups, less layouts, styles and cards) + embed', isDeepStrictEqual([...R.UI_ASSET_TYPES].sort(), [...Object.keys(spec.types).filter((t) => ['Navigation', 'Overlays', 'Controls', 'Chrome', 'Widgets'].includes(spec.types[t].group) && !['dock-layout', 'nav-style', 'agent-card', 'card', 'embed'].includes(t)), 'embed'].sort()), JSON.stringify(R.UI_ASSET_TYPES));
for (const t of R.UI_ASSET_TYPES) { check(`${t}: label = asset-types.json`, R.UI_ASSET_LABELS[t] === spec.types[t]?.label, `${R.UI_ASSET_LABELS[t]} vs ${spec.types[t]?.label}`); check(`${t}: icon = asset-types.json`, R.UI_ASSET_ICONS[t] === spec.types[t]?.icon, `${R.UI_ASSET_ICONS[t]} vs ${spec.types[t]?.icon}`); }
check('the designer and embed types are in the spec, optional, never rolled; designer is not shared', spec.types.designer?.optional === true && spec.types.designer.shared === false && spec.types.designer.roll?.slot === false && spec.types.embed?.optional === true && spec.types.embed.shared !== false && spec.types.embed.roll?.asset === false);
check('the embed enums in the spec = the engine', isDeepStrictEqual(spec.types.embed.enums.load, R.EMBED_LOADS) && isDeepStrictEqual(spec.types.embed.enums.expand, R.EMBED_EXPANDS) && isDeepStrictEqual(spec.types.designer.enums['canvas.mode'], R.DESIGNER_FIELDS.find((f) => f.key === 'canvas.mode').options));
check('the envelope documents designed@1', typeof spec.envelope.optional_fields.designed === 'string' && spec.envelope.optional_fields.designed.includes('designed@1'));
check('defaults.json names the designer interface', JSON.parse(readFileSync(join(ROOT, 'framework/defaults.json'), 'utf8')).designer === 'default');
for (const t of ['designer', 'embed']) check(`JSON Schema for ${t} exists and carries the engine fields`, existsSync(join(ROOT, `framework/schemas/json/${t}.schema.json`)) && Object.keys(JSON.parse(readFileSync(join(ROOT, `framework/schemas/json/${t}.schema.json`), 'utf8')).properties.data.properties).length >= 5);
const designers = list('designer'), settings = list('settings'), embeds = list('embed');
check('designer/default + one copy per add-on ship; settings/designer + one per add-on; embed starters', R.designerMissing(designers.map((a) => a.id), settings.map((a) => a.id)).length === 0 && embeds.length >= 2, R.designerMissing(designers.map((a) => a.id), settings.map((a) => a.id)).join(', '));
for (const a of [...designers, ...embeds, ...settings.filter((s) => s.id.startsWith('designer'))]) { const r = engineValidate(a); check(`${a.type}/${a.id} validates`, r.ok, r.errors.join('; ')); }
for (const a of R.DESIGNER_ADDONS) {
  const copy = designers.find((d) => d.id === a.interface); const s = settings.find((x) => x.id === a.settings);
  const resolved = (id) => ({ ...R.resolveDesignerChain((x) => designers.find((d) => d.id === x), id), for: undefined });
  check(`designer/${a.interface}: for ${a.id}, extends default, equals the default when resolved`, copy?.data.for === a.id && copy.data.extends === 'default' && isDeepStrictEqual(resolved(a.interface), resolved('default')));
  check(`settings/${a.settings}: for designer:${a.id}, extends designer`, s?.data.for === `designer:${a.id}` && s.data.extends === 'designer' && R.designerSettingsErrors(s).length === 0);
}
// ui-registry@1 (build ui-registry-shortcuts): when its engine is here, a designed asset's item is a valid item that keeps its id and open
const uiRules = join(ROOT, 'framework/core/engines/ui-registry-rules.mjs');
if (existsSync(uiRules)) {
  const U = await import(uiRules);
  const item = R.designedRegistryItem(m1);
  const norm = U.normalizeUiItem(item, { app: 'axf-console-web' });
  check('designedRegistryItem is a valid ui-registry@1 item (id, kind, open kept)', norm && norm.id === item.id && norm.kind === item.kind && isDeepStrictEqual(norm.open, item.open), JSON.stringify(norm));
  check('ui-registry@1 knows every kind a designed asset registers as', Object.values(R.DESIGNED_UI_KIND).every((k) => U.UI_KINDS.includes(k)));
} else n++;

if (write) { writeFileSync(FILE, JSON.stringify(fx, null, 2) + '\n'); console.log(`wrote ${FILE}`); }
if (fails) { console.error(`designer@1: ${fails} of ${n} checks failed`); process.exit(1); }
console.log(`designer@1: ${n} checks ok`);

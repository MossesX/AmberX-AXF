// @ts-nocheck: a Node test, not part of the console's build
/** Icon Browser model tests (pure): filters, sorting, tree, grid window, drag payloads, pack drafts. npx -y tsx apps/console-web/plugins/icon-browser/test.mts */
import assert from 'node:assert/strict';
import { addToDraft, buildTree, cleanConfig, dragPayload, filterIcons, flattenTree, glyphNameIn, gridWindow, parseDrag, slug, sortIcons, values, type IconRecord } from './web/model';

const rec = (name: string, set: string, pack: string, category = '', tags: string[] = [], style = 'outline'): IconRecord => ({ name, set, pack, category, tags, style, ref: `pack:${pack}/${name}` });
const ICONS = [rec('save', 'lucide', 'lucide-m-t', '', ['floppy disk']), rec('save', 'tabler', 'tabler-devices', 'Devices', ['disk']), rec('home', 'lucide', 'lucide-d-m', '', ['house']), rec('trash', 'tabler', 'tabler-system', 'System', ['bin', 'delete']), rec('bookmark', 'heroicons-solid', 'heroicons-solid-a-z', '', [], 'filled')];
let n = 0;
const t = (name: string, fn: () => void) => { n++; try { fn(); } catch (e) { console.error(`✗ ${name}: ${(e as Error).message}`); process.exitCode = 1; } };

t('filterIcons: words match name, tags and category; set / category / style narrow; sorted by name then set', () => {
  assert.deepEqual(filterIcons(ICONS, { q: 'disk', set: '', category: '', style: '' }).map((i) => i.ref), ['pack:lucide-m-t/save', 'pack:tabler-devices/save']);
  assert.deepEqual(filterIcons(ICONS, { q: '', set: 'tabler', category: 'System', style: '' }).map((i) => i.name), ['trash']);
  assert.deepEqual(filterIcons(ICONS, { q: '', set: '', category: '', style: 'filled' }).map((i) => i.name), ['bookmark']);
  assert.deepEqual(filterIcons(ICONS, { q: 'delete bin', set: '', category: '', style: '' }).map((i) => i.name), ['trash']);
  assert.deepEqual(filterIcons(ICONS, { q: '', set: '', category: '', style: '' }).map((i) => i.name), ['bookmark', 'home', 'save', 'save', 'trash']);
});
t('sortIcons by set keeps name order inside a set', () => {
  assert.deepEqual(sortIcons(ICONS, 'set').map((i) => `${i.set}/${i.name}`), ['heroicons-solid/bookmark', 'lucide/home', 'lucide/save', 'tabler/save', 'tabler/trash']);
  assert.deepEqual(values(ICONS, 'category'), ['Devices', 'System']);
});
t('buildTree: sets → categories (when the set has them) → icons; flatten follows the open set', () => {
  const tree = buildTree(ICONS, { lucide: 'Lucide' });
  assert.deepEqual(tree.map((s) => [s.label, s.count, s.children!.length]), [['heroicons-solid', 1, 1], ['Lucide', 2, 2], ['tabler', 2, 2]]);
  const tabler = tree[2]!;
  assert.deepEqual(tabler.children!.map((c) => [c.kind, c.label, c.count]), [['category', 'Devices', 1], ['category', 'System', 1]]);
  assert.equal(tree[1]!.children![0]!.kind, 'icon'); // lucide has no categories: icons sit right under the set
  assert.deepEqual(flattenTree(tree, new Set()).map((r) => r.node.id), ['heroicons-solid', 'lucide', 'tabler']);
  assert.deepEqual(flattenTree(tree, new Set(['tabler', 'tabler/System'])).map((r) => `${r.depth}:${r.node.id}`), ['0:heroicons-solid', '0:lucide', '0:tabler', '1:tabler/Devices', '1:tabler/System', '2:pack:tabler-system/trash']);
});
t('gridWindow: columns that fit, visible rows + overscan, total height', () => {
  const w = gridWindow({ count: 100, width: 500, tile: 90, gap: 10, scrollTop: 250, height: 300, rowHeight: 100, overscan: 1 });
  assert.equal(w.cols, 5); assert.equal(w.rows, 20); assert.equal(w.first, 1); assert.equal(w.last, 7); assert.equal(w.start, 5); assert.equal(w.end, 35); assert.equal(w.total, 2000);
});
t('drag payloads round-trip and junk is dropped', () => {
  const icons = parseDrag(dragPayload(ICONS.slice(0, 2), 'library'));
  assert.deepEqual(icons.map((i) => i.ref), ['pack:lucide-m-t/save', 'pack:tabler-devices/save']);
  assert.deepEqual(parseDrag('not json'), []); assert.deepEqual(parseDrag(JSON.stringify({ icons: [{ ref: 1 }] })), []);
});
t('pack drafts: no duplicate refs; same names from two sets get a set suffix', () => {
  const d = addToDraft(addToDraft([], ICONS.slice(0, 2)), ICONS.slice(0, 3));
  assert.equal(d.length, 3);
  assert.equal(glyphNameIn(d, d[0]!), 'save'); assert.equal(glyphNameIn(d, d[1]!), 'save-tabler'); assert.equal(glyphNameIn(d, d[2]!), 'home');
  assert.equal(slug('My Pack!  v2'), 'my-pack-v2');
});
t('cleanConfig keeps known values and fills the rest', () => {
  const c = cleanConfig({ view: 'tree', tile: 'xl', panes: { composer: false }, openNewGroup: 'floating', sections: { library: false, x: 1 } });
  assert.equal(c.view, 'tree'); assert.equal(c.tile, 'md'); assert.deepEqual(c.panes, { library: true, composer: false, details: true }); assert.equal(c.openNewGroup, 'floating'); assert.deepEqual(c.sections, { library: false, x: false });
});

if (!process.exitCode) console.log(`✓ icon-browser model: ${n} checks`);

// @ts-nocheck: a Node test, not part of the console's build
/**
* Data set bar self-test body (run by ../test.mts under tsx with the console tsconfig, so `@console/*` resolves): the plugin's pure core (default picks, action encoding, the right-click block, the Registry
 * Browser items) on top of the framework engine, and the engine driving a real lib-datagrid dataset transform.
 *   node apps/console-web/plugins/data-set-bar/test.mts
 */
import assert from 'node:assert/strict';
import { applyDataset, clearDatasetTransform, datasetFiltered, registerDataset, setDatasetTransform, type DatasetField } from '@console/axf/libs/datagrid/datasets';
import { attachBar, attachPiece, DSB_EMPTY_STATE, makeDsbCompare, makeDsbFilter, normalizeAttachment, resolveAttachment, type DsbAttachment } from '@console/axf/core/engines/datasetbar';
import { ACTIONS, act, assetCardItems, datasetContextItems, dec, describeAttachment, enc, isPiece, isPlacement, parseDefaults, DEFAULTS } from './core';

let n = 0; const t = (name: string, f: () => void) => { f(); n++; void name; };
const T = '2026-11-07T00:00:00.000Z';
const bar = { placement: 'top', search: 'dataset', filter: 'default', sort: 'default', count: true, clear: true };
const ctx = { bars: [{ id: 'default', name: 'Data set bar' }, { id: 'compact', name: 'Compact' }], pieces: { search: [{ id: 'dataset', name: 'Data set search' }], filter: [{ id: 'default', name: 'Filter' }], sort: [{ id: 'default', name: 'Sort' }] }, resolved: null };
const flat = (items: any[]): any[] => items.flatMap((i) => [i, ...flat(i.items ?? [])]);

t('defaults: parse, junk, fallbacks', () => {
  assert.deepEqual(parseDefaults(undefined), DEFAULTS);
  assert.deepEqual(parseDefaults('{"bar":"compact","placement":"floating","search":"Bad Id"}'), { ...DEFAULTS, bar: 'compact', placement: 'floating' });
  assert.deepEqual(parseDefaults('{nope'), DEFAULTS);
});
t('actions: arguments travel encoded, data set ids may hold colons', () => {
  const a = act(ACTIONS.attach, 'grid:builds/x', 'top');
  assert.equal(a, `${ACTIONS.attach}:${enc('grid:builds/x')}:top`);
  const [, ...args] = a.split(':').slice(1).length ? ['', ...a.slice(ACTIONS.attach.length + 1).split(':')] : [''];
  assert.equal(dec(args[0]!), 'grid:builds/x'); assert.equal(args[1], 'top');
  assert.equal(act(ACTIONS.list), ACTIONS.list);
  assert.ok(isPiece('search') && !isPiece('rows')); assert.ok(isPlacement('floating') && !isPlacement('side'));
});
t('context menu, not attached: Attach data set bar ▸ four placements + Attach piece ▸ three pieces', () => {
  const items = datasetContextItems('builds', null, ctx);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0]!.items!.map((i) => i.label), ['Top', 'Bottom', 'Inline', 'Floating']);
  assert.equal(items[0]!.items![3]!.action, act(ACTIONS.attach, 'builds', 'floating'));
  assert.deepEqual(items[1]!.items!.map((i) => i.action), [act(ACTIONS.piece, 'builds', 'search'), act(ACTIONS.piece, 'builds', 'filter'), act(ACTIONS.piece, 'builds', 'sort')]);
  assert.deepEqual(datasetContextItems('', null, ctx), []);
});
t('context menu, attached: one Data set bar ▸ block with settings, filter, sort, move, change bar, detach piece, reset, detach', () => {
  const att: DsbAttachment = attachBar({}, 'builds', { placement: 'bottom', now: T }).builds!;
  const resolved = resolveAttachment(att, bar);
  const items = datasetContextItems('builds', att, { ...ctx, resolved });
  assert.equal(items.length, 1); assert.equal(items[0]!.label, 'Data set bar');
  const labels = items[0]!.items!.filter((i) => !i.separator).map((i) => i.label);
  assert.deepEqual(labels, ['Settings…', 'Filter…', 'Sort…', 'Move', 'Change bar', 'Detach piece', 'Reset to default', 'Detach data set bar']);
  const move = items[0]!.items!.find((i) => i.id === 'dsb-move')!;
  assert.equal(move.items!.find((i) => i.id === 'dsb-data-set-bar.move-bottom')!.label, 'Bottom (current)');
  const change = items[0]!.items!.find((i) => i.id === 'dsb-change')!;
  assert.equal(change.items![0]!.label, 'Data set bar (current)');
  assert.ok(!flat(items).some((i) => i.id === 'dsb-attach-piece'), 'every piece on: no Attach piece');
  assert.ok(!flat(items).some((i) => i.id === 'dsb-clear'), 'nothing applied: no Clear');
});
t('context menu, attached with a piece off and a search applied: Attach piece ▸ the missing one, Clear shows the summary', () => {
  let map = attachBar({}, 'builds', { now: T });
  map = { builds: { ...map.builds!, overrides: { filter: '' }, state: { ...DSB_EMPTY_STATE, query: 'alp', sort: [{ field: 'cost', dir: -1 }] } } };
  const att = normalizeAttachment(map.builds, 'builds', T);
  const items = datasetContextItems('builds', att, { ...ctx, resolved: resolveAttachment(att, bar) });
  const block = items[0]!.items!;
  assert.deepEqual(block.find((i) => i.id === 'dsb-attach-piece')!.items!.map((i) => i.label), ['Filter button']);
  assert.deepEqual(block.find((i) => i.id === 'dsb-detach-piece')!.items!.map((i) => i.label), ['Search bar', 'Sort control']);
  assert.ok(!block.some((i) => i.id === 'dsb-filter'), 'filter piece off: no Filter… entry');
  assert.equal(block.find((i) => i.id === 'dsb-clear')!.label, 'Clear ("alp" · sorted by 1)');
});
t('pieces only (no bar asset): the block still works and Change bar lists the bars', () => {
  const att = attachPiece({}, 'pending', 'search', 'dataset', { now: T }).pending!;
  const items = datasetContextItems('pending', att, { ...ctx, resolved: resolveAttachment(att, null) });
  const block = items[0]!.items!;
  assert.ok(!block.some((i) => i.id === 'dsb-filter') && !block.some((i) => i.id === 'dsb-sort'));
  assert.deepEqual(block.find((i) => i.id === 'dsb-attach-piece')!.items!.map((i) => i.label), ['Filter button', 'Sort control']);
  assert.equal(block.find((i) => i.id === 'dsb-change')!.items!.length, 2);
});
t('Registry Browser cards: only our types, data sets on screen first, capped', () => {
  const ds = [{ id: 'z', label: 'Zeta', mounted: false }, { id: 'a', label: 'Alpha', mounted: true }, { id: 'm', label: 'Mid', mounted: true }];
  const bar = assetCardItems('data-set-bar:compact', ds);
  assert.equal(bar.length, 1); assert.equal(bar[0]!.label, 'Attach to data set');
  assert.deepEqual(bar[0]!.items!.map((i) => i.label), ['Alpha', 'Mid', 'Zeta (not on screen)']);
  assert.equal(bar[0]!.items![0]!.action, act(ACTIONS.attach, 'a', '', 'compact'));
  const piece = assetCardItems('sort-control:chips', ds);
  assert.equal(piece[0]!.label, 'Attach sort control to data set');
  assert.equal(piece[0]!.items![1]!.action, act(ACTIONS.piece, 'm', 'sort', 'chips'));
  assert.deepEqual(assetCardItems('color-theme:arctic', ds), []);
  assert.deepEqual(assetCardItems('nonsense', ds), []);
  assert.equal(assetCardItems('filter-button:default', [])[0]!.label, 'Attach to data set: open a grid first');
  assert.equal(assetCardItems('data-set-bar:default', Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, label: `D${i}`, mounted: true })))[0]!.items!.length, 12);
});
t('describe: one line per attachment', () => {
  const att = normalizeAttachment({ bar: 'default', state: { query: 'x' } }, 'builds', T);
  assert.equal(describeAttachment(att, resolveAttachment(att, bar), 'Builds'), 'Builds: bar default (search + filter + sort), top, "x"');
});
t('the engine drives a real lib-datagrid dataset: filter + sort, cleared on detach', () => {
  type R = { name: string; n: number };
  const rows: R[] = [{ name: 'Alpha', n: 3 }, { name: 'beta', n: 12 }, { name: 'Alpine', n: 7 }];
  const fields: DatasetField<R>[] = [{ id: 'name', label: 'Name', value: (r) => r.name }, { id: 'n', label: 'N', value: (r) => r.n }];
  const off = registerDataset({ id: 'dsb-test', label: 'Test', fields, rows });
  const s = { ...DSB_EMPTY_STATE, query: 'alp', sort: [{ field: 'n', dir: -1 as const }] };
  setDatasetTransform<R>('dsb-test', 'data-set-bar', { active: true, filter: makeDsbFilter(s, fields, { fuzzy: true }), compare: makeDsbCompare(s, fields)! });
  assert.deepEqual(applyDataset('dsb-test', rows).map((r) => r.name), ['Alpine', 'Alpha']);
  assert.ok(datasetFiltered('dsb-test'));
  clearDatasetTransform('dsb-test', 'data-set-bar');
  assert.deepEqual(applyDataset('dsb-test', rows).map((r) => r.name), ['Alpha', 'beta', 'Alpine']);
  off();
});

console.log(`data-set-bar: ${n} checks passed`);

/**
 * data-set-bar@1 (core/engines/datasetbar.ts; build dataset-bar, Nov 7 2026): replays spec/fixtures/dataset-bar.json through
 * the reference engine (the Kotlin twin is deferred, spec/PORTING.md), checks the three new asset types and the search-bar
 * dataset scope are registered and their enums are exactly the engine's, every starter validates with no engine surprises,
 * the attach / detach moves, fuzzy field-scoped search, rules, multi-key sort and saved filters / sorts give the fixture's
 * answers, and the dataset slots the plugin draws into are the ones lib-datagrid renders.
 *   npx -y tsx framework/spec/check-dataset-bar.mts
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as dsb from '../core/engines/datasetbar';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
// @ts-expect-error plain .mjs (the build engine's own validator)
import { validateAsset as engineValidate } from '../cli/build-engine.mjs';

const root = new URL('../', import.meta.url).pathname;
const f = JSON.parse(readFileSync(join(root, 'spec/fixtures/dataset-bar.json'), 'utf8'));
const spec = JSON.parse(readFileSync(join(root, 'schemas/asset-types.json'), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg); checks++; };

/* ---- registry ---- */
for (const t of ['filter-button', 'sort-control', 'data-set-bar']) {
  ok((ASSET_TYPES as readonly string[]).includes(t) && (OPTIONAL_TYPES as readonly string[]).includes(t), `${t} is an optional asset type`);
  ok(spec.types[t] && spec.types[t].optional === true && spec.types[t].roll?.slot === false && spec.types[t].roll?.asset === false, `${t} is optional, never rolled`);
  ok(!spec.types[t].widget && !spec.types[t].attachable, `${t} is not a widget / attachable type (Kotlin pins those lists)`);
}
eq(Object.keys(spec.types).at(-1), 'uac-policy', 'uac-policy stays last');
eq(spec.types['filter-button'].enums.display, dsb.DSB_DISPLAYS, 'filter-button display enum = engine');
eq(spec.types['filter-button'].enums.match, dsb.DSB_MATCHES, 'filter-button match enum = engine');
eq(spec.types['filter-button'].enums.tone, dsb.DSB_TONES, 'filter-button tone enum = engine');
eq(spec.types['sort-control'].enums.style, dsb.SORT_CONTROL_STYLES, 'sort-control style enum = engine');
eq(spec.types['sort-control'].enums.display, dsb.DSB_DISPLAYS, 'sort-control display enum = engine');
eq(spec.types['data-set-bar'].enums.placement, dsb.DSB_PLACEMENTS, 'data-set-bar placement enum = engine');
eq(spec.types['data-set-bar'].enums.align, dsb.DSB_ALIGNS, 'align enum = engine');
eq(spec.types['data-set-bar'].enums.density, dsb.DSB_DENSITIES, 'density enum = engine');
eq(spec.types['data-set-bar'].enums.surface, dsb.DSB_SURFACES, 'surface enum = engine');
eq(spec.types['data-set-bar'].enums.floatingSide, dsb.DSB_FLOATING_SIDES, 'floatingSide enum = engine');
eq(spec.types['data-set-bar'].required, ['placement', 'search', 'filter', 'sort'], 'data-set-bar names its three pieces');
eq(spec.types['search-bar'].enums.scope, ['app', 'dataset'], 'search-bar has the dataset scope');
for (const k of ['scope', 'fuzzy', 'fields', 'fieldPicker', 'minChars']) ok(k in spec.types['search-bar'].optional_fields, `search-bar documents ${k}`);
eq(f.enums.pieceTypes, dsb.DSB_PIECE_TYPES, 'piece types');
eq(f.enums.ops, dsb.DSB_OPS.map((o) => o.id), 'ops');
eq(f.enums.limits, dsb.DSB_LIMITS, 'limits');
eq(f.defaults, { filterButton: dsb.FILTER_BUTTON_DEFAULT, sortControl: dsb.SORT_CONTROL_DEFAULT, dataSetBar: dsb.DATA_SET_BAR_DEFAULT, datasetSearch: dsb.DATASET_SEARCH_DEFAULT }, 'defaults');

/* ---- starters: validate with both validators, normalize to themselves (no engine surprises), the bar's pieces exist ---- */
const starters = (type: string) => Object.fromEntries(readdirSync(join(root, 'assets', type)).filter((x) => x.endsWith('.json')).sort().map((x) => { const a = JSON.parse(readFileSync(join(root, 'assets', type, x), 'utf8')); return [a.id, a]; }));
const norm: Record<string, (d: unknown) => unknown> = { 'filter-button': dsb.normalizeFilterButton, 'sort-control': dsb.normalizeSortControl, 'data-set-bar': dsb.normalizeDataSetBar };
const all: Record<string, Record<string, { data: unknown }>> = {};
for (const type of ['filter-button', 'sort-control', 'data-set-bar', 'search-bar']) {
  const as = starters(type); all[type] = as;
  ok(Object.keys(as).length >= (type === 'search-bar' ? 3 : 2), `${type} ships starters`);
  for (const [id, a] of Object.entries(as)) {
    const r = validateAsset(a as never); ok(r.ok, `${type}/${id} validates: ${r.errors?.join('; ')}`);
    const e = engineValidate(a); ok(!e || e.length === 0 || e.ok !== false, `${type}/${id} validates in the build engine`);
    eq(dsb.dsbAssetErrors(type, a.data), [], `${type}/${id} has no engine errors`);
    if (norm[type]) { const n = norm[type]!(a.data) as Record<string, unknown>; for (const [k, v] of Object.entries(a.data as Record<string, unknown>)) eq(n[k], v, `${type}/${id}.${k} survives normalizing`); }
  }
}
ok(Object.keys(all['data-set-bar']!).length >= 3, 'at least three data-set-bar looks (the UI Review options)');
ok(all['search-bar']!.everything && dsb.datasetSearchConfig(all['search-bar']!.everything!.data).scope === 'app', 'the top-bar search is an app-scoped instance of search-bar');
ok(all['search-bar']!.dataset && dsb.datasetSearchConfig(all['search-bar']!.dataset!.data).scope === 'dataset', 'the data set search is a dataset-scoped instance of the same type');
for (const [id, a] of Object.entries(all['data-set-bar']!)) {
  const d = a.data as dsb.DataSetBarData;
  for (const p of dsb.DSB_PIECES) if (d[p]) ok(all[dsb.DSB_PIECE_TYPES[p]]![d[p]], `data-set-bar/${id} ${p} piece ${dsb.DSB_PIECE_TYPES[p]}/${d[p]} exists`);
  if (d.search) ok(dsb.datasetSearchConfig(all['search-bar']![d.search]!.data).scope === 'dataset', `data-set-bar/${id} search piece is dataset-scoped`);
}
ok(new Set(Object.values(all['data-set-bar']!).map((a) => (a.data as dsb.DataSetBarData).placement)).size >= 3, 'the starters show three placements');

/* ---- normalize / errors replay ---- */
for (const [type, fn] of Object.entries(norm)) {
  const key = type === 'filter-button' ? 'filterButton' : type === 'sort-control' ? 'sortControl' : 'dataSetBar';
  eq(fn({}), f.normalize[key].empty, `${type} normalize {}`);
  for (const [id, a] of Object.entries(all[type]!)) eq(fn(a.data), f.normalize[key].starters[id], `${type}/${id} normalized = fixture`);
}
eq(dsb.normalizeFilterButton({ display: 'huge', match: 'some', maxRules: 99, quickFields: ['a', 3, ''], tone: 'danger', label: ' Sift ' }), f.normalize.filterButton.junk, 'filter-button junk');
eq(dsb.normalizeSortControl({ style: 'wheel', maxKeys: 0, savedSorts: 'no', quickFields: 'name' }), f.normalize.sortControl.junk, 'sort-control junk');
eq(dsb.normalizeDataSetBar({ placement: 'side', search: 'Not An Id', filter: '', sort: 7, count: 'yes', floatingSide: 'middle' }), f.normalize.dataSetBar.junk, 'data-set-bar junk');
eq(dsb.datasetSearchConfig(all['search-bar']!.everything!.data), f.normalize.datasetSearch.app, 'search-bar app config');
eq(dsb.datasetSearchConfig(all['search-bar']!.dataset!.data), f.normalize.datasetSearch.dataset, 'search-bar dataset config');
eq(dsb.datasetSearchConfig({ scope: 'dataset', minChars: 9, fields: 'name', fuzzy: 'yes' }), f.normalize.datasetSearch.junk, 'search-bar junk');
ok(f.normalize.datasetSearch.junk.minChars === dsb.DSB_LIMITS.minChars.max && f.normalize.datasetSearch.junk.fuzzy === true, 'junk search clamps minChars and keeps fuzzy on');
ok(f.normalize.filterButton.junk.maxRules === dsb.DSB_LIMITS.maxRules.max && f.normalize.filterButton.junk.quickFields.length === 1 && f.normalize.filterButton.junk.label === 'Sift', 'junk filter-button clamps and trims');
ok(f.normalize.dataSetBar.junk.search === 'dataset' && f.normalize.dataSetBar.junk.filter === '' && f.normalize.dataSetBar.junk.sort === 'default', 'a bad piece id falls back, "" stays off');
eq(dsb.normalizeDsbState({ query: 7, field: 'name', match: 'maybe', rules: [{ op: 'nope' }, { id: 'r-cost-between', field: 'cost', op: 'between', value: '1', value2: '5' }, { field: 'x', op: 'in', values: ['a', 1] }], sort: [{ field: 'cost', dir: -1 }, { field: 'cost', dir: 1 }, { field: '' }, { field: 'name' }] }).sort, f.normalize.state.junk.sort, 'state junk: sort keys deduped, blanks dropped');
ok(f.normalize.state.junk.rules.length === 2 && f.normalize.state.junk.rules[1].values.length === 1, 'state junk: unknown op dropped, values kept as strings');
for (const [k, v] of Object.entries<string[]>(f.errors)) {
  const args: Record<string, [string, unknown]> = { filterButton: ['filter-button', { maxRules: 50, quickFields: 'name' }], sortControl: ['sort-control', { maxKeys: 9 }], dataSetBar: ['data-set-bar', { search: 1 }], searchApp: ['search-bar', { fields: ['a'] }], searchDataset: ['search-bar', { scope: 'dataset', fields: ['a'], minChars: 2 }], clean: ['filter-button', all['filter-button']!.default!.data] };
  eq(dsb.dsbAssetErrors(...args[k]!), v, `errors ${k}`);
}
ok(f.errors.filterButton.length === 2 && f.errors.searchApp.length === 1 && f.errors.searchDataset.length === 0 && f.errors.clean.length === 0, 'errors catch ranges, lists and dataset-only fields');

/* ---- placement ---- */
eq(Object.fromEntries(dsb.DSB_PLACEMENTS.map((p) => [p, dsb.placementSlot(p)])), f.placement, 'placement slots');
eq(dsb.DSB_SLOT_TOP, 'axf.dataset.toolbar', 'top placement draws in the dataset toolbar slot lib-datagrid renders');
ok(f.placement.inline.slot === dsb.DSB_SLOT_TOP && f.placement.inline.inline === true, 'inline = the top slot drawn as one line');
ok(f.placement.bottom.slot === dsb.DSB_SLOT_BOTTOM && f.placement.floating.slot === 'floating', 'bottom and floating');
const datagrid = readFileSync(join(root, 'libs/datagrid/datasets.ts'), 'utf8');
ok(datagrid.includes(`'${dsb.DSB_SLOT_TOP}'`) && datagrid.includes(`'${dsb.DSB_SLOT_BOTTOM}'`), 'lib-datagrid names both dataset slots');

/* ---- search, filter, sort replay ---- */
const fields: dsb.DsbField<Record<string, unknown>>[] = [
  { id: 'name', label: 'Name', value: (r) => r.name as string }, { id: 'status', label: 'Status', value: (r) => r.status as string },
  { id: 'cost', label: 'Cost', value: (r) => r.cost as number | null }, { id: 'when', label: 'When', value: (r) => r.when as string | null },
];
const rows = [
  { id: 'a', name: 'Alpha build', status: 'running', cost: 12.5, when: '2026-11-01' },
  { id: 'b', name: 'Beta release', status: 'done', cost: 3, when: '2026-10-20' },
  { id: 'c', name: 'Alpine theme', status: 'pending', cost: null, when: null },
  { id: 'd', name: 'Gamma grid', status: 'done', cost: 40, when: '2026-11-05' },
  { id: 'e', name: 'Delta dock', status: 'running', cost: 0, when: '2026-09-09' },
];
const apply = (state: Partial<dsb.DsbState>, scope: dsb.SearchScope = { fuzzy: true }) => {
  const st = { ...dsb.DSB_EMPTY_STATE, ...state };
  const flt = dsb.makeDsbFilter(st, fields, scope, (r) => `${r.name} ${r.status}`);
  const c = dsb.makeDsbCompare(st, fields);
  const out = rows.filter(flt);
  return (c ? out.map((r, i) => [r, i] as const).sort(([a, i], [b, j]) => c(a, b) || i - j).map(([r]) => r) : out).map((r) => r.id);
};
const rule = (field: string, op: dsb.DsbOp, value = '', extra: Partial<dsb.DsbRule> = {}): dsb.DsbRule => ({ id: `r-${field}-${op}`, field, op, value, ...extra });
eq({ substring: dsb.searchWordScore('Alpha build', 'alpha', true), oneEdit: dsb.searchWordScore('Alpha build', 'alpah', true), swap: dsb.searchWordScore('alphabet', 'alhpabet', true), subsequence: dsb.searchWordScore('Alpine theme', 'apn', true), none: dsb.searchWordScore('Beta', 'zzz', true), exactMiss: dsb.searchWordScore('Alpha build', 'alpah', false), shortNoEdit: dsb.searchWordScore('cat', 'cot', true) }, f.search.wordScores, 'word scores');
ok(f.search.wordScores.substring > f.search.wordScores.oneEdit && f.search.wordScores.oneEdit > f.search.wordScores.subsequence && f.search.wordScores.subsequence > f.search.wordScores.none, 'closer hits score higher');
eq({ 'fuzzy alp': apply({ query: 'alp' }), 'fuzzy alpah': apply({ query: 'alpah' }), 'exact alpah': apply({ query: 'alpah' }, { fuzzy: false }), 'two words any order': apply({ query: 'build alpha' }), 'field scoped status': apply({ query: 'done', field: 'status' }), 'field scoped name misses status': apply({ query: 'done', field: 'name' }), 'scope fields name only': apply({ query: 'running' }, { fuzzy: true, fields: ['name'] }), 'under minChars = all': apply({ query: 'a' }, { fuzzy: true, minChars: 2 }) }, f.search.rows, 'search rows');
ok(f.search.rows['fuzzy alpah'].length === 1 && f.search.rows['exact alpah'].length === 0, 'fuzzy forgives a swapped pair, exact does not');
ok(f.search.rows['field scoped status'].length === 2 && f.search.rows['field scoped name misses status'].length === 0, 'field scope narrows the search');
eq({ close: dsb.searchScore({ name: 'Alpha build' }, 'alpha', { fuzzy: true }), far: dsb.searchScore({ name: 'Alpine theme' }, 'apn', { fuzzy: true }), miss: dsb.searchScore({ name: 'Beta' }, 'alpha', { fuzzy: true }) }, f.search.score, 'scores');
const filterCases: Record<string, Partial<dsb.DsbState>> = {
  'status is done': { rules: [rule('status', 'equals', 'done')] }, 'cost > 10': { rules: [rule('cost', 'gt', '10')] }, 'cost between 1 and 20': { rules: [rule('cost', 'between', '1', { value2: '20' })] },
  'when after Oct 25': { rules: [rule('when', 'gt', '2026-10-25')] }, 'cost empty': { rules: [rule('cost', 'empty')] }, 'status one of': { rules: [rule('status', 'in', '', { values: ['done', 'pending'] })] },
  'any of two': { match: 'any', rules: [rule('status', 'equals', 'pending'), rule('cost', 'gte', '40')] }, 'all of two': { rules: [rule('status', 'equals', 'done'), rule('cost', 'gte', '40')] },
  'rule off ignored': { rules: [rule('status', 'equals', 'done', { off: true })] }, 'rule missing value ignored': { rules: [rule('status', 'equals', '')] }, 'search + rule': { query: 'gri', rules: [rule('status', 'equals', 'done')] },
};
for (const [k, st] of Object.entries(filterCases)) eq(apply(st), f.filter[k], `filter: ${k}`);
ok(f.filter['cost empty'].length === 1 && f.filter['when after Oct 25'].length === 2 && f.filter['any of two'].length === 2 && f.filter['all of two'].length === 1, 'rules: empties, dates, any / all');
eq({ ok: dsb.dsbRuleReady(rule('a', 'contains', 'x')), noValue: dsb.dsbRuleReady(rule('a', 'contains', '')), empty: dsb.dsbRuleReady(rule('a', 'empty')), list: dsb.dsbRuleReady(rule('a', 'in', '', { values: [] })), between: dsb.dsbRuleReady(rule('a', 'between', '1')), noField: dsb.dsbRuleReady(rule('', 'empty')) }, f.filter.ready, 'rule readiness');
const sortCases: Record<string, dsb.DsbSortKey[]> = { 'cost asc, empties last': [{ field: 'cost', dir: 1 }], 'cost desc, empties still last': [{ field: 'cost', dir: -1 }], 'status then name': [{ field: 'status', dir: 1 }, { field: 'name', dir: 1 }], 'status desc then cost desc': [{ field: 'status', dir: -1 }, { field: 'cost', dir: -1 }], 'when asc dates': [{ field: 'when', dir: 1 }], 'unknown field ignored': [{ field: 'nope', dir: 1 }] };
for (const [k, sort] of Object.entries(sortCases)) eq(apply({ sort }), f.sort[k], `sort: ${k}`);
ok(f.sort['cost asc, empties last'].at(-1) === 'c' && f.sort['cost desc, empties still last'].at(-1) === 'c', 'empties last in both directions');
ok(f.sort['status then name'].join('') === 'bdcae', 'two keys sort within groups');
eq((() => { let s = dsb.DSB_EMPTY_STATE; const steps: dsb.DsbSortKey[][] = []; s = dsb.toggleDsbSort(s, 'cost', 1); steps.push(s.sort); s = dsb.toggleDsbSort(s, 'name', -1); steps.push(s.sort); s = dsb.toggleDsbSort(s, 'cost', -1); steps.push(s.sort); s = dsb.toggleDsbSort(s, 'cost', -1); steps.push(s.sort); s = dsb.toggleDsbSort(s, 'status', 1, 1); steps.push(s.sort); return steps; })(), f.sort.toggle, 'toggle sort: add, add, flip, remove, maxKeys 1');
eq({ numbers: dsb.dsbCompareValues(2, 10), text: dsb.dsbCompareValues('b', 'A'), natural: dsb.dsbCompareValues('a2', 'a10'), emptyLast: dsb.dsbCompareValues(null, 1), emptyLastDesc: dsb.dsbCompareValues(null, 1, -1), bothEmpty: dsb.dsbCompareValues('', null) }, f.sort.compare, 'compare values');

/* ---- attachments replay ---- */
const T = '2026-11-07T00:00:00.000Z';
const bar = (id: string) => all['data-set-bar']![id]!.data;
let map: dsb.DsbAttachments = {};
const moves: Record<string, dsb.DsbAttachments> = {};
map = dsb.attachBar(map, 'builds', { now: T }); moves['attach bar default'] = map;
map = dsb.attachBar(map, 'builds', { placement: 'floating', now: T }); moves['attach bar again: floating'] = map;
map = dsb.attachPiece(map, 'pending', 'search', 'dataset', { now: T }); moves['attach search piece only'] = map;
map = dsb.attachPiece(map, 'pending', 'sort', 'chips', { placement: 'bottom', now: T }); moves['attach sort piece, bottom'] = map;
map = dsb.attachBar(map, 'pending', { bar: 'compact', now: T }); moves['bar on a pieces-only attachment drops the piece overrides'] = map;
map = dsb.setAttachmentState(map, 'builds', { ...dsb.DSB_EMPTY_STATE, query: 'alp', rules: [rule('status', 'equals', 'done')], sort: [{ field: 'cost', dir: -1 }] }, T); moves['state set'] = map;
map = dsb.detachPiece(map, 'pending', 'search', bar('compact'), T); moves['detach search piece from compact bar'] = map;
map = dsb.detachPiece(map, 'pending', 'filter', bar('compact'), T); map = dsb.detachPiece(map, 'pending', 'sort', bar('compact'), T); moves['detach the last piece drops the attachment'] = map;
map = dsb.detachBar(map, 'builds'); moves['detach bar'] = map;
eq(moves, f.attachments.moves, 'attach / detach moves');
ok(moves['attach bar default']!.builds!.bar === 'default' && Object.keys(moves['attach bar default']!.builds!.overrides).length === 0, 'attach bar: the asset as it is');
ok(moves['attach bar again: floating']!.builds!.overrides.placement === 'floating', 'attach again changes the placement');
ok(moves['attach search piece only']!.pending!.bar === '' && moves['attach search piece only']!.pending!.overrides.search === 'dataset', 'a piece alone = no bar asset, the piece as an override');
ok(moves['bar on a pieces-only attachment drops the piece overrides']!.pending!.overrides.search === undefined && moves['bar on a pieces-only attachment drops the piece overrides']!.pending!.overrides.placement === undefined, 'attaching a bar on top takes the piece and placement overrides off');
ok(!('pending' in moves['detach the last piece drops the attachment']!) && Object.keys(moves['detach bar']!).length === 0, 'detaching the last piece or the bar drops the attachment');
eq(dsb.resolveAttachment(moves['attach bar again: floating']!.builds!, bar('default')), f.attachments.resolved['builds floating'], 'resolve: asset + override');
eq(dsb.resolveAttachment(moves['attach sort piece, bottom']!.pending!, null), f.attachments.resolved['pending pieces only'], 'resolve: pieces only');
eq(dsb.attachmentPieces(dsb.resolveAttachment(moves['attach sort piece, bottom']!.pending!, null)), f.attachments.resolved['pieces of pending'], 'pieces of a pieces-only attachment');
ok(f.attachments.resolved['pieces of pending'].length === 2 && f.attachments.resolved['pieces of pending'][1].type === 'sort-control', 'the search and sort pieces, in bar order');
eq({ fresh: dsb.attachmentIsDefault(dsb.normalizeAttachment({}, 'x', T)), moved: dsb.attachmentIsDefault(moves['attach bar again: floating']!.builds!), stated: dsb.attachmentIsDefault(moves['state set']!.builds!) }, f.attachments.isDefault, 'is default');
let att = dsb.normalizeAttachment({ bar: 'default', overrides: { placement: 'top' }, state: { query: 'x', rules: [rule('status', 'equals', 'done')], sort: [{ field: 'cost', dir: 1 }] } }, 'builds', T);
att = dsb.saveDsbFilter(att, 'Done only', T); att = dsb.saveDsbSort(att, 'Cheapest first', T);
eq(att, f.attachments.saved.then, 'saved filter + sort');
ok(att.saved.filters[0]!.id === 'done-only' && att.saved.filters[0]!.query === 'x' && att.saved.sorts[0]!.id === 'cheapest-first', 'saved entries are slugged and carry the search');
const cleared = dsb.setAttachmentState({ builds: att }, 'builds', dsb.DSB_EMPTY_STATE, T).builds!;
eq(dsb.applyDsbSavedSort(dsb.applyDsbSavedFilter(cleared, 'done-only', T), 'cheapest-first', T), f.attachments.saved.reapplied, 'reapplying saved filter + sort');
eq(f.attachments.saved.reapplied.state, att.state, 'reapplied = the state that was saved');
eq(dsb.deleteDsbSavedSort(dsb.deleteDsbSavedFilter(att, 'done-only', T), 'cheapest-first', T).saved, f.attachments.saved.deleted, 'deleting saved entries');
eq(dsb.resetAttachment({ ...att, floatingPos: { x: 0.2, y: 0.9 } }, T), f.attachments.reset, 'reset to default');
ok(Object.keys(f.attachments.reset.overrides).length === 0 && !f.attachments.reset.floatingPos && f.attachments.reset.saved.filters.length === 1 && f.attachments.reset.state.query === '', 'reset drops overrides, state and the pill spot but keeps saved filters and sorts');
eq(dsb.dsbSummary(att.state), f.attachments.saved.summary, 'summary line');
eq(dsb.dsbSummary(dsb.DSB_EMPTY_STATE), '', 'empty summary');
eq(dsb.parseAttachments(JSON.stringify({ g: { bar: 'default' }, '': { bar: 'x' }, h: 'junk' }), T), f.attachments.parse.string, 'parse a stored string');
ok(Object.keys(f.attachments.parse.string).join() === 'g', 'parse drops blank keys and junk');
eq(dsb.parseAttachments('{not json'), {}, 'parse bad json');
eq(dsb.parseAttachments(undefined), {}, 'parse nothing');
eq(f.attachments.parse.floating, { x: 1, y: 0 }, 'a dragged pill spot is clamped to the viewport');
eq({ placements: dsb.DSB_PLACEMENT_LABELS, pieces: dsb.DSB_PIECE_LABELS }, f.labels, 'menu labels');

console.log(`check-dataset-bar: ${checks} checks passed`);

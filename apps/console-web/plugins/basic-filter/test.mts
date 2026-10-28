// @ts-nocheck: a Node test, not part of the console's build
/** Basic filter self-test (core + the lib-datagrid dataset registry). npx -y tsx apps/console-web/plugins/basic-filter/test.mts */
import assert from 'node:assert/strict';
import { applyDataset, clearDatasetTransform, registerDataset, setDatasetTransform, datasetFiltered, type DatasetField } from '../../src/axf/libs/datagrid/datasets.ts';
import { DEFAULT_TOOLBAR, EMPTY_STATE, makeCompare, makeFilter, parseStates, parseToolbar, ruleMatches, ruleReady, searchMatches, stateActive, toggleSort, distinct, type FilterState } from './web/core.ts';

let n = 0; const t = (name: string, f: () => void) => { f(); n++; void name; };
type R = { name: string; n: number; when: string; tag: string };
const rows: R[] = [
  { name: 'Alpha build', n: 3, when: '2026-10-01', tag: 'opus' },
  { name: 'beta fix', n: 12, when: '2026-10-20', tag: 'fable' },
  { name: 'Gamma', n: 7, when: '', tag: 'opus' },
];
const fields: DatasetField<R>[] = [
  { id: 'name', label: 'Name', value: (r) => r.name }, { id: 'n', label: 'N', value: (r) => r.n },
  { id: 'when', label: 'When', value: (r) => r.when }, { id: 'tag', label: 'Tag', value: (r) => r.tag },
];
const text = (r: R) => fields.map((f) => String(f.value(r))).join(' ');
const run = (s: FilterState) => { const f = makeFilter(s, fields, text); const c = makeCompare(s, fields); const o = rows.filter(f); return (c ? o.sort(c) : o).map((r) => r.name); };

t('search: every word', () => { assert.ok(searchMatches('Alpha build opus', 'alpha OPUS')); assert.ok(!searchMatches('Alpha', 'alpha beta')); });
t('ops', () => {
  assert.ok(ruleMatches({ id: '', field: '', op: 'contains', value: 'ALP' }, 'alpha'));
  assert.ok(ruleMatches({ id: '', field: '', op: 'between', value: '10', value2: '2' }, 5));
  assert.ok(ruleMatches({ id: '', field: '', op: 'gt', value: '2026-10-10' }, '2026-10-20'));
  assert.ok(ruleMatches({ id: '', field: '', op: 'empty', value: '' }, null));
  assert.ok(ruleMatches({ id: '', field: '', op: 'in', value: '', values: ['Opus'] }, 'opus'));
  assert.ok(!ruleReady({ id: '', field: 'n', op: 'gt', value: ' ' }));
  assert.ok(!ruleReady({ id: '', field: 'n', op: 'empty', value: '', off: true }));
});
t('filter all / any + sort', () => {
  assert.deepEqual(run({ ...EMPTY_STATE, query: 'opus' }), ['Alpha build', 'Gamma']);
  const rules = [{ id: 'a', field: 'n', op: 'gt' as const, value: '5' }, { id: 'b', field: 'tag', op: 'equals' as const, value: 'opus' }];
  assert.deepEqual(run({ ...EMPTY_STATE, rules }), ['Gamma']);
  assert.deepEqual(run({ ...EMPTY_STATE, rules, match: 'any', sort: [{ field: 'n', dir: -1 }] }), ['beta fix', 'Gamma', 'Alpha build']);
  assert.deepEqual(run({ ...EMPTY_STATE, sort: [{ field: 'when', dir: 1 }] }), ['Alpha build', 'beta fix', 'Gamma']); // empties last
  assert.deepEqual(run({ ...EMPTY_STATE, sort: [{ field: 'tag', dir: 1 }, { field: 'n', dir: -1 }] }), ['beta fix', 'Gamma', 'Alpha build']);
});
t('toggle sort + active', () => {
  const s = toggleSort(EMPTY_STATE, 'n', 1); assert.deepEqual(s.sort, [{ field: 'n', dir: 1 }]);
  assert.deepEqual(toggleSort(s, 'n', 1).sort, []); assert.ok(stateActive(s)); assert.ok(!stateActive(EMPTY_STATE));
});
t('distinct', () => assert.deepEqual(distinct(rows, fields[3]!), ['opus', 'fable']));
t('toolbar default: on, one button opening the dialog', () => {
  const d = parseToolbar(null); assert.equal(d.show, true); assert.equal(d.actions.length, 1); assert.equal(d.actions[0]!.preset, 'open-dialog');
  assert.deepEqual(parseToolbar('not json'), DEFAULT_TOOLBAR);
  const c = parseToolbar(JSON.stringify({ show: false, actions: [{ preset: 'nope' }, { preset: 'clear', tone: 'weird', visible: false }] }));
  assert.equal(c.show, false); assert.equal(c.actions.length, 1); assert.equal(c.actions[0]!.tone, 'quiet'); assert.equal(c.actions[0]!.visible, false);
});
t('states parse safely', () => {
  const s = parseStates(JSON.stringify({ x: { query: 'q', rules: [{ field: 'n', op: 'bad' }, { field: 'n', op: 'gt', value: '1' }], sort: [{ field: 'n', dir: -1 }] } }));
  assert.equal(s.x!.rules.length, 1); assert.equal(s.x!.sort[0]!.dir, -1); assert.deepEqual(parseStates('{'), {});
});
t('dataset registry + transforms', () => {
  const off = registerDataset({ id: 'ds', label: 'DS', fields, rows });
  assert.equal(applyDataset('ds', rows), rows, 'nothing attached = same array');
  setDatasetTransform<R>('ds', 'a', { filter: (r) => r.tag === 'opus', active: true });
  setDatasetTransform<R>('ds', 'b', { compare: (x, y) => y.n - x.n });
  assert.deepEqual(applyDataset('ds', rows).map((r) => r.name), ['Gamma', 'Alpha build']);
  assert.ok(datasetFiltered('ds'));
  clearDatasetTransform('ds', 'a'); clearDatasetTransform('ds', 'b');
  assert.equal(applyDataset('ds', rows), rows); off();
});
console.log(`basic-filter: ${n} checks ok`);

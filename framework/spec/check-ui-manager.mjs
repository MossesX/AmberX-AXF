#!/usr/bin/env node
/**
 * UI Manager rules (ui-element@1 / ui-overrides@1 / ui-change@1, framework/core/engines/ui-manager-rules.mjs): the contract
 * every port follows, checked on a small fixed catalog and kept equal to the fixture.
 *   node framework/spec/check-ui-manager.mjs            check (CI)
 *   node framework/spec/check-ui-manager.mjs --write    regenerate framework/spec/fixtures/ui-manager.json from the engine
 * The fixture holds the derived properties, choices, validation verdicts, preview plan and change entries for the fixed
 * catalog below, so a change in the rules shows up as a diff a reviewer reads, and a Kotlin twin can replay it.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../core/engines/ui-manager-rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'ui-manager.json');
const write = process.argv.includes('--write');
let n = 0;
const t = (name, f) => { try { f(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

/** A fixed catalog (no files): two toolbars, two colour themes, two sizings, the control@1 paths the engine needs. */
const CATALOG = {
  $axf: 'ui-catalog@1',
  types: {
    toolbar: { label: 'Toolbar', group: 'Navigation', required: ['variant', 'align', 'groups', 'showSearch'], enums: { variant: ['icons', 'icons-labels', 'labels'], align: ['start', 'center', 'spread'], density: ['compact', 'regular', 'roomy'] }, optional_fields: { divider: 'boolean, default true — rule between item groups', window: 'id or kind of the window' } },
    'color-theme': { label: 'Colour theme', group: 'Look', required: ['scheme', 'tokens'], enums: { scheme: ['light', 'dark'] }, nested: { tokens: ['bg', 'surface', 'accent'] } },
    sizing: { label: 'Sizing', group: 'Look' },
    button: { label: 'Button', group: 'Controls', required: ['shape', 'fill'], enums: { shape: ['rounded', 'pill', 'square'], fill: ['solid', 'soft'] } },
    'uac-policy': { label: 'UAC policy' },
  },
  assets: {
    toolbar: [{ id: 'standard-icons', name: 'Standard icons', data: { variant: 'icons', align: 'start', groups: [], showSearch: true, divider: true } }, { id: 'labels-bar', name: 'Labels bar', data: { variant: 'labels', align: 'spread', groups: [], showSearch: false, density: 'roomy' } }],
    'color-theme': [{ id: 'day', name: 'Day', data: { scheme: 'light', tokens: { bg: '#ffffff', surface: '#f4f6f8', accent: '#1f6feb' } } }, { id: 'night', name: 'Night', data: { scheme: 'dark', tokens: { bg: '#0b0f14', surface: '#121820', accent: '#58a6ff' } } }],
    sizing: [{ id: 'standard', name: 'Standard', data: { button: { height: 2.1 } } }, { id: 'compact', name: 'Compact', data: { button: { height: 1.8 } } }],
    button: [{ id: 'rounded-solid', name: 'Rounded solid', data: { shape: 'rounded', fill: 'solid' } }],
  },
  active: { toolbar: 'standard-icons', 'color-theme': 'day', sizing: 'standard', button: 'rounded-solid' },
  paths: {
    'tokens.theme': [{ id: 'bg', token: '--fx-bg', kind: 'color' }, { id: 'surface', token: '--fx-surface', kind: 'color' }, { id: 'accent', token: '--fx-accent', kind: 'color' }],
    'tokens.style': [{ id: 'space', kind: 'number' }, { id: 'borderWidth', kind: 'number' }, { id: 'density', kind: 'enum', options: ['compact', 'comfortable', 'spacious'] }, { id: 'wrapGroups', kind: 'boolean' }, { id: 'radius.md', kind: 'number' }],
    'tokens.sizing': [{ id: 'button.height', token: '--fx-size-button-height', kind: 'number', unit: 'font', default: 2.1, min: 1.5, max: 3.5 }, { id: 'button.padX', token: '--fx-size-button-pad-x', kind: 'number', unit: 'space', default: 0.9, min: 0.3, max: 3 }, { id: 'button.font', token: '--fx-size-button-font', kind: 'number', unit: 'em', default: 0.86, min: 0.6, max: 1.2 }],
    'tokens.layout': [], 'tokens.typography': [], 'tokens.density': [], 'tokens.nav': [],
  },
  skin: 'windows',
};
const AT = '2026-11-13T19:00:00.000Z';

const els = R.frameworkElements(CATALOG);
const toolbar = els.find((e) => e.id === 'asset:toolbar');
const button = els.find((e) => e.id === 'asset:button');
const prop = (e, id) => R.propsOf(e, CATALOG).find((p) => p.id === id);

t('elements: one per slot type with assets, never uac-policy; categories; shortcuts resolve to one element', () => {
  assert.deepEqual(els.map((e) => e.id).sort(), ['asset:button', 'asset:color-theme', 'asset:sizing', 'asset:toolbar']);
  assert.equal(toolbar.category, 'chrome'); assert.equal(button.category, 'controls'); assert.equal(els.find((e) => e.id === 'asset:sizing').category, 'look');
  const tree = R.elementTree(els, ['asset:toolbar']);
  assert.equal(tree[0].id, 'on-screen'); assert.deepEqual(tree[0].items, [{ ref: 'asset:toolbar', label: 'Toolbar', kind: 'toolbar', category: 'chrome' }]);
  assert.equal(R.resolveElement(tree[0].items[0], els), toolbar);
  assert.equal(R.elementsFromManifest({ id: 'ai.amberx.axf.console.x', uiElements: [{ id: 'grid', kind: 'grid', address: 'view:x/grid:g' }] }, CATALOG.types)[0].id, 'ai.amberx.axf.console.x/grid');
  assert.equal(R.elementsFromTargets({ targets: [{ address: 'view:settings', kind: 'view', label: 'Settings' }] })[0].id, 'target:view:settings');
});

t('properties: every one has a predetermined list; kinds and bases from the asset in force', () => {
  const props = R.propsOf(toolbar, CATALOG);
  assert.deepEqual(props.map((p) => p.id), ['visible', 'transparency', 'asset', 'field:variant', 'field:align', 'field:density', 'field:showSearch', 'field:divider', 'token:tokens.theme:surface', 'token:tokens.theme:bg', 'token:tokens.style:space', 'token:tokens.style:borderWidth'].filter((id) => props.some((p) => p.id === id)));
  for (const p of props) assert.ok(p.options.length >= 2, p.id);
  assert.equal(prop(toolbar, 'asset').default, 'standard-icons');
  assert.equal(prop(toolbar, 'field:variant').default, 'icons'); assert.equal(prop(toolbar, 'field:variant').source, 'asset');
  assert.equal(prop(toolbar, 'field:density').default, 'compact'); assert.equal(prop(toolbar, 'field:density').source, 'default', 'the asset in force has no density: the first enum word');
  assert.equal(prop(toolbar, 'field:divider').kind, 'bool');
  assert.ok(!props.some((p) => p.id === 'field:window'), 'an id field is never offered as text');
  const surface = prop(toolbar, 'token:tokens.theme:surface');
  assert.deepEqual(surface.options.map((o) => o.value), ['@bg', '@surface', '@accent']); assert.equal(surface.options[1].swatch, '#f4f6f8'); assert.equal(surface.default, '#f4f6f8');
  const theme = R.propsOf(els.find((e) => e.id === 'asset:color-theme'), CATALOG);
  assert.ok(theme.some((p) => p.id === 'token:tokens.theme:accent') && !theme.some((p) => p.id === 'field:tokens.accent'));
  assert.equal(theme.find((p) => p.id === 'field:scheme').kind, 'enum');
  const h = R.propsOf(els.find((e) => e.id === 'asset:sizing'), CATALOG).find((p) => p.id === 'token:tokens.sizing:button.height');
  assert.equal(h.kind, 'range'); assert.deepEqual([h.min, h.max, h.step, h.unit], [1.5, 3.5, 0.1, 'font']); assert.equal(h.options.length, 21);
});

t('validation: the list or nothing; coercions; ranges snap to the step', () => {
  assert.deepEqual(R.validateValue(prop(toolbar, 'field:variant'), 'LABELS'), { ok: true, value: 'labels' });
  assert.equal(R.validateValue(prop(toolbar, 'field:variant'), 'buttons').ok, false);
  assert.deepEqual(R.validateValue(prop(toolbar, 'transparency'), '45%'), { ok: true, value: 45 });
  assert.deepEqual(R.validateValue(prop(toolbar, 'transparency'), 47), { ok: true, value: 45 });
  for (const bad of [-5, 101, 'lots', '', null, true]) assert.equal(R.validateValue(prop(toolbar, 'transparency'), bad).ok, false, String(bad));
  assert.deepEqual(R.validateValue(prop(toolbar, 'visible'), 'hidden'), { ok: true, value: false });
  assert.deepEqual(R.validateValue(prop(toolbar, 'token:tokens.theme:surface'), 'accent'), { ok: true, value: '@accent' });
  assert.equal(R.validateValue(prop(toolbar, 'token:tokens.theme:surface'), '#f4f6f8').ok, false, 'a literal colour, even the current one, is not a choice');
  assert.equal(R.validateValue(prop(toolbar, 'asset'), 'Labels bar').ok, false, 'labels are not ids');
  assert.deepEqual(R.validateValue(prop(toolbar, 'asset'), 'labels-bar'), { ok: true, value: 'labels-bar' });
});

const doc1 = R.withOverride(null, toolbar, prop(toolbar, 'token:tokens.theme:surface'), 'accent', { by: 'brett', at: AT }).doc;
const doc2 = R.withOverride(doc1, toolbar, prop(toolbar, 'transparency'), 80).doc;
const doc3 = R.withOverride(doc2, toolbar, prop(toolbar, 'field:variant'), 'labels').doc;
const doc4 = R.withOverride(doc3, button, prop(button, 'asset'), 'rounded-solid').doc;
const doc5 = R.withOverride(doc4, toolbar, prop(toolbar, 'visible'), false).doc;

t('overrides: set, rows, reset one / element / all, normalisation drops junk', () => {
  assert.equal(doc1.$axf, 'ui-overrides@1'); assert.equal(doc1.updatedBy, 'brett'); assert.equal(doc1.updatedAt, AT);
  assert.ok(R.withOverride(doc1, toolbar, prop(toolbar, 'field:variant'), 'buttons').error.includes('valid: icons, icons-labels, labels'));
  const rows = R.propertyRows(toolbar, doc3, CATALOG);
  const v = rows.find((r) => r.id === 'field:variant');
  assert.deepEqual([v.value, v.base, v.overridden, v.source], ['labels', 'icons', true, 'override']);
  assert.equal(rows.find((r) => r.id === 'field:align').source, 'skin', 'with a skin in force an asset value is the skin\'s');
  assert.equal(rows.find((r) => r.id === 'visible').source, 'default');
  assert.equal(R.overrideCount(doc3), 3);
  assert.equal(R.overrideCount(R.withoutOverride(doc3, toolbar, 'transparency')), 2);
  assert.equal(R.overrideCount(R.withoutOverride(doc3, toolbar)), 0);
  assert.equal(R.overrideCount(R.withoutOverride(doc4)), 0);
  assert.deepEqual(R.normalizeOverrides({ elements: { 'asset:toolbar': { transparency: 50, bad: [1], 'x y': 1 }, 'no spaces!': { a: 1 } } }).elements, { 'asset:toolbar': { transparency: 50 } });
});

const plan = R.previewPlan(els, doc5, CATALOG);
t('preview plan: tokens only, opacity, hidden, swaps and patches', () => {
  assert.equal(plan.css, `${R.selectorOf(toolbar)}{--fx-surface:var(--fx-accent);opacity:0.8;display:none}`);
  assert.deepEqual(plan.swaps, [{ element: 'asset:button', type: 'button', id: 'rounded-solid' }]);
  assert.deepEqual(plan.patches, [{ element: 'asset:toolbar', type: 'toolbar', path: 'variant', value: 'labels' }]);
  assert.equal(R.previewPlan(els, null, CATALOG).css, '');
  const sz = els.find((e) => e.id === 'asset:sizing');
  const p = R.previewPlan(els, R.withOverride(null, sz, prop(sz, 'token:tokens.sizing:button.height'), 2.5).doc, CATALOG);
  assert.equal(p.css, `${R.selectorOf(sz)}{--fx-size-button-height:calc(var(--fx-font-size) * 2.5)}`);
});

const diff = R.diffOverrides(doc1, doc5);
const entry = R.changeEntry(diff, { by: 'brett', at: AT, note: 'exit summary confirmed' });
t('changes: diff, entry, undo, summary', () => {
  assert.deepEqual(diff, [
    { element: 'asset:button', prop: 'asset', to: 'rounded-solid' },
    { element: 'asset:toolbar', prop: 'field:variant', to: 'labels' },
    { element: 'asset:toolbar', prop: 'transparency', to: 80 },
    { element: 'asset:toolbar', prop: 'visible', to: false },
  ]);
  assert.equal(entry.$axf, 'ui-change@1'); assert.match(entry.id, /^ch-20261113190000000-brett-[a-z0-9]{7}$/); assert.equal(entry.undone, false);
  assert.notEqual(entry.id, R.changeEntry(diff.slice(0, 1), { by: 'brett', at: AT }).id);
  assert.deepEqual(R.undoChange(doc5, entry).elements, doc1.elements);
  const re = R.diffOverrides(doc5, R.withOverride(doc5, toolbar, prop(toolbar, 'transparency'), 20).doc);
  assert.deepEqual(re, [{ element: 'asset:toolbar', prop: 'transparency', from: 80, to: 20 }]);
  const s = R.summarize(diff, els, CATALOG);
  assert.deepEqual(s[1], { element: 'asset:toolbar', elementLabel: 'Toolbar', prop: 'field:variant', propLabel: 'Variant', from: 'icons (default)', to: 'labels' });
});

const fixture = {
  $axf: 'ui-manager-fixture@1',
  note: 'Generated by framework/spec/check-ui-manager.mjs --write from the fixed catalog in that file. A port replays it: same catalog in, same rows, verdicts, plan and entries out.',
  catalog: CATALOG,
  elements: els,
  tree: R.elementTree(els, ['asset:toolbar']),
  props: Object.fromEntries(els.map((e) => [e.id, R.propsOf(e, CATALOG)])),
  verdicts: [
    ['asset:toolbar', 'field:variant', 'LABELS'], ['asset:toolbar', 'field:variant', 'buttons'], ['asset:toolbar', 'transparency', '45%'], ['asset:toolbar', 'transparency', 47], ['asset:toolbar', 'transparency', 'lots'],
    ['asset:toolbar', 'visible', 'hidden'], ['asset:toolbar', 'token:tokens.theme:surface', 'accent'], ['asset:toolbar', 'token:tokens.theme:surface', '#f4f6f8'], ['asset:toolbar', 'asset', 'labels-bar'],
  ].map(([e, p, v]) => ({ element: e, prop: p, value: v, result: R.validateValue(prop(els.find((x) => x.id === e), p), v) })),
  overrides: doc5,
  rows: R.propertyRows(toolbar, doc5, CATALOG),
  plan,
  diff,
  entry,
  undone: R.undoChange(doc5, entry),
  summary: R.summarize(diff, els, CATALOG),
  schemas: typeof R.uiManagerSchemas === 'function' ? R.uiManagerSchemas() : undefined,
};
const text = `${JSON.stringify(fixture, null, 2)}\n`;
if (write) { writeFileSync(FIXTURE, text); console.log(`wrote ${FIXTURE}`); }
else t('fixture current (framework/spec/fixtures/ui-manager.json; --write to regenerate)', () => { assert.equal(readFileSync(FIXTURE, 'utf8'), text); });

console.log(`✓ ui-manager rules: ${n} checks`);

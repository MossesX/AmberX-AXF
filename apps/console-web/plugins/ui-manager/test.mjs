#!/usr/bin/env node
/**
 * UI Manager self-test: the rules (ui-element@1, choices, validation, overrides, preview, changes) on the real catalog, the
 * store (overrides + change log + undo in a temp data folder) and the CLI through a child process.
 *   node apps/console-web/plugins/ui-manager/test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../..');
const TMP = mkdtempSync(join(tmpdir(), 'axf-ui-manager-'));
process.env.AXF_UI_MANAGER_DIR = TMP;
process.env.AXF_APPEARANCE_FILE = join(TMP, 'no-appearance.json'); // no look document: the first asset of each type is in force

const R = await import('../../../../framework/core/engines/ui-manager-rules.mjs');
const { buildCatalog } = await import('./lib/catalog.mjs');
const core = await import('./lib/core.mjs');
const store = await import('./lib/store.mjs');

let n = 0;
const t = (name, f) => { try { f(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const cat = buildCatalog();
const els = R.frameworkElements(cat);
const by = (id) => els.find((e) => e.id === id);

t('catalog: asset types, assets, the asset in force, token sets', () => {
  assert.ok(Object.keys(cat.types).length >= 50);
  assert.ok(cat.assets.toolbar.length >= 5 && cat.assets['color-theme'].length >= 5);
  assert.equal(cat.active.toolbar, cat.assets.toolbar[0].id, 'no look document: the first asset is in force');
  for (const target of Object.values(R.TOKEN_TARGETS)) assert.ok(cat.paths[target].length >= 10, target);
});

t('elements: one per slot type with assets, categorised, with tokens', () => {
  assert.ok(els.length >= 40);
  assert.equal(by('asset:toolbar').category, 'chrome');
  assert.equal(by('asset:button').category, 'controls');
  assert.equal(by('asset:dialog').category, 'dialogs');
  assert.equal(by('asset:clock').category, 'widgets');
  assert.equal(by('asset:color-theme').category, 'look');
  assert.ok(by('asset:toolbar').tokens.includes('tokens.theme:surface'));
  assert.equal(R.normalizeElement({ id: 'bad id with spaces' }), null);
  assert.equal(R.normalizeElement({ id: 'x', kind: 'tab-group' }, cat.types).category, 'chrome');
});

t('manifest + target elements: plugin id never a folder, console targets become elements', () => {
  const m = R.elementsFromManifest({ $axf: 'plugin@1', id: 'ai.amberx.axf.console.sample', uiElements: [{ id: 'queue-grid', label: 'Queue', kind: 'grid', address: 'view:builds/grid:queue' }, { id: 'bad', kind: 'x', address: 1 }] }, cat.types);
  assert.equal(m.length, 2);
  assert.equal(m[0].id, 'ai.amberx.axf.console.sample/queue-grid');
  assert.equal(m[0].plugin, 'ai.amberx.axf.console.sample');
  assert.equal(m[0].category, 'plugins');
  assert.equal(R.selectorOf(m[0]), '[data-axf-target="view:builds/grid:queue"]', 'an element with an address is selected by its console-control target');
  const tg = R.elementsFromTargets({ $axf: 'console-control-targets@1', targets: [{ address: 'view:settings/tab:settings.tabs=plugins', kind: 'tab', label: 'Plugins tab' }] }, cat.types);
  assert.equal(tg[0].id, 'target:view:settings/tab:settings.tabs=plugins');
  assert.equal(tg[0].category, 'screens');
});

t('tree: On screen now first as shortcuts to the shared element; empty categories drop out; search', () => {
  const tree = R.elementTree(els, ['asset:toolbar', 'asset:button', 'nope']);
  assert.equal(tree[0].id, R.ON_SCREEN);
  assert.deepEqual(tree[0].items.map((i) => i.ref).sort(), ['asset:button', 'asset:toolbar']);
  assert.equal(R.resolveElement(tree[0].items[0], els), by(tree[0].items[0].ref), 'a shortcut resolves to the one element');
  assert.ok(!tree.some((c) => c.id === 'settings'), 'no settings elements yet: no Settings category');
  assert.equal(R.elementTree(els, [])[0].id, 'chrome', 'nothing visible: no On screen now');
  assert.ok(R.filterElements(els, 'tool').some((e) => e.id === 'asset:toolbar'));
  assert.equal(R.filterElements(els, 'zzzz').length, 0);
});

t('props: every property has a predetermined list; kinds; nothing free', () => {
  const props = R.propsOf(by('asset:toolbar'), cat);
  for (const p of props) assert.ok(p.options.length >= 2, `${p.id} has choices`);
  const ids = props.map((p) => p.id);
  assert.ok(ids.includes('visible') && ids.includes('transparency') && ids.includes('asset'));
  assert.equal(props.find((p) => p.id === 'asset').options.length, cat.assets.toolbar.length, 'asset choices = every toolbar asset');
  assert.deepEqual(props.find((p) => p.id === 'field:variant').options.map((o) => o.value), ['icons', 'icons-labels', 'labels'], 'enum from asset-types.json');
  const surface = props.find((p) => p.id === 'token:tokens.theme:surface');
  assert.equal(surface.kind, 'token');
  assert.ok(surface.options.every((o) => o.value.startsWith('@')), 'a colour is a token reference, never a literal');
  assert.equal(surface.token, '--fx-surface');
  const tr = props.find((p) => p.id === 'transparency');
  assert.equal(tr.kind, 'range'); assert.equal(tr.options.length, 21); assert.equal(tr.options[16].value, 80);
  assert.ok(!props.some((p) => p.kind === 'string' || p.free), 'no free text anywhere');
  const theme = R.propsOf(by('asset:color-theme'), cat);
  assert.ok(theme.some((p) => p.id === 'token:tokens.theme:accent'));
  assert.ok(!theme.some((p) => p.id === 'field:tokens.accent'), 'a token path is a token row, not a field');
  const sizing = R.propsOf(by('asset:sizing'), cat).find((p) => p.id === 'token:tokens.sizing:button.height');
  assert.equal(sizing.kind, 'range'); assert.equal(sizing.min, 1.5); assert.equal(sizing.max, 3.5); assert.equal(sizing.unit, 'font');
});

t('validate: in the list → ok (case-insensitive, coerced); outside → the valid values named', () => {
  const props = R.propsOf(by('asset:button'), cat);
  const shape = props.find((p) => p.id === 'field:shape');
  assert.deepEqual(R.validateValue(shape, 'Pill'), { ok: true, value: 'pill' });
  const bad = R.validateValue(shape, 'triangle');
  assert.equal(bad.ok, false); assert.match(bad.error, /valid: rounded, pill, square/);
  const tr = props.find((p) => p.id === 'transparency');
  assert.deepEqual(R.validateValue(tr, '80 %'), { ok: true, value: 80 });
  assert.deepEqual(R.validateValue(tr, 82), { ok: true, value: 80 }, 'snapped to the step');
  assert.equal(R.validateValue(tr, 120).ok, false);
  assert.equal(R.validateValue(tr, 'lots').ok, false);
  const vis = props.find((p) => p.id === 'visible');
  assert.deepEqual(R.validateValue(vis, 'off'), { ok: true, value: false });
  assert.equal(R.validateValue(vis, 'maybe').ok, false);
  const accent = props.find((p) => p.id === 'token:tokens.theme:accent');
  assert.deepEqual(R.validateValue(accent, 'success'), { ok: true, value: '@success' }, 'a bare token name is accepted as its reference');
  assert.equal(R.validateValue(accent, '#ff0000').ok, false, 'a literal colour is refused');
  const asset = props.find((p) => p.id === 'asset');
  assert.equal(R.validateValue(asset, 'no-such-asset').ok, false);
  assert.equal(R.validateValue(asset, cat.assets.button[1].id).ok, true);
});

t('overrides: set / reset / rows show override, base and source; cap', () => {
  const e = by('asset:button');
  const props = R.propsOf(e, cat);
  const shape = props.find((p) => p.id === 'field:shape');
  let r = R.withOverride(null, e, shape, 'pill', { by: 'brett' });
  assert.ok(r.doc && r.value === 'pill');
  assert.ok(R.withOverride(r.doc, e, shape, 'hexagon').error);
  r = R.withOverride(r.doc, e, props.find((p) => p.id === 'transparency'), 60);
  const rows = R.propertyRows(e, r.doc, cat);
  const sr = rows.find((x) => x.id === 'field:shape');
  assert.equal(sr.value, 'pill'); assert.equal(sr.base, shape.default); assert.equal(sr.overridden, true); assert.equal(sr.source, 'override');
  assert.equal(rows.find((x) => x.id === 'asset').source, 'asset');
  assert.equal(rows.find((x) => x.id === 'visible').source, 'default');
  assert.equal(R.overrideCount(r.doc), 2); assert.equal(R.overrideCount(r.doc, e.id), 2);
  const one = R.withoutOverride(r.doc, e.id, 'field:shape');
  assert.equal(R.overrideCount(one), 1);
  assert.equal(R.overrideCount(R.withoutOverride(r.doc, e.id)), 0);
  assert.equal(R.overrideCount(R.withoutOverride(r.doc)), 0);
  assert.deepEqual(R.normalizeOverrides({ elements: { 'asset:button': { 'field:shape': { nested: true }, ok: 1 }, 'bad id!': { x: 1 } } }).elements, { 'asset:button': { ok: 1 } });
  const big = { elements: {} };
  for (let i = 0; i < 2000; i++) big.elements[`asset:e${i}`] = { transparency: 50 };
  assert.ok(R.withOverride(big, e, shape, 'pill').error?.includes('too many'));
});

t('preview plan: tokens only, swaps and patches for the runtime, hidden and transparency', () => {
  const e = by('asset:toolbar');
  const props = R.propsOf(e, cat);
  const get = (id) => props.find((p) => p.id === id);
  let r = R.withOverride(null, e, get('token:tokens.theme:surface'), '@accent');
  r = R.withOverride(r.doc, e, get('transparency'), 80);
  r = R.withOverride(r.doc, e, get('field:variant'), 'labels');
  r = R.withOverride(r.doc, e, get('asset'), cat.assets.toolbar[1].id);
  r = R.withOverride(r.doc, e, get('token:tokens.style:space'), get('token:tokens.style:space').options[0].value);
  const plan = R.previewPlan(els, r.doc, cat);
  assert.ok(plan.css.startsWith(`${R.selectorOf(e)}{`), 'the rule is scoped to the element');
  assert.ok(R.selectorOf(e).includes('[data-fx-asset="toolbar"]'));
  assert.ok(plan.css.includes('--fx-surface:var(--fx-accent)'));
  assert.ok(plan.css.includes('opacity:0.8'));
  assert.ok(!/#[0-9a-f]{3,8}/i.test(plan.css), 'no colour literal in the preview');
  assert.deepEqual(plan.swaps, [{ element: e.id, type: 'toolbar', id: cat.assets.toolbar[1].id }]);
  assert.deepEqual(plan.patches, [{ element: e.id, type: 'toolbar', path: 'variant', value: 'labels' }]);
  const hidden = R.previewPlan(els, R.withOverride(null, e, get('visible'), false).doc, cat);
  assert.ok(hidden.css.includes('display:none'));
  assert.equal(R.previewPlan(els, null, cat).css, '');
});

t('changes: diff, entry ids never collide in one second, undo, summary', () => {
  const e = by('asset:button');
  const shape = R.propsOf(e, cat).find((p) => p.id === 'field:shape');
  const a = R.withOverride(null, e, shape, 'pill').doc;
  const b = R.withOverride(a, e, shape, 'square').doc;
  const d1 = R.diffOverrides(null, a), d2 = R.diffOverrides(a, b), d3 = R.diffOverrides(a, null);
  assert.deepEqual(d1, [{ element: e.id, prop: 'field:shape', to: 'pill' }]);
  assert.deepEqual(d2, [{ element: e.id, prop: 'field:shape', from: 'pill', to: 'square' }]);
  assert.deepEqual(d3, [{ element: e.id, prop: 'field:shape', from: 'pill' }]);
  assert.deepEqual(R.diffOverrides(a, a), []);
  const at = '2026-11-13T19:00:00.123Z';
  const e1 = R.changeEntry(d1, { by: 'brett', at }), e2 = R.changeEntry(d2, { by: 'brett', at });
  assert.equal(e1.$axf, 'ui-change@1'); assert.notEqual(e1.id, e2.id); assert.equal(e1.undone, false);
  assert.deepEqual(R.undoChange(b, e2).elements, a.elements, 'undo puts the old value back');
  assert.deepEqual(R.undoChange(a, e1).elements, {}, 'undo of a first set resets it');
  const s = R.summarize(d2, els, cat)[0];
  assert.equal(s.elementLabel, 'Button'); assert.equal(s.propLabel, 'Shape'); assert.equal(s.from, 'pill'); assert.equal(s.to, 'square');
  assert.match(R.summarize(d1, els, cat)[0].from, /\(default\)$/);
});

t('store + core: set saves and logs, reset, apply with summary, undo marks the entry, errors carry codes', () => {
  assert.equal(R.overrideCount(store.readOverrides()), 0);
  const r = core.set('asset:button', 'field:shape', 'pill', { by: 'brett' });
  assert.equal(r.changed, true); assert.equal(r.row.overridden, true); assert.equal(r.entry.by, 'brett');
  assert.throws(() => core.set('asset:button', 'field:shape', 'hexagon'), (e) => e.code === 'validation' && /valid:/.test(e.message));
  assert.throws(() => core.set('asset:nothing', 'field:shape', 'pill'), (e) => e.code === 'not_found');
  assert.throws(() => core.choices('asset:button', 'nope'), (e) => e.code === 'not_found' && /it has:/.test(e.message));
  assert.equal(core.set('asset:button', 'field:shape', 'pill').changed, false, 'the same value again changes nothing and logs nothing');
  assert.equal(core.rows('Button').overrides, 1, 'an element is found by label too');
  assert.equal(core.choices('asset:button', 'Shape').free, false);
  const pending = { elements: { 'asset:button': { 'field:shape': 'square', transparency: 50 }, 'asset:toolbar': { 'token:tokens.theme:surface': 'accent' } } };
  const pv = core.preview(pending);
  assert.equal(pv.summary.length, 3); assert.ok(pv.css.includes('--fx-surface:var(--fx-accent)'));
  assert.equal(R.overrideCount(store.readOverrides()), 1, 'a preview saves nothing');
  const ap = core.apply(pending, { by: 'brett', reason: 'exit summary confirmed' });
  assert.equal(ap.changed, true); assert.equal(ap.summary.length, 3); assert.equal(ap.entry.changes.length, 3);
  assert.equal(store.readOverrides().elements['asset:toolbar']['token:tokens.theme:surface'], '@accent', 'apply normalises through the choices');
  assert.throws(() => core.apply({ elements: { 'asset:button': { 'field:shape': 'hexagon' } } }), (e) => e.code === 'validation');
  const log = core.changes();
  assert.equal(log.total, 2); assert.equal(log.items[0].id, ap.entry.id);
  const un = core.undo(ap.entry.id);
  assert.equal(un.remaining, 1); assert.equal(un.entry.undoes, ap.entry.id);
  assert.equal(core.changes().items.find((x) => x.id === ap.entry.id).undone, true);
  assert.throws(() => core.undo(ap.entry.id), (e) => e.code === 'not_found' && /already undone/.test(e.message));
  const rs = core.reset('asset:button', 'field:shape');
  assert.equal(rs.changed, true); assert.equal(rs.remaining, 0);
  assert.equal(core.reset().changed, false);
  assert.equal(core.listElements({ q: 'button' }).items[0].overrides, 0);
  assert.equal(core.tree({ visible: ['asset:button'] }).categories[0].items[0].ref, 'asset:button');
});

t('CLI: json answers, exit 1 with a code on an error', () => {
  const run = (...a) => { const p = spawnSync('node', [join(HERE, 'ui-manager.mjs'), ...a, '--json'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env } }); return { code: p.status, out: JSON.parse(p.stdout.trim().split('\n').pop()) }; };
  assert.equal(run('elements', '--q', 'toolbar').out.items[0].id, 'asset:toolbar');
  assert.equal(run('choices', 'asset:toolbar', 'field:variant').out.options.length, 3);
  const s = run('set', 'asset:toolbar', 'transparency', '80', '--by', 'cli');
  assert.equal(s.code, 0); assert.equal(s.out.value, 80); assert.equal(s.out.entry.by, 'cli');
  const bad = run('set', 'asset:toolbar', 'transparency', '500');
  assert.equal(bad.code, 1); assert.equal(bad.out.code, 'validation');
  assert.equal(run('props', 'asset:toolbar').out.overrides, 1);
  assert.ok(run('preview').out.css.includes('opacity:0.8'));
  assert.equal(run('reset', 'asset:toolbar').out.remaining, 0);
  assert.equal(run('bogus').code, 1);
  assert.ok(run('catalog').out.tokenSets['tokens.theme'] >= 10);
});

rmSync(TMP, { recursive: true, force: true });
console.log(`✓ ui-manager: ${n} test groups passed`);

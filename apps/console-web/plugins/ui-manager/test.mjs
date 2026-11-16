#!/usr/bin/env node
/**
 * UI Manager self-test: the rules (ui-element@1, choices, validation, overrides, preview, changes) on the real catalog, the
 * store (overrides + change log + undo in a temp data folder) and the CLI through a child process.
 *   node apps/console-web/plugins/ui-manager/test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
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
  assert.equal(R.validateValue(accent, '#ff0000').ok, false, 'a literal colour is refused'); // theme-ok: the refused input of a test
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
  assert.ok(plan.css.includes('--fx-surface:var(--fx-accent)')); // theme-ok: the engine's generated CSS under test
  assert.ok(plan.css.includes('opacity:0.8')); // theme-ok: a transparency pick compiled by the engine
  assert.ok(!/#[0-9a-f]{3,8}/i.test(plan.css), 'no colour literal in the preview');
  assert.deepEqual(plan.swaps, [{ element: e.id, type: 'toolbar', id: cat.assets.toolbar[1].id }]);
  // an asset field and a style token without a --fx-* name of its own both go to the runtime as patches
  assert.deepEqual(plan.patches, [{ element: e.id, type: 'toolbar', path: 'variant', value: 'labels' }, { element: e.id, target: 'tokens.style', path: 'space', value: get('token:tokens.style:space').options[0].value }]);
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
  assert.equal(pv.summary.length, 3); assert.ok(pv.css.includes('--fx-surface:var(--fx-accent)')); // theme-ok: generated CSS under test
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
  assert.ok(run('preview').out.css.includes('opacity:0.8')); // theme-ok: generated CSS under test
  assert.equal(run('reset', 'asset:toolbar').out.remaining, 0);
  assert.equal(run('bogus').code, 1);
  assert.ok(run('catalog').out.tokenSets['tokens.theme'] >= 10);
});

const Q = await import('./lib/query.mjs');
t('query: search, sort, multi-filter, facets, pages, over thousands of elements', () => {
  const many = [];
  for (let i = 0; i < 5000; i++) many.push({ id: `asset:e${i}`, label: `Element ${String(i).padStart(4, '0')}`, kind: ['button', 'toolbar', 'grid'][i % 3], category: ['controls', 'chrome', 'data'][i % 3], plugin: i % 2 ? 'ai.x.a' : 'ai.x.b', tokens: [], overrides: i % 100 === 0 ? 2 : 0 });
  const t0 = Date.now();
  const hits = Q.queryElements(many, { kinds: 'button,grid', plugins: ['ai.x.a'], sort: 'label', desc: true });
  assert.ok(Date.now() - t0 < 500, 'fast on 5000 elements');
  assert.ok(hits.every((e) => e.kind !== 'toolbar' && e.plugin === 'ai.x.a'), 'OR inside a filter, AND across filters');
  assert.ok(hits[0].label > hits[1].label, 'descending');
  assert.equal(Q.queryElements(many, { overriddenOnly: true }).length, 50);
  assert.deepEqual(Q.queryElements(many, { onScreenOnly: true }, ['asset:e7', 'asset:e3']).map((e) => e.id), ['asset:e3', 'asset:e7']);
  assert.equal(Q.queryElements(many, { sort: 'overrides', desc: true })[0].overrides, 2);
  assert.equal(Q.normalizeQuery({ sort: 'nope' }).sort, 'label');
  const f = Q.facets(many);
  assert.equal(f.kinds.find((k) => k.value === 'button').count, 1667); assert.equal(f.overridden, 50);
  const p = Q.page(hits, { limit: 10, offset: 5 });
  assert.equal(p.items.length, 10); assert.equal(p.items[0].id, hits[5].id); assert.equal(p.total, hits.length);
  const tr = Q.queryTree(many, { q: 'Element 000', sort: 'label', desc: true }, ['asset:e1']);
  assert.equal(tr[0].id, R.ON_SCREEN); assert.equal(tr[0].items[0].ref, 'asset:e1', 'On screen now holds shortcuts');
  const ctl = tr.find((c) => c.id === 'controls'); assert.ok(ctl.items[0].label > ctl.items.at(-1).label, 'each category in the query order');
  const rows = core.rows('asset:toolbar').items;
  assert.ok(Q.queryProps(rows, { groups: 'Tokens' }).every((r) => r.group === 'Tokens'));
  assert.ok(Q.queryProps(rows, { q: 'transp' }).some((r) => r.id === 'transparency'));
  assert.equal(core.rows('asset:toolbar', { groups: ['Tokens'] }).total, rows.length, 'total counts every property');
  const listed = core.listElements({ kinds: 'toolbar', limit: 1 });
  assert.equal(listed.items.length, 1); assert.equal(listed.items[0].kind, 'toolbar'); assert.ok(listed.facets.kinds.length > 5);
});

const S = await import('./lib/say.mjs');
t('say: "select the main toolbar, set its transparency to 80", and the window state', () => {
  assert.deepEqual(S.parseSay('select the main toolbar, set its transparency to 80'), [{ op: 'select', what: 'the main toolbar' }, { op: 'set', prop: 'transparency', value: '80' }]);
  assert.deepEqual(S.parseSay('set the variant of the toolbar to labels then grid view'), [{ op: 'set', prop: 'variant', what: 'the toolbar', value: 'labels' }, { op: 'view', view: 'grid' }]);
  assert.equal(S.parseSay('dance')[0].op, 'unknown');
  assert.equal(S.rankElements(els, 'the main toolbar')[0].id, 'asset:toolbar');
  const r = core.say('select the main toolbar, set its transparency to 80', { by: 'voice' });
  assert.equal(r.selected, 'asset:toolbar'); assert.equal(r.steps[1].value, 80); assert.equal(r.steps[1].changed, true);
  assert.equal(core.state().element, 'asset:toolbar'); assert.equal(core.rows('asset:toolbar').overrides, 1);
  assert.throws(() => core.say('set its transparency to 500'), (e) => e.code === 'validation' && /step 1 of 1/.test(e.message), 'outside the choices is refused');
  assert.throws(() => core.say('select the flux capacitor'), (e) => e.code === 'not_found');
  assert.equal(core.say('reset transparency of the toolbar').steps[0].changed, true);
  assert.equal(core.rows('asset:toolbar').overrides, 0);
  assert.equal(core.say('panel view').steps[0].view, 'panel'); assert.equal(core.state().view, 'panel');
  assert.throws(() => core.setView('carousel'), (e) => e.code === 'validation');
  assert.equal(core.select('target:view:builds/button:save').selected, 'target:view:builds/button:save', 'a live console target is selectable by id');
});

const M = await import('./lib/manifest.mjs');
t('manifest: a new plugin appears with nothing written for the UI Manager; uiElements add more', () => {
  const fresh = { $axf: 'plugin@1', id: 'ai.example.console.weather', name: 'Weather', provides: ['view:weather', 'settings-tab:weather', 'dialog:weather-pick', 'banner:weather', 'service:weather@1'], tabable: { view: 'weather', label: 'Weather' } };
  const got = M.manifestElements(fresh, cat.types);
  assert.deepEqual(got.map((e) => e.id).sort(), ['plugin:ai.example.console.weather', 'plugin:ai.example.console.weather/banner:weather', 'target:dialog:weather-pick', 'target:settings-tab:weather', 'target:view:weather'].sort());
  assert.ok(got.every((e) => e.plugin === 'ai.example.console.weather'), 'named by id, never a folder');
  assert.equal(got.find((e) => e.id === 'target:view:weather').category, 'screens');
  assert.equal(got.find((e) => e.id === 'target:settings-tab:weather').category, 'settings');
  const declared = M.manifestElements({ ...fresh, uiElements: [{ id: 'radar', label: 'Radar grid', kind: 'grid', address: 'view:weather/grid:radar' }] }, cat.types);
  assert.ok(declared.some((e) => e.id === 'ai.example.console.weather/radar' && e.kind === 'grid'));
  assert.deepEqual(M.manifestElements({ id: 'x' }), [], 'not a plugin@1 manifest: nothing');
  assert.equal(M.allManifestElements([fresh, { ...fresh, id: 'ai.other' }]).filter((e) => e.id === 'target:view:weather').length, 1, 'one id once');
  // the real console: every installed plugin is an element, its own declared parts too
  const all = core.listElements({ limit: 5000 }).items;
  assert.ok(all.filter((e) => e.kind === 'plugin').length >= 20, 'every plugin');
  assert.ok(all.some((e) => e.id === 'ai.amberx.axf.console.ui-manager/window'), 'declared uiElements');
  assert.ok(core.rows('target:view:ui-manager').total >= 2, 'a derived element opens with its properties');
});

const L = await import('./lib/library.mjs');
t('library: export any UI as an asset library, publish to the hub library, package, validate, import plans and console import', () => {
  process.env.AXF_UI_LIBRARY_DIR = join(TMP, 'hub-library');
  core.reset();
  core.set('asset:toolbar', 'field:variant', 'labels');
  core.set('asset:toolbar', 'transparency', 80);
  core.set('asset:color-theme', 'token:tokens.theme:surface', 'accent');
  core.set('asset:button', 'visible', false);
  assert.throws(() => core.library({ elements: ['asset:dialog'], id: 'x' }), (e) => e.code === 'validation', 'a bad id is refused');
  const r = core.library({ id: 'test-look', name: 'Test look', description: 'From the tests', by: 'tests', publish: true, skin: true });
  const lib = r.library;
  assert.equal(lib.$axf, 'ui-library@1'); assert.equal(r.valid, true); assert.equal(r.package, 'test-look.ui-library.json');
  assert.deepEqual(lib.elements.map((e) => e.id).sort(), ['asset:button', 'asset:color-theme', 'asset:toolbar']);
  const tb = lib.assets.find((a) => a.type === 'toolbar');
  assert.equal(tb.id, `${cat.active.toolbar}-test-look`); assert.equal(tb.data.variant, 'labels', 'the field override is written into the exported asset'); assert.equal(tb.$axf, 'asset@1');
  const th = lib.assets.find((a) => a.type === 'color-theme');
  const accent = cat.assets['color-theme'].find((a) => a.id === cat.active['color-theme']).data.tokens.accent;
  assert.equal(th.data.tokens.surface, accent, 'a colour reference resolves to the literal of the theme in force');
  assert.deepEqual(lib.tokens, { 'tokens.theme': { surface: accent } });
  assert.deepEqual(lib.manifest.slots, { toolbar: tb.id, 'color-theme': th.id, button: cat.active.button });
  assert.deepEqual(lib.manifest.hidden, { button: true }); assert.deepEqual(lib.manifest.transparency, { 'asset:toolbar': 80 });
  assert.deepEqual(lib.overrides.elements['asset:toolbar'], { asset: tb.id, transparency: 80 }, 'the overrides replay the library: asset ids rewritten to the patched copies');
  assert.deepEqual(R.libraryErrors(lib, cat), []);
  assert.ok(R.libraryErrors({ ...lib, manifest: { slots: { toolbar: 'nope' } } }, cat).some((e) => /neither in the library nor known/.test(e)));
  assert.ok(R.libraryErrors({ ...lib, assets: [{ id: 'x' }] }).some((e) => /not an asset@1/.test(e)));
  assert.equal(core.libraryValidate(lib).ok, true); assert.equal(core.libraryValidate({ $axf: 'nope' }).ok, false);
  // the skin it makes: the sections filled from the asset in force, the tokens as control@1 overrides
  assert.equal(r.skin.type, 'skin'); assert.equal(r.skin.data.colorTheme, th.id); assert.equal(r.skin.data.styleTheme, cat.active['style-theme']); assert.equal(r.skin.data.layoutTheme, cat.active.layout);
  assert.deepEqual(r.skin.data.assets, { toolbar: tb.id, button: cat.active.button }); assert.deepEqual(r.skin.data.extras.settings, { 'axf.tokens.theme': { '*': { surface: accent } } }); assert.deepEqual(r.skin.data.extras.hidden, { button: true });
  // the hub library
  assert.equal(r.published.hub, join(TMP, 'hub-library')); assert.ok(existsSync(join(TMP, 'hub-library', 'test-look.json')) && existsSync(join(TMP, 'hub-library', 'index.json')));
  assert.deepEqual(core.libraries().items.map((i) => [i.id, i.assets, i.elements, i.tokens]), [['test-look', 3, 3, 1]]);
  assert.equal(core.libraryGet('test-look').library.id, 'test-look'); assert.deepEqual(core.libraryGet('test-look').errors, []);
  assert.throws(() => core.libraryGet('nothing-here'), (e) => e.code === 'not_found');
  assert.equal(L.packageOf(lib).filename, 'test-look.ui-library.json'); assert.equal(JSON.parse(L.packageOf(lib).text).id, 'test-look');
  // import plans: the shared set, an app, a project, a skin, this console
  const fw = core.libraryImport('test-look', { into: 'framework', plan: true });
  assert.deepEqual(fw.files, [`framework/assets/toolbar/${tb.id}.json`, `framework/assets/color-theme/${th.id}.json`, `framework/assets/button/${cat.active.button}.json`], 'self-contained: the unchanged button asset is carried too');
  const app = core.libraryImport('test-look', { into: 'app', dir: 'apps/axhub-web', plan: true });
  assert.deepEqual(app.files, [`apps/axhub-web/src/assets/toolbar/${tb.id}.json`, `apps/axhub-web/src/assets/color-theme/${th.id}.json`, `apps/axhub-web/src/assets-overrides/button/${cat.active.button}.json`], 'new ids go to the app\'s own assets, an id the shared set has to assets-overrides');
  assert.ok(core.libraryImport('test-look', { into: 'project', dir: '/tmp/x', plan: true }).files.every((f) => f.startsWith('/tmp/x/assets/')));
  const sk = core.libraryImport('test-look', { into: 'skin', plan: true });
  assert.equal(sk.files[0], 'framework/assets/skin/test-look.json');
  assert.throws(() => core.libraryImport('test-look', { into: 'app', plan: true }), (e) => e.code === 'invalid', 'an app import needs its folder');
  assert.throws(() => core.libraryImport('test-look', { into: 'nowhere' }), (e) => e.code === 'invalid');
  // a real import into a project folder, then into this console (assets land where the catalog reads, overrides apply)
  const proj = join(TMP, 'project');
  const w1 = core.libraryImport('test-look', { into: 'project', dir: proj });
  assert.equal(w1.written.length, 3); assert.equal(JSON.parse(readFileSync(join(proj, 'assets', 'toolbar', `${tb.id}.json`), 'utf8')).data.variant, 'labels');
  assert.equal(core.libraryImport('test-look', { into: 'project', dir: proj }).skipped.length, 3, 'existing files are kept without force');
  core.reset();
  const pkg = join(TMP, 'test-look.ui-library.json');
  writeFileSync(pkg, L.packageOf(lib).text);
  const w2 = core.libraryImport(pkg, { into: 'console', by: 'tests' });
  try {
    assert.equal(w2.written.length, 3); assert.equal(w2.applied.changed, true);
    assert.equal(core.rows('asset:toolbar').items.find((p) => p.id === 'asset').value, tb.id, 'the console now uses the imported asset');
    assert.ok(core.choices('asset:toolbar', 'asset').options.some((o) => o.value === tb.id), 'the imported asset is a choice');
  } finally {
    for (const f of w2.written) rmSync(join(ROOT, f), { force: true });
    // the plugin ships no assets of its own: the folders the import made go too, when they are empty
    for (const d of [...new Set(w2.written.map((f) => dirname(join(ROOT, f)))), join(HERE, 'assets')]) { try { rmdirSync(d); } catch { /* not empty, or gone */ } }
    core.reset();
  }
  // the CLI: export to a file, list, import plan
  const run = (...a) => { const p = spawnSync('node', [join(HERE, 'ui-manager.mjs'), ...a, '--json'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env } }); return { code: p.status, out: JSON.parse(p.stdout.trim().split('\n').pop()) }; };
  core.set('asset:toolbar', 'transparency', 60);
  const cli = run('library', '--id', 'cli-look', '--name', 'CLI look', '--out', join(TMP, 'cli.json'));
  assert.equal(cli.code, 0); assert.equal(cli.out.wrote, join(TMP, 'cli.json')); assert.equal(JSON.parse(readFileSync(join(TMP, 'cli.json'), 'utf8')).id, 'cli-look');
  assert.equal(run('libraries').out.items.length, 1, 'not published without --publish');
  assert.equal(run('import', join(TMP, 'cli.json'), '--into', 'framework', '--plan').out.into, 'framework');
  assert.equal(run('library-validate', '--pending', join(TMP, 'cli.json')).out.ok, true);
  assert.equal(run('import', 'cli-look', '--into', 'console').code, 1, 'not on the hub');
  core.reset();
});

const { rebaseDraft } = await import('./lib/draft.mjs');
t('window draft: Apply rebases on what is saved now (last save wins per key), a pending reset removes the key', () => {
  const start = { elements: { 'asset:toolbar': { transparency: 80 }, 'asset:banner': { visible: false } } };
  const draft = { elements: { 'asset:toolbar': { transparency: 50 } } }; // changed one, reset the banner
  const now = { elements: { 'asset:toolbar': { transparency: 80 }, 'asset:banner': { visible: false }, 'asset:nav': { transparency: 40 } } }; // nav saved meanwhile
  const out = rebaseDraft(start, draft, now);
  assert.deepEqual(out.elements, { 'asset:toolbar': { transparency: 50 }, 'asset:nav': { transparency: 40 } });
  assert.deepEqual(rebaseDraft(start, start, now).elements, now.elements, 'an empty draft changes nothing');
});

rmSync(TMP, { recursive: true, force: true });
console.log(`✓ ui-manager: ${n} test groups passed`);

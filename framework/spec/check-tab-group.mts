/**
 * tab-group@1 (core/engines/components.ts → normalizeTabGroup / tabGroupStyle; build tab-group-assets, Nov 4 2026):
 * replays spec/fixtures/components.json → `tab-group` + `tab-group-cases` through the reference engine (the Kotlin
 * twin is deferred, spec/PORTING.md), checks every starter validates with no engine surprises, the enums in
 * asset-types.json are exactly the engine's, the default in defaults.json exists, and the six Nov 4 starters ship.
 *   npx -y tsx framework/spec/check-tab-group.mts
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeTabGroup, tabGroupStyle, TAB_GROUP_DEFAULT, TAB_GROUP_DISPLAYS, TAB_GROUP_OVERFLOWS, TAB_GROUP_POSITIONS, TAB_GROUP_STYLES } from '../core/engines/components';
import { hideable } from '../core/engines/hide';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
// @ts-expect-error plain .mjs (the build engine's own validator)
import { validateAsset as engineValidate } from '../cli/build-engine.mjs';

const root = new URL('../', import.meta.url).pathname;
const fixture = JSON.parse(readFileSync(join(root, 'spec/fixtures/components.json'), 'utf8'));
const spec = JSON.parse(readFileSync(join(root, 'schemas/asset-types.json'), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg); checks++; };

/* ---- registry ---- */
ok((ASSET_TYPES as readonly string[]).includes('tab-group') && (OPTIONAL_TYPES as readonly string[]).includes('tab-group'), 'tab-group is an optional asset type');
ok(hideable('tab-group'), 'tab-group is hideable');
const t = spec.types['tab-group'];
eq(t.enums.style, TAB_GROUP_STYLES, 'asset-types.json style enum = engine');
eq(t.enums.position, TAB_GROUP_POSITIONS, 'position enum = engine');
eq(t.enums.overflow, TAB_GROUP_OVERFLOWS, 'overflow enum = engine');
eq(t.enums.display, TAB_GROUP_DISPLAYS, 'display enum = engine');
for (const f of ['position', 'density', 'overflow', 'display', 'showIcons', 'divider', 'sticky', 'collapsible', 'closable', 'reorderable', 'badges', 'rememberLast']) ok(typeof t.optional_fields?.[f] === 'string', `optional field ${f} documented`);
eq(Object.keys(TAB_GROUP_DEFAULT).sort(), ['align', 'badges', 'closable', 'collapsible', 'density', 'display', 'divider', 'overflow', 'position', 'rememberLast', 'reorderable', 'showIcons', 'sticky', 'style'], 'default covers every field');

/* ---- defaults.json ---- */
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
ok(typeof defaults['tab-group'] === 'string', 'defaults.json names a tab-group');

/* ---- starters ---- */
const dir = join(root, 'assets/tab-group');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const ids = new Set<string>();
for (const f of files) {
  const a = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const r = validateAsset(a);
  ok(r.ok, `${f} validates (TS): ${r.ok ? '' : r.errors.join('; ')}`);
  const e = engineValidate(a);
  ok(e.ok, `${f} validates (build engine): ${e.ok ? '' : e.errors.join('; ')}`);
  ok(a.id === f.replace(/\.json$/, '') && a.type === 'tab-group', `${f}: id and type match the file`);
  ids.add(a.id);
  const n = normalizeTabGroup(a.data);
  // a starter never relies on a fallback: every value it writes is the value the engine keeps
  for (const [k, v] of Object.entries(a.data)) if (k !== 'showIcons') eq((n as Record<string, unknown>)[k], v, `${f}: ${k} kept as written`);
}
ok(ids.has(defaults['tab-group']), 'the default tab-group ships');
for (const id of ['chips', 'icon-rail', 'side-dock', 'more-menu', 'dropdown-compact', 'sticky-badged']) ok(ids.has(id), `Nov 4 starter ${id} ships`);
ok(files.length >= 36, `at least 36 starters (${files.length})`);

/* ---- fixture replay ---- */
ok(fixture['tab-group'] && fixture['tab-group-cases'], 'components.json carries tab-group + tab-group-cases (gen-fixtures)');
for (const [id, want] of Object.entries(fixture['tab-group'] as Record<string, { normalized: unknown; vars: unknown; attrs: unknown }>)) {
  const a = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
  eq({ normalized: normalizeTabGroup(a.data), ...tabGroupStyle(a.data) }, want, `fixture ${id}`);
}
const cases = fixture['tab-group-cases'];
eq({ normalized: normalizeTabGroup(null), ...tabGroupStyle(null) }, cases.missing, 'case missing');
eq(tabGroupStyle({ style: 'pills', align: 'start' }, true), cases.hidden, 'case hidden');
eq(normalizeTabGroup({ style: 'underline', align: 'start', showIcons: false }), cases['legacy-show-icons-false'], 'case legacy showIcons');
eq(normalizeTabGroup({ style: 'underline', align: 'start', showIcons: false, display: 'icons' }), cases['display-wins-over-show-icons'], 'case display wins');
eq(normalizeTabGroup({ style: 'x' as never, align: 'y' as never, position: 'z' as never, overflow: 'q' as never, display: 'w' as never, density: 'v' as never }), cases['unknown-values-fall-back'], 'case unknown values');
eq(tabGroupStyle({ style: 'pills', align: 'start', position: 'left', display: 'icons', sticky: true, badges: false }), cases['left-rail'], 'case left rail');
eq(normalizeTabGroup({ style: 'boxed', align: 'stretch', sticky: true, collapsible: true, closable: true, reorderable: true, badges: true, rememberLast: true, overflow: 'more', position: 'bottom' }), cases['every-flag-on'], 'case every flag');

/* ---- engine rules ---- */
eq(normalizeTabGroup(null), TAB_GROUP_DEFAULT, 'missing asset = the default (underline, pre-Nov 4 look)');
eq(normalizeTabGroup({ style: 'underline', align: 'start', showIcons: false }).display, 'text', 'showIcons false → text only');
eq(normalizeTabGroup({ style: 'underline', align: 'start', display: 'text' }).showIcons, false, 'display text → showIcons false (older readers)');
eq(normalizeTabGroup({ style: 'underline', align: 'start', display: 'icons' }).showIcons, true, 'display icons → showIcons true');
const attrs = tabGroupStyle({ style: 'chips', align: 'center', position: 'right', overflow: 'more', display: 'icons', sticky: true, collapsible: true, badges: false }).attrs;
eq(attrs, { 'data-fx-tabs': 'chips', 'data-fx-tabs-align': 'center', 'data-fx-tabs-position': 'right', 'data-fx-tabs-overflow': 'more', 'data-fx-tabs-display': 'icons', 'data-fx-tabs-icons': 'on', 'data-fx-tabs-divider': 'on', 'data-fx-tabs-sticky': 'on', 'data-fx-tabs-collapsible': 'on', 'data-fx-tabs-badges': 'off', 'data-fx-tabs-hidden': 'off' }, 'every attribute compiles');
ok(Object.keys(tabGroupStyle(null).vars).length === 2 && tabGroupStyle(null).vars['--fx-tab-py']!.includes('var(--fx-space)'), 'padding vars read the space token, never a px');

/* ---- stylesheet ---- */
const css = readFileSync(join(root, 'ui/axf.css'), 'utf8');
for (const sel of ["[data-fx-tabs='chips']", ".fx-tabs--group[data-fx-tabs-display='icons']", ".fx-tabs--group[data-fx-tabs-sticky='on']", ".fx-tabs--group[data-fx-tabs-position='left']", ".fx-tabs--group[data-fx-tabs-badges='off']", '.fx-tab__badge', '.fx-tab__close', '.fx-tabframe']) ok(css.includes(sel), `axf.css styles ${sel}`);
const block = css.slice(css.indexOf('/* tab-group@1 (Nov 4 2026)'), css.indexOf('.fx-tabs--dropdown > .fx-tabs__pick'));
// tokens only: no literal colours, no px beyond the 1px / 2px hairlines the rest of axf.css draws accents with
// (pill radii stay 999px by convention: "shapes stay fixed", console sizes rule, Oct 17 2026)
ok(block.length > 100 && !/#[0-9a-f]{3,8}\b|rgba?\(|\d+px/i.test(block.replace(/\b(?:[12]|999)px\b/g, '')), 'tab-group block: no hard-coded colours or px sizes (tokens only)');

console.log(`✓ tab-group@1: ${checks} checks`);

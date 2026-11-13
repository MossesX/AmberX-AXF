/**
 * expander-picker@1 (core/engines/components.ts → normalizeExpanderPicker / expanderPickerStyle; build
 * new-asset-type-animated-expanding-row, Nov 13 2026; Brett: "I don't want drop-down bars anymore. They are gonna be
 * animated. It's gonna be a row with a name and a little arrow; when you press that arrow it expands a subgrid; you got
 * to press it again to apply it and close it"): replays spec/fixtures/components.json → `expander-picker` +
 * `expander-picker-cases` through the reference engine (the Kotlin twin is deferred, spec/PORTING.md), checks every
 * starter validates with no engine surprises, the enums in asset-types.json are exactly the engine's, the default in
 * defaults.json ships, the slot is customizable (skinnable through tokens), the style package lists it as a member, the
 * stylesheet draws every state from tokens only, and no framework form keeps a native <select>.
 *   npx -y tsx framework/spec/check-expander-picker.mts
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPANDER_PICKER_ANIMATIONS, EXPANDER_PICKER_APPLIES, EXPANDER_PICKER_ARROWS, EXPANDER_PICKER_COLUMNS, EXPANDER_PICKER_DEFAULT, EXPANDER_PICKER_TILES, expanderPickerStyle, normalizeExpanderPicker } from '../core/engines/components';
import { customizable } from '../core/engines/customize';
import { hideable } from '../core/engines/hide';
import { STYLE_PACKAGE_MEMBERS } from '../core/engines/stylepackage';
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
ok((ASSET_TYPES as readonly string[]).includes('expander-picker') && (OPTIONAL_TYPES as readonly string[]).includes('expander-picker'), 'expander-picker is an optional asset type');
eq(ASSET_TYPES[ASSET_TYPES.indexOf('slider') + 1], 'expander-picker', 'registered with the controls, right after slider');
eq(Object.keys(spec.types), [...ASSET_TYPES], 'asset-types.json lists the types in the TS order (Kotlin reads the same file)');
ok(!hideable('expander-picker'), 'a control is never hideable');
const t = spec.types['expander-picker'];
eq(t.group, 'Controls', 'in the Controls group');
eq(t.required, ['tiles', 'arrow'], 'required: tiles + arrow');
eq(t.enums.tiles, EXPANDER_PICKER_TILES, 'tiles enum = engine');
eq(t.enums.arrow, EXPANDER_PICKER_ARROWS, 'arrow enum = engine');
eq(t.enums.columns, EXPANDER_PICKER_COLUMNS, 'columns enum = engine');
eq(t.enums.animation, EXPANDER_PICKER_ANIMATIONS, 'animation enum = engine');
eq(t.enums.apply, EXPANDER_PICKER_APPLIES, 'apply enum = engine');
eq(t.enums.density, ['compact', 'regular', 'roomy'], 'density enum');
for (const f of ['columns', 'density', 'animation', 'apply', 'preview', 'showValue', 'divider']) ok(typeof t.optional_fields?.[f] === 'string', `optional field ${f} documented`);
eq(Object.keys(EXPANDER_PICKER_DEFAULT).sort(), ['animation', 'apply', 'arrow', 'columns', 'density', 'divider', 'preview', 'showValue', 'tiles'], 'default covers every field');
eq(EXPANDER_PICKER_DEFAULT.apply, 'second-press', "Brett's rule is the default: press an option again to apply and close");
ok(/row with (the setting's )?name/.test(t.description) && /press/.test(t.description), 'the description carries the rule');

/* ---- skinnable + packaged ---- */
ok(customizable('expander-picker'), 'expander-picker is a customize target (asset-customize@1 tokens, skins reach it)');
const customize = JSON.parse(readFileSync(join(root, 'schemas/customize.json'), 'utf8'));
eq(customize.targets['expander-picker'], { root: '.fx-pick', item: '.fx-pick__tile' }, 'customize target names the stylesheet root and tile');
ok(STYLE_PACKAGE_MEMBERS.includes('expander-picker'), 'a style package may set the expander-picker slot');

/* ---- defaults.json ---- */
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
ok(typeof defaults['expander-picker'] === 'string', 'defaults.json names an expander-picker');

/* ---- starters ---- */
const dir = join(root, 'assets/expander-picker');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const ids = new Set<string>();
for (const f of files) {
  const a = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const r = validateAsset(a);
  ok(r.ok, `${f} validates (TS): ${r.ok ? '' : r.errors.join('; ')}`);
  const e = engineValidate(a);
  ok(e.ok, `${f} validates (build engine): ${e.ok ? '' : e.errors.join('; ')}`);
  ok(a.id === f.replace(/\.json$/, '') && a.type === 'expander-picker', `${f}: id and type match the file`);
  ids.add(a.id);
  const n = normalizeExpanderPicker(a.data);
  // a starter never relies on a fallback: every value it writes is the value the engine keeps
  for (const [k, v] of Object.entries(a.data)) eq((n as Record<string, unknown>)[k], v, `${f}: ${k} kept as written`);
}
ok(ids.has(defaults['expander-picker']), 'the default expander-picker ships');
eq(normalizeExpanderPicker(JSON.parse(readFileSync(join(dir, `${defaults['expander-picker']}.json`), 'utf8')).data), EXPANDER_PICKER_DEFAULT, 'the default starter is the engine default (an app without the asset looks the same)');
for (const id of ['unfold-cards', 'chips-quick', 'list-rows', 'swatch-tiles', 'compact-admin', 'touch-large', 'fade-cards', 'plain-static']) ok(ids.has(id), `starter ${id} ships`);
ok([...ids].some((id) => normalizeExpanderPicker(JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')).data).apply === 'first-press'), 'one starter applies on the first press (quick lists)');
ok(new Set([...ids].map((id) => normalizeExpanderPicker(JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')).data).tiles)).size === EXPANDER_PICKER_TILES.length, 'the starters cover every tile style');

/* ---- fixture replay ---- */
ok(fixture['expander-picker'] && fixture['expander-picker-cases'], 'components.json carries expander-picker + expander-picker-cases (gen-fixtures)');
for (const [id, want] of Object.entries(fixture['expander-picker'] as Record<string, unknown>)) {
  const a = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
  eq({ normalized: normalizeExpanderPicker(a.data), ...expanderPickerStyle(a.data) }, want, `fixture ${id}`);
}
eq(Object.keys(fixture['expander-picker']).sort(), [...ids].sort(), 'the fixture covers every starter (regenerate with gen-fixtures)');
const cases = fixture['expander-picker-cases'];
eq({ normalized: normalizeExpanderPicker(null), ...expanderPickerStyle(null) }, cases.missing, 'case missing');
eq({ normalized: normalizeExpanderPicker({ tiles: 'list', arrow: 'caret' }), ...expanderPickerStyle({ tiles: 'list', arrow: 'caret' }) }, cases['required-only'], 'case required only');
eq(normalizeExpanderPicker({ tiles: 'x' as never, arrow: 'y' as never, columns: '9' as never, density: 'huge' as never, animation: 'spin' as never, apply: 'never' as never, preview: 'yes' as never }), cases['unknown-values-fall-back'], 'case unknown values');
eq(normalizeExpanderPicker({ tiles: 'cards', arrow: 'chevron', columns: 3 as never }), cases['numeric-columns'], 'case numeric columns');
eq(expanderPickerStyle({ tiles: 'chips', arrow: 'none', animation: 'none', density: 'compact', showValue: false }), cases['no-animation'], 'case no animation');
eq(expanderPickerStyle({ tiles: 'swatches', arrow: 'plus', columns: '4', apply: 'first-press', preview: false, divider: true, density: 'roomy', animation: 'slide' }), cases['first-press-divider'], 'case first press + divider');

/* ---- engine rules ---- */
eq(normalizeExpanderPicker(null), EXPANDER_PICKER_DEFAULT, 'missing asset = the default');
eq(normalizeExpanderPicker({ tiles: 'x' as never, arrow: 'y' as never }), EXPANDER_PICKER_DEFAULT, 'unknown values fall back to the default');
eq(normalizeExpanderPicker({ tiles: 'cards', arrow: 'chevron', columns: 3 as never }).columns, '3', 'a numeric columns value is read as its string');
eq(normalizeExpanderPicker({ tiles: 'cards', arrow: 'chevron', preview: 'yes' as never }).preview, true, 'a non-boolean flag takes the default');
const s = expanderPickerStyle({ tiles: 'swatches', arrow: 'plus', columns: '4', apply: 'first-press', preview: false, divider: true, density: 'roomy', animation: 'slide', showValue: false });
eq(s.attrs, { 'data-fx-pick': 'swatches', 'data-fx-pick-arrow': 'plus', 'data-fx-pick-anim': 'slide', 'data-fx-pick-apply': 'first-press', 'data-fx-pick-density': 'roomy', 'data-fx-pick-preview': 'off', 'data-fx-pick-value': 'off', 'data-fx-pick-divider': 'on' }, 'every attribute compiles');
eq(Object.keys(s.vars).sort(), ['--fx-pick-cols', '--fx-pick-dur', '--fx-pick-row-py', '--fx-pick-tile-pad'], 'the four vars');
eq(s.vars['--fx-pick-cols'], 'repeat(4, minmax(0, 1fr))', 'fixed columns');
ok(expanderPickerStyle(null).vars['--fx-pick-cols']!.startsWith('repeat(auto-fill'), 'auto columns fill the width');
eq(expanderPickerStyle({ tiles: 'cards', arrow: 'chevron', animation: 'none' }).vars['--fx-pick-dur'], '0ms', 'animation none = no time');
for (const anim of ['unfold', 'fade', 'slide'] as const) ok(expanderPickerStyle({ tiles: 'cards', arrow: 'chevron', animation: anim }).vars['--fx-pick-dur']!.includes('var(--fx-motion)'), `${anim} reads the motion token (reduced motion sets it to 0ms)`);
for (const v of Object.values(expanderPickerStyle(null).vars)) ok(!/\d+px/.test(v), `no px in ${v}: sizes are token multiples`);
const compact = expanderPickerStyle({ tiles: 'cards', arrow: 'chevron', density: 'compact' }).vars, roomy = expanderPickerStyle({ tiles: 'cards', arrow: 'chevron', density: 'roomy' }).vars;
ok(compact['--fx-pick-row-py'] !== roomy['--fx-pick-row-py'] && compact['--fx-pick-tile-pad'] !== roomy['--fx-pick-tile-pad'], 'density changes the padding');

/* ---- stylesheet ---- */
const css = readFileSync(join(root, 'ui/axf.css'), 'utf8');
for (const sel of ['.fx-pick', '.fx-pick__row', '.fx-pick__arrow', '.fx-pick__sub', '.fx-pick__grid', '.fx-pick__tile', '.fx-pick__swatch', "[data-fx-pick-open='on']", "[data-fx-pick='chips']", "[data-fx-pick='list']", "[data-fx-pick='swatches']", "[data-fx-pick-arrow='caret']", "[data-fx-pick-arrow='plus']", "[data-fx-pick-anim='slide']", "[data-fx-pick-divider='on']", "[data-fx-pick-value='off']", "[data-armed='on']", "[aria-selected='true']"]) ok(css.includes(sel), `axf.css styles ${sel}`);
const start = css.indexOf('/* expander-picker@1 (Nov 13 2026)');
const block = css.slice(start, css.indexOf('\n\n', start + 10));
ok(block.includes('grid-template-rows: 0fr') && block.includes('grid-template-rows: 1fr'), 'the unfold is a 0fr → 1fr grid row (no measuring, pushes content down)');
ok(block.includes('var(--fx-pick-dur)') && block.includes('prefers-reduced-motion'), 'motion reads the picker duration var and stops under reduced motion');
ok(!block.includes('position: absolute') && !block.includes('position: fixed'), 'nothing floats');
// tokens only: no literal colours, no px beyond the hairlines the rest of axf.css draws accents with (pill radii stay 999px by convention)
ok(block.length > 1000 && !/#[0-9a-f]{3,8}\b|rgba?\(|\d+px/i.test(block.replace(/\b(?:[12]|999)px\b/g, '')), 'expander-picker block: no hard-coded colours or px sizes (tokens only)');

/* ---- the control ---- */
const forms = readFileSync(join(root, 'react/components/Forms.tsx'), 'utf8');
ok(!/<select\b/.test(forms), 'Forms.tsx has no native <select> left');
ok(/export function SelectField\b/.test(forms) && forms.includes('<ExpanderPicker'), 'SelectField draws an ExpanderPicker (every caller changed look at once)');
const picker = readFileSync(join(root, 'react/components/ExpanderPicker.tsx'), 'utf8');
for (const need of ['aria-expanded', 'aria-controls', 'role="listbox"', 'role="option"', 'aria-selected', "e.key === 'Escape'", "'ArrowDown'", "'Home'", "'End'", 'useControlTarget', "kind: 'setting'", "can: ['open', 'state', 'set', 'focus', 'press']", 'expanderPickerStyle(', 'onPreview']) ok(picker.includes(need), `ExpanderPicker.tsx: ${need}`);
ok(/firstPress \|\| armed === o\.value/.test(picker), 'one press highlights, the same press again applies (unless the asset says first-press)');
ok(/if \(open\) close\(armed\)/.test(picker), 'pressing the arrow / row again applies the highlighted option and closes');
const index = readFileSync(join(root, 'react/index.ts'), 'utf8');
ok(index.includes("from './components/ExpanderPicker'"), 'react/index.ts exports ExpanderPicker');

console.log(`✓ expander-picker@1: ${checks} checks`);

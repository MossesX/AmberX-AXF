/**
 * themed-controls@1 (core/engines/themed-controls.ts, themed-controls-rules.mjs; spec/THEMED-CONTROLS.md): replays
 * spec/fixtures/themed-controls.json through the reference engine (the Kotlin twin is deferred, spec/PORTING.md), then
 * checks the rules the fixture can't state on its own: the registry entry (optional, shared, skinDefault), the generated
 * schema, control@1 `tokens.controls` listing every field, skin coverage by slot + parts, every shipped skin naming the
 * default asset, the native starter matching the registry defaults, settings semantics, surfaces, props and tokens.
 *   npx -y tsx framework/spec/check-themed-controls.mts
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEMED_CONTROL_FIELDS, THEMED_CONTROLS_FRAME, THEMED_CONTROLS_TYPE, THEMED_FAMILIES, TC_KEYS, TC_STATES, TC_WIDE_SURFACE, activeFamilies, controlProps, dialogProps, familyActive, familyOf, isPhoneViewport, normalizeThemedControls, scrollbarsThemed, shouldTheme, surfaceFor, tcFieldCss, themedControlsChange, themedControlsConfig, themedControlsErrors, themedControlsOutput, type NativeAttrs, type ThemedFamily } from '../core/engines/themed-controls';
import { tcColorFor, tcColorValue, tcFieldErrors, themedControlsTokens } from '../core/engines/themed-controls-rules.mjs';
import { controlPaths, controlValueErrors, CONTROL_TARGETS } from '../core/engines/control-rules.mjs';
import { CONTROL_TOKEN_SLOTS } from '../core/engines/control-tokens.mjs';
import { coverageOf } from '../core/engines/skin-coverage.mjs';
import { SKIN_NEVER, skinDefaults, skinMissingDefaults, upgradeSkin } from '../core/engines/skin-rules.mjs';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
// @ts-expect-error plain .mjs (the build engine's own validator)
import { validateAsset as engineValidate } from '../cli/build-engine.mjs';

const root = new URL('../', import.meta.url).pathname;
const f = JSON.parse(readFileSync(join(root, 'spec/fixtures/themed-controls.json'), 'utf8'));
const spec = JSON.parse(readFileSync(join(root, 'schemas/asset-types.json'), 'utf8'));
const customize = JSON.parse(readFileSync(join(root, 'schemas/customize.json'), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg); checks++; };
const settings = (v: Record<string, unknown>) => (k: string) => v[k] ?? null;

/* ---------- the contract ---------- */
eq(f.contract, THEMED_CONTROLS_FRAME, 'contract'); eq(f.families, THEMED_FAMILIES, 'families'); eq(f.fields, THEMED_CONTROL_FIELDS, 'fields'); eq(f.states, TC_STATES, 'states');
eq(THEMED_FAMILIES, ['checkbox', 'radio', 'range', 'number', 'datetime', 'color', 'dialogs', 'file', 'tooltip', 'scrollbar'], 'the ten families in spec order');
for (const fam of THEMED_FAMILIES) {
  const statesSeen = [...new Set(Object.keys(THEMED_CONTROL_FIELDS).filter((p) => p.startsWith(`${fam}.`) && p.split('.').length === 3).map((p) => p.split('.')[1]))];
  eq(statesSeen, TC_STATES[fam], `${fam}: every declared state has colours and nothing else`);
  ok(Object.keys(THEMED_CONTROL_FIELDS).some((p) => p.startsWith(`${fam}.`) && p.split('.').length === 2), `${fam}: at least one family-wide field`);
}
for (const fam of ['checkbox', 'radio'] as const) eq(TC_STATES[fam], ['rest', 'hover', 'focus', 'active', 'checked', 'disabled', 'invalid'], `${fam}: every interaction state`);
ok(Object.values(THEMED_CONTROL_FIELDS).every((s) => ['color', 'enum', 'number', 'boolean'].includes(s.kind) && s.default !== undefined), 'every field has a kind and a default');
ok(Object.entries(THEMED_CONTROL_FIELDS).filter(([, s]) => s.kind === 'color').every(([, s]) => tcColorValue(s.default) !== undefined), 'every colour default is a token or theme');

/* ---------- registry, schema, types ---------- */
const entry = spec.types[THEMED_CONTROLS_TYPE];
ok(entry && entry.optional === true && entry.shared !== false && entry.hideable === false, 'asset-types.json: optional, shared, not hideable');
eq(entry.skinDefault, 'native', 'asset-types.json: skinDefault = native (the skin upgrader writes it)');
ok(entry.tokens?.prefix === 'tc' && entry.tokens?.rules === 'core/engines/themed-controls-rules.mjs', 'asset-types.json: token prefix + rules file');
ok((ASSET_TYPES as readonly string[]).includes(THEMED_CONTROLS_TYPE) && (OPTIONAL_TYPES as readonly string[]).includes(THEMED_CONTROLS_TYPE), 'types.ts lists it as an optional type');
ok(existsSync(join(root, 'schemas/json/themed-controls.schema.json')), 'JSON schema generated');
const schema = JSON.parse(readFileSync(join(root, 'schemas/json/themed-controls.schema.json'), 'utf8'));
for (const fam of THEMED_FAMILIES) ok(schema.properties.data.properties[fam]?.type === 'object', `schema: ${fam} group`);
ok(schema.properties.data.properties.checkbox.properties.checked.properties.bg.pattern.includes('accent'), 'schema: colour pattern allows tokens and pairs');
ok(existsSync(join(root, 'assets/themed-controls/native.json')), 'the native starter ships');
ok(readFileSync(join(root, 'spec/PORTING.md'), 'utf8').includes('themed-controls@1'), 'PORTING.md records the deferred Android twin');
ok(readFileSync(join(root, 'spec/THEMED-CONTROLS.md'), 'utf8').includes('tokens.controls'), 'the spec names the control@1 target');

/* ---------- starters ---------- */
for (const [id, s] of Object.entries<any>(f.starters)) {
  const a = JSON.parse(readFileSync(join(root, 'assets/themed-controls', `${id}.json`), 'utf8'));
  eq(s.errors, [], `${id}: no engine errors`); ok(s.valid.ok, `${id}: validates`);
  eq(engineValidate(a).ok, true, `${id}: the build engine validator agrees`);
  eq(normalizeThemedControls(a.data), s.normalized, `${id}: normalized as the fixture`);
  eq(themedControlsOutput(a.data, { scheme: 'light', families: THEMED_FAMILIES }), s.light, `${id}: light output as the fixture`);
  eq(themedControlsOutput(a.data, { scheme: 'dark', families: ['checkbox', 'radio'], sheet: false }), s.dark, `${id}: dark output as the fixture`);
}
// the native starter IS today's look: every value it writes equals the registry default, so a theme swap leaves nothing behind
const defaults = normalizeThemedControls({});
eq(normalizeThemedControls(JSON.parse(readFileSync(join(root, 'assets/themed-controls/native.json'), 'utf8')).data), defaults, 'native = the registry defaults');
eq(f.starters.native.light.attrs['data-fx-tc'], 'on', 'native: root says on when families are active');
eq(f.starters.native.dark.attrs['data-fx-tc-families'], 'checkbox radio', 'root lists the active families');
eq(f.starters.native.dark.attrs['data-fx-tc-sheet'], 'off', 'root carries the sheet switch');
eq(f.starters.native.light.vars['--fx-tc-checkbox-checked-bg'], 'var(--fx-accent)', 'native: checked checkbox is the accent (today\'s accent-color)');
eq(f.starters.native.light.vars['--fx-tc-checkbox-size'], 'calc(var(--fx-font-size) * 16 / 14)', 'native: checkbox size is today\'s 16 / 14 em');
ok(!('--fx-tc-checkbox-hover-bg' in f.starters.native.light.vars), 'theme colours compile to nothing');
ok(Object.values(f.starters.native.light.vars).every((v) => typeof v === 'string' && !/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i.test(v)), 'no literal colour in any compiled token');

/* ---------- settings ---------- */
for (const c of f.config) { const cfg = themedControlsConfig(settings(c.settings)); eq(cfg, c.config, `config: ${c.name}`); eq(activeFamilies(cfg), c.active, `active: ${c.name}`); }
const all = themedControlsConfig(settings({}));
eq(activeFamilies(all), THEMED_FAMILIES, 'everything on by default');
eq(activeFamilies(themedControlsConfig(settings({ [TC_KEYS.on]: false }))), [], 'master off = nothing active');
ok(!familyActive(themedControlsConfig(settings({ [TC_KEYS.family('checkbox')]: false })), 'checkbox') && familyActive(themedControlsConfig(settings({ [TC_KEYS.family('checkbox')]: false })), 'radio'), 'a family switch is that family only');
eq(TC_KEYS.family('datetime'), 'axf.themedControls.datetime', 'family key');
for (const c of f.changes) eq(themedControlsChange(c.what, c.on), c.change, `change: ${c.what}`);
assert.throws(() => themedControlsChange('picker' as ThemedFamily, true), 'change refuses an unknown family'); checks++;

/* ---------- surfaces ---------- */
for (const s of f.surfaces) {
  eq(Object.fromEntries(THEMED_FAMILIES.map((fam) => [fam, surfaceFor(fam, s.viewport, all)])), s.sheetOn, `surfaces (sheet on): ${s.name}`);
  eq(Object.fromEntries(THEMED_FAMILIES.map((fam) => [fam, surfaceFor(fam, s.viewport, { sheet: false })])), s.sheetOff, `surfaces (sheet off): ${s.name}`);
  eq(scrollbarsThemed(all, s.viewport), s.scrollbars, `scrollbars: ${s.name}`);
}
ok(isPhoneViewport({ width: 760 }) && !isPhoneViewport({ width: 761 }) && isPhoneViewport({ width: 900, phoneMaxWidth: 1000 }) && !isPhoneViewport({ width: NaN }), 'the phone cut-off is the layout\'s, inclusive, default 760');
eq(surfaceFor('datetime', { width: 390 }, all), 'sheet', 'date picker is a bottom sheet on a phone');
eq(surfaceFor('datetime', { width: 390 }, { sheet: false }), 'popover', 'sheet switch off = popover on a phone');
eq(surfaceFor('dialogs', { width: 390 }, all), 'sheet', 'dialogs are a sheet on a phone');
eq(surfaceFor('dialogs', { width: 1200 }, all), 'modal', 'dialogs are modal when wide');
eq(surfaceFor('tooltip', { width: 390 }, all), 'popover', 'a tooltip is never a sheet');
eq(surfaceFor('checkbox', { width: 390 }, all), 'inline', 'inline families stay inline');
eq(surfaceFor('scrollbar', { width: 390 }, all), 'none', 'scrollbars have no surface');
ok(!scrollbarsThemed(all, { width: 390, coarse: true }) && scrollbarsThemed(all, { width: 390 }), 'themed scrollbars never on touch');
eq(Object.keys(TC_WIDE_SURFACE).sort(), [...THEMED_FAMILIES].sort(), 'every family has a wide surface');

/* ---------- native elements ---------- */
for (const e of f.elements) {
  const fam = familyOf(e.attrs as NativeAttrs);
  eq(fam, e.family, `family: ${e.name}`);
  eq(shouldTheme(fam, e.attrs, all), e.theme, `shouldTheme: ${e.name}`);
  eq(shouldTheme(fam, e.attrs, themedControlsConfig(settings({ [TC_KEYS.on]: false }))), e.themeMasterOff, `shouldTheme master off: ${e.name}`);
  eq(shouldTheme(fam, e.attrs, all, { editable: true }), e.themeInEditable, `shouldTheme in editable: ${e.name}`);
  if (fam) eq(controlProps(fam, e.attrs, e.name === 'checkbox' ? 'I agree' : ''), e.props, `props: ${e.name}`);
}
const byName = Object.fromEntries(f.elements.map((e: any) => [e.name, e]));
ok(byName['checkbox'].props.checked === true && byName['checkbox'].props.required === true && byName['checkbox'].props.label === 'I agree' && byName['checkbox'].props.value === 'on', 'checkbox props: checked, required, label from <label for>, value defaults to on');
ok(byName['checkbox indeterminate aria'].family === 'checkbox' && byName['checkbox indeterminate aria'].props.indeterminate === true && byName['checkbox indeterminate aria'].props.label === 'All rows', 'tag and type match case-insensitively; aria-label wins; indeterminate');
ok(byName['radio'].props.group === 'size' && byName['radio'].props.describedBy === 'size-help', 'radio group = name, describedBy');
eq([byName['range'].props.min, byName['range'].props.max, byName['range'].props.step, byName['range'].props.value], [0, 10, 0, 7], 'range: min/max swapped when reversed, step any = 0, value clamped');
eq([byName['range defaults'].props.min, byName['range defaults'].props.max, byName['range defaults'].props.step, byName['range defaults'].props.value], [0, 100, 1, 50], 'range defaults 0..100 step 1, value the middle');
eq([byName['range bad numbers'].props.min, byName['range bad numbers'].props.step, byName['range bad numbers'].props.value, byName['range bad numbers'].props.orient], [0, 1, 50, 'vertical'], 'range: bad min and step fall back, value clamped to max, vertical kept');
eq([byName['number'].props.min, byName['number'].props.max, byName['number'].props.step, byName['number'].props.inputMode, byName['number'].props.invalid, byName['number'].props.readOnly], [1, 100, 0.5, 'decimal', true, true], 'number: swapped bounds, fractional step = decimal keyboard, aria-invalid, readonly');
eq([byName['number integer'].props.step, byName['number integer'].props.inputMode, byName['number integer'].props.disabled, byName['number integer'].props.min], [1, 'numeric', true, null], 'number: step 0 reads as 1, integer keyboard, no bounds');
eq([byName['date'].props.kind, byName['date'].props.step, byName['date'].props.hour12], ['date', null, null], 'date: no minute step, locale hour cycle');
eq([byName['time'].props.kind, byName['time'].props.step, byName['time'].props.hour12], ['time', 15, false], 'time: step seconds → minutes, hour12 hint');
eq(byName['datetime-local'].props.step, 1, 'datetime-local: a step under a minute is one minute');
ok(byName['month'].props.kind === 'month' && byName['week'].props.kind === 'week', 'month and week kinds');
eq([byName['color'].props.value, byName['color'].props.list, byName['color'].props.alpha], ['#ffaa00', 'brand', false], 'color: lower-case hex, datalist swatches, no alpha');
eq(byName['color bad value'].props.value, '#000000', 'color: a bad value is black (the browser\'s default)');
eq([byName['file'].props.accept, byName['file'].props.multiple, byName['file'].props.capture, byName['file'].props.directory], [['image/png', '.pdf'], true, 'environment', true], 'file: accept list cleaned, multiple, capture, directory');
eq([byName['tooltip'].props.text, byName['tooltip'].props.placement], ['Run the build', 'bottom'], 'tooltip: text from title, placement hint');
eq(byName['tooltip moved'].props.text, 'Saved 2 min ago', 'tooltip: data-axf-tip wins once the title moved');
ok(byName['text input'].family === 'tooltip', 'an input with a title and no swapped type is a tooltip');
ok(byName['plain div'].family === null, 'a plain element is nothing');
ok(byName['opted out'].family === 'checkbox' && byName['opted out'].theme === false, 'data-axf-native keeps it native');
ok(byName['already themed'].theme === false, 'a swapped element is not swapped again');
ok(f.elements.every((e: any) => e.themeMasterOff === false), 'master off: nothing is themed');
ok(f.elements.every((e: any) => e.themeInEditable === false), 'inside contenteditable: nothing is themed');
ok(shouldTheme('checkbox', { tag: 'input', type: 'checkbox' }, all, { nativeAncestor: true }) === false && shouldTheme('checkbox', { tag: 'input', type: 'checkbox' }, all, { insideThemed: true }) === false, 'ancestor opt-outs');
eq(f.dialogs, [dialogProps('alert', 'Saved.'), dialogProps('confirm', 'Delete 3 files?'), dialogProps('prompt', 'Name', 'draft'), dialogProps('prompt', undefined), dialogProps('alert', { toString: () => 'object' })], 'dialog props as the fixture');
ok(f.dialogs[0].cancel === null && f.dialogs[1].cancel === 'Cancel' && f.dialogs[2].defaultValue === 'draft' && f.dialogs[3].message === '' && f.dialogs[4].message === 'object', 'alert has no cancel, prompt keeps its default, message is a string');

/* ---------- tokens ---------- */
eq(themedControlsOutput({}), f.output.empty, 'output: empty');
eq(themedControlsOutput({ checkbox: { rest: { bg: 'surface|surface2' }, checked: { bg: 'accent|info' } } }, { scheme: 'dark' }), f.output.pair, 'output: pairs on dark');
eq(f.output.pair.vars['--fx-tc-checkbox-rest-bg'], 'var(--fx-surface2)', 'a light|dark pair picks the dark side on a dark theme');
eq(f.output.pair.vars['--fx-tc-checkbox-checked-bg'], 'var(--fx-info)', 'pair: checked bg dark side');
eq(f.output.pairLight.vars['--fx-tc-checkbox-rest-bg'], 'var(--fx-surface)', 'and the light side on a light theme');
eq(tcColorFor('surface|surface2', 'dark'), 'surface2', 'tcColorFor dark'); eq(tcColorFor('surface|surface2'), 'surface', 'tcColorFor default light'); eq(tcColorFor('#fff', 'dark'), 'theme', 'a bad colour reads as theme');
eq(f.output.scalars.vars['--fx-tc-checkbox-size'], 'calc(var(--fx-font-size) * 20 / 14)', 'px14 sizes scale with the font size');
eq(f.output.scalars.vars['--fx-tc-checkbox-radius'], '999px', 'pill radius');
eq(f.output.scalars.vars['--fx-tc-checkbox-border-width'], '2px', 'border width');
eq(f.output.scalars.vars['--fx-tc-range-show-value'], 'always', 'enum as a var');
eq(f.output.scalars.attrs['data-fx-tc-range-show-value'], 'always', 'enum as a root attribute too');
eq(f.output.scalars.vars['--fx-tc-range-ticks'], '0', 'boolean off = 0');
eq(f.output.scalars.vars['--fx-tc-tooltip-delay-ms'], '0ms', 'ms unit');
eq(f.output.scalars.vars['--fx-tc-scrollbar-width'], '6px', 'px unit');
eq(f.output.scalars.vars['--fx-tc-scrollbar-thin'], '1', 'boolean on = 1');
eq(f.output.scalars.attrs['data-fx-tc-scrollbar-gutter'], 'stable', 'gutter attribute');
ok(!('--fx-tc-number-radius' in f.output.scalars.vars) && !('--fx-tc-number-border-width' in f.output.scalars.vars), 'theme radius / border compile to nothing');
eq(tcFieldCss('checkbox.radius', 'sm'), 'var(--fx-radius-sm)', 'radius sm reads the theme radius');
eq(tcFieldCss('nope.field', 1), '', 'unknown field compiles to nothing');
ok(Object.keys(f.output.empty.vars).every((k) => k.startsWith('--fx-tc-')), 'every token is --fx-tc-*');
ok(Object.keys(f.output.empty.vars).length > 100, `the defaults compile to many tokens (${Object.keys(f.output.empty.vars).length})`);

/* ---------- normalize + errors ---------- */
for (const n of f.normalize) eq(normalizeThemedControls(n.raw), n.out, `normalize: ${n.name}`);
for (const e of f.errors) eq(themedControlsErrors(e.raw), e.errors, `errors: ${e.name}`);
eq(normalizeThemedControls(null), defaults, 'null normalizes to the defaults');
const badErrors = Object.fromEntries(f.errors.map((e: any) => [e.name, e.errors]));
ok(badErrors['bad values'].some((e: string) => e.startsWith('checkbox.size:')) && badErrors['bad values'].some((e: string) => e.startsWith('checkbox.rest.bg:')) && badErrors['bad values'].some((e: string) => e.startsWith('checkbox.checked.mark:')) && badErrors['bad values'].some((e: string) => e.startsWith('scrollbar.width:')) && badErrors['bad values'].some((e: string) => e.startsWith('dialogs.okTone:')), 'errors name the field: out-of-range size, literal colour, half pair, bad number, bad enum');
eq(badErrors['unknown family and fields'], [], 'unknown families and fields are dropped, never an error');
eq(normalizeThemedControls({ picker: {}, checkbox: { glow: 'accent' } }).checkbox, defaults.checkbox, 'unknown fields do not survive normalize');
for (const fe of f.fieldErrors) eq(tcFieldErrors(fe.path, fe.value), fe.errors, `fieldErrors: ${fe.path} = ${JSON.stringify(fe.value)}`);

/* ---------- control@1 tokens.controls ---------- */
ok(CONTROL_TARGETS['tokens.controls']?.asset === THEMED_CONTROLS_TYPE && CONTROL_TARGETS['tokens.controls']?.paths === 'static', 'control@1 target tokens.controls on the themed-controls slot');
eq(CONTROL_TOKEN_SLOTS['tokens.controls'], { slot: THEMED_CONTROLS_TYPE, key: 'axf.tokens.controls', root: '' }, 'tokens.controls settings key');
const paths = controlPaths('tokens.controls')!;
eq(paths.map((p: any) => p.id), Object.keys(THEMED_CONTROL_FIELDS), 'control list names every field in registry order');
eq(paths.find((p: any) => p.id === 'checkbox.checked.bg')?.token, '--fx-tc-checkbox-checked-bg', 'each path names its CSS token');
eq(controlValueErrors('tokens.controls', 'checkbox.checked.bg', 'success'), [], 'set a colour token');
eq(controlValueErrors('tokens.controls', 'checkbox.checked.bg', 'surface|surface2'), [], 'set a light|dark pair');
ok(controlValueErrors('tokens.controls', 'checkbox.checked.bg', '#00ff00').length === 1, 'a literal colour is refused');
ok(controlValueErrors('tokens.controls', 'scrollbar.width', 99).length === 1, 'out of range refused');
ok(controlValueErrors('tokens.controls', 'nope', 1).length === 1, 'unknown path refused');
eq(themedControlsTokens().length, Object.keys(THEMED_CONTROL_FIELDS).length, 'token list = field list');

/* ---------- skins ---------- */
const row = coverageOf(THEMED_CONTROLS_TYPE, spec.types, customize.targets, SKIN_NEVER);
ok(row.by === 'slot' && row.also.includes('parts'), 'skin coverage: slot + parts');
eq(row.elements, ['box', 'text', 'icon', 'items'], 'style target .fx-tc with items');
eq(customize.targets[THEMED_CONTROLS_TYPE], { root: '.fx-tc', item: '.fx-tc__item' }, 'customize.json style target');
eq(skinDefaults(spec.types)[THEMED_CONTROLS_TYPE], 'native', 'skinDefaults reads the registry');
const skins: { id: string; data: { assets?: Record<string, string> } }[] = readdirSync(join(root, 'assets/skin')).filter((x: string) => x.endsWith('.json')).map((x: string) => JSON.parse(readFileSync(join(root, 'assets/skin', x), 'utf8')));
ok(skins.length >= 5 && skins.every((s) => s.data.assets?.[THEMED_CONTROLS_TYPE] === 'native'), 'every shipped skin names the native themed-controls asset');
ok(skins.every((s) => skinMissingDefaults(s.data, spec.types).length === 0), 'the upgrader has nothing left to add');
const up = upgradeSkin({ colorTheme: 'fresh-light', assets: { button: 'soft' } }, spec.types);
eq(up.added, [THEMED_CONTROLS_TYPE], 'upgradeSkin adds the missing default');
eq(up.data.assets, { button: 'soft', [THEMED_CONTROLS_TYPE]: 'native' }, 'upgradeSkin keeps the other assets');
const same = { assets: { [THEMED_CONTROLS_TYPE]: 'studio' } };
ok(upgradeSkin(same, spec.types).data === same && upgradeSkin(same, spec.types).added.length === 0, 'a skin naming its own asset is left as it is');
eq(skinDefaults({ skin: { skinDefault: 'x' }, 'themed-controls': { skinDefault: 'native' }, bad: { skinDefault: 'Not An Id' } }), { 'themed-controls': 'native' }, 'skinDefaults skips never-types and bad ids');
ok(skins.every((s) => validateAsset(s as never).ok), 'every skin still validates');

console.log(`✓ themed-controls@1 — ${checks} checks`);

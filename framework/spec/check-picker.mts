/**
 * picker@1 (core/engines/picker.ts, spec/PICKER.md): replays spec/fixtures/picker.json through the reference engine (the
 * Kotlin twin is deferred, spec/PORTING.md), then checks the invariants the dialog and the voice layer rely on: a model
 * is bounded and its value always known + enabled, filtering never invents an option, the keyboard never lands on a
 * disabled row and never wraps, single mode closes on Enter and keeps one value, multiple mode toggles and honours max,
 * a spoken name resolves to one option or says it is ambiguous, ids are addressable.
 *   npx -y tsx framework/spec/check-picker.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { PICKER_ASSET_DEFAULT, PICKER_TOKENS, PICKER_TOKEN_STATES, normalizePickerAsset, pickerAssetErrors, pickerAttrs, pickerStyle, pickerVars, styleThemeVars, colorThemeVars } from '../core/engines/theme';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
import { PICKER_DEFAULT_STARTER, PICKER_PART_SOURCES, PICKER_PART_TOKENS, PICKER_STARTER_FOR, SKIN_UPGRADE_CONTRACT, pickPickerStarter, pickerPartsFor, skinUpgradeGaps, upgradeSkin } from '../core/engines/skin-upgrade.mjs';
import { customizableTypes, customTokensFor } from '../core/engines/customize';
import { partElements, skinPartsTypes, skinErrors, normalizeSkin } from '../core/engines/skin';
import spec from '../schemas/customize.json';
import { validateAsset } from '../core/validate';
import { PICKER_CONTRACT, PICKER_LIMITS, PICKER_PAGE, PICKER_SEARCH_THRESHOLD, PICKER_TRIGGER_LABELS, PICKER_TYPEAHEAD_MS, choosePicker, cleanValue, closePicker, filterOptions, foldText, fromNativeOptions, groupOptions, matchByName, matchByPosition, matchSpoken, moveActive, normalizePicker, openPicker, pickerIdOf, pickerKey, searchShown, selectedLabels, setQuery, setValue, triggerText, typeAhead, uniquePickerId, type PickerKey, type PickerModel, type PickerState } from '../core/engines/picker';

const root = new URL('../', import.meta.url).pathname;
const f = JSON.parse(readFileSync(join(root, 'spec/fixtures/picker.json'), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg); checks++; };

// ---- fixture replay (regenerate with: npx -y tsx framework/spec/gen-fixtures.mts) ----
eq(f.contract, PICKER_CONTRACT, 'contract');
eq(f.constants, { limits: PICKER_LIMITS, searchThreshold: PICKER_SEARCH_THRESHOLD, typeaheadMs: PICKER_TYPEAHEAD_MS, page: PICKER_PAGE, triggerLabels: PICKER_TRIGGER_LABELS }, 'constants');
for (const [name, c] of Object.entries(f.normalize as Record<string, { raw: unknown; model: PickerModel }>)) eq(normalizePicker(c.raw), c.model, `normalize ${name}`);
for (const [name, c] of Object.entries(f.native as Record<string, { raw: unknown; model: PickerModel }>)) eq(fromNativeOptions(c.raw as never), c.model, `native ${name}`);
const M = f.normalize.themes.model as PickerModel;
const MULTI = f.normalize.multi.model as PickerModel;
for (const [q, want] of Object.entries(f.filter as Record<string, unknown>)) eq(filterOptions(M, q), want, `filter "${q}"`);
eq(groupOptions(M), f.grouped.all, 'grouped all'); eq(groupOptions(M, filterOptions(M, f.grouped.query)), f.grouped.filtered, 'grouped filtered');
eq(f.searchShown, { themes: searchShown(M), multi: searchShown(MULTI), always: searchShown(normalizePicker({ options: ['a'], searchThreshold: 0 })), never: searchShown(normalizePicker({ options: ['a', 'b'], searchThreshold: 'never' })) }, 'search shown');
for (const [name, c] of Object.entries(f.choose as Record<string, { base: PickerModel; value: string; out: unknown }>)) eq(choosePicker(c.base, c.value), c.out, `choose ${name}`);
for (const [name, c] of Object.entries(f.setValue as Record<string, { base: PickerModel; value: unknown; out: unknown }>)) eq(setValue(c.base, c.value as never), c.out, `setValue ${name}`);
for (const [name, c] of Object.entries(f.trigger as Record<string, { model: PickerModel; text: string; labels: string[] }>)) { eq(triggerText(c.model), c.text, `trigger ${name}`); eq(selectedLabels(c.model), c.labels, `labels ${name}`); }
eq(openPicker(M), f.state.open, 'open'); eq(closePicker(openPicker(M)), f.state.closed, 'closed');
eq(setQuery(M, openPicker(M), f.state.queryText), f.state.query, 'setQuery');
{
  let s = openPicker(M); const trail: unknown[] = [];
  for (const k of f.state.keys as PickerKey[]) { const r = pickerKey(M, s, k, false); s = r.state; trail.push({ key: k, active: s.active, label: s.filtered[s.active]?.label ?? null, effect: r.effect, value: r.model.value }); }
  eq(trail, f.state.trail, 'keyboard trail');
}
eq(typeAhead(openPicker(M), 'm'), f.state.typeahead.m, 'type-ahead m'); eq(typeAhead(typeAhead(openPicker(M), 'f'), 'r'), f.state.typeahead.fr, 'type-ahead fr');
eq(pickerKey(M, openPicker(M), 'Enter', false), f.state.enterSingle, 'Enter single'); eq(pickerKey(MULTI, openPicker(MULTI), 'Enter', false), f.state.enterMulti, 'Enter multi');
eq(pickerKey(M, openPicker(M), 'Escape', false), f.state.escape, 'Escape'); eq(pickerKey(M, openPicker(M), 'x', true), f.state.typeIntoSearch, 'a letter goes to the search field');
for (const [spoken, want] of Object.entries(f.names as Record<string, unknown>)) eq(matchByName(M, spoken), want, `name "${spoken}"`);
for (const [spoken, want] of Object.entries(f.positions as Record<string, unknown>)) eq(matchByPosition(M.options, spoken), want, `position "${spoken}"`);
for (const [spoken, want] of Object.entries(f.spoken as Record<string, unknown>)) eq(matchSpoken(M, spoken, setQuery(M, openPicker(M), f.spokenQuery)), want, `spoken "${spoken}"`);
for (const [raw, want] of Object.entries(f.ids as Record<string, string>)) eq(pickerIdOf(raw), want, `id ${raw}`);
eq(f.uniqueIds, ['theme', 'theme-2', 'theme-3'].map((_, i, all) => uniquePickerId('theme', all.slice(0, i))), 'unique ids');
eq(f.fold, Object.fromEntries(Object.keys(f.fold).map((k) => [k, foldText(k)])), 'fold');

// ---- § 3 tokens: fixture replay ----
const T = f.tokens;
eq(T.registry, PICKER_TOKENS, 'token registry'); eq(T.states, PICKER_TOKEN_STATES, 'token states'); eq(T.assetDefault, PICKER_ASSET_DEFAULT, 'asset default');
eq(T.defaults, pickerStyle(null), 'default vars + attrs (today\'s drop-down)');
const starterFiles = readdirSync(join(root, 'assets/picker')).filter((n) => n.endsWith('.json'));
eq(Object.keys(T.starters).sort(), starterFiles.map((n) => n.slice(0, -5)).sort(), 'every starter in the fixture');
for (const [id, c] of Object.entries(T.starters as Record<string, { data: unknown; style: unknown }>)) {
  const a = JSON.parse(readFileSync(join(root, 'assets/picker', `${id}.json`), 'utf8'));
  eq(a.data, c.data, `starter ${id} data current`); eq(pickerStyle(a.data), c.style, `starter ${id} style`);
  eq(validateAsset(a).errors, [], `starter ${id} validates`); eq(normalizePickerAsset(a.data), a.data, `starter ${id} is complete and canonical`);
}
for (const [d, want] of Object.entries(T.density as Record<string, unknown>)) eq(Object.fromEntries(Object.entries(pickerVars({ density: d as never })).filter(([k]) => k.includes('option-pad'))), want, `density ${d}`);
eq(T.normalize, { junk: normalizePickerAsset({ variant: 'popover', search: 'maybe', searchThreshold: 999, checkmarks: 'middle', descriptions: 'yes', density: 'huge', doneButton: 0 }), partial: normalizePickerAsset({ variant: 'sheet', searchThreshold: 3.6 }), none: normalizePickerAsset(undefined) }, 'normalize asset');
eq(T.errors, { good: pickerAssetErrors(PICKER_ASSET_DEFAULT), bad: pickerAssetErrors({ searchThreshold: -1, descriptions: 'yes', doneButton: 1 }), notObject: pickerAssetErrors([]) }, 'asset errors');

// ---- § 3 tokens: invariants ----
{
  ok(ASSET_TYPES.includes('picker') && OPTIONAL_TYPES.includes('picker'), 'picker is a registered, optional asset type');
  ok(ASSET_TYPES.indexOf('picker') === ASSET_TYPES.indexOf('slider') + 1, 'picker sits with the controls (after slider), same order as asset-types.json');
  const names = PICKER_TOKENS.map((t) => t.name);
  ok(new Set(names).size === names.length && names.every((n) => /^--fx-picker-[a-z0-9-]+$/.test(n)), 'token names unique, all --fx-picker-*');
  eq(Object.keys(pickerVars(null)).sort(), [...names].sort(), 'pickerVars writes every registry token and nothing else');
  for (const s of PICKER_TOKEN_STATES) ok(PICKER_TOKENS.some((t) => t.state === s), `a token draws the ${s} state`);
  for (const g of ['surface', 'header', 'search', 'option', 'group', 'sheet', 'shape', 'spacing', 'type', 'size', 'motion']) ok(PICKER_TOKENS.some((t) => t.group === g), `the ${g} group has a token`);
  // every default reads the token system: no literal colour, no px / em / rem / literal font, every var() it names exists
  const known = new Set<string>([...names, ...Object.keys(styleThemeVars({ fontFamily: 'a', fontDisplay: 'a', fontMono: 'a', fontSize: 14, radius: { sm: 1, md: 2, lg: 3 }, space: 8, borderWidth: 1, shadow: { sm: 'a', md: 'b', lg: 'c' }, motion: 1, blur: 1, headingWeight: 1, tracking: 0, density: 'comfortable' } as never)), ...Object.keys(colorThemeVars({ tokens: { bg: '', surface: '', surface2: '', surface3: '', text: '', muted: '', border: '', accent: '', accentText: '', accentSoft: '', danger: '', success: '', warning: '', info: '', focus: '', shadow: '' } } as never))]);
  for (const t of PICKER_TOKENS) {
    ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(white|black|red|blue|gray|grey)\b/i.test(t.default), `${t.name} has no literal colour`);
    ok(!/\d(px|em|rem)\b/.test(t.default), `${t.name} has no literal size`);
    for (const m of t.default.matchAll(/var\((--fx-[a-z0-9-]+)\)/g)) ok(known.has(m[1]!) || /^--fx-(dens|type|size)-/.test(m[1]!), `${t.name} reads a known token (${m[1]})`);
    ok(/var\(--fx-|transparent|dvh/.test(t.default), `${t.name} reads the token system`);
  }
  // density only moves the row padding; everything else is identical
  const [c, r, ro] = (['compact', 'regular', 'roomy'] as const).map((d) => pickerVars({ density: d }));
  for (const n of names) if (!n.includes('option-pad')) ok(c![n] === r![n] && r![n] === ro![n], `${n} does not change with density`);
  ok(c!['--fx-picker-option-pad-y'] !== ro!['--fx-picker-option-pad-y'], 'density changes the row padding');
  eq(pickerVars(null), pickerVars(PICKER_ASSET_DEFAULT), 'no asset = the default asset');
  // the asset's choices land as root attributes the picker reads; search = the threshold in auto mode
  eq(pickerAttrs({ search: 'auto', searchThreshold: 12 })['data-fx-picker-search'], '12', 'auto search carries the threshold');
  eq(pickerAttrs({ search: 'never' })['data-fx-picker-search'], 'never', 'never stays never');
  ok(validateAsset({ $axf: 'asset@1', type: 'picker', id: 'x', name: 'X', version: '1', data: { ...PICKER_ASSET_DEFAULT, variant: 'popover' } }).errors.length > 0, 'a bad enum is refused');
  ok(validateAsset({ $axf: 'asset@1', type: 'picker', id: 'x', name: 'X', version: '1', data: { ...PICKER_ASSET_DEFAULT, searchThreshold: 500 } }).errors.length > 0, 'a threshold past the cap is refused');
}

// ---- skin-upgrade@1 + the picker style target: fixture replay ----
const U = f.skinUpgrade;
eq(U.contract, SKIN_UPGRADE_CONTRACT, 'upgrade contract'); eq(U.defaultStarter, PICKER_DEFAULT_STARTER, 'default starter'); eq(U.starterFor, PICKER_STARTER_FOR, 'starter by trait'); eq(U.partTokens, PICKER_PART_TOKENS, 'part tokens'); eq(U.partSources, PICKER_PART_SOURCES, 'part sources');
eq(U.starters, starterFiles.map((n) => n.slice(0, -5)).sort(), 'the starters the upgrader picks from ship');
for (const [name, c] of Object.entries(U.cases as Record<string, { skin: unknown; ctx: unknown; pick: string; parts: unknown; gapsBefore: string[]; out: unknown; gapsAfter: string[] }>)) {
  eq(pickPickerStarter(c.skin, c.ctx as never), c.pick, `upgrade ${name} pick`); eq(pickerPartsFor(c.skin), c.parts, `upgrade ${name} parts`);
  eq(skinUpgradeGaps(c.skin), c.gapsBefore, `upgrade ${name} gaps before`); eq(upgradeSkin(c.skin, c.ctx as never), c.out, `upgrade ${name}`); eq(c.gapsAfter, [], `upgrade ${name} leaves no gap`);
}
for (const [id, s] of Object.entries(U.shipped as Record<string, { picker: string; parts: unknown; gaps: string[]; unchanged: string[] }>)) {
  const a = JSON.parse(readFileSync(join(root, 'assets/skin', `${id}.json`), 'utf8'));
  eq(a.data.assets?.picker ?? '', s.picker, `shipped skin ${id} names its picker`); eq(a.data.parts?.picker ?? null, s.parts, `shipped skin ${id} parts current`);
  eq(s.gaps, [], `shipped skin ${id} has no gap`); eq(s.unchanged, [], `shipped skin ${id} is already upgraded (idempotent)`);
  ok(starterFiles.includes(`${s.picker}.json`), `shipped skin ${id} names a picker that ships`); eq(skinErrors(a.data), [], `shipped skin ${id} validates with its picker parts`);
}

// ---- skin-upgrade@1 + style target: invariants ----
{
  // the picker style target: skin-coverage@1 reaches the picker's box / text / icon / items; itemPadding applies to it
  const target = (spec as { targets: Record<string, unknown> }).targets.picker;
  eq(partElements(target), ['box', 'text', 'icon', 'items'], 'picker style target reaches box, text, icon and items');
  ok(customizableTypes().includes('picker') && skinPartsTypes().includes('picker'), 'picker is customizable and a skin may style its parts');
  ok(customTokensFor('picker').some((t) => t.key === 'itemPadding') && customTokensFor('picker').some((t) => t.key === 'hover'), 'row padding and hover tokens reach the picker');
  // the upgrader never changes what a skin already says, is idempotent, and every pick ships
  for (const c of Object.values(U.cases as Record<string, { skin: unknown; ctx: unknown; out: { data: Record<string, unknown>; changed: string[] } }>)) {
    const before = (c.skin ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(before)) if (k !== 'assets' && k !== 'parts') eq(c.out.data[k], v, 'other fields untouched');
    for (const [k, v] of Object.entries((before.assets ?? {}) as Record<string, unknown>)) if (k !== 'picker' || /^[a-z0-9][a-z0-9-]{1,47}$/.test(String(v))) eq((c.out.data.assets as Record<string, unknown>)[k], v, `slot ${k} untouched`);
    eq(upgradeSkin(c.out.data, c.ctx as never), { data: c.out.data, changed: [] }, 'idempotent');
    ok(U.starters.includes((c.out.data.assets as Record<string, string>).picker) || !(c.ctx as { starters?: string[] }).starters?.length, 'the pick ships');
    const parts = (c.out.data.parts as Record<string, Record<string, unknown>> | undefined)?.picker;
    if (parts) ok(Object.keys(parts).every((k) => PICKER_PART_TOKENS.includes(k)), 'only row-safe tokens are carried over');
    if (parts) eq(skinErrors({ layoutTheme: 'l', colorTheme: 'c', styleTheme: 's', assets: {}, parts: { picker: parts } }), [], 'carried parts validate');
  }
  ok(normalizeSkin({ layoutTheme: 'l', colorTheme: 'c', styleTheme: 's', assets: { picker: 'standard' } }).assets.picker === 'standard', 'picker is a skin slot');
}

// ---- invariants ----
{
  // a model is bounded; its value is always known, enabled and unique; single mode holds one value at most
  const big = normalizePicker({ options: Array.from({ length: 5000 }, (_, i) => ({ value: `v${i}`, label: `Option ${i}`, group: `g${i % 300}` })), groups: Array.from({ length: 300 }, (_, i) => `g${i}`), value: ['v1', 'v1', 'v9999'] });
  ok(big.options.length === PICKER_LIMITS.options && big.groups.length <= PICKER_LIMITS.groups, 'option and group caps hold');
  ok(big.options.every((o) => !o.group || big.groups.some((g) => g.id === o.group)), 'no option names a dropped group');
  eq(big.value, ['v1'], 'single mode keeps one known value');
  for (const m of [M, MULTI, big]) {
    const enabled = new Set(m.options.filter((o) => !o.disabled).map((o) => o.value));
    ok(m.value.every((v) => enabled.has(v)) && new Set(m.value).size === m.value.length, `value of ${m.id} is known, enabled, unique`);
    ok(new Set(m.options.map((o) => o.value)).size === m.options.length, `values of ${m.id} unique`);
    eq(cleanValue(m, [...m.value, ...m.value, 'nope']), m.value, `cleanValue is idempotent for ${m.id}`);
  }
  // filtering never invents an option and keeps disabled ones visible; an empty query is the whole model in order
  for (const q of ['', 'fre', 'dark', 'zzz', 'print', 'Night']) {
    const list = filterOptions(M, q);
    ok(list.every((o) => M.options.some((x) => x.value === o.value)), `filter "${q}" is a subset`);
    if (!q) eq(list.map((o) => o.value), M.options.map((o) => o.value), 'empty query = model order');
    else ok(list.every((o, i) => i === 0 || list[i - 1]!.score >= o.score), `filter "${q}" sorted by score`);
    const groups = groupOptions(M, list);
    eq(groups.flatMap((g) => g.options.map((o) => o.value)).sort(), list.map((o) => o.value).sort(), `grouping "${q}" loses nothing`);
    ok(groups.every((g) => g.options.length), `grouping "${q}" has no empty group`);
  }
  // the keyboard never lands on a disabled row and never wraps
  let s: PickerState = openPicker(M);
  const disabled = new Set(M.options.filter((o) => o.disabled).map((o) => o.value));
  for (const k of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'PageUp', 'End', 'Home', 'ArrowUp'] as const) {
    s = pickerKey(M, s, k, false).state;
    ok(s.active >= 0 && !disabled.has(s.filtered[s.active]!.value), `${k} lands on an enabled row`);
  }
  eq(s.active, moveActive(s, 'home').active, 'ArrowUp at the top stays (no wrap)');
  eq(moveActive(moveActive(s, 'end'), 1).active, moveActive(s, 'end').active, 'ArrowDown at the end stays (no wrap)');
  eq(moveActive({ ...s, filtered: [] }, 1).active, -1, 'nothing to move to');
  // single mode: Enter chooses one and closes; Escape closes with the value untouched
  const single = pickerKey(M, moveActive(openPicker(M), 'end'), 'Enter', false);
  ok(single.effect === 'close' && !single.state.open && single.model.value.length === 1, 'Enter in single mode chooses one and closes');
  const esc = pickerKey(M, moveActive(openPicker(M), 'end'), 'Escape', false);
  ok(esc.effect === 'close' && esc.model === M, 'Escape leaves the model alone');
  // multiple mode: Enter toggles and stays open; max refuses the extra
  let mm = MULTI; let ms = openPicker(mm); const before = ms.active;
  const r1 = pickerKey(mm, ms, 'Enter', false); mm = r1.model; ms = r1.state;
  ok(r1.effect === 'choose' && ms.open && ms.active === before, 'Enter in multiple mode toggles and stays');
  const r2 = pickerKey(mm, ms, 'Enter', false);
  ok(r2.effect === 'choose' && JSON.stringify(r2.model.value) === JSON.stringify(MULTI.value) && Math.abs(mm.value.length - MULTI.value.length) === 1, 'Enter again toggles back: a round trip');
  const full = { ...MULTI, value: cleanValue(MULTI, MULTI.options.filter((o) => !o.disabled).slice(0, MULTI.max).map((o) => o.value)) };
  const extra = MULTI.options.filter((o) => !o.disabled && !full.value.includes(o.value))[0]!;
  eq(choosePicker(full, extra.value), { model: full, changed: false }, 'max refuses the extra value');
  ok(choosePicker(full, full.value[0]!).changed, 'a toggle off is always allowed');
  ok(!choosePicker(M, M.options.find((o) => o.disabled)!.value).changed, 'a disabled option is never chosen');
  // a spoken name resolves to one option or says it is ambiguous; a disabled option never matches
  for (const o of M.options) {
    const m = matchByName(M, o.label);
    if (o.disabled) ok(!m.option, `disabled "${o.label}" never matches`);
    else ok(m.option?.value === o.value && m.confidence === 1, `label "${o.label}" matches itself`);
  }
  ok(matchByName(M, 'fresh').option === null && (matchByName(M, 'fresh') as { ambiguous: string[] }).ambiguous.length === 2, 'two prefixes tie → ambiguous');
  ok(matchByName(M, '').option === null, 'nothing spoken → nothing');
  ok(matchByPosition(M.options, 'the ninety-ninth one') === null && matchByPosition(M.options, 'hello') === null, 'no position → null');
  // ids are addressable: slug, stable, unique
  for (const id of Object.values(f.ids as Record<string, string>)) ok(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id), `id ${id} is addressable`);
  eq(pickerIdOf(pickerIdOf('Colour theme!')), pickerIdOf('Colour theme!'), 'slugging is idempotent');
  // the trigger says the placeholder, the first option or the chosen labels with +N
  const many = normalizePicker({ options: ['A', 'B', 'C', 'D', 'E'], multiple: true, value: ['A', 'B', 'C', 'D', 'E'] });
  eq(triggerText(many), 'A, B, C +2', 'trigger +N');
  eq(triggerText({ ...many, value: [] }), '', 'multiple with nothing chosen and no placeholder says nothing');
}
console.log(`check-picker: ${checks} checks passed`);

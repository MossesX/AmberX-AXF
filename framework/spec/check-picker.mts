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

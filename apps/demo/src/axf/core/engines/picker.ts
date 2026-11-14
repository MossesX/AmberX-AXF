/**
 * Picker engine (picker@1, Nov 14 2026; spec/PICKER.md). Brett: "I want a plugin that replaces all drop down select
 * boxes with a themable dialogue that matches the theme; skins have to touch them; they must conform to the token
 * system".
 *
 * One model for every drop-down: options, groups, icons, descriptions, single or multiple, search threshold, value and
 * labels. The engine normalises a model from any list (a native <select>'s options included), filters it by a search,
 * groups it for drawing, chooses / toggles values, runs the open / search / move / choose / close state and the keyboard
 * rules, and matches a spoken name to an option for voice. Pure: no DOM, no runtime; the React picker and the swap
 * plugin call it, every port replays spec/fixtures/picker.json (spec/check-picker.mts). Kotlin twin deferred
 * (spec/PORTING.md).
 */

export const PICKER_CONTRACT = 'picker@1';
/** Caps a model is cut to (junk in, a bounded model out). */
export const PICKER_LIMITS = { options: 2000, groups: 100, label: 160, description: 300, keywords: 24, keyword: 60, value: 400, id: 120 } as const;
/** The search field appears when a picker has at least this many options (a model may say otherwise). */
export const PICKER_SEARCH_THRESHOLD = 8;
/** The host clears pending type-ahead letters this long after the last one. */
export const PICKER_TYPEAHEAD_MS = 700;
/** PageUp / PageDown move this many rows. */
export const PICKER_PAGE = 10;
/** The trigger shows this many chosen labels before "+N". */
export const PICKER_TRIGGER_LABELS = 3;

export interface PickerOption {
  value: string;
  label: string;
  description?: string;
  icon?: string;
  group?: string;
  disabled?: boolean;
  keywords?: string[];
}
export interface PickerGroup { id: string; label: string }
export interface PickerModel {
  id: string;
  label: string;
  options: PickerOption[];
  groups: PickerGroup[];
  multiple: boolean;
  value: string[];
  searchThreshold: number;
  placeholder: string;
  emptyLabel: string;
  max: number;
}

/** What a native <select> holds, row by row; the caller reads the DOM, the engine never does. */
export interface NativeOptionRow {
  value?: unknown;
  text?: unknown;
  selected?: unknown;
  disabled?: unknown;
  /** the <optgroup> label the option sits in ('' / absent = none) */
  group?: unknown;
  /** data-* attributes: icon, description, keywords (comma list) */
  data?: Record<string, unknown> | null;
}
export interface NativeSelectInput {
  id?: unknown;
  name?: unknown;
  label?: unknown;
  multiple?: unknown;
  size?: unknown;
  options?: unknown;
  searchThreshold?: unknown;
  placeholder?: unknown;
}

export interface PickerFilteredOption extends PickerOption { score: number }
export interface PickerGrouped { group: PickerGroup | null; options: PickerFilteredOption[] }

export interface PickerState {
  open: boolean;
  query: string;
  active: number;
  filtered: PickerFilteredOption[];
  typeahead: string;
}

export type PickerKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End' | 'PageDown' | 'PageUp' | 'Enter' | 'Space' | 'Escape' | 'Tab' | (string & {});
export type PickerEffect = '' | 'close' | 'choose' | 'type' | 'refused';
export interface PickerKeyResult { state: PickerState; model: PickerModel; effect: PickerEffect }
export interface PickerChoice { model: PickerModel; changed: boolean }
export interface PickerMatch { option: PickerOption; confidence: number; index: number }
export interface PickerNoMatch { option: null; confidence: 0; ambiguous: string[] }

/* ---------------------------------------------------------------- helpers */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, n: number): string => (typeof v === 'string' ? v.trim().slice(0, n) : typeof v === 'number' && Number.isFinite(v) ? String(v).slice(0, n) : '');
/** A flag as JSON, a form value or a bare attribute (`disabled=""`) all read as on. */
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1 || v === '1' || v === '';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const WORD_SPLIT = /[\s,;/]+/;

/** Lower-case, accents stripped, punctuation to spaces, one space between words. */
export const foldText = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const words = (s: string): string[] => foldText(s).split(' ').filter(Boolean);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text: string, w: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}`, 'u').test(text);
const hasPhrase = (text: string, p: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(p)}($|[^\\p{L}\\p{N}])`, 'u').test(text);

/** Slug an id / label into a picker id (console-control address `picker:<id>`). */
export function pickerIdOf(raw: unknown, fallback = 'picker'): string {
  const s = str(raw, PICKER_LIMITS.id);
  if (ID.test(s)) return s;
  const slug = foldText(s).replace(/ /g, '-').replace(/^-+|-+$/g, '').slice(0, PICKER_LIMITS.id);
  return slug || fallback;
}

/** `id`, `id-2`, `id-3`… against the ids already taken. */
export function uniquePickerId(id: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(id)) return id;
  for (let n = 2; ; n++) if (!set.has(`${id}-${n}`)) return `${id}-${n}`;
}

function keywordList(v: unknown): string[] | undefined {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(WORD_SPLIT) : [];
  const out = [...new Set(list.map((k) => str(k, PICKER_LIMITS.keyword)).filter(Boolean))].slice(0, PICKER_LIMITS.keywords);
  return out.length ? out : undefined;
}

function normalizeOption(raw: unknown): PickerOption | null {
  if (typeof raw === 'string' || typeof raw === 'number') {
    const s = str(raw, PICKER_LIMITS.label);
    return s ? { value: s.slice(0, PICKER_LIMITS.value), label: s } : null;
  }
  if (!isObj(raw)) return null;
  const label = str(raw.label ?? raw.text ?? raw.name, PICKER_LIMITS.label);
  const value = raw.value === undefined || raw.value === null ? label.slice(0, PICKER_LIMITS.value) : str(raw.value, PICKER_LIMITS.value);
  if (!label && !value) return null;
  const o: PickerOption = { value, label: label || value };
  const d = str(raw.description, PICKER_LIMITS.description); if (d) o.description = d;
  const i = str(raw.icon, 80); if (i) o.icon = i;
  const g = str(raw.group, PICKER_LIMITS.label); if (g) o.group = g;
  if (bool(raw.disabled)) o.disabled = true;
  const k = keywordList(raw.keywords); if (k) o.keywords = k;
  return o;
}

/* ---------------------------------------------------------------- model */

/** Any list of choices (strings, { value, label, … }, a whole model) → a bounded picker model. */
export function normalizePicker(raw: unknown): PickerModel {
  const r = isObj(raw) ? raw : Array.isArray(raw) ? { options: raw } : {};
  const seen = new Set<string>();
  const options: PickerOption[] = [];
  for (const item of Array.isArray(r.options) ? r.options : []) {
    const o = normalizeOption(item);
    if (!o || seen.has(o.value)) continue;
    seen.add(o.value);
    options.push(o);
    if (options.length >= PICKER_LIMITS.options) break;
  }
  // groups: declared ones in order (deduplicated), then any group an option names that wasn't declared
  const groups: PickerGroup[] = [];
  const gseen = new Set<string>();
  const addGroup = (id: string, label: string) => { if (id && !gseen.has(id) && groups.length < PICKER_LIMITS.groups) { gseen.add(id); groups.push({ id, label: label || id }); } };
  for (const g of Array.isArray(r.groups) ? r.groups : []) {
    if (typeof g === 'string') addGroup(str(g, PICKER_LIMITS.label), str(g, PICKER_LIMITS.label));
    else if (isObj(g)) { const id = str(g.id ?? g.label, PICKER_LIMITS.label); addGroup(id, str(g.label ?? g.id, PICKER_LIMITS.label)); }
  }
  for (const o of options) if (o.group) addGroup(o.group, o.group);
  // a group no option names is dropped; an option naming a group past the cap loses it
  const used = new Set(options.map((o) => o.group).filter(Boolean));
  const kept = groups.filter((g) => used.has(g.id));
  const keptIds = new Set(kept.map((g) => g.id));
  for (const o of options) if (o.group && !keptIds.has(o.group)) delete o.group;

  const multiple = r.multiple !== undefined && r.multiple !== null && bool(r.multiple);
  const maxRaw = Number(r.max);
  const max = multiple && Number.isFinite(maxRaw) && maxRaw > 0 ? Math.floor(maxRaw) : 0;
  const thr = r.searchThreshold === Infinity || r.searchThreshold === 'never' ? Infinity : r.searchThreshold === 'always' ? 0 : Number(r.searchThreshold);
  const searchThreshold = Number.isFinite(thr) ? Math.max(0, Math.floor(thr)) : thr === Infinity ? Infinity : PICKER_SEARCH_THRESHOLD;
  const label = str(r.label, PICKER_LIMITS.label);
  const model: PickerModel = {
    id: pickerIdOf(r.id ?? r.name ?? label),
    label,
    options,
    groups: kept,
    multiple,
    value: [],
    searchThreshold,
    placeholder: str(r.placeholder, PICKER_LIMITS.label),
    emptyLabel: str(r.emptyLabel, PICKER_LIMITS.label),
    max,
  };
  const rawValue = Array.isArray(r.value) ? r.value : r.value === undefined || r.value === null ? [] : [r.value];
  model.value = cleanValue(model, rawValue.map((v) => str(v, PICKER_LIMITS.value)));
  return model;
}

/** Known, enabled, unique values only; one at most in single mode, `max` at most in multiple mode. */
export function cleanValue(model: PickerModel, value: readonly string[]): string[] {
  const enabled = new Map(model.options.filter((o) => !o.disabled).map((o) => [o.value, o]));
  const out: string[] = [];
  for (const v of value) if (enabled.has(v) && !out.includes(v)) out.push(v);
  if (!model.multiple) return out.slice(0, 1);
  return model.max > 0 ? out.slice(0, model.max) : out;
}

/** The same model from a native <select>'s rows (optgroups → groups, data-* → icon / description / keywords). */
export function fromNativeOptions(input: NativeSelectInput): PickerModel {
  const rows = Array.isArray(input.options) ? (input.options as NativeOptionRow[]) : [];
  const options: Record<string, unknown>[] = [];
  const value: string[] = [];
  const groups: string[] = [];
  let emptyLabel = '';
  for (const row of rows) {
    if (!isObj(row)) continue;
    const text = str(row.text, PICKER_LIMITS.label);
    const v = row.value === undefined || row.value === null ? text : str(row.value, PICKER_LIMITS.value);
    if (v === '' && !bool(row.disabled)) { emptyLabel = text || emptyLabel; if (bool(row.selected)) value.length = 0; continue; }
    const data = isObj(row.data) ? row.data : {};
    const group = str(row.group, PICKER_LIMITS.label);
    if (group && !groups.includes(group)) groups.push(group);
    const o: Record<string, unknown> = { value: v, label: text || v, disabled: row.disabled !== undefined && row.disabled !== null && bool(row.disabled) };
    if (group) o.group = group;
    if (data.icon) o.icon = data.icon;
    if (data.description) o.description = data.description;
    if (data.keywords) o.keywords = data.keywords;
    options.push(o);
    if (bool(row.selected)) value.push(v);
  }
  const size = Number(input.size);
  const multiple = (input.multiple !== undefined && input.multiple !== null && bool(input.multiple)) || (Number.isFinite(size) && size > 1);
  return normalizePicker({ id: input.id || input.name || input.label, label: input.label, options, groups, multiple, value, emptyLabel, searchThreshold: input.searchThreshold, placeholder: input.placeholder });
}

/** Does this picker show its search field? */
export const searchShown = (model: PickerModel): boolean => model.options.length >= model.searchThreshold;

/* ---------------------------------------------------------------- filter + group */

/**
 * Score one option for a query: every query word must match somewhere (label > description / keywords / group label);
 * 0 = no match. Same ladder as the search engine's scoreEntry, so a word finds the same thing in a picker and in the
 * toolbar search.
 */
export function scoreOption(o: PickerOption, query: string, groupLabel = ''): number {
  const qs = words(query);
  if (!qs.length) return 0;
  const label = foldText(o.label);
  const rest = foldText([o.description ?? '', ...(o.keywords ?? []), groupLabel, o.value].join(' '));
  const full = foldText(query);
  let score = 0;
  for (const w of qs) {
    let s = 0;
    if (label === w) s = 100;
    else if (label.startsWith(w)) s = 60;
    else if (hasWord(label, w)) s = 40;
    else if (label.includes(w)) s = 25;
    else if (rest.includes(w)) s = 10;
    if (!s) return 0;
    score += s;
  }
  if (qs.length > 1 && label.includes(full)) score += 30;
  return score - Math.min(label.length, 60) / 60;
}

/** The options a query leaves: model order for an empty query, by score (ties in model order) otherwise. */
export function filterOptions(model: PickerModel, query: string): PickerFilteredOption[] {
  if (!words(query).length) return model.options.map((o) => ({ ...o, score: 0 }));
  const groupLabel = new Map(model.groups.map((g) => [g.id, g.label]));
  const out: PickerFilteredOption[] = [];
  model.options.forEach((o) => { const s = scoreOption(o, query, o.group ? groupLabel.get(o.group) ?? '' : ''); if (s > 0) out.push({ ...o, score: Math.round(s * 1e6) / 1e6 }); });
  // stable: equal scores keep model order
  return out.map((o, i) => [o, i] as const).sort((a, b) => b[0].score - a[0].score || a[1] - b[1]).map(([o]) => o);
}

/** Options grouped for drawing: ungrouped first, then groups in model order; empty groups dropped. */
export function groupOptions(model: PickerModel, options: readonly PickerFilteredOption[] = filterOptions(model, '')): PickerGrouped[] {
  const out: PickerGrouped[] = [];
  const loose = options.filter((o) => !o.group);
  if (loose.length) out.push({ group: null, options: loose });
  for (const g of model.groups) {
    const list = options.filter((o) => o.group === g.id);
    if (list.length) out.push({ group: g, options: list });
  }
  return out;
}

/* ---------------------------------------------------------------- choosing */

/** Choose (single: replace; '' clears) or toggle (multiple; `max` refuses). Disabled / unknown values change nothing. */
export function choosePicker(model: PickerModel, value: string): PickerChoice {
  if (value === '') {
    if (!model.value.length) return { model, changed: false };
    return { model: { ...model, value: [] }, changed: true };
  }
  const o = model.options.find((x) => x.value === value);
  if (!o || o.disabled) return { model, changed: false };
  if (!model.multiple) {
    if (model.value[0] === value && model.value.length === 1) return { model, changed: false };
    return { model: { ...model, value: [value] }, changed: true };
  }
  if (model.value.includes(value)) return { model: { ...model, value: model.value.filter((v) => v !== value) }, changed: true };
  if (model.max > 0 && model.value.length >= model.max) return { model, changed: false };
  // keep option order so labels read in list order
  const set = new Set([...model.value, value]);
  return { model: { ...model, value: model.options.filter((x) => set.has(x.value)).map((x) => x.value) }, changed: true };
}

/** Set the whole value at once (an API `control set`): cleaned like a normalised model. */
export function setValue(model: PickerModel, value: readonly string[] | string): PickerChoice {
  const next = cleanValue(model, Array.isArray(value) ? value : [value as string]);
  const same = next.length === model.value.length && next.every((v, i) => v === model.value[i]);
  return same ? { model, changed: false } : { model: { ...model, value: next }, changed: true };
}

/** The chosen labels in option order. */
export const selectedLabels = (model: PickerModel): string[] => model.options.filter((o) => model.value.includes(o.value)).map((o) => o.label);

/** What the trigger button says. */
export function triggerText(model: PickerModel): string {
  const labels = selectedLabels(model);
  if (!labels.length) return model.placeholder || (!model.multiple && !model.emptyLabel ? model.options.find((o) => !o.disabled)?.label ?? '' : model.emptyLabel);
  if (labels.length <= PICKER_TRIGGER_LABELS) return labels.join(', ');
  return `${labels.slice(0, PICKER_TRIGGER_LABELS).join(', ')} +${labels.length - PICKER_TRIGGER_LABELS}`;
}

/* ---------------------------------------------------------------- state */

const firstEnabled = (list: readonly PickerOption[], from = 0, dir = 1): number => {
  for (let i = from; i >= 0 && i < list.length; i += dir) if (!list[i]!.disabled) return i;
  return -1;
};

export const closedPicker = (): PickerState => ({ open: false, query: '', active: -1, filtered: [], typeahead: '' });

/** Open: every option listed, the active row on the first chosen value, else the first enabled option. */
export function openPicker(model: PickerModel): PickerState {
  const filtered = filterOptions(model, '');
  const chosen = filtered.findIndex((o) => model.value.includes(o.value) && !o.disabled);
  return { open: true, query: '', active: chosen >= 0 ? chosen : firstEnabled(filtered), filtered, typeahead: '' };
}

export function closePicker(state: PickerState): PickerState {
  return { ...state, open: false, query: '', typeahead: '', active: -1, filtered: [] };
}

/** A new search: the filtered list and the active row on its first enabled result. */
export function setQuery(model: PickerModel, state: PickerState, query: string): PickerState {
  const q = str(query, PICKER_LIMITS.label);
  const filtered = filterOptions(model, q);
  return { ...state, open: true, query: q, filtered, active: firstEnabled(filtered), typeahead: '' };
}

/** The active row after one move; -1 stays -1 only when nothing is enabled. */
export function moveActive(state: PickerState, by: number | 'home' | 'end'): PickerState {
  const list = state.filtered;
  if (!list.length) return { ...state, active: -1 };
  let next: number;
  if (by === 'home') next = firstEnabled(list, 0, 1);
  else if (by === 'end') next = firstEnabled(list, list.length - 1, -1);
  else if (by === 0) next = state.active;
  else {
    const dir = by > 0 ? 1 : -1;
    let steps = Math.abs(by);
    let i = state.active < 0 ? (dir > 0 ? -1 : list.length) : state.active;
    next = state.active;
    while (steps > 0) {
      const n = firstEnabled(list, i + dir, dir);
      if (n < 0) break;
      next = n; i = n; steps--;
    }
    if (next < 0) next = firstEnabled(list, dir > 0 ? 0 : list.length - 1, dir);
  }
  return { ...state, active: next };
}

/** Type-ahead: the first enabled row whose label starts with the letters, then one containing them, from the active row on. */
export function typeAhead(state: PickerState, letters: string): PickerState {
  const typed = foldText(state.typeahead + letters);
  if (!typed) return state;
  const list = state.filtered;
  const start = state.active < 0 ? 0 : typed.length > 1 ? state.active : state.active + 1;
  const order = [...Array.from({ length: list.length - start }, (_, i) => start + i), ...Array.from({ length: start }, (_, i) => i)];
  const byStart = order.find((i) => !list[i]!.disabled && foldText(list[i]!.label).startsWith(typed));
  const byAny = byStart ?? order.find((i) => !list[i]!.disabled && foldText(list[i]!.label).includes(typed));
  return { ...state, typeahead: typed, active: byAny ?? state.active };
}

/**
 * One key against the open picker. `searchFocused` = the search field has the focus (printable keys type into it,
 * Space types too). Returns the next state, the model (changed by Enter / Space) and what the host does next.
 */
export function pickerKey(model: PickerModel, state: PickerState, key: PickerKey, searchFocused = searchShown(model)): PickerKeyResult {
  const r = (s: PickerState, effect: PickerEffect = '', m: PickerModel = model): PickerKeyResult => ({ state: s, model: m, effect });
  if (!state.open) return r(state);
  switch (key) {
    case 'ArrowDown': return r(moveActive(state, 1));
    case 'ArrowUp': return r(moveActive(state, -1));
    case 'Home': return r(moveActive(state, 'home'));
    case 'End': return r(moveActive(state, 'end'));
    case 'PageDown': return r(moveActive(state, PICKER_PAGE));
    case 'PageUp': return r(moveActive(state, -PICKER_PAGE));
    // Escape and Tab both leave: single mode keeps the value the trigger had, multiple keeps what was toggled
    case 'Escape': case 'Tab': return r(closePicker(state), 'close');
    case 'Space':
      if (!model.multiple && searchFocused) return r(state, 'type');
      // falls through: a space chooses like Enter
    case 'Enter': {
      const o = state.filtered[state.active];
      if (!o || o.disabled) return r(state);
      const c = choosePicker(model, o.value);
      if (!model.multiple) return r(closePicker(state), 'close', c.model);
      return r({ ...state, typeahead: '' }, c.changed ? 'choose' : 'refused', c.model);
    }
    default: {
      if (typeof key !== 'string' || [...key].length !== 1 || !/[\p{L}\p{N}]/u.test(key)) return r(state);
      if (searchFocused) return r(state, 'type');
      return r(typeAhead(state, key));
    }
  }
}

/* ---------------------------------------------------------------- voice */

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, last: -1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** "the third one", "number 3", "3", "the last one" → the enabled option at that position in `list`. */
export function matchByPosition(list: readonly PickerOption[], spoken: string): PickerMatch | null {
  const ws = words(spoken);
  // the first digit or ordinal wins; "one" counts only when no other number is spoken ("the third one" = 3, "one" = 1)
  let n = 0;
  for (const w of ws) {
    if (/^\d+$/.test(w)) { n = Number(w); break; }
    if (w in ORDINALS && w !== 'one') { n = ORDINALS[w]!; break; }
  }
  if (!n && ws.includes('one')) n = 1;
  if (!n) return null;
  const index = n < 0 ? list.length - 1 : n - 1;
  const o = list[index];
  return o && !o.disabled ? { option: o, confidence: 0.9, index } : null;
}

/**
 * A spoken name → one option. Label equal (1) > value equal (0.95) > label starts with (0.8) > label has the words
 * whole (0.7) > every spoken word somewhere in label + description + keywords (0.5) > one unique label containing
 * the words anywhere (0.4). Two options tied below 1 → null with `ambiguous`. Disabled options never match.
 */
export function matchByName(model: PickerModel, spoken: string, list: readonly PickerOption[] = model.options): PickerMatch | PickerNoMatch {
  const none: PickerNoMatch = { option: null, confidence: 0, ambiguous: [] };
  const phrase = foldText(spoken);
  if (!phrase) return none;
  const qs = phrase.split(' ');
  const scored: { option: PickerOption; index: number; confidence: number }[] = [];
  list.forEach((o, index) => {
    if (o.disabled) return;
    const label = foldText(o.label);
    const value = foldText(o.value);
    const rest = foldText([o.label, o.description ?? '', ...(o.keywords ?? [])].join(' '));
    let c = 0;
    if (label === phrase) c = 1;
    else if (value === phrase) c = 0.95;
    else if (label.startsWith(phrase)) c = 0.8;
    else if (hasPhrase(label, phrase)) c = 0.7;
    else if (qs.every((w) => hasWord(rest, w))) c = 0.5;
    else if (label.includes(phrase)) c = 0.4;
    if (c > 0) scored.push({ option: o, index, confidence: c });
  });
  if (!scored.length) return none;
  scored.sort((a, b) => b.confidence - a.confidence || a.index - b.index);
  const best = scored[0]!;
  const tied = scored.filter((s) => s.confidence === best.confidence);
  if (best.confidence < 1 && tied.length > 1) return { option: null, confidence: 0, ambiguous: tied.map((s) => s.option.label) };
  return { option: best.option, confidence: best.confidence, index: best.index };
}

/** What the voice layer uses: a name first, a position ("the third one") when the name finds nothing. */
export function matchSpoken(model: PickerModel, spoken: string, state?: PickerState | null): PickerMatch | PickerNoMatch {
  const list = state?.open ? state.filtered : model.options;
  const byName = matchByName(model, spoken, list);
  if (byName.option || byName.ambiguous.length) return byName;
  return matchByPosition(list, spoken) ?? byName;
}

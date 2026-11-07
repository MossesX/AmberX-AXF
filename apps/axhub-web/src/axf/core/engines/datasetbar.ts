/**
 * Data set bar (data-set-bar@1; Brett, Nov 7 2026: "A plugin that attaches to ANY data set (grid, list, tree, table)
 * and is hidden by default. Search, Filter and Sort are each their own registry asset (search-bar, filter-button,
 * sort-control), reusable on their own, plus a combined 'data set bar' asset.").
 *
 * The pure engine behind the four assets, framework-agnostic so it ports (Kotlin twin deferred, spec/PORTING.md):
 *
 * - `normalizeFilterButton` / `normalizeSortControl` / `normalizeDataSetBar` / `datasetSearchConfig`: an asset's data →
 *   a complete config (defaults filled, enums checked, ranges clamped). The same rules read a `search-bar` asset with
 *   `scope: dataset`, so the top-bar search (search-bar/everything) and every data set search are instances of one type.
 * - Attachments (`DsbAttachment`): one record per data set the bar (or a piece) is attached to, stored local-first by the
 *   plugin (the app's settings), with the bar asset it draws from, per-attachment overrides (placement, pieces), the live
 *   state (query, field, rules, sort), saved filters and sorts, and the floating pill's spot. `resolveAttachment` folds
 *   the asset and the overrides into what is drawn; `resetAttachment` is *Reset to default* (keeps saved filters / sorts).
 * - Search: `searchRow` is field-scoped and fuzzy (every word must hit some searched field: a substring, a subsequence
 *   with gaps, or a word one edit away), `searchScore` ranks hits.
 * - Filter: per-field rules (`DSB_OPS`, `makeDsbFilter`); sort: multi-key (`makeDsbCompare`), empties last, numeric
 *   and date aware.
 * - Placement: `placementSlot` maps top / bottom / inline / floating onto the dataset slots a view renders.
 *
 * Fixture: spec/fixtures/dataset-bar.json (gen-fixtures.mts), replayed by spec/check-dataset-bar.mts.
 */

/* ---------------------------------------------------------------- enums */

export const DSB_PLACEMENTS = ['top', 'bottom', 'inline', 'floating'] as const;
export type DsbPlacement = (typeof DSB_PLACEMENTS)[number];
export const DSB_DISPLAYS = ['icon', 'label', 'both'] as const;
export type DsbDisplay = (typeof DSB_DISPLAYS)[number];
export const DSB_TONES = ['neutral', 'primary', 'ghost', 'quiet'] as const;
export type DsbTone = (typeof DSB_TONES)[number];
export const DSB_SIZES = ['sm', 'md'] as const;
export type DsbSize = (typeof DSB_SIZES)[number];
export const DSB_MATCHES = ['all', 'any'] as const;
export type DsbMatch = (typeof DSB_MATCHES)[number];
export const SORT_CONTROL_STYLES = ['menu', 'chips', 'buttons'] as const;
export type SortControlStyle = (typeof SORT_CONTROL_STYLES)[number];
export const DSB_ALIGNS = ['start', 'center', 'end', 'spread'] as const;
export type DsbAlign = (typeof DSB_ALIGNS)[number];
export const DSB_DENSITIES = ['compact', 'regular'] as const;
export type DsbDensity = (typeof DSB_DENSITIES)[number];
export const DSB_SURFACES = ['flat', 'raised', 'glass'] as const;
export type DsbSurface = (typeof DSB_SURFACES)[number];
export const DSB_FLOATING_SIDES = ['bottom-end', 'bottom-start', 'top-end', 'top-start'] as const;
export type DsbFloatingSide = (typeof DSB_FLOATING_SIDES)[number];
export const DSB_PIECES = ['search', 'filter', 'sort'] as const;
export type DsbPiece = (typeof DSB_PIECES)[number];
/** The asset type each piece is an instance of. */
export const DSB_PIECE_TYPES: Record<DsbPiece, 'search-bar' | 'filter-button' | 'sort-control'> = { search: 'search-bar', filter: 'filter-button', sort: 'sort-control' };

export const DSB_LIMITS = { maxRules: { min: 1, max: 20, default: 10 }, maxKeys: { min: 1, max: 5, default: 3 }, minChars: { min: 0, max: 5, default: 1 }, savedName: 60, query: 400, value: 400 } as const;

/* ---------------------------------------------------------------- asset data (what the JSON holds) */

export interface FilterButtonData {
  display: DsbDisplay;
  match: DsbMatch;
  label?: string;
  icon?: string;
  tone?: DsbTone;
  size?: DsbSize;
  savedFilters?: boolean;
  quickFields?: string[];
  maxRules?: number;
  showCount?: boolean;
  clear?: boolean;
}
export interface SortControlData {
  display: DsbDisplay;
  style: SortControlStyle;
  label?: string;
  icon?: string;
  tone?: DsbTone;
  size?: DsbSize;
  maxKeys?: number;
  savedSorts?: boolean;
  quickFields?: string[];
  showCount?: boolean;
}
export interface DataSetBarData {
  placement: DsbPlacement;
  /** search-bar asset id ('' = no search piece) */
  search: string;
  /** filter-button asset id ('' = none) */
  filter: string;
  /** sort-control asset id ('' = none) */
  sort: string;
  count?: boolean;
  clear?: boolean;
  align?: DsbAlign;
  density?: DsbDensity;
  surface?: DsbSurface;
  label?: string;
  floatingSide?: DsbFloatingSide;
}

/* ---------------------------------------------------------------- normalized configs (what is drawn) */

export interface FilterButtonConfig { display: DsbDisplay; match: DsbMatch; label: string; icon: string; tone: DsbTone; size: DsbSize; savedFilters: boolean; quickFields: string[]; maxRules: number; showCount: boolean; clear: boolean }
export interface SortControlConfig { display: DsbDisplay; style: SortControlStyle; label: string; icon: string; tone: DsbTone; size: DsbSize; maxKeys: number; savedSorts: boolean; quickFields: string[]; showCount: boolean }
export interface DataSetBarConfig { placement: DsbPlacement; search: string; filter: string; sort: string; count: boolean; clear: boolean; align: DsbAlign; density: DsbDensity; surface: DsbSurface; label: string; floatingSide: DsbFloatingSide }
/** A search-bar asset read for a data set (scope dataset). */
export interface DatasetSearchConfig { scope: 'app' | 'dataset'; placeholder: string; fuzzy: boolean; fields: string[]; fieldPicker: boolean; minChars: number; width: 'compact' | 'regular' | 'wide' }

export const FILTER_BUTTON_DEFAULT: FilterButtonConfig = { display: 'both', match: 'all', label: 'Filter', icon: 'sliders', tone: 'neutral', size: 'sm', savedFilters: true, quickFields: [], maxRules: DSB_LIMITS.maxRules.default, showCount: true, clear: true };
export const SORT_CONTROL_DEFAULT: SortControlConfig = { display: 'both', style: 'menu', label: 'Sort', icon: 'chevron-down', tone: 'neutral', size: 'sm', maxKeys: DSB_LIMITS.maxKeys.default, savedSorts: true, quickFields: [], showCount: true };
export const DATA_SET_BAR_DEFAULT: DataSetBarConfig = { placement: 'top', search: 'dataset', filter: 'default', sort: 'default', count: true, clear: true, align: 'start', density: 'compact', surface: 'flat', label: 'Data set bar', floatingSide: 'bottom-end' };
export const DATASET_SEARCH_DEFAULT: DatasetSearchConfig = { scope: 'dataset', placeholder: 'Search…', fuzzy: true, fields: [], fieldPicker: true, minChars: DSB_LIMITS.minChars.default, width: 'regular' };

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const str = (v: unknown, fallback: string, max = 120): string => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed as readonly string[]).includes(v as string) ? (v as T) : fallback;
const clampInt = (v: unknown, lim: { min: number; max: number; default: number }): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Math.round(Number(v)) : lim.default;
  return Math.min(lim.max, Math.max(lim.min, n));
};
const strList = (v: unknown, max = 40): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().slice(0, 80)).slice(0, max) : []);
const assetId = (v: unknown, fallback: string): string => (typeof v === 'string' ? (/^[a-z0-9][a-z0-9-]{1,47}$/.test(v) ? v : v === '' ? '' : fallback) : fallback);

export function normalizeFilterButton(d: unknown): FilterButtonConfig {
  const o = rec(d), D = FILTER_BUTTON_DEFAULT;
  return {
    display: pick(o.display, DSB_DISPLAYS, D.display), match: pick(o.match, DSB_MATCHES, D.match),
    label: str(o.label, D.label, 40), icon: str(o.icon, D.icon, 40), tone: pick(o.tone, DSB_TONES, D.tone), size: pick(o.size, DSB_SIZES, D.size),
    savedFilters: bool(o.savedFilters, D.savedFilters), quickFields: strList(o.quickFields), maxRules: clampInt(o.maxRules, DSB_LIMITS.maxRules),
    showCount: bool(o.showCount, D.showCount), clear: bool(o.clear, D.clear),
  };
}

export function normalizeSortControl(d: unknown): SortControlConfig {
  const o = rec(d), D = SORT_CONTROL_DEFAULT;
  return {
    display: pick(o.display, DSB_DISPLAYS, D.display), style: pick(o.style, SORT_CONTROL_STYLES, D.style),
    label: str(o.label, D.label, 40), icon: str(o.icon, D.icon, 40), tone: pick(o.tone, DSB_TONES, D.tone), size: pick(o.size, DSB_SIZES, D.size),
    maxKeys: clampInt(o.maxKeys, DSB_LIMITS.maxKeys), savedSorts: bool(o.savedSorts, D.savedSorts), quickFields: strList(o.quickFields), showCount: bool(o.showCount, D.showCount),
  };
}

export function normalizeDataSetBar(d: unknown): DataSetBarConfig {
  const o = rec(d), D = DATA_SET_BAR_DEFAULT;
  return {
    placement: pick(o.placement, DSB_PLACEMENTS, D.placement),
    search: assetId(o.search, D.search), filter: assetId(o.filter, D.filter), sort: assetId(o.sort, D.sort),
    count: bool(o.count, D.count), clear: bool(o.clear, D.clear), align: pick(o.align, DSB_ALIGNS, D.align), density: pick(o.density, DSB_DENSITIES, D.density),
    surface: pick(o.surface, DSB_SURFACES, D.surface), label: str(o.label, D.label, 60), floatingSide: pick(o.floatingSide, DSB_FLOATING_SIDES, D.floatingSide),
  };
}

/** A search-bar asset's data as a data set search. `scope` stays `app` for the app-wide bars (the widget engine draws those). */
export function datasetSearchConfig(d: unknown): DatasetSearchConfig {
  const o = rec(d), D = DATASET_SEARCH_DEFAULT;
  const scope = o.scope === 'dataset' ? 'dataset' : 'app';
  return {
    scope, placeholder: str(o.placeholder, D.placeholder, 80), fuzzy: scope === 'dataset' ? bool(o.fuzzy, D.fuzzy) : false,
    fields: strList(o.fields), fieldPicker: bool(o.fieldPicker, D.fieldPicker), minChars: clampInt(o.minChars, DSB_LIMITS.minChars),
    width: pick(o.width, ['compact', 'regular', 'wide'] as const, D.width),
  };
}

/** Errors the spec's required / enum checks don't catch (ranges, list shapes, dataset-only fields on an app search). */
export function dsbAssetErrors(type: string, data: unknown): string[] {
  const o = rec(data), errs: string[] = [];
  const range = (k: string, lim: { min: number; max: number }) => { if (k in o && (typeof o[k] !== 'number' || !Number.isFinite(o[k] as number) || (o[k] as number) < lim.min || (o[k] as number) > lim.max)) errs.push(`data.${k} must be a number ${lim.min}–${lim.max}`); };
  const list = (k: string) => { if (k in o && (!Array.isArray(o[k]) || (o[k] as unknown[]).some((x) => typeof x !== 'string'))) errs.push(`data.${k} must be a list of field ids`); };
  if (type === 'filter-button') { range('maxRules', DSB_LIMITS.maxRules); list('quickFields'); }
  else if (type === 'sort-control') { range('maxKeys', DSB_LIMITS.maxKeys); list('quickFields'); }
  else if (type === 'data-set-bar') { for (const k of DSB_PIECES) if (k in o && typeof o[k] !== 'string') errs.push(`data.${k} must be an asset id or ""`); }
  else if (type === 'search-bar') { range('minChars', DSB_LIMITS.minChars); list('fields'); if (o.scope !== 'dataset' && ('fields' in o || 'fieldPicker' in o || 'minChars' in o)) errs.push('data.fields / fieldPicker / minChars need scope: dataset'); }
  return errs;
}

/* ---------------------------------------------------------------- placement */

export const DSB_SLOT_TOP = 'axf.dataset.toolbar';
export const DSB_SLOT_BOTTOM = 'axf.dataset.footer';
/** Where a placement draws: the dataset's top slot (inline = the same slot, drawn as one quiet line), its bottom slot, or a floating pill. */
export function placementSlot(p: DsbPlacement): { slot: string | 'floating'; inline: boolean } {
  switch (p) {
    case 'bottom': return { slot: DSB_SLOT_BOTTOM, inline: false };
    case 'inline': return { slot: DSB_SLOT_TOP, inline: true };
    case 'floating': return { slot: 'floating', inline: false };
    default: return { slot: DSB_SLOT_TOP, inline: false };
  }
}

/* ---------------------------------------------------------------- filter rules + sort keys */

export type DsbOp = 'contains' | 'not-contains' | 'equals' | 'not-equals' | 'starts' | 'ends' | 'empty' | 'not-empty' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'in';
export const DSB_OPS: { id: DsbOp; label: string; needs: 0 | 1 | 2 | 'list'; numeric?: boolean }[] = [
  { id: 'contains', label: 'contains', needs: 1 },
  { id: 'not-contains', label: "doesn't contain", needs: 1 },
  { id: 'equals', label: 'is', needs: 1 },
  { id: 'not-equals', label: 'is not', needs: 1 },
  { id: 'starts', label: 'starts with', needs: 1 },
  { id: 'ends', label: 'ends with', needs: 1 },
  { id: 'in', label: 'is one of', needs: 'list' },
  { id: 'gt', label: '>', needs: 1, numeric: true },
  { id: 'gte', label: '≥', needs: 1, numeric: true },
  { id: 'lt', label: '<', needs: 1, numeric: true },
  { id: 'lte', label: '≤', needs: 1, numeric: true },
  { id: 'between', label: 'between', needs: 2, numeric: true },
  { id: 'empty', label: 'is empty', needs: 0 },
  { id: 'not-empty', label: 'is not empty', needs: 0 },
];
export interface DsbRule { id: string; field: string; op: DsbOp; value: string; value2?: string; values?: string[]; off?: boolean }
export interface DsbSortKey { field: string; dir: 1 | -1 }
/** The live state of one attachment: free search (scoped to one field or all), rules, sort. */
export interface DsbState { query: string; field: string; match: DsbMatch; rules: DsbRule[]; sort: DsbSortKey[] }
export const DSB_EMPTY_STATE: DsbState = { query: '', field: '', match: 'all', rules: [], sort: [] };

export type DsbValue = string | number | boolean | null | undefined;
export interface DsbField<R = unknown> { id: string; label: string; value: (r: R) => DsbValue }

const norm = (v: DsbValue) => (v == null ? '' : String(v)).toLowerCase();
const num = (v: DsbValue): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  const d = Date.parse(s);
  return Number.isFinite(d) ? d : null;
};

export function dsbRuleMatches(rule: DsbRule, v: DsbValue): boolean {
  const s = norm(v), q = norm(rule.value);
  switch (rule.op) {
    case 'contains': return s.includes(q);
    case 'not-contains': return !s.includes(q);
    case 'equals': return s === q;
    case 'not-equals': return s !== q;
    case 'starts': return s.startsWith(q);
    case 'ends': return s.endsWith(q);
    case 'empty': return s.trim() === '';
    case 'not-empty': return s.trim() !== '';
    case 'in': return (rule.values ?? []).map((x) => x.toLowerCase()).includes(s);
    default: {
      const a = num(v), b = num(rule.value);
      if (a == null || b == null) return false;
      if (rule.op === 'gt') return a > b;
      if (rule.op === 'gte') return a >= b;
      if (rule.op === 'lt') return a < b;
      if (rule.op === 'lte') return a <= b;
      const c = num(rule.value2 ?? '');
      return c != null && a >= Math.min(b, c) && a <= Math.max(b, c);
    }
  }
}

/** A rule that's switched off or still missing its value doesn't filter anything. */
export function dsbRuleReady(r: DsbRule): boolean {
  if (r.off || !r.field) return false;
  const op = DSB_OPS.find((o) => o.id === r.op);
  if (!op) return false;
  if (op.needs === 0) return true;
  if (op.needs === 'list') return (r.values ?? []).length > 0;
  if (op.needs === 2) return r.value.trim() !== '' && (r.value2 ?? '').trim() !== '';
  return r.value.trim() !== '';
}

/** Compare two values for a sort key: empties last whatever the direction, numbers and dates by value, else natural text order. */
export function dsbCompareValues(a: DsbValue, b: DsbValue, dir: 1 | -1 = 1): number {
  const ea = a == null || a === '', eb = b == null || b === '';
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1; // empties last, not flipped by dir
  const na = num(a), nb = num(b);
  if (na != null && nb != null) return (na - nb) * dir;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }) * dir;
}

/* ---------------------------------------------------------------- search (field-scoped, fuzzy) */

const tokens = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean);

/** Is `word` a subsequence of `text` (letters in order, gaps allowed)? */
function subsequence(text: string, word: string): boolean {
  let i = 0;
  for (let j = 0; j < text.length && i < word.length; j++) if (text[j] === word[i]) i++;
  return i === word.length;
}
/** Is some token of `text` within one edit (insert, delete, replace, adjacent swap) of `word`? */
function oneEditAway(text: string, word: string): boolean {
  if (word.length < 4) return false;
  for (const t of text.split(/[^a-z0-9]+/)) {
    if (!t || Math.abs(t.length - word.length) > 1) continue;
    if (t === word) return true;
    let i = 0;
    while (i < t.length && i < word.length && t[i] === word[i]) i++;
    const a = t.slice(i), b = word.slice(i);
    if (a.slice(1) === b.slice(1) || a.slice(1) === b || a === b.slice(1)) return true; // replace, delete, insert
    if (a.length === b.length && a.length >= 2 && a[0] === b[1] && a[1] === b[0] && a.slice(2) === b.slice(2)) return true; // swap
  }
  return false;
}

/** 0 = no hit; 3 = substring, 2 = one edit away, 1 = subsequence (fuzzy only). */
export function searchWordScore(text: string, word: string, fuzzy: boolean): 0 | 1 | 2 | 3 {
  const t = text.toLowerCase();
  if (t.includes(word)) return 3;
  if (!fuzzy) return 0;
  if (oneEditAway(t, word)) return 2;
  if (word.length >= 2 && subsequence(t, word)) return 1;
  return 0;
}

export interface SearchScope { fuzzy: boolean; fields?: string[]; field?: string; minChars?: number }
/**
 * Score a row for a query: every word must hit one of the searched field texts (`texts` = field id → text; `''` keys
 * a row's free text). `field` narrows to one field, else `fields` (empty = all). 0 = the row doesn't match;
 * otherwise the sum of the words' scores (higher = closer).
 */
export function searchScore(texts: Record<string, string>, query: string, scope: SearchScope): number {
  const q = query.trim();
  if (q.length < (scope.minChars ?? DSB_LIMITS.minChars.default)) return 1;
  const words = tokens(q);
  if (!words.length) return 1;
  const keys = scope.field ? [scope.field] : scope.fields?.length ? scope.fields : Object.keys(texts);
  const pool = keys.map((k) => texts[k] ?? '').filter(Boolean);
  if (!pool.length) return 0;
  let total = 0;
  for (const w of words) {
    let best = 0;
    for (const t of pool) { const s = searchWordScore(t, w, scope.fuzzy); if (s > best) best = s; if (best === 3) break; }
    if (!best) return 0;
    total += best;
  }
  return total;
}
export const searchRow = (texts: Record<string, string>, query: string, scope: SearchScope): boolean => searchScore(texts, query, scope) > 0;

/** The texts of a row by field id (+ `''` = the row's free text when given). */
export function rowTexts<R>(fields: DsbField<R>[], r: R, free?: (r: R) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) { const v = f.value(r); out[f.id] = v == null ? '' : String(v); }
  if (free) out[''] = free(r);
  return out;
}

/* ---------------------------------------------------------------- applying a state */

export const dsbStateFilters = (s: DsbState, search?: SearchScope) => s.query.trim().length >= (search?.minChars ?? DSB_LIMITS.minChars.default) && s.query.trim() !== '' || s.rules.some(dsbRuleReady);
export const dsbStateActive = (s: DsbState, search?: SearchScope) => dsbStateFilters(s, search) || s.sort.length > 0;
/** How many things are applied: words searched (0/1), ready rules, sort keys. */
export const dsbStateCounts = (s: DsbState) => ({ query: s.query.trim() ? 1 : 0, rules: s.rules.filter(dsbRuleReady).length, sort: s.sort.length });

export function makeDsbFilter<R>(s: DsbState, fields: DsbField<R>[], search: SearchScope, free?: (r: R) => string): (r: R) => boolean {
  const rules = s.rules.filter(dsbRuleReady);
  const byId = new Map(fields.map((f) => [f.id, f]));
  const q = s.query.trim();
  const scope: SearchScope = { ...search, field: s.field && byId.has(s.field) ? s.field : undefined };
  const searching = q.length > 0 && q.length >= (search.minChars ?? DSB_LIMITS.minChars.default);
  return (r) => {
    if (searching && !searchRow(rowTexts(fields, r, scope.field ? undefined : free), q, scope)) return false;
    if (!rules.length) return true;
    const hit = (x: DsbRule) => { const f = byId.get(x.field); return f ? dsbRuleMatches(x, f.value(r)) : true; };
    return s.match === 'any' ? rules.some(hit) : rules.every(hit);
  };
}

export function makeDsbCompare<R>(s: DsbState, fields: DsbField<R>[]): ((a: R, b: R) => number) | undefined {
  const keys = s.sort.map((k) => ({ f: fields.find((f) => f.id === k.field), dir: k.dir })).filter((k) => k.f);
  if (!keys.length) return undefined;
  return (a, b) => { for (const k of keys) { const c = dsbCompareValues(k.f!.value(a), k.f!.value(b), k.dir); if (c) return c; } return 0; };
}

/** Add, flip or drop a sort key (multi-key: a new field goes last; the same field and direction again takes it off). */
export function toggleDsbSort(s: DsbState, field: string, dir: 1 | -1, maxKeys: number = DSB_LIMITS.maxKeys.default): DsbState {
  const i = s.sort.findIndex((k) => k.field === field);
  if (i >= 0) {
    if (s.sort[i]!.dir === dir) return { ...s, sort: s.sort.filter((_, j) => j !== i) };
    return { ...s, sort: s.sort.map((k, j) => (j === i ? { field, dir } : k)) };
  }
  const next = [...s.sort, { field, dir }];
  return { ...s, sort: next.slice(Math.max(0, next.length - Math.max(1, maxKeys))) };
}

/* ---------------------------------------------------------------- attachments (per data set, local-first) */

export interface DsbSavedFilter { id: string; name: string; match: DsbMatch; rules: DsbRule[]; query?: string; field?: string; savedAt: string }
export interface DsbSavedSort { id: string; name: string; sort: DsbSortKey[]; savedAt: string }
/** Per-attachment overrides of the bar asset: left out = the asset's value. A piece set to `''` is off for this data set. */
export interface DsbOverrides { placement?: DsbPlacement; search?: string; filter?: string; sort?: string; count?: boolean; clear?: boolean; align?: DsbAlign; density?: DsbDensity; surface?: DsbSurface; floatingSide?: DsbFloatingSide }
export interface DsbAttachment {
  dataset: string;
  /** the data-set-bar asset drawn ('' = pieces attached one by one, no bar asset) */
  bar: string;
  overrides: DsbOverrides;
  state: DsbState;
  saved: { filters: DsbSavedFilter[]; sorts: DsbSavedSort[] };
  /** where the floating pill was dragged to (viewport fractions 0–1), when it was */
  floatingPos?: { x: number; y: number };
  attachedAt: string;
  updatedAt: string;
}
export type DsbAttachments = Record<string, DsbAttachment>;

let seq = 0;
export const dsbUid = (prefix = 'r') => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;
const iso = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback);
export const dsbSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'saved';

export function normalizeDsbRule(r: unknown): DsbRule | null {
  const o = rec(r);
  if (!DSB_OPS.some((x) => x.id === o.op)) return null;
  return {
    id: str(o.id, '', 40) || dsbUid(), field: str(o.field, '', 80), op: o.op as DsbOp, value: typeof o.value === 'string' ? o.value.slice(0, DSB_LIMITS.value) : '',
    ...(typeof o.value2 === 'string' ? { value2: o.value2.slice(0, DSB_LIMITS.value) } : {}),
    ...(Array.isArray(o.values) ? { values: (o.values as unknown[]).filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, DSB_LIMITS.value)).slice(0, 100) } : {}),
    ...(o.off === true ? { off: true } : {}),
  };
}
const normSort = (v: unknown, max = DSB_LIMITS.maxKeys.max): DsbSortKey[] => {
  const out: DsbSortKey[] = [];
  for (const k of Array.isArray(v) ? v : []) { const o = rec(k); const f = str(o.field, '', 80); if (f && !out.some((x) => x.field === f)) out.push({ field: f, dir: o.dir === -1 ? -1 : 1 }); }
  return out.slice(0, max);
};
export function normalizeDsbState(v: unknown): DsbState {
  const o = rec(v);
  return {
    query: typeof o.query === 'string' ? o.query.slice(0, DSB_LIMITS.query) : '', field: str(o.field, '', 80), match: pick(o.match, DSB_MATCHES, 'all'),
    rules: (Array.isArray(o.rules) ? o.rules : []).map(normalizeDsbRule).filter((r): r is DsbRule => !!r).slice(0, DSB_LIMITS.maxRules.max),
    sort: normSort(o.sort),
  };
}
function normOverrides(v: unknown): DsbOverrides {
  const o = rec(v), out: DsbOverrides = {};
  if ('placement' in o && (DSB_PLACEMENTS as readonly string[]).includes(o.placement as string)) out.placement = o.placement as DsbPlacement;
  for (const k of DSB_PIECES) if (typeof o[k] === 'string') out[k] = assetId(o[k], '');
  for (const k of ['count', 'clear'] as const) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  if ((DSB_ALIGNS as readonly string[]).includes(o.align as string)) out.align = o.align as DsbAlign;
  if ((DSB_DENSITIES as readonly string[]).includes(o.density as string)) out.density = o.density as DsbDensity;
  if ((DSB_SURFACES as readonly string[]).includes(o.surface as string)) out.surface = o.surface as DsbSurface;
  if ((DSB_FLOATING_SIDES as readonly string[]).includes(o.floatingSide as string)) out.floatingSide = o.floatingSide as DsbFloatingSide;
  return out;
}
export function normalizeAttachment(v: unknown, dataset: string, now = new Date().toISOString()): DsbAttachment {
  const o = rec(v), saved = rec(o.saved), pos = rec(o.floatingPos);
  const filters: DsbSavedFilter[] = [];
  for (const f of Array.isArray(saved.filters) ? saved.filters : []) {
    const x = rec(f); const name = str(x.name, '', DSB_LIMITS.savedName); if (!name) continue;
    const id = str(x.id, dsbSlug(name), 48); if (filters.some((y) => y.id === id)) continue;
    filters.push({ id, name, match: pick(x.match, DSB_MATCHES, 'all'), rules: (Array.isArray(x.rules) ? x.rules : []).map(normalizeDsbRule).filter((r): r is DsbRule => !!r), ...(typeof x.query === 'string' && x.query ? { query: x.query.slice(0, DSB_LIMITS.query) } : {}), ...(typeof x.field === 'string' && x.field ? { field: x.field.slice(0, 80) } : {}), savedAt: iso(x.savedAt, now) });
  }
  const sorts: DsbSavedSort[] = [];
  for (const s of Array.isArray(saved.sorts) ? saved.sorts : []) {
    const x = rec(s); const name = str(x.name, '', DSB_LIMITS.savedName); if (!name) continue;
    const id = str(x.id, dsbSlug(name), 48); if (sorts.some((y) => y.id === id)) continue;
    const sort = normSort(x.sort); if (!sort.length) continue;
    sorts.push({ id, name, sort, savedAt: iso(x.savedAt, now) });
  }
  const fx = typeof pos.x === 'number' && Number.isFinite(pos.x) ? Math.min(1, Math.max(0, pos.x)) : null;
  const fy = typeof pos.y === 'number' && Number.isFinite(pos.y) ? Math.min(1, Math.max(0, pos.y)) : null;
  return {
    dataset, bar: assetId(o.bar, ''), overrides: normOverrides(o.overrides), state: normalizeDsbState(o.state),
    saved: { filters: filters.slice(0, 50), sorts: sorts.slice(0, 50) },
    ...(fx != null && fy != null ? { floatingPos: { x: fx, y: fy } } : {}),
    attachedAt: iso(o.attachedAt, now), updatedAt: iso(o.updatedAt, now),
  };
}
/** The stored map (a JSON string or an object) → attachments by data set id; anything unreadable is dropped. */
export function parseAttachments(v: unknown, now = new Date().toISOString()): DsbAttachments {
  let j: unknown = v;
  if (typeof v === 'string') { try { j = v ? JSON.parse(v) : {}; } catch { j = {}; } }
  const out: DsbAttachments = {};
  for (const [k, a] of Object.entries(rec(j))) if (k && a && typeof a === 'object') out[k] = normalizeAttachment(a, k, now);
  return out;
}

/** The bar asset's config with this attachment's overrides on top (the bar left out = the defaults with every piece off unless attached). */
export function resolveAttachment(att: DsbAttachment, barData: unknown | null): DataSetBarConfig {
  const base = barData ? normalizeDataSetBar(barData) : { ...DATA_SET_BAR_DEFAULT, search: '', filter: '', sort: '' };
  const o = att.overrides;
  return {
    ...base,
    ...(o.placement ? { placement: o.placement } : {}),
    ...(o.search !== undefined ? { search: o.search } : {}), ...(o.filter !== undefined ? { filter: o.filter } : {}), ...(o.sort !== undefined ? { sort: o.sort } : {}),
    ...(o.count !== undefined ? { count: o.count } : {}), ...(o.clear !== undefined ? { clear: o.clear } : {}),
    ...(o.align ? { align: o.align } : {}), ...(o.density ? { density: o.density } : {}), ...(o.surface ? { surface: o.surface } : {}), ...(o.floatingSide ? { floatingSide: o.floatingSide } : {}),
  };
}
/** Pieces drawn for an attachment, in bar order, with the asset id each is an instance of. */
export function attachmentPieces(cfg: DataSetBarConfig): { piece: DsbPiece; type: (typeof DSB_PIECE_TYPES)[DsbPiece]; id: string }[] {
  return DSB_PIECES.filter((p) => cfg[p]).map((p) => ({ piece: p, type: DSB_PIECE_TYPES[p], id: cfg[p] }));
}
/** Nothing overridden, nothing applied, pill not moved. */
export const attachmentIsDefault = (att: DsbAttachment) => Object.keys(att.overrides).length === 0 && !att.floatingPos && !dsbStateActive(att.state) && att.state.field === '';
/** Reset to default: the asset's own look and placement, nothing applied. Saved filters and sorts are kept (they are the person's). */
export function resetAttachment(att: DsbAttachment, now = new Date().toISOString()): DsbAttachment {
  const { floatingPos: _drop, ...rest } = att; void _drop;
  return { ...rest, overrides: {}, state: { ...DSB_EMPTY_STATE }, updatedAt: now };
}

/* ---- the attach / detach moves the right-click menu, the Registry Browser, voice and the API all make ---- */

export interface AttachOptions { bar?: string; placement?: DsbPlacement; now?: string }
/** Attach the bar (asset `bar`, default `default`) to a data set, or change its placement when already attached. */
export function attachBar(map: DsbAttachments, dataset: string, opts: AttachOptions = {}): DsbAttachments {
  const now = opts.now ?? new Date().toISOString();
  const cur = map[dataset] ?? normalizeAttachment({}, dataset, now);
  const bar = assetId(opts.bar, 'default') || 'default';
  const overrides = { ...cur.overrides };
  // a bar asset brings its own pieces: piece-only attachments stop overriding them
  if (!cur.bar) for (const p of DSB_PIECES) delete overrides[p];
  if (opts.placement) overrides.placement = opts.placement; else delete overrides.placement;
  return { ...map, [dataset]: { ...cur, bar, overrides, updatedAt: now } };
}
/** Attach one piece (an asset of the piece's type) to a data set; without a bar the attachment is pieces only. */
export function attachPiece(map: DsbAttachments, dataset: string, piece: DsbPiece, asset = 'default', opts: { placement?: DsbPlacement; now?: string } = {}): DsbAttachments {
  const now = opts.now ?? new Date().toISOString();
  const cur = map[dataset] ?? normalizeAttachment({}, dataset, now);
  const id = assetId(asset, 'default') || 'default';
  const overrides: DsbOverrides = { ...cur.overrides, [piece]: id };
  if (opts.placement) overrides.placement = opts.placement;
  return { ...map, [dataset]: { ...cur, overrides, updatedAt: now } };
}
/** Take the whole bar off: the attachment is dropped (its saved filters and sorts go with it). */
export function detachBar(map: DsbAttachments, dataset: string): DsbAttachments {
  if (!map[dataset]) return map;
  const { [dataset]: _gone, ...rest } = map; void _gone;
  return rest;
}
/** Take one piece off; when that leaves nothing drawn, the attachment is dropped. */
export function detachPiece(map: DsbAttachments, dataset: string, piece: DsbPiece, barData: unknown | null, now = new Date().toISOString()): DsbAttachments {
  const cur = map[dataset]; if (!cur) return map;
  const next: DsbAttachment = { ...cur, overrides: { ...cur.overrides, [piece]: '' }, updatedAt: now };
  const cfg = resolveAttachment(next, next.bar ? barData : null);
  if (!attachmentPieces(cfg).length) return detachBar(map, dataset);
  return { ...map, [dataset]: next };
}
export function setAttachmentPlacement(map: DsbAttachments, dataset: string, placement: DsbPlacement, now = new Date().toISOString()): DsbAttachments {
  const cur = map[dataset]; if (!cur) return map;
  return { ...map, [dataset]: { ...cur, overrides: { ...cur.overrides, placement }, updatedAt: now } };
}
export function setAttachmentState(map: DsbAttachments, dataset: string, state: DsbState, now = new Date().toISOString()): DsbAttachments {
  const cur = map[dataset]; if (!cur) return map;
  return { ...map, [dataset]: { ...cur, state: normalizeDsbState(state), updatedAt: now } };
}

/* ---- saved filters and sorts ---- */

export function saveDsbFilter(att: DsbAttachment, name: string, now = new Date().toISOString()): DsbAttachment {
  const n = name.trim().slice(0, DSB_LIMITS.savedName); if (!n) return att;
  const id = dsbSlug(n);
  const entry: DsbSavedFilter = { id, name: n, match: att.state.match, rules: att.state.rules.filter(dsbRuleReady), ...(att.state.query.trim() ? { query: att.state.query.trim() } : {}), ...(att.state.field ? { field: att.state.field } : {}), savedAt: now };
  const filters = att.saved.filters.some((f) => f.id === id) ? att.saved.filters.map((f) => (f.id === id ? entry : f)) : [...att.saved.filters, entry].slice(-50);
  return { ...att, saved: { ...att.saved, filters }, updatedAt: now };
}
export function applyDsbSavedFilter(att: DsbAttachment, id: string, now = new Date().toISOString()): DsbAttachment {
  const f = att.saved.filters.find((x) => x.id === id); if (!f) return att;
  return { ...att, state: { ...att.state, match: f.match, rules: f.rules.map((r) => ({ ...r })), query: f.query ?? '', field: f.field ?? '' }, updatedAt: now };
}
export const deleteDsbSavedFilter = (att: DsbAttachment, id: string, now = new Date().toISOString()): DsbAttachment => ({ ...att, saved: { ...att.saved, filters: att.saved.filters.filter((f) => f.id !== id) }, updatedAt: now });
export function saveDsbSort(att: DsbAttachment, name: string, now = new Date().toISOString()): DsbAttachment {
  const n = name.trim().slice(0, DSB_LIMITS.savedName); if (!n || !att.state.sort.length) return att;
  const id = dsbSlug(n);
  const entry: DsbSavedSort = { id, name: n, sort: att.state.sort.map((k) => ({ ...k })), savedAt: now };
  const sorts = att.saved.sorts.some((s) => s.id === id) ? att.saved.sorts.map((s) => (s.id === id ? entry : s)) : [...att.saved.sorts, entry].slice(-50);
  return { ...att, saved: { ...att.saved, sorts }, updatedAt: now };
}
export function applyDsbSavedSort(att: DsbAttachment, id: string, now = new Date().toISOString()): DsbAttachment {
  const s = att.saved.sorts.find((x) => x.id === id); if (!s) return att;
  return { ...att, state: { ...att.state, sort: s.sort.map((k) => ({ ...k })) }, updatedAt: now };
}
export const deleteDsbSavedSort = (att: DsbAttachment, id: string, now = new Date().toISOString()): DsbAttachment => ({ ...att, saved: { ...att.saved, sorts: att.saved.sorts.filter((s) => s.id !== id) }, updatedAt: now });

/* ---- what the person sees in a menu ---- */

export const DSB_PLACEMENT_LABELS: Record<DsbPlacement, string> = { top: 'Top', bottom: 'Bottom', inline: 'Inline', floating: 'Floating' };
export const DSB_PIECE_LABELS: Record<DsbPiece, string> = { search: 'Search bar', filter: 'Filter button', sort: 'Sort control' };
/** One line for a chip or badge: "2 rules · sorted by 1 · "abc"". */
export function dsbSummary(s: DsbState): string {
  const c = dsbStateCounts(s), parts: string[] = [];
  if (c.query) parts.push(`"${s.query.trim()}"`);
  if (c.rules) parts.push(`${c.rules} rule${c.rules === 1 ? '' : 's'}`);
  if (c.sort) parts.push(`sorted by ${c.sort}`);
  return parts.join(' · ');
}

/**
 * Basic filter — pure core (no React): the filter engine, the toolbar's preset actions and the stored config.
 * Self-test: npx -y tsx apps/console-web/plugins/basic-filter/test.mts
 */
export const FOLDER = 'basic-filter';
export const OWNER = 'basic-filter';
export const DIALOG = 'basic-filter';

/* ---------------- filter engine ---------------- */

export type Op = 'contains' | 'not-contains' | 'equals' | 'not-equals' | 'starts' | 'ends' | 'empty' | 'not-empty' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'in';
export const OPS: { id: Op; label: string; needs: 0 | 1 | 2 | 'list'; numeric?: boolean }[] = [
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
export interface Rule { id: string; field: string; op: Op; value: string; value2?: string; values?: string[]; off?: boolean }
export interface SortKey { field: string; dir: 1 | -1 }
export interface FilterState { query: string; match: 'all' | 'any'; rules: Rule[]; sort: SortKey[] }
export const EMPTY_STATE: FilterState = { query: '', match: 'all', rules: [], sort: [] };

type Val = string | number | boolean | null | undefined;
export interface Field<R = unknown> { id: string; label: string; value: (r: R) => Val }

const norm = (v: Val) => (v == null ? '' : String(v)).toLowerCase();
const num = (v: Val | string): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  const d = Date.parse(s); // dates compare as time
  return Number.isFinite(d) ? d : null;
};

export function ruleMatches(rule: Rule, v: Val): boolean {
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
export function ruleReady(r: Rule): boolean {
  if (r.off) return false;
  const op = OPS.find((o) => o.id === r.op);
  if (!op) return false;
  if (op.needs === 0) return true;
  if (op.needs === 'list') return (r.values ?? []).length > 0;
  if (op.needs === 2) return r.value.trim() !== '' && (r.value2 ?? '').trim() !== '';
  return r.value.trim() !== '';
}

export const stateActive = (s: FilterState) => s.query.trim() !== '' || s.rules.some(ruleReady) || s.sort.length > 0;
export const stateFilters = (s: FilterState) => s.query.trim() !== '' || s.rules.some(ruleReady);

/** Every word of the search must appear somewhere in the row's text. */
export function searchMatches(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const t = text.toLowerCase();
  return words.every((w) => t.includes(w));
}

export function makeFilter<R>(s: FilterState, fields: Field<R>[], rowText: (r: R) => string): (r: R) => boolean {
  const rules = s.rules.filter(ruleReady);
  const byId = new Map(fields.map((f) => [f.id, f]));
  return (r) => {
    if (!searchMatches(rowText(r), s.query)) return false;
    if (!rules.length) return true;
    const hit = (x: Rule) => { const f = byId.get(x.field); return f ? ruleMatches(x, f.value(r)) : true; };
    return s.match === 'any' ? rules.some(hit) : rules.every(hit);
  };
}

export function compareValues(a: Val, b: Val): number {
  const ea = a == null || a === '', eb = b == null || b === '';
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1; // empties last
  const na = num(a), nb = num(b);
  if (na != null && nb != null) return na - nb;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export function makeCompare<R>(s: FilterState, fields: Field<R>[]): ((a: R, b: R) => number) | undefined {
  const keys = s.sort.map((k) => ({ f: fields.find((f) => f.id === k.field), dir: k.dir })).filter((k) => k.f);
  if (!keys.length) return undefined;
  return (a, b) => { for (const k of keys) { const c = compareValues(k.f!.value(a), k.f!.value(b)) * k.dir; if (c) return c; } return 0; };
}

/** Distinct values of a field (for "is one of" choices), most common first, at most `max`. */
export function distinct<R>(rows: readonly R[], f: Field<R>, max = 40): string[] {
  const n = new Map<string, number>();
  for (const r of rows) { const v = f.value(r); if (v == null || v === '') continue; const k = String(v); n.set(k, (n.get(k) ?? 0) + 1); }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([k]) => k);
}

/* ---------------- toolbar presets ---------------- */

export type Display = 'icon' | 'label' | 'both';
export type Tone = 'neutral' | 'primary' | 'ghost' | 'quiet' | 'success' | 'danger';
export interface ActionStyle { display: Display; tone: Tone; size: 'sm' | 'md'; icon: string; label: string }
export interface Preset {
  id: string;
  name: string;
  /** what it does, shown in the expanded row */
  does: string;
  kind: 'button' | 'search' | 'count' | 'separator' | 'spacer';
  /** extra the user sets on the action: a field to sort by */
  needsField?: boolean;
  style: ActionStyle;
}
export const PRESETS: Preset[] = [
  { id: 'open-dialog', name: 'Sort & filter', kind: 'button', does: 'Opens the sort & filter dialog for this dataset: search, rules on any column (text, number, date, one of), match all / any, multi-level sort.', style: { display: 'both', tone: 'neutral', size: 'sm', icon: 'sliders', label: 'Sort & filter' } },
  { id: 'search', name: 'Quick search', kind: 'search', does: 'A search box right on the toolbar. Every word must appear somewhere in the row. Same search as the dialog.', style: { display: 'both', tone: 'neutral', size: 'sm', icon: 'search', label: 'Search' } },
  { id: 'clear', name: 'Clear filters', kind: 'button', does: 'Removes the search, every rule and the sort: the dataset shows as it came. Greyed out when nothing is applied.', style: { display: 'icon', tone: 'quiet', size: 'sm', icon: 'x', label: 'Clear filters' } },
  { id: 'sort-asc', name: 'Sort ascending', kind: 'button', needsField: true, does: 'Sorts the dataset by the chosen column, smallest / A first (replaces the current sort). Tap again to take the sort off.', style: { display: 'icon', tone: 'quiet', size: 'sm', icon: 'chevron-up', label: 'Sort ascending' } },
  { id: 'sort-desc', name: 'Sort descending', kind: 'button', needsField: true, does: 'Sorts the dataset by the chosen column, largest / Z first (replaces the current sort). Tap again to take the sort off.', style: { display: 'icon', tone: 'quiet', size: 'sm', icon: 'chevron-down', label: 'Sort descending' } },
  { id: 'match', name: 'Match all / any', kind: 'button', does: 'Flips whether a row must match every rule or any one rule.', style: { display: 'label', tone: 'quiet', size: 'sm', icon: 'shuffle', label: 'Match' } },
  { id: 'count', name: 'Row count', kind: 'count', does: 'Shows how many rows are shown out of the whole dataset, e.g. "12 of 40".', style: { display: 'label', tone: 'quiet', size: 'sm', icon: 'chart', label: 'Rows' } },
  { id: 'separator', name: 'Separator', kind: 'separator', does: 'A thin line between groups of buttons.', style: { display: 'icon', tone: 'quiet', size: 'sm', icon: 'minus', label: 'Separator' } },
  { id: 'spacer', name: 'Spacer', kind: 'spacer', does: 'Pushes everything after it to the far end of the toolbar.', style: { display: 'icon', tone: 'quiet', size: 'sm', icon: 'arrow-right', label: 'Spacer' } },
];
export const presetOf = (id: string) => PRESETS.find((p) => p.id === id);

export interface ToolbarAction extends ActionStyle { uid: string; preset: string; visible: boolean; field?: string }
export interface ToolbarConfig { show: boolean; align: 'start' | 'center' | 'end'; actions: ToolbarAction[] }

let seq = 0;
export const newUid = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;
export const actionFrom = (preset: Preset, uid = newUid()): ToolbarAction => ({ uid, preset: preset.id, visible: true, ...preset.style });

/** Default: the toolbar is on, with one button that opens the sort & filter dialog. */
export const DEFAULT_TOOLBAR: ToolbarConfig = { show: true, align: 'start', actions: [actionFrom(PRESETS[0]!, 'default-open')] };

/* ---------------- stored config (settings values are strings: JSON) ---------------- */

export const KEY_TOOLBAR = 'basic-filter.toolbar';
export const KEY_DATASETS = 'basic-filter.datasets';
export const KEY_STATE = 'basic-filter.state';
export const ALL_KEYS = [KEY_TOOLBAR, KEY_DATASETS, KEY_STATE];

const TONES: Tone[] = ['neutral', 'primary', 'ghost', 'quiet', 'success', 'danger'];
const DISPLAYS: Display[] = ['icon', 'label', 'both'];
const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');

export function parseToolbar(v: unknown): ToolbarConfig {
  let j: unknown = null;
  try { j = typeof v === 'string' && v ? JSON.parse(v) : null; } catch { j = null; }
  if (!j || typeof j !== 'object') return structuredClone(DEFAULT_TOOLBAR);
  const o = j as Partial<ToolbarConfig>;
  const actions = (Array.isArray(o.actions) ? o.actions : []).flatMap((a): ToolbarAction[] => {
    const p = presetOf(str(a?.preset));
    if (!p) return [];
    return [{
      uid: str(a.uid) || newUid(), preset: p.id, visible: a.visible !== false,
      display: DISPLAYS.includes(a.display as Display) ? a.display as Display : p.style.display,
      tone: TONES.includes(a.tone as Tone) ? a.tone as Tone : p.style.tone,
      size: a.size === 'md' ? 'md' : 'sm',
      icon: str(a.icon, 40) || p.style.icon, label: str(a.label) || p.style.label,
      ...(p.needsField && str(a.field) ? { field: str(a.field) } : {}),
    }];
  });
  return { show: o.show !== false, align: o.align === 'center' || o.align === 'end' ? o.align : 'start', actions };
}

export function parseDatasets(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  try { const j = typeof v === 'string' && v ? JSON.parse(v) : []; return Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}

export function parseStates(v: unknown): Record<string, FilterState> {
  let j: unknown = {};
  try { j = typeof v === 'string' && v ? JSON.parse(v) : {}; } catch { j = {}; }
  const out: Record<string, FilterState> = {};
  if (!j || typeof j !== 'object') return out;
  for (const [k, s] of Object.entries(j as Record<string, Partial<FilterState>>)) {
    if (!s || typeof s !== 'object') continue;
    out[k] = {
      query: str(s.query, 400), match: s.match === 'any' ? 'any' : 'all',
      rules: (Array.isArray(s.rules) ? s.rules : []).filter((r) => r && OPS.some((o) => o.id === r.op)).map((r) => ({
        id: str(r.id) || newUid(), field: str(r.field), op: r.op, value: str(r.value, 400),
        ...(r.value2 != null ? { value2: str(r.value2, 400) } : {}), ...(Array.isArray(r.values) ? { values: r.values.map((x) => str(x, 400)) } : {}), ...(r.off ? { off: true } : {}),
      })),
      sort: (Array.isArray(s.sort) ? s.sort : []).filter((k) => k && str(k.field)).map((k) => ({ field: str(k.field), dir: k.dir === -1 ? -1 : 1 })),
    };
  }
  return out;
}

/** What a toolbar sort button does: sorting the same way again takes the sort off. */
export function toggleSort(s: FilterState, field: string, dir: 1 | -1): FilterState {
  const same = s.sort.length === 1 && s.sort[0]!.field === field && s.sort[0]!.dir === dir;
  return { ...s, sort: same ? [] : [{ field, dir }] };
}

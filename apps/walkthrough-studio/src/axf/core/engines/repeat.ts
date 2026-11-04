/**
 * Repeating slots engine (layout.repeat). A layout declares slots that repeat over a data set: one item per entry,
 * drawn as tabs, cards, a grid or a stack. The page declares the data sets (`PageDataSets`, by name); the layout
 * only names which set a slot repeats over. When the page declares none, or it is empty, the slot's fallback draws
 * instead. Pure and tolerant like every decoder: bad entries drop out, unknown values fall back to the defaults.
 * Kotlin twin: kernel/engine/RepeatEngine.kt. Fixture: spec/fixtures/layout-repeat.json.
 */
import spec from '../../schemas/asset-types.json';
import type { LayoutData, RepeatFallback, RepeatStyle } from '../types';
import { SLOT_REGIONS, type SlotRegion } from './layout';
import type { VarMap } from './theme';

const REPEAT_SPEC = (spec.types.layout as unknown as { repeat: { styles: RepeatStyle[]; default: RepeatStyle; maxColumns: number } }).repeat;
/** Styles a repeating slot may take (asset-types.json layout.repeat.styles). Append-only. */
export const REPEAT_STYLES: readonly RepeatStyle[] = REPEAT_SPEC.styles;
export const REPEAT_DEFAULT_STYLE: RepeatStyle = REPEAT_SPEC.default;
export const REPEAT_MAX_COLUMNS: number = REPEAT_SPEC.maxColumns;
/** Columns when a grid / cards slot names none; tabs and stacked are always one column. */
export const REPEAT_DEFAULT_COLUMNS: Readonly<Record<RepeatStyle, number>> = { tabs: 1, cards: 2, grid: 3, stacked: 1 };

/** Data sets a page declares: name → entries (objects with key/id, label/title, icon; or plain strings/numbers). */
export type PageDataSets = Readonly<Record<string, readonly unknown[] | undefined>>;

export interface RepeatItem {
  key: string;
  label: string;
  icon: string | null;
  /** position among the cleaned items */
  index: number;
  /** the page's entry (an object entry as given; a plain value as { value }) */
  data: Readonly<Record<string, unknown>>;
}

export interface CompiledRepeat {
  id: string;
  region: SlotRegion;
  dataSet: string;
  style: RepeatStyle;
  columns: number;
  /** items shown (at most `max`) */
  items: RepeatItem[];
  /** items left out by `max` */
  overflow: number;
  /** the page declared no data set by that name, or it has no usable entries */
  empty: boolean;
  /** the fallback slot to draw when empty (the layout's, cleaned; {} = none declared); null when not empty */
  fallback: RepeatFallback | null;
  /** tabs: the selected item's key (the asked one when shown, else the first); null for other styles or when empty */
  active: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const whole = (v: unknown, min: number, max: number): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined);

/** Clean a data set into items: objects (key ?? id ?? position), plain strings / numbers; others and repeated keys drop out. */
export function repeatItems(entries: unknown): RepeatItem[] {
  if (!Array.isArray(entries)) return [];
  const out: RepeatItem[] = [];
  const seen = new Set<string>();
  entries.forEach((e, i) => {
    let key: string;
    let label: string | undefined;
    let icon: string | null = null;
    let data: Record<string, unknown>;
    if (isObj(e)) {
      key = str(e.key) ?? str(e.id) ?? String(i);
      label = str(e.label) ?? str(e.title);
      icon = str(e.icon) ?? null;
      data = e;
    } else if (typeof e === 'string' && e.trim()) {
      key = e;
      data = { value: e };
    } else if (typeof e === 'number' && Number.isFinite(e)) {
      key = String(e);
      data = { value: e };
    } else return;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, label: label ?? key, icon, index: out.length, data });
  });
  return out;
}

function cleanFallback(f: unknown): RepeatFallback {
  if (!isObj(f)) return {};
  const out: RepeatFallback = {};
  if (typeof f.type === 'string' && f.type) out.type = f.type;
  if (typeof f.id === 'string' && f.id) out.id = f.id;
  if (typeof f.label === 'string' && f.label) out.label = f.label;
  return out;
}

/** One repeating slot against the page's data sets; null when the entry has no id or data set. */
export function compileRepeat(def: unknown, sets: PageDataSets, active: Readonly<Record<string, string>> = {}): CompiledRepeat | null {
  if (!isObj(def)) return null;
  const id = str(def.id);
  const dataSet = str(def.dataSet);
  if (!id || !dataSet) return null;
  const region = SLOT_REGIONS.includes(def.region as SlotRegion) ? (def.region as SlotRegion) : 'main';
  const style = REPEAT_STYLES.includes(def.style as RepeatStyle) ? (def.style as RepeatStyle) : REPEAT_DEFAULT_STYLE;
  const columns = style === 'grid' || style === 'cards' ? whole(def.columns, 1, REPEAT_MAX_COLUMNS) ?? REPEAT_DEFAULT_COLUMNS[style] : 1;
  const max = whole(def.max, 0, Number.MAX_SAFE_INTEGER) ?? 0;
  const all = repeatItems(sets[dataSet]);
  const items = max > 0 ? all.slice(0, max) : all;
  const empty = all.length === 0;
  const want = active[id];
  const first = items[0];
  return {
    id, region, dataSet, style, columns, items,
    overflow: all.length - items.length,
    empty,
    fallback: empty ? cleanFallback(def.fallback) : null,
    active: style === 'tabs' && first ? (want !== undefined && items.some((it) => it.key === want) ? want : first.key) : null,
  };
}

/** Every repeating slot of a layout, in order; invalid entries drop out and a repeated id keeps the first. */
export function compileRepeats(l: Pick<LayoutData, 'repeat'>, sets: PageDataSets, active: Readonly<Record<string, string>> = {}): CompiledRepeat[] {
  const out: CompiledRepeat[] = [];
  for (const def of Array.isArray(l.repeat) ? l.repeat : []) {
    const c = compileRepeat(def, sets, active);
    if (c && !out.some((o) => o.id === c.id)) out.push(c);
  }
  return out;
}

/** The data set names a layout's repeating slots ask the page for, in order, once each. */
export function declaredDataSets(l: Pick<LayoutData, 'repeat'>): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const d of Array.isArray(l.repeat) ? (l.repeat as unknown[]) : []) {
    const id = isObj(d) ? str(d.id) : undefined;
    const n = isObj(d) ? str(d.dataSet) : undefined;
    if (!id || !n || ids.has(id)) continue;
    ids.add(id);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** The data sets a layout asks for that the page doesn't declare (their slots draw the fallback). */
export function missingDataSets(l: Pick<LayoutData, 'repeat'>, sets: PageDataSets): string[] {
  return declaredDataSets(l).filter((n) => !Array.isArray(sets[n]));
}

/** The compiled slots in one region. */
export function repeatsIn(compiled: readonly CompiledRepeat[], region: SlotRegion): CompiledRepeat[] {
  return compiled.filter((c) => c.region === region);
}

/** CSS variables for one repeating slot (grid / cards column count). */
export function repeatVars(c: Pick<CompiledRepeat, 'columns'>): VarMap {
  return { '--fx-repeat-cols': String(c.columns) };
}

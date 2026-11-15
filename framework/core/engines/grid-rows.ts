/**
 * grid-rows@1 (build every-grid-1-2-rows-per-item-set-skin, Nov 15 2026). Brett: "every grid supposed to be 1 or 2
 * rows depending on the skin".
 *
 * A grid's rows as slots. Every item gives three things: its PRIMARY cells (what names the item), its SECONDARY cells
 * (what qualifies it) and an optional DETAIL (everything else). Collapsed, a row shows
 *
 *   1 line   primary + secondary inline, one line, truncated      (the skin says grid.rowLines = 1)
 *   2 lines  primary on the first line, secondary on the second   (grid.rowLines = 2, the default)
 *
 * and a tap or Enter on a row with a detail opens it under the row (a second tap / Enter closes it). The lines per row
 * come from the skin (component-tokens@1 `grid.rowLines` → `--fx-grid-row-lines`, mirrored on the root as
 * `data-axf-row-lines`; skin@1 `grid.rowLines`, folded hub → app → ui:<view> → plugin:<id>, child over parent), a tab
 * group's or container's customize token `rowLines`, or one grid alone (control@1 tokens.instances `grid.<id>.rowLines`).
 * `resolveGridRowLines` applies that order: instance → root → theme → 2.
 *
 * This file is the one contract: how raw items are read (`normalizeGridRows`), how a row is laid out for a given count
 * of lines (`gridRowPlan`: the lines, their cells, truncation, the open detail, the row's attributes and label), and how
 * input moves the state (`gridRowInput`: tap / Enter toggle, every other key is ignored, an item without a detail never
 * opens). Renderers (the web `fx-rows` classes in framework/ui/axf.css, `GRID_ROWS_CLASSES`; the Kotlin twin when it
 * comes) draw exactly the plan; the state (`expanded` ids) is the app's, saved and restored like any other.
 *
 * Pure and tolerant like every decoder: bad entries drop out, unknown values fall back to the defaults. No DOM, no IO.
 * Fixture: spec/fixtures/grid-rows.json (gen-fixtures.mts). Spec: spec/GRID-ROWS.md. Kotlin twin deferred
 * (spec/PORTING.md, "grid-rows@1").
 */
import { GRID_ROW_LINES_ATTR, GRID_ROW_LINES_DEFAULT, GRID_ROW_LINES_VALUES, GRID_ROW_LINES_VAR, componentTokenValue } from './component-tokens.mjs';

export const GRID_ROWS_CONTRACT = 'grid-rows@1';
/** Lines a collapsed row may show. */
export type GridRowLines = 1 | 2;
export const GRID_ROW_LINES: readonly GridRowLines[] = GRID_ROW_LINES_VALUES as readonly GridRowLines[];
export const GRID_ROWS_DEFAULT_LINES: GridRowLines = GRID_ROW_LINES_DEFAULT as GridRowLines;
/** The variable and the root attribute the lines ride on (component-tokens@1 grid.rowLines). */
export const GRID_ROWS_VAR: string = GRID_ROW_LINES_VAR;
export const GRID_ROWS_ATTR: string = GRID_ROW_LINES_ATTR;
/** Keys that toggle a row's detail (a tap does too). Append-only. */
export const GRID_ROWS_TOGGLE_KEYS: readonly string[] = ['Enter'];
/** The web renderer's classes (framework/ui/axf.css carries a rule for each; the CI check keeps them equal). */
export const GRID_ROWS_CLASSES = {
  root: 'fx-rows',
  item: 'fx-rows__item',
  line: 'fx-rows__line',
  cell: 'fx-rows__cell',
  detail: 'fx-rows__detail',
} as const;
/** Caps: a row keeps this many cells per slot, this much text per cell, this many detail fields, a grid this many items. */
export const GRID_ROWS_MAX_CELLS = 12;
export const GRID_ROWS_MAX_TEXT = 400;
export const GRID_ROWS_MAX_DETAIL_FIELDS = 40;
export const GRID_ROWS_MAX_ITEMS = 5000;

/** One cell of a row: a key (stable within the row), its text, and the full text shown on hover / read out when truncated. */
export interface GridRowCell { key: string; text: string; title?: string }
export interface GridRowDetailField { label: string; value: string }
/** What opens under the row: free text and / or label → value fields. */
export interface GridRowDetail { text?: string; fields?: GridRowDetailField[] }
export interface GridRowItem {
  id: string;
  /** What names the item (always on the first line). */
  primary: GridRowCell[];
  /** What qualifies it (inline after the primary cells on a 1-line row, the second line on a 2-line row). */
  secondary: GridRowCell[];
  /** Everything else; null = the row has nothing to open and never toggles. */
  detail: GridRowDetail | null;
}

/** `inline` = primary + secondary on one line (1-line rows); `primary` / `secondary` = the two lines of a 2-line row. */
export type GridRowLineRole = 'inline' | 'primary' | 'secondary';
export interface GridRowLine { role: GridRowLineRole; cells: GridRowCell[]; /** one line, ellipsis at the end */ truncate: boolean }
export interface GridRowPlan {
  id: string;
  lines: GridRowLines;
  /** The collapsed row: one line (inline) or two (primary, then secondary; one when the item has no secondary cells). */
  collapsed: GridRowLine[];
  /** The row has a detail, so a tap / Enter toggles it. */
  toggles: boolean;
  /** The detail is open under the row. */
  open: boolean;
  detail: GridRowDetail | null;
  /** Attributes the row element carries: the lines hook, role, aria-expanded + tabindex when it toggles. */
  attrs: Record<string, string>;
  /** The row read out / searched: primary texts, then secondary, joined. */
  label: string;
}
/** The app's state: the ids whose detail is open, in the order they were opened. */
export interface GridRowsState { expanded: string[] }
export type GridRowInput = { kind: 'tap' } | { kind: 'key'; key: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'boolean' ? String(v) : null)?.slice(0, max) ?? null;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;

/* ------------------------------------------------------------------ items */

/** One cell from a string / number (text only), or `{ key?, text | value | label, title? }`; null when it has no text. */
export function normalizeGridRowCell(raw: unknown, index: number): GridRowCell | null {
  if (!isObj(raw)) {
    const t = text(raw, GRID_ROWS_MAX_TEXT);
    return t === null || !t.trim() ? null : { key: `c${index}`, text: t };
  }
  const t = text(raw.text ?? raw.value ?? raw.label, GRID_ROWS_MAX_TEXT);
  if (t === null || !t.trim()) return null;
  const key = typeof raw.key === 'string' && KEY.test(raw.key) ? raw.key : `c${index}`;
  const title = text(raw.title, GRID_ROWS_MAX_TEXT);
  return title !== null && title !== t ? { key, text: t, title } : { key, text: t };
}

function cells(raw: unknown): GridRowCell[] {
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  const out: GridRowCell[] = [];
  const seen = new Set<string>();
  for (const [i, c] of list.entries()) {
    if (out.length >= GRID_ROWS_MAX_CELLS) break;
    const cell = normalizeGridRowCell(c, i);
    if (!cell) continue;
    // a repeated key gets the positional one so every cell in the row stays addressable
    if (seen.has(cell.key)) cell.key = `c${i}`;
    seen.add(cell.key);
    out.push(cell);
  }
  return out;
}

/** A detail from a string (text) or `{ text?, fields?: [{ label, value }] | { label: value } }`; null when it holds nothing. */
export function normalizeGridRowDetail(raw: unknown): GridRowDetail | null {
  if (raw === undefined || raw === null) return null;
  if (!isObj(raw)) { const t = text(raw, GRID_ROWS_MAX_TEXT * 4); return t ? { text: t } : null; }
  const out: GridRowDetail = {};
  const t = text(raw.text, GRID_ROWS_MAX_TEXT * 4);
  if (t) out.text = t;
  const fields: GridRowDetailField[] = [];
  const entries: [unknown, unknown][] = Array.isArray(raw.fields)
    ? raw.fields.map((f): [unknown, unknown] => (isObj(f) ? [f.label ?? f.key, f.value ?? f.text] : [null, null]))
    : isObj(raw.fields) ? Object.entries(raw.fields) : [];
  for (const [l, v] of entries) {
    if (fields.length >= GRID_ROWS_MAX_DETAIL_FIELDS) break;
    const label = text(l, 120);
    const value = text(v, GRID_ROWS_MAX_TEXT);
    if (label && value !== null) fields.push({ label, value });
  }
  if (fields.length) out.fields = fields;
  return out.text || out.fields ? out : null;
}

/** One item from `{ id | key, primary, secondary?, detail? }`; null when it has no id source and no cell at all. */
export function normalizeGridRowItem(raw: unknown, index: number): GridRowItem | null {
  if (!isObj(raw)) return null;
  const idRaw = text(raw.id ?? raw.key, 120);
  const primary = cells(raw.primary);
  const secondary = cells(raw.secondary);
  if (!primary.length && !secondary.length) return null;
  return { id: idRaw && idRaw.trim() ? idRaw.trim() : `row-${index}`, primary, secondary, detail: normalizeGridRowDetail(raw.detail) };
}

/** The items of a grid: bad entries drop out, a repeated id keeps its first row, at most GRID_ROWS_MAX_ITEMS. */
export function normalizeGridRows(raw: unknown): GridRowItem[] {
  if (!Array.isArray(raw)) return [];
  const out: GridRowItem[] = [];
  const seen = new Set<string>();
  for (const [i, r] of raw.entries()) {
    if (out.length >= GRID_ROWS_MAX_ITEMS) break;
    const item = normalizeGridRowItem(r, i);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/* ------------------------------------------------------------------ lines */

/** 1 | 2 from a number, its digit as text or the compiled variable's value; anything else = the default 2. */
export function normalizeGridRowLines(raw: unknown): GridRowLines {
  const v = componentTokenValue('lines', raw);
  return v === null ? GRID_ROWS_DEFAULT_LINES : (Number(v) as GridRowLines);
}

/**
 * The lines a grid draws, lowest to highest: the style theme's `grid.rowLines` (the skin's lands there), the root the grid
 * sits under (`data-axf-row-lines` / `--fx-grid-row-lines`, a tab group's or container's customize token), one grid's own
 * override (control@1 tokens.instances `grid.<id>.rowLines`). The first valid value from the top wins; none = 2.
 */
export function resolveGridRowLines(sources: { instance?: unknown; root?: unknown; theme?: unknown } | null | undefined): GridRowLines {
  for (const raw of [sources?.instance, sources?.root, sources?.theme]) {
    const v = componentTokenValue('lines', raw);
    if (v !== null) return Number(v) as GridRowLines;
  }
  return GRID_ROWS_DEFAULT_LINES;
}

/** The attribute hook a grid root (or the document root) carries for its lines. */
export function gridRowsRootAttrs(lines: GridRowLines): Record<string, string> {
  return { [GRID_ROWS_ATTR]: String(normalizeGridRowLines(lines)) };
}

/* ------------------------------------------------------------------ state */

/** `{ expanded: string[] }`: unique non-empty ids, order kept; anything else = nothing open. */
export function normalizeGridRowsState(raw: unknown): GridRowsState {
  const list = isObj(raw) && Array.isArray(raw.expanded) ? raw.expanded : Array.isArray(raw) ? raw : [];
  const expanded: string[] = [];
  for (const v of list) if (typeof v === 'string' && v.trim() && !expanded.includes(v)) expanded.push(v);
  return { expanded };
}

export function gridRowOpen(state: GridRowsState | null | undefined, id: string): boolean {
  return !!state?.expanded.includes(id);
}

/** Toggle one row's detail. The same state object comes back when the item has no detail (nothing to open). */
export function gridRowToggle(state: GridRowsState, item: GridRowItem): GridRowsState {
  if (!item.detail) return state;
  const s = normalizeGridRowsState(state);
  return gridRowOpen(s, item.id) ? { expanded: s.expanded.filter((x) => x !== item.id) } : { expanded: [...s.expanded, item.id] };
}

/** Every detail closed. */
export function gridRowsCollapseAll(_state: GridRowsState | null | undefined): GridRowsState {
  return { expanded: [] };
}

/** Does this input toggle a row? A tap always; a key only when it is one of GRID_ROWS_TOGGLE_KEYS. */
export function gridRowInputToggles(input: GridRowInput): boolean {
  return input.kind === 'tap' || (input.kind === 'key' && GRID_ROWS_TOGGLE_KEYS.includes(input.key));
}

/**
 * The state after an input on a row: a tap or Enter toggles the detail (open ↔ closed); every other key leaves the state
 * as it is, and so does any input on a row without a detail. Returns the same object when nothing changed.
 */
export function gridRowInput(state: GridRowsState, item: GridRowItem, input: GridRowInput): GridRowsState {
  return gridRowInputToggles(input) ? gridRowToggle(state, item) : state;
}

/* ------------------------------------------------------------------ plan */

/** The collapsed lines of an item for a count of lines: one inline line, or primary then secondary (one when no secondary). */
export function gridRowCollapsedLines(item: GridRowItem, lines: GridRowLines): GridRowLine[] {
  if (normalizeGridRowLines(lines) === 1) return [{ role: 'inline', cells: [...item.primary, ...item.secondary], truncate: true }];
  const out: GridRowLine[] = [{ role: 'primary', cells: item.primary, truncate: true }];
  if (item.secondary.length) out.push({ role: 'secondary', cells: item.secondary, truncate: true });
  return out;
}

/** The row read out / searched: primary texts, then secondary, " · " between. */
export function gridRowLabel(item: GridRowItem): string {
  return [...item.primary, ...item.secondary].map((c) => c.text).filter(Boolean).join(' · ');
}

/** Everything a renderer draws for one row at `lines`, given the app's state. */
export function gridRowPlan(item: GridRowItem, lines: GridRowLines, state: GridRowsState | null | undefined): GridRowPlan {
  const n = normalizeGridRowLines(lines);
  const toggles = item.detail !== null;
  const open = toggles && gridRowOpen(state, item.id);
  const attrs: Record<string, string> = { role: 'row', [GRID_ROWS_ATTR]: String(n), 'data-fx-row': item.id };
  if (toggles) { attrs['aria-expanded'] = String(open); attrs.tabindex = '0'; }
  return { id: item.id, lines: n, collapsed: gridRowCollapsedLines(item, n), toggles, open, detail: open ? item.detail : null, attrs, label: gridRowLabel(item) };
}

/** The plan of every row of a grid. */
export function gridRowsPlan(items: readonly GridRowItem[], lines: GridRowLines, state: GridRowsState | null | undefined): GridRowPlan[] {
  return items.map((item) => gridRowPlan(item, lines, state));
}

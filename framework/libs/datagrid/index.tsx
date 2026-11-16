/**
 * lib-datagrid — categorized grid (library@1 `ai.amberx.axf.datagrid`). The app gives groups (with rows and sub-groups)
 * and column definitions with a renderer each; the grid draws the header, the group headers with totals and a meter, the
 * rows (status edge, selection) and an expandable detail. Column visibility, sort and expanded rows are the app's state,
 * reported through callbacks, so it can keep them wherever it likes. The header's context menu (target
 * `axf-grid-header:<grid id>`, payload = column id) hides and shows columns; drag uses lib-dnd.
 * Parts (installed config `libraries.datagrid.parts`): groups, column-menu {hidden}, sort, expand, drag {trash}, compact.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { ControlScope, Icon, IconButton, Meter, Slot, escapeSelector, useControlTarget, useControlTargets, useRuntime, type ControlTargetDef } from '../../react';
import type { AxfWebLibrary } from '../../react/library';
import { partOn, partParams, type LibraryPart } from '../../core/library';
import { INSTANCE_TOKENS_KEY, instanceTokenVars } from '../../core/engines/component-tokens.mjs';
import { registerZone, startDrag, type DropPos } from '../dnd';
import spec from './library.json';
import { anyRowHooks, applyDataset, DATASET_TOOLBAR_SLOT, datasetFiltered, noteDrawnRef, registerRowRefTarget, rowHooks, rowRefForContext, runRowHook, useDataset, useDatasetsRevision, type DatasetField, type RowRef } from './datasets';
export * from './datasets';
import './datagrid.css';

export const DATAGRID_LIBRARY_ID = 'ai.amberx.axf.datagrid';
const PARTS = (spec as { parts: LibraryPart[] }).parts;
export interface DataGridConfig { groups: boolean; columnMenu: false | { hidden: string[] }; sort: boolean; expand: boolean; drag: false | { trash: boolean }; compact: boolean }
let config: DataGridConfig = { groups: true, columnMenu: { hidden: [] }, sort: true, expand: true, drag: { trash: true }, compact: false };
export function configureDataGrid(installed: { parts?: Record<string, unknown> } | null | undefined): DataGridConfig {
  const pp = (id: string) => partParams(installed, id, PARTS.find((p) => p.id === id));
  config = {
    groups: partOn(installed, 'groups', PARTS),
    columnMenu: partOn(installed, 'column-menu', PARTS) ? { hidden: (pp('column-menu').hidden as string[] | null) ?? [] } : false,
    sort: partOn(installed, 'sort', PARTS), expand: partOn(installed, 'expand', PARTS),
    drag: partOn(installed, 'drag', PARTS) ? { trash: pp('drag').trash !== false } : false,
    compact: partOn(installed, 'compact', PARTS),
  };
  return config;
}
export const dataGridConfig = () => config;

export interface GridColumn<R> {
  id: string; label: string;
  /** a CSS grid track (tokens, e.g. `calc(var(--fx-space) * 12)` or `minmax(…, 3fr)`) */
  width: string;
  /** always shown (the title column) */
  fixed?: boolean;
  sortable?: boolean;
  align?: 'end';
  sortValue?: (r: R) => number | string;
  render: (r: R) => ReactNode;
}
export interface GridGroup<R> { id: string; title: string; icon?: string; collapsed?: boolean; rows: R[]; groups: GridGroup<R>[]; summary?: ReactNode; progress?: number; counts?: ReactNode; ctx?: { target: string; payload?: string }; fixed?: boolean }
export type GridSort = { col: string; dir: 1 | -1 } | null;
export interface DataGridProps<R> {
  id: string;
  label?: string;
  groups: GridGroup<R>[];
  columns: GridColumn<R>[];
  rowId: (r: R) => string;
  rowLabel?: (r: R) => string;
  hidden: readonly string[];
  onToggleColumn?: (col: string, show?: boolean) => void;
  onShowAll?: () => void;
  onChooseColumns?: () => void;
  sort?: GridSort;
  onSort?: (col: string | null) => void;
  expanded?: readonly string[];
  onToggleExpand?: (id: string) => void;
  renderDetail?: (r: R) => ReactNode;
  /** status edge tone: muted / success / accent / danger / warning / info */
  rowTone?: (r: R) => string;
  selected?: string | null;
  multi?: readonly string[];
  onRowClick?: (r: R, e: RMouseEvent) => void;
  onToggleGroup?: (id: string) => void;
  onGroupClick?: (id: string) => void;
  rowCtx?: (r: R) => { target: string; payload?: string };
  /**
   * What the row stands for (grid-hook@1, datasets.ts → row hooks): `{ kind, id }`, e.g. `{ kind: 'pending', id }`.
   * Plugins' row hooks for that kind draw a button on the row and an item in its right-click menu.
   */
  rowRef?: (r: R) => RowRef | null;
  compact?: boolean;
  /**
   * Lines per row (1 or 2). 2: the fixed (primary) columns fill line 1 across the row, every other column sits on line 2
   * in its own track, the header the same way. Unset: the grid's setting `axf.grid.rowLines.<id>`, else `axf.grid.rowLines`, else 1.
   */
  rowLines?: GridRowLines;
  /**
   * console-control@1 (react/controlTargets.ts): the grid is `grid:<id>`, every row `grid:<id>/row:<row id>`; `step` makes rows
   * `step:<row id>` directly under the enclosing scope (a build's steps inside its row: `…/row:<build>/step:s3`).
   */
  rowKind?: 'row' | 'step';
  /** drag: what moved where (row / group, before / after / inside a group) */
  onMove?: (item: { kind: 'row' | 'group'; id: string }, target: { kind: 'row' | 'group'; id: string }, pos: DropPos) => void;
  onTrash?: (item: { kind: 'row' | 'group'; id: string; label: string }) => void;
  /** lib-dnd zone (rows of another component can share it) */
  zone?: string;
  empty?: ReactNode;
  /**
   * Every grid is a dataset plugins can attach to (filters, sorts, a toolbar above it; see datasets.ts). Default: the
   * grid's id. A string uses another dataset id; `false` keeps the grid out of the dataset registry.
   */
  dataset?: string | false;
}

/** A column's value for dataset filters: its sortValue, else a plain field of the row with the column's id. */
function columnFields<R>(columns: GridColumn<R>[]): DatasetField<R>[] {
  return columns.map((c) => ({
    id: c.id, label: c.label,
    value: (r: R) => {
      if (c.sortValue) return c.sortValue(r);
      const v = (r as Record<string, unknown> | null)?.[c.id];
      return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null;
    },
  }));
}
const flatRows = <R,>(gs: GridGroup<R>[]): R[] => gs.flatMap((g) => [...g.rows, ...flatRows(g.groups)]);

/** The grip track (drag handle, nesting indent) before the columns, and the tail track after them (expand + row hooks). */
export const GRID_GRIP = 'calc(var(--fx-space) * 3)';
export const GRID_TAIL = 'calc(var(--fx-space) * 4)';
/** With row hooks the tail holds a varying number of buttons: one shared track as wide as the widest row's (cells never size themselves). */
export const GRID_TAIL_HOOKS = 'max-content';
/**
 * The grid's one column definition: grip, every shown column's width in order, tail. Set on the grid root; the header and
 * every row are subgrids of it, so all of them share the same tracks.
 */
export function gridTemplate(widths: readonly string[], tail: string = GRID_TAIL): string {
  return [GRID_GRIP, ...widths, tail].join(' ');
}

export type GridRowLines = 1 | 2;
/** Settings: every grid's lines per row, and one grid's own (`axf.grid.rowLines.<grid id>`, wins). */
export const GRID_ROW_LINES_KEY = 'axf.grid.rowLines';
export const gridRowLinesKey = (gridId: string) => `${GRID_ROW_LINES_KEY}.${gridId}`;
const asLines = (v: unknown): GridRowLines | null => (v === 2 || v === '2' ? 2 : v === 1 || v === '1' ? 1 : null);
/** Lines per row in force for one grid: its prop, its own setting, the setting for every grid, else 1. */
export function resolveGridRowLines(prop: unknown, own: unknown, all: unknown): GridRowLines {
  return asLines(prop) ?? asLines(own) ?? asLines(all) ?? 1;
}
/** Which columns sit on line 1 in 2-line mode: the fixed ones, else the first. */
export function primaryColumns<C extends { id: string; fixed?: boolean }>(cols: readonly C[]): Set<string> {
  const fixed = cols.filter((c) => c.fixed).map((c) => c.id);
  return new Set(fixed.length ? fixed : cols.slice(0, 1).map((c) => c.id));
}
/** A track function (minmax(), fr, auto, content keywords) can't be a flex basis; a plain length can. */
const isTrackFunction = (w: string) => /minmax\(|fit-content\(|\dfr\b|^auto$|content$/.test(w.trim());
/** A primary cell inside line 1 of a 2-line row (the same style on the header, so they line up): a fixed basis, or the rest of the line. */
export const primaryCellStyle = (width: string): CSSProperties => (isTrackFunction(width) ? { flex: '1 1 0', minWidth: 0 } : { flex: `0 0 ${width}`, minWidth: 0 });
/** The filler track in 2-line mode: line 2's columns keep their own widths, the rest of the row's width goes here. */
export const GRID_FILL = 'minmax(0, 1fr)';

type Line<R> = { kind: 'group'; g: GridGroup<R>; depth: number } | { kind: 'row'; r: R; depth: number };

export function DataGrid<R>(p: DataGridProps<R>) {
  const rt = useRuntime();
  const zone = p.zone ?? `axf-grid:${p.id}`;
  const drag = config.drag && p.onMove ? config.drag : false;
  const cols = p.columns.filter((c) => c.fixed || !config.columnMenu || !p.hidden.includes(c.id));
  useDatasetsRevision(); // row hooks registered later redraw the grid
  const tail = p.rowRef && anyRowHooks() ? GRID_TAIL_HOOKS : GRID_TAIL;
  // component-tokens@1: this one grid's own token values (axf.tokens.instances → --fx-grid-* on the element) win over the skin's
  const [, tokensTick] = useState(0);
  useEffect(() => rt.settings.onChange(INSTANCE_TOKENS_KEY, () => tokensTick((n) => n + 1)), [rt]);
  const [, linesTick] = useState(0);
  useEffect(() => { const t = () => linesTick((n) => n + 1); const a = rt.settings.onChange(GRID_ROW_LINES_KEY, t), b = rt.settings.onChange(gridRowLinesKey(p.id), t); return () => { a(); b(); }; }, [rt, p.id]);
  const rowLines = resolveGridRowLines(p.rowLines, rt.settings.get(gridRowLinesKey(p.id)), rt.settings.get(GRID_ROW_LINES_KEY));
  const primary = rowLines === 2 ? primaryColumns(cols) : new Set<string>();
  const lead = rowLines === 2 ? cols.filter((c) => primary.has(c.id)) : [], rest = rowLines === 2 ? cols.filter((c) => !primary.has(c.id)) : cols;
  // 1 line: every column is a track. 2 lines: line 1 is the primary columns across the row, line 2 the others in their own tracks.
  const columnsTemplate = rowLines === 2 ? gridTemplate([...rest.map((c) => c.width), GRID_FILL], tail) : gridTemplate(cols.map((c) => c.width), tail);
  const layout: GridLayout<R> = { lines: rowLines, lead, rest };
  const template = { gridTemplateColumns: columnsTemplate, ...instanceTokenVars(rt.settings.get(INSTANCE_TOKENS_KEY), 'grid', p.id) } as CSSProperties;
  const headerTarget = `axf-grid-header:${p.id}`;
  const dsId = p.dataset === false ? '' : p.dataset ?? p.id;
  const all = useMemo(() => flatRows(p.groups), [p.groups]);
  const fields = useMemo(() => columnFields(p.columns), [p.columns]);
  const dsInfo = { id: dsId, label: p.label ?? p.id, fields, rows: all, ...(p.rowLabel ? { rowText: (r: R) => `${p.rowLabel!(r)} ${fields.map((f) => f.value(r) ?? '').join(' ')}` } : {}) };
  useDataset(dsInfo); // no id (dataset={false}) = not registered
  const filtered = dsId ? datasetFiltered(dsId) : false;

  useEffect(() => {
    if (!config.columnMenu || !p.onToggleColumn) return;
    rt.contextExtras.set(headerTarget, (_t, col = '') => {
      const c = p.columns.find((x) => x.id === col);
      return [
        ...(c?.sortable && config.sort && p.onSort ? [{ id: 'sort', label: `Sort by ${c.label}`, icon: 'list', action: `axf.grid.do:${p.id}:sort:${col}` }, { id: 'unsort', label: 'Original order', icon: 'list', action: `axf.grid.do:${p.id}:unsort` }, { id: 's0', separator: true }] : []),
        ...(c && !c.fixed ? [{ id: 'hide', label: `Hide ${c.label}`, icon: 'eye', action: `axf.grid.do:${p.id}:col:${col}` }] : []),
        { id: 'cols', label: 'Columns', icon: 'list', items: p.columns.filter((x) => !x.fixed).map((x) => ({ id: `c-${x.id}`, label: x.label, icon: p.hidden.includes(x.id) ? 'minus' : 'check', action: `axf.grid.do:${p.id}:col:${x.id}` })) },
        { id: 'all', label: 'Show every column', icon: 'eye', action: `axf.grid.do:${p.id}:all` },
        ...(p.onChooseColumns ? [{ id: 'choose', label: 'Choose columns…', icon: 'sliders', action: `axf.grid.do:${p.id}:choose` }] : []),
      ];
    });
    grids.set(p.id, { col: (c) => p.onToggleColumn!(c), all: () => p.onShowAll?.(), choose: () => p.onChooseColumns?.(), sort: (c) => p.onSort?.(c) });
    return () => { rt.contextExtras.delete(headerTarget); grids.delete(p.id); };
  });
  useEffect(() => {
    if (!drag) return;
    return registerZone(zone, {
      accepts: (d, t) => (d.kind === `${zone}:row` || d.kind === `${zone}:group`) && d.id !== t.split(':')[1],
      positions: (_d, t) => (t.startsWith('row:') ? ['before', 'after'] : ['before', 'inside', 'after']),
      drop: (d, t, pos) => { const [kind, id] = t.split(':') as ['row' | 'group', string]; p.onMove!({ kind: d.kind.endsWith(':row') ? 'row' : 'group', id: d.id }, { kind, id }, pos); },
    });
  }, [zone, drag, p.onMove]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines: Line<R>[] = [];
  const walk = (g: GridGroup<R>, depth: number) => {
    if (config.groups) lines.push({ kind: 'group', g, depth });
    if (g.collapsed && config.groups) return;
    let rows = dsId ? applyDataset(dsId, g.rows) : g.rows;
    const s = config.sort ? p.sort : null;
    const col = s ? p.columns.find((c) => c.id === s.col) : undefined;
    if (s && col?.sortValue) rows = [...rows].sort((a, b) => { const x = col.sortValue!(a), y = col.sortValue!(b); return (x < y ? -1 : x > y ? 1 : 0) * s.dir; });
    for (const r of rows) lines.push({ kind: 'row', r, depth });
    for (const c of g.groups) walk(c, depth + 1);
  };
  p.groups.forEach((g) => walk(g, 0));

  // console-control@1: the grid and every row are targets. Rows a collapsed group or a dataset filter hides are virtual:
  // focus expands the group first. focus with select clicks the row (the app's own selection), expand opens its detail.
  const gridRef = useRef<HTMLDivElement>(null);
  const rowKind = p.rowKind ?? 'row';
  const shownIds = new Set(lines.filter((l): l is { kind: 'row'; r: R; depth: number } => l.kind === 'row').map((l) => p.rowId(l.r)));
  const rowEl = (id: string) => gridRef.current?.querySelector<HTMLElement>(`[data-axf-row="${escapeSelector(id)}"]`) ?? null;
  const rowDefs: ControlTargetDef[] = [];
  const collect = (g: GridGroup<R>, collapsed: string[]) => {
    const folded = g.collapsed && config.groups ? [...collapsed, g.id] : collapsed;
    for (const r of g.rows) {
      const id = p.rowId(r);
      const virtual = folded.length > 0 || !shownIds.has(id);
      rowDefs.push({
        address: rowKind === 'step' ? `step:${id}` : `grid:${p.id}/row:${id}`, kind: rowKind, label: p.rowLabel?.(r) ?? id, detail: p.label ?? p.id, keywords: [g.title, ...fields.map((f) => String(f.value(r) ?? '')).filter(Boolean)].slice(0, 12),
        virtual, element: () => rowEl(id),
        materialize: folded.length ? () => { for (const gid of folded) p.onToggleGroup?.(gid); } : undefined,
        select: p.onRowClick ? () => rowEl(id)?.click() : undefined,
        expand: config.expand && p.renderDetail && p.onToggleExpand ? () => { if (!p.expanded?.includes(id)) p.onToggleExpand!(id); } : undefined,
        get: () => p.selected === id, isDisabled: () => false,
        state: () => ({ group: g.title, expanded: !!p.expanded?.includes(id), selected: p.selected === id, shown: shownIds.has(id), fields: Object.fromEntries(fields.map((f) => [f.id, f.value(r) ?? null])) }),
      });
    }
    for (const c of g.groups) collect(c, folded);
  };
  p.groups.forEach((g) => collect(g, []));
  useControlTargets(rowDefs, `${rowKind}|${p.id}|${rowDefs.map((d) => `${d.address}:${d.virtual ? 'v' : ''}`).join('|')}`);
  useControlTarget({
    address: `grid:${p.id}`, kind: 'grid', label: p.label ?? p.id, keywords: ['grid', 'table', 'list'], element: () => gridRef.current,
    get: () => p.selected ?? null,
    set: (v) => { const id = String(v ?? ''); const el = rowEl(id); if (!el) return `no row ${id} in ${p.label ?? p.id}`; if (!p.onRowClick) return `${p.label ?? p.id} has no selection`; el.click(); return undefined; },
    state: () => ({ rows: all.length, shown: shownIds.size, selected: p.selected ?? null, expanded: p.expanded ?? [], groups: p.groups.map((g) => ({ id: g.id, title: g.title, collapsed: !!g.collapsed, rows: g.rows.length })), columns: cols.map((c) => c.id), sort: p.sort ?? null }),
  }, [p.id]);
  const dragFor = (kind: 'row' | 'group', id: string, label: string, icon: string) => (drag ? {
    onPointerDown: (e: RPointerEvent) => startDrag(e, { kind: `${zone}:${kind}`, id, label, icon, trashable: !!(drag.trash && p.onTrash), onTrash: p.onTrash ? () => p.onTrash!({ kind, id, label }) : undefined }),
  } : {});

  // a cell's track is explicit (grip = 1, then the columns in order) so auto-placement never moves it, on line 1 or 2
  const headCell = (c: GridColumn<R>, style?: CSSProperties, track?: number) => (
    <button key={c.id} type="button" role="columnheader" style={style ?? { gridColumn: track! + 2 }} className={`fx-btn fx-btn--sm fx-btn--quiet axf-grid-hcell ${c.align === 'end' ? 'is-end' : ''} ${rowLines === 2 && !style ? 'is-line2' : ''}`}
      data-fx-ctx-target={config.columnMenu ? headerTarget : undefined} data-fx-ctx-payload={c.id} data-axf-col={c.id}
      aria-sort={p.sort?.col === c.id ? (p.sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
      onClick={() => config.sort && c.sortable && p.onSort?.(c.id)} title={config.columnMenu ? 'Click to sort · right-click for columns' : undefined}>
      {c.label}{p.sort?.col === c.id && <Icon name={p.sort.dir === 1 ? 'chevron-up' : 'chevron-down'} size={12} />}
    </button>
  );
  const grid = (
    <div ref={gridRef} className={`axf-grid ${p.compact ? 'is-compact' : ''}`} style={template} role="grid" aria-label={p.label ?? 'Grid'} data-axf-dataset={dsId || undefined} data-axf-grid={p.id} data-axf-row-lines={rowLines}>
      <div className="axf-grid-head" role="row">
        <span className="axf-grid-grip" />
        {rowLines === 2 ? <span className="axf-grid-lead">{lead.map((c) => headCell(c, primaryCellStyle(c.width)))}</span> : null}
        {rest.map((c, i) => headCell(c, undefined, i))}
        {config.columnMenu ? <span className="axf-grid-tail"><IconButton icon="more" label="Columns" onClick={(e) => rt.openContext(e.clientX, e.clientY, headerTarget, '')} /></span> : <span className="axf-grid-tail" />}
      </div>
      {lines.map((l) => l.kind === 'group' ? (
        <div key={`g-${l.g.id}`} className={`axf-grid-group axf-grid-group--d${Math.min(l.depth, 3)}`} role="row" data-axf-drop={drag ? zone : undefined} data-axf-drop-id={`group:${l.g.id}`}
          data-fx-ctx-target={l.g.ctx?.target} data-fx-ctx-payload={l.g.ctx?.payload} style={{ paddingInlineStart: `calc(var(--fx-space) * ${l.depth * 2})` }}
          {...(l.g.fixed ? {} : dragFor('group', l.g.id, l.g.title, 'folder'))}>
          <span className="axf-dnd-grip"><Icon name="more" size={12} /></span>
          <IconButton icon={l.g.collapsed ? 'chevron-right' : 'chevron-down'} label={l.g.collapsed ? 'Expand' : 'Collapse'} onClick={() => p.onToggleGroup?.(l.g.id)} />
          <Icon name={l.g.icon ?? 'folder'} size={14} />
          <button type="button" data-fx-row className="axf-grid-gtitle" onClick={() => p.onGroupClick?.(l.g.id)}>{l.g.title}</button>
          {l.g.summary != null && <span className="axf-grid-gsummary">{l.g.summary}</span>}
          {l.g.progress != null && <span className="axf-grid-gmeter"><Meter value={l.g.progress} small done={l.g.progress >= 100} label={`${Math.round(l.g.progress)}%`} /></span>}
          {l.g.counts}
        </div>
      ) : (
        <Row key={p.rowId(l.r)} p={p} r={l.r} depth={l.depth} layout={layout} dragProps={dragFor('row', p.rowId(l.r), p.rowLabel?.(l.r) ?? p.rowId(l.r), 'file')} drop={drag ? zone : undefined} />
      ))}
      {!lines.length && <div className="axf-grid-empty">{p.empty ?? 'Nothing to show.'}</div>}
      {lines.length > 0 && filtered && !lines.some((l) => l.kind === 'row') && <div className="axf-grid-empty">No rows match the filter.</div>}
    </div>
  );
  // plugins attached to this dataset draw above it (a toolbar, chips); nothing contributed = just the grid
  return dsId ? <><Slot name={DATASET_TOOLBAR_SLOT} props={{ dataset: dsId, label: p.label ?? p.id }} />{grid}</> : grid;
}

interface GridLayout<R> { lines: GridRowLines; lead: GridColumn<R>[]; rest: GridColumn<R>[] }

function Row<R>({ p, r, depth, layout, dragProps, drop }: { p: DataGridProps<R>; r: R; depth: number; layout: GridLayout<R>; dragProps: { onPointerDown?: (e: RPointerEvent) => void }; drop?: string }) {
  const id = p.rowId(r);
  const open = config.expand && !!p.expanded?.includes(id);
  const ref = p.rowRef?.(r) ?? null;
  const ctx = p.rowCtx?.(r) ?? (ref ? { target: ROW_TARGET, payload: `${ref.kind}:${ref.id}` } : undefined);
  if (ref && ctx) noteDrawnRef(ctx.target, ctx.payload ?? '', ref, p.dataset === false ? undefined : p.dataset ?? p.id);
  // the row's buttons and its detail (a nested grid, say) compose under the row's address (console-control@1)
  const rowScope = (p.rowKind ?? 'row') === 'step' ? `step:${id}` : `grid:${p.id}/row:${id}`;
  const cell = (c: GridColumn<R>, style?: CSSProperties, track?: number) => <span key={c.id} role="gridcell" style={style ?? { gridColumn: track! + 2 }} data-axf-col={c.id} className={`axf-grid-cell ${c.align === 'end' ? 'is-end' : ''} ${layout.lines === 2 && !style ? 'is-line2' : ''}`}>{c.render(r)}</span>;
  const expand = config.expand && p.renderDetail ? <IconButton icon={open ? 'chevron-up' : 'chevron-down'} label={open ? 'Collapse row' : 'Expand row'} onClick={(e) => { e.stopPropagation(); p.onToggleExpand?.(id); }} /> : null;
  return (
    <>
      <div className={`axf-grid-row ${p.selected === id ? 'is-active' : ''} ${p.multi?.includes(id) ? 'is-multi' : ''} axf-grid-edge--${p.rowTone?.(r) ?? 'muted'}`} role="row" aria-selected={p.selected === id}
        data-axf-drop={drop} data-axf-drop-id={`row:${id}`} data-axf-row={id} data-fx-ctx-target={ctx?.target} data-fx-ctx-payload={ctx?.payload}
        {...dragProps} onClick={(e) => p.onRowClick?.(r, e)} onDoubleClick={() => config.expand && p.onToggleExpand?.(id)}>
        <ControlScope address={rowScope}>
          <span className="axf-grid-grip"><span className="axf-dnd-grip" style={{ marginInlineStart: `calc(var(--fx-space) * ${depth * 2})` }}><Icon name="more" size={12} /></span></span>
          {layout.lines === 2 ? <span className="axf-grid-lead">{layout.lead.map((c) => cell(c, primaryCellStyle(c.width)))}</span> : null}
          {layout.rest.map((c, i) => cell(c, undefined, i))}
          <span className="axf-grid-tail">{ref ? <RowHookButtons rowRef={ref} dataset={p.dataset === false ? undefined : p.dataset ?? p.id} /> : null}{expand}</span>
        </ControlScope>
      </div>
      {open && p.renderDetail && <div className="axf-grid-detail" role="row"><ControlScope address={rowScope}>{p.renderDetail(r)}</ControlScope></div>}
    </>
  );
}

/** Context target of DataGrid rows that give a `rowRef` and no `rowCtx` (payload `<kind>:<id>`). */
export const ROW_TARGET = 'axf-grid-row';

/**
 * The row hooks' buttons for one row (grid-hook@1). DataGrid draws them for every row with a `rowRef`; other lists and
 * cards draw this component themselves. Nothing registered = nothing drawn.
 */
export function RowHookButtons({ rowRef, dataset, size }: { rowRef: RowRef | null | undefined; dataset?: string; size?: number }) {
  useDatasetsRevision();
  const hs = rowHooks(rowRef, { buttons: true });
  if (!rowRef || !hs.length) return null;
  return <span className="axf-grid-hooks">{hs.map((h) => <IconButton key={h.id} icon={h.icon ?? 'link'} size={size} label={`${h.label}: ${rowRef.id}`} title={h.label} onClick={(e) => { e.stopPropagation(); h.run(rowRef, { dataset }); }} />)}</span>;
}

/** header-menu actions of the grids on screen (one action, `axf.grid.do:<grid>:<what>[:<col>]`) */
const grids = new Map<string, { col: (c: string) => void; all: () => void; choose: () => void; sort: (c: string | null) => void }>();

export const library: AxfWebLibrary = {
  id: DATAGRID_LIBRARY_ID,
  label: 'Data grid',
  version: '0.1.0',
  provides: ['axf.datagrid'],
  register(rt) {
    configureDataGrid((rt.manifest as { libraries?: Record<string, { parts?: Record<string, unknown> }> }).libraries?.datagrid);
    rt.actions.register('axf.grid.do', ([grid = '', what = '', col = '']) => {
      const g = grids.get(grid); if (!g) return;
      if (what === 'col') g.col(col); else if (what === 'all') g.all(); else if (what === 'choose') g.choose(); else if (what === 'sort') g.sort(col); else if (what === 'unsort') g.sort(null);
    }, { label: 'Grid columns', params: true } as never);
    // row hooks (grid-hook@1): right-click / long-press on any row whose ref is known lists the hooks for its kind
    registerRowRefTarget(ROW_TARGET, (payload) => { const i = payload.indexOf(':'); return i > 0 ? { kind: payload.slice(0, i), id: payload.slice(i + 1) } : null; });
    rt.contextExtras.set('*:axf.row-hooks', (target, payload) => {
      const ref = rowRefForContext(target, payload); if (!ref) return [];
      return rowHooks(ref).map((h) => ({ id: `row-hook-${h.id}`, label: h.label, icon: h.icon ?? 'link', action: `axf.grid.hook:${encodeURIComponent(h.id)}:${encodeURIComponent(ref.kind)}:${encodeURIComponent(ref.id)}:${encodeURIComponent(ref.dataset ?? '')}` }));
    });
    rt.actions.register('axf.grid.hook', ([hook = '', kind = '', id = '', dataset = '']) => {
      const d = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };
      runRowHook(d(hook), { kind: d(kind), id: d(id) }, d(dataset) ? { dataset: d(dataset) } : {});
    }, { label: 'Row hook', params: true } as never);
  },
};

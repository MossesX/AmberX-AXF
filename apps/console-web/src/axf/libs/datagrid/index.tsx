/**
 * lib-datagrid — categorized grid (library@1 `ai.amberx.axf.datagrid`). The app gives groups (with rows and sub-groups)
 * and column definitions with a renderer each; the grid draws the header, the group headers with totals and a meter, the
 * rows (status edge, selection) and an expandable detail. Column visibility, sort and expanded rows are the app's state,
 * reported through callbacks, so it can keep them wherever it likes. The header's context menu (target
 * `axf-grid-header:<grid id>`, payload = column id) hides and shows columns; drag uses lib-dnd.
 * Parts (installed config `libraries.datagrid.parts`): groups, column-menu {hidden}, sort, expand, drag {trash}, compact.
 */
import { useEffect, type CSSProperties, type ReactNode, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { Icon, IconButton, Meter, useRuntime } from '../../react';
import type { AxfWebLibrary } from '../../react/library';
import { partOn, partParams, type LibraryPart } from '../../core/library';
import { registerZone, startDrag, type DropPos } from '../dnd';
import spec from './library.json';
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
  compact?: boolean;
  /** drag: what moved where (row / group, before / after / inside a group) */
  onMove?: (item: { kind: 'row' | 'group'; id: string }, target: { kind: 'row' | 'group'; id: string }, pos: DropPos) => void;
  onTrash?: (item: { kind: 'row' | 'group'; id: string; label: string }) => void;
  /** lib-dnd zone (rows of another component can share it) */
  zone?: string;
  empty?: ReactNode;
}

type Line<R> = { kind: 'group'; g: GridGroup<R>; depth: number } | { kind: 'row'; r: R; depth: number };

export function DataGrid<R>(p: DataGridProps<R>) {
  const rt = useRuntime();
  const zone = p.zone ?? `axf-grid:${p.id}`;
  const drag = config.drag && p.onMove ? config.drag : false;
  const cols = p.columns.filter((c) => c.fixed || !config.columnMenu || !p.hidden.includes(c.id));
  const template = { '--axf-grid-cols': `calc(var(--fx-space) * 3) ${cols.map((c) => c.width).join(' ')} calc(var(--fx-space) * 4)` } as CSSProperties;
  const headerTarget = `axf-grid-header:${p.id}`;

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
    let rows = g.rows;
    const s = config.sort ? p.sort : null;
    const col = s ? p.columns.find((c) => c.id === s.col) : undefined;
    if (s && col?.sortValue) rows = [...rows].sort((a, b) => { const x = col.sortValue!(a), y = col.sortValue!(b); return (x < y ? -1 : x > y ? 1 : 0) * s.dir; });
    for (const r of rows) lines.push({ kind: 'row', r, depth });
    for (const c of g.groups) walk(c, depth + 1);
  };
  p.groups.forEach((g) => walk(g, 0));
  const dragFor = (kind: 'row' | 'group', id: string, label: string, icon: string) => (drag ? {
    onPointerDown: (e: RPointerEvent) => startDrag(e, { kind: `${zone}:${kind}`, id, label, icon, trashable: !!(drag.trash && p.onTrash), onTrash: p.onTrash ? () => p.onTrash!({ kind, id, label }) : undefined }),
  } : {});

  return (
    <div className={`axf-grid ${p.compact ? 'is-compact' : ''}`} style={template} role="grid" aria-label={p.label ?? 'Grid'}>
      <div className="axf-grid-head" role="row">
        <span />
        {cols.map((c) => (
          <button key={c.id} type="button" role="columnheader" className={`fx-btn fx-btn--sm fx-btn--quiet axf-grid-hcell ${c.align === 'end' ? 'is-end' : ''}`}
            data-fx-ctx-target={config.columnMenu ? headerTarget : undefined} data-fx-ctx-payload={c.id}
            aria-sort={p.sort?.col === c.id ? (p.sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
            onClick={() => config.sort && c.sortable && p.onSort?.(c.id)} title={config.columnMenu ? 'Click to sort · right-click for columns' : undefined}>
            {c.label}{p.sort?.col === c.id && <Icon name={p.sort.dir === 1 ? 'chevron-up' : 'chevron-down'} size={12} />}
          </button>
        ))}
        {config.columnMenu ? <IconButton icon="more" label="Columns" onClick={(e) => rt.openContext(e.clientX, e.clientY, headerTarget, '')} /> : <span />}
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
        <Row key={p.rowId(l.r)} p={p} r={l.r} depth={l.depth} cols={cols} dragProps={dragFor('row', p.rowId(l.r), p.rowLabel?.(l.r) ?? p.rowId(l.r), 'file')} drop={drag ? zone : undefined} />
      ))}
      {!lines.length && <div className="axf-grid-empty">{p.empty ?? 'Nothing to show.'}</div>}
    </div>
  );
}

function Row<R>({ p, r, depth, cols, dragProps, drop }: { p: DataGridProps<R>; r: R; depth: number; cols: GridColumn<R>[]; dragProps: { onPointerDown?: (e: RPointerEvent) => void }; drop?: string }) {
  const id = p.rowId(r);
  const open = config.expand && !!p.expanded?.includes(id);
  const ctx = p.rowCtx?.(r);
  return (
    <>
      <div className={`axf-grid-row ${p.selected === id ? 'is-active' : ''} ${p.multi?.includes(id) ? 'is-multi' : ''} axf-grid-edge--${p.rowTone?.(r) ?? 'muted'}`} role="row" aria-selected={p.selected === id}
        data-axf-drop={drop} data-axf-drop-id={`row:${id}`} data-fx-ctx-target={ctx?.target} data-fx-ctx-payload={ctx?.payload}
        {...dragProps} onClick={(e) => p.onRowClick?.(r, e)} onDoubleClick={() => config.expand && p.onToggleExpand?.(id)}>
        <span className="axf-dnd-grip" style={{ marginInlineStart: `calc(var(--fx-space) * ${depth * 2})` }}><Icon name="more" size={12} /></span>
        {cols.map((c) => <span key={c.id} role="gridcell" className={`axf-grid-cell ${c.align === 'end' ? 'is-end' : ''}`}>{c.render(r)}</span>)}
        {config.expand && p.renderDetail ? <IconButton icon={open ? 'chevron-up' : 'chevron-down'} label={open ? 'Collapse row' : 'Expand row'} onClick={(e) => { e.stopPropagation(); p.onToggleExpand?.(id); }} /> : <span />}
      </div>
      {open && p.renderDetail && <div className="axf-grid-detail" role="row">{p.renderDetail(r)}</div>}
    </>
  );
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
  },
};

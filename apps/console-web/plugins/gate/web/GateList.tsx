/**
 * The gate's lists: the framework DataGrid (`grid:<id>`, rows `grid:<id>/row:<row id>`), or one card per row when the
 * view is `cards` (rows.ts). Cards show the same columns as label / value pairs and the row's detail under them; they
 * keep the same console-control addresses through data-axf-scope / data-axf-target.
 */
import type { ReactNode } from 'react';
import { DataGrid, type GridColumn } from '@console/axf/libs/datagrid';
import { useGateLayout } from './rows';

export interface GateListProps<R> {
  id: string; label: string; title: string; rows: R[]; columns: GridColumn<R>[];
  rowId: (r: R) => string; rowLabel: (r: R) => string; rowTone?: (r: R) => string;
  hidden?: readonly string[]; expanded?: readonly string[]; onToggleExpand?: (id: string) => void; renderDetail?: (r: R) => ReactNode;
  selected?: string | null; onRowClick?: (r: R) => void; empty: ReactNode;
}

export function GateList<R>(p: GateListProps<R>) {
  const { view } = useGateLayout();
  if (view !== 'cards') {
    return (
      <DataGrid<R>
        id={p.id} label={p.label} groups={[{ id: p.id, title: p.title, rows: p.rows, groups: [] }]} columns={p.columns}
        rowId={p.rowId} rowLabel={p.rowLabel} hidden={p.hidden ?? []} compact={view === 'compact'} rowTone={p.rowTone}
        expanded={p.expanded} onToggleExpand={p.onToggleExpand} renderDetail={p.renderDetail}
        selected={p.selected ?? null} onRowClick={p.onRowClick ? (r) => p.onRowClick?.(r) : undefined} empty={p.empty}
      />
    );
  }
  const [head, ...rest] = p.columns.filter((c) => !(p.hidden ?? []).includes(c.id));
  return (
    <section className="axp-gate__cards" aria-label={p.label} data-axf-scope={`grid:${p.id}`}>
      <p className="axp-gate__label">{p.title}</p>
      {!p.rows.length && p.empty}
      {p.rows.map((r) => {
        const id = p.rowId(r);
        const open = p.expanded?.includes(id);
        return (
          <article key={id} className={`axp-gate__card fx-surface${p.selected === id ? ' is-selected' : ''}`} data-tone={p.rowTone?.(r) ?? ''} data-axf-target={`row:${id}`} aria-label={p.rowLabel(r)}
            onClick={() => p.onRowClick?.(r)}>
            {head && <div className="axp-gate__card-head">{head.render(r)}</div>}
            <dl className="axp-gate__card-body">
              {rest.map((c) => <div key={c.id} className="axp-gate__card-field">{c.label && <dt className="axp-gate__label">{c.label}</dt>}<dd>{c.render(r)}</dd></div>)}
            </dl>
            {open && p.renderDetail && <div onClick={(e) => e.stopPropagation()}>{p.renderDetail(r)}</div>}
          </article>
        );
      })}
    </section>
  );
}

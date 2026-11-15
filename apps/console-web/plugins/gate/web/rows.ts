/**
 * How the gate's lists are drawn. The plugin's view choice `gate.view` (UI Review options, plugins/gate/assets/settings):
 *   grid     the DataGrid, two lines a row (the title and its detail under it)
 *   cards    one card per row (phones and narrow panes read it best)
 *   compact  the DataGrid, one line a row
 * Unset, it follows the skin's grid setting `axf.datagrid.rows` (1 or 2); without one, phones get two lines and wider
 * screens one.
 */
import { useEffect, useState } from 'react';
import { useIsPhone, useRuntime } from '@console/axf/react';

export const GRID_ROWS_KEY = 'axf.datagrid.rows';
export const VIEW_KEY = 'gate.view';
export const VIEWS = ['grid', 'cards', 'compact'] as const;
export type GateViewKind = (typeof VIEWS)[number];

function useSetting(key: string): unknown {
  const rt = useRuntime();
  const [v, setV] = useState<unknown>(() => rt.settings.get(key));
  useEffect(() => rt.settings.onChange(key, (x) => setV(x)), [rt, key]);
  return v;
}

/** The lists' layout: { view, rows } (rows = lines a grid row, 1 or 2). */
export function useGateLayout(): { view: GateViewKind; rows: 1 | 2 } {
  const phone = useIsPhone();
  const view = useSetting(VIEW_KEY);
  const skinRows = Number(useSetting(GRID_ROWS_KEY));
  if (view === 'cards') return { view: 'cards', rows: 2 };
  if (view === 'grid') return { view: 'grid', rows: 2 };
  if (view === 'compact') return { view: 'compact', rows: 1 };
  const rows: 1 | 2 = skinRows === 1 || skinRows === 2 ? skinRows : phone ? 2 : 1;
  return { view: rows === 2 ? 'grid' : 'compact', rows };
}

/** Lines a grid row (kept for the tabs' cells). */
export function useGridRows(): 1 | 2 { return useGateLayout().rows; }

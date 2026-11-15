/**
 * The grids' row layout: one line a row, or two (the title and its detail under it). It follows the skin's grid
 * setting `axf.datagrid.rows` (1 or 2); without one, phones get two lines and wider screens one.
 */
import { useEffect, useState } from 'react';
import { useIsPhone, useRuntime } from '@console/axf/react';

export const GRID_ROWS_KEY = 'axf.datagrid.rows';

export function useGridRows(): 1 | 2 {
  const rt = useRuntime();
  const phone = useIsPhone();
  const read = () => { const v = Number(rt.settings.get(GRID_ROWS_KEY)); return v === 1 || v === 2 ? v : null; };
  const [rows, setRows] = useState<1 | 2 | null>(read);
  useEffect(() => rt.settings.onChange(GRID_ROWS_KEY, () => setRows(read())), [rt]); // eslint-disable-line react-hooks/exhaustive-deps
  return rows ?? (phone ? 2 : 1);
}

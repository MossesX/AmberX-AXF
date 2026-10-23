/** Status grid columns (hideable from the header's context menu, View › Grid columns, and the Grid menu). */
export interface ColumnDef { id: string; label: string; width: string; fixed?: boolean; sortable?: boolean; align?: 'end' }
export const COLUMNS: ColumnDef[] = [
  { id: 'title', label: 'Piece', width: 'minmax(calc(var(--fx-space) * 28), 3fr)', fixed: true, sortable: true },
  { id: 'status', label: 'Status', width: 'calc(var(--fx-space) * 16)', sortable: true },
  { id: 'kind', label: 'Kind', width: 'calc(var(--fx-space) * 14)', sortable: true },
  { id: 'progress', label: 'Progress', width: 'calc(var(--fx-space) * 18)', sortable: true },
  { id: 'clip', label: 'Clip', width: 'calc(var(--fx-space) * 9)', sortable: true, align: 'end' },
  { id: 'est', label: 'Estimate', width: 'calc(var(--fx-space) * 10)', sortable: true, align: 'end' },
  { id: 'target', label: 'Target', width: 'calc(var(--fx-space) * 9)', sortable: true, align: 'end' },
  { id: 'delta', label: '± target', width: 'calc(var(--fx-space) * 10)', sortable: true, align: 'end' },
  { id: 'cues', label: 'Cues', width: 'calc(var(--fx-space) * 7)', sortable: true, align: 'end' },
  { id: 'words', label: 'Words', width: 'calc(var(--fx-space) * 8)', sortable: true, align: 'end' },
  { id: 'recording', label: 'Rec', width: 'calc(var(--fx-space) * 6)' },
  { id: 'tags', label: 'Tags', width: 'calc(var(--fx-space) * 16)' },
  { id: 'url', label: 'Page', width: 'calc(var(--fx-space) * 22)' },
  { id: 'notes', label: 'Notes', width: 'calc(var(--fx-space) * 22)' },
  { id: 'updated', label: 'Updated', width: 'calc(var(--fx-space) * 14)', sortable: true },
];
export const columnLabel = (id: string) => COLUMNS.find((c) => c.id === id)?.label ?? id;

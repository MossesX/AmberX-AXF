/**
 * Datasets (lib-datagrid, Oct 28 2026): any list of rows on screen can be a *dataset* that plugins attach to — a filter,
 * a sort, a toolbar — without the view knowing which plugins exist.
 *
 * - A view registers its rows (an empty id registers nothing): `useDataset({ id, label, fields, rows, rowText? })` returns the rows with every attached
 *   transform applied. Every `DataGrid` does this by itself (its id and columns), so every grid is a dataset.
 * - A plugin attaches a transform: `setDatasetTransform(dataset, owner, { filter?, compare?, active? })`. Transforms
 *   from several owners run in owner order (filters AND-ed, sorts chained); `clearDatasetTransform` takes it off.
 * - A plugin may draw above an attached dataset through the slot `DATASET_TOOLBAR_SLOT` (props `{ dataset }`), which
 *   `DataGrid` renders, and views using `useDataset` render with `<DatasetToolbar dataset=… />`.
 *
 * Pure data + a tiny store (no React state outside the hooks), so it ports: Android twin recorded as a deferred gap
 * (placeholder `axf.datagrid.datasets.android` in library.json).
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';

export const DATASET_TOOLBAR_SLOT = 'axf.dataset.toolbar';

export type FieldKind = 'text' | 'number' | 'date' | 'choice' | 'bool';
export interface DatasetField<R = unknown> {
  id: string;
  label: string;
  kind?: FieldKind;
  value: (r: R) => string | number | boolean | null | undefined;
}
/** What the registry knows about a dataset on screen (rows are a snapshot; the view stays their owner). */
export interface DatasetInfo<R = unknown> {
  id: string;
  label: string;
  fields: DatasetField<R>[];
  rows: readonly R[];
  /** text a free search looks through (default: every field joined) */
  rowText?: (r: R) => string;
  /** how many views have it on screen right now */
  mounted: number;
}
export interface DatasetTransform<R = unknown> {
  filter?: (r: R, ds: DatasetInfo<R>) => boolean;
  compare?: (a: R, b: R, ds: DatasetInfo<R>) => number;
  /** shown as "filtered" by whoever draws the dataset (badges, counts) */
  active?: boolean;
  label?: string;
}

type Listener = () => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the store holds every dataset's row type
type Any = any;
const sets = new Map<string, DatasetInfo<Any>>();
const transforms = new Map<string, Map<string, DatasetTransform<Any>>>();
const known = new Map<string, { label: string; fields: { id: string; label: string; kind?: FieldKind }[] }>();
/** The last rows and fields each dataset had on screen, so a dialog opened over (or instead of) its page still works. */
const last = new Map<string, DatasetInfo<Any>>();
const listeners = new Set<Listener>();
let rev = 0;
const emit = () => { rev++; for (const l of [...listeners]) l(); };

export const subscribeDatasets = (fn: Listener) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const datasetsRevision = () => rev;

/** Datasets on screen now. */
export const listDatasets = (): DatasetInfo<unknown>[] => [...sets.values()] as DatasetInfo<unknown>[];
export const getDataset = <R = unknown>(id: string): DatasetInfo<R> | undefined => sets.get(id) as DatasetInfo<R> | undefined;
/** On screen now, else the last snapshot it had (mounted: 0), else undefined. */
export const getDatasetOrLast = <R = unknown>(id: string): DatasetInfo<R> | undefined => (sets.get(id) ?? last.get(id)) as DatasetInfo<R> | undefined;
/** Every dataset seen since the app started (on screen or not), for pickers such as "attach to…". */
export const knownDatasets = () => [...known.entries()].map(([id, k]) => ({ id, ...k, mounted: (sets.get(id)?.mounted ?? 0) > 0 }));

export function registerDataset<R>(info: Omit<DatasetInfo<R>, 'mounted'>): () => void {
  const prev = sets.get(info.id);
  sets.set(info.id, { ...info, mounted: (prev?.mounted ?? 0) + 1 } as DatasetInfo<Any>);
  const k = known.get(info.id);
  const fields = info.fields.map((f) => ({ id: f.id, label: f.label, ...(f.kind ? { kind: f.kind } : {}) }));
  if (!k || k.label !== info.label || JSON.stringify(k.fields) !== JSON.stringify(fields)) known.set(info.id, { label: info.label, fields });
  emit();
  return () => {
    const cur = sets.get(info.id);
    if (!cur) return;
    if (cur.mounted <= 1) { sets.delete(info.id); last.set(info.id, { ...cur, mounted: 0 }); } else sets.set(info.id, { ...cur, mounted: cur.mounted - 1 });
    emit();
  };
}

/** Update the rows/fields of a registered dataset without changing its mount count. */
function refreshDataset<R>(info: Omit<DatasetInfo<R>, 'mounted'>) {
  const cur = sets.get(info.id);
  if (!cur) return;
  if (cur.rows === info.rows && cur.fields === (info.fields as never) && cur.label === info.label) return;
  sets.set(info.id, { ...info, mounted: cur.mounted } as DatasetInfo<Any>);
}

export function setDatasetTransform<R>(dataset: string, owner: string, t: DatasetTransform<R>) {
  const m = transforms.get(dataset) ?? new Map();
  m.set(owner, t);
  transforms.set(dataset, m);
  emit();
}
export function clearDatasetTransform(dataset: string, owner: string) {
  const m = transforms.get(dataset);
  if (!m?.delete(owner)) return;
  if (!m.size) transforms.delete(dataset);
  emit();
}
/** Take every transform of one owner off every dataset (a plugin being switched off). */
export function clearOwnerTransforms(owner: string) {
  let hit = false;
  for (const [ds, m] of transforms) { if (m.delete(owner)) hit = true; if (!m.size) transforms.delete(ds); }
  if (hit) emit();
}
export const datasetTransforms = (dataset: string): [string, DatasetTransform<unknown>][] => [...(transforms.get(dataset) ?? new Map()).entries()] as [string, DatasetTransform<unknown>][];
export const datasetFiltered = (dataset: string) => datasetTransforms(dataset).some(([, t]) => t.active);

/** Apply every attached transform to `rows` (filters AND-ed, sorts chained in owner order). Stable; never mutates. */
export function applyDataset<R>(dataset: string, rows: readonly R[], info?: DatasetInfo<R>): R[] {
  const ts = datasetTransforms(dataset) as [string, DatasetTransform<R>][];
  if (!ts.length) return rows as R[];
  const ds = info ?? (getDataset<R>(dataset) as DatasetInfo<R>) ?? { id: dataset, label: dataset, fields: [], rows, mounted: 0 };
  let out = rows.filter((r) => ts.every(([, t]) => !t.filter || t.filter(r, ds)));
  const cmps = ts.map(([, t]) => t.compare).filter(Boolean) as NonNullable<DatasetTransform<R>['compare']>[];
  if (cmps.length) {
    out = out.map((r, i) => [r, i] as const).sort(([a, i], [b, j]) => { for (const c of cmps) { const v = c(a, b, ds); if (v) return v; } return i - j; }).map(([r]) => r);
  }
  return out;
}

/** Text of a row for free search: rowText, else every field's value. */
export function datasetRowText<R>(ds: DatasetInfo<R>, r: R): string {
  if (ds.rowText) return ds.rowText(r);
  return ds.fields.map((f) => { const v = f.value(r); return v == null ? '' : String(v); }).join(' ');
}

/** Re-render when datasets or transforms change. */
export function useDatasetsRevision(): number {
  return useSyncExternalStore(subscribeDatasets, datasetsRevision, datasetsRevision);
}

/**
 * Register `rows` as a dataset while the calling component is mounted and get them back with every attached transform
 * applied. Cheap when nothing is attached (the same array comes back).
 */
export function useDataset<R>(info: { id: string; label: string; fields: DatasetField<R>[]; rows: readonly R[]; rowText?: (r: R) => string }): R[] {
  const r = useDatasetsRevision();
  useEffect(() => (info.id ? registerDataset(info) : undefined), [info.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (info.id) refreshDataset(info);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (info.id ? applyDataset(info.id, info.rows, { ...info, mounted: 1 }) : (info.rows as R[])), [info.id, info.rows, r]);
}

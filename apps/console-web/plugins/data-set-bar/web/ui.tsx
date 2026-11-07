/**
 * Data set bar — what is drawn on an attached data set: the applier (puts the attachment's state on the dataset as a
 * lib-datagrid transform), the bar in its placement (top, inline, bottom, floating pill) and its three pieces, each an
 * instance of its asset: the search bar (search-bar, scope dataset), the filter button (filter-button) and the sort
 * control (sort-control). Nothing is drawn for a data set that has no attachment: hidden by default.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon, IconButton, useRuntime, usePortalRoot } from '@console/axf/react';
import { clearDatasetTransform, datasetRowText, getDatasetOrLast, setDatasetTransform, useDatasetsRevision, type DatasetInfo } from '@console/axf/libs/datagrid';
import {
  attachmentPieces, datasetSearchConfig, DSB_EMPTY_STATE, DSB_SLOT_BOTTOM, DSB_SLOT_TOP, dsbStateActive, dsbStateCounts, dsbStateFilters, makeDsbCompare, makeDsbFilter, normalizeFilterButton, normalizeSortControl, placementSlot, toggleDsbSort,
  type DataSetBarConfig, type DatasetSearchConfig, type DsbAttachment, type DsbField, type DsbState, type FilterButtonConfig, type SortControlConfig,
} from '@console/axf/core/engines/datasetbar';
import { FILTER_DIALOG, OWNER, SETTINGS_DIALOG, SORT_DIALOG } from './core';
import { resolveFor, setState, updateAttachment, useAttachment } from './store';

type Rt = ReturnType<typeof useRuntime>;

/* ---------------- the pieces' asset configs ---------------- */

export function searchConfigOf(rt: Rt, id: string): DatasetSearchConfig {
  const a = rt.registry.get('search-bar', id) ?? rt.registry.get('search-bar', 'dataset');
  const cfg = datasetSearchConfig(a?.data);
  return cfg.scope === 'dataset' ? cfg : { ...cfg, scope: 'dataset', fuzzy: true };
}
export const filterConfigOf = (rt: Rt, id: string): FilterButtonConfig => normalizeFilterButton((rt.registry.get('filter-button', id) ?? rt.registry.get('filter-button', 'default'))?.data);
export const sortConfigOf = (rt: Rt, id: string): SortControlConfig => normalizeSortControl((rt.registry.get('sort-control', id) ?? rt.registry.get('sort-control', 'default'))?.data);

/* ---------------- applying the state to the dataset ---------------- */

const fieldsOf = (ds: DatasetInfo<unknown>): DsbField<unknown>[] => ds.fields.map((f) => ({ id: f.id, label: f.label, value: f.value }));

/** Puts this attachment's state on its dataset while mounted; takes it off when unmounted, detached or the plugin is off. */
function useApplier(dataset: string, att: DsbAttachment | null, cfg: DataSetBarConfig | null, search: DatasetSearchConfig | null) {
  const key = JSON.stringify([att?.state, cfg?.search, cfg?.filter, cfg?.sort, search]);
  useEffect(() => {
    if (!att || !cfg) { clearDatasetTransform(dataset, OWNER); return; }
    const s: DsbState = { ...att.state, ...(cfg.search ? {} : { query: '', field: '' }), ...(cfg.filter ? {} : { rules: [] }), ...(cfg.sort ? {} : { sort: [] }) };
    const scope = { fuzzy: search?.fuzzy ?? true, fields: search?.fields ?? [], minChars: search?.minChars ?? 1 };
    if (!dsbStateActive(s, scope)) { clearDatasetTransform(dataset, OWNER); return; }
    let cache: { ds: DatasetInfo<unknown> | null; filter: (r: unknown) => boolean; compare?: (a: unknown, b: unknown) => number } = { ds: null, filter: () => true };
    const fns = (ds: DatasetInfo<unknown>) => {
      if (cache.ds !== ds) cache = { ds, filter: makeDsbFilter(s, fieldsOf(ds), scope, (r) => datasetRowText(ds, r)), compare: makeDsbCompare(s, fieldsOf(ds)) };
      return cache;
    };
    const filters = dsbStateFilters(s, scope);
    setDatasetTransform<unknown>(dataset, OWNER, {
      label: 'Data set bar', active: filters,
      ...(filters ? { filter: (r, ds) => fns(ds).filter(r) } : {}),
      ...(s.sort.length ? { compare: (a, b, ds) => fns(ds).compare?.(a, b) ?? 0 } : {}),
    });
    return () => clearDatasetTransform(dataset, OWNER);
  }, [dataset, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Rows shown of the whole dataset under the current filter (the row count piece). */
function useCounts(dataset: string, att: DsbAttachment | null, search: DatasetSearchConfig | null): { shown: number; total: number } | null {
  useDatasetsRevision();
  const ds = getDatasetOrLast(dataset);
  if (!ds || !att) return null;
  const scope = { fuzzy: search?.fuzzy ?? true, fields: search?.fields ?? [], minChars: search?.minChars ?? 1 };
  if (!dsbStateFilters(att.state, scope)) return { shown: ds.rows.length, total: ds.rows.length };
  const f = makeDsbFilter(att.state, fieldsOf(ds), scope, (r) => datasetRowText(ds, r));
  return { shown: ds.rows.filter(f).length, total: ds.rows.length };
}

/* ---------------- the slots lib-datagrid renders ---------------- */

/** The top slot: nothing unless attached; top / inline draw the bar here, floating draws the pill through a portal. */
export function TopSlot({ dataset, label }: { dataset: string; label?: string }) {
  const rt = useRuntime();
  const att = useAttachment(dataset);
  const cfg = att ? resolveFor(rt, att) : null;
  const search = cfg?.search ? searchConfigOf(rt, cfg.search) : null;
  useApplier(dataset, att, cfg, search);
  if (!att || !cfg) return null;
  const { slot, inline } = placementSlot(cfg.placement);
  if (slot === 'floating') return <FloatingPill dataset={dataset} label={label} att={att} cfg={cfg} />;
  if (slot !== DSB_SLOT_TOP) return null;
  return <Bar dataset={dataset} label={label} att={att} cfg={cfg} inline={inline} />;
}
/** The footer slot: the bar when its placement is bottom. */
export function FooterSlot({ dataset, label }: { dataset: string; label?: string }) {
  const rt = useRuntime();
  const att = useAttachment(dataset);
  const cfg = att ? resolveFor(rt, att) : null;
  if (!att || !cfg || placementSlot(cfg.placement).slot !== DSB_SLOT_BOTTOM) return null;
  return <Bar dataset={dataset} label={label} att={att} cfg={cfg} footer />;
}

/* ---------------- the bar ---------------- */

export interface BarProps { dataset: string; label?: string; att: DsbAttachment; cfg: DataSetBarConfig; inline?: boolean; footer?: boolean; pill?: boolean; preview?: boolean }

/** The bar: its pieces in bar order, a count and a clear button. `preview` draws it over no dataset (the settings tab). */
export function Bar({ dataset, label, att, cfg, inline, footer, pill, preview }: BarProps) {
  const rt = useRuntime();
  const search = cfg.search ? searchConfigOf(rt, cfg.search) : null;
  const counts = useCounts(dataset, att, search);
  const pieces = attachmentPieces(cfg);
  const set = (next: DsbState) => { if (!preview) setState(rt, dataset, next); };
  const active = dsbStateActive(att.state);
  return (
    <div className={`fx-toolbar axp-dsb__bar ${inline ? 'is-inline' : ''} ${footer ? 'is-footer' : ''} ${pill ? 'is-pill' : ''} ${preview ? 'is-preview' : ''}`}
      role="toolbar" aria-label={`${cfg.label}: ${label ?? dataset}`} data-axf-toolbar={`data-set-bar:${dataset}`} data-axf-dataset={preview ? undefined : dataset}
      data-align={cfg.align} data-density={cfg.density} data-surface={cfg.surface}>
      {pieces.map((p) => {
        if (p.piece === 'search') return <SearchPiece key="search" dataset={dataset} state={att.state} set={set} config={search!} preview={preview} />;
        if (p.piece === 'filter') return <FilterPiece key="filter" dataset={dataset} state={att.state} config={filterConfigOf(rt, p.id)} preview={preview} />;
        return <SortPiece key="sort" dataset={dataset} state={att.state} set={set} config={sortConfigOf(rt, p.id)} preview={preview} />;
      })}
      {cfg.count && <span className="fx-chip axp-dsb__count" title="Rows shown of the whole data set">{preview ? '12 of 40' : counts ? `${counts.shown} of ${counts.total}` : '—'}</span>}
      {cfg.clear && (active || preview) && <IconButton icon="x" label="Clear search, rules and sort" className="axp-dsb__clear" onClick={() => set({ ...DSB_EMPTY_STATE })} />}
      <IconButton icon="settings" label="Data set bar settings" className="axp-dsb__settings" onClick={() => !preview && rt.openDialog(SETTINGS_DIALOG, { dataset })} />
    </div>
  );
}

/* ---------------- pieces ---------------- */

function SearchPiece({ dataset, state, set, config, preview }: { dataset: string; state: DsbState; set: (s: DsbState) => void; config: DatasetSearchConfig; preview?: boolean }) {
  useDatasetsRevision();
  const ds = getDatasetOrLast(dataset);
  const fields = (ds?.fields ?? []).filter((f) => !config.fields.length || config.fields.includes(f.id));
  const scoped = state.field && fields.some((f) => f.id === state.field) ? state.field : '';
  return (
    <div className={`axp-dsb__search axp-dsb__search--${config.width}`} role="search">
      <Icon name="search" size={14} />
      <input className="fx-input axp-dsb__search-input" type="search" value={preview ? '' : state.query} placeholder={scoped ? `${fields.find((f) => f.id === scoped)?.label ?? scoped}…` : config.placeholder}
        aria-label={`Search ${scoped ? fields.find((f) => f.id === scoped)?.label ?? scoped : 'all fields'}`} onChange={(e) => set({ ...state, query: e.target.value })} readOnly={preview} data-fx-ctx-ignore="" />
      {config.fieldPicker && fields.length > 1 && (
        <select className="fx-input axp-dsb__field" aria-label="Field to search" value={scoped} onChange={(e) => set({ ...state, field: e.target.value })} disabled={preview} data-fx-ctx-ignore="">
          <option value="">All fields</option>
          {fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      )}
    </div>
  );
}

function CountBadge({ n }: { n: number }) { return n > 0 ? <span className="fx-chip fx-chip--accent axp-dsb__badge" aria-label={`${n} on`}>{n}</span> : null; }

function FilterPiece({ dataset, state, config, preview }: { dataset: string; state: DsbState; config: FilterButtonConfig; preview?: boolean }) {
  const rt = useRuntime();
  const n = dsbStateCounts(state).rules;
  return (
    <Button tone={n ? 'primary' : config.tone} size={config.size} icon={config.display !== 'label' ? config.icon : undefined} aria-label={config.label} title={config.label} aria-pressed={n > 0}
      className="axp-dsb__piece" onClick={() => !preview && rt.openDialog(FILTER_DIALOG, { dataset })}>
      {config.display !== 'icon' ? config.label : null}{config.showCount && <CountBadge n={preview ? 0 : n} />}
    </Button>
  );
}

function SortPiece({ dataset, state, set, config, preview }: { dataset: string; state: DsbState; set: (s: DsbState) => void; config: SortControlConfig; preview?: boolean }) {
  const rt = useRuntime();
  useDatasetsRevision();
  const ds = getDatasetOrLast(dataset);
  const fields = ds?.fields ?? [];
  const n = state.sort.length;
  const open = () => !preview && rt.openDialog(SORT_DIALOG, { dataset });
  if (config.style === 'buttons') {
    const quick = (config.quickFields.length ? fields.filter((f) => config.quickFields.includes(f.id)) : fields).slice(0, 6);
    return (
      <span className="axp-dsb__sortbtns">
        {quick.map((f) => {
          const k = state.sort.find((x) => x.field === f.id);
          return <Button key={f.id} size={config.size} tone={k ? 'primary' : config.tone} icon={k ? (k.dir === 1 ? 'chevron-up' : 'chevron-down') : undefined} aria-pressed={!!k} title={`Sort by ${f.label}`} className="axp-dsb__piece"
            onClick={() => set(toggleDsbSort(state, f.id, k ? (k.dir === 1 ? -1 : 1) : 1, config.maxKeys))}>{f.label}</Button>;
        })}
        {!quick.length && <Button size={config.size} tone={config.tone} icon={config.icon} onClick={open}>{config.label}</Button>}
      </span>
    );
  }
  if (config.style === 'chips') {
    return (
      <span className="axp-dsb__sortchips">
        {state.sort.map((k) => {
          const f = fields.find((x) => x.id === k.field);
          return (
            <span key={k.field} className="fx-chip axp-dsb__chip">
              <button type="button" className="fx-btn fx-btn--sm fx-btn--quiet axp-dsb__chipbtn" aria-label={`${f?.label ?? k.field}: ${k.dir === 1 ? 'ascending' : 'descending'}, tap to flip`} onClick={() => set(toggleDsbSort(state, k.field, k.dir === 1 ? -1 : 1, config.maxKeys))}>
                <Icon name={k.dir === 1 ? 'chevron-up' : 'chevron-down'} size={12} />{f?.label ?? k.field}
              </button>
              <IconButton icon="x" size={12} label={`Remove sort by ${f?.label ?? k.field}`} onClick={() => set(toggleDsbSort(state, k.field, k.dir, config.maxKeys))} />
            </span>
          );
        })}
        <Button size={config.size} tone={config.tone} icon={config.display !== 'label' ? config.icon : undefined} aria-label={config.label} title={config.label} className="axp-dsb__piece" onClick={open}>
          {config.display !== 'icon' ? (n ? 'Add key' : config.label) : null}
        </Button>
      </span>
    );
  }
  return (
    <Button tone={n ? 'primary' : config.tone} size={config.size} icon={config.display !== 'label' ? config.icon : undefined} aria-label={config.label} title={config.label} aria-pressed={n > 0} className="axp-dsb__piece" onClick={open}>
      {config.display !== 'icon' ? config.label : null}{config.showCount && <CountBadge n={preview ? 0 : n} />}
    </Button>
  );
}

/* ---------------- floating pill ---------------- */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const sideStart = (side: DataSetBarConfig['floatingSide']): { x: number; y: number } => ({ x: side.endsWith('start') ? 0.02 : 0.98, y: side.startsWith('top') ? 0.12 : 0.9 });

/** The bar as a raised pill over the page: drag it anywhere, the spot is remembered on the attachment (viewport fractions). */
export function FloatingPill({ dataset, label, att, cfg }: { dataset: string; label?: string; att: DsbAttachment; cfg: DataSetBarConfig }) {
  const rt = useRuntime();
  const root = usePortalRoot();
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const pos = att.floatingPos ?? sideStart(cfg.floatingSide);
  const [live, setLive] = useState<{ x: number; y: number } | null>(null);
  const p = live ?? pos;
  const style = useMemo(() => ({ left: `${p.x * 100}vw`, top: `${p.y * 100}vh`, transform: `translate(${p.x > 0.5 ? '-100%' : '0'}, ${p.y > 0.5 ? '-100%' : '0'})` }), [p.x, p.y]);
  useEffect(() => { setLive(null); }, [att.floatingPos?.x, att.floatingPos?.y]);
  const onDown = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect(); if (!r) return;
    drag.current = { dx: e.clientX - (p.x > 0.5 ? r.right : r.left), dy: e.clientY - (p.y > 0.5 ? r.bottom : r.top), moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current.moved = true;
    setLive({ x: clamp01((e.clientX - drag.current.dx) / window.innerWidth), y: clamp01((e.clientY - drag.current.dy) / window.innerHeight) });
  };
  const onUp = () => {
    if (drag.current?.moved && live) updateAttachment(rt, dataset, (a) => ({ ...a, floatingPos: live }));
    drag.current = null;
  };
  const node = (
    <div ref={box} className="axp-dsb__float fx-popover" style={style} data-surface={cfg.surface} data-axf-dataset={dataset}>
      <span className="axp-dsb__grip" role="button" tabIndex={0} aria-label={`Move the ${cfg.label} (drag)`} title="Drag to move" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <Icon name="grip" size={14} />
      </span>
      <Bar dataset={dataset} label={label} att={att} cfg={cfg} pill />
    </div>
  );
  return root ? createPortal(node, root) : node;
}

/** Shared layout for a dialog's header row. */
export function DialogHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return <div className="axp-dsb__dialog-head"><strong>{title}</strong><span className="axp-dsb__row">{children}</span></div>;
}

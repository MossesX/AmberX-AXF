/**
 * Data set bar — dialogs: Filter (rules per field, match all / any, saved filters), Sort (multi-key, saved sorts) and the
 * attachment's Settings (bar asset, placement, pieces, count / clear, Reset to default, Detach). Each works on one data set
 * (`props.dataset`); the state and saved lists live on the attachment (local-first).
 */
import { useState } from 'react';
import { Button, IconButton, Note, Segmented, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { getDatasetOrLast, knownDatasets, useDatasetsRevision } from '@console/axf/libs/datagrid';
import {
  applyDsbSavedFilter, applyDsbSavedSort, attachmentPieces, deleteDsbSavedFilter, deleteDsbSavedSort, DSB_EMPTY_STATE, DSB_OPS, DSB_PIECE_LABELS, DSB_PIECE_TYPES, DSB_PIECES, DSB_PLACEMENT_LABELS, DSB_PLACEMENTS, dsbRuleReady, dsbStateCounts, dsbUid, saveDsbFilter, saveDsbSort, toggleDsbSort,
  type DsbPiece, type DsbPlacement, type DsbRule, type DsbState,
} from '@console/axf/core/engines/datasetbar';
import { filterConfigOf, searchConfigOf, sortConfigOf, DialogHead } from './ui';
import { doAttachPiece, doChangeBar, doDetach, doDetachPiece, doMove, doReset, resolveFor, setState, updateAttachment, useAttachment } from './store';

const datasetLabel = (dataset: string) => getDatasetOrLast(dataset)?.label ?? knownDatasets().find((d) => d.id === dataset)?.label ?? dataset;

/* ---------------- Filter ---------------- */

const needs = (op: DsbRule['op']) => DSB_OPS.find((o) => o.id === op)?.needs ?? 1;

export function FilterDialog({ dataset, close }: { dataset?: string; close: () => void }) {
  const rt = useRuntime();
  useDatasetsRevision();
  const att = useAttachment(dataset ?? '');
  const [name, setName] = useState('');
  if (!dataset || !att) return <Note tone="warning">Right-click a data set and attach the data set bar first.</Note>;
  const cfg = resolveFor(rt, att);
  const fcfg = filterConfigOf(rt, cfg.filter || 'default');
  const ds = getDatasetOrLast(dataset);
  const fields = ds?.fields ?? [];
  const ordered = [...fields].sort((a, b) => { const qa = fcfg.quickFields.indexOf(a.id), qb = fcfg.quickFields.indexOf(b.id); return (qa < 0 ? 99 : qa) - (qb < 0 ? 99 : qb); });
  const s = att.state;
  const set = (next: DsbState) => setState(rt, dataset, next);
  const setRule = (id: string, patch: Partial<DsbRule>) => set({ ...s, rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const addRule = () => s.rules.length < fcfg.maxRules && set({ ...s, rules: [...s.rules, { id: dsbUid(), field: ordered[0]?.id ?? '', op: 'contains', value: '' }] });
  const counts = dsbStateCounts(s);
  return (
    <div className="axp-dsb__dialog">
      <DialogHead title={`Filter · ${datasetLabel(dataset)}`}>
        {counts.rules > 0 && <span className="fx-chip">{counts.rules} on</span>}
        <Segmented label="Match" size="sm" value={s.match} options={[{ value: 'all', label: 'Match all' }, { value: 'any', label: 'Match any' }]} onChange={(m) => set({ ...s, match: m })} />
      </DialogHead>
      {!fields.length && <Note tone="info">This data set isn't on screen right now; open it to see its fields.</Note>}
      <div className="axp-dsb__rules">
        {s.rules.map((r) => {
          const n = needs(r.op);
          return (
            <div key={r.id} className={`axp-dsb__rule ${r.off ? 'is-off' : ''} ${dsbRuleReady(r) ? '' : 'is-waiting'}`}>
              <div className="axp-dsb__rule-line">
                <SelectField label="Field" value={r.field} options={ordered.map((f) => ({ value: f.id, label: f.label }))} onChange={(v) => setRule(r.id, { field: v })} />
                <SelectField label="Is" value={r.op} options={DSB_OPS.map((o) => ({ value: o.id, label: o.label }))} onChange={(v) => setRule(r.id, { op: v as DsbRule['op'] })} />
                {n === 1 && <TextField label="Value" value={r.value} onChange={(v) => setRule(r.id, { value: v })} />}
                {n === 2 && <><TextField label="From" value={r.value} onChange={(v) => setRule(r.id, { value: v })} /><TextField label="To" value={r.value2 ?? ''} onChange={(v) => setRule(r.id, { value2: v })} /></>}
                {n === 'list' && <TextField label="Values, comma separated" value={(r.values ?? []).join(', ')} onChange={(v) => setRule(r.id, { values: v.split(',').map((x) => x.trim()).filter(Boolean) })} />}
              </div>
              <div className="axp-dsb__rule-side">
                <Switch label="On" checked={!r.off} onChange={(on) => setRule(r.id, { off: !on })} />
                <IconButton icon="trash" label="Remove rule" onClick={() => set({ ...s, rules: s.rules.filter((x) => x.id !== r.id) })} />
              </div>
            </div>
          );
        })}
        {!s.rules.length && <p className="axp-dsb__muted">No rules yet. Rules narrow the rows on top of the search box.</p>}
      </div>
      <div className="axp-dsb__row">
        <Button icon="plus" size="sm" onClick={addRule} disabled={s.rules.length >= fcfg.maxRules || !fields.length}>Add rule</Button>
        {fcfg.clear && <Button icon="x" size="sm" tone="quiet" disabled={!counts.rules && !counts.query} onClick={() => set({ ...s, rules: [], query: '' })}>Clear filter</Button>}
      </div>
      {fcfg.savedFilters && (
        <div className="axp-dsb__section">
          <div className="axp-dsb__section-head"><strong>Saved filters</strong><span className="axp-dsb__muted">kept for this data set on this device</span></div>
          {att.saved.filters.length ? (
            <ul className="axp-dsb__saved">
              {att.saved.filters.map((f) => (
                <li key={f.id} className="axp-dsb__saved-row">
                  <button type="button" className="fx-btn fx-btn--sm fx-btn--quiet axp-dsb__saved-name" onClick={() => updateAttachment(rt, dataset, (a) => applyDsbSavedFilter(a, f.id))} title="Apply this filter">{f.name} <span className="axp-dsb__muted">({f.rules.length} rule{f.rules.length === 1 ? '' : 's'}{f.query ? `, "${f.query}"` : ''})</span></button>
                  <IconButton icon="trash" label={`Delete saved filter ${f.name}`} onClick={() => updateAttachment(rt, dataset, (a) => deleteDsbSavedFilter(a, f.id))} />
                </li>
              ))}
            </ul>
          ) : <p className="axp-dsb__muted">Nothing saved yet.</p>}
          <div className="axp-dsb__save">
            <TextField label="Save the current filter as" value={name} onChange={setName} placeholder="e.g. Open builds" />
            <Button icon="save" size="sm" disabled={!name.trim() || (!counts.rules && !counts.query)} onClick={() => { updateAttachment(rt, dataset, (a) => saveDsbFilter(a, name)); setName(''); }}>Save</Button>
          </div>
        </div>
      )}
      <div className="axp-dsb__foot"><Button tone="primary" onClick={close}>Done</Button></div>
    </div>
  );
}

/* ---------------- Sort ---------------- */

export function SortDialog({ dataset, close }: { dataset?: string; close: () => void }) {
  const rt = useRuntime();
  useDatasetsRevision();
  const att = useAttachment(dataset ?? '');
  const [name, setName] = useState('');
  if (!dataset || !att) return <Note tone="warning">Right-click a data set and attach the data set bar first.</Note>;
  const cfg = resolveFor(rt, att);
  const scfg = sortConfigOf(rt, cfg.sort || 'default');
  const ds = getDatasetOrLast(dataset);
  const fields = ds?.fields ?? [];
  const s = att.state;
  const set = (next: DsbState) => setState(rt, dataset, next);
  const move = (i: number, d: -1 | 1) => { const next = [...s.sort]; const j = i + d; if (j < 0 || j >= next.length) return; [next[i], next[j]] = [next[j]!, next[i]!]; set({ ...s, sort: next }); };
  const free = fields.filter((f) => !s.sort.some((k) => k.field === f.id));
  return (
    <div className="axp-dsb__dialog">
      <DialogHead title={`Sort · ${datasetLabel(dataset)}`}>{s.sort.length > 0 && <span className="fx-chip">{s.sort.length} of {scfg.maxKeys} keys</span>}</DialogHead>
      {!fields.length && <Note tone="info">This data set isn't on screen right now; open it to see its fields.</Note>}
      <ol className="axp-dsb__keys">
        {s.sort.map((k, i) => {
          const f = fields.find((x) => x.id === k.field);
          return (
            <li key={k.field} className="axp-dsb__key">
              <span className="axp-dsb__key-n">{i + 1}</span>
              <span className="axp-dsb__key-name">{f?.label ?? k.field}</span>
              <Segmented label={`Direction of ${f?.label ?? k.field}`} size="sm" value={k.dir === 1 ? 'asc' : 'desc'} options={[{ value: 'asc', label: 'A → Z · 0 → 9' }, { value: 'desc', label: 'Z → A · 9 → 0' }]} onChange={(v) => set({ ...s, sort: s.sort.map((x) => (x.field === k.field ? { ...x, dir: v === 'asc' ? 1 : -1 } : x)) })} />
              <span className="axp-dsb__row">
                <IconButton icon="chevron-up" label="Move key up" disabled={i === 0} onClick={() => move(i, -1)} />
                <IconButton icon="chevron-down" label="Move key down" disabled={i === s.sort.length - 1} onClick={() => move(i, 1)} />
                <IconButton icon="trash" label={`Remove sort by ${f?.label ?? k.field}`} onClick={() => set({ ...s, sort: s.sort.filter((x) => x.field !== k.field) })} />
              </span>
            </li>
          );
        })}
        {!s.sort.length && <li className="axp-dsb__muted">No sort keys: the rows show in the data set's own order.</li>}
      </ol>
      {s.sort.length < scfg.maxKeys && free.length > 0 && (
        <SelectField label="Add a sort key" value="" empty="Pick a field…" options={free.map((f) => ({ value: f.id, label: f.label }))} onChange={(v) => v && set(toggleDsbSort(s, v, 1, scfg.maxKeys))} />
      )}
      {scfg.savedSorts && (
        <div className="axp-dsb__section">
          <div className="axp-dsb__section-head"><strong>Saved sorts</strong><span className="axp-dsb__muted">kept for this data set on this device</span></div>
          {att.saved.sorts.length ? (
            <ul className="axp-dsb__saved">
              {att.saved.sorts.map((x) => (
                <li key={x.id} className="axp-dsb__saved-row">
                  <button type="button" className="fx-btn fx-btn--sm fx-btn--quiet axp-dsb__saved-name" onClick={() => updateAttachment(rt, dataset, (a) => applyDsbSavedSort(a, x.id))} title="Apply this sort">{x.name} <span className="axp-dsb__muted">({x.sort.map((k) => `${fields.find((f) => f.id === k.field)?.label ?? k.field} ${k.dir === 1 ? '↑' : '↓'}`).join(', ')})</span></button>
                  <IconButton icon="trash" label={`Delete saved sort ${x.name}`} onClick={() => updateAttachment(rt, dataset, (a) => deleteDsbSavedSort(a, x.id))} />
                </li>
              ))}
            </ul>
          ) : <p className="axp-dsb__muted">Nothing saved yet.</p>}
          <div className="axp-dsb__save">
            <TextField label="Save the current sort as" value={name} onChange={setName} placeholder="e.g. Newest first" />
            <Button icon="save" size="sm" disabled={!name.trim() || !s.sort.length} onClick={() => { updateAttachment(rt, dataset, (a) => saveDsbSort(a, name)); setName(''); }}>Save</Button>
          </div>
        </div>
      )}
      <div className="axp-dsb__foot">
        <Button icon="x" tone="quiet" disabled={!s.sort.length} onClick={() => set({ ...s, sort: [] })}>Clear sort</Button>
        <Button tone="primary" onClick={close}>Done</Button>
      </div>
    </div>
  );
}

/* ---------------- the attachment's settings ---------------- */

export function AttachmentSettingsDialog({ dataset, close }: { dataset?: string; close: () => void }) {
  const rt = useRuntime();
  useDatasetsRevision();
  const att = useAttachment(dataset ?? '');
  if (!dataset || !att) return <Note tone="warning">This data set has no data set bar attached (right-click it → Attach data set bar).</Note>;
  const cfg = resolveFor(rt, att);
  const bars = rt.registry.list('data-set-bar');
  const pieceAssets = (p: DsbPiece) => rt.registry.list(DSB_PIECE_TYPES[p]).filter((a) => p !== 'search' || searchConfigOf(rt, a.id).scope === 'dataset' || (a.data as { scope?: string }).scope === 'dataset');
  const override = (patch: Record<string, unknown>) => updateAttachment(rt, dataset, (a) => ({ ...a, overrides: { ...a.overrides, ...patch } }));
  const dropOverride = (k: string) => updateAttachment(rt, dataset, (a) => { const o = { ...a.overrides } as Record<string, unknown>; delete o[k]; return { ...a, overrides: o }; });
  const overridden = Object.keys(att.overrides);
  return (
    <div className="axp-dsb__dialog">
      <DialogHead title={`Data set bar · ${datasetLabel(dataset)}`}>
        {overridden.length > 0 && <span className="fx-chip">{overridden.length} changed from the asset</span>}
      </DialogHead>
      <p className="axp-dsb__muted">What you change here applies to this one data set, on this device. The asset itself stays as it is.</p>
      <SelectField label="Bar asset" value={att.bar} empty="Pieces only (no bar asset)" options={bars.map((b) => ({ value: b.id, label: b.name }))} hint="The data-set-bar asset this attachment draws from" onChange={(v) => v && doChangeBar(rt, dataset, v)} />
      <div className="axp-dsb__field-row">
        <Segmented label="Placement" value={cfg.placement} options={DSB_PLACEMENTS.map((p) => ({ value: p, label: DSB_PLACEMENT_LABELS[p] }))} onChange={(p: DsbPlacement) => doMove(rt, dataset, p)} />
        {att.overrides.placement && <Button size="sm" tone="quiet" icon="undo" onClick={() => dropOverride('placement')}>Asset's placement</Button>}
      </div>
      {cfg.placement === 'floating' && (
        <div className="axp-dsb__field-row">
          <Segmented label="Pill starts at" size="sm" value={cfg.floatingSide} options={[{ value: 'bottom-end', label: 'Bottom end' }, { value: 'bottom-start', label: 'Bottom start' }, { value: 'top-end', label: 'Top end' }, { value: 'top-start', label: 'Top start' }]} onChange={(v) => override({ floatingSide: v })} />
          {att.floatingPos && <Button size="sm" tone="quiet" icon="undo" onClick={() => updateAttachment(rt, dataset, (a) => { const { floatingPos: _p, ...rest } = a; void _p; return rest as typeof a; })}>Put the pill back</Button>}
        </div>
      )}
      <div className="axp-dsb__section">
        <div className="axp-dsb__section-head"><strong>Pieces</strong><span className="axp-dsb__muted">each piece is an asset of its own type</span></div>
        {DSB_PIECES.map((p) => {
          const on = !!cfg[p];
          const choices = pieceAssets(p);
          return (
            <div key={p} className="axp-dsb__piece-row">
              <Switch label={DSB_PIECE_LABELS[p]} checked={on} onChange={(v) => (v ? doAttachPiece(rt, dataset, p, choices[0]?.id) : doDetachPiece(rt, dataset, p))} />
              {on && <SelectField label={`${DSB_PIECE_LABELS[p]} asset`} value={cfg[p]} options={choices.map((a) => ({ value: a.id, label: a.name }))} onChange={(v) => v && override({ [p]: v })} />}
            </div>
          );
        })}
        {!attachmentPieces(cfg).length && <Note tone="warning">No piece is on: the bar draws nothing. Switch a piece on or detach the bar.</Note>}
      </div>
      <div className="axp-dsb__section">
        <div className="axp-dsb__section-head"><strong>Look</strong></div>
        <div className="axp-dsb__field-row">
          <Switch label="Row count" checked={cfg.count} onChange={(v) => override({ count: v })} />
          <Switch label="Clear button" checked={cfg.clear} onChange={(v) => override({ clear: v })} />
        </div>
        <div className="axp-dsb__field-row">
          <Segmented label="Align" size="sm" value={cfg.align} options={[{ value: 'start', label: 'Start' }, { value: 'center', label: 'Center' }, { value: 'end', label: 'End' }, { value: 'spread', label: 'Spread' }]} onChange={(v) => override({ align: v })} />
          <Segmented label="Density" size="sm" value={cfg.density} options={[{ value: 'compact', label: 'Compact' }, { value: 'regular', label: 'Regular' }]} onChange={(v) => override({ density: v })} />
          <Segmented label="Surface" size="sm" value={cfg.surface} options={[{ value: 'flat', label: 'Flat' }, { value: 'raised', label: 'Raised' }, { value: 'glass', label: 'Glass' }]} onChange={(v) => override({ surface: v })} />
        </div>
      </div>
      <div className="axp-dsb__foot">
        <Button icon="undo" tone="quiet" onClick={() => doReset(rt, dataset)} title="Back to the asset's own look and placement, nothing applied; saved filters and sorts stay">Reset to default</Button>
        <Button icon="trash" tone="danger" confirm="Detach the data set bar from this data set? Its saved filters and sorts go with it." onClick={() => { doDetach(rt, dataset); close(); }}>Detach</Button>
        <Button tone="primary" onClick={close}>Done</Button>
      </div>
    </div>
  );
}

export { DSB_EMPTY_STATE };

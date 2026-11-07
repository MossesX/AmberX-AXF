/**
 * Data set bar — Settings → Plugins → Data set bar: the attached data sets (attach more, open each one's settings,
 * reset, detach), the default picks a plain "Attach data set bar" uses, and a live preview of every bar look.
 */
import { useState } from 'react';
import { Button, IconButton, Note, Segmented, SelectField, Switch, useRuntime } from '@console/axf/react';
import { knownDatasets, useDatasetsRevision } from '@console/axf/libs/datagrid';
import { attachmentPieces, DSB_PLACEMENT_LABELS, DSB_PLACEMENTS, dsbSummary, normalizeAttachment, normalizeDataSetBar, type DsbPlacement } from '@console/axf/core/engines/datasetbar';
import { ACTIONS, act, describeAttachment, SETTINGS_DIALOG } from './core';
import { doAttach, doDetach, doReset, readDefaults, resolveFor, useAttachments, useDefaults, writeDefaults } from './store';
import { Bar } from './ui';

/** The attached data sets, and a picker to attach another one (every data set seen since the app started). */
export function AttachedPanel() {
  const rt = useRuntime();
  useDatasetsRevision();
  const map = useAttachments();
  const [pick, setPick] = useState('');
  const [place, setPlace] = useState<DsbPlacement | ''>('');
  const known = knownDatasets();
  const free = known.filter((d) => !map[d.id]);
  const rows = Object.values(map).sort((a, b) => a.dataset.localeCompare(b.dataset));
  return (
    <div className="axp-dsb__stack">
      <p className="axp-dsb__muted">Hidden by default: a data set shows the bar only once you attach it. Right-click any grid, list, tree or table → <strong>Attach data set bar</strong>, or attach one here. Each attachment keeps its own settings on this device.</p>
      {rows.length ? (
        <ul className="axp-dsb__attached">
          {rows.map((att) => {
            const cfg = resolveFor(rt, att);
            const label = known.find((d) => d.id === att.dataset)?.label ?? att.dataset;
            const on = known.find((d) => d.id === att.dataset)?.mounted;
            return (
              <li key={att.dataset} className={`axp-dsb__attached-row ${on ? 'is-on' : ''}`}>
                <div className="axp-dsb__attached-text">
                  <span className="axp-dsb__attached-name">{label}{!on && <span className="axp-dsb__muted"> · not on screen</span>}</span>
                  <span className="axp-dsb__muted">{att.bar ? `${rt.registry.get('data-set-bar', att.bar)?.name ?? att.bar}` : 'pieces only'} · {attachmentPieces(cfg).map((p) => p.piece).join(' + ') || 'no piece'} · {DSB_PLACEMENT_LABELS[cfg.placement].toLowerCase()}{dsbSummary(att.state) ? ` · ${dsbSummary(att.state)}` : ''}</span>
                </div>
                <span className="axp-dsb__row">
                  <IconButton icon="settings" label={`Settings of ${label}`} onClick={() => rt.openDialog(SETTINGS_DIALOG, { dataset: att.dataset })} />
                  <IconButton icon="undo" label={`Reset ${label} to default`} onClick={() => doReset(rt, att.dataset)} />
                  <IconButton icon="trash" label={`Detach from ${label}`} onClick={() => doDetach(rt, att.dataset)} />
                </span>
              </li>
            );
          })}
        </ul>
      ) : <Note tone="info">Nothing attached yet.</Note>}
      <div className="axp-dsb__attach-new">
        <SelectField label="Attach to" value={pick} empty={free.length ? 'Pick a data set…' : 'Open a grid first'} options={free.map((d) => ({ value: d.id, label: d.mounted ? d.label : `${d.label} (not on screen)` }))} onChange={setPick} />
        <Segmented label="Placement" size="sm" value={place || 'asset'} options={[{ value: 'asset', label: "Asset's" }, ...DSB_PLACEMENTS.map((p) => ({ value: p, label: DSB_PLACEMENT_LABELS[p] }))]} onChange={(v) => setPlace(v === 'asset' ? '' : (v as DsbPlacement))} />
        <Button icon="plus" disabled={!pick} onClick={() => { doAttach(rt, pick, place); setPick(''); }}>Attach</Button>
      </div>
      <p className="axp-dsb__muted">By voice or script: <code>{act(ACTIONS.attach, '<data set>', 'top')}</code> · <code>{act(ACTIONS.detach, '<data set>')}</code> · <code>{ACTIONS.list}</code> (also on REST / MCP / CLI through plugin commands).</p>
    </div>
  );
}

/** What a plain attach uses: the bar asset and placement, and the asset each piece alone uses. */
export function DefaultsPanel() {
  const rt = useRuntime();
  const d = useDefaults();
  const set = (patch: Partial<typeof d>) => writeDefaults(rt, { ...readDefaults(rt), ...patch });
  const bars = rt.registry.list('data-set-bar');
  const searches = rt.registry.list('search-bar').filter((a) => (a.data as { scope?: string }).scope === 'dataset');
  return (
    <div className="axp-dsb__stack">
      <SelectField label="Bar asset for Attach data set bar" value={d.bar} options={bars.map((b) => ({ value: b.id, label: b.name }))} onChange={(v) => v && set({ bar: v })} />
      <Segmented label="Placement" value={d.placement || 'asset'} options={[{ value: 'asset', label: "Asset's own" }, ...DSB_PLACEMENTS.map((p) => ({ value: p, label: DSB_PLACEMENT_LABELS[p] }))]} onChange={(v) => set({ placement: v === 'asset' ? '' : (v as DsbPlacement) })} />
      <div className="axp-dsb__field-row">
        <SelectField label="Search bar piece" value={d.search} options={searches.map((a) => ({ value: a.id, label: a.name }))} onChange={(v) => v && set({ search: v })} />
        <SelectField label="Filter button piece" value={d.filter} options={rt.registry.list('filter-button').map((a) => ({ value: a.id, label: a.name }))} onChange={(v) => v && set({ filter: v })} />
        <SelectField label="Sort control piece" value={d.sort} options={rt.registry.list('sort-control').map((a) => ({ value: a.id, label: a.name }))} onChange={(v) => v && set({ sort: v })} />
      </div>
      <Button icon="undo" tone="quiet" size="sm" onClick={() => rt.settings.clear('data-set-bar.defaults')}>Back to the framework defaults</Button>
    </div>
  );
}

/** Every data-set-bar asset drawn over no data set, so the looks can be compared (and shot for UI Review). */
export function LooksPanel() {
  const rt = useRuntime();
  const [showAll, setShowAll] = useState(true);
  const bars = rt.registry.list('data-set-bar');
  return (
    <div className="axp-dsb__stack">
      <Switch label="Show every look" checked={showAll} onChange={setShowAll} hint="The starters are the UI options: full bar, compact inline line, floating pill, footer." />
      {(showAll ? bars : bars.slice(0, 1)).map((b) => {
        const cfg = normalizeDataSetBar(b.data);
        const att = normalizeAttachment({ bar: b.id }, `preview:${b.id}`);
        return (
          <div key={b.id} className="axp-dsb__look">
            <div className="axp-dsb__section-head"><strong>{b.name}</strong><span className="axp-dsb__muted">{b.id} · {DSB_PLACEMENT_LABELS[cfg.placement].toLowerCase()}</span></div>
            <Bar dataset={`preview:${b.id}`} label={b.name} att={att} cfg={{ ...cfg, placement: cfg.placement === 'floating' ? 'top' : cfg.placement }} inline={cfg.placement === 'inline'} pill={cfg.placement === 'floating'} preview />
            <p className="axp-dsb__muted">{b.description}</p>
          </div>
        );
      })}
    </div>
  );
}

export { describeAttachment };

/**
 * Data set bar console plugin (ai.amberx.axf.console.data-set-bar; Brett, Nov 7 2026).
 *
 * Attaches a search / filter / sort bar to ANY data set: every lib-datagrid grid is a dataset (framework/libs/datagrid/
 * datasets.ts) and lists, trees and tables register one with `useDataset` + `<DatasetFrame>`. Hidden by default: nothing
 * is drawn until a data set is attached. The pieces are registry assets of their own type (search-bar with scope
 * dataset, filter-button, sort-control) and the combined `data-set-bar` asset names them; the engine is the framework's
 * core/engines/datasetbar.ts (data-set-bar@1).
 *
 * Attach / detach, every surface:
 * - right-click / long-press a data set (the context menu host records `rt.contextDataset`): Attach data set bar ▸ Top /
 *   Bottom / Inline / Floating, Attach piece ▸; attached: Settings…, Filter…, Sort…, Move ▸, Change bar ▸, Attach /
 *   Detach piece ▸, Clear, Reset to default, Detach data set bar;
 * - the Registry Browser (Appearance → Assets): right-click a data-set-bar / search-bar / filter-button / sort-control
 *   card → Attach to data set ▸;
 * - voice: the console actions below (console_action), e.g. "attach the data set bar to the builds grid, floating";
 * - API / MCP / CLI: the same actions through plugin-commands (`axf data-set-bar attach --args …`).
 * Per-attachment config (bar asset, placement, pieces, applied state, saved filters and sorts, the pill's spot) lives in
 * this device's settings (local-first), with Reset to default. Web only, no server part.
 */
import { Button, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { DATASET_FOOTER_SLOT, DATASET_TOOLBAR_SLOT, getDatasetOrLast, knownDatasets } from '@console/axf/libs/datagrid';
import { DSB_PIECE_LABELS } from '@console/axf/core/engines/datasetbar';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { ACTIONS, act, assetCardItems, datasetContextItems, dec, describeAttachment, FILTER_DIALOG, FOLDER, isPiece, isPlacement, PLUGIN_ID, SETTINGS_DIALOG, SETTINGS_TAB, SORT_DIALOG } from './core';
import { doAttach, doAttachPiece, doChangeBar, doDetach, doDetachPiece, doMove, doReset, readAttachments, resolveFor, setState } from './store';
import { AttachmentSettingsDialog, FilterDialog, SortDialog } from './dialogs';
import { AttachedPanel, DefaultsPanel, LooksPanel } from './panels';
import { FooterSlot, TopSlot, searchConfigOf } from './ui';
import { appMenu } from './menu';
import './data-set-bar.css';

function OpenPanel() {
  const rt = useRuntime();
  const n = Object.keys(readAttachments(rt)).length;
  return (
    <div className="axp-dsb__stack">
      <p className="axp-dsb__muted">Search, filter and sort any data set from a bar that is hidden until you attach it. {n ? `Attached to ${n} data set${n === 1 ? '' : 's'} on this device.` : 'Nothing attached on this device yet.'}</p>
      <div className="axp-dsb__row">
        <Button tone="primary" icon="grid" onClick={() => rt.dispatch('view:plan')}>Open a grid to attach to</Button>
        <Button icon="layers" onClick={() => rt.dispatch('view:assets')}>Registry Browser</Button>
      </div>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: PLUGIN_ID, // equals plugin.json "id"
  label: 'Data set bar',
  version: '0.1.0',
  builtWith: { model: 'fable', builtAt: '2026-11-07' },
  opens: 'dialog',
  appMenu,
  register(rt) {
    const a = rt.actions;
    const label = (ds: string) => getDatasetOrLast(ds)?.label ?? knownDatasets().find((d) => d.id === ds)?.label ?? ds;
    a.register(ACTIONS.list, () => {
      const map = readAttachments(rt); const rows = Object.values(map);
      rt.toast(rows.length ? rows.map((att) => describeAttachment(att, resolveFor(rt, att), label(att.dataset))).join('\n') : 'No data set has a bar attached on this device.', 'info', 'Data set bar');
    }, { label: 'List data set bars', effect: 'read' } as never);
    a.register(ACTIONS.attach, ([ds = '', placement = '', bar = '']) => { const d = dec(ds), p = dec(placement); if (!d) return; doAttach(rt, d, isPlacement(p) ? p : '', dec(bar) || undefined); rt.toast(`Data set bar attached to ${label(d)}.`, 'success', 'Data set bar'); }, { label: 'Attach data set bar', params: true, effect: 'write' } as never);
    a.register(ACTIONS.detach, ([ds = '']) => { const d = dec(ds); if (!d) return; doDetach(rt, d); rt.toast(`Data set bar detached from ${label(d)}.`, 'info', 'Data set bar'); }, { label: 'Detach data set bar', params: true, effect: 'write' } as never);
    a.register(ACTIONS.piece, ([ds = '', piece = '', asset = '']) => { const d = dec(ds), p = dec(piece); if (!d || !isPiece(p)) return; doAttachPiece(rt, d, p, dec(asset) || undefined); rt.toast(`${DSB_PIECE_LABELS[p]} attached to ${label(d)}.`, 'success', 'Data set bar'); }, { label: 'Attach a data set bar piece', params: true, effect: 'write' } as never);
    a.register(ACTIONS.unpiece, ([ds = '', piece = '']) => { const d = dec(ds), p = dec(piece); if (!d || !isPiece(p)) return; doDetachPiece(rt, d, p); }, { label: 'Detach a data set bar piece', params: true, effect: 'write' } as never);
    a.register(ACTIONS.move, ([ds = '', placement = '']) => { const d = dec(ds), p = dec(placement); if (d && isPlacement(p)) doMove(rt, d, p); }, { label: 'Move the data set bar', params: true, effect: 'write' } as never);
    a.register(ACTIONS.bar, ([ds = '', bar = '']) => { const d = dec(ds); if (d && dec(bar)) doChangeBar(rt, d, dec(bar)); }, { label: 'Change the data set bar asset', params: true, effect: 'write' } as never);
    a.register(ACTIONS.reset, ([ds = '']) => { const d = dec(ds); if (d) doReset(rt, d); }, { label: 'Reset a data set bar to default', params: true, effect: 'write' } as never);
    a.register(ACTIONS.settings, ([ds = '']) => rt.openDialog(SETTINGS_DIALOG, { dataset: dec(ds) }), { label: 'Data set bar settings', params: true, effect: 'navigate' } as never);
    a.register(ACTIONS.filter, ([ds = '']) => rt.openDialog(FILTER_DIALOG, { dataset: dec(ds) }), { label: 'Filter a data set', params: true, effect: 'navigate' } as never);
    a.register(ACTIONS.sort, ([ds = '']) => rt.openDialog(SORT_DIALOG, { dataset: dec(ds) }), { label: 'Sort a data set', params: true, effect: 'navigate' } as never);
    a.register(ACTIONS.search, ([ds = '', ...text]) => { const d = dec(ds); const att = readAttachments(rt)[d]; if (att) setState(rt, d, { ...att.state, query: text.map(dec).join(':') }); }, { label: 'Search a data set', params: true, effect: 'write' } as never);
    a.register(ACTIONS.clear, ([ds = '']) => { const d = dec(ds); const att = readAttachments(rt)[d]; if (att) setState(rt, d, { ...att.state, query: '', field: '', rules: [], sort: [] }); }, { label: 'Clear a data set bar', params: true, effect: 'write' } as never);

    // Right-click on any data set (the host sets rt.contextDataset from data-axf-dataset): attach / detach / settings.
    const barChoices = () => rt.registry.list('data-set-bar').map((b) => ({ id: b.id, name: b.name }));
    const pieceChoices = () => ({
      search: rt.registry.list('search-bar').filter((s) => searchConfigOf(rt, s.id).scope === 'dataset' || (s.data as { scope?: string }).scope === 'dataset').map((s) => ({ id: s.id, name: s.name })),
      filter: rt.registry.list('filter-button').map((s) => ({ id: s.id, name: s.name })),
      sort: rt.registry.list('sort-control').map((s) => ({ id: s.id, name: s.name })),
    });
    rt.contextExtras.set('*:data-set-bar', (target) => {
      const ds = rt.contextDataset;
      if (!ds || target === 'asset-card') return [];
      const att = readAttachments(rt)[ds] ?? null;
      return datasetContextItems(ds, att, { bars: barChoices(), pieces: pieceChoices(), resolved: att ? resolveFor(rt, att) : null });
    });
    // The Registry Browser: right-click one of our asset cards → Attach to data set ▸ (data sets seen so far).
    rt.contextExtras.set('*:data-set-bar.asset-card', (target, payload) => (target === 'asset-card' && payload ? assetCardItems(payload, knownDatasets()) : []));
  },
  dialogs: {
    [FILTER_DIALOG]: { title: 'Filter', icon: 'sliders', searchable: false, render: (props, close) => <FilterDialog dataset={typeof props.dataset === 'string' ? props.dataset : typeof props.arg === 'string' ? props.arg : undefined} close={close} /> },
    [SORT_DIALOG]: { title: 'Sort', icon: 'chevron-down', searchable: false, render: (props, close) => <SortDialog dataset={typeof props.dataset === 'string' ? props.dataset : typeof props.arg === 'string' ? props.arg : undefined} close={close} /> },
    [SETTINGS_DIALOG]: { title: 'Data set bar', icon: 'list', searchable: false, render: (props, close) => <AttachmentSettingsDialog dataset={typeof props.dataset === 'string' ? props.dataset : typeof props.arg === 'string' ? props.arg : undefined} close={close} /> },
  },
  slots: {
    [DATASET_TOOLBAR_SLOT]: [{ id: 'data-set-bar.top', order: 5, render: (p) => (typeof p.dataset === 'string' ? <TopSlot dataset={p.dataset} label={typeof p.label === 'string' ? p.label : undefined} /> : null) }],
    [DATASET_FOOTER_SLOT]: [{ id: 'data-set-bar.footer', order: 5, render: (p) => (typeof p.dataset === 'string' ? <FooterSlot dataset={p.dataset} label={typeof p.label === 'string' ? p.label : undefined} /> : null) }],
  },
  settingsTabs: [{ id: SETTINGS_TAB, label: 'Data set bar', icon: 'list', order: 8, parent: 'plugins', description: 'A search / filter / sort bar for any data set, hidden until attached; which data sets have one, what a plain attach uses, every look.' }],
  settingsPanels: [
    { id: 'data-set-bar.open', tab: SETTINGS_TAB, title: 'Data set bar', icon: 'list', order: 5, render: () => <OpenPanel /> },
    { id: 'data-set-bar.attached', tab: SETTINGS_TAB, title: 'Attached data sets', icon: 'grid', order: 10, render: () => <AttachedPanel /> },
    { id: 'data-set-bar.defaults', tab: SETTINGS_TAB, title: 'Defaults for a plain attach', icon: 'settings', order: 20, render: () => <DefaultsPanel /> },
    { id: 'data-set-bar.looks', tab: SETTINGS_TAB, title: 'Looks', icon: 'palette', order: 30, render: () => <LooksPanel /> },
    { id: 'data-set-bar.lifecycle', tab: SETTINGS_TAB, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

export { act };

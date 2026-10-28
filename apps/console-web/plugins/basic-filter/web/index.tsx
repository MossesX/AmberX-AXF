/**
 * Basic filter console plugin (ai.amberx.axf.console.basic-filter).
 *
 * A sort & filter dialog (search, rules on any column, match all / any, multi-level sort) that attaches to any dataset:
 * every lib-datagrid grid is a dataset (framework/libs/datagrid/datasets.ts), and anything else can register one. When
 * attached, the plugin puts the saved filter on the dataset and draws its toolbar above it (default: on, one button
 * that opens the dialog). The toolbar is designed in Settings → Plugins → Basic filter: show / hide, preset actions in
 * a grid with expandable rows (everything about the action and its style), and a live floating preview.
 * Attach / detach from its settings or from its row in Plugin switches (slot `plugin-switches.row`).
 *
 * Web only, no server part. Its three values live in the app's settings (basic-filter.toolbar / .datasets / .state);
 * everything else is runtime contributions, so switching it off or uninstalling it takes every filter off.
 */
import { Button, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { DATASET_TOOLBAR_SLOT } from '@console/axf/libs/datagrid';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { DIALOG, FOLDER } from './core';
import { AttachList, DatasetSlot, FilterDialog, SwitchesExtra, ToolbarDesigner } from './ui';
import { appMenu } from './menu';
import './basic-filter.css';

const ID = 'ai.amberx.axf.console.basic-filter';

function OpenPanel() {
  const rt = useRuntime();
  return (
    <div className="axp-basic-filter__stack">
      <p className="axp-basic-filter__muted">Search, filter and sort any dataset (every grid is one). Attach it below or from its row in Plugin switches; the toolbar then shows above the grid.</p>
      <div className="axp-basic-filter__row">
        <Button tone="primary" icon="sliders" onClick={() => rt.openDialog(DIALOG)}>Open sort & filter</Button>
        <Button icon="sliders" onClick={() => rt.dispatch('plugin-switches.open')}>Plugin switches</Button>
      </div>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Basic filter',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-10-28' },
  // the dialog works over the grid it filters, so it opens as a dialog (changeable in its settings: Opens in)
  opens: 'dialog',
  appMenu,
  register(rt) {
    rt.actions.register('basic-filter.open', ([dataset = '']) => rt.openDialog(DIALOG, dataset ? { dataset } : undefined), { label: 'Sort & filter', params: true } as never);
  },
  dialogs: {
    [DIALOG]: { title: 'Sort & filter', icon: 'sliders', render: (props, close) => <FilterDialog dataset={typeof props.dataset === 'string' ? props.dataset : typeof props.arg === 'string' ? props.arg : undefined} close={close} /> },
  },
  slots: {
    [DATASET_TOOLBAR_SLOT]: [{ id: 'basic-filter.toolbar', order: 10, render: (p) => (typeof p.dataset === 'string' ? <DatasetSlot dataset={p.dataset} /> : null) }],
    'plugin-switches.row': [{ id: 'basic-filter.attach', render: (p) => (p.folder === FOLDER ? <SwitchesExtra enabled={p.enabled === true} /> : null) }],
  },
  settingsTabs: [{ id: 'basic-filter', label: 'Basic filter', icon: 'sliders', order: 7, parent: 'plugins', description: 'Sort & filter for any dataset, its toolbar, and which datasets it is attached to.' }],
  settingsPanels: [
    { id: 'basic-filter.open', tab: 'basic-filter', title: 'Basic filter', icon: 'sliders', order: 5, render: () => <OpenPanel /> },
    { id: 'basic-filter.toolbar', tab: 'basic-filter', title: 'Toolbar', icon: 'menu', order: 10, render: () => <ToolbarDesigner /> },
    { id: 'basic-filter.datasets', tab: 'basic-filter', title: 'Attached datasets', icon: 'grid', order: 20, render: () => <AttachList /> },
    { id: 'basic-filter.lifecycle', tab: 'basic-filter', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

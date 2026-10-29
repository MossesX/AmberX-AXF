import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { FOLDER, ID, KEYS, setFocus, VIEW } from './focus';
import { FeatureMatrixPage } from './ui';

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Feature matrix',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('feature-matrix.open', ([id = '']) => { if (id) setFocus(decodeURIComponent(id)); rt.navigate(VIEW); }, { label: 'Open the feature matrix', params: true } as never);
  },
  views: { [VIEW]: { title: 'Feature matrix', icon: 'check-circle', keywords: ['feature matrix', 'matrix', 'scope', 'keep', 'skip', 'apply', 'features', 'minutes', 'fable', 'opus'], render: () => <FeatureMatrixPage /> } },
  nav: { label: 'Builds', items: [{ id: VIEW, label: 'Feature matrix', icon: 'check-circle', view: VIEW }] },
  contextMenu: [{ id: 'feature-matrix.default', target: 'default', order: 92, items: [{ id: 'feature-matrix', label: 'Feature matrix', icon: 'check-circle', action: 'nav:feature-matrix' }] }],
  settingsTabs: [{ id: 'feature-matrix', label: 'Feature matrix', icon: 'check-circle', parent: 'plugins', order: 44, description: 'Every build’s keep / skip feature list, one dataset, Apply to every table.' }],
  settings: [{
    id: 'feature-matrix.prefs', label: 'Feature matrix', icon: 'check-circle', tab: 'feature-matrix', order: 10,
    settings: [
      { key: KEYS.sort, label: 'Default order', kind: 'choice', default: 'updated', options: [{ value: 'updated', label: 'Last changed first' }, { value: 'added', label: 'Newest added first' }] },
      { key: KEYS.rowButton, label: 'Row button in builds grids', kind: 'toggle', default: true, description: 'A Feature matrix button on every row of the builds grids (the right-click item stays either way).' },
      { key: KEYS.history, label: 'Open the history with the matrix', kind: 'toggle', default: false },
    ],
  }],
  settingsPanels: [{ id: 'feature-matrix.lifecycle', tab: 'feature-matrix', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

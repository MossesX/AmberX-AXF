import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, ID, setFocus } from './api';
import { ChangeLogPanel, RetentionPanel, SnapshotsPanel, TakePanel } from './panels';
import './snapshot-manager.css';
import { appMenu } from './menu';

/*
 * Snapshot Manager (web part): Settings → Plugins → Snapshots. Action `snapshots.show:<id>` opens one snapshot
 * (the change-batch card uses it for its snapshot links when it exists).
 */
export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Snapshot Manager',
  version: '0.1.0',
  appMenu,
  provides: ['axf.snapshot-manager'],
  register(rt) {
    rt.actions.register('snapshots.show', ([id]) => { setFocus(id ?? ''); rt.dispatch('settings.open:snapshots'); }, { label: 'Show a snapshot', params: true });
  },
  settingsTabs: [{ id: 'snapshots', label: 'Snapshots', icon: 'save', parent: 'plugins', order: 41, description: 'Snapshots taken before every approved change: browse, diff, restore (one-step undo), retention and the change log.' }],
  settingsPanels: [
    { id: 'snapshots.list', tab: 'snapshots', title: 'Snapshots', icon: 'save', order: 10, render: () => <div className="axp-snapshot-manager"><SnapshotsPanel /></div> },
    { id: 'snapshots.take', tab: 'snapshots', title: 'Take a snapshot', icon: 'plus', order: 20, render: () => <div className="axp-snapshot-manager"><TakePanel /></div> },
    { id: 'snapshots.retention', tab: 'snapshots', title: 'Retention', icon: 'clock', order: 30, render: () => <div className="axp-snapshot-manager"><RetentionPanel /></div> },
    { id: 'snapshots.changes', tab: 'snapshots', title: 'Change log', icon: 'list', order: 40, render: () => <div className="axp-snapshot-manager"><ChangeLogPanel /></div> },
    { id: 'snapshots.lifecycle', tab: 'snapshots', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

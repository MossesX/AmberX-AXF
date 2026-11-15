import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { BackupPanel, FOLDER, ModePanel, StatusPanel, useDataStore } from './DataStoreTab';

function Loaded({ children }: { children: (s: NonNullable<ReturnType<typeof useDataStore>['s']>, reload: () => Promise<void>) => JSX.Element }) {
  const { s, err, load } = useDataStore();
  if (err) return <p className="fx-small" role="alert">{err}</p>;
  if (!s) return <p className="fx-small fx-muted">Loading…</p>;
  return children(s, () => load(true));
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.data-store', // = plugin.json "id"
  label: 'Data store',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-15' },
  // Settings → Plugins → Data store (deep link view:settings/tab:settings.tabs=plugins/data-store)
  settingsTabs: [{ id: FOLDER, label: 'Data store', icon: 'layers', order: 44, parent: 'plugins' }],
  settingsPanels: [
    { id: 'data-store.status', tab: FOLDER, title: 'Where the data is', icon: 'layers', order: 10, render: () => <Loaded>{(s) => <StatusPanel s={s} />}</Loaded> },
    { id: 'data-store.backups', tab: FOLDER, title: 'Backups', icon: 'save', order: 20, render: () => <Loaded>{(s, r) => <BackupPanel s={s} reload={r} />}</Loaded> },
    { id: 'data-store.mode', tab: FOLDER, title: 'Move a namespace', icon: 'shuffle', order: 30, render: () => <Loaded>{(s, r) => <ModePanel s={s} reload={r} />}</Loaded> },
    { id: 'data-store.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { BackupPanel, ModePanel, RowsView, StagesView, StatusPanel, currentView, useDataStore } from './DataStoreTab';
import panels from '../assets/settings/data-store-panels.json';
import rows from '../assets/settings/data-store-rows.json';
import stages from '../assets/settings/data-store-stages.json';

/** The three layouts (UI Review choices) are settings assets; the one in use is `axf.data-store.view` (panels by default). */
const VIEWS = [panels, rows, stages];
const VIEW = currentView();

function Loaded({ children }: { children: (s: NonNullable<ReturnType<typeof useDataStore>['s']>, reload: () => Promise<void>) => JSX.Element }) {
  const { s, err, load } = useDataStore();
  if (err) return <p className="fx-small" role="alert">{err}</p>;
  if (!s) return <p className="fx-small fx-muted">Loading…</p>;
  return children(s, () => load(true));
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.data-store', // = plugin.json "id"
  appMenu,
  label: 'Data store',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-15' },
  // Settings → Plugins → Data store (deep link view:settings/tab:settings.tabs=plugins/data-store)
  settingsTabs: [{ id: 'data-store', label: 'Data store', icon: 'layers', order: 44, parent: 'plugins' }],
  register(rt) {
    for (const a of VIEWS) rt.registry.register(a as Parameters<typeof rt.registry.register>[0], 'app', 'ai.amberx.axf.console.data-store');
  },
  settingsPanels: [
    ...(VIEW === 'stages' ? [{ id: 'data-store.stages', tab: 'data-store', title: 'Where the data is', icon: 'layers', order: 5, render: () => <Loaded>{(s) => <StagesView s={s} />}</Loaded> }] : []),
    ...(VIEW === 'rows' ? [{ id: 'data-store.rows', tab: 'data-store', title: 'Namespaces', icon: 'layers', order: 15, render: () => <Loaded>{(s, r) => <RowsView s={s} reload={r} />}</Loaded> }] : []),
    ...(VIEW === 'panels' ? [{ id: 'data-store.status', tab: 'data-store', title: 'Where the data is', icon: 'layers', order: 10, render: () => <Loaded>{(s) => <StatusPanel s={s} />}</Loaded> }] : []),
    { id: 'data-store.backups', tab: 'data-store', title: 'Backups', icon: 'save', order: VIEW === 'rows' ? 10 : VIEW === 'stages' ? 40 : 20, render: () => <Loaded>{(s, r) => <BackupPanel s={s} reload={r} />}</Loaded> },
    ...(VIEW !== 'rows' ? [{ id: 'data-store.mode', tab: 'data-store', title: 'Move a namespace', icon: 'shuffle', order: 30, render: () => <Loaded>{(s, r) => <ModePanel s={s} reload={r} />}</Loaded> }] : []),
    { id: 'data-store.lifecycle', tab: 'data-store', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder="data-store" /> },
  ],
};

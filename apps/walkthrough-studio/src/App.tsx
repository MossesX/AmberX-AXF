import { useEffect, useMemo } from 'react';
import { AccountView, AppShell, AssetStudio, installLibraries, useRuntime, type ViewMap } from './axf/react';
import { library as settingsLibrary } from './axf/libs/settings';
import { library as dndLibrary } from './axf/libs/dnd';
import { library as treeLibrary } from './axf/libs/tree';
import { library as dataGridLibrary } from './axf/libs/datagrid';
import { library as workspaceLibrary } from './axf/libs/workspace';
import { library as recorderLibrary } from './axf/libs/recorder';
import { library as docstoreLibrary } from './axf/libs/docstore';
import { dialogs } from './dialogs';
import { studioLibrary } from './studio/library';
import { Studio } from './views/Studio';
import { studio } from './studio/store';
import { wireStudio } from './studio/wiring';
import './studio/studio.css';

/** Views the shell can show; the nav-menu asset `walkthrough-studio` references these ids. */
const views: ViewMap = {
  home: { title: 'Studio', icon: 'monitor', keywords: ['walkthrough', 'video', 'record', 'grid', 'index', 'timeline'], render: () => <Studio /> },
  assets: { title: 'Assets', icon: 'layers', render: () => <AssetStudio /> },
  account: { title: 'Account', icon: 'shield', render: () => <AccountView /> },
};

/**
 * Libraries this app ships: the settings interface, the six harvested from this studio (each reads its configured parts
 * from axf.manifest.json → libraries.<key>) and the studio's own (its settings sub-tab under Settings → Plugins).
 */
const libraries = [settingsLibrary, dndLibrary, treeLibrary, dataGridLibrary, workspaceLibrary, recorderLibrary, docstoreLibrary, studioLibrary];

export function App() {
  const rt = useRuntime();
  const contributed = useMemo(() => installLibraries(rt, libraries), [rt]);
  useEffect(() => wireStudio(rt), [rt]);
  useEffect(() => {
    const leave = () => void studio().flush();
    window.addEventListener('pagehide', leave);
    return () => window.removeEventListener('pagehide', leave);
  }, []);
  return <AppShell views={{ ...contributed.views, ...views }} dialogs={{ ...contributed.dialogs, ...dialogs }} tabs={contributed.tabs} />;
}

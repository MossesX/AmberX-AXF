import { useEffect, useMemo } from 'react';
import { AccountView, AppShell, AssetStudio, installLibraries, useRuntime, type ViewMap } from './axf/react';
import { library as settingsLibrary } from './axf/libs/settings';
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

/** Libraries this app ships: the settings interface + the studio's own (its settings group under Settings → Plugins). */
const libraries = [settingsLibrary, studioLibrary];

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

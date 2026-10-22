import { useMemo } from 'react';
import { AccountView, AppShell, AssetStudio, installLibraries, useRuntime, type ViewMap } from './axf/react';
import { library as settingsLibrary } from './axf/libs/settings';
import { dialogs } from './dialogs';
import { Home } from './views/Home';
import { Components } from './views/Components';

/** Views the shell can show. Navigation-menu assets reference these ids. */
const views: ViewMap = {
  home: { title: 'Home', icon: 'home', render: () => <Home /> },
  components: { title: 'Components', icon: 'grid', render: () => <Components /> },
  assets: { title: 'Assets', icon: 'layers', render: () => <AssetStudio /> },
  account: { title: 'Account', icon: 'shield', render: () => <AccountView /> },
};

/**
 * Libraries this app ships. Every app built by the build engine ships the settings interface (lib-settings: Appearance,
 * Account & security, Connections, Plugins, About). Plugins never get a settings screen of their own: they add groups,
 * panels or sub-tabs to Settings → Plugins through their `AxfWebLibrary`, and the Plugins tab lists every installed
 * library with its health (plugin inventory engine). Add more libraries to this list.
 */
const libraries = [settingsLibrary];

export function App() {
  const rt = useRuntime();
  const contributed = useMemo(() => installLibraries(rt, libraries), [rt]);
  return <AppShell views={{ ...contributed.views, ...views }} dialogs={{ ...contributed.dialogs, ...dialogs }} tabs={contributed.tabs} />;
}

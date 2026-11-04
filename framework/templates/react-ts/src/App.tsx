import { useMemo } from 'react';
import { AccountView, AppShell, AssetStudio, installLibraries, useRuntime, type ViewMap } from './axf/react';
import { library as settingsLibrary } from './axf/libs/settings';
import { toolbarsLibrary } from './axf/libs/toolbars';
import { controlSurfaceLibrary } from './axf/libs/control-surface';
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
 * library with its health (plugin inventory engine). Every app is also on the API, MCP and CLI from day one
 * (lib-control-surface, Brett Nov 3 2026: "Put EVERY app on the API, MCP and CLI"): while it is open it reports its
 * screens, dialogs, settings tabs and actions to the control surface broker, so a Claude session can open them
 * (`app_show {app: '<this app id>', target: '…'}`); Settings → Plugins → Remote control switches it off per device.
 * Add more libraries to this list.
 */
const libraries = [settingsLibrary, toolbarsLibrary, controlSurfaceLibrary];

export function App() {
  const rt = useRuntime();
  const contributed = useMemo(() => installLibraries(rt, libraries), [rt]);
  return <AppShell views={{ ...contributed.views, ...views }} dialogs={{ ...contributed.dialogs, ...dialogs }} tabs={contributed.tabs} />;
}

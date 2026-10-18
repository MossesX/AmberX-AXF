import { useCallback, useEffect, useMemo, useState } from 'react';
import { AccountView, AppShell, AssetStudio, useRuntime, type ViewMap } from './axf/react';
import { installLibraries } from './axf/react/library';
import { dialogs } from './dialogs';
import { ConsoleStoreProvider, useStore } from './store';
import { Home } from './views/Home';
import { Tracker } from './views/Tracker';
import { Catalog } from './views/Catalog';
import { Libraries } from './views/Libraries';
import { Demos, Modules } from './views/DemosModules';
import { Boilerplates } from './views/Boilerplates';
import { Components } from './views/Components';
import { consoleTabs, useUndockDrop } from './views/Explorer';
import { Plan, PlanFeatureTab } from './views/Plan';
import { BuildManager } from './views/BuildManager';
import { PluginsView } from './views/Plugins';
import { bundledPlugins, enabledPlugins, fetchPluginStatus, type PluginStatus } from './plugins';

/** Views the shell can show. The console-nav asset references these ids. */
const views: ViewMap = {
  home: { title: 'Home', icon: 'home', render: () => <Home /> },
  tracker: { title: 'Tracker', icon: 'check-circle', render: () => <Tracker /> },
  plan: { title: 'Plan', icon: 'layers', render: () => <Plan /> },
  build: { title: 'Build', icon: 'play', render: () => <BuildManager /> },
  catalog: { title: 'Catalog', icon: 'list', render: () => <Catalog /> },
  libraries: { title: 'Libraries', icon: 'box', render: () => <Libraries /> },
  demos: { title: 'Demos', icon: 'smartphone', render: () => <Demos /> },
  modules: { title: 'Modules', icon: 'package', render: () => <Modules /> },
  boilerplates: { title: 'Boilerplates', icon: 'layout', render: () => <Boilerplates /> },
  components: { title: 'Components', icon: 'grid', render: () => <Components /> },
  assets: { title: 'Assets', icon: 'palette', render: () => <AssetStudio /> },
  account: { title: 'Account', icon: 'shield', render: () => <AccountView /> },
};

/** Installed console plugins (apps/console-web/plugins), filtered by what the backend says is enabled. */
function usePlugins() {
  const rt = useRuntime();
  const [status, setStatus] = useState<PluginStatus[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => { setStatus(await fetchPluginStatus()); setLoaded(true); }, []);
  useEffect(() => { void reload(); }, [reload]);
  const contributed = useMemo(() => {
    if (!loaded) return { views: {}, dialogs: {}, tabs: {} };
    const enabled = enabledPlugins(status);
    for (const p of bundledPlugins) if (!enabled.includes(p)) rt.removeNavSection(p.manifest.id);
    return installLibraries(rt, enabled.map((p) => p.library!));
  }, [rt, status, loaded]);
  return { status, reload, contributed };
}

function Shell() {
  const s = useStore();
  const drop = useUndockDrop();
  const plugins = usePlugins();
  useEffect(() => { (globalThis as unknown as { __axfConsole?: unknown }).__axfConsole = s; }, [s]);
  const allViews: ViewMap = {
    ...plugins.contributed.views,
    ...views,
    plugins: { title: 'Plugins', icon: 'package', render: () => <PluginsView status={plugins.status} reload={plugins.reload} /> },
  };
  return (
    <div {...drop} style={{ display: 'contents' }}>
      <AppShell
        views={allViews}
        dialogs={{ ...plugins.contributed.dialogs, ...dialogs }}
        tabs={{ ...plugins.contributed.tabs, ...consoleTabs, 'plan-feature': (t) => <PlanFeatureTab id={t.payload || ''} /> }}
      />
    </div>
  );
}

export function App() {
  return <ConsoleStoreProvider><Shell /></ConsoleStoreProvider>;
}

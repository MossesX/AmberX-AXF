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
import { Pending } from './views/Pending';
import { Standards } from './views/Standards';
import { SystemBanner, useSystemCheckOnLoad } from './views/SystemCheck';
import { bundledPlugins, enabledPlugins, fetchPluginStatus, PLUGINS_CHANGED, type PluginStatus } from './plugins';
import { library as settingsLibrary } from './axf/libs/settings';
import { createAlertsLibrary } from './axf/libs/alerts';
import { consoleAlertsTransport } from './alertsTransport';
import { consoleSettings } from './consoleSettings';

/** Developer alerts (framework library), stored and pushed by the console server. */
const alertsLibrary = createAlertsLibrary({ transport: consoleAlertsTransport, crashWhere: 'console', serviceWorkerUrl: '/alerts-sw.js' });

/** Views the shell can show. The console-nav asset references these ids. */
const views: ViewMap = {
  home: { title: 'Home', icon: 'home', render: () => <Home /> },
  tracker: { title: 'Tracker', icon: 'check-circle', render: () => <Tracker /> },
  plan: { title: 'Plan', icon: 'layers', render: () => <Plan /> },
  build: { title: 'Build', icon: 'play', render: () => <BuildManager /> },
  pending: { title: 'Pending builds', icon: 'clock', render: () => <Pending /> },
  // Standards: rules every project must meet (first: project manifests).
  'standards-projects': { title: 'Projects', icon: 'folder', render: () => <Standards tab="projects" /> },
  'standards-rules': { title: 'Manifest rules', icon: 'shield', render: () => <Standards tab="rules" /> },
  catalog: { title: 'Catalog', icon: 'list', render: () => <Catalog /> },
  libraries: { title: 'Libraries', icon: 'box', render: () => <Libraries /> },
  demos: { title: 'Demos', icon: 'smartphone', render: () => <Demos /> },
  modules: { title: 'Modules', icon: 'package', render: () => <Modules /> },
  boilerplates: { title: 'Boilerplates', icon: 'layout', render: () => <Boilerplates /> },
  components: { title: 'Components', icon: 'grid', render: () => <Components /> },
  assets: { title: 'Assets', icon: 'palette', render: () => <AssetStudio /> },
  account: { title: 'Account', icon: 'shield', render: () => <AccountView /> },
};

function OpenSettingsTab({ tab }: { tab: string }) {
  const rt = useRuntime();
  useEffect(() => { rt.dispatch(`settings.open:${tab}`); }, [rt, tab]);
  return null;
}

/** Installed console plugins (apps/console-web/plugins), filtered by what the backend says is enabled. */
function usePlugins() {
  const rt = useRuntime();
  const [status, setStatus] = useState<PluginStatus[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => { setStatus(await fetchPluginStatus()); setLoaded(true); }, []);
  useEffect(() => {
    void reload();
    const onChange = () => void reload();
    globalThis.addEventListener(PLUGINS_CHANGED, onChange);
    return () => globalThis.removeEventListener(PLUGINS_CHANGED, onChange);
  }, [reload]);
  const contributed = useMemo(() => {
    // The settings library and the console's own settings always run; plugins once the backend has answered.
    const enabled = loaded ? enabledPlugins(status) : [];
    for (const p of bundledPlugins) if (!enabled.includes(p)) { rt.removeNavSection(p.manifest.id); rt.settings.removeModule(p.manifest.id); }
    return installLibraries(rt, [settingsLibrary, alertsLibrary, consoleSettings, ...enabled.map((p) => p.library!)]);
  }, [rt, status, loaded]);
  return { contributed };
}

function Shell() {
  const s = useStore();
  const drop = useUndockDrop();
  const plugins = usePlugins();
  useEffect(() => { (globalThis as unknown as { __axfConsole?: unknown }).__axfConsole = s; }, [s]);
  const allViews: ViewMap = {
    ...plugins.contributed.views,
    ...views,
    // Old link: the plugin manager now lives in Settings → Plugins.
    plugins: { title: 'Plugins', icon: 'package', render: () => <OpenSettingsTab tab="plugins" /> },
  };
  // Systems check: runs when the console loads; its banner sits at the top of every view while anything needs setup.
  useSystemCheckOnLoad();
  const withBanner: ViewMap = Object.fromEntries(Object.entries(allViews).map(([id, v]) => [id, { ...v, render: () => <><SystemBanner />{v.render()}</> }]));
  return (
    <div {...drop} style={{ display: 'contents' }}>
      <AppShell
        views={withBanner}
        dialogs={{ ...plugins.contributed.dialogs, ...dialogs }}
        tabs={{ ...plugins.contributed.tabs, ...consoleTabs, 'plan-feature': (t) => <PlanFeatureTab id={t.payload || ''} /> }}
      />
    </div>
  );
}

export function App() {
  return <ConsoleStoreProvider><Shell /></ConsoleStoreProvider>;
}

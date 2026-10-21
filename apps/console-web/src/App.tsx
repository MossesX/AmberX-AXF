import { installConsoleSearch } from './consoleSearch';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AccountView, AppShell, AssetStudio, FRAME_BANNERS_SLOT, SlotsProvider, useRuntime, type ViewMap } from './axf/react';
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
import type { AxfWebLibrary } from './axf/react/library';
import { bundledPlugins, enabledPlugins, fetchPluginStatus, PLUGINS_CHANGED, type PluginStatus } from './plugins';
import { library as settingsLibrary } from './axf/libs/settings';
import { createAlertsLibrary } from './axf/libs/alerts';
import { consoleAlertsTransport } from './alertsTransport';
import { consoleSettings } from './consoleSettings';
import { accountLibrary, useBindAccount } from './account';
import { hubAppearanceLibrary, useHubAppearance } from './hubAppearance';
import { menuLibrary } from './menuLibrary';
import { BannerStrip, isBannerStrip, useBannerRelay, useBannersInConsole } from './bannerStrip';

/** Developer alerts (framework library), stored and pushed by the console server. */
const alertsLibrary = createAlertsLibrary({ transport: consoleAlertsTransport, crashWhere: 'console', serviceWorkerUrl: '/alerts-sw.js' });

/** Views the shell can show. The console-nav asset references these ids. */
const views: ViewMap = {
  home: { title: 'Home', icon: 'home', render: () => <Home /> },
  tracker: { title: 'Tracker', icon: 'check-circle', render: () => <Tracker /> },
  plan: { title: 'Plan', icon: 'layers', render: () => <Plan /> },
  build: { title: 'Build queue', icon: 'play', render: () => <BuildManager /> },
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

/**
 * Plugins never get a top-level settings tab: every tab a plugin contributes becomes a sub-tab of Settings → Plugins
 * (Brett's rule, Oct 18 2026). Enforced here for every plugin, so a plugin can't opt out by forgetting `parent`.
 */
function underPlugins(lib: AxfWebLibrary): AxfWebLibrary {
  if (!lib.settingsTabs?.length) return lib;
  return { ...lib, settingsTabs: lib.settingsTabs.map((t) => ({ ...t, parent: 'plugins' })) };
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
  // Search bar (banner widget): plan features, tracker items, pending builds and plugins on top of the framework's own.
  useEffect(() => installConsoleSearch(rt), [rt]);
  const contributed = useMemo(() => {
    // The settings library and the console's own settings always run; plugins once the backend has answered.
    const enabled = loaded ? enabledPlugins(status) : [];
    for (const p of bundledPlugins) if (!enabled.includes(p)) { rt.removeNavSection(p.manifest.id); rt.removeContextItems(p.manifest.id); rt.removeAppMenuItems(p.manifest.id); rt.settings.removeModule(p.manifest.id); rt.detachAll(p.manifest.id); }
    return installLibraries(rt, [settingsLibrary, alertsLibrary, consoleSettings, accountLibrary, hubAppearanceLibrary, menuLibrary, ...enabled.map((p) => underPlugins(p.library!))]);
  }, [rt, status, loaded]);
  return { contributed };
}

function Shell() {
  const s = useStore();
  const drop = useUndockDrop();
  // Signed in through axHub's wall: the account decides the access role (themes, plugins); see src/account.tsx.
  useBindAccount();
  // Developer app: the look + settings come from axHub's data server (src/hubAppearance.tsx); waits for the hub.
  useHubAppearance();
  const plugins = usePlugins();
  useEffect(() => { (globalThis as unknown as { __axfConsole?: unknown }).__axfConsole = s; }, [s]);
  const allViews: ViewMap = {
    ...plugins.contributed.views,
    ...views,
    // Old link: the plugin manager now lives in Settings → Plugins.
    plugins: { title: 'Plugins', icon: 'package', render: () => <OpenSettingsTab tab="plugins" /> },
  };
  // Plugin banners (codebase changes, builds, activity, approvals, systems check, keys, What's new) sit above the page
  // (slot app.frame.banners) when the console runs on its own. As a tab in Patches the console page shows none of them:
  // Patches shows them above every tab through the banner strip page (`?axf-strip=banners`, src/bannerStrip.tsx), which
  // is only them (Brett, Oct 21 2026). The console's own banners (the menu rescue note) stay on the console page.
  const inConsole = useBannersInConsole();
  useBannerRelay();
  const consoleOwn = useMemo(() => new Set((menuLibrary.banners ?? []).map((b) => b.id)), []);
  const banners = useMemo(() => plugins.contributed.banners.filter((b) => (isBannerStrip
    ? !consoleOwn.has(b.id)
    : consoleOwn.has(b.id) || inConsole)), [plugins.contributed.banners, consoleOwn, inConsole]);
  const slots = useMemo(() => banners.length || isBannerStrip
    ? { ...(isBannerStrip ? {} : plugins.contributed.slots), [FRAME_BANNERS_SLOT]: [...(isBannerStrip ? [] : plugins.contributed.slots[FRAME_BANNERS_SLOT] ?? []), ...banners.map((b) => ({ id: b.id, order: b.order, render: () => b.render() }))] }
    : plugins.contributed.slots, [banners, plugins.contributed.slots]);
  if (isBannerStrip) return <SlotsProvider slots={slots}><BannerStrip /></SlotsProvider>;
  return (
    <div {...drop} style={{ display: 'contents' }}>
      <SlotsProvider slots={slots}>
      <AppShell
        views={allViews}
        dialogs={{ ...plugins.contributed.dialogs, ...dialogs }}
        tabs={{ ...plugins.contributed.tabs, ...consoleTabs, 'plan-feature': (t) => <PlanFeatureTab id={t.payload || ''} /> }}
      />
      </SlotsProvider>
    </div>
  );
}

export function App() {
  return <ConsoleStoreProvider><Shell /></ConsoleStoreProvider>;
}

import { installConsoleSearch } from './consoleSearch';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InterfaceTabBar, InterfaceTabs } from './interfaceTabs';
import { AccountView, AppShell, AssetStudio, bannerSlotDefs, FRAME_BANNERS_SLOT, SlotsProvider, useBannerPrefsTick, useRuntime, type ViewMap } from './axf/react';
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
import { bundledPlugins, enabledPlugins, fetchPluginStatus, hostEnabledPlugins, pluginReport, PLUGINS_CHANGED, serverPartsToSwitchOn, type BundledPlugin, type PluginStatus } from './plugins';
import { post } from './api';
import { library as settingsLibrary } from './axf/libs/settings';
import { createAlertsLibrary } from './axf/libs/alerts';
import { createAshesLibrary, ownersFrom } from './axf/libs/ashes';
import { hubStatusLibrary } from './axf/libs/hubstatus';
import { pluginThemeLibrary, withPluginTheme } from './axf/libs/plugintheme';
import { library as dataGridLibrary } from './axf/libs/datagrid';
import { consoleAlertsTransport } from './alertsTransport';
import { consoleSettings } from './consoleSettings';
import { accountLibrary, useBindAccount } from './account';
import { hubAppearanceLibrary, useHubAppearance } from './hubAppearance';
import { menuLibrary } from './menuLibrary';
import { BannerStrip, isBannerStrip, useBannerRelay, useBannersInConsole } from './bannerStrip';

/** Developer alerts (framework library), stored and pushed by the console server. */
const alertsLibrary = createAlertsLibrary({ transport: consoleAlertsTransport, crashWhere: 'console', serviceWorkerUrl: '/alerts-sw.js' });
// AshesUI (live element inspector): every bundled plugin is known by its axp-<folder> class prefix, with the model that built it
const ashesLibrary = createAshesLibrary({
  owners: (rt) => ownersFrom(
    bundledPlugins.map((p) => ({ folder: p.folder, name: p.manifest.name, id: p.manifest.id, version: p.manifest.version, ...(p.manifest.builtWith?.model ? { model: p.manifest.builtWith.model } : {}) })),
    rt.libraries.map((l) => ({ id: l.id, label: l.label, version: l.version, ...(l.builtWith?.model ? { model: l.builtWith.model } : {}) })),
  ),
});

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
function underPlugins(p: BundledPlugin): AxfWebLibrary {
  const lib = p.library!;
  const m = p.manifest;
  // plugin@1 (Oct 23 2026): the model that built it (badges) and where its UI opens (main area by default; the
  // build engine's default rules fill `opens` in every plugin.json, its settings tab gets the "Opens in" choice).
  const out: AxfWebLibrary = {
    ...lib,
    ...(m.builtWith?.model ? { builtWith: { model: m.builtWith.model, ...(m.builtWith.builtAt ? { builtAt: m.builtWith.builtAt } : {}) } } : {}),
    ...(m.opens ? { opens: m.opens } : {}),
    ...(m.opensUi ? { opensUi: m.opensUi } : {}),
  };
  // Plugin theme override (Brett, Oct 28 2026): every plugin UI root carries data-axf-plugin and its settings tab gets an
  // Appearance panel (framework/libs/plugintheme), so no plugin needs code of its own.
  const themed = (l: AxfWebLibrary) => withPluginTheme(l, { id: m.id, name: m.name });
  if (!lib.settingsTabs?.length) return themed(out);
  return themed({ ...out, settingsTabs: lib.settingsTabs.map((t) => ({ ...t, parent: 'plugins' })) });
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
  // Inside a host that manages plugins (Patches, embed@1 take `plugins`): tell it which plugins the console has, and run
  // only the ones it enabled for the console (Brett, Oct 22 2026). The console's own switches stay as they are for when
  // it runs on its own.
  const managed = rt.hostTakes('plugins');
  const [hostIds, setHostIds] = useState<string[] | null>(rt.hostPlugins);
  useEffect(() => (managed ? rt.onHostPlugins(setHostIds) : undefined), [rt, managed]);
  useEffect(() => { if (managed && loaded) rt.reportPluginsToHost(pluginReport(status)); }, [rt, managed, loaded, status]);
  // A plugin the host enabled whose server part is off here gets it switched on (admins only; the route checks).
  const tried = useRef(new Set<string>());
  useEffect(() => {
    // each folder once per page: a refused switch (not an admin) isn't retried in a loop
    const folders = (managed ? serverPartsToSwitchOn(status, hostIds) : []).filter((f) => !tried.current.has(f));
    if (!folders.length) return;
    folders.forEach((f) => tried.current.add(f));
    void Promise.all(folders.map((f) => post(`plugins/${f}/enabled`, { enabled: true }).catch(() => null))).then(() => reload());
  }, [managed, status, hostIds, reload]);
  const contributed = useMemo(() => {
    // The settings library and the console's own settings always run; plugins once the backend (or the host) has answered.
    const enabled = managed ? hostEnabledPlugins(hostIds) : loaded ? enabledPlugins(status) : [];
    for (const p of bundledPlugins) if (!enabled.includes(p)) { rt.removeNavSection(p.manifest.id); rt.removeContextItems(p.manifest.id); rt.removeAppMenuItems(p.manifest.id); rt.settings.removeModule(p.manifest.id); rt.detachAll(p.manifest.id); rt.removePlacement(p.manifest.id); }
    return installLibraries(rt, [settingsLibrary, alertsLibrary, consoleSettings, accountLibrary, hubAppearanceLibrary, menuLibrary, ashesLibrary, hubStatusLibrary, dataGridLibrary, pluginThemeLibrary, ...enabled.map(underPlugins)]);
  }, [rt, status, loaded, managed, hostIds]);
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
  // Every plugin banner goes through Banner settings (framework BannerSettings.tsx): right-click / long-press any of them →
  // Banner settings, one tab per banner, its look and behaviour (Brett, Oct 22 2026). The console's own rescue note stays plain.
  const rt = useRuntime();
  const bannerPrefs = useBannerPrefsTick();
  const slots = useMemo(() => {
    // Always called: it registers Banner settings and the full banner list, which the dialog needs even when this page
    // shows none (the console tab inside Patches opens it for banners Patches shows through the strip).
    const all = plugins.contributed.banners.filter((b) => !consoleOwn.has(b.id));
    const framed = bannerSlotDefs(rt, all, banners.filter((b) => !consoleOwn.has(b.id)));
    if (!banners.length && !isBannerStrip) return plugins.contributed.slots;
    const own = banners.filter((b) => consoleOwn.has(b.id)).map((b) => ({ id: b.id, order: b.order, render: () => b.render() }));
    return { ...(isBannerStrip ? {} : plugins.contributed.slots), [FRAME_BANNERS_SLOT]: [...(isBannerStrip ? [] : plugins.contributed.slots[FRAME_BANNERS_SLOT] ?? []), ...own, ...framed] };
  }, [banners, plugins.contributed.banners, plugins.contributed.slots, consoleOwn, rt, bannerPrefs]);
  if (isBannerStrip) return <SlotsProvider slots={slots}><BannerStrip /></SlotsProvider>;
  // GizmoX interface tabs (interfaceTabs.tsx): the tab row goes in app.frame.head, the shell under the open tab's interface.
  const withTabs = { ...slots, 'app.frame.head': [{ id: 'console.interface-tabs', order: -100, render: () => <InterfaceTabBar /> }, ...(slots['app.frame.head'] ?? [])] };
  return (
    <div {...drop} style={{ display: 'contents' }}>
      <SlotsProvider slots={withTabs}>
      <InterfaceTabs>
      <AppShell
        views={allViews}
        dialogs={{ ...plugins.contributed.dialogs, ...dialogs }}
        tabs={{ ...plugins.contributed.tabs, ...consoleTabs, 'plan-feature': (t) => <PlanFeatureTab id={t.payload || ''} /> }}
      />
      </InterfaceTabs>
      </SlotsProvider>
    </div>
  );
}

export function App() {
  return <ConsoleStoreProvider><Shell /></ConsoleStoreProvider>;
}

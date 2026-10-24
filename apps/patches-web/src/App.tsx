import { useEffect, useMemo, useState } from 'react';
import { AppShell, SlotsProvider, installLibraries, useRuntime, type ViewMap } from './axf/react';
import { library as settingsLibrary } from './axf/libs/settings';
import { dialogs } from './dialogs';
import { api, type Me } from './api';
import { AppTab, patchesLibrary, useAppMessages, useTabs } from './patchesLibrary';
import { DEFAULT_TABS, tabIcon, tabKey, tabLabel, tabViewId, type TabEntry } from './patches';

/** The access policy a signed-in hub account is bound to (framework starter uac-policy/hub-accounts). */
export const POLICY = 'hub-accounts';

/**
 * Patches' views: one per tab (frames, kept alive: switching tabs never reloads an app) and Patches' own Settings (only
 * Patches' settings; every app in a tab keeps its own settings interface, Brett Oct 24 2026). The tabs are the tab group (Settings → Patches → Tabs: apps and tabable
 * plugins, kept on Patches' server); every app keeps a view even when it isn't a tab, so links to it still work.
 */
const settingsView = { title: 'Settings', icon: 'settings', keywords: ['patches', 'preferences', 'tabs'], render: () => settingsLibrary.views?.settings?.render?.() ?? null };
function tabViews(tabs: readonly TabEntry[]): ViewMap {
  const entries: TabEntry[] = [...tabs, ...DEFAULT_TABS.filter((d) => !tabs.some((e) => tabKey(e) === tabKey(d)))];
  return { ...Object.fromEntries(entries.map((e) => [tabViewId(e), { title: tabLabel(e), icon: tabIcon(e), render: () => <AppTab entry={e} /> }])), settings: settingsView };
}

/** lib-settings (Patches' own settings) + Patches itself (installed last: its hooks win). */
const libraries = [settingsLibrary, patchesLibrary];

export function App() {
  const rt = useRuntime();
  const contributed = useMemo(() => installLibraries(rt, libraries), [rt]);
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { void api<Me>('/me').then((r) => setMe(r.data)); }, []);
  // Behind the wall the hub account decides the role (admin | themes | user); without it nothing is bound.
  useEffect(() => {
    if (me?.wall && me.user && me.role) rt.bindPrincipal({ id: me.user.name, label: me.user.name, policy: POLICY, role: me.role, attributes: { via: me.user.via } });
    else rt.unbindPrincipal();
  }, [rt, me]);
  useAppMessages();
  const { tabs } = useTabs();
  const views = useMemo(() => tabViews(tabs), [tabs]);
  const keep = useMemo(() => [...Object.keys(views)], [views]);
  // Page order: Patches' banner, the app tabs (app.frame.head), the menu bar, then the banner strip (the Console's plugin
  // banners, app.frame.top) and the app in the tab.
  return (
    <SlotsProvider slots={contributed.slots}>
      <AppShell views={{ ...contributed.views, ...views }} dialogs={{ ...contributed.dialogs, ...dialogs }} tabs={contributed.tabs} keep={keep} />
    </SlotsProvider>
  );
}

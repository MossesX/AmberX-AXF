import { useEffect, useMemo, useState } from 'react';
import { AppShell, SlotsProvider, installLibraries, useRuntime } from './axf/react';
import { library as settingsLibrary } from './axf/libs/settings';
import { dialogs } from './dialogs';
import { api, type Me } from './api';
import { library as appsLibrary } from './axf/libs/apps';
import { patchesLibrary, useAppMessages, useTabs } from './patchesLibrary';
import { tabViews } from './views';

/** The access policy a signed-in hub account is bound to (framework starter uac-policy/hub-accounts). */
export const POLICY = 'hub-accounts';

/** lib-settings (its view is Patches' tab of the combined settings), lib-apps (the framework's app directory) + Patches itself (installed last: its hooks win). */
const libraries = [settingsLibrary, appsLibrary, patchesLibrary];

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

import { useEffect, useMemo, useState } from 'react';
import { AppShell, SlotsProvider, installLibraries, useAxfState, useRuntime } from './axf/react';
import { library as settingsLibrary } from './axf/libs/settings';
import { dialogs } from './dialogs';
import { api, type Me } from './api';
import { currentTabs, patchesLibrary, useAppMessages, useSettingsRev } from './patchesLibrary';
import { viewsFor } from './views';
import { library as appsLibrary } from './axf/libs/apps';

/** The access policy a signed-in hub account is bound to (framework starter uac-policy/hub-accounts). */
export const POLICY = 'hub-accounts';

/** lib-settings (its view is Patches' tab of the combined settings) + Patches itself (installed last: its hooks win). */
const libraries = [settingsLibrary, appsLibrary, patchesLibrary];

export function App() {
  const rt = useRuntime();
  const contributed = useMemo(() => installLibraries(rt, libraries), [rt]);
  useAxfState();
  useSettingsRev();
  const tabs = currentTabs(rt);
  const ids = tabs.map((t) => t.id).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const views = useMemo(() => viewsFor(tabs), [ids]);
  const keep = useMemo(() => [...tabs.map((t) => t.id), 'settings'], [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { void api<Me>('/me').then((r) => setMe(r.data)); }, []);
  // Behind the wall the hub account decides the role (admin | themes | user); without it nothing is bound.
  useEffect(() => {
    if (me?.wall && me.user && me.role) rt.bindPrincipal({ id: me.user.name, label: me.user.name, policy: POLICY, role: me.role, attributes: { via: me.user.via } });
    else rt.unbindPrincipal();
  }, [rt, me]);
  useAppMessages();
  // Page order: Patches' banner, the app tabs (app.frame.head), the menu bar, then the banner strip (the Console's plugin
  // banners, app.frame.top) and the app in the tab.
  return (
    <SlotsProvider slots={contributed.slots}>
      <AppShell views={{ ...contributed.views, ...views }} dialogs={{ ...contributed.dialogs, ...dialogs }} tabs={contributed.tabs} keep={keep} />
    </SlotsProvider>
  );
}

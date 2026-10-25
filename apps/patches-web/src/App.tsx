import { useEffect, useMemo, useState } from 'react';
import { AppShell, SlotsProvider, installLibraries, useAxfState, useRuntime } from './axf/react';
import { library as settingsLibrary } from './axf/libs/settings';
import { hubStatusLibrary } from './axf/libs/hubstatus';
import { dialogs } from './dialogs';
import { api, type Me } from './api';
import { patchesLibrary, useAppMessages, useSuiteSync, useTabs } from './patchesLibrary';
import { tabViews } from './views/tabs';
import { WARM_KEY } from './patches';

/** The access policy a signed-in hub account is bound to (framework starter uac-policy/hub-accounts). */
export const POLICY = 'hub-accounts';

/** lib-settings (Patches' own settings), the axHub badge (red unless the look comes live from the hub) + Patches itself (installed last: its hooks win). */
const libraries = [settingsLibrary, hubStatusLibrary, patchesLibrary];

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
  useSuiteSync();
  const { tabs } = useTabs();
  const views = useMemo(() => tabViews(tabs), [tabs]);
  const keep = useMemo(() => [...Object.keys(views)], [views]);
  // Every app tab loads in the background once Patches has drawn (plugin tabs wait until they're opened), unless switched off.
  useAxfState();
  const warmOn = rt.settings.get(WARM_KEY) !== false;
  const warm = useMemo(() => (warmOn ? keep.filter((id) => !id.startsWith('tab.')) : []), [keep, warmOn]);
  // Page order: Patches' banner, the app tabs (app.frame.head), the menu bar, then the banner strip (the Console's plugin
  // banners, app.frame.top) and the app in the tab.
  return (
    <SlotsProvider slots={contributed.slots}>
      <AppShell views={{ ...contributed.views, ...views }} dialogs={{ ...contributed.dialogs, ...dialogs }} tabs={contributed.tabs} keep={keep} warm={warm} />
    </SlotsProvider>
  );
}

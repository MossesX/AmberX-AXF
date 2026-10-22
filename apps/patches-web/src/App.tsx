import { useEffect, useMemo, useState } from 'react';
import { AppShell, SlotsProvider, installLibraries, useRuntime, type ViewMap } from './axf/react';
import { library as settingsLibrary } from './axf/libs/settings';
import { dialogs } from './dialogs';
import { api, type Me } from './api';
import { AppTab, CombinedSettings, patchesLibrary, useAppMessages } from './patchesLibrary';
import { TABS } from './patches';

/** The access policy a signed-in hub account is bound to (framework starter uac-policy/hub-accounts). */
export const POLICY = 'hub-accounts';

/**
 * Patches' views: one per app (frames, kept alive: switching tabs never reloads an app) and the combined Settings
 * (Patches · Console · Pilot · axHub). The nav-menu asset `patches-tabs` shows the three app tabs.
 */
const views: ViewMap = {
  ...Object.fromEntries(TABS.map((t) => [t.id, { title: t.label, icon: t.icon, render: () => <AppTab id={t.id} /> }])),
  settings: { title: 'Settings', icon: 'settings', keywords: ['patches', 'console', 'pilot', 'axhub', 'preferences'], render: () => <CombinedSettings /> },
};
const KEEP = [...TABS.map((t) => t.id), 'settings'];

/** lib-settings (its view is Patches' tab of the combined settings) + Patches itself (installed last: its hooks win). */
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
  // Page order: Patches' banner, the app tabs (app.frame.head), the menu bar, then the banner strip (the Console's plugin
  // banners, app.frame.top) and the app in the tab.
  return (
    <SlotsProvider slots={contributed.slots}>
      <AppShell views={{ ...contributed.views, ...views }} dialogs={{ ...contributed.dialogs, ...dialogs }} tabs={contributed.tabs} keep={KEEP} />
    </SlotsProvider>
  );
}

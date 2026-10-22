import { useEffect, useMemo, useState } from 'react';
import { AccountView, AppShell, AssetStudio, installLibraries, useRuntime, type ViewMap } from './axf/react';
import { library as settingsLibrary } from './axf/libs/settings';
import { dialogs } from './dialogs';
import { api, type Me } from './api';
import { Home } from './views/Home';
import { Components } from './views/Components';

/** The access policy a signed-in hub account is bound to (framework starter uac-policy/hub-accounts). */
export const POLICY = 'hub-accounts';

/** Views the shell can show. Navigation-menu assets reference these ids. */
function viewsFor(me: Me | null, reload: () => void): ViewMap {
  return {
    home: { title: 'Home', icon: 'home', render: () => <Home me={me} reload={reload} /> },
    components: { title: 'Components', icon: 'grid', render: () => <Components /> },
    assets: { title: 'Assets', icon: 'layers', render: () => <AssetStudio /> },
    account: { title: 'Account', icon: 'shield', render: () => <AccountView /> },
  };
}

/** Every app built by the build engine ships the settings interface (lib-settings). Add more libraries here. */
const libraries = [settingsLibrary];

export function App() {
  const rt = useRuntime();
  const contributed = useMemo(() => installLibraries(rt, libraries), [rt]);
  const [me, setMe] = useState<Me | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    void api<Me>('/me').then((r) => setMe(r.data));
  }, [tick]);
  // Behind the wall the hub account decides the role (admin | themes | user); without it nothing is bound.
  useEffect(() => {
    if (me?.wall && me.user && me.role) rt.bindPrincipal({ id: me.user.name, label: me.user.name, policy: POLICY, role: me.role, attributes: { via: me.user.via } });
    else rt.unbindPrincipal();
  }, [rt, me]);
  const views = useMemo(() => viewsFor(me, () => setTick((t) => t + 1)), [me]);
  return <AppShell views={{ ...contributed.views, ...views }} dialogs={{ ...contributed.dialogs, ...dialogs }} tabs={contributed.tabs} />;
}

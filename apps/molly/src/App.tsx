import { useMemo } from 'react';
import { AccountView, AppShell, installLibraries, useRuntime, type ViewMap } from './axf/react';
import { library as settingsLibrary } from './axf/libs/settings';
import { dialogs } from './dialogs';
import { Home } from './views/Home';
import { AppSlot, FrameDeck } from './molly/FrameDeck';
import { MOLLY_APPS } from './molly/apps';

/**
 * Molly: one interface for AmberX, axHub and the Dev Console. Each app is a view whose body is its own live address in a
 * kept-alive frame (molly/FrameDeck.tsx); the apps themselves are untouched and keep running on their own.
 */
const views: ViewMap = {
  home: { title: 'Molly', icon: 'home', render: () => <Home /> },
  ...Object.fromEntries(MOLLY_APPS.map((a) => [a.id, { title: a.label, icon: a.icon, render: () => <AppSlot id={a.id} /> }])),
  account: { title: 'Account', icon: 'shield', render: () => <AccountView /> },
};

/** Every app ships the settings interface (lib-settings); plugins add sub-tabs under Settings → Plugins. */
const libraries = [settingsLibrary];

export function App() {
  const rt = useRuntime();
  const contributed = useMemo(() => installLibraries(rt, libraries), [rt]);
  return (
    <>
      <AppShell views={{ ...contributed.views, ...views }} dialogs={{ ...contributed.dialogs, ...dialogs }} tabs={contributed.tabs} />
      <FrameDeck />
    </>
  );
}

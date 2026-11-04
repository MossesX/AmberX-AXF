import { useMemo, useSyncExternalStore } from 'react';
import { AccountView, AppShell, installLibraries, useRuntime, type ViewMap } from './axf/react';
import type { AxfWebLibrary } from './axf/react/library';
import { library as settingsLibrary } from './axf/libs/settings';
import { toolbarsLibrary } from './axf/libs/toolbars';
import { dialogs } from './dialogs';
import { Home } from './views/Home';
import { AppSlot, FrameDeck } from './molly/FrameDeck';
import { MOLLY_APPS } from './molly/apps';
import { mollyHooks, mollyHooksRev, onMollyHooks } from './molly/host';

/**
 * Molly: one interface for AmberX, axHub and the Dev Console. Each app is a view whose body is its own live address in a
 * kept-alive frame (molly/FrameDeck.tsx); the apps themselves are untouched and keep running on their own. Plugins
 * (plugins/<folder>/web/index.tsx, found by folder, never named here) may change how the apps are shown through
 * molly/host.ts; without them Molly frames each app plainly.
 */
const appView = (id: string) => {
  const main = mollyHooks().main;
  return main ? main(id) : <AppSlot id={id} />;
};
const views: ViewMap = {
  home: { title: 'Molly', icon: 'home', render: () => <Home /> },
  ...Object.fromEntries(MOLLY_APPS.map((a) => [a.id, { title: a.label, icon: a.icon, render: () => appView(a.id) }])),
  account: { title: 'Account', icon: 'shield', render: () => <AccountView /> },
};

/** Molly's plugins: every plugins/<folder>/web/index.tsx exporting `plugin` (deleting a folder removes it). */
const pluginModules = import.meta.glob<{ plugin?: AxfWebLibrary }>('../plugins/*/web/index.tsx', { eager: true });
const plugins = Object.values(pluginModules).map((m) => m.plugin).filter((p): p is AxfWebLibrary => !!p);

/** Every app ships the settings interface (lib-settings); plugins add sub-tabs under Settings → Plugins. */
const libraries = [settingsLibrary, toolbarsLibrary, ...plugins];

export function App() {
  const rt = useRuntime();
  const contributed = useMemo(() => installLibraries(rt, libraries), [rt]);
  useSyncExternalStore(onMollyHooks, mollyHooksRev, mollyHooksRev);
  const extra = mollyHooks().views;
  return (
    <>
      <AppShell views={{ ...contributed.views, ...extra, ...views }} dialogs={{ ...contributed.dialogs, ...dialogs }} tabs={contributed.tabs} />
      <FrameDeck />
    </>
  );
}

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AccountView, AppShell, installLibraries, SlotsProvider, useRuntime, type ViewMap } from './axf/react';
import type { AxfWebLibrary } from './axf/react/library';
import { library as settingsLibrary } from './axf/libs/settings';
import { toolbarsLibrary } from './axf/libs/toolbars';
import { dialogs } from './dialogs';
import { Home } from './views/Home';
import { MOLLY_APPS } from './molly/apps';
import { mollyHooks, mollyHooksRev, onMollyHooks } from './molly/host';
import { isNative, loadAllNative, NativeView, nativeViews, useNativeRev } from './molly/native';

/**
 * Molly: the one shell for AmberX, axHub, the Dev Console and every later app. Each app mounts natively
 * (molly/native.tsx, shell-surface@1): its screens render in Molly's page under Molly's one banner, menu, nav and
 * settings, and `<app>/<screen>` views come from its surface. No frames (Brett, Nov 8 2026). Plugins
 * (plugins/<folder>/web/index.tsx, found by folder, never named here) extend Molly through molly/host.ts.
 */
const appView = (id: string) => {
  const main = mollyHooks().main;
  if (main) return main(id);
  return <NativeView app={id} />;
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
  // native apps load at start: Molly's one menu needs their surfaces (molly/native.tsx)
  useEffect(() => loadAllNative(rt), [rt]);
  useNativeRev();
  const extra = Object.fromEntries(Object.entries(mollyHooks().views).filter(([id]) => !isNative(id.split('/')[0]!)));
  const native = nativeViews();
  return (
    <>
      {/* plugins' slot content (e.g. the Banners plugin's strip in app.frame.banners) */}
      <SlotsProvider slots={contributed.slots}>
        <AppShell views={{ ...contributed.views, ...extra, ...native, ...views }} dialogs={{ ...contributed.dialogs, ...dialogs }} tabs={contributed.tabs} />
      </SlotsProvider>
    </>
  );
}

import { useMemo, useSyncExternalStore } from 'react';
import { AccountView, AppShell, installLibraries, SlotsProvider, useRuntime, type ViewMap } from './axf/react';
import type { AxfWebLibrary } from './axf/react/library';
import { library as settingsLibrary } from './axf/libs/settings';
import { toolbarsLibrary } from './axf/libs/toolbars';
import { createControlSurfaceLibrary } from './axf/libs/control-surface';
import { dialogs } from './dialogs';
import { Home } from './views/Home';
import { AppSlot, FrameDeck } from './molly/FrameDeck';
import { MOLLY_APPS, mollyApp } from './molly/apps';
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

/**
 * The control surface (apps-control-surface, Nov 4 2026): Molly is on the API, MCP and CLI. Its apps are its screens
 * (`app_open {app: 'molly', screen: 'console'}` switches the frame), its plugins' actions (IDE mode, pane layout,
 * banners) run through `app_action`, and `app_where` says which app is on screen. The apps inside Molly's frames carry
 * their own surface (they report as `molly/<app>`), so nothing is relayed here.
 */
const controlSurface = createControlSurfaceLibrary({
  extraHere: (rt): Record<string, string> => { const a = mollyApp(rt.getState().view.split('/')[0]); return a ? { app: a.id, appLabel: a.label } : { app: 'home', appLabel: 'Molly' }; },
});
/** Every app ships the settings interface (lib-settings); plugins add sub-tabs under Settings → Plugins. */
const libraries = [settingsLibrary, toolbarsLibrary, controlSurface, ...plugins];

export function App() {
  const rt = useRuntime();
  const contributed = useMemo(() => installLibraries(rt, libraries), [rt]);
  useSyncExternalStore(onMollyHooks, mollyHooksRev, mollyHooksRev);
  const extra = mollyHooks().views;
  return (
    <>
      {/* plugins' slot content (e.g. the Banners plugin's strip in app.frame.banners) */}
      <SlotsProvider slots={contributed.slots}>
        <AppShell views={{ ...contributed.views, ...extra, ...views }} dialogs={{ ...contributed.dialogs, ...dialogs }} tabs={contributed.tabs} />
      </SlotsProvider>
      <FrameDeck />
    </>
  );
}

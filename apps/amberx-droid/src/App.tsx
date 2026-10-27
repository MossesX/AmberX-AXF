import { useMemo } from 'react';
import { AppShell, installLibraries, useRuntime, type ViewMap } from './axf/react';
import { library as settingsLibrary } from './axf/libs/settings';
import { hubSyncLibrary } from './axf/libs/hubsync';
import { dialogs } from './dialogs';
import { Approvals } from './views/Approvals';
import { useHubBannerCount } from './axf/libs/hub/react';
import { HUB } from './hub/useHub';
import { loadPlugins } from './plugins';

/**
 * AmberX is an empty shell for building and testing plugins (Oct 26 2026): banner, toolbar, nav menu, application menu,
 * a basic context menu, the settings interface and the look (theme, layout, style assets). The only page of its own is
 * Approvals (home, with its alerts); everything else comes from plugins in `src/plugins` (catalog kind `amberx`):
 * voice control and background monitoring ship with it, and any plugin dropped in there joins the menus by itself.
 */
const views: ViewMap = {
  home: { title: 'Approvals', icon: 'shield', keywords: ['approval', 'waiting', 'confirm'], render: () => <Approvals /> },
};

/**
 * Libraries this app ships. lib-settings gives it the settings interface (Appearance, Account & security, Connections,
 * Plugins, About). lib-hubsync keeps its settings on axHub (same on every device). The plugins come after them.
 */
const libraries = [settingsLibrary, hubSyncLibrary, ...loadPlugins().map((p) => p.library)];

export function App() {
  const rt = useRuntime();
  const contributed = useMemo(() => installLibraries(rt, libraries), [rt]);
  // Approvals waiting: counter `approvals.waiting` (toolbar + menu badges) and the counter widget on the banner.
  useHubBannerCount(HUB, { banner: { id: 'approvals', at: 'right', order: 29 }, origin: 'amberx-droid' });
  return <AppShell views={{ ...contributed.views, ...views }} dialogs={{ ...contributed.dialogs, ...dialogs }} tabs={contributed.tabs} />;
}

import { useEffect, useMemo, useRef } from 'react';
import { AppShell, installLibraries, useRuntime, type ViewMap } from './axf/react';
import { library as settingsLibrary } from './axf/libs/settings';
import { hubSyncLibrary } from './axf/libs/hubsync';
import { dialogs } from './dialogs';
import { Approvals } from './views/Approvals';
import { useHubBannerCount } from './axf/libs/hub/react';
import { HUB } from './hub/useHub';
import { loadPlugins } from './plugins';
import { secureScreenLibrary } from './securescreen';
import { VIEW_TAB_KIND, ViewPane, registerWindowActions } from './windows/ViewWindow';
import './windows/windows.css';

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
 * Plugins, About). lib-hubsync keeps its settings on axHub (same on every device). The screen-capture setting (no
 * FLAG_SECURE unless opted in, `securescreen.ts`) is AmberX's own. The plugins come after them.
 */
const libraries = [settingsLibrary, hubSyncLibrary, secureScreenLibrary, ...loadPlugins().map((p) => p.library)];

export function App() {
  const rt = useRuntime();
  const contributed = useMemo(() => installLibraries(rt, libraries), [rt]);
  // Approvals waiting: counter `approvals.waiting` (toolbar + menu badges) and the counter widget on the banner.
  useHubBannerCount(HUB, { banner: { id: 'approvals', at: 'right', order: 29 }, origin: 'amberx-droid' });
  const allViews = useMemo(() => ({ ...contributed.views, ...views }), [contributed]);
  // floating windows (window engine: frameless / resize / snap / maximize): any page can open in one
  const latest = useRef(allViews);
  latest.current = allViews;
  useEffect(() => registerWindowActions(rt, () => latest.current), [rt]);
  const tabs = useMemo(() => ({ ...contributed.tabs, [VIEW_TAB_KIND]: (t: { payload?: string }) => <ViewPane view={t.payload ?? ''} views={latest.current} /> }), [contributed]);
  return <AppShell views={allViews} dialogs={{ ...contributed.dialogs, ...dialogs }} tabs={tabs} />;
}

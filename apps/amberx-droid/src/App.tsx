import { useEffect, useMemo, useRef } from 'react';
import { AppShell, installLibraries, useRuntime, type ViewMap } from './axf/react';
import { library as settingsLibrary } from './axf/libs/settings';
import { toolbarsLibrary } from './axf/libs/toolbars';
import { hubSyncLibrary } from './axf/libs/hubsync';
import { createControlSurfaceLibrary } from './axf/libs/control-surface';
import { pluginFetch } from './console/plugins';
import { dialogs } from './dialogs';
import { Approvals } from './views/Approvals';
import { useHubBannerCount } from './axf/libs/hub/react';
import { HUB } from './hub/useHub';
import { loadPlugins } from './plugins';
import { secureScreenLibrary } from './securescreen';
import { soundLibrary } from './sound';
import { micLibrary } from './mic';
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
 * FLAG_SECURE unless opted in, `securescreen.ts`) and Sound and microphone (Quiet, one owner per device, `sound.tsx`)
 * are AmberX's own, and so is Mic off (`mic.tsx`: one tap lets go of every microphone). The plugins come after them.
 */
/**
 * The control surface (apps-control-surface, Nov 4 2026): AmberX is on the API, MCP and CLI. Amber says
 * `app_show {app: 'amberx', target: 'to-dos'}` and this app (phone or browser) opens it. The client reaches the broker on
 * the console server through AmberX's own server (its console plugin proxy, `/api/console/plugins/<folder>/…`, forwarded
 * with the console token; hub admins only), so the page holds no token and the Android shell needs nothing new.
 */
const controlSurface = createControlSurfaceLibrary({ transport: { fetch: (path, init) => pluginFetch('console-commands', path, init) } });
const libraries = [settingsLibrary, toolbarsLibrary, hubSyncLibrary, controlSurface, secureScreenLibrary, soundLibrary, micLibrary, ...loadPlugins().map((p) => p.library)];

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

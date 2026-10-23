import type { ViewMap } from '../axf/react';
import { AppTab, CombinedSettings } from '../patchesLibrary';
import { DEFAULT_TABS, tabIcon, tabKey, tabLabel, tabViewId, type TabEntry } from '../patches';

/**
 * Patches' views: one per tab (frames, kept alive: switching tabs never reloads an app) and the combined Settings
 * (Patches · Banners · one per app with a settings page). The tabs are the tab group (Settings → Patches → Tabs: any app in the
 * framework's app directory (lib-apps) and tabable plugins, kept on Patches' server); every app keeps a view even when it isn't a tab, so links to it still work.
 */
const settingsView = { title: 'Settings', icon: 'settings', keywords: ['patches', 'console', 'pilot', 'axhub', 'preferences', 'tabs'], render: () => <CombinedSettings /> };
export function tabViews(tabs: readonly TabEntry[]): ViewMap {
  const entries: TabEntry[] = [...tabs, ...DEFAULT_TABS.filter((d) => !tabs.some((e) => tabKey(e) === tabKey(d)))];
  return { ...Object.fromEntries(entries.map((e) => [tabViewId(e), { title: tabLabel(e), icon: tabIcon(e), render: () => <AppTab entry={e} /> }])), settings: settingsView };
}


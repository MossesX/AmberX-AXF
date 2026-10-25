import type { ViewMap } from '../axf/react';
import { library as settingsLibrary } from '../axf/libs/settings';
import { AppTab } from '../patchesLibrary';
import { DEFAULT_TABS, tabIcon, tabKey, tabLabel, tabViewId, type TabEntry } from '../patches';

/**
 * Patches' views: one per tab (frames, kept alive: switching tabs never reloads an app) and Patches' own Settings (only
 * Patches' settings; every app in a tab keeps its own settings interface, Brett Oct 24 2026). The tabs are the tab group
 * (Settings → Patches → Tabs: apps and tabable plugins, kept on Patches' server); every app keeps a view even when it
 * isn't a tab, so links to it still work. Suite mode (patches.ts) makes the page work as one app.
 */
const settingsView = { title: 'Settings', icon: 'settings', keywords: ['patches', 'preferences', 'tabs'], render: () => settingsLibrary.views?.settings?.render?.() ?? null };
export function tabViews(tabs: readonly TabEntry[]): ViewMap {
  const entries: TabEntry[] = [...tabs, ...DEFAULT_TABS.filter((d) => !tabs.some((e) => tabKey(e) === tabKey(d)))];
  return { ...Object.fromEntries(entries.map((e) => [tabViewId(e), { title: tabLabel(e), icon: tabIcon(e), render: () => <AppTab entry={e} /> }])), settings: settingsView };
}


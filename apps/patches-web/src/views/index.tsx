import type { ViewMap } from '../axf/react';
import { AppTab, CombinedSettings } from '../patchesLibrary';
import type { PatchTab } from '../patches';

/**
 * Patches' views: one per app in the tabs (frames, kept alive: switching tabs never reloads an app) and the combined
 * Settings. Which apps are tabs is a setting (Settings → Patches → Tabs, or the + at the end of the tab row): any app in
 * the framework's directory (lib-apps), or one added by hand.
 */
const settingsView = { title: 'Settings', icon: 'settings', keywords: ['patches', 'console', 'pilot', 'axhub', 'tabs', 'apps', 'preferences'], render: () => <CombinedSettings /> };
export function viewsFor(tabs: PatchTab[]): ViewMap {
  return { ...Object.fromEntries(tabs.map((t) => [t.id, { title: t.label, icon: t.icon, keywords: [t.name, t.tab], render: () => <AppTab id={t.id} /> }])), settings: settingsView };
}


import { useMemo } from 'react';
import { AccountView, AppShell, AssetStudio, installLibraries, useRuntime, type ViewMap } from './axf/react';
import { library as settingsLibrary } from './axf/libs/settings';
import { hubSyncLibrary } from './axf/libs/hubsync';
import { dialogs } from './dialogs';
import { Approvals } from './views/Approvals';
import { Apps } from './views/Apps';
import { HubView } from './views/HubView';
import { PLANNED, Planned } from './views/Planned';
import { useHubBannerCount } from './axf/libs/hub/react';
import { HUB } from './hub/useHub';

/**
 * Views the shell can show; the nav-menu asset `axhub-web` references these ids. Approvals is home,
 * because that is what this app is for: seeing what axHub is waiting on and getting to it in one tap.
 * The hub areas that aren't built yet are real routes with a note each (see `views/Planned.tsx`).
 */
const views: ViewMap = {
  home: { title: 'Approvals', icon: 'shield', keywords: ['approval', 'waiting', 'confirm'], render: () => <Approvals /> },
  hub: { title: 'Hub', icon: 'external', keywords: ['axhub', 'session', 'sign in'], render: () => <HubView /> },
  apps: { title: 'Apps', icon: 'download', keywords: ['apk', 'download', 'catalog'], render: () => <Apps /> },
  ...Object.fromEntries(
    PLANNED.map((area) => [area.id, { title: area.title, icon: area.icon, keywords: [area.id], render: () => <Planned area={area} /> }]),
  ),
  assets: { title: 'Assets', icon: 'layers', render: () => <AssetStudio /> },
  account: { title: 'Account', icon: 'shield', render: () => <AccountView /> },
};

/**
 * Libraries this app ships. lib-settings gives it the settings interface (Appearance — including
 * "Look from axHub" for a developer app —, Account & security, Connections, Plugins, About). lib-hubsync keeps its
 * settings on axHub (same on every device) and adds Settings → Plugins → axHub sync; the look stays the developer one.
 */
const libraries = [settingsLibrary, hubSyncLibrary];

export function App() {
  const rt = useRuntime();
  const contributed = useMemo(() => installLibraries(rt, libraries), [rt]);
  // Approvals waiting: counter `approvals.waiting` (toolbar + menu badges) and the counter widget on the banner, next to
  // the day/night switch and the clock, the way the console shows its alerts bell.
  useHubBannerCount(HUB, { banner: { id: 'approvals', at: 'right', order: 29 }, origin: 'axhub-web' });
  return <AppShell views={{ ...contributed.views, ...views }} dialogs={{ ...contributed.dialogs, ...dialogs }} tabs={contributed.tabs} />;
}

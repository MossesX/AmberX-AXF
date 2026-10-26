import { useMemo } from 'react';
import { AppShell, AssetStudio, installLibraries, useRuntime, type ViewMap } from './axf/react';
import { library as settingsLibrary } from './axf/libs/settings';
import { hubSyncLibrary } from './axf/libs/hubsync';
import { dialogs } from './dialogs';
import { Approvals } from './views/Approvals';
import { ApprovalDetail } from './views/ApprovalDetail';
import { ApprovalLog } from './views/ApprovalLog';
import { HandoffList, HandoffRun } from './views/Handoff';
import { HubAccount } from './views/HubAccount';
import { Users } from './views/Users';
import { Apps } from './views/Apps';
import { HubView } from './views/HubView';
import { PLANNED, Planned } from './views/Planned';
import { useHubBannerCount } from './axf/libs/hub/react';
import { HUB } from './hub/useHub';
import { loadPlugins } from './plugins';

/**
 * Views the shell can show; the nav-menu asset `axhub-web` references these ids. Approvals is home,
 * because that is what this app is for: seeing what axHub is waiting on and getting to it in one tap.
 * Since axHub decision #96 these are the hub's own pages too: one request, the log, users, your account, handoff
 * results (the hub redirects its old addresses to `#/<route>`, see `hub/route.ts`). The hub areas that aren't built
 * yet are real routes with a note each (see `views/Planned.tsx`).
 */
const views: ViewMap = {
  home: { title: 'Approvals', icon: 'shield', keywords: ['approval', 'waiting', 'confirm'], render: () => <Approvals /> },
  hub: { title: 'Hub', icon: 'external', keywords: ['axhub', 'session', 'sign in'], render: () => <HubView /> },
  approval: { title: 'Request', icon: 'shield', render: () => <ApprovalDetail /> },
  'approvals-log': { title: 'Approvals log', icon: 'list', keywords: ['log', 'history', 'auto-approve'], render: () => <ApprovalLog /> },
  apps: { title: 'Apps', icon: 'download', keywords: ['apk', 'download', 'catalog'], render: () => <Apps /> },
  users: { title: 'Users', icon: 'user', keywords: ['accounts', 'permissions', 'roles'], render: () => <Users /> },
  handoff: { title: 'Handoff', icon: 'package', keywords: ['claude', 'handoff', 'new account'], render: () => <HandoffList /> },
  'handoff-run': { title: 'Handoff run', icon: 'package', render: () => <HandoffRun /> },
  ...Object.fromEntries(
    PLANNED.map((area) => [area.id, { title: area.title, icon: area.icon, keywords: [area.id], render: () => <Planned area={area} /> }]),
  ),
  assets: { title: 'Assets', icon: 'layers', render: () => <AssetStudio /> },
  account: { title: 'Account', icon: 'key', keywords: ['password', 'sign out', 'browsers'], render: () => <HubAccount /> },
};

/**
 * Libraries this app ships. lib-settings gives it the settings interface (Appearance — including
 * "Look from axHub" for a developer app —, Account & security, Connections, Plugins, About). lib-hubsync keeps its
 * settings on axHub (same on every device) and adds Settings → Plugins → axHub sync; the look stays the developer one.
 * Installed axHub web plugins (src/plugins, catalog kind `axhub`) come after them.
 */
const libraries = [settingsLibrary, hubSyncLibrary, ...loadPlugins().map((p) => p.library)];

export function App() {
  const rt = useRuntime();
  const contributed = useMemo(() => installLibraries(rt, libraries), [rt]);
  // Approvals waiting: counter `approvals.waiting` (toolbar + menu badges) and the counter widget on the banner, next to
  // the day/night switch and the clock, the way the console shows its alerts bell.
  useHubBannerCount(HUB, { banner: { id: 'approvals', at: 'right', order: 29 }, origin: 'axhub-web' });
  return <AppShell views={{ ...contributed.views, ...views }} dialogs={{ ...contributed.dialogs, ...dialogs }} tabs={contributed.tabs} />;
}

/**
 * Application-menu entries of the Session sync plugin (pure data: the console's reachability check reads this file).
 * Builds → Sessions (the panel) and Sync session; Plugins → Session sync.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'session-sync.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 46, items: [
    { id: 'session-sync.open', label: 'Sessions', icon: 'users', action: 'nav:session-sync', badge: 'sessions.helpers' },
    { id: 'session-sync.sync', label: 'Sync session (write the sync file)', icon: 'refresh', action: 'session-sync.sync' },
    { id: 'session-sync.join', label: "What's going on? (join dialog)", icon: 'log-in', action: 'dialog:session-sync.join' },
  ] },
  { id: 'session-sync.plugins', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'session-sync', label: 'Session sync', icon: 'users', action: 'nav:session-sync' }] },
];

/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'live-sessions.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 14, items: [
    { id: 'live-sessions', label: 'Live sessions (every Claude session)', icon: 'eye', action: 'nav:live-sessions' },
    { id: 'session-recordings', label: 'Session recordings', icon: 'play', action: 'nav:session-recordings' },
  ] },
  { id: 'live-sessions.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 51, items: [{ id: 'live-sessions-settings', label: 'Live sessions settings', icon: 'eye', action: 'settings.open:live-sessions' }] },
];

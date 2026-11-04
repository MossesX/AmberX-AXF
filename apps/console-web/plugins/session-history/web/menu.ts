/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'session-history.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 10, items: [{ id: 'session-history', label: 'Session browser', icon: 'terminal', action: 'nav:session-history' }] },
  { id: 'session-history.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'session-history-settings', label: 'Session browser settings', icon: 'terminal', action: 'settings.open:session-history' }] },
];

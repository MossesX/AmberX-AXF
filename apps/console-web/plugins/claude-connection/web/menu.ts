/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'claude-connection.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 51, items: [{ id: 'claude-connection', label: 'Claude connection', icon: 'claude', action: 'settings.open:claude-connection' }] },
];

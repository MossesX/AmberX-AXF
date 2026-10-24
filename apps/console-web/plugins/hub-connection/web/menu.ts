/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'hub-connection.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 52, items: [{ id: 'hub-connection', label: 'axHub connection', icon: 'hub', action: 'settings.open:hub-connection' }] },
];

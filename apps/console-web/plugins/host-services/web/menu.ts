/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'host-services.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 52, items: [{ id: 'host-services', label: 'Host services', icon: 'server', action: 'settings.open:host-services' }] },
  { id: 'host-services.console', menu: 'console', menuLabel: 'Console', menuOrder: 10, order: 62, items: [{ id: 'host-services-console', label: 'Host services (what runs on the VPS)', icon: 'server', action: 'settings.open:host-services' }] },
];

/**
 * Application-menu entries (pure data, read by scripts/menu-reach.mts too): Phone Connect's settings under Plugins.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'phone-connect.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'phone-connect-settings', label: 'Phone Connect', icon: 'smartphone', action: 'settings.open:phone-connect' }] },
];

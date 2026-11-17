/**
 * Application-menu entries for the Data store (pure data: read by scripts/menu-reach.mts too).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'data-store.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 55, items: [{ id: 'data-store-settings', label: 'Data store', icon: 'layers', action: 'settings.open:data-store' }] },
];

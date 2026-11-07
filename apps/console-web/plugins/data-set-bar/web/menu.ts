/**
 * Application-menu entries (pure data: scripts/menu-reach.mts reads this file too).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'data-set-bar.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 52, items: [{ id: 'data-set-bar', label: 'Data set bar', icon: 'list', action: 'settings.open:data-set-bar' }] },
];

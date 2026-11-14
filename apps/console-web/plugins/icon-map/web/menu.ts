/**
 * Application-menu entries (pure data: the console's reachability check, scripts/menu-reach.mts, reads this file).
 * Icon map sits in the View menu beside the other appearance tools, so it is reachable while the toolbar and side
 * navigation are hidden.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'icon-map.menu', menu: 'view', menuLabel: 'View', menuOrder: 50, order: 62, items: [{ id: 'icon-map', label: 'Icon map', icon: 'grid', action: 'nav:icon-map' }] },
];

/**
 * Application-menu entries this plugin adds (pure data: no React or CSS imports, because the console's reachability
 * check, scripts/menu-reach.mts, reads this file too).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'smart-menus.menu', menu: 'view', menuLabel: 'View', menuOrder: 60, order: 80, items: [{ id: 'smart-menus', label: 'Menus', icon: 'menu', action: 'nav:smart-menus' }] },
];

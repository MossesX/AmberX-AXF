/**
 * Application-menu entries of the Fix log plugin (pure data: no React or CSS imports; scripts/menu-reach.mts reads it).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'fix-log.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'fix-log', label: 'Fix log', icon: 'hammer', action: 'nav:fix-log' }] },
  { id: 'fix-log.console', menu: 'console', menuLabel: 'Console', menuOrder: 10, order: 62, items: [{ id: 'fix-log-console', label: 'Fix log (what Claude is fixing)', icon: 'hammer', action: 'nav:fix-log' }] },
];

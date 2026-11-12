/**
 * Application-menu entries of the Auto-fixes plugin (pure data: scripts/menu-reach.mts reads this file too).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'auto-fixes.menu', menu: 'console', menuLabel: 'Console', menuOrder: 10, order: 70, items: [{ id: 'auto-fixes', label: 'Auto-fixes', icon: 'hammer', action: 'nav:auto-fixes' }] },
];

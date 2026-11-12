/** Application-menu entries (pure data: scripts/menu-reach.mts reads this file too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'registry.menu', menu: 'console', menuLabel: 'Console', menuOrder: 10, order: 60, items: [{ id: 'registry', label: 'Registry (everything controllable)', icon: 'layers', action: 'nav:registry' }] },
];

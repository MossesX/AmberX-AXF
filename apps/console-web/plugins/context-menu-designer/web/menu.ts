/**
 * Application-menu entries (pure data: scripts/menu-reach.mts reads this file too).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'context-menu-designer.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'context-menu-designer', label: 'Context menu designer', icon: 'menu', action: 'nav:context-menu-designer' }] },
  { id: 'context-menu-designer.look', menu: 'view', menuLabel: 'View', menuOrder: 60, order: 80, items: [{ id: 'context-menu-designer.view', label: 'Design the context menu…', icon: 'menu', action: 'context-menu-designer.open' }] },
];

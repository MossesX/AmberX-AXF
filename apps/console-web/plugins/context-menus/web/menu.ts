/** Application-menu entries (pure data: scripts/menu-reach.mts reads this file too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'context-menus.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'context-menus', label: 'Context menus', icon: 'menu', action: 'nav:context-menus' }] },
  { id: 'context-menus.framework', menu: 'framework', menuLabel: 'Framework', menuOrder: 30, order: 62, items: [{ id: 'context-menus-generate', label: 'Generate context menus…', icon: 'sparkles', action: 'context-menus.open:generate' }] },
];

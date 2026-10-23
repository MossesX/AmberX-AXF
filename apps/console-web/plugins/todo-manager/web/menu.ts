/**
 * Application-menu entries for the Todo manager (pure data: scripts/menu-reach.mts reads this file too).
 * Plugins › Todo manager, and Console › Todos (it's a daily tool, so it sits next to Home and Search too).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'todo-manager.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'todo-manager', label: 'Todo manager', icon: 'list', action: 'nav:todo-manager' }] },
  { id: 'todo-manager.console', menu: 'console', menuLabel: 'Console', menuOrder: 10, order: 25, items: [{ id: 'todo-manager.open', label: 'Todos', icon: 'list', action: 'nav:todo-manager' }] },
];

/** Application-menu entries (pure data; read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'amberx-tasks.apps', menu: 'apps', menuLabel: 'Apps', menuOrder: 50, path: [{ id: 'amberx', label: 'AmberX', icon: 'smartphone' }], order: 12, items: [
    { id: 'amberx-tasks-page', label: 'To-dos', icon: 'check-square', action: 'nav:amberx-tasks' },
    { id: 'amberx-tasks-new', label: 'New to-do', icon: 'plus', action: 'amberx-tasks.focus:new' },
  ] },
  { id: 'amberx-tasks.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 60, items: [
    { id: 'amberx-tasks-open', label: 'AmberX to-dos', icon: 'check-square', action: 'nav:amberx-tasks' },
    { id: 'amberx-tasks-settings', label: 'AmberX to-dos settings', icon: 'check-square', action: 'settings.open:amberx-tasks' },
  ] },
];

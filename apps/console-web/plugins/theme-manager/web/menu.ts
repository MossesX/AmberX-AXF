/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'theme-manager.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'theme-manager', label: 'Theme manager', icon: 'palette', action: 'nav:theme-manager' }] },
  { id: 'theme-manager.look', menu: 'view', menuLabel: 'View', menuOrder: 60, path: ['look'], order: 30, items: [{ id: 'theme-manager', label: 'Theme manager…', icon: 'palette', action: 'nav:theme-manager' }] },
];

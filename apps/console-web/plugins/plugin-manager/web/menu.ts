/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'plugin-manager.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 10, items: [
    { id: 'plugin-manager', label: 'Plugin Manager', icon: 'package', action: 'nav:plugin-manager', order: 10 },
    { id: 'plugin-catalog', label: 'Install from the catalog…', icon: 'download', action: 'plugin-manager.install', order: 12 },
    { id: 'plugin-manager-window', label: 'Plugin Manager in a window', icon: 'monitor', action: 'plugin-manager.window', order: 13 },
  ] },
];

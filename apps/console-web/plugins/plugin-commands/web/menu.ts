/** Application-menu entries (pure data; read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'plugin-commands.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 55, items: [{ id: 'plugin-commands', label: 'Plugin commands', icon: 'terminal', action: 'nav:plugin-commands' }] },
];

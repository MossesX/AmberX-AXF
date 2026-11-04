/** Application-menu entries (pure data; read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'console-commands.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 56, items: [{ id: 'console-commands-settings', label: 'Console commands settings', icon: 'radio', action: 'settings.open:console-commands' }] },
];

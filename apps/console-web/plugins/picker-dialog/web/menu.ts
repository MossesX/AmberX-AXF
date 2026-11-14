/**
 * Application-menu entries (pure data: scripts/menu-reach.mts reads this file). The plugin has no page of its own;
 * the menu reaches its settings sub-tab.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'picker-dialog.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 55, items: [{ id: 'picker-dialog-settings', label: 'Picker dialog settings', icon: 'list', action: 'settings.open:picker-dialog' }] },
];

/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'nested-menus.view', menu: 'view', menuLabel: 'View', menuOrder: 60, order: 32, items: [
    { id: 'nested-menus.settings', label: 'Menu settings…', icon: 'settings', action: 'menus.settings' },
  ] },
  { id: 'nested-menus.plugins', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [
    { id: 'nested-menus', label: 'Nested menus', icon: 'menu', action: 'menus.settings' },
  ] },
];

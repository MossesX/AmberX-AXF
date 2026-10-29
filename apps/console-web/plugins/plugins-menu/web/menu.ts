/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

/** Live list: every plugin as a submenu (Interface, Settings, Documentation, About, Theme override, Disable). Same value as core.ts LADDER. */
export const LADDER = 'plugins-menu.ladder';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  // Plugins (created if the app menu has none) ▸ All plugins ▸ <plugin> ▸ Interface · Settings · Documentation · About · Theme override · Disable
  { id: 'plugins-menu.ladder', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 1, items: [
    { id: 'plugins-menu-ladder', label: 'All plugins', icon: 'package', provider: LADDER },
    { id: 'plugins-menu-ladder-sep', separator: true },
  ] },
  { id: 'plugins-menu.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 11, items: [
    { id: 'plugins-menu-install', label: 'Install plugins…', icon: 'download', action: 'plugins-menu.install' },
    { id: 'plugins-menu-settings', label: 'Plugin settings…', icon: 'settings', action: 'plugins-menu.settings' },
  ] },
];

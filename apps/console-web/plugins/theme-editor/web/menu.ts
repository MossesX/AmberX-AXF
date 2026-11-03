/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'theme-editor.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 51, items: [{ id: 'theme-editor', label: 'Theme editor', icon: 'edit', action: 'nav:theme-editor' }] },
  { id: 'theme-editor.look', menu: 'view', menuLabel: 'View', menuOrder: 60, path: ['look'], order: 31, items: [{ id: 'theme-editor', label: 'Theme editor…', icon: 'edit', action: 'nav:theme-editor' }] },
];

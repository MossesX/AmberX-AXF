/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'skin-editor.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 52, items: [{ id: 'skin-editor', label: 'Skin editor', icon: 'shield', action: 'nav:skin-editor' }] },
  { id: 'skin-editor.look', menu: 'view', menuLabel: 'View', menuOrder: 60, path: ['look'], order: 32, items: [{ id: 'skin-editor', label: 'Skin checker…', icon: 'shield', action: 'nav:skin-editor' }] },
];

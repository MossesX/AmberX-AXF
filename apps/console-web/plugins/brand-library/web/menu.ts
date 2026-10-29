/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'brand-library.look', menu: 'view', menuLabel: 'View', menuOrder: 60, path: ['look'], order: 34, items: [{ id: 'brand-library', label: 'Brand library…', icon: 'star', action: 'nav:brand-library' }] },
  { id: 'brand-library.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 12, items: [{ id: 'brand-library.settings', label: 'Brand library', icon: 'star', action: 'settings.open:brand-library' }] },
];

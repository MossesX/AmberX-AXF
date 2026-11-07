/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'icon-browser.look', menu: 'view', menuLabel: 'View', menuOrder: 60, path: ['look'], order: 36, items: [
    { id: 'icon-browser', label: 'Icon browser…', icon: 'grid', action: 'nav:icon-browser' },
    { id: 'icon-manager', label: 'Icon manager…', icon: 'layers', action: 'nav:icon-manager' },
  ] },
  { id: 'icon-browser.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 13, items: [{ id: 'icon-browser.settings', label: 'Icon browser', icon: 'grid', action: 'settings.open:icon-browser' }] },
];

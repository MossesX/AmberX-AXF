/**
 * Application-menu entries for the Automated Browser (pure data: read by scripts/menu-reach.mts too).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'auto-browser.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'auto-browser', label: 'Automated Browser', icon: 'monitor', action: 'nav:auto-browser' }] },
  { id: 'auto-browser.apps', menu: 'apps', menuLabel: 'Apps', menuOrder: 50, order: 60, items: [{ id: 'auto-browser-apps', label: 'Automated Browser', icon: 'monitor', action: 'nav:auto-browser' }] },
];

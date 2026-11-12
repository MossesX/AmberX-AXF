/** Application-menu entries for the web browser pane (pure data: scripts/menu-reach.mts reads this file too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'web-browser.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 55, items: [{ id: 'web-browser', label: 'Web browser', icon: 'monitor', action: 'nav:web-browser' }] },
];

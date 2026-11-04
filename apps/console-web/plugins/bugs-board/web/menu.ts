/**
 * Application-menu entries (pure data: scripts/menu-reach.mts reads this file too). The bugs board sits in Builds.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'bugs-board.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 47, items: [
    { id: 'bugs-board-page', label: 'Bugs', icon: 'alert', action: 'nav:bugs-board' },
    { id: 'bugs-board-settings', label: 'Bugs settings', icon: 'alert', action: 'settings.open:bugs-board' },
  ] },
];

/**
 * Application-menu entries of the Demonstration Designer (pure data: scripts/menu-reach.mts reads this file too).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'demonstration-designer.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'demonstration-designer', label: 'Demonstration Designer', icon: 'play', action: 'nav:demonstration-designer' }] },
  { id: 'demonstration-designer.help', menu: 'help', menuLabel: 'Help', menuOrder: 90, order: 25, items: [{ id: 'demonstration-designer.pitch', label: 'Pitch a demo…', icon: 'play', action: 'nav:demonstration-designer' }] },
];

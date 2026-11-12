/**
 * Application-menu entries for Notes (pure data: scripts/menu-reach.mts reads this file too).
 * Console › Notes (a daily tool, next to Home and Search) and Plugins › Notes.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'amberx-notes.console', menu: 'console', menuLabel: 'Console', menuOrder: 10, order: 25, items: [{ id: 'amberx-notes.open', label: 'Notes', icon: 'file', action: 'nav:notes' }] },
  { id: 'amberx-notes.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'amberx-notes', label: 'Notes', icon: 'file', action: 'nav:notes' }] },
];

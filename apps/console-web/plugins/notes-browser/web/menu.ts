/**
 * Application-menu entries for the Notes browser (pure data: read by scripts/menu-reach.mts too).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'notes-browser.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'notes', label: 'Notes', icon: 'file', action: 'nav:notes' }] },
  { id: 'notes-browser.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 80, items: [{ id: 'notes-builds', label: 'Notes', icon: 'file', action: 'nav:notes' }] },
];

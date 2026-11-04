/**
 * Application-menu entries for the Notes browser (pure data: read by scripts/menu-reach.mts too).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'notes-browser.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'notes', label: 'Notes', icon: 'file', action: 'nav:notes' }] },
  { id: 'notes-browser.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 80, items: [{ id: 'notes-builds', label: 'Notes', icon: 'file', action: 'nav:notes' }] },
  {
    id: 'notes-browser.view', menu: 'view', menuLabel: 'View', menuOrder: 60, path: [{ id: 'notes-view', label: 'Notes view', icon: 'file' }], order: 84, items: [
      { id: 'notes-view-classic', label: 'Classic', icon: 'file', action: 'notes-browser.view:classic', checked: 'counter:notes-browser.view:classic' },
      { id: 'notes-view-grid', label: 'Grid', icon: 'list', action: 'notes-browser.view:grid', checked: 'counter:notes-browser.view:grid' },
    ],
  },
];

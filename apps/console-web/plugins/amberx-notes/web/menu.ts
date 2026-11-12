/** Application-menu entries (pure data; read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'amberx-notes.apps', menu: 'apps', menuLabel: 'Apps', menuOrder: 50, path: [{ id: 'amberx', label: 'AmberX', icon: 'smartphone' }], order: 10, items: [
    { id: 'amberx-notes-page', label: 'Notes', icon: 'file-text', action: 'nav:amberx-notes' },
    { id: 'amberx-notes-new', label: 'New note', icon: 'plus', action: 'amberx-notes.new' },
  ] },
  { id: 'amberx-notes.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 59, items: [
    { id: 'amberx-notes-open', label: 'AmberX notes', icon: 'file-text', action: 'nav:amberx-notes' },
    { id: 'amberx-notes-settings', label: 'AmberX notes settings', icon: 'file-text', action: 'settings.open:amberx-notes' },
  ] },
];

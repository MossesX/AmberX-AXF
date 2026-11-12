/** Application-menu entries (pure data; read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'amberx-lists.apps', menu: 'apps', menuLabel: 'Apps', menuOrder: 50, path: [{ id: 'amberx', label: 'AmberX', icon: 'smartphone' }], order: 14, items: [
    { id: 'amberx-lists-page', label: 'Lists', icon: 'list', action: 'nav:amberx-lists' },
    { id: 'amberx-lists-new', label: 'New list', icon: 'plus', action: 'amberx-lists.focus:new' },
  ] },
  { id: 'amberx-lists.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 61, items: [
    { id: 'amberx-lists-open', label: 'AmberX lists', icon: 'list', action: 'nav:amberx-lists' },
    { id: 'amberx-lists-settings', label: 'AmberX lists settings', icon: 'list', action: 'settings.open:amberx-lists' },
  ] },
];

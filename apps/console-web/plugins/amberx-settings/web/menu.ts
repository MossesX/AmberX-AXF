/** Application-menu entries (pure data; read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'amberx-settings.apps', menu: 'apps', menuLabel: 'Apps', menuOrder: 50, path: [{ id: 'amberx', label: 'AmberX', icon: 'smartphone' }], order: 90, items: [
    { id: 'amberx-settings-open', label: 'AmberX settings', icon: 'settings', action: 'settings.open:amberx' },
  ] },
];

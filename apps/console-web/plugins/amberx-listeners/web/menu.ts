/** Application-menu entries (pure data; read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'amberx-listeners.apps', menu: 'apps', menuLabel: 'Apps', menuOrder: 50, path: [{ id: 'amberx', label: 'AmberX', icon: 'smartphone' }], order: 30, items: [
    { id: 'amberx-listeners-page', label: 'Listeners (microphone control)', icon: 'mic', action: 'nav:amberx-listeners' },
  ] },
  { id: 'amberx-listeners.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 58, items: [
    { id: 'amberx-listeners-open', label: 'AmberX listeners', icon: 'mic', action: 'nav:amberx-listeners' },
    { id: 'amberx-listeners-settings', label: 'AmberX listeners settings', icon: 'mic', action: 'settings.open:amberx-listeners' },
  ] },
];

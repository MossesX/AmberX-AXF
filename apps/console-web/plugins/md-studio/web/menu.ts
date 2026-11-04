/**
 * Application-menu entries for MD Studio (pure data: read by scripts/menu-reach.mts too).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'md-studio.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 52, items: [{ id: 'md-studio', label: 'MD Studio', icon: 'file', action: 'nav:md-studio' }] },
  { id: 'md-studio.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 82, items: [{ id: 'md-studio-builds', label: 'MD Studio', icon: 'file', action: 'nav:md-studio' }] },
];

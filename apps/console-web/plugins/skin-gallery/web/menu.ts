/** Application-menu entries of the Skins plugin (pure data: read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'skin-gallery.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 52, items: [{ id: 'skin-gallery', label: 'Skins', icon: 'palette', action: 'nav:skin-gallery' }] },
];

/** Application-menu entries (pure data; read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'ref-links.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 57, items: [{ id: 'ref-links-settings', label: 'Reference links settings', icon: 'info', action: 'settings.open:ref-links' }] },
];

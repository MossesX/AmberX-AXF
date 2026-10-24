/** Application-menu entries for axHub sync (pure data: scripts/menu-reach.mts reads this file too). Settings only. */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'hub-sync.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 56, items: [{ id: 'hub-sync', label: 'axHub sync', icon: 'cloud', action: 'settings.open:hubsync' }] },
];

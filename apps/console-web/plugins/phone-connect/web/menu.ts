/**
 * Application-menu entries of Phone Connect (pure data: scripts/menu-reach.mts reads this file too): Plugins ▸ Phone Connect
 * opens its settings tab (pairing, phones, features, recent commands).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'phone-connect.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 70, items: [{ id: 'phone-connect-settings', label: 'Phone Connect', icon: 'smartphone', action: 'settings.open:phone-connect' }] },
];

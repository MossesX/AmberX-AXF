/**
 * Application-menu entries (pure data: scripts/menu-reach.mts reads this file too). Phone Connect is a settings tab
 * (Settings → Plugins → Phone Connect): pair a phone, see and revoke phones, phone features, recent commands.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'phone-connect.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'phone-connect', label: 'Phone Connect', icon: 'smartphone', action: 'settings.open:phone-connect' }] },
];

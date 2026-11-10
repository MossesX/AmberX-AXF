/**
 * Application-menu entries (pure data: no React or CSS imports, because scripts/menu-reach.mts reads this file too).
 * One entry in Plugins, one in Console next to the other server views.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'maintenance.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'vps', label: 'VPS', icon: 'monitor', action: 'nav:vps' }, { id: 'maintenance', label: 'Maintenance', icon: 'trash', action: 'nav:maintenance' }] },
  { id: 'maintenance.console', menu: 'console', menuLabel: 'Console', menuOrder: 10, order: 60, items: [{ id: 'maintenance-console', label: 'VPS: gauges and clean-up', icon: 'monitor', action: 'nav:vps' }] },
];

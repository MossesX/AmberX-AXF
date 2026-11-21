/** Application-menu entries (pure data; the console's reachability check reads this file too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'status-styles.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'status-styles', label: 'Status styles', icon: 'sparkles', action: 'settings.open:status-styles' }] },
];

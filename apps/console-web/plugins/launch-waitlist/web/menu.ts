/** Application-menu entries (pure data, read by scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'launch-waitlist.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'launch-waitlist', label: 'Launch waitlist', icon: 'rocket', action: 'nav:launch-waitlist' }] },
];

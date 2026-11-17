/**
 * Application-menu entries of the Hub plugin (pure data: the console's reachability check, scripts/menu-reach.mts,
 * reads this file too). The Hub page stays reachable while the toolbar and side navigation are hidden.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'hub-admin.menu', menu: 'apps', menuLabel: 'Apps', menuOrder: 50, order: 10, items: [{ id: 'hub-admin', label: 'Hub', icon: 'shield', action: 'nav:hub' }] },
];

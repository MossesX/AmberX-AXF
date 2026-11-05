/**
 * Application-menu entries (pure data: the console's reachability check, scripts/menu-reach.mts, reads this file).
 * Shipped features sits under Builds, next to the other build views.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'shipped-features.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 60, items: [{ id: 'shipped-features', label: 'Shipped features', icon: 'check-circle', action: 'nav:shipped-features' }] },
];

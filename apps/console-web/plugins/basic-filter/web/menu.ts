/**
 * Application-menu entries (pure data: scripts/menu-reach.mts reads this file too).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'basic-filter.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'basic-filter', label: 'Basic filter', icon: 'sliders', action: 'settings.open:basic-filter' }] },
  { id: 'basic-filter.view', menu: 'view', menuLabel: 'View', menuOrder: 60, order: 82, items: [{ id: 'basic-filter.open', label: 'Sort & filter…', icon: 'sliders', action: 'basic-filter.open' }] },
];

/**
 * Build search's application-menu entries (pure data; read by scripts/menu-reach.mts too).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'build-search.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'build-search', label: 'Build search', icon: 'search', action: 'nav:build-search' }] },
  { id: 'build-search.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 15, items: [{ id: 'build-search.builds', label: 'Search builds, notes and session logs', icon: 'search', action: 'nav:build-search' }] },
];

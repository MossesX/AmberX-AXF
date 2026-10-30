/**
 * Application-menu entries (pure data, read by scripts/menu-reach.mts too): Builds ▸ Build Breaker, next to the
 * Feature matrix the matrix plugin puts there, plus its settings under Plugins.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'build-breaker.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 15, items: [{ id: 'build-breaker', label: 'Build Breaker', icon: 'hammer', action: 'nav:build-breaker' }] },
  { id: 'build-breaker.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'build-breaker-settings', label: 'Build Breaker settings', icon: 'hammer', action: 'settings.open:build-breaker' }] },
];

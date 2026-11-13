/**
 * Application-menu entries this plugin adds (pure data: no React or CSS imports, because the console's reachability
 * check, scripts/menu-reach.mts, reads this file too). Plugins → Asset designer, and View → Look → Asset designer….
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'asset-designer.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'asset-designer', label: 'Asset designer', icon: 'edit', action: 'nav:asset-designer' }] },
  { id: 'asset-designer.view', menu: 'view', menuLabel: 'View', menuOrder: 60, order: 62, items: [{ id: 'asset-designer-open', label: 'Asset designer…', icon: 'edit', action: 'asset-designer.open' }] },
];

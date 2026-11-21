/**
 * Application-menu entries (pure data, read by scripts/menu-reach.mts too): Builds → VPS Configuration, and the plugin's
 * settings, so the console still reaches them while the toolbar and side navigation are hidden.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'gate.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 60, items: [{ id: 'gate', label: 'VPS Configuration', icon: 'shield', action: 'nav:gate' }] },
];

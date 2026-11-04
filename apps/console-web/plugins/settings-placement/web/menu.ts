/**
 * Application-menu entries (pure data, read by scripts/menu-reach.mts too): Plugins → Settings placement opens the
 * global page (Settings → Plugins → Settings placement).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'settings-placement.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 52, items: [{ id: 'settings-placement', label: 'Settings placement', icon: 'layout', action: 'settings.open:settings-placement' }] },
];

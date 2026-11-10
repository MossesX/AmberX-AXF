/**
 * Application-menu entries (pure data: scripts/menu-reach.mts reads this file too). VPS Settings has no page of its own:
 * it sits in Settings → Plugins → VPS Settings (deep link settings:vps-settings).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'vps-settings.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 42, items: [{ id: 'vps-settings-open', label: 'VPS settings', icon: 'shield', action: 'settings.open:vps-settings' }] },
];

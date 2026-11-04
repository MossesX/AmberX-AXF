/**
 * Application-menu entries (pure data: scripts/menu-reach.mts reads this file too). Claude settings sit in the Claude
 * page and in Settings → Plugins → Claude.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'claude-settings.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 45, items: [
    { id: 'claude-settings-page', label: 'Claude', icon: 'sparkles', action: 'nav:claude-settings' },
    { id: 'claude-settings-open', label: 'Claude settings', icon: 'sparkles', action: 'settings.open:claude-settings' },
  ] },
];

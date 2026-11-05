/** Application-menu entries (pure data: scripts/menu-reach.mts reads this file too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'claude-accounts.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 46, items: [
    { id: 'claude-accounts-page', label: 'Claude accounts', icon: 'key', action: 'nav:claude-accounts' },
    { id: 'claude-accounts-open', label: 'Claude accounts settings', icon: 'key', action: 'settings.open:claude-accounts' },
  ] },
];

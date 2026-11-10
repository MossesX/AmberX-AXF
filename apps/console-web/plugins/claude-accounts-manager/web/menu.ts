/** Application-menu entries (pure data: scripts/menu-reach.mts reads this file too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'claude-accounts-manager.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 45, items: [
    { id: 'claude-accounts-manager-page', label: 'Claude accounts manager', icon: 'key', action: 'nav:claude-accounts-manager' },
    { id: 'claude-accounts-manager-overlay', label: 'Claude accounts overlay', icon: 'layers', action: 'claude-accounts-manager.overlay:toggle' },
    { id: 'claude-accounts-manager-add', label: 'Add a Claude account…', icon: 'plus', action: 'claude-accounts-manager.add-dialog:subscription' },
    { id: 'claude-accounts-manager-settings', label: 'Claude accounts manager settings', icon: 'settings', action: 'settings.open:claude-accounts-manager' },
  ] },
];

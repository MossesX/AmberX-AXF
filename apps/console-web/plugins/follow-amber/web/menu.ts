/** Application-menu entries (pure data; read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'follow-amber.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 55, items: [
    { id: 'follow-amber-toggle', label: 'Follow Amber on / off', icon: 'eye', action: 'follow-amber.toggle' },
    { id: 'follow-amber-approvals', label: 'Waiting approvals', icon: 'shield', action: 'follow-amber.approvals' },
    { id: 'follow-amber-settings', label: 'Follow Amber settings', icon: 'eye', action: 'settings.open:follow-amber' },
  ] },
];

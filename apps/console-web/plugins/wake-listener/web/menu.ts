/** Application-menu entries (pure data; read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'wake-listener.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 59, items: [
    { id: 'wake-listener-toggle', label: 'Wake listener on / off', icon: 'mic', action: 'wake-listener.toggle' },
    { id: 'wake-listener-approvals', label: 'Review approvals by voice', icon: 'check-circle', action: 'wake-listener.approvals' },
    { id: 'wake-listener-settings', label: 'Wake listener settings', icon: 'settings', action: 'settings.open:wake-listener' },
  ] },
];

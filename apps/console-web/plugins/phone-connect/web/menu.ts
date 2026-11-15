/** Application-menu entries (pure data: the console's reachability check reads this file too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'phone-connect.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 30, items: [
    { id: 'phone-connect', label: 'Phone Connect', icon: 'smartphone', action: 'nav:phone-connect' },
    { id: 'phone-recorder', label: 'Phone recorder', icon: 'mic', action: 'nav:phone-recorder' },
    { id: 'phone-rules', label: 'Auto-approval rules', icon: 'check', action: 'nav:phone-rules' },
  ] },
];

/** Application-menu entries for the Sandbox (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'sandbox.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [
    { id: 'sandbox', label: 'Sandbox', icon: 'box', action: 'nav:sandbox' },
    { id: 'sandbox-manage', label: 'Sandbox management', icon: 'settings', action: 'sandbox.manage', requires: 'sandbox.manage' },
  ] },
  { id: 'sandbox.console', menu: 'console', menuLabel: 'Console', menuOrder: 10, order: 60, items: [
    { id: 'sandbox-open', label: 'Sandbox (read-only)', icon: 'box', action: 'sandbox.open' },
  ] },
];

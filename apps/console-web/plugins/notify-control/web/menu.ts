/**
 * Application-menu entries (pure data: scripts/menu-reach.mts reads this file too). The panel sits under Plugins and
 * Console, with its settings in Settings → Plugins → Notifications.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'notify-control.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'notify-control', label: 'Notifications', icon: 'bell', action: 'nav:notify-control' }] },
  { id: 'notify-control.console', menu: 'console', menuLabel: 'Console', menuOrder: 10, order: 60, items: [{ id: 'notify-control-page', label: 'Notifications', icon: 'bell', action: 'nav:notify-control' }] },
];

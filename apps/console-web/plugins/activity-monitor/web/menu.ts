/**
 * Application-menu entries (pure data: read by scripts/menu-reach.mts too). The log opens from Plugins and from View.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'activity-monitor.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'activity-monitor', label: 'Activity Monitor', icon: 'monitor', action: 'nav:activity-monitor', badge: 'activity-monitor.errors' }] },
  { id: 'activity-monitor.view', menu: 'view', menuLabel: 'View', order: 30, items: [
    { id: 'activity-monitor.view.open', label: 'Activity log', icon: 'monitor', action: 'nav:activity-monitor' },
    { id: 'activity-monitor.view.errors', label: 'Activity log: errors', icon: 'alert', action: 'activity-monitor.tab:errors' },
  ] },
];

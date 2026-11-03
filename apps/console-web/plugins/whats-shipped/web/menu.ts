/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'whats-shipped.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 10, items: [{ id: 'whats-shipped', label: "What's new", icon: 'sparkles', items: [
    { id: 'whats-shipped-show', label: "Show what's new", icon: 'sparkles', action: 'whats-shipped.open' },
    { id: 'whats-shipped-read-all', label: 'Mark all read', icon: 'check', action: 'whats-shipped.read-all' },
    { id: 'whats-shipped-check', label: 'Check now', icon: 'refresh', action: 'whats-shipped.check' },
  ] }] },
  { id: 'whats-shipped.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 51, items: [{ id: 'whats-shipped', label: "What's new", icon: 'sparkles', action: 'settings.open:whats-shipped' }] },
];

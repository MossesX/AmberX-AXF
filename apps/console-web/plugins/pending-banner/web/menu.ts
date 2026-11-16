/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'pending-banner.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 14, items: [{ id: 'pending-banner', label: 'Pending builds', icon: 'clock', items: [
    { id: 'pending-banner-show', label: 'Show the Pending banner', icon: 'clock', action: 'pending-banner.open' },
    { id: 'pending-banner-queue-all', label: 'Send all to Queue', icon: 'play', action: 'pending-banner.queue-all' },
  ] }] },
  { id: 'pending-banner.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'pending-banner-settings', label: 'Pending banner', icon: 'clock', action: 'settings.open:pending-banner' }] },
];

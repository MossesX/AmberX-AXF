/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'push-banner.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 9.5, items: [{ id: 'push-banner-check', label: 'Branches not on main', icon: 'branch', action: 'push-banner.check' }] },
  { id: 'push-banner.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 51, items: [{ id: 'push-banner', label: 'Push banner', icon: 'branch', action: 'settings.open:push-banner' }] },
];

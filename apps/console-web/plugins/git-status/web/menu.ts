/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'git-status.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 8, items: [{ id: 'git-status', label: 'Git status', icon: 'git-branch', action: 'nav:git-status' }] },
  { id: 'git-status.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 51, items: [{ id: 'git-status-settings', label: 'Git status settings', icon: 'git-branch', action: 'settings.open:git-status' }] },
];

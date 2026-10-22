/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'codebase-changes.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 8, items: [{ id: 'codebase-changes', label: 'Codebase changes (log)', icon: 'branch', action: 'codebase-changes.open' }] },
  { id: 'codebase-changes.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'codebase-changes-settings', label: 'Codebase changes settings', icon: 'branch', action: 'settings.open:codebase-changes' }] },
];

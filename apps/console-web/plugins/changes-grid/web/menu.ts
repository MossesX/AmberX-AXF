/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'changes-grid.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 9, items: [{ id: 'changes-grid', label: 'Changes & features grid', icon: 'list', action: 'nav:changes-grid' }] },
  { id: 'changes-grid.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'changes-grid-settings', label: 'Changes & features grid settings', icon: 'list', action: 'settings.open:changes-grid' }] },
];

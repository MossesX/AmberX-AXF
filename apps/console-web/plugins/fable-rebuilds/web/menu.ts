/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'fable-rebuilds.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 15, items: [{ id: 'fable-rebuilds', label: 'Fable rebuilds', icon: 'sparkles', action: 'nav:fable-rebuilds' }] },
  { id: 'fable-rebuilds.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'fable-rebuilds', label: 'Fable rebuilds', icon: 'sparkles', action: 'nav:fable-rebuilds' }] },
];

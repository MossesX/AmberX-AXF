/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'plugin-switches.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 14, items: [{ id: 'plugin-switches', label: 'Plugin switches', icon: 'sliders', action: 'plugin-switches.open' }] },
];

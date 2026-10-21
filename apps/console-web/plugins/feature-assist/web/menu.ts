/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'feature-assist.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{
    id: 'feature-assist', label: 'Feature assistant', icon: 'sparkles',
    items: [
      { id: 'describe', label: 'Describe a feature (Plan)', icon: 'plus', action: 'nav:plan' },
      { id: 'settings', label: 'Feature assistant settings', icon: 'settings', action: 'settings.open:feature-assist' },
    ],
  }] },
];

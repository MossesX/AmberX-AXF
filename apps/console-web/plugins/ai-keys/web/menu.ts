/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'ai-keys.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 16, items: [{ id: 'ai-keys', label: 'AI keys…', icon: 'key', action: 'ai-keys.open' }] },
];

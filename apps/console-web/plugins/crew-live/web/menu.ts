/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'crew-live.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 13, items: [{ id: 'crew', label: 'Crew (who is working)', icon: 'user', action: 'nav:crew' }] },
  { id: 'crew-live.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'crew-settings', label: 'Crew settings', icon: 'user', action: 'settings.open:crew-live' }] },
];

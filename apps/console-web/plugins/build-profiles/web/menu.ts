/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'build-profiles.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 1, items: [{ id: 'build-profiles', label: 'Build profile…', icon: 'layers', action: 'build-profiles.open' }] },
  { id: 'build-profiles.plugins', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 15, items: [{ id: 'build-profiles.p', label: 'Build profiles', icon: 'layers', action: 'build-profiles.open' }] },
];

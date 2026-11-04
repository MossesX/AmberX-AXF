/** Application-menu entries (pure data, read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'builds.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 5, items: [
    { id: 'builds', label: 'Builds', icon: 'list', action: 'nav:builds' },
    { id: 'builds.steps', label: 'Steps', icon: 'layers', action: 'builds.view:steps' },
  ] },
];

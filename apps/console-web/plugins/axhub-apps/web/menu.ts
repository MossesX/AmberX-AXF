/** Application-menu entries for axHub apps (pure data: scripts/menu-reach.mts reads this file too). Module axHub: every
 *  axHub plugin adds its pages to Apps → axHub (the console's own submenu keeps "Open axHub in a new tab"). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'axhub-apps.menu', menu: 'apps', path: ['axhub'], order: 30, items: [
    { id: 'axhub-apps', label: 'Apps', icon: 'download', action: 'nav:axhub-apps' },
  ] },
];

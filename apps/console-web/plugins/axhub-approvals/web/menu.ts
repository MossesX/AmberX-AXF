/** Application-menu entries for axHub approvals (pure data: scripts/menu-reach.mts reads this file too). Module axHub: every
 *  axHub plugin adds its pages to Apps → axHub (the console's own submenu keeps "Open axHub in a new tab"). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'axhub-approvals.menu', menu: 'apps', path: ['axhub'], order: 10, items: [
    { id: 'axhub-approvals', label: 'Approvals', icon: 'shield', action: 'nav:axhub-approvals' },
    { id: 'axhub-approvals-log', label: 'Approvals log', icon: 'list', action: 'nav:axhub-approvals-log' },
  ] },
];

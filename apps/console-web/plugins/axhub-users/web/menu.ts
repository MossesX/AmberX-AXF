/** Application-menu entries for axHub users (pure data: scripts/menu-reach.mts reads this file too). Module axHub: every
 *  axHub plugin adds its pages to the same axHub menu. */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'axhub-users.menu', menu: 'axhub', menuLabel: 'axHub', menuOrder: 45, order: 40, items: [
    { id: 'axhub-users', label: 'Users', icon: 'user', action: 'nav:axhub-users' },
  ] },
];

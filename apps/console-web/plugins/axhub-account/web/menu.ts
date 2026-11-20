/** Application-menu entries for axHub account (pure data: scripts/menu-reach.mts reads this file too). Module axHub: every
 *  axHub plugin adds its pages to the same axHub menu. */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'axhub-account.menu', menu: 'axhub', menuLabel: 'axHub', menuOrder: 45, order: 60, items: [
    { id: 'axhub-hub', label: 'axHub', icon: 'external', action: 'nav:axhub-hub' },
    { id: 'axhub-account', label: 'Hub account', icon: 'key', action: 'nav:axhub-account' },
  ] },
];

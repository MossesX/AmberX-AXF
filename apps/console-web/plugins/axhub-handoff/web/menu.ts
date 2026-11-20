/** Application-menu entries for axHub handoff (pure data: scripts/menu-reach.mts reads this file too). Module axHub: every
 *  axHub plugin adds its pages to the same axHub menu. */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'axhub-handoff.menu', menu: 'axhub', menuLabel: 'axHub', menuOrder: 45, order: 50, items: [
    { id: 'axhub-handoff', label: 'Handoff', icon: 'package', action: 'nav:axhub-handoff' },
  ] },
];

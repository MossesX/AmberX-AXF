/** Application-menu entries for axHub passes (pure data: scripts/menu-reach.mts reads this file too). Module axHub: every
 *  axHub plugin adds its pages to the same axHub menu. */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'axhub-passes.menu', menu: 'axhub', menuLabel: 'axHub', menuOrder: 45, order: 20, items: [
    { id: 'axhub-go-pass', label: 'Go pass', icon: 'check', action: 'nav:axhub-go-pass' },
    { id: 'axhub-passes', label: 'Passes', icon: 'clock', action: 'nav:axhub-passes' },
  ] },
];

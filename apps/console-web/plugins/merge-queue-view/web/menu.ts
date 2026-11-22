/**
 * Application-menu entries of the merge queue (pure data: scripts/menu-reach.mts reads this file too).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'merge-queue.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 60, items: [{ id: 'merge-queue', label: 'Merge queue', icon: 'branch', action: 'nav:merge-queue' }] },
];

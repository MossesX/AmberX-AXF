/** Application-menu entries (pure data, read by scripts/menu-reach.mts too). The Builds and Steps tables are retired
 * (split builds pages, Nov 9 2026): the menu points at Pending and Complete (builds manager) and Queued and Active
 * (orchestrator) through their generic actions. */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'builds.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 5, items: [
    { id: 'builds.pending', label: 'Pending', icon: 'clock', action: 'builds.pending' },
    { id: 'builds.queued', label: 'Queued', icon: 'list', action: 'builds.queued' },
    { id: 'builds.active', label: 'Active', icon: 'play', action: 'builds.active' },
    { id: 'builds.complete', label: 'Complete', icon: 'check-circle', action: 'builds.complete' },
  ] },
];

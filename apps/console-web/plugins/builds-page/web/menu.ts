/** Application-menu entries (pure data, read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

/** Builds ▸ View: one entry per view of the one Builds page (same order as the page's toolbar and keys 1–6). */
export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'builds.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 5, items: [
    { id: 'builds', label: 'Builds', icon: 'list', action: 'nav:builds' },
    { id: 'builds.views', label: 'View', icon: 'layers', items: [
      { id: 'builds.view.pending', label: 'Pending', icon: 'clock', action: 'builds.open:pending' },
      { id: 'builds.view.queue', label: 'Queue', icon: 'play', action: 'builds.open:queue' },
      { id: 'builds.view.plan', label: 'Plan', icon: 'layers', action: 'builds.open:plan' },
      { id: 'builds.view.tracker', label: 'Tracker', icon: 'check-circle', action: 'builds.open:tracker' },
      { id: 'builds.view.orchestrator', label: 'Orchestrator', icon: 'layers', action: 'builds.open:orchestrator' },
      { id: 'builds.view.steps', label: 'Steps', icon: 'list', action: 'builds.open:steps' },
    ] },
  ] },
];

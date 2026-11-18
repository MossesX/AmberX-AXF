/**
 * Application-menu entries (pure data: scripts/menu-reach.mts reads this file too). The demo sits under Builds:
 * the start overlay and the summary, with its settings in Settings → Plugins → Orchestrator demo.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'orchestrator-demo.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 70, items: [
    { id: 'orchestrator-demo-start', label: 'Start the orchestrator demo', icon: 'play', action: 'orchestrator-demo.open' },
    { id: 'orchestrator-demo-summary', label: 'Orchestrator demo summary', icon: 'list', action: 'orchestrator-demo.summary' },
    { id: 'orchestrator-demo-settings', label: 'Orchestrator demo settings', icon: 'settings', action: 'settings.open:orchestrator-demo' },
  ] },
];

/**
 * Application-menu entries (pure data, read by scripts/menu-reach.mts too): Builds ▸ Start the orchestrator demo (the start
 * overlay), plus its settings under Plugins.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'orchestrator-demo.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 60, items: [
    { id: 'orchestrator-demo-start', label: 'Start the orchestrator demo…', icon: 'play', action: 'orchestrator-demo.open' },
  ] },
  { id: 'orchestrator-demo.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 60, items: [{ id: 'orchestrator-demo-settings', label: 'Orchestrator demo settings', icon: 'play', action: 'settings.open:orchestrator-demo' }] },
];

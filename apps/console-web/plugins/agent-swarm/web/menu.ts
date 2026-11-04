/**
 * Application-menu entries (pure data, read by scripts/menu-reach.mts too): Builds ▸ Agent swarm, plus its settings
 * under Plugins.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'agent-swarm.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 14, items: [
    { id: 'agent-swarm', label: 'Agent swarm', icon: 'user', action: 'nav:agent-swarm' },
  ] },
  { id: 'agent-swarm.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'agent-swarm-settings', label: 'Agent swarm settings', icon: 'user', action: 'settings.open:agent-swarm' }] },
];

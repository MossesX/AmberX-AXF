/**
 * Application-menu entries (pure data: scripts/menu-reach.mts reads this file too). The demo page sits under Plugins
 * and Builds, with its settings in Settings → Plugins → Orchestrator demo.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'orchestrator-demo.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 62, items: [{ id: 'orchestrator-demo', label: 'Orchestrator demo', icon: 'play', action: 'nav:orchestrator-demo' }] },
];

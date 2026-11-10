/** Application-menu entries (pure data, read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'build-orchestrator.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 15, items: [
    { id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', action: 'nav:build-orchestrator' },
    { id: 'build-orchestrator.queue', label: 'Build queue', icon: 'list', action: 'build-orchestrator.tab:queue' },
    { id: 'build-orchestrator.active', label: 'Building now', icon: 'play', action: 'build-orchestrator.tab:active' },
    { id: 'build-orchestrator.errors', label: 'Build errors', icon: 'alert', action: 'build-orchestrator.tab:errors' },
    { id: 'build-orchestrator.accounts', label: 'Claude account health', icon: 'user', action: 'build-orchestrator.tab:accounts' },
  ] },
];

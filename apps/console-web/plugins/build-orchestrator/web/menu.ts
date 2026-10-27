/** Application-menu entries (pure data, read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'build-orchestrator.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 15, items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', action: 'nav:build-orchestrator' }] },
];

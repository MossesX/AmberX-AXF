/** Application-menu entries (pure data, read by scripts/menu-reach.mts too): Builds ▸ Feature matrix next to the Build orchestrator, plus its settings under Plugins. */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'feature-matrix.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 16, items: [{ id: 'feature-matrix', label: 'Feature matrix', icon: 'check-circle', action: 'nav:feature-matrix' }] },
  { id: 'feature-matrix.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'feature-matrix-settings', label: 'Feature matrix settings', icon: 'check-circle', action: 'settings.open:feature-matrix' }] },
];

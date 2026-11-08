/**
 * Application-menu entries for Memory Manager (pure data: read by scripts/menu-reach.mts too).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'memory-manager.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 52, items: [{ id: 'memory-manager', label: 'Memory Manager', icon: 'file', action: 'nav:memory-manager' }] },
  { id: 'memory-manager.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 82, items: [{ id: 'memory-manager-builds', label: 'Memory Manager', icon: 'file', action: 'nav:memory-manager' }] },
];

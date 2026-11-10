/** Application-menu entries of the file watchdog (pure data: scripts/menu-reach.mts reads this file). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'file-watchdog.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'file-watchdog', label: 'File watchdog', icon: 'eye', action: 'nav:file-watchdog' }] },
];

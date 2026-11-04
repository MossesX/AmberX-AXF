/** Application-menu entries (pure data; read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'token-control.menu', menu: 'framework', menuLabel: 'Framework', menuOrder: 30, order: 60, items: [{ id: 'token-control', label: 'Token control', icon: 'sliders', action: 'nav:token-control' }] },
];

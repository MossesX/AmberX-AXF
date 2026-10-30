/** Application-menu entries (pure data, read by scripts/menu-reach.mts too): View ▸ Design packs, plus its settings under Plugins. */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'design-packs.view', menu: 'view', menuLabel: 'View', menuOrder: 60, order: 30, items: [{ id: 'design-packs', label: 'Design packs', icon: 'palette', action: 'nav:design-packs' }] },
  { id: 'design-packs.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'design-packs-settings', label: 'Design packs settings', icon: 'palette', action: 'settings.open:design-packs' }] },
];

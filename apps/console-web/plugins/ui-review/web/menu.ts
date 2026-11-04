/** Application-menu entries (pure data, read by scripts/menu-reach.mts too): View ▸ UI Review, View ▸ Design packs (its Design packs section) and View ▸ Screenshots (its Screenshots tab), plus its settings under Plugins. */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'ui-review.view', menu: 'view', menuLabel: 'View', menuOrder: 60, order: 30, items: [
    { id: 'ui-review', label: 'UI Review', icon: 'eye', action: 'nav:ui-review' },
    { id: 'design-packs', label: 'Design packs', icon: 'palette', action: 'nav:design-packs' },
    { id: 'ui-screenshots', label: 'Screenshots', icon: 'monitor', action: 'nav:ui-screenshots' },
  ] },
  { id: 'ui-review.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'ui-review-settings', label: 'UI Review settings', icon: 'eye', action: 'settings.open:ui-review' }] },
];

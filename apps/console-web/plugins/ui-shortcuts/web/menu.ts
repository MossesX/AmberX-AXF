/**
 * Application-menu entries (pure data; scripts/menu-reach.mts reads this file too): Plugins ▸ UI shortcuts… (the quick-open
 * dialog) and its settings.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'ui-shortcuts.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 12, items: [
    { id: 'ui-shortcuts', label: 'UI shortcuts…', icon: 'zap', action: 'ui-shortcuts.dialog' },
    { id: 'ui-shortcuts-settings', label: 'UI shortcuts settings', icon: 'settings', action: 'settings.open:ui-shortcuts' },
  ] },
];

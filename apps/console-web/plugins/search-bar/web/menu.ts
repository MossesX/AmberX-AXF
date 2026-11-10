/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'search-bar.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 48, items: [{ id: 'search-bar', label: 'Search bar', icon: 'search', items: [
    { id: 'search-bar-open', label: 'Search', icon: 'search', action: 'search-bar.open' },
    { id: 'search-bar-everything', label: 'Search everything (globe)', icon: 'globe', action: 'search-bar.scope:everything' },
    { id: 'search-bar-settings-only', label: 'Search settings only (gear)', icon: 'settings', action: 'search-bar.scope:settings' },
    { id: 'search-bar-add-toolbar', label: 'Add a search bar to the toolbar', icon: 'plus', action: 'search-bar.add:toolbar:compact:everything' },
    { id: 'search-bar-settings', label: 'Search bar settings', icon: 'sliders', action: 'settings.open:search-bar' },
  ] }] },
];

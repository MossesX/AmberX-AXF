/**
 * Application-menu entries (pure data, read by scripts/menu-reach.mts too): Builds ▸ Plan Studio and New plan (quick
 * capture), plus its settings under Plugins.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'plan-studio.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 12, items: [
    { id: 'plan-studio', label: 'Plan Studio', icon: 'layout', action: 'nav:plan-studio' },
    { id: 'plan-studio-capture', label: 'New plan…', icon: 'plus', action: 'plan-studio.capture' },
  ] },
  { id: 'plan-studio.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'plan-studio-settings', label: 'Plan Studio settings', icon: 'layout', action: 'settings.open:plan-studio' }] },
];

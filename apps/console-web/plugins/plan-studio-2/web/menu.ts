/**
 * Application-menu entries (pure data, read by scripts/menu-reach.mts too): Builds ▸ Plan Studio 2.0 and New plan, plus
 * its settings under Plugins.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'plan-studio-2.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 13, items: [
    { id: 'plan-studio-2', label: 'Plan Studio 2.0', icon: 'branch', action: 'nav:plan-studio-2' },
    { id: 'plan-studio-2-new', label: 'New plan (Plan Studio 2.0)…', icon: 'plus', action: 'plan-studio-2.new' },
  ] },
  { id: 'plan-studio-2.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'plan-studio-2-settings', label: 'Plan Studio 2.0 settings', icon: 'branch', action: 'settings.open:plan-studio-2' }] },
];

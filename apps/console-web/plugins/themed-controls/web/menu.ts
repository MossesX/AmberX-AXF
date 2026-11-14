/**
 * Application-menu entries (pure data, read by scripts/menu-reach.mts): the Themed controls settings sub-tab from the
 * Plugins menu and the View menu.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'themed-controls.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'themed-controls', label: 'Themed controls', icon: 'sliders', action: 'themed-controls.open' }] },
  { id: 'themed-controls.view', menu: 'view', menuLabel: 'View', menuOrder: 60, order: 70, items: [{ id: 'themed-controls.toggle', label: 'Themed controls', icon: 'sliders', action: 'themed-controls.toggle', checked: 'setting:axf.themedControls.on' }] },
];

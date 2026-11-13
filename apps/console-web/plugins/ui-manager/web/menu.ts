/**
 * Application-menu entries (pure data: no React or CSS imports; the console's reachability check reads this file too).
 * One in Plugins, one in View → Look, so the UI Manager is reached while the toolbar and side navigation are hidden.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'ui-manager.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'ui-manager', label: 'UI Manager', icon: 'sliders', action: 'nav:ui-manager' }] },
  { id: 'ui-manager.view', menu: 'view', path: ['look'], order: 60, items: [{ id: 'ui-manager.view.open', label: 'UI Manager…', icon: 'sliders', action: 'nav:ui-manager' }] },
];

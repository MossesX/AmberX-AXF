/**
 * Application-menu entries (pure data: the console's reachability check, scripts/menu-reach.mts, reads this file too).
 * Plugins → Skin editor / Token registry; Framework → Skin editor (the look tools live there as well).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'skin-editor.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [
    { id: 'skin-editor', label: 'Skin editor', icon: 'palette', action: 'nav:skin-editor' },
    { id: 'token-registry', label: 'Token registry', icon: 'list', action: 'nav:token-registry' },
  ] },
  { id: 'skin-editor.framework', menu: 'framework', menuLabel: 'Framework', menuOrder: 30, order: 60, items: [
    { id: 'skin-editor.framework.open', label: 'Skin editor', icon: 'palette', action: 'nav:skin-editor' },
    { id: 'skin-editor.framework.pick', label: 'Pick a UI to skin…', icon: 'eye', action: 'skin-editor.pick' },
  ] },
];

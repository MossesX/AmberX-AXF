/**
 * Application-menu entries (pure data, read by scripts/menu-reach.mts too): GitHub settings stay reachable while the
 * toolbar and side navigation are hidden.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'github-app.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 22, items: [{ id: 'github-app', label: 'GitHub App…', icon: 'github', action: 'settings.open:github-app' }] },
];

/** Application-menu entries of the API Browser (pure data, read by the console's reachability check too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'api-browser.menu', menu: 'console', menuLabel: 'Console', menuOrder: 10, order: 70, items: [{ id: 'api-browser', label: 'API Browser', icon: 'code', action: 'nav:api-browser' }] },
];

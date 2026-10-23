/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'project-wizard.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'project-wizard', label: 'New project', icon: 'rocket', action: 'nav:project-wizard' }] },
  { id: 'project-wizard.standards', menu: 'framework', menuLabel: 'Framework', menuOrder: 30, path: ['standards'], items: [{ id: 'new-project', label: 'New project…', icon: 'rocket', action: 'nav:project-wizard' }] },
];

/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'projects.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 0, items: [{ id: 'projects', label: 'Project…', icon: 'layers', action: 'projects.open' }, { id: 'projects.new', label: 'New project…', icon: 'plus', action: 'projects.new' }, { id: 'projects.duplicate', label: 'Duplicate project…', icon: 'copy', action: 'projects.duplicate' }, { id: 'projects.save-boilerplate', label: 'Save as boilerplate…', icon: 'package', action: 'projects.save-boilerplate' }, { id: 'projects.boilerplates', label: 'Boilerplates…', icon: 'package', action: 'projects.boilerplates' }] },
  { id: 'projects.plugins', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 14, items: [{ id: 'projects.p', label: 'Projects', icon: 'layers', action: 'projects.open' }] },
];

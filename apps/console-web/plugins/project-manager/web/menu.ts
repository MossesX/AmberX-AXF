/**
 * Application-menu entries of the Project Manager (pure data: read by scripts/menu-reach.mts too).
 * Plugins ▸ Project Manager, and Console ▸ Projects with the multi-project view and the live preview toggles.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'project-manager.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'project-manager', label: 'Project Manager', icon: 'folder', action: 'nav:project-manager' }] },
  {
    id: 'project-manager.console', menu: 'console', menuLabel: 'Console', menuOrder: 10, order: 15,
    items: [{
      id: 'project-manager.projects', label: 'Projects', icon: 'folder',
      items: [
        { id: 'project-manager.open', label: 'Project Manager', icon: 'folder', action: 'nav:project-manager' },
        { id: 'project-manager.multi', label: 'Multi-project view', icon: 'layers', action: 'project-manager.multi' },
        { id: 'project-manager.preview', label: 'Live preview', icon: 'eye', action: 'project-manager.preview' },
      ],
    }],
  },
];

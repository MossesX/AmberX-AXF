/**
 * Application-menu entries for the Notes browser (pure data: read by scripts/menu-reach.mts too).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'notes-browser.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'claude-files', label: 'Claude files', icon: 'file', action: 'nav:claude-files' }] },
];

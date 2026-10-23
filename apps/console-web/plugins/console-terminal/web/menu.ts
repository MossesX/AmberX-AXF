/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'console-terminal.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{
    id: 'terminal', label: 'Terminal', icon: 'terminal',
    items: [
      { id: 'new', label: 'New terminal', icon: 'terminal', action: 'terminal.new' },
      { id: 'settings', label: 'Terminal settings', icon: 'settings', action: 'settings.open:terminal' },
    ],
  }] },
  { id: 'console-terminal.console', menu: 'console', menuLabel: 'Console', menuOrder: 10, order: 32, items: [{ id: 'terminal-new', label: 'New terminal (shell)', icon: 'terminal', action: 'terminal.new' }] },
];

/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'mcp-client.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{
    id: 'mcp', label: 'MCP servers', icon: 'cloud',
    items: [
      { id: 'servers', label: 'MCP servers', icon: 'cloud', action: 'nav:mcp' },
      { id: 'settings', label: 'MCP server settings', icon: 'settings', action: 'settings.open:mcp' },
    ],
  }] },
];

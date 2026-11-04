/**
 * Application-menu entries (pure data: scripts/menu-reach.mts reads this file). One entry in Plugins, one in Apps
 * next to the other things Brett opens from his phone, and the settings tab under Plugins → Chat viewer settings.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'chat-viewer.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [
    { id: 'chat-viewer', label: 'Chat viewer', icon: 'list', action: 'nav:chat-viewer' },
    { id: 'chat-viewer.settings', label: 'Chat viewer settings', icon: 'settings', action: 'settings.open:chat-viewer' },
  ] },
  { id: 'chat-viewer.apps', menu: 'apps', menuLabel: 'Apps', menuOrder: 50, order: 60, items: [{ id: 'chat-viewer.chats', label: 'Chats', icon: 'list', action: 'nav:chat-viewer' }] },
];

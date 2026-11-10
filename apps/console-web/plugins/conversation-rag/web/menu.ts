/** Application-menu entries (pure data, read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'conversation-rag.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'conversation-rag', label: 'Conversations', icon: 'messages-square', action: 'nav:conversation-rag' }] },
];

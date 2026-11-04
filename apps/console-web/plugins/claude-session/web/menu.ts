/**
 * Application-menu entries (pure data, read by scripts/menu-reach.mts too): Plugins ▸ Choose Claude's agent and the
 * Claude settings.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'claude.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 48, items: [
    { id: 'claude.pick', label: "Choose Claude's agent…", icon: 'user', action: 'claude.pick' },
    { id: 'claude-session-settings', label: 'Claude settings', icon: 'sparkles', action: 'settings.open:claude-session' },
  ] },
];

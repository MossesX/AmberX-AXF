/**
 * Application-menu entries (pure data: also read by apps/console-web/scripts/menu-reach.mts).
 * The plugin opens the console's **Tools** menu (top-level, created when missing; other tool plugins add to it).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const TOOLS_MENU = { menu: 'tools', menuLabel: 'Tools', menuOrder: 45 } as const;

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  {
    id: 'claude-handoff.tools', ...TOOLS_MENU, order: 10,
    items: [
      { id: 'claude-handoff', label: 'Claude handoff', icon: 'rocket', action: 'nav:claude-handoff' },
      { id: 'claude-handoff-assemble', label: 'Assemble the handoff prompt', icon: 'copy', action: 'claude-handoff.assemble' },
      { id: 'claude-handoff-publish', label: 'Publish the handoff kit', icon: 'upload', action: 'claude-handoff.publish' },
    ],
  },
  { id: 'claude-handoff.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'claude-handoff-settings', label: 'Claude handoff settings', icon: 'rocket', action: 'settings.open:claude-handoff' }] },
];

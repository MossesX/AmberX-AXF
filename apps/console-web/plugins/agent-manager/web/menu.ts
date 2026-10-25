/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  {
    id: 'agent-manager.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50,
    items: [{
      id: 'agents', label: 'Agents', icon: 'layers',
      items: [
        { id: 'manager', label: 'Agent manager', icon: 'layers', action: 'nav:agent-manager' },
        { id: 's1', separator: true },
        { id: 'new', label: 'New agent (all-in-one)…', icon: 'rocket', action: 'agent-manager.wizard:builder' },
        { id: 'new-skill', label: 'New skill…', icon: 'sparkles', action: 'agent-manager.wizard:skill' },
        { id: 'new-tool', label: 'New tool…', icon: 'zap', action: 'agent-manager.wizard:tool' },
        { id: 'new-training', label: 'New training job…', icon: 'download', action: 'agent-manager.wizard:training' },
        { id: 'vinny', label: "Vinny's commands…", icon: 'terminal', action: 'agent-manager.vinny' },
        { id: 's2', separator: true },
        { id: 'settings', label: 'Agent manager settings', icon: 'settings', action: 'settings.open:agent-manager' },
      ],
    }],
  },
];

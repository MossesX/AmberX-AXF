/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  {
    id: 'agent-voice.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 52,
    items: [{
      id: 'agent-voice', label: 'Agent voice', icon: 'mic',
      items: [
        { id: 'page', label: 'Agent voices…', icon: 'mic', action: 'agent-voice.open' },
        { id: 'settings', label: 'Microphone & cloud voices', icon: 'settings', action: 'agent-voice.settings' },
        { id: 'stop', label: 'Stop the agent talking', icon: 'x', action: 'agent-voice.stop' },
      ],
    }],
  },
  // Also under View, next to the look: the voice is part of how the app talks to you.
  { id: 'agent-voice.view', menu: 'view', menuLabel: 'View', menuOrder: 60, order: 80, items: [{ id: 'voices', label: 'Agent voices…', icon: 'mic', action: 'agent-voice.open' }] },
];

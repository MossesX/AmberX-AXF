/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  {
    id: 'ai-assistant.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50,
    items: [{
      id: 'ai-assistant', label: 'AI assistant', icon: 'sparkles',
      items: [
        { id: 'page', label: 'Chat page', icon: 'sparkles', action: 'nav:ai-assistant' },
        { id: 'window', label: 'Chat in a window', icon: 'monitor', action: 'ai-assistant.open' },
        { id: 'settings', label: 'Assistant settings', icon: 'settings', action: 'settings.open:ai-assistant' },
      ],
    }],
  },
  // Also next to Search in the Console menu: asking is often quicker than finding.
  { id: 'ai-assistant.console', menu: 'console', menuLabel: 'Console', menuOrder: 10, order: 13, items: [{ id: 'ask', label: 'Ask the assistant…', icon: 'sparkles', action: 'ai-assistant.open' }] },
];

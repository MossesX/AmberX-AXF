/**
 * Application-menu entries (pure data: scripts/menu-reach.mts reads this file too). Builds → Prompt engine opens the
 * control panel; Prompts waiting… opens straight on the waiting list; New prompt rule… opens the builder.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  {
    id: 'prompt-engine.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 62,
    items: [
      { id: 'prompt-engine', label: 'Prompt engine', icon: 'zap', action: 'nav:prompt-engine' },
      { id: 'prompt-engine.waiting', label: 'Prompts waiting…', icon: 'bell', action: 'prompt-engine.waiting' },
      { id: 'prompt-engine.new', label: 'New prompt rule…', icon: 'plus', action: 'prompt-engine.new' },
    ],
  },
];

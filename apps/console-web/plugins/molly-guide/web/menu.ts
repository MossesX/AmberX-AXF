/** Application-menu entries this plugin adds (pure data). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'molly-guide.help', menu: 'help', menuLabel: 'Help', menuOrder: 90, order: 5, items: [
    { id: 'ask', label: 'Ask Molly to show me…', icon: 'sparkles', action: 'molly.ask' },
    { id: 'last', label: 'Replay the last walkthrough', icon: 'play', action: 'molly.replay' },
  ] },
  { id: 'molly-guide.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 52, items: [{ id: 'molly-guide', label: 'Molly guide', icon: 'sparkles', action: 'settings.open:molly-guide' }] },
];

/** Application-menu entries this plugin adds (pure data). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'molly-guide.help', menu: 'help', menuLabel: 'Help', menuOrder: 90, order: 5, items: [
    { id: 'ask', label: 'Ask Gizmo to show me…', icon: 'sparkles', action: 'gizmo.ask' },
    { id: 'last', label: 'Replay the last walkthrough', icon: 'play', action: 'gizmo.replay' },
  ] },
  { id: 'molly-guide.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 52, items: [{ id: 'molly-guide', label: 'Gizmo guide', icon: 'sparkles', action: 'settings.open:molly-guide' }] },
];

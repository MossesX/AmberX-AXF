/**
 * Application-menu entries of the Voice commands plugin (pure data: the console's reachability check reads this file).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'voice-commands.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 64, items: [
    { id: 'voice-commands', label: 'Voice commands', icon: 'mic', action: 'nav:voice-commands' },
    { id: 'voice-commands.listen', label: 'Say a command…', icon: 'mic', action: 'voice-commands.listen' },
  ] },
];

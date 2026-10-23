/** Application-menu entries for Voice notes (pure data: scripts/menu-reach.mts reads this file too). Settings only. */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'voice-notes.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 55, items: [{ id: 'voice-notes', label: 'Voice notes', icon: 'mic', action: 'settings.open:voice-notes' }] },
];

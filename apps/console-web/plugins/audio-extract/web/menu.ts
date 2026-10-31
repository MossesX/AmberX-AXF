/** Application-menu entries for Audio Extract (pure data: scripts/menu-reach.mts reads this file too): its page, the two quick actions and its setup. */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'audio-extract', menu: 'axhub', items: [
    { id: 'audio-extract.page', label: 'Audio Extract', icon: 'download', action: 'nav:audio-extract' },
    { id: 'audio-extract.latest', label: 'Extract audio from last screen recording', icon: 'download', action: 'audio-extract.latest' },
    { id: 'audio-extract.record', label: 'Record screen', icon: 'monitor', action: 'audio-extract.record' },
    { id: 'audio-extract.setup', label: 'Audio Extract setup', icon: 'settings', action: 'settings.open:audio-extract' },
  ] },
];

/** Application-menu entries for the Audio Output Recorder (pure data: scripts/menu-reach.mts reads this file too): its page and its setup. */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'output-recorder', menu: 'axhub', items: [
    { id: 'output-recorder.page', label: 'Audio out', icon: 'play', action: 'nav:output-recorder' },
    { id: 'output-recorder.setup', label: 'Audio Output Recorder setup', icon: 'settings', action: 'settings.open:output-recorder' },
  ] },
];

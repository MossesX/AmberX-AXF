/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'main-build-status.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 9, items: [{ id: 'main-build', label: 'Main build', icon: 'play', items: [
    { id: 'main-build-show', label: 'Show the main build', icon: 'play', action: 'main-build-status.open' },
    { id: 'main-build-github', label: 'Open on GitHub', icon: 'external', action: 'main-build-status.github' },
    { id: 'main-build-check', label: 'Check now', icon: 'refresh', action: 'main-build-status.check' },
  ] }] },
  { id: 'main-build-status.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'main-build-status', label: 'Main build status', icon: 'play', action: 'settings.open:main-build-status' }] },
];

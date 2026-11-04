/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'build-docs.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 12, items: [{ id: 'build-docs', label: 'Docs & videos', icon: 'file', items: [
    { id: 'build-docs-open', label: 'Docs & videos', icon: 'file', action: 'nav:build-docs' },
    { id: 'build-docs-new-docs', label: 'Create documentation…', icon: 'file', action: 'build-docs.docs' },
    { id: 'build-docs-new-video', label: 'Create walkthrough video…', icon: 'play', action: 'build-docs.video' },
  ] }] },
  { id: 'build-docs.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 52, items: [{ id: 'build-docs', label: 'Build docs', icon: 'file', action: 'settings.open:build-docs' }] },
];

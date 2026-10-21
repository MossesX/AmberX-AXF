/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

/** Live list: the tabs chosen in Settings → Plugins → App tabs. */
export const TABS = 'app-tabs.tabs';

const tab = (id: string, label: string) => [{ id: 'tab', label, icon: 'layout', action: `app-tabs.show:${id}`, order: 10 }];

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'app-tabs.pilot', menu: 'apps', menuLabel: 'Apps', menuOrder: 50, path: [{ id: 'pilot', label: 'Build Pilot', icon: 'rocket' }], items: tab('build-pilot', 'Show Pilot in a tab') },
  { id: 'app-tabs.axhub', menu: 'apps', menuLabel: 'Apps', menuOrder: 50, path: [{ id: 'axhub', label: 'axHub', icon: 'layers' }], items: tab('axhub', 'Show the app catalog in a tab') },
  { id: 'app-tabs.demo', menu: 'apps', menuLabel: 'Apps', menuOrder: 50, path: [{ id: 'demo', label: 'Demo site', icon: 'smartphone' }], items: tab('axf-demo', 'Show the demo in a tab') },
  { id: 'app-tabs.menu', menu: 'apps', menuLabel: 'Apps', menuOrder: 50, order: 20, items: [
    { id: 'app-tabs-sep', separator: true },
    { id: 'console-tab', label: 'Back to the console', icon: 'terminal', action: 'app-tabs.show:axf-console-web' },
    { id: 'app-tabs', label: 'App tabs', icon: 'layout', provider: TABS },
    { id: 'app-tabs-settings', label: 'App tabs settings', icon: 'settings', action: 'app-tabs.settings' },
  ] },
  { id: 'app-tabs.plugins', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'app-tabs', label: 'App tabs', icon: 'layout', action: 'app-tabs.settings' }] },
];

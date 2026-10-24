/**
 * axHub sync console plugin (ai.amberx.axf.console.hub-sync): the framework's lib-hubsync with the console's
 * Install & uninstall panel. Settings → Plugins → axHub sync.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { hubSyncLibrary } from '@console/axf/libs/hubsync';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';

export const plugin: AxfWebLibrary = {
  ...hubSyncLibrary,
  id: 'ai.amberx.axf.console.hub-sync',
  provides: ['axf.hubsync', 'hub-sync.settings'],
  appMenu,
  settingsPanels: [
    ...(hubSyncLibrary.settingsPanels ?? []),
    { id: 'hubsync.lifecycle', tab: 'hubsync', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder="hub-sync" /> },
  ],
};

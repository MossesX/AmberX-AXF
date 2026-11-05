import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { appMenu } from './menu';
import { FOLDER, ShippedFeaturesPage, VIEW } from './ui';

/** Shipped features: every feature from planned to live, with its edits (feature-ledger@1). */
export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.shipped-features', // = plugin.json "id"
  label: 'Shipped features',
  version: '0.1.0',
  appMenu,
  views: { [VIEW]: { title: 'Shipped features', icon: 'check-circle', render: () => <ShippedFeaturesPage /> } },
  nav: { label: 'Builds', items: [{ id: VIEW, label: 'Shipped features', icon: 'check-circle', view: VIEW }] },
  settingsTabs: [{ id: FOLDER, label: 'Shipped features', icon: 'check-circle', order: 90, parent: 'plugins' }],
  settingsPanels: [{ id: `${FOLDER}.lifecycle`, tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

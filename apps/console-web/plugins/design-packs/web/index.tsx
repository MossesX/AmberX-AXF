import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { FOLDER, ID, KEYS, VIEW } from './keys';
import { DesignPacksPage } from './ui';

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Design packs',
  version: '0.1.0',
  appMenu,
  views: { [VIEW]: { title: 'Design packs', icon: 'palette', keywords: ['design', 'packs', 'look', 'theme', 'refactor', 'screenshots', 'pick'], render: () => <DesignPacksPage /> } },
  nav: { label: 'Plugins', items: [{ id: 'design-packs', label: 'Design packs', icon: 'palette', view: 'design-packs' }] },
  settingsTabs: [{ id: FOLDER, label: 'Design packs', icon: 'palette', parent: 'plugins', order: 46, description: 'Candidate design packages and your 3 picks for the look refactor.' }],
  settings: [{
    id: 'design-packs.prefs', label: 'Design packs', icon: 'palette', tab: FOLDER, order: 10,
    settings: [{ key: KEYS.thumbs, label: 'Show the screens list', kind: 'toggle', default: true, description: 'The list of screens beside (on a phone: above) the preview. Collapse it from the browser too.' }],
  }],
  settingsPanels: [{ id: 'design-packs.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { FOLDER } from './api';
import { appMenu } from './menu';
import { QuickSwitch } from './QuickSwitch';
import { SkinsScreen } from './SkinsScreen';
import './skin-gallery.css';

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.skin-gallery',
  label: 'Skins',
  version: '0.1.0',
  appMenu,
  views: { 'skin-gallery': { title: 'Skins', icon: 'palette', render: () => <SkinsScreen /> } },
  nav: { label: 'Plugins', items: [{ id: 'skin-gallery', label: 'Skins', icon: 'palette', view: 'skin-gallery' }] },
  banners: [{ id: 'skin-gallery', label: 'Quick skin switcher', icon: 'palette', settingsTab: 'skin-gallery', order: 8, render: () => <QuickSwitch /> }],
  settingsTabs: [{ id: 'skin-gallery', label: 'Skins', icon: 'palette', order: 90, parent: 'plugins' }],
  settingsPanels: [{ id: 'skin-gallery.lifecycle', tab: 'skin-gallery', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

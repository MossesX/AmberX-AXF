import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { FOLDER } from './api';
import { registerActions } from './actions';
import { addContextItems } from './contextItems';
import { appMenu } from './menu';
import { loadSettings } from './settings';
import { SkinChip } from './SkinChip';
import { SkinsScreen } from './SkinsScreen';
import { SkinsSettingsPanel } from './SkinsSettings';
import './skin-gallery.css';

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.skin-gallery',
  label: 'Skins',
  version: '0.1.0',
  // the skin-switch@1 service: Settings → Appearance runs its Use / Back / Restore / Undo through skin.* (capability check)
  provides: ['axf.skin-switch@1'],
  appMenu,
  register(rt) {
    registerActions(rt);
    addContextItems(rt);
    void loadSettings();
  },
  views: { 'skin-gallery': { title: 'Skins', icon: 'palette', render: () => <SkinsScreen /> } },
  // deep links: console_open {kind: screen, target: skin-gallery, focus: skin/<id> | scope/<scope> | preview/<id>?view=phone} (web/link.ts)
  nav: { label: 'Plugins', items: [{ id: 'skin-gallery', label: 'Skins', icon: 'palette', view: 'skin-gallery' }] },
  banners: [{ id: 'skin-gallery', label: 'Quick skin switcher', icon: 'palette', settingsTab: 'skin-gallery', order: 8, render: () => <SkinChip /> }],
  settingsTabs: [{ id: 'skin-gallery', label: 'Skins', icon: 'palette', order: 90, parent: 'plugins' }],
  settingsPanels: [
    { id: 'skin-gallery.main', tab: 'skin-gallery', title: 'Skins', icon: 'palette', order: 10, render: () => <SkinsSettingsPanel /> },{ id: 'skin-gallery.lifecycle', tab: 'skin-gallery', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

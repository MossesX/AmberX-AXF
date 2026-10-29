/**
 * Plugin Manager console plugin (ai.amberx.axf.console.plugin-manager).
 *
 * Fable rebuild (Oct 20 2026) of the Opus plugin: same id, folder, actions, settings keys and every view / layout,
 * now on the framework's plugin inventory engine (plugin-inventory@1, `core/engines/plugins.ts` = Python
 * `server/engine.py` = Kotlin `PluginInventoryEngine`), which every AXF app's Settings → Plugins tab and the Android
 * Plugin Manager share.
 *
 * Opened from the default context menu (right-click / long-press anywhere → Plugin Manager), nav → Plugins →
 * Plugin Manager, the action `plugin-manager.open`, or Settings → Plugins → Plugin Manager. The menu link, nav entry
 * and settings tab are runtime contributions (AxfWebLibrary.contextMenu / nav / settingsTabs): no asset is edited,
 * so uninstalling the plugin removes every trace of it.
 */
import { Button, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { PluginManager } from './PluginManager';
import { KEYS, LAYOUTS, VIEWS } from './prefs';
import { FOLDER } from './model';
import { appMenu } from './menu';

const ID = 'ai.amberx.axf.console.plugin-manager';

const select = (folder?: string) => {
  if (folder) queueMicrotask(() => globalThis.dispatchEvent(new CustomEvent('axp-plugin-manager:select', { detail: folder })));
};

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Plugin Manager',
  version: '0.2.0',
  appMenu,
  uiEditor: ['manager'], // = plugin.json uiEditor: the UI-editor rule (last save wins per key, fresh on focus) applies
  register(rt) {
    rt.actions.register('plugin-manager.open', ([folder]) => {
      if (folder) rt.settings.set(KEYS.selected, folder);
      rt.navigate('plugin-manager');
      select(folder);
    }, { label: 'Open the Plugin Manager' });
    rt.actions.register('plugin-manager.window', ([folder]) => {
      if (folder) rt.settings.set(KEYS.selected, folder);
      rt.openDialog('plugin-manager.window');
      select(folder);
    }, { label: 'Plugin Manager in a window' });
    rt.actions.register('plugin-manager.layout', ([id]) => { if (LAYOUTS.some((l) => l.id === id)) rt.settings.set(KEYS.layout, id!); }, { label: 'Plugin Manager layout', params: true });
    rt.actions.register('plugin-manager.view', ([id]) => { if (VIEWS.some((v) => v.id === id)) rt.settings.set(KEYS.view, id!); }, { label: 'Plugin Manager view', params: true });
    // The Install view (plugin catalog on axHub) in one step, for the app menu and search.
    rt.actions.register('plugin-manager.install', () => { rt.settings.set(KEYS.view, 'install'); rt.navigate('plugin-manager'); }, { label: 'Install plugins from the catalog' });
  },
  // design-ok: no page head — every Plugin Manager layout (Studio, Mission control, Terminal, Catalog) draws its own eyebrow + title
  views: {
    'plugin-manager': { title: 'Plugin Manager', icon: 'package', keywords: ['plugins', 'extensions', 'dependencies', 'enable', 'disable', 'uninstall'], render: () => <PluginManager /> },
  },
  dialogs: {
    'plugin-manager.window': { title: 'Plugin Manager', icon: 'package', render: () => <PluginManager embedded /> },
  },
  nav: { label: 'Plugins', items: [{ id: 'plugin-manager', label: 'Plugin Manager', icon: 'package', view: 'plugin-manager' }] },
  contextMenu: [
    // The app-wide menu (right-click / long-press on anything without its own menu).
    { id: 'plugin-manager.default', target: 'default', order: 90, items: [{ id: 'plugin-manager', label: 'Plugin Manager', icon: 'package', action: 'plugin-manager.open' }] },
    // A plugin row/card inside the manager.
    {
      id: 'plugin-manager.row', target: 'plugin-manager.row', items: [
        { id: 'details', label: 'Details', icon: 'info', action: 'plugin-manager.open:{payload}' },
        { id: 'window', label: 'Open in a window', icon: 'monitor', action: 'plugin-manager.window:{payload}' },
        { id: 's1', separator: true },
        { id: 'views', label: 'View', icon: 'grid', items: VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, action: `plugin-manager.view:${v.id}` })) },
        { id: 'layouts', label: 'Layout', icon: 'layout', items: LAYOUTS.map((l) => ({ id: l.id, label: l.label, icon: l.icon, action: `plugin-manager.layout:${l.id}` })) },
      ],
    },
  ],
  settingsTabs: [{ id: 'plugin-manager', label: 'Plugin Manager', icon: 'package', order: 5, parent: 'plugins' }],
  settings: [{
    id: 'plugin-manager.look', tab: 'plugin-manager', label: 'Layout and view', icon: 'layout', order: 10,
    settings: [
      { key: KEYS.layout, label: 'Layout', kind: 'choice', default: 'studio', options: LAYOUTS.map((l) => ({ value: l.id, label: `${l.label} — ${l.note}` })) },
      { key: KEYS.view, label: 'View', kind: 'choice', default: 'grid', options: VIEWS.map((v) => ({ value: v.id, label: v.label })) },
    ],
  }],
  settingsPanels: [
    { id: 'plugin-manager.open', tab: 'plugin-manager', title: 'Plugin Manager', icon: 'package', order: 5, render: () => <OpenPanel /> },
    { id: 'plugin-manager.lifecycle', tab: 'plugin-manager', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

function OpenPanel() {
  const rt = useRuntime();
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>Every plugin: health, enable / disable, its UI and settings, logs, files, install & uninstall, and its dependencies in detail.</p>
      <p className="fx-muted" style={{ margin: 0 }}>Also in the right-click / long-press menu anywhere in the console.</p>
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="package" onClick={() => rt.dispatch('plugin-manager.open')}>Open the Plugin Manager</Button>
      </div>
    </div>
  );
}

import type { AxfWebLibrary } from '@console/axf/react/library';
import type { AxfRuntime } from '@console/axf/core';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, ID, call, type SavedTheme } from './api';
import { ThemeManager, lastApplied } from './ThemeManager';
import './theme-manager.css';
import { appMenu } from './menu';

/*
 * Theme manager (web part): nav → Plugins → Theme manager, and Settings → Plugins → Themes. On start it registers
 * the saved themes (standard asset@1 files from its data folder) and re-applies the ones you picked last.
 * Actions: theme-manager.open. It only uses the existing asset types and engines; built-in themes are never touched.
 */
let loaded = false;
async function loadSaved(rt: AxfRuntime) {
  if (loaded) return;
  loaded = true;
  try {
    const r = await call<{ items: SavedTheme[] }>('themes');
    for (const a of r.items) rt.registry.register(a, 'imported', 'theme-manager');
    // Developer app with the look on axHub: the hub document is the truth, so only make the saved themes available
    // (an id it names now resolves) and let the runtime re-apply the document; without a source, re-apply the local pick.
    if (rt.hasAppearanceSource()) { rt.refreshFromSaved(); return; }
    for (const [type, id] of Object.entries(lastApplied())) {
      if (rt.registry.has(type as never, id) && (rt.getState().active as Record<string, string>)[type] !== id) rt.swap(type as never, id);
    }
  } catch { loaded = false; }
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Theme manager',
  version: '0.1.0',
  appMenu,
  provides: ['axf.theme-manager'],
  register(rt) {
    void loadSaved(rt);
    rt.actions.register('theme-manager.open', () => rt.navigate('theme-manager'), { label: 'Open the theme manager' });
  },
  views: { 'theme-manager': { title: 'Theme manager', icon: 'palette', keywords: ['roll', 'theme', 'colors', 'tokens'], render: () => <div className="fx-stack fx-stack--lg"><header className="fx-pagehead"><div><p className="fx-eyebrow">Plugin</p><h1>Theme manager</h1></div></header><ThemeManager /></div> } },
  nav: { label: 'Plugins', items: [{ id: 'theme-manager', label: 'Theme manager', icon: 'palette', view: 'theme-manager' }] },
  settingsTabs: [{ id: 'theme-manager', label: 'Themes', icon: 'palette', parent: 'plugins', order: 44, description: 'Roll colour, style and layout themes (or any themeable part), pick which tokens change, save rolls as assets.' }],
  settingsPanels: [
    { id: 'theme-manager.main', tab: 'theme-manager', title: 'Theme manager', icon: 'palette', order: 10, render: () => <ThemeManager /> },
    { id: 'theme-manager.lifecycle', tab: 'theme-manager', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

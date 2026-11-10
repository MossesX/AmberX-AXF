import type { AxfWebLibrary } from '@console/axf/react/library';
import type { AxfRuntime } from '@console/axf/core';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { AppearancePanel } from '@console/axf/libs/settings';
import { FOLDER, ID, call, type SavedTheme } from './api';
import { ThemeManager, lastApplied } from './ThemeManager';
import './theme-manager.css';
import { appMenu } from './menu';
import { buildTree, getAt, leaves, setAt } from './rollEngine';

/*
 * Theme manager (web part): nav → Plugins → Theme manager, and Settings → Plugins → Themes. On start it registers
 * the saved themes (standard asset@1 files from its data folder) and re-applies the ones you picked last.
 * Actions: theme-manager.open. It only uses the existing asset types and engines; built-in themes are never touched.
 * Capability `axf.token-tree@1` (web): the token tree (buildTree / leaves / getAt / setAt) for other plugins, e.g. the
 * Theme editor, published on `globalThis.__axfWebServices` while this plugin is loaded (no plugin imports another's folder).
 */
export const TOKEN_TREE = 'axf.token-tree@1';
const services = () => ((globalThis as { __axfWebServices?: Record<string, unknown> }).__axfWebServices ??= {});
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
  version: '0.2.0',
  appMenu,
  provides: ['axf.theme-manager', TOKEN_TREE],
  register(rt) {
    services()[TOKEN_TREE] = { version: 1, buildTree, leaves, getAt, setAt };
    void loadSaved(rt);
    rt.actions.register('theme-manager.open', () => rt.navigate('theme-manager'), { label: 'Open the theme manager' });
  },
  views: { 'theme-manager': { title: 'Theme manager', icon: 'palette', keywords: ['roll', 'theme', 'colors', 'tokens'], render: () => <div className="fx-stack fx-stack--lg"><header className="fx-pagehead"><div><p className="fx-eyebrow">Design &amp; branding</p><h1>Theme manager</h1><p className="fx-muted" title="Roll colour, style and layout themes from a token tree, preview them live and save the ones you like as themes.">Roll themes from a token tree, preview live, save the keepers.</p></div></header><AppearancePanel /><ThemeManager /></div> } },
  nav: { label: 'Plugins', items: [{ id: 'theme-manager', label: 'Theme manager', icon: 'palette', view: 'theme-manager' }] },
  settingsTabs: [{ id: 'theme-manager', label: 'Themes', icon: 'palette', parent: 'plugins', order: 44, description: 'Roll colour, style and layout themes (or any themeable part), pick which tokens change, save rolls as assets.' }],
  settingsPanels: [
    { id: 'theme-manager.appearance', tab: 'theme-manager', title: 'Appearance', icon: 'palette', order: 5, render: () => <AppearancePanel /> },
    { id: 'theme-manager.main', tab: 'theme-manager', title: 'Theme manager', icon: 'palette', order: 10, render: () => <ThemeManager /> },
    { id: 'theme-manager.lifecycle', tab: 'theme-manager', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

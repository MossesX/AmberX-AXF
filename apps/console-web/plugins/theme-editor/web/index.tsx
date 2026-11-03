import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, ID } from './api';
import { ThemeEditor, UNSET_KEY, VIEW_KEY, VIEWS } from './ThemeEditor';
import { appMenu } from './menu';
import './theme-editor.css';

/*
 * Theme editor (web part): nav → Plugins → Theme editor, and Settings → Plugins → Theme editor. Edits colour and
 * style themes token by token; saves are standard asset@1 themes applied through the hub look. The token tree comes
 * from the Theme manager (capability axf.token-tree@1); without it the editor says so. Actions: theme-editor.open.
 */
export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Theme editor',
  version: '0.1.0',
  appMenu,
  dependsOn: [],
  uiEditor: ['theme', 'style'],
  register(rt) {
    rt.actions.register('theme-editor.open', () => rt.navigate('theme-editor'), { label: 'Open the theme editor' });
  },
  views: { 'theme-editor': { title: 'Theme editor', icon: 'edit', keywords: ['theme', 'colours', 'style', 'tokens', 'edit'], render: () => <div className="fx-stack fx-stack--lg"><header className="fx-pagehead"><div><p className="fx-eyebrow">Design &amp; branding</p><h1>Theme editor</h1><p className="fx-muted" title="Edit every colour and style token, copy a theme, save it as an asset and load any theme. Saves apply in every app through the hub look.">Edit every token, copy, save and load themes.</p></div></header><ThemeEditor /></div> } },
  nav: { label: 'Plugins', items: [{ id: 'theme-editor', label: 'Theme editor', icon: 'edit', view: 'theme-editor' }] },
  settingsTabs: [{ id: 'theme-editor', label: 'Theme editor', icon: 'edit', parent: 'plugins', order: 45, description: 'Edit colour and style themes token by token; copy, save and load them.' }],
  settings: [
    { id: 'theme-editor.prefs', label: 'Theme editor', icon: 'edit', tab: 'theme-editor', order: 5, settings: [
      { key: VIEW_KEY, label: 'Starting view', kind: 'choice', default: 'tree', options: VIEWS.map((v) => ({ value: v.value, label: v.label })) },
      { key: UNSET_KEY, label: 'List tokens the theme doesn\'t set', description: 'Show every token the asset types and other themes know, even when this theme leaves it out.', kind: 'toggle', default: true },
    ] },
  ],
  settingsPanels: [
    { id: 'theme-editor.main', tab: 'theme-editor', title: 'Theme editor', icon: 'edit', order: 10, render: () => <ThemeEditor /> },
    { id: 'theme-editor.lifecycle', tab: 'theme-editor', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

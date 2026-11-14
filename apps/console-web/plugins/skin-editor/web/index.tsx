/*
 * Skin editor plugin (web part): the Token registry page, the Skin editor page, the actions the API and voice reach
 * (skin-editor.open, skin-editor.pick, token-registry.open), a settings sub-tab under Settings → Plugins.
 *
 * Reach it without the UI: console-control `view:skin-editor` / `view:token-registry` (console_show), the actions
 * (console.actions run `skin-editor.open:view:home`), the plugin's commands (REST /api/control/skin-editor/<command>,
 * MCP skin-editor_<command>, CLI `axf skin-editor <command>`), and voice through its `voice` command.
 */
import { useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, ID } from './api';
import { appMenu } from './menu';
import { RegistryView } from './Registry';
import { SkinEditorView } from './SkinEditor';
import { UI_KEY, uiOf } from './model';
import './skin-editor.css';

function SettingsPanel() {
  const rt = useRuntime();
  return (
    <div className="fx-stack">
      <p className="fx-muted">The Skin editor keeps one snapshot chain per picked UI and the skins you export in its data folder. Open it from Plugins → Skin editor, or pick any screen on screen.</p>
      <p>Last picked UI: <code>{String(rt.settings.get(UI_KEY) ?? 'none')}</code></p>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Skin editor',
  version: '0.1.0',
  appMenu,
  register(rt) {
    // skin-editor.open[:<kind>:<id> | :token:<token id>] — open the editor, optionally on a UI or a token
    rt.actions.register('skin-editor.open', (args) => {
      rt.navigate('skin-editor');
      if (args.length) window.setTimeout(() => rt.dispatch(`skin-editor.load:${args.join(':')}`), 50);
    }, { label: 'Skin editor: open (optionally on a UI or token)', params: true });
    rt.actions.register('token-registry.open', () => rt.navigate('token-registry'), { label: 'Token registry: browse every token' });
    // skin-editor.pick — the next click anywhere in the console picks that screen into the sandbox
    rt.actions.register('skin-editor.pick', () => {
      rt.toast('Click any screen or control to load it into the Skin editor (Esc cancels)', 'info', 'Skin editor');
      document.documentElement.style.cursor = 'crosshair';
      const done = () => { document.documentElement.style.cursor = ''; document.removeEventListener('click', onClick, true); document.removeEventListener('keydown', onKey, true); };
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); done(); } };
      const onClick = (e: MouseEvent) => {
        e.preventDefault(); e.stopPropagation(); done();
        const target = e.target as Element | null;
        const picked = uiOf(target, (id) => rt.uiRenderers.views[id]?.title ?? id);
        const current = rt.getState().view;
        const view = picked?.id && picked.id !== 'skin-editor' ? picked : { kind: 'view' as const, id: current, label: rt.uiRenderers.views[current]?.title ?? current };
        rt.settings.set(UI_KEY, JSON.stringify(view));
        rt.navigate('skin-editor');
        window.setTimeout(() => rt.dispatch(`skin-editor.load:${view.kind}:${view.id}`), 50);
      };
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
    }, { label: 'Skin editor: pick a UI on screen' });
  },
  views: {
    'skin-editor': { title: 'Skin editor', icon: 'palette', keywords: ['skin', 'tokens', 'theme', 'sandbox', 'snapshot', 'revert', 'export'], render: () => <SkinEditorView /> },
    'token-registry': { title: 'Token registry', icon: 'list', keywords: ['tokens', 'registry', '--fx', 'colour', 'style', 'layout'], render: () => <RegistryView /> },
  },
  nav: { label: 'Plugins', items: [{ id: 'skin-editor', label: 'Skin editor', icon: 'palette', view: 'skin-editor' }, { id: 'token-registry', label: 'Token registry', icon: 'list', view: 'token-registry' }] },
  settingsTabs: [{ id: 'skin-editor', label: 'Skin editor', icon: 'palette', order: 85, parent: 'plugins' }],
  settingsPanels: [
    { id: 'skin-editor.about', tab: 'skin-editor', title: 'Skin editor', icon: 'palette', order: 10, render: () => <SettingsPanel /> },
    { id: 'skin-editor.lifecycle', tab: 'skin-editor', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

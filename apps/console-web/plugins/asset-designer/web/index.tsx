import { Button, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { assetTypeSpecs } from '@console/axf/core';
import { FOLDER, ID, VIEW, loadSaved } from './api';
import { Designer, LIVE_KEY, TYPE_KEY } from './Designer';
import { setIntent } from './intent';
import { typeOptions, type Spec } from './model';
import { appMenu } from './menu';
import './asset-designer.css';

/*
 * Asset designer (web part): nav → Plugins → Asset designer; Settings → Plugins → Asset designer. One designer for
 * every asset type the registry knows, built from the type's own fields, with the validation gate, a live preview on the
 * real chrome, the designed@1 manifest and the chrome settings interface of toolbars, tab groups, banners and menus.
 * On start every saved asset is registered into the runtime (origin asset-designer) so slots and pickers see it.
 * Actions (console, MCP, CLI, voice): asset-designer.open | .new:<type> | .edit:<type>:<id> | .chrome:<type> | .reload.
 */
export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Asset designer',
  version: '0.3.0',
  appMenu,
  uiEditor: ['builder'],
  register(rt) {
    void loadSaved(rt);
    rt.actions.register('asset-designer.open', () => rt.navigate(VIEW), { label: 'Open the asset designer' });
    rt.actions.register('asset-designer.new', ([type]) => { setIntent({ type: String(type ?? 'toolbar') }); rt.navigate(VIEW); }, { label: 'New asset in the designer (asset-designer.new:<type>)', params: true });
    rt.actions.register('asset-designer.edit', ([type, id]) => { setIntent({ type: String(type ?? ''), id: String(id ?? '') }); rt.navigate(VIEW); }, { label: 'Edit a designed asset (asset-designer.edit:<type>:<id>)', params: true });
    rt.actions.register('asset-designer.chrome', ([type]) => { setIntent({ chrome: String(type ?? 'toolbar') }); rt.navigate(VIEW); }, { label: 'Edit a chrome settings interface (asset-designer.chrome:<type>)', params: true });
    rt.actions.register('asset-designer.reload', () => { void loadSaved(rt); }, { label: 'Reload the designed assets into the console' });
  },
  views: {
    [VIEW]: {
      title: 'Asset designer',
      icon: 'edit',
      keywords: ['asset', 'designer', 'toolbar', 'tab group', 'menu', 'theme', 'layout', 'settings interface', 'chrome', 'no-code'],
      render: () => (
        <div className="fx-stack fx-stack--lg">
          <header className="fx-pagehead"><div><p className="fx-eyebrow">Design &amp; branding</p><h1>Asset designer</h1><p className="fx-muted" title="Design any asset type without code: every field of the type, a JSON view, a live preview and the validation gate. Saved assets are standard asset@1 files with a designed@1 manifest.">Every asset type, every field, validated before it is saved.</p></div></header>
          <Designer />
        </div>
      ),
    },
  },
  nav: { label: 'Plugins', items: [{ id: VIEW, label: 'Asset designer', icon: 'edit', view: VIEW }] },
  contextMenu: [
    { id: 'asset-designer.default', target: 'default', order: 94, items: [{ id: 'asset-designer', label: 'Design an asset…', icon: 'edit', action: 'asset-designer.open' }] },
  ],
  settingsTabs: [{ id: FOLDER, label: 'Asset designer', icon: 'edit', order: 46, parent: 'plugins', description: 'Design any asset type without code; every save passes the framework validator.' }],
  settings: [
    { id: 'asset-designer.prefs', label: 'Asset designer', icon: 'edit', tab: FOLDER, order: 5, settings: [
      { key: TYPE_KEY, label: 'Starting asset type', kind: 'choice', default: 'toolbar', options: typeOptions(assetTypeSpecs as unknown as Spec).map((o) => ({ value: o.value, label: o.label })) },
      { key: LIVE_KEY, label: 'Live preview', description: 'Put the draft on the real chrome while it is valid (the previous asset comes back when it is turned off).', kind: 'toggle', default: false },
    ] },
  ],
  settingsPanels: [
    { id: 'asset-designer.open', tab: FOLDER, title: 'Designer', icon: 'edit', order: 10, render: () => <OpenPanel /> },
    { id: 'asset-designer.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

function OpenPanel() {
  const rt = useRuntime();
  return (
    <div className="fx-stack">
      <p className="fx-muted" style={{ margin: 0 }}>Designed assets are saved on the console server as standard asset@1 files and registered in every browser.</p>
      <div className="fx-row">
        <Button size="sm" icon="edit" onClick={() => rt.dispatch('asset-designer.open')}>Open the designer</Button>
        <Button size="sm" icon="settings" onClick={() => rt.dispatch('asset-designer.chrome:toolbar')}>Toolbar settings interface</Button>
        <Button size="sm" icon="layers" onClick={() => rt.dispatch('asset-designer.chrome:tab-group')}>Tab group settings interface</Button>
      </div>
    </div>
  );
}

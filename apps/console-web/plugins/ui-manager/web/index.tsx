import { Button, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { FOLDER, Manager } from './Manager';
import { TAB_KIND, closeUiManager, openUiManager } from './window';
import './ui-manager.css';

/*
 * UI Manager (web part). The manager lives in one floating window (tab kind `ui-manager`): View → Look → UI Manager…,
 * Plugins → UI Manager, the action `ui-manager.open`, or the page (nav → Plugins → UI Manager), which opens the window
 * and also shows the same manager inline. Everything it does is on the server part too (REST / MCP / CLI).
 */
function UiManagerPage() {
  const rt = useRuntime();
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">Plugin</p><h1>UI Manager</h1><p className="fx-muted">Select any element in the console and change its properties and tokens from predetermined values.</p></div>
        <div className="fx-row"><Button icon="external" onClick={() => openUiManager(rt)}>Open in a floating window</Button></div>
      </header>
      <Manager />
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.ui-manager', // must equal plugin.json "id"
  label: 'UI Manager',
  version: '0.2.0',
  appMenu,
  register(rt) {
    rt.actions.register('ui-manager.open', () => openUiManager(rt), { label: 'Open the UI Manager (floating window)' });
    rt.actions.register('ui-manager.close', () => closeUiManager(rt), { label: 'Close the UI Manager window' });
  },
  tabs: { [TAB_KIND]: () => <Manager /> },
  views: { 'ui-manager': { title: 'UI Manager', icon: 'sliders', keywords: ['ui manager', 'element', 'tokens', 'inspector', 'properties'], render: () => <UiManagerPage /> } },
  nav: { label: 'Plugins', items: [{ id: 'ui-manager', label: 'UI Manager', icon: 'sliders', view: 'ui-manager' }] },
  settingsTabs: [{ id: 'ui-manager', label: 'UI Manager', icon: 'sliders', order: 90, parent: 'plugins' }],
  settingsPanels: [
    { id: 'ui-manager.open', tab: 'ui-manager', title: 'UI Manager', icon: 'sliders', order: 10, render: () => <OpenPanel /> },
    { id: 'ui-manager.lifecycle', tab: 'ui-manager', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

function OpenPanel() {
  const rt = useRuntime();
  return <div className="fx-row"><Button size="sm" icon="sliders" onClick={() => rt.dispatch('ui-manager.open')}>Open the UI Manager</Button></div>;
}

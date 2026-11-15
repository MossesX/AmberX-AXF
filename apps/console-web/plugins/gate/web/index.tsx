/**
 * Gate & rules (console plugin, gate-rules@1): Builds → Gate & rules (`view:gate`) and Settings → Plugins → Gate.
 * Every press goes through the plugin's REST routes (server/routes.py), the same calls the CLI and MCP make.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { registerGateActions } from './actions';
import { FOLDER } from './api';
import { GateView, PLUGIN_ID } from './GateView';
import { appMenu } from './menu';

export const plugin: AxfWebLibrary = {
  id: PLUGIN_ID, // must equal plugin.json "id"
  label: 'Gate & rules',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-15' },
  appMenu,
  views: { gate: { title: 'Gate & rules', icon: 'shield', render: () => <GateView /> } },
  nav: { label: 'Builds', items: [{ id: 'gate', label: 'Gate & rules', icon: 'shield', view: 'gate' }] },
  settingsTabs: [{ id: FOLDER, label: 'Gate', icon: 'shield', order: 60, parent: 'plugins' }],
  settingsPanels: [{ id: 'gate.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
  register(rt) { registerGateActions(rt); },
};

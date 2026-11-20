/**
 * Gate & rules (console plugin, gate-rules@1): Builds → Gate & rules (`view:gate`) and Settings → Plugins → Gate.
 * Every press goes through the plugin's REST routes (server/routes.py), the same calls the CLI and MCP make.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { registerGateActions } from './actions';
import { FOLDER } from './api';
import { BUILD_RULE_DIALOG, BuildRuleDialog } from './BuildRuleDialog';
import { CHECK_PR_DIALOG, CheckPrDialog } from './CheckPrDialog';
import { AutoLanderSettings } from './AutoLanderSettings';
import { GateScreenLinks, GateSettings } from './GateSettings';
import { BuildSlotsSettings } from './BuildSlotsSettings';
import { GateView, PLUGIN_ID } from './GateView';
import { appMenu } from './menu';
import { VIEW_KEY } from './rows';
import { registerSettingTargets } from './settingsStore';

export const plugin: AxfWebLibrary = {
  id: PLUGIN_ID, // must equal plugin.json "id"
  label: 'Gate & rules',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-15' },
  appMenu,
  views: { gate: { title: 'Gate & rules', icon: 'shield', render: () => <GateView /> } },
  dialogs: {
    [CHECK_PR_DIALOG]: { title: 'Check a PR', icon: 'search', render: (props) => <CheckPrDialog pr={String(props.pr ?? '')} />, searchable: false },
    [BUILD_RULE_DIALOG]: { title: 'Build rule', icon: 'list', render: (props) => <BuildRuleDialog id={String(props.id ?? props.arg ?? '')} onSaved={typeof props.onSaved === 'function' ? (props.onSaved as () => void) : undefined} />, searchable: false },
  },
  nav: { label: 'Builds', items: [{ id: 'gate', label: 'Gate & rules', icon: 'shield', view: 'gate' }] },
  settingsTabs: [{ id: FOLDER, label: 'Gate', icon: 'shield', order: 60, parent: 'plugins' }],
  settings: [{
    id: 'gate.look', tab: FOLDER, label: 'Lists', icon: 'list', order: 20, description: 'How the Rules, Auto-lander and History lists are drawn.',
    settings: [{ key: VIEW_KEY, label: 'Show the lists as', kind: 'choice', default: '', scope: 'app', options: [{ value: '', label: 'Follow the skin (one or two lines a row)' }, { value: 'grid', label: 'Grid, two lines a row' }, { value: 'cards', label: 'Cards' }, { value: 'compact', label: 'Compact grid, one line a row' }], description: 'Grid shows each title with its detail under it; cards read best on a phone; compact fits the most rows.' }],
  }],
  settingsPanels: [
    { id: 'gate.settings', tab: FOLDER, title: 'Gate & rules', icon: 'shield', order: 10, render: () => <GateSettings /> },
    { id: 'gate.build-slots', tab: FOLDER, title: 'Builds at once', icon: 'layers', order: 15, render: () => <BuildSlotsSettings /> },
    { id: 'gate.auto-lander', tab: FOLDER, title: 'Server auto-lander', icon: 'monitor', order: 20, render: () => <AutoLanderSettings /> },
    // Build rules and the auto-lander keep their controls on the Gate screen; the sub-tab links straight into them
    { id: 'gate.screen-links', tab: FOLDER, title: 'On the Gate screen', icon: 'link', order: 30, render: () => <GateScreenLinks /> },
    { id: 'gate.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  register(rt) { registerGateActions(rt); registerSettingTargets(rt); },
};

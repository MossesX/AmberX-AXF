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
import { GateScreenLinks, GateSettings } from './GateSettings';
import { GateView, PLUGIN_ID } from './GateView';
import { appMenu } from './menu';
import { VIEW_KEY } from './rows';
import { LimitsTab } from './LimitsTab';
import { registerSettingTargets } from './settingsStore';

export const plugin: AxfWebLibrary = {
  id: PLUGIN_ID, // must equal plugin.json "id"
  label: 'Gate & rules',
  version: '0.2.0',
  builtWith: { model: 'fable', builtAt: '2026-11-21' },
  appMenu,
  views: { gate: { title: 'Gate & rules', icon: 'shield', render: () => <GateView /> } },
  dialogs: {
    [CHECK_PR_DIALOG]: { title: 'Check a PR', icon: 'search', render: (props) => <CheckPrDialog pr={String(props.pr ?? '')} />, searchable: false },
    [BUILD_RULE_DIALOG]: { title: 'Build rule', icon: 'list', render: (props) => <BuildRuleDialog id={String(props.id ?? props.arg ?? '')} onSaved={typeof props.onSaved === 'function' ? (props.onSaved as () => void) : undefined} />, searchable: false },
  },
  nav: { label: 'Builds', items: [{ id: 'gate', label: 'Gate & rules', icon: 'shield', view: 'gate' }] },
  settingsTabs: [{ id: FOLDER, label: 'Gate', icon: 'shield', order: 60, parent: 'plugins' }],
  settings: [{
    id: 'gate.look', tab: FOLDER, label: 'Lists', icon: 'list', order: 20, description: 'How the lists on the Gate screen are drawn.',
    settings: [{ key: VIEW_KEY, label: 'Show the lists as', kind: 'choice', default: '', scope: 'app', options: [{ value: '', label: 'Follow the skin (one or two lines a row)' }, { value: 'grid', label: 'Rows, two lines each' }, { value: 'cards', label: 'Cards' }, { value: 'compact', label: 'Compact rows, one line each' }], description: 'Two lines show each title with its detail under it; cards sit side by side on a wide screen; compact fits the most rows.' }],
  }],
  settingsPanels: [
    { id: 'gate.settings', tab: FOLDER, title: 'Gate & rules', icon: 'shield', order: 10, render: () => <GateSettings /> },
    { id: 'gate.auto-lander', tab: FOLDER, title: 'Lander limits', icon: 'sliders', order: 20, render: () => <LimitsTab flat /> },
    // the gates, rules and lander are edited on the Gate screen; the sub-tab links straight into its tabs
    { id: 'gate.screen-links', tab: FOLDER, title: 'On the Gate screen', icon: 'link', order: 30, render: () => <GateScreenLinks /> },
    { id: 'gate.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  register(rt) { registerGateActions(rt); registerSettingTargets(rt); },
};

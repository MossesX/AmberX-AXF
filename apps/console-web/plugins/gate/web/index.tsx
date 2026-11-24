/**
 * VPS Configuration (console plugin, gate-rules@1): Builds → VPS Configuration (`view:gate`, also `view:vps-configuration`; named Gate & rules until Nov 21 2026) and Settings → Plugins → VPS Configuration.
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
import { GateAlias, GateView, PLUGIN_ID, VIEW_ALIAS } from './GateView';
import { appMenu } from './menu';
import { VIEW_KEY } from './rows';
import { registerSettingTargets } from './settingsStore';
import { registerBuildCap } from './buildCapState';
import { registerModelTriage } from './modelTriageState';
import { registerApprovals } from './approvalRulesState';
import { registerPasses } from './passesState';

export const plugin: AxfWebLibrary = {
  id: PLUGIN_ID, // must equal plugin.json "id"
  label: 'VPS Configuration',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-15' },
  appMenu,
  // `view:gate` is the screen (the address every toolbar, link and fixture already uses); `view:vps-configuration` is
  // its address under the new name and opens the same screen.
  views: {
    gate: { title: 'VPS Configuration', icon: 'shield', render: () => <GateView />, keywords: ['vps configuration', 'vps config', 'gate and rules', 'gate & rules', 'gate', 'rules', 'build cap', 'model triage', 'fable or opus', 'approval rules', 'veto countdown', 'veto passes', 'passes', 'auto-lander'] },
    [VIEW_ALIAS]: { title: 'VPS Configuration', icon: 'shield', render: () => <GateAlias /> },
    // the pages of the axHub passes plugin, folded into the Passes tab (Nov 21 2026): their addresses open it, so the
    // hub pages' own links (`go(rt, 'passes')`), old `#/passes` links and saved shortcuts still land
    'axhub-passes': { title: 'Passes', icon: 'clock', keywords: ['pass', 'veto', 'allow', 'timer'], render: () => <GateAlias tab="passes" passTab="hub" /> },
    'axhub-go-pass': { title: 'Go pass', icon: 'check', keywords: ['go', 'pass', 'session', 'rules', 'threads'], render: () => <GateAlias tab="passes" passTab="go" /> },
  },
  dialogs: {
    [CHECK_PR_DIALOG]: { title: 'Check a PR', icon: 'search', render: (props) => <CheckPrDialog pr={String(props.pr ?? '')} />, searchable: false },
    [BUILD_RULE_DIALOG]: { title: 'Build rule', icon: 'list', render: (props) => <BuildRuleDialog id={String(props.id ?? props.arg ?? '')} onSaved={typeof props.onSaved === 'function' ? (props.onSaved as () => void) : undefined} />, searchable: false },
  },
  nav: { label: 'Builds', items: [{ id: 'gate', label: 'VPS Configuration', icon: 'shield', view: 'gate' }] },
  settingsTabs: [{ id: FOLDER, label: 'VPS Configuration', icon: 'shield', order: 60, parent: 'plugins' }],
  settings: [{
    id: 'gate.look', tab: FOLDER, label: 'Lists', icon: 'list', order: 20, description: 'How the Rules, Auto-lander and History lists are drawn.',
    settings: [{ key: VIEW_KEY, label: 'Show the lists as', kind: 'choice', default: '', scope: 'app', options: [{ value: '', label: 'Follow the skin (one or two lines a row)' }, { value: 'grid', label: 'Grid, two lines a row' }, { value: 'cards', label: 'Cards' }, { value: 'compact', label: 'Compact grid, one line a row' }], description: 'Grid shows each title with its detail under it; cards read best on a phone; compact fits the most rows.' }],
  }],
  settingsPanels: [
    { id: 'gate.settings', tab: FOLDER, title: 'VPS Configuration', icon: 'shield', order: 10, render: () => <GateSettings /> },
    { id: 'gate.auto-lander', tab: FOLDER, title: 'Server auto-lander', icon: 'monitor', order: 20, render: () => <AutoLanderSettings /> },
    // Build rules and the auto-lander keep their controls on the VPS Configuration screen; the sub-tab links straight into them
    { id: 'gate.screen-links', tab: FOLDER, title: 'On the VPS Configuration screen', icon: 'link', order: 30, render: () => <GateScreenLinks /> },
    { id: 'gate.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  register(rt) { registerGateActions(rt); registerSettingTargets(rt); registerBuildCap(rt); registerModelTriage(rt); registerApprovals(rt); registerPasses(rt); },
};

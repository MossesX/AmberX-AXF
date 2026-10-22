import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, ID } from './api';
import { AddonsTab, AgentManagerView } from './views';
import { WIZARDS, WizardDialog } from './wizards';
import { MemoryDefaultsPanel, ModelPanel, SafetyPanel, TrainingPanel, WizardsPanel } from './settings';
import './agent-manager.css';
import { appMenu } from './menu';

/*
 * Agent manager plugin (web part) — see server/__init__.py for the model.
 *  - view "agent-manager" (nav → Plugins → Agent manager)
 *  - dialog "agent-manager.wizard" { kind: builder | agent | skill | tool | training, agentId? } — open it from anywhere
 *  - Settings → Plugins → Agent manager: wizards, add-ons, model, training & Firecrawl, memory defaults, install & uninstall
 * The AI assistant chats as these agents through the server's axf.agents@1 service; nothing here names that plugin.
 */
export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Agent manager',
  version: '0.2.0',
  appMenu,
  provides: ['axf.agent-manager'],
  register(rt) {
    rt.actions.register('agent-manager.wizard', ([kind]) => rt.openDialog('agent-manager.wizard', { kind: kind && WIZARDS[kind] ? kind : 'builder' }), { label: 'Open an agent manager wizard' });
  },
  views: { 'agent-manager': { title: 'Agent manager', icon: 'layers', render: () => <AgentManagerView /> } },
  dialogs: {
    'agent-manager.wizard': {
      title: 'Agent manager',
      icon: 'rocket',
      render: (props, close) => <WizardDialog kind={String(props.kind ?? 'builder')} agentId={props.agentId ? String(props.agentId) : undefined} close={close} />,
    },
  },
  nav: { label: 'Plugins', items: [{ id: 'agent-manager', label: 'Agent manager', icon: 'layers', view: 'agent-manager' }] },
  settingsTabs: [{ id: 'agent-manager', label: 'Agent manager', icon: 'layers', order: 32, description: 'Wizards, add-on agents, models, training (Firecrawl), safety and memory defaults for the agent manager (agent-definition@1).' }],
  settingsPanels: [
    { id: 'agent-manager.wizards', tab: 'agent-manager', title: 'Wizards', icon: 'rocket', order: 10, render: () => <WizardsPanel /> },
    { id: 'agent-manager.addons', tab: 'agent-manager', title: 'Add-on agents', icon: 'package', order: 20, render: () => <div className="axp-agent-manager"><AddonsTab /></div> },
    { id: 'agent-manager.model', tab: 'agent-manager', title: 'Model', icon: 'sparkles', order: 30, render: () => <ModelPanel /> },
    { id: 'agent-manager.training', tab: 'agent-manager', title: 'Training & Firecrawl', icon: 'download', order: 40, render: () => <TrainingPanel /> },
    { id: 'agent-manager.safety', tab: 'agent-manager', title: 'Safety: dangerous tools', icon: 'shield', order: 45, render: () => <SafetyPanel /> },
    { id: 'agent-manager.memory', tab: 'agent-manager', title: 'Memory defaults', icon: 'layers', order: 50, render: () => <MemoryDefaultsPanel /> },
    { id: 'agent-manager.lifecycle', tab: 'agent-manager', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

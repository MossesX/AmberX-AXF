import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, SwarmCostChip, SwarmPage } from './ui';

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.agent-swarm',
  label: 'Agent swarm',
  version: '0.1.0',
  views: { 'agent-swarm': { title: 'Agent swarm', icon: 'user', keywords: ['swarm', 'agents', 'jobs', 'leases', 'cost', 'tokens', 'headless'], render: () => <SwarmPage /> } },
  nav: { label: 'Builds', items: [{ id: 'agent-swarm', label: 'Agent swarm', icon: 'user', view: 'agent-swarm' }] },
  // the orchestrator's (and every Builds page's) toolbar shows what the swarm has spent
  slots: { 'builds.toolbar': [{ id: 'agent-swarm.cost', order: 30, render: () => <SwarmCostChip /> }] },
  settingsTabs: [{ id: 'agent-swarm', label: 'Agent swarm', icon: 'user', order: 91, parent: 'plugins' }],
  settingsPanels: [{ id: 'agent-swarm.lifecycle', tab: 'agent-swarm', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

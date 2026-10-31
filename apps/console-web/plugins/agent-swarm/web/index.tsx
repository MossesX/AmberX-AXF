import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, SwarmCostChip, SwarmPage } from './ui';
import { COLOR_BY_VIBE_ACTION, KEYS } from './chat-settings';
import { VIBE_COLORS } from './swarm-core.mjs';

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.agent-swarm',
  label: 'Agent swarm',
  version: '0.1.0',
  register(rt) {
    rt.actions.register(COLOR_BY_VIBE_ACTION, () => rt.settings.set(KEYS.colorByVibe, !rt.settings.get(KEYS.colorByVibe)), { label: 'Color chat messages by vibe' });
  },
  views: { 'agent-swarm': { title: 'Agent swarm', icon: 'user', keywords: ['swarm', 'agents', 'jobs', 'leases', 'cost', 'tokens', 'headless'], render: () => <SwarmPage /> } },
  nav: { label: 'Builds', items: [{ id: 'agent-swarm', label: 'Agent swarm', icon: 'user', view: 'agent-swarm' }] },
  // the orchestrator's (and every Builds page's) toolbar shows what the swarm has spent
  slots: { 'builds.toolbar': [{ id: 'agent-swarm.cost', order: 30, render: () => <SwarmCostChip /> }] },
  // the chat window's right-click menu: Color by vibe, with its check mark
  contextMenu: [{ id: 'agent-swarm.chat', target: 'agent-swarm-chat', items: [{ id: 'agent-swarm.color-by-vibe', label: 'Color by vibe', icon: 'palette', action: COLOR_BY_VIBE_ACTION, checked: `setting:${KEYS.colorByVibe}` }] }],
  settings: [{
    id: 'agent-swarm.chat', label: 'Group chat', icon: 'palette', tab: FOLDER, order: 10,
    settings: [
      { key: KEYS.colorByVibe, label: 'Color by vibe', kind: 'toggle', default: false, description: 'Color every group-chat message by its vibe score: light near 1, darkest at the vibe ceiling.' },
      { key: KEYS.vibeColor, label: 'Vibe base colour', kind: 'choice', default: 'accent', options: VIBE_COLORS.map((c) => ({ value: c, label: c })), description: 'The theme colour the vibe shades are mixed from.' },
    ],
  }],
  settingsTabs: [{ id: 'agent-swarm', label: 'Agent swarm', icon: 'user', order: 91, parent: 'plugins' }],
  settingsPanels: [{ id: 'agent-swarm.lifecycle', tab: 'agent-swarm', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

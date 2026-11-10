import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { setPriorityHost, type PriorityHost } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import * as consoleApi from '@console/api';
import { FOLDER, OrchestratorPage, TABS, TAB_KEY } from './ui';

// the tags on every build screen read through this plugin; with it removed they simply draw nothing
const priorityApi = pluginApi(FOLDER, 'Build priority', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
setPriorityHost({
  load: async () => (await priorityApi.call<{ map: Awaited<ReturnType<PriorityHost['load']>> }>('priority')).map,
  waiting: (build) => priorityApi.call(`priority/${encodeURIComponent(build)}`),
  set: async (builds, priority) => { await priorityApi.post('priority', { builds, priority }); },
});

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.build-orchestrator',
  label: 'Build orchestrator',
  version: '0.2.0',
  appMenu,
  register(rt) {
    // build-orchestrator.open[:queued|active|accounts|approvals|rules]: the deep link (console_open, voice, MCP actions)
    const open = (tab = '') => {
      if (TABS.some((t) => t.id === tab)) { consoleApi.writeLocal(TAB_KEY, tab); globalThis.dispatchEvent?.(new CustomEvent('axf:orchestrator-tab', { detail: tab })); }
      rt.navigate('build-orchestrator');
    };
    rt.actions.register('build-orchestrator.open', ([tab]) => open(decodeURIComponent(tab ?? '')), { label: 'Open the Build orchestrator' });
    rt.actions.register('build-orchestrator.queued', () => open('queued'), { label: 'Build orchestrator: Queued builds' });
    rt.actions.register('build-orchestrator.active', () => open('active'), { label: 'Build orchestrator: Active builds' });
    // the generic names the retired Build queue screen and other plugins use (no plugin folder in them)
    rt.actions.register('builds.queued', () => open('queued'), { label: 'Queued builds' });
    rt.actions.register('builds.active', () => open('active'), { label: 'Active builds' });
  },
  views: { 'build-orchestrator': { title: 'Build orchestrator', icon: 'layers', keywords: ['orchestrator', 'queued', 'queue', 'active', 'building', 'hold', 'assign account', 'fable', 'opus', 'steps', 'phases', 'approve model'], render: () => <OrchestratorPage /> } },
  nav: { label: 'Builds', items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', view: 'build-orchestrator' }] },
  contextMenu: [{ id: 'build-orchestrator.pending', target: 'axf-pending-item', items: [{ id: 'build-orchestrator.open', label: 'Open in Build orchestrator', icon: 'layers', action: 'build-orchestrator.open' }] }],
  settingsTabs: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', order: 90, parent: 'plugins' }],
  settingsPanels: [{ id: 'build-orchestrator.lifecycle', tab: 'build-orchestrator', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

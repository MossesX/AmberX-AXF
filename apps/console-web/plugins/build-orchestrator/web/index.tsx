import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { setPriorityHost, type PriorityHost } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { FOLDER, OrchestratorPage } from './ui';
import { QueuesPage, setQueuesFocus } from './queues';

// the tags on every build screen read through this plugin; with it removed they simply draw nothing
const priorityApi = pluginApi(FOLDER, 'Build priority', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
setPriorityHost({
  load: async () => (await priorityApi.call<{ map: Awaited<ReturnType<PriorityHost['load']>> }>('priority')).map,
  waiting: (build) => priorityApi.call(`priority/${encodeURIComponent(build)}`),
  set: async (builds, priority) => { await priorityApi.post('priority', { builds, priority }); },
});

export const plugin: AxfWebLibrary = {
  register(rt) {
    // deep link into Queues & API: build-queues.open, or build-queues.open:<queue or build id> to scroll to it
    rt.actions.register('build-queues.open', ([target = '']) => { setQueuesFocus(target); rt.navigate('build-queues'); }, { label: 'Open Queues & API', params: true, searchable: true });
  },
  id: 'ai.amberx.axf.console.build-orchestrator',
  label: 'Build orchestrator',
  version: '0.4.0',
  appMenu,
  views: { 'build-orchestrator': { title: 'Build orchestrator', icon: 'layers', keywords: ['orchestrator', 'fable', 'opus', 'steps', 'phases', 'approve model'], render: () => <OrchestratorPage /> },
    'build-queues': { title: 'Queues & API', icon: 'list', keywords: ['queue', 'queues', 'api', 'api key', 'spend', 'cap', 'overflow', 'rules', 'moses x', 'hulu'], render: () => <QueuesPage /> } },
  nav: { label: 'Builds', items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', view: 'build-orchestrator' }, { id: 'build-queues', label: 'Queues & API', icon: 'list', view: 'build-queues' }] },
  contextMenu: [{ id: 'build-orchestrator.pending', target: 'axf-pending-item', items: [{ id: 'build-orchestrator.open', label: 'Open in Build orchestrator', icon: 'layers', action: 'nav:build-orchestrator' }] }],
  settingsTabs: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', order: 90, parent: 'plugins' }],
  settingsPanels: [{ id: 'build-orchestrator.lifecycle', tab: 'build-orchestrator', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

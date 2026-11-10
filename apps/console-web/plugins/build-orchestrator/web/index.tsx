import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { setPriorityHost, type PriorityHost } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { FOLDER, OrchestratorPage } from './ui';
import { OldQueueRedirect, openOrchestrator } from './open';
import { ORCH_VIEW } from './orchestrator-core.mjs';

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
  views: {
    [ORCH_VIEW]: { title: 'Build orchestrator', icon: 'layers', keywords: ['orchestrator', 'build queue', 'queue', 'pipeline', 'pending', 'queued', 'building', 'fable', 'opus', 'steps', 'phases', 'approve model'], render: () => <OrchestratorPage /> },
    // the old Build queue screen id: with this plugin on, every link, nav item and console_open of it lands here
    build: { title: 'Build queue', icon: 'layers', keywords: ['build queue', 'orchestrator'], render: () => <OldQueueRedirect /> },
  },
  register(rt) {
    // console_action "orchestrator.open" or "orchestrator.open:<pending|queued|building>": the orchestrator, Pipeline tab, on that lane
    rt.actions.register('orchestrator.open', ([lane = '']) => openOrchestrator(rt, lane), { label: 'Open the build queue (Build orchestrator)', params: true, effect: 'navigate' });
  },
  nav: { label: 'Builds', items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', view: 'build-orchestrator' }] },
  contextMenu: [{ id: 'build-orchestrator.pending', target: 'axf-pending-item', items: [{ id: 'build-orchestrator.open', label: 'Open in Build orchestrator', icon: 'layers', action: 'nav:build-orchestrator' }] }],
  settingsTabs: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', order: 90, parent: 'plugins' }],
  settingsPanels: [{ id: 'build-orchestrator.lifecycle', tab: 'build-orchestrator', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

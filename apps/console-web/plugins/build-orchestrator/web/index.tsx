import type { AxfWebLibrary } from '@console/axf/react/library';
import { setModelAdviceActor } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { FOLDER, OrchestratorPage } from './ui';

const adviceApi = pluginApi(FOLDER, 'Build orchestrator', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.build-orchestrator',
  label: 'Build orchestrator',
  version: '0.1.1',
  appMenu,
  register(rt) {
    // model-advice@1: Apply / Dismiss on any screen's why-panel go through this plugin's act route (owner-only: the server
    // passes Brett's signed-in click as the approver; a session, agent or token caller is refused with the reason)
    setModelAdviceActor(async (change) => {
      const r = await adviceApi.post<{ ok: boolean; error?: string; log?: string[] }>('act', change);
      if (!r.ok) { rt.toast(r.error ?? 'Refused', 'danger'); return false; }
      for (const l of r.log ?? []) rt.terminal.log('orchestrator', l, 'ok');
      globalThis.dispatchEvent(new CustomEvent('axf:pending-changed'));
      return true;
    });
  },
  views: { 'build-orchestrator': { title: 'Build orchestrator', icon: 'layers', keywords: ['orchestrator', 'fable', 'opus', 'steps', 'phases', 'approve model'], render: () => <OrchestratorPage /> } },
  nav: { label: 'Builds', items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', view: 'build-orchestrator' }] },
  contextMenu: [{ id: 'build-orchestrator.pending', target: 'axf-pending-item', items: [{ id: 'build-orchestrator.open', label: 'Open in Build orchestrator', icon: 'layers', action: 'nav:build-orchestrator' }] }],
  settingsTabs: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', order: 90, parent: 'plugins' }],
  settingsPanels: [{ id: 'build-orchestrator.lifecycle', tab: 'build-orchestrator', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

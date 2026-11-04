import { useEffect } from 'react';
import { useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { FOLDER, OrchestratorPage } from './ui';

/**
 * `build-orchestrator` opens the Orchestrator view of the one Builds page (Nov 1 2026) when a plugin provides it (the
 * `builds.open` action); this full page (add, edit, reorder steps, rules, import) stays as `orchestrator-editor`.
 */
function OrchestratorRedirect() {
  const rt = useRuntime();
  const can = !!rt.actions.get('builds.open');
  useEffect(() => { if (can) rt.dispatch('builds.open:orchestrator'); }, [rt, can]);
  return can ? null : <OrchestratorPage />;
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.build-orchestrator',
  label: 'Build orchestrator',
  version: '0.1.1',
  appMenu,
  views: {
    'build-orchestrator': { title: 'Build orchestrator', icon: 'layers', keywords: ['orchestrator', 'fable', 'opus', 'steps', 'phases', 'approve model'], render: () => <OrchestratorRedirect /> },
    'orchestrator-editor': { title: 'Orchestrator editor', icon: 'edit', keywords: ['orchestrator', 'edit steps', 'add build', 'rules', 'import'], render: () => <OrchestratorPage /> },
  },
  nav: { label: 'Builds', items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', view: 'build-orchestrator' }, { id: 'orchestrator-editor', label: 'Orchestrator editor', icon: 'edit', view: 'orchestrator-editor' }] },
  contextMenu: [{ id: 'build-orchestrator.pending', target: 'axf-pending-item', items: [{ id: 'build-orchestrator.open', label: 'Open in Build orchestrator', icon: 'layers', action: 'nav:build-orchestrator' }] }],
  settingsTabs: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', order: 90, parent: 'plugins' }],
  settingsPanels: [{ id: 'build-orchestrator.lifecycle', tab: 'build-orchestrator', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { FOLDER, OrchestratorPage } from './ui';
import { PackagerDialog } from './packager';

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.build-orchestrator',
  label: 'Build orchestrator',
  version: '0.2.0',
  appMenu,
  register(rt) {
    // build-package@1: the Package builds window; the preset only pre-ticks every Fable step (Brett confirms before anything is sent)
    rt.actions.register('build-orchestrator.package', () => rt.openDialog('build-orchestrator.package'), { label: 'Package builds: combine waiting steps into one build' });
    rt.actions.register('build-orchestrator.package-fable', () => rt.openDialog('build-orchestrator.package', { preset: 'all-fable' }), { label: 'Package the Fable work: tick every waiting Fable step to send to a helper' });
  },
  dialogs: {
    'build-orchestrator.package': { title: 'Package builds', icon: 'package', render: (props, close) => <PackagerDialog preset={props.preset ? String(props.preset) : undefined} close={close} /> },
  },
  views: { 'build-orchestrator': { title: 'Build orchestrator', icon: 'layers', keywords: ['orchestrator', 'fable', 'opus', 'steps', 'phases', 'approve model'], render: () => <OrchestratorPage /> } },
  nav: { label: 'Builds', items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', view: 'build-orchestrator' }] },
  contextMenu: [
    { id: 'build-orchestrator.pending', target: 'axf-pending-item', items: [{ id: 'build-orchestrator.open', label: 'Open in Build orchestrator', icon: 'layers', action: 'nav:build-orchestrator' }, { id: 'build-orchestrator.package.pending', label: 'Package builds…', icon: 'package', action: 'build-orchestrator.package' }] },
    { id: 'build-orchestrator.build', target: 'axf-orchestrator-build', items: [{ id: 'build-orchestrator.package.build', label: 'Package builds…', icon: 'package', action: 'build-orchestrator.package' }, { id: 'build-orchestrator.package.fable', label: 'Package the Fable work…', icon: 'zap', action: 'build-orchestrator.package-fable' }] },
  ],
  settingsTabs: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', order: 90, parent: 'plugins' }],
  settingsPanels: [{ id: 'build-orchestrator.lifecycle', tab: 'build-orchestrator', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

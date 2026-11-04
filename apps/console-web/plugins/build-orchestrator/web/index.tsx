import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { FOLDER, OrchestratorPage } from './ui';
import { PackagerDialog } from './packager';
import { OptimizeButton, OptimizerDialog, OptimizerSettings } from './optimizer';
import { listenEverywhere, MoveStepsDialog } from './step-drag';
import { paintOptimizerChip } from './optimizer-chip';

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.build-orchestrator',
  label: 'Build orchestrator',
  version: '0.3.0',
  appMenu,
  register(rt) {
    // build-package@1: the Package builds window; the preset only pre-ticks every Fable step (Brett confirms before anything is sent)
    rt.actions.register('build-orchestrator.package', () => rt.openDialog('build-orchestrator.package'), { label: 'Package builds: combine waiting steps into one build' });
    // build-optimize@1: Optimize builds (args: mode | preset); a scheduled or fallen-back run paints a banner chip
    rt.actions.register('build-orchestrator.optimize', ([arg]) => rt.openDialog('build-orchestrator.optimize', arg && ['auto', 'deep', 'basic'].includes(arg) ? { mode: arg } : arg ? { preset: arg } : {}), { label: 'Optimize builds: repack waiting steps into the fewest builds' });
    rt.actions.register('build-orchestrator.optimize-fable', () => rt.openDialog('build-orchestrator.optimize', { filter: { models: ['Fable'] } }), { label: 'Optimize just the Fable work' });
    listenEverywhere();
    void paintOptimizerChip(rt);
    rt.actions.register('build-orchestrator.package-fable', () => rt.openDialog('build-orchestrator.package', { preset: 'all-fable' }), { label: 'Package the Fable work: tick every waiting Fable step to send to a helper' });
  },
  dialogs: {
    'build-orchestrator.optimize': { title: 'Optimize builds', icon: 'zap', render: (props, close) => <OptimizerDialog close={close} mode={props.mode ? String(props.mode) : undefined} preset={props.preset ? String(props.preset) : undefined} filter={props.filter as never} /> },
    'build-orchestrator.move-steps': { title: 'Move steps', icon: 'layers', render: (props, close) => <MoveStepsDialog keys={(props.keys as string[]) ?? []} to={String(props.to ?? '')} index={Number(props.index ?? -1)} need={(props.need as string[]) ?? []} close={close} /> },
    'build-orchestrator.package': { title: 'Package builds', icon: 'package', render: (props, close) => <PackagerDialog preset={props.preset ? String(props.preset) : undefined} close={close} /> },
  },
  views: { 'build-orchestrator': { title: 'Build orchestrator', icon: 'layers', keywords: ['orchestrator', 'fable', 'opus', 'steps', 'phases', 'approve model'], render: () => <OrchestratorPage /> } },
  nav: { label: 'Builds', items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', view: 'build-orchestrator' }] },
  // the Builds pages' toolbar (Build manager, orchestrator, pending, queue): Optimize builds
  slots: { 'builds.toolbar': [{ id: 'build-orchestrator.optimize', order: 10, render: () => <OptimizeButton /> }] },
  contextMenu: [
    { id: 'build-orchestrator.optimize.items', target: 'axf-build-item', items: [{ id: 'build-orchestrator.optimize.item', label: 'Optimize builds…', icon: 'zap', action: 'build-orchestrator.optimize' }] },
    { id: 'build-orchestrator.pending', target: 'axf-pending-item', items: [{ id: 'build-orchestrator.open', label: 'Open in Build orchestrator', icon: 'layers', action: 'nav:build-orchestrator' }, { id: 'build-orchestrator.package.pending', label: 'Package builds…', icon: 'package', action: 'build-orchestrator.package' }, { id: 'build-orchestrator.optimize.pending', label: 'Optimize builds…', icon: 'zap', action: 'build-orchestrator.optimize' }] },
    { id: 'build-orchestrator.build', target: 'axf-orchestrator-build', items: [{ id: 'build-orchestrator.package.build', label: 'Package builds…', icon: 'package', action: 'build-orchestrator.package' }, { id: 'build-orchestrator.package.fable', label: 'Package the Fable work…', icon: 'zap', action: 'build-orchestrator.package-fable' }, { id: 'build-orchestrator.optimize.build', label: 'Optimize builds…', icon: 'zap', action: 'build-orchestrator.optimize' }] },
  ],
  settingsTabs: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', order: 90, parent: 'plugins' }, { id: 'build-optimizer', label: 'Build optimizer', icon: 'zap', order: 91, parent: 'plugins', description: 'How Optimize builds repacks waiting steps: mode, packing, grouping rules, safety, presets, schedule, notifications.' }],
  settingsPanels: [{ id: 'build-orchestrator.optimizer', tab: 'build-optimizer', title: 'Build optimizer', icon: 'zap', order: 10, render: () => <OptimizerSettings /> },{ id: 'build-orchestrator.lifecycle', tab: 'build-orchestrator', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

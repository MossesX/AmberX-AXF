import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { setPriorityHost, type PriorityHost } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { FOLDER, OrchestratorPage, TABS, openTab } from './ui';
import { PackagerDialog } from './packager';
import { OptimizeButton, OptimizerDialog, OptimizerSettings } from './optimizer';
import { listenEverywhere, MoveStepsDialog } from './step-drag';
import { paintOptimizerChip } from './optimizer-chip';

/*
 * Nov 10 2026: the orchestrator took over everything the retired Build manager did. Actions (console API, MCP console
 * actions, voice): build-orchestrator.open[:<build>] (opens the build's tab), build-orchestrator.tab:<pending|queue|
 * active|incomplete|complete|errors|accounts|builds|approvals|rules>, build-orchestrator.start:<build> (Start = Queue: the
 * dispatcher starts it when its turn comes). Search: every build, by its tab. Context menu: Open / Queue on build rows.
 */
type TabRow = { id: string; title: string; status: string; tab: string; nextModel: string; pipeline?: { planned?: { account: string; model: string } | null; account?: string } | null };
const pipeApi = pluginApi(FOLDER, 'Build orchestrator', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
let rows: TabRow[] = []; let loadedAt = 0;
async function loadRows(force = false): Promise<TabRow[]> {
  if (!force && Date.now() - loadedAt < 30_000) return rows;
  const r = await pipeApi.call<{ tabs?: Record<string, TabRow[]> }>('pipeline');
  rows = Object.values(r.tabs ?? {}).flat(); loadedAt = Date.now();
  return rows;
}
const TAB_NAME: Record<string, string> = Object.fromEntries(TABS.map((t) => [t.id, t.label]));

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
  version: '0.6.0',
  appMenu,
  register(rt) {
    const open = async (arg = '') => {
      rt.navigate('build-orchestrator');
      const id = decodeURIComponent(arg);
      if (!id) return;
      if (TABS.some((t) => t.id === id)) { openTab(id); return; }
      try { const b = (await loadRows(true)).find((x) => x.id === id); openTab(b?.tab || 'builds'); if (!b) rt.toast(`No open build "${id}" in the tabs: showing All builds.`, 'warning'); }
      catch { openTab('builds'); }
    };
    rt.actions.register('build-orchestrator.open', ([arg]) => void open(arg ?? ''), { label: 'Open the Build orchestrator (a build or a tab)' });
    rt.actions.register('build-orchestrator.tab', ([arg]) => { rt.navigate('build-orchestrator'); openTab(decodeURIComponent(arg ?? 'queue')); }, { label: 'Build orchestrator: open a tab' });
    rt.actions.register('build-orchestrator.start', ([arg]) => {
      const id = decodeURIComponent(arg ?? '');
      if (!id) { void open('pending'); return; }
      void pipeApi.post<{ ok: boolean; error?: string }>('pipeline/queue', { id })
        .then((r) => { if (!r.ok) throw new Error(r.error); rt.toast(`${id} is in the Queue: the dispatcher starts it when its turn comes.`, 'success'); void open('queue'); })
        .catch((e: Error) => rt.toast(e.message, 'danger'));
    }, { label: 'Start a build (put it in the Queue)' });
    rt.search.add('build-orchestrator.builds', () => {
      if (Date.now() - loadedAt > 30_000) void loadRows().catch(() => undefined);
      return rows.map((r) => ({
        id: `orch:${r.id}`, kind: 'build', label: r.title, icon: 'layers',
        detail: `Build orchestrator · ${TAB_NAME[r.tab] ?? r.status}${r.nextModel ? ` · ${r.nextModel} next` : ''}${r.pipeline?.account ? ` · on ${r.pipeline.account}` : r.pipeline?.planned?.account ? ` · planned ${r.pipeline.planned.account}` : ''}`,
        keywords: [r.id, r.status, r.tab, r.nextModel].filter(Boolean), focus: { kind: 'action' as const, spec: `build-orchestrator.open:${encodeURIComponent(r.id)}` },
      }));
    });
    rt.contextExtras.set('*:build-orchestrator', (target, payload) => {
      if (!payload || !['axf-build-item', 'axf-plan-feature', 'axf-orchestrator-build'].includes(target ?? '')) return [];
      const id = String(payload).replace(/^pending:/, '');
      const out = [{ id: 'build-orchestrator.open', label: 'Open in Build orchestrator', icon: 'layers', action: `build-orchestrator.open:${encodeURIComponent(id)}` }];
      const b = rows.find((x) => x.id === id);
      if (b && b.status === 'pending') out.push({ id: 'build-orchestrator.start', label: 'Queue it (start when its turn comes)', icon: 'play', action: `build-orchestrator.start:${encodeURIComponent(id)}` });
      return out;
    });
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
  views: { 'build-orchestrator': { title: 'Build orchestrator', icon: 'layers', keywords: ['orchestrator', 'builds', 'build manager', 'pending', 'queue', 'active', 'incomplete', 'complete', 'errors', 'accounts', 'health', 'fable', 'opus', 'steps', 'phases', 'approve model'], render: () => <OrchestratorPage /> } },
  nav: { label: 'Builds', items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', view: 'build-orchestrator' }] },
  // the Builds pages' toolbar (Build manager, orchestrator, pending, queue): Optimize builds
  slots: { 'builds.toolbar': [{ id: 'build-orchestrator.optimize', order: 10, render: () => <OptimizeButton /> }] },
  contextMenu: [{ id: 'build-orchestrator.pending', target: 'axf-pending-item', items: [{ id: 'build-orchestrator.open', label: 'Open in Build orchestrator', icon: 'layers', action: 'build-orchestrator.open' }, { id: 'build-orchestrator.package.pending', label: 'Package builds…', icon: 'package', action: 'build-orchestrator.package' }, { id: 'build-orchestrator.optimize.pending', label: 'Optimize builds…', icon: 'zap', action: 'build-orchestrator.optimize' }] },
    { id: 'build-orchestrator.optimize.items', target: 'axf-build-item', items: [{ id: 'build-orchestrator.optimize.item', label: 'Optimize builds…', icon: 'zap', action: 'build-orchestrator.optimize' }] },
    { id: 'build-orchestrator.build', target: 'axf-orchestrator-build', items: [{ id: 'build-orchestrator.package.build', label: 'Package builds…', icon: 'package', action: 'build-orchestrator.package' }, { id: 'build-orchestrator.package.fable', label: 'Package the Fable work…', icon: 'zap', action: 'build-orchestrator.package-fable' }, { id: 'build-orchestrator.optimize.build', label: 'Optimize builds…', icon: 'zap', action: 'build-orchestrator.optimize' }] },
    { id: 'build-orchestrator.default', target: 'default', order: 91, items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', action: 'nav:build-orchestrator' }] }],
  settingsTabs: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', order: 90, parent: 'plugins' }, { id: 'build-optimizer', label: 'Build optimizer', icon: 'zap', order: 91, parent: 'plugins', description: 'How Optimize builds repacks waiting steps: mode, packing, grouping rules, safety, presets, schedule, notifications.' }],
  settingsPanels: [{ id: 'build-orchestrator.optimizer', tab: 'build-optimizer', title: 'Build optimizer', icon: 'zap', order: 10, render: () => <OptimizerSettings /> }, { id: 'build-orchestrator.lifecycle', tab: 'build-orchestrator', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

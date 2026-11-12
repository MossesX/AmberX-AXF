import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { setPriorityHost, type PriorityHost } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { FOLDER, OrchestratorPage, TABS, openTab } from './ui';
import { BUILD_ACTIONS, type BuildAction } from '@console/axf/core/build-pipeline.mjs';

const ACTION_LABEL: Record<BuildAction, string> = { unqueue: 'Back to Pending', hold: 'Hold (stays in the Queue)', release: 'Release from hold', archive: 'Move to the Archive', unarchive: 'Bring back from the Archive', delete: 'Delete (kept in Deleted)', restore: 'Restore' };
const ACTION_ICON: Record<BuildAction, string> = { unqueue: 'arrow-left', hold: 'pause', release: 'play', archive: 'package', unarchive: 'undo', delete: 'trash', restore: 'undo' };

/*
 * Nov 10 2026: the orchestrator took over everything the retired Build manager did. Actions (console API, MCP console
 * actions, voice): build-orchestrator.open[:<build>] (opens the build's tab), build-orchestrator.tab:<pending|queue|
 * active|incomplete|complete|errors|archive|deleted|accounts|builds|approvals|rules>, build-orchestrator.start:<build> (Start
 * = Queue: the dispatcher starts it when its turn comes). Search: every build, by its tab. Context menu: Open / Queue on
 * build rows, plus the actions the build offers.
 * Build actions (Brett, Nov 10 2026: hold, archive, delete, deleted builds kept forever): build-orchestrator.<unqueue|hold|
 * release|archive|unarchive|delete|restore>:<build>[,<build>…] → POST pipeline/action (the same call as the cards, the
 * bulk toolbar, the MCP command pipeline-build-action and `pipeline.mjs <action> <id…>`).
 * Queue order (Brett, Nov 10 2026: drag and drop in the Queue, the dispatcher follows the order):
 * build-orchestrator.move:<build>:<top|bottom|up|down|N|before=<id>|after=<id>> → POST pipeline/move (the same call as
 * the Queue cards' drag and drop and up / down buttons, the right-click Move items, the MCP command pipeline-move and
 * `pipeline.mjs move <id> …`).
 */
type TabRow = { id: string; title: string; status: string; tab: string; nextModel: string; actions?: BuildAction[]; pipeline?: { planned?: { account: string; model: string } | null; account?: string } | null };
const pipeApi = pluginApi(FOLDER, 'Build orchestrator', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
let rows: TabRow[] = []; let loadedAt = 0;
async function loadRows(force = false): Promise<TabRow[]> {
  if (!force && Date.now() - loadedAt < 30_000) return rows;
  const r = await pipeApi.call<{ tabs?: Record<string, TabRow[]> }>('pipeline');
  rows = Object.values(r.tabs ?? {}).flat(); loadedAt = Date.now();
  return rows;
}
/** Right-click Move to position N items, one per place up to this many (any position: the MCP command, CLI or voice). */
const MAX_POSITION_ITEMS = 10;
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
  version: '0.5.0',
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
    rt.actions.register('build-orchestrator.move', ([arg, where]) => {
      const id = decodeURIComponent(arg ?? ''); const w = decodeURIComponent(where ?? '');
      const m = /^(before|after)=(.+)$/.exec(w);
      if (!id || !w) { rt.toast('Name a build and where: build-orchestrator.move:<build>:<top|bottom|up|down|N>', 'warning'); return; }
      void pipeApi.post<{ ok: boolean; error?: string; position?: number; queue?: string[] }>('pipeline/move', m ? { id, [m[1] ?? 'before']: m[2] } : { id, to: w })
        .then((r) => { if (!r.ok) throw new Error(r.error); rt.toast(`${id} → position ${r.position} of ${r.queue?.length ?? '?'} in the Queue`, 'success'); void loadRows(true).catch(() => undefined); void open('queue'); })
        .catch((e: Error) => rt.toast(e.message, 'danger'));
    }, { label: 'Build orchestrator: move a queued build (top, bottom, up, down or a position)' });
    for (const action of BUILD_ACTIONS) {
      rt.actions.register(`build-orchestrator.${action}`, ([arg]) => {
        const ids = decodeURIComponent(arg ?? '').split(',').map((x) => x.trim()).filter(Boolean);
        if (!ids.length) { rt.toast(`Name a build: build-orchestrator.${action}:<build>`, 'warning'); return; }
        void pipeApi.post<{ ok: boolean; error?: string; done?: { id: string; tab: string }[]; refused?: { id: string; error: string }[] }>('pipeline/action', { action, ids })
          .then((r) => {
            if (!r.ok) throw new Error(r.error);
            const done = r.done ?? []; const refused = r.refused ?? [];
            if (done.length) rt.toast(`${done.map((d) => d.id).join(', ')}: ${ACTION_LABEL[action].toLowerCase()}`, 'success');
            if (refused.length) rt.toast(refused.map((x) => x.error).join('; '), 'warning');
            void loadRows(true).catch(() => undefined);
            if (done[0]?.tab) void open(done[0].tab);
          })
          .catch((e: Error) => rt.toast(e.message, 'danger'));
      }, { label: `Build orchestrator: ${ACTION_LABEL[action]} (one build or several, comma separated)` });
    }
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
      const queue = rows.filter((x) => x.tab === 'queue');
      const pos = queue.findIndex((x) => x.id === id) + 1;
      if (b && b.tab === 'queue' && pos > 0 && queue.length > 1) {
        const mv = (key: string, label: string, icon: string, to: string) => out.push({ id: `build-orchestrator.move.${key}`, label, icon, action: `build-orchestrator.move:${encodeURIComponent(id)}:${to}` });
        if (pos > 1) mv('top', 'Move to top of the Queue', 'chevron-up', 'top');
        if (pos < queue.length) mv('bottom', 'Move to bottom of the Queue', 'chevron-down', 'bottom');
        for (let n = 1; n <= Math.min(queue.length, MAX_POSITION_ITEMS); n += 1) if (n !== pos) mv(`pos${n}`, `Move to position ${n}`, 'layers', String(n));
      }
      for (const a of b?.actions ?? []) out.push({ id: `build-orchestrator.${a}`, label: ACTION_LABEL[a], icon: ACTION_ICON[a], action: `build-orchestrator.${a}:${encodeURIComponent(id)}` });
      return out;
    });
  },
  views: { 'build-orchestrator': { title: 'Build orchestrator', icon: 'layers', keywords: ['orchestrator', 'builds', 'build manager', 'pending', 'queue', 'active', 'incomplete', 'complete', 'errors', 'archive', 'deleted', 'hold', 'on hold', 'restore', 'accounts', 'health', 'fable', 'opus', 'steps', 'phases', 'approve model'], render: () => <OrchestratorPage /> } },
  nav: { label: 'Builds', items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', view: 'build-orchestrator' }] },
  contextMenu: [{ id: 'build-orchestrator.pending', target: 'axf-pending-item', items: [{ id: 'build-orchestrator.open', label: 'Open in Build orchestrator', icon: 'layers', action: 'build-orchestrator.open' }] },
    { id: 'build-orchestrator.default', target: 'default', order: 91, items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', action: 'nav:build-orchestrator' }] }],
  settingsTabs: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', order: 90, parent: 'plugins' }],
  settingsPanels: [{ id: 'build-orchestrator.lifecycle', tab: 'build-orchestrator', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

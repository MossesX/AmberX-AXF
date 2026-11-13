import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { setPriorityHost, type PriorityHost } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { FOLDER, OrchestratorPage, TABS, openTab } from './ui';
import { focusBuild } from './focus';
import { RecoverySettings } from './RecoverySettings';
import { useEffect } from 'react';
import { useRuntime } from '@console/axf/react';
import { recoveryApi, type RecoveryState } from './recovery';

/** The deep link `builds/orchestrator/recovery` (console_show / console_open): opens the orchestrator on its Recovery tab. */
function RecoveryLink() {
  const rt = useRuntime();
  useEffect(() => { openTab('recovery'); rt.navigate('build-orchestrator'); }, [rt]);
  return null;
}
import { BUILD_ACTIONS, type BuildAction } from '@console/axf/core/build-pipeline.mjs';

const ACTION_LABEL: Record<BuildAction, string> = { unqueue: 'Back to Pending', hold: 'Hold (stays in the Queue)', release: 'Release from hold', archive: 'Move to the Archive', unarchive: 'Bring back from the Archive', delete: 'Delete (kept in Deleted)', restore: 'Restore' };
const ACTION_ICON: Record<BuildAction, string> = { unqueue: 'arrow-left', hold: 'pause', release: 'play', archive: 'package', unarchive: 'undo', delete: 'trash', restore: 'undo' };

/*
 * Nov 10 2026: the orchestrator took over everything the retired Build manager did. Actions (console API, MCP console
 * actions, voice): build-orchestrator.open[:<build>] (opens the build's tab), build-orchestrator.tab:<pending|queue|
 * active|incomplete|complete|errors|archive|deleted|accounts|builds|approvals|rules>, build-orchestrator.start:<build> (Start
 * = Queue: the dispatcher starts it when its turn comes). Search: every build, by its tab. Context menu: Open / Queue on
 * build rows, plus the actions the build offers.
 * build-orchestrator.focus:<tab|build> (Nov 11 2026, console-commands-reliable): what a console command's `focus` runs
 * ("build-orchestrator pending", console_show "build:<id>"): a tab by id or label opens; a build opens its tab with its
 * row scrolled into view, expanded and highlighted. open / tab / focus only navigate (effect navigate), so Follow Amber's
 * navigate-only grant may run them.
 * Build actions (Brett, Nov 10 2026: hold, archive, delete, deleted builds kept forever): build-orchestrator.<unqueue|hold|
 * release|archive|unarchive|delete|restore>:<build>[,<build>…] → POST pipeline/action (the same call as the cards, the
 * bulk toolbar, the MCP command pipeline-build-action and `pipeline.mjs <action> <id…>`).
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
    /** A tab by id or label ("pending", "Pending", "all builds"), or ''. */
    const tabOf = (s: string) => { const low = s.trim().toLowerCase(); return TABS.find((t) => t.id === low || t.label.toLowerCase() === low)?.id ?? ''; };
    const open = async (arg = '') => {
      rt.navigate('build-orchestrator');
      let id = '';
      try { id = decodeURIComponent(arg).trim(); } catch { id = arg.trim(); }
      if (!id) return;
      const tab = tabOf(id);
      if (tab) { openTab(tab); return; }
      // the build: its tab opens and the row there scrolls into view, expands and stays highlighted
      focusBuild(id);
      try { const b = (await loadRows(true)).find((x) => x.id === id); openTab(b?.tab || 'builds'); if (!b) rt.toast(`No open build "${id}" in the tabs: showing All builds.`, 'warning'); }
      catch { openTab('builds'); }
    };
    rt.actions.register('build-orchestrator.open', ([arg]) => void open(arg ?? ''), { label: 'Open the Build orchestrator (a build or a tab)', effect: 'navigate' });
    rt.actions.register('build-orchestrator.focus', ([arg]) => void open(arg ?? ''), { label: 'Build orchestrator: bring a tab or a build forward', params: true, effect: 'navigate' });
    rt.actions.register('build-orchestrator.tab', ([arg]) => { rt.navigate('build-orchestrator'); openTab(tabOf(decodeURIComponent(arg ?? 'queue')) || 'queue'); }, { label: 'Build orchestrator: open a tab', effect: 'navigate' });
    rt.actions.register('build-orchestrator.start', ([arg]) => {
      const id = decodeURIComponent(arg ?? '');
      if (!id) { void open('pending'); return; }
      void pipeApi.post<{ ok: boolean; error?: string }>('pipeline/queue', { id })
        .then((r) => { if (!r.ok) throw new Error(r.error); rt.toast(`${id} is in the Queue: the dispatcher starts it when its turn comes.`, 'success'); void open('queue'); })
        .catch((e: Error) => rt.toast(e.message, 'danger'));
    }, { label: 'Start a build (put it in the Queue)' });
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
    // auto-recovery (build auto-recover-stuck-builds): the voice actions AmberX runs, the same calls as REST / MCP / CLI
    const openRecovery = () => { rt.navigate('build-orchestrator'); openTab('recovery'); };
    rt.actions.register('recovery.status', () => {
      openRecovery();
      void recoveryApi.call<RecoveryState>('recovery').then((s) => rt.toast(`${s.health.summary} Auto-recovery is ${s.settings.enabled ? 'on' : 'off'}.`, s.health.status === 'error' ? 'warning' : 'info', 'Auto-recovery'))
        .catch((e: Error) => rt.toast(e.message, 'danger'));
    }, { label: 'Auto-recovery: what is stuck and what was fixed (opens the Recovery log)', effect: 'navigate' });
    rt.actions.register('recovery.run', () => {
      void recoveryApi.post<{ state?: string; message?: string }>('recovery/run', {}).then((r) => rt.toast(r.message || 'Auto-recovery ran.', r.state === 'failed' ? 'danger' : 'success', 'Auto-recovery'))
        .catch((e: Error) => rt.toast(e.message, 'danger'));
    }, { label: 'Auto-recovery: fix stuck builds now' });
    rt.actions.register('recovery.retry', ([arg]) => {
      const id = decodeURIComponent(arg ?? '').trim();
      if (!id) { openRecovery(); rt.toast('Name a build: recovery.retry:<build>', 'warning'); return; }
      void recoveryApi.post(`recovery/retry/${encodeURIComponent(id)}`, {}).then(() => rt.toast(`${id} is back in the Queue (retry count reset).`, 'success', 'Auto-recovery'))
        .catch((e: Error) => rt.toast(e.message, 'danger'));
    }, { label: 'Auto-recovery: retry a stuck or parked build now', params: true });
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
      for (const a of b?.actions ?? []) out.push({ id: `build-orchestrator.${a}`, label: ACTION_LABEL[a], icon: ACTION_ICON[a], action: `build-orchestrator.${a}:${encodeURIComponent(id)}` });
      return out;
    });
  },
  views: {
    'build-orchestrator': { title: 'Build orchestrator', icon: 'layers', keywords: ['recovery', 'orchestrator', 'builds', 'build manager', 'pending', 'queue', 'active', 'incomplete', 'complete', 'errors', 'archive', 'deleted', 'hold', 'on hold', 'restore', 'accounts', 'health', 'fable', 'opus', 'steps', 'phases', 'approve model'], render: () => <OrchestratorPage /> },
    // first view = the plugin's "Opens in"; this one only redirects (deep link builds/orchestrator/recovery)
    'build-orchestrator.recovery': { title: 'Builds / Orchestrator / Recovery', icon: 'refresh', keywords: ['recovery log', 'auto-recovery', 'stuck builds', 'parked builds'], render: () => <RecoveryLink /> } },
  nav: { label: 'Builds', items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', view: 'build-orchestrator' }] },
  contextMenu: [{ id: 'build-orchestrator.pending', target: 'axf-pending-item', items: [{ id: 'build-orchestrator.open', label: 'Open in Build orchestrator', icon: 'layers', action: 'build-orchestrator.open' }] },
    { id: 'build-orchestrator.default', target: 'default', order: 91, items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', action: 'nav:build-orchestrator' }] }],
  settingsTabs: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', order: 90, parent: 'plugins' }],
  settingsPanels: [{ id: 'build-orchestrator.recovery', tab: 'build-orchestrator', title: 'Recovery', icon: 'refresh', order: 20, render: () => <RecoverySettings /> },
    { id: 'build-orchestrator.lifecycle', tab: 'build-orchestrator', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

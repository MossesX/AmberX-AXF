import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { setPriorityHost, type PriorityHost } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { FOLDER, OrchestratorPage, TABS, openTab } from './ui';
import { focusBuild } from './focus';
import { GateLogPage, openGate } from './gate-log';
import { GateBannerPanel, GateInBanner, GateOwnBanner, OWN_BANNER, setGatePlace, startGateBanner } from './gate-banner';
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
    // Server gate log (Nov 12 2026): the page, optionally filtered to one gate (duplicate-launch, duplicate-reaped,
    // slot-limit, dispatch, main). Same data: GET gate-log, MCP command gate-log, `server-gate.mjs log`, voice.
    rt.actions.register('build-orchestrator.gate-log', ([arg]) => { openGate(decodeURIComponent(arg ?? '')); rt.navigate('server-gate-log'); }, { label: 'Open the Server gate log (optionally one gate)', effect: 'navigate' });
    // its banner widget: own banner | app banner bar | snapped into any banner | off (GET / POST gate-banner, MCP, CLI, voice)
    startGateBanner(rt);
    rt.actions.register('build-orchestrator.gate-banner', ([arg]) => {
      const place = decodeURIComponent(arg ?? '').trim();
      if (!place) { rt.navigate('settings'); return; }
      void setGatePlace(place).then((p) => rt.toast(`Server gate log widget: ${p === 'own' ? 'its own banner' : p === 'bar' ? 'the app banner bar' : p === 'off' ? 'off' : `in the ${p} banner`}`, 'success')).catch((e: Error) => rt.toast(e.message, 'danger'));
    }, { label: 'Move the Server gate log widget (own, bar, off or a banner id)' });
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
  views: { 'build-orchestrator': { title: 'Build orchestrator', icon: 'layers', keywords: ['orchestrator', 'builds', 'build manager', 'pending', 'queue', 'active', 'incomplete', 'complete', 'errors', 'archive', 'deleted', 'hold', 'on hold', 'restore', 'accounts', 'health', 'fable', 'opus', 'steps', 'phases', 'approve model'], render: () => <OrchestratorPage /> },
    'server-gate-log': { title: 'Server gate log', icon: 'shield', keywords: ['server gate', 'gate log', 'duplicate launch', 'duplicate session', 'reaped', 'slot limit', 'dispatch gate', 'orchestrator id', 'main gate', 'merge queue kicked'], render: () => <GateLogPage /> } },
  nav: { label: 'Builds', items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', view: 'build-orchestrator' }, { id: 'server-gate-log', label: 'Server gate log', icon: 'shield', view: 'server-gate-log' }] },
  contextMenu: [{ id: 'build-orchestrator.pending', target: 'axf-pending-item', items: [{ id: 'build-orchestrator.open', label: 'Open in Build orchestrator', icon: 'layers', action: 'build-orchestrator.open' }] },
    { id: 'build-orchestrator.default', target: 'default', order: 91, items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', action: 'nav:build-orchestrator' }] }],
  // the gate log's own strip sits in the frame's banner region as a slot (not a `banners` entry: that would drop the
  // orchestrator's "Opens in" choice, which banner plugins don't get); banner.extras snaps it into a picked banner
  slots: {
    'app.frame.banners': [{ id: `build-orchestrator.${OWN_BANNER}`, order: 40, render: () => <GateOwnBanner /> }],
    'banner.extras': [{ id: 'build-orchestrator.gate', order: 50, render: (p) => <GateInBanner banner={String(p.banner ?? '')} /> }],
  },
  settingsTabs: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', order: 90, parent: 'plugins' }],
  settingsPanels: [{ id: 'build-orchestrator.gate-banner', tab: 'build-orchestrator', title: 'Server gate log widget', icon: 'shield', order: 20, render: () => <GateBannerPanel /> },
    { id: 'build-orchestrator.lifecycle', tab: 'build-orchestrator', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

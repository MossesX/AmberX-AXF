import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { setPriorityHost, type PriorityHost } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import * as consoleApi from '@console/api';
import { addLoadedSource } from '@console/control/search';
import { AccountsPanel, ApprovalsPanel, FOLDER, GroupsPanel, MergeQueueView, OrchestratorPage, RulesPanel, SETTINGS_TABS, TABS, WatchdogStatusPanel, openTab } from './ui';
import { StatusTable } from './StatusTable';
import { statusLabel, type TableRow } from './status-table-core.mjs';
import { focusBuild } from './focus';
import { WatchdogSettingsPanel, watchdogApi, type WatchdogStatus } from './watchdog';
import { showAttempts } from './attempts';
import { BUILD_ACTIONS, type BuildAction } from '@console/axf/core/build-pipeline.mjs';
import { registerWatchdogActions } from './watchdogActions';
import { WatchdogPanel, registerWatchdogTargets } from './WatchdogPanel';

const ACTION_LABEL: Record<BuildAction, string> = { unqueue: 'Back to Pending', hold: 'Hold (stays in the Queue)', release: 'Release from hold', archive: 'Move to the Archive', unarchive: 'Bring back from the Archive', delete: 'Delete (kept in Deleted)', restore: 'Restore' };
const ACTION_ICON: Record<BuildAction, string> = { unqueue: 'arrow-left', hold: 'pause', release: 'play', archive: 'package', unarchive: 'undo', delete: 'trash', restore: 'undo' };

/*
 * Pipeline 2.0 (Nov 19 2026): the page is ONE table driven by status (StatusTable.tsx), no tabs. Actions (console API,
 * MCP console actions, voice): build-orchestrator.open[:<build | status | old tab id>] (a build: its row, filters
 * cleared; a status or an old tab name: that filter), build-orchestrator.merge-queue (the read-only merge queue view),
 * build-orchestrator.start:<build>. Search: every build with its status. Context menu: Open, Retry on a failed build,
 * Hold / Archive / Delete. Accounts, Watchdog, Groups, Approvals and Rules are Settings → Plugins → Build orchestrator.
 * Build watchdog (build-watchdog@1): watchdog.status (toast + the Watchdog tab), watchdog.run[:<build>] (POST watchdog/run);
 * deep link build-orchestrator.focus:watchdog (console_open "build-orchestrator" focus "watchdog", console_show
 * "build-orchestrator/watchdog"), with ?build=<id> for one build's row and fixes.
 * build-orchestrator.focus:<tab|build> (Nov 11 2026, console-commands-reliable): what a console command's `focus` runs
 * ("build-orchestrator pending", console_show "build:<id>"): a tab by id or label opens; a build opens its tab with its
 * row scrolled into view, expanded and highlighted. open / tab / focus only navigate (effect navigate), so Follow Amber's
 * navigate-only grant may run them.
 * Build actions (Brett, Nov 10 2026: hold, archive, delete, deleted builds kept forever): build-orchestrator.<unqueue|hold|
 * release|archive|unarchive|delete|restore>:<build>[,<build>…] → POST pipeline/action (the same call as the cards, the
 * bulk toolbar, the MCP command pipeline-build-action and `pipeline.mjs <action> <id…>`).
 */
const pipeApi = pluginApi(FOLDER, 'Build orchestrator', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
// search and the context menu read the same rows as the table (GET /table: the builds store, landed ones included)
let rows: TableRow[] = []; let loadedAt = 0;
async function loadRows(force = false): Promise<TableRow[]> {
  if (!force && Date.now() - loadedAt < 30_000) return rows;
  const r = await pipeApi.call<{ ok: boolean; rows?: TableRow[] }>('table?landed=1');
  rows = r.rows ?? []; loadedAt = Date.now();
  return rows;
}
const label = (r: TableRow) => statusLabel(r.status, r.attempt);

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
    /** An old tab or a status by id or label ("pending", "Merge queue", "running-ci"), or ''. */
    const tabOf = (s: string) => { const low = s.trim().toLowerCase(); return TABS.find((t) => t.id === low || t.label.toLowerCase() === low)?.id ?? low.replace(/\s+/g, '-'); };
    /** Pipeline 2.0 has no tabs: the old non-build tabs are Settings → Plugins → Build orchestrator panels. */
    const settingsTab = (s: string) => (SETTINGS_TABS as readonly string[]).includes(s.trim().toLowerCase()) || /^groups?(:|$)/.test(s.trim().toLowerCase());
    const open = async (arg = '') => {
      rt.navigate('build-orchestrator');
      let id = '';
      try { id = decodeURIComponent(arg).trim(); } catch { id = arg.trim(); }
      id = id.replace(/^#?\/?build-orchestrator\/?/, '');
      if (!id) return;
      // the Watchdog tab (deep link build-orchestrator/watchdog, optionally ?build=<id>: that build's row and its fixes)
      const wd = /^watchdog(?:(?:\?build=|\/|:)([a-z0-9][a-z0-9._-]{0,79}))?$/i.exec(id);
      if (wd) { consoleApi.writeLocal('orch-watchdog-build', wd[1] ?? ''); rt.dispatch('settings.open:build-orchestrator'); return; }
      if (settingsTab(id)) { rt.dispatch('settings.open:build-orchestrator'); return; }
      if (tabOf(id) === 'merge-queue') { rt.navigate('merge-queue'); return; }
      if (openTab(tabOf(id))) return;
      // the build: the table clears filters that hide it, then its row scrolls into view, expands and stays highlighted
      focusBuild(id);
      try { if (!(await loadRows(true)).some((x) => x.id === id)) rt.toast(`No build "${id}" in the builds store.`, 'warning'); }
      catch { /* the table shows its own error */ }
    };
    registerWatchdogActions(rt);
    registerWatchdogTargets(rt);
    rt.actions.register('build-orchestrator.open', ([arg]) => void open(arg ?? ''), { label: 'Open the Build orchestrator (a build or a tab)', effect: 'navigate' });
    rt.actions.register('build-orchestrator.focus', ([arg]) => void open(arg ?? ''), { label: 'Build orchestrator: bring a tab or a build forward', params: true, effect: 'navigate' });
    // the build watchdog (build-watchdog@1) for voice and console actions: the same calls as REST / MCP / `axf watchdog`
    rt.actions.register('watchdog.status', async () => {
      void open('watchdog');
      try {
        const s = await watchdogApi.call<WatchdogStatus>('watchdog/status');
        const running = s.lastScan?.builds.length ?? 0; const stuck = s.lastScan?.builds.filter((b) => b.stuck).length ?? 0;
        rt.toast(`Watchdog ${s.settings.enabled ? 'on' : 'off'}: last pass ${s.ageMin != null ? `${s.ageMin} min ago` : 'never'}, ${running} running, ${stuck} stuck, ${s.recent.length} recent fixes${s.gaveUp.length ? `, gave up on ${s.gaveUp.length}` : ''}.`, s.stale || s.gaveUp.length ? 'warning' : 'success');
      } catch (e) { rt.toast((e as Error).message, 'danger'); }
    }, { label: 'Build watchdog: status (last pass, stuck builds, recent fixes)' });
    rt.actions.register('watchdog.run', async ([arg]) => {
      try {
        const build = decodeURIComponent(arg ?? '').trim();
        const r = await watchdogApi.post<{ requested?: boolean; fixes?: unknown[] }>('watchdog/run', build ? { build } : {});
        rt.toast(r.requested ? 'Asked the VPS for a watchdog pass: it runs within a minute.' : `Watchdog pass done: ${r.fixes?.length ?? 0} fixed.`, 'success');
      } catch (e) { rt.toast((e as Error).message, 'danger'); }
    }, { label: 'Build watchdog: run a pass now (optionally one build)' });
    rt.actions.register('build-orchestrator.tab', ([arg]) => void open(arg ?? ''), { label: 'Build orchestrator: show builds in a status (old tab names map onto status filters)', effect: 'navigate' });
    rt.actions.register('build-orchestrator.merge-queue', () => rt.navigate('merge-queue'), { label: 'Open the merge queue (read-only)', effect: 'navigate' });
    // custom groups (groups.tsx, groups.mjs): group:<id> is a custom tab; group-add / group-remove put builds in or out,
    // group-action runs queue | land | archive | priority:<P> on every build of a group (the same POST groups calls)
    const groupCall = (path: string, body: Record<string, unknown>, done: string) => void pipeApi.post<{ ok: boolean; error?: string }>(path, body)
      .then((r) => { if (!r.ok) throw new Error(r.error); rt.toast(done, 'success'); }).catch((e: Error) => rt.toast(e.message, 'danger'));
    const splitArg = (arg?: string) => { const [g = '', rest = ''] = decodeURIComponent(arg ?? '').split('|'); return { group: g.trim(), list: rest.split(',').map((x) => x.trim()).filter(Boolean) }; };
    rt.actions.register('build-orchestrator.groups', () => rt.dispatch('settings.open:build-orchestrator'), { label: 'Build orchestrator: the Groups board (Settings → Plugins → Build orchestrator)', effect: 'navigate' });
    rt.actions.register('build-orchestrator.group-add', ([arg]) => { const a = splitArg(arg); groupCall('groups', { op: 'assign', groups: [a.group], builds: a.list, mode: 'add' }, `${a.list.join(', ')} → ${a.group}`); }, { label: 'Build orchestrator: put builds in a group (<group>|<build>,<build>)' });
    rt.actions.register('build-orchestrator.group-remove', ([arg]) => { const a = splitArg(arg); groupCall('groups', { op: 'assign', groups: [a.group], builds: a.list, mode: 'remove' }, `${a.list.join(', ')} out of ${a.group}`); }, { label: 'Build orchestrator: take builds out of a group (<group>|<build>,<build>)' });
    rt.actions.register('build-orchestrator.group-action', ([arg]) => { const a = splitArg(arg); const [action = '', priority = ''] = (a.list[0] ?? '').split(':'); groupCall(`groups/${encodeURIComponent(a.group)}/action`, { action, priority }, `${a.group}: ${action}`); }, { label: 'Build orchestrator: a group action (<group>|queue, land, archive or priority:P0)' });
    rt.actions.register('build-orchestrator.start', ([arg]) => {
      const id = decodeURIComponent(arg ?? '');
      if (!id) { void open('pending'); return; }
      void pipeApi.post<{ ok: boolean; error?: string }>('pipeline/queue', { id })
        .then((r) => { if (!r.ok) throw new Error(r.error); rt.toast(`${id} is ready: it starts by itself when nothing else is active.`, 'success'); void open(id); })
        .catch((e: Error) => rt.toast(e.message, 'danger'));
    }, { label: 'Start a build (put it in the Queue)' });
    rt.actions.register('build-orchestrator.requeue-stuck', ([arg]) => {
      const apply = decodeURIComponent(arg ?? '') === 'apply';
      void pipeApi.post<{ ok: boolean; error?: string; found?: { id: string }[]; moved?: string[] }>('pipeline/requeue-stuck', { apply })
        .then((r) => {
          if (!r.ok) throw new Error(r.error);
          const found = r.found?.length ?? 0;
          rt.toast(apply ? `${r.moved?.length ?? 0} build(s) back in the Queue: their next phase starts when a slot frees.` : found ? `${found} build(s) parked after a finished phase: build-orchestrator.requeue-stuck:apply moves them.` : 'No build is parked after a finished phase.', found || apply ? 'success' : 'info');
          void open(apply ? 'ready' : 'pending');
        })
        .catch((e: Error) => rt.toast(e.message, 'danger'));
    }, { label: 'Build orchestrator: requeue builds parked in Pending after a finished phase (":apply" moves them)', params: true });
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
            if (done[0]?.id) void open(done[0].id);
          })
          .catch((e: Error) => rt.toast(e.message, 'danger'));
      }, { label: `Build orchestrator: ${ACTION_LABEL[action]} (one build or several, comma separated)` });
    }
    // done-means-merged@1: a build's Attempts tab (deep link row:<build>/tab:attempts) and Retry, the same calls as
    // REST GET attempts/<id> + POST retry/<id>, the MCP commands attempts / retry and orchestrator.mjs attempts | retry.
    // Voice: "what's wrong with <build>", "why did <build> stop" → attempts; "retry <build> [in a fresh session]" → retry.
    const attempts = (arg = '') => { let id = ''; try { id = decodeURIComponent(arg).trim(); } catch { id = arg.trim(); } if (!id) { void open('failed'); return; } showAttempts(id); void open(id); };
    rt.actions.register('build-orchestrator.attempts', ([arg]) => attempts(arg ?? ''), { label: "Build orchestrator: a build's attempts (what failed, every try, what is next)", params: true, effect: 'navigate' });
    rt.actions.register('build-orchestrator.retry', ([arg]) => {
      const [id = '', strategy = ''] = decodeURIComponent(arg ?? '').split('|').map((x) => x.trim());
      if (!id) { rt.toast('Name a build: build-orchestrator.retry:<build>[|strategy]', 'warning'); return; }
      void pipeApi.post<{ ok: boolean; error?: string; status?: string }>(`retry/${encodeURIComponent(id)}`, strategy ? { strategy } : {})
        .then((r) => { if (!r.ok) throw new Error(r.error); rt.toast(`${id}: retrying${strategy ? ` (${strategy})` : ''}. The ladder starts over.`, 'success'); attempts(id); })
        .catch((e: Error) => rt.toast(e.message, 'danger'));
    }, { label: 'Build orchestrator: retry a build (<build>|strategy: retry, fix:targeted, fresh-session, switch-model, switch-account …)', params: true });
    // console-control@1: every loaded build is a search hit with its address (row:<id>, the orchestrator grid's row);
    // focusing one that is not drawn opens its tab and expands it first, so row:<id>/step:s3 reaches its step too
    addLoadedSource('build-orchestrator.builds', () => { if (Date.now() - loadedAt > 30_000) void loadRows().catch(() => undefined);
      // the attempts address first: loadedItemFor takes the first item an address starts with
      return [...rows.map((r) => ({
      address: `row:${r.id}/tab:attempts`, kind: 'tab' as const, label: `${r.title}: attempts`, icon: 'refresh', detail: `Build attempts · ${label(r)}`, keywords: [r.id, 'attempts', 'retry', 'failed', r.status].filter(Boolean),
      open: () => rt.dispatch(`build-orchestrator.attempts:${encodeURIComponent(r.id)}`),
    })), ...rows.map((r) => ({
      address: `row:${r.id}`, kind: 'row' as const, label: r.title, icon: 'layers', detail: `Build · ${label(r)}`, keywords: [r.id, r.status, r.model, r.account].filter(Boolean),
      open: () => rt.dispatch(`build-orchestrator.focus:${encodeURIComponent(r.id)}`),
    }))]; });
    rt.search.add('build-orchestrator.builds', () => {
      if (Date.now() - loadedAt > 30_000) void loadRows().catch(() => undefined);
      return rows.map((r) => ({
        id: `orch:${r.id}`, kind: 'build', label: r.title, icon: 'layers',
        detail: `Build orchestrator · ${label(r)} · ${r.done}/${r.total} steps${r.model ? ` · ${r.model}` : ''}${r.account ? ` · on ${r.account}` : ''}${r.prNumber ? ` · PR #${r.prNumber}` : ''}`,
        keywords: [r.id, r.status, r.model, r.account].filter(Boolean), focus: { kind: 'action' as const, spec: `build-orchestrator.open:${encodeURIComponent(r.id)}` },
      }));
    });
    rt.contextExtras.set('*:build-orchestrator', (target, payload) => {
      if (!payload || !['axf-build-item', 'axf-plan-feature', 'axf-orchestrator-build'].includes(target ?? '')) return [];
      const id = String(payload).replace(/^pending:/, '');
      const out = [{ id: 'build-orchestrator.open', label: 'Open in Build orchestrator', icon: 'layers', action: `build-orchestrator.open:${encodeURIComponent(id)}` }];
      const b = rows.find((x) => x.id === id);
      if (b?.status === 'failed') out.push({ id: 'build-orchestrator.retry', label: `Retry (${label(b)})`, icon: 'refresh', action: `build-orchestrator.retry:${encodeURIComponent(id)}` });
      for (const a of ['hold', 'archive', 'delete'] as BuildAction[]) out.push({ id: `build-orchestrator.${a}`, label: ACTION_LABEL[a], icon: ACTION_ICON[a], action: `build-orchestrator.${a}:${encodeURIComponent(id)}` });
      return out;
    });
  },
  views: {
    'build-orchestrator': { title: 'Build orchestrator', icon: 'layers', keywords: ['orchestrator', 'builds', 'build manager', 'status', 'pending', 'splitting', 'pulling main', 'assigning models', 'ready', 'sending', 'building', 'build complete', 'merging', 'running ci', 'landed', 'failed', 'attempt', 'timer', 'account', 'slot', 'fable', 'opus', 'steps'], render: () => <OrchestratorPage /> },
    'merge-queue': { title: 'Merge queue', icon: 'git-merge', keywords: ['merge queue', 'merging', 'one pr', 'running ci', 'merging into main', 'waiting to merge'], render: () => <MergeQueueView /> },
  },
  nav: { label: 'Builds', items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', view: 'build-orchestrator' }, { id: 'merge-queue', label: 'Merge queue', icon: 'git-merge', view: 'merge-queue' }] },
  // the read-only merge queue for other screens (the push banner's Merge queue panel): the same table, filtered
  slots: { 'builds.merge-queue': [{ id: 'build-orchestrator.merge-queue', order: 10, render: () => <StatusTable api={pipeApi} mode="queue" /> }] },
  contextMenu: [{ id: 'build-orchestrator.pending', target: 'axf-pending-item', items: [{ id: 'build-orchestrator.open', label: 'Open in Build orchestrator', icon: 'layers', action: 'build-orchestrator.open' }] },
    { id: 'build-orchestrator.default', target: 'default', order: 91, items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', action: 'nav:build-orchestrator' }] }],
  settingsTabs: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', order: 90, parent: 'plugins' }],
  settingsPanels: [
    { id: 'build-orchestrator.accounts', tab: 'build-orchestrator', title: 'Accounts', icon: 'user', order: 10, render: () => <AccountsPanel /> },
    { id: 'build-orchestrator.watchdog-status', tab: 'build-orchestrator', title: 'Watchdog status', icon: 'shield', order: 19, render: () => <WatchdogStatusPanel /> },
    { id: 'build-orchestrator.groups', tab: 'build-orchestrator', title: 'Groups', icon: 'folder', order: 30, render: () => <GroupsPanel /> },
    { id: 'build-orchestrator.approvals', tab: 'build-orchestrator', title: 'Approvals', icon: 'check', order: 40, render: () => <ApprovalsPanel /> },
    { id: 'build-orchestrator.rules', tab: 'build-orchestrator', title: 'Rules', icon: 'settings', order: 50, render: () => <RulesPanel /> },
    { id: 'build-orchestrator.recovery-watchdog', tab: 'build-orchestrator', title: 'Recovery watchdog', icon: 'shield', order: 21, render: () => <WatchdogSettingsPanel /> },
    { id: 'build-orchestrator.watchdog', tab: 'build-orchestrator', title: 'Watchdog', icon: 'shield', order: 20, render: () => <WatchdogPanel /> },
    { id: 'build-orchestrator.lifecycle', tab: 'build-orchestrator', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

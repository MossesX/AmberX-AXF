import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { controlRegistry, flashWhenReady, setPriorityHost, type PriorityHost } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import * as consoleApi from '@console/api';
import { addLoadedSource } from '@console/control/search';
import { AccountsPanel, ApprovalsPanel, FOLDER, GroupsPanel, OrchestratorPage, RulesPanel, SETTINGS_TABS, TABS, WatchdogStatusPanel, openTab } from './ui';
import { NO_FILTERS, StatusTable, setTableFilter, type Filters } from './StatusTable';
import { VIEWS, VIEW_HINT, VIEW_LABEL, ensureViews, statusLabel, type TableRow, type TableView } from './status-table-core.mjs';
import { focusBuild } from './focus';
import { mergeTogether, mergeTogetherLine } from './mergeTogether';
import { waitingToMerge } from './pipeline-view-core.mjs';
import { fillApi, fillSummary, parseDepsArg, parseSettingsArg } from './fill';
import { FILL_ANCHOR, FillSettingsPanel } from './Settings';
import { SLOTS_ANCHOR } from './SlotsStrip';
import { stepsAnchor } from './StepDeps';
import { showAttempts } from './attempts';
import { BUILD_ACTIONS, type BuildAction } from '@console/axf/core/build-pipeline.mjs';
import { registerWatchdogActions } from './watchdogActions';
import { WatchdogPanel, registerWatchdogTargets } from './WatchdogPanel';
import { WatchdogsPanel, loadWatchdogs, passLine, registerWatchdogs, runWatchdogs, statusLine } from './Watchdogs';

/**
 * The build actions this page offers by name. Brett's stops (build-pipeline@1: unqueue, hold, cancel) and their release
 * are listed here in full, whatever the baked core copy of the app knows, so `cancel` is an action on every surface.
 */
type WebAction = BuildAction | 'cancel';
const WEB_ACTIONS: WebAction[] = [...new Set<WebAction>([...BUILD_ACTIONS, 'cancel'])];
const ACTION_LABEL: Record<WebAction, string> = { unqueue: 'Back to Pending', hold: 'Hold (rests in Pending until released)', cancel: 'Cancel (ends its session)', release: 'Release (back in line)', archive: 'Move to the Archive', unarchive: 'Bring back from the Archive', delete: 'Delete (kept in Deleted)', restore: 'Restore' };
const ACTION_ICON: Record<WebAction, string> = { unqueue: 'arrow-left', hold: 'pause', cancel: 'x', release: 'play', archive: 'package', unarchive: 'undo', delete: 'trash', restore: 'undo' };
/** The summary GET /pipeline/summary answers (pipeline-summary@1 plus the views' counts). */
type Summary = { ok?: boolean; counts: Record<string, number>; total: number; views: Record<TableView, number>; queued: { id: string; title: string } | null; running: { id: string; status: string; slot: string; account: string }[] };
const isView = (v: string): v is TableView => (VIEWS as readonly string[]).includes(v);
/** The view the table is on (it keeps its filters in the console's local store). */
const currentView = (): TableView => { const v = consoleApi.readLocal<Filters>('orch-table-filters', NO_FILTERS).view; return isView(v) ? v : 'sent'; };

/*
 * Pipeline 2.0 (Nov 19 2026): the page is ONE table driven by status (StatusTable.tsx), no tabs. Actions (console API,
 * MCP console actions, voice): build-orchestrator.open[:<build | status | old tab id>] (a build: its row, filters
 * cleared; a status or an old tab name: that filter), build-orchestrator.merge-queue (the read-only merge queue view),
 * build-orchestrator.start:<build>. Search: every build with its status. Context menu: Open, Retry on a failed build,
 * Hold / Archive / Delete. Accounts, Watchdog, Groups, Approvals and Rules are Settings → Plugins → Build orchestrator.
 * Build watchdog (build-watchdogs@1, one panel for every watch: Watchdogs.tsx): watchdogs.status / watchdogs.run[:<watch>[:<build>]] /
 * watchdogs.scan / watchdogs.set:<key>:<value> / watchdogs.open[:caught|watches|settings]; the older watchdog.status and watchdog.run[:<build>] still work;
 * Fill every slot (Nov 13 2026): build-orchestrator.pipeline-fill-status[:<build>] (opens the Slots strip and says what
 * runs where), .pipeline-fill-run (one dispatcher round now), .pipeline-step-deps:<build>/<step>/<s1,s2|none|sequential>
 * and .pipeline-fill-settings:<fillSlots=on|off,maxParallelPerBuild=N,autoQueuePending=on|off>: the same names and REST
 * routes as the MCP plugin commands and `pipeline.mjs fill status|run|deps|set` (web/fill.ts).
 * deep link build-orchestrator.focus:watchdog (console_open "build-orchestrator" focus "watchdog", console_show
 * "build-orchestrator/watchdog"), with ?build=<id> for one build's row and fixes.
 * build-orchestrator.focus:<tab|build> (Nov 11 2026, console-commands-reliable): what a console command's `focus` runs
 * ("build-orchestrator pending", console_show "build:<id>"): a tab by id or label opens; a build opens its tab with its
 * row scrolled into view, expanded and highlighted. open / tab / focus only navigate (effect navigate), so Follow Amber's
 * navigate-only grant may run them.
 * Build actions (Brett, Nov 10 2026: hold, archive, delete, deleted builds kept forever; Nov 25 2026: cancel, and the
 * stops stick): build-orchestrator.<unqueue|hold|cancel|release|archive|unarchive|delete|restore>:<build>[,<build>…] →
 * POST pipeline/action (the same call as the cards, the bulk toolbar, the MCP commands pipeline-build-action /
 * pipeline-hold / pipeline-cancel / pipeline-release and `pipeline.mjs <action> <id…>`); build-orchestrator.queue:<build>
 * → POST pipeline/queue (one build waits in the Queue at a time).
 * The three views (Nov 25 2026): build-orchestrator.view:<sent|landed|pending> (also build-orchestrator.open:<view>,
 * console_show "build-orchestrator/<view>"), the control targets setting:build-orchestrator.view and
 * panel:build-orchestrator.<view>; build-orchestrator.pipeline-summary reads GET pipeline/summary.
 */
const pipeApi = pluginApi(FOLDER, 'Build orchestrator', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
// search and the context menu read the same rows as the table (GET /table: the builds store, landed ones included)
let rows: TableRow[] = []; let loadedAt = 0;
async function loadRows(force = false): Promise<TableRow[]> {
  if (!force && Date.now() - loadedAt < 30_000) return rows;
  const r = await pipeApi.call<{ ok: boolean; rows?: TableRow[] }>('table?landed=1');
  rows = ensureViews(r.rows); loadedAt = Date.now();
  return rows;
}
/** A build's state as the table shows it (the store's pipeline view; older rows: the status label). */
const label = (r: TableRow) => r.view?.label || statusLabel(r.status, r.attempt);
const numbered = (r: TableRow) => (r.number ? `${r.number} · ` : '');

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
      // fill every slot deep links: build-orchestrator/pipeline/slots and build-orchestrator/<build>/steps
      if (/^(pipeline\/)?slots$/i.test(id)) { openTab('active'); flashWhenReady(() => document.getElementById(SLOTS_ANCHOR), 5000); return; }
      const steps = /^(.+?)\/steps$/i.exec(id);
      if (steps?.[1]) { await open(encodeURIComponent(steps[1])); flashWhenReady(() => document.getElementById(stepsAnchor(steps[1] ?? '')), 8000); return; }
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
    registerWatchdogs(rt);
    rt.actions.register('build-orchestrator.open', ([arg]) => void open(arg ?? ''), { label: 'Open the Build orchestrator (a build or a tab)', effect: 'navigate' });
    rt.actions.register('build-orchestrator.focus', ([arg]) => void open(arg ?? ''), { label: 'Build orchestrator: bring a tab or a build forward', params: true, effect: 'navigate' });
    // the build watchdog (build-watchdogs@1) by its older action names: the same calls as watchdogs.status / watchdogs.run,
    // REST / MCP / `axf watchdog`. watchdog.run:<build> runs every watch for that one build.
    rt.actions.register('watchdog.status', async () => {
      void open('watchdog');
      try { const s = await loadWatchdogs(); rt.toast(statusLine(s), s.stale ? 'warning' : 'info'); } catch (e) { rt.toast((e as Error).message, 'danger'); }
    }, { label: 'Build watchdog: status (last pass, each watch, what it caught)' });
    rt.actions.register('watchdog.run', async ([arg]) => {
      try { const build = decodeURIComponent(arg ?? '').trim(); rt.toast(passLine(await runWatchdogs(build ? { build } : {})), 'success'); } catch (e) { rt.toast((e as Error).message, 'danger'); }
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
    const queueBuild = (arg: string | undefined) => {
      const id = decodeURIComponent(arg ?? '');
      if (!id) { void open('pending'); return; }
      // POST pipeline/queue: one build waits in the Queue at a time; a second is refused and the answer names the holder
      void pipeApi.post<{ ok: boolean; error?: string; say?: string }>('pipeline/queue', { id })
        .then((r) => { if (!r.ok) throw new Error(r.error); rt.toast(r.say ?? `${id} is queued: it starts when a slot and an account are free.`, 'success'); void open(id); })
        .catch((e: Error) => rt.toast(e.message, 'danger'));
    };
    rt.actions.register('build-orchestrator.start', ([arg]) => queueBuild(arg), { label: 'Start a build (put it in the Queue)' });
    rt.actions.register('build-orchestrator.queue', ([arg]) => queueBuild(arg), { label: 'Build orchestrator: queue a build (one waits in the Queue at a time)', params: true });
    // the three views (Sent · Landed · Pending): build-orchestrator.view:<view>, console_show "build-orchestrator/<view>"
    const showView = (v: string) => { const view = isView(v) ? v : 'sent'; rt.navigate('build-orchestrator'); setTableFilter({ view, status: '' }); return view; };
    rt.actions.register('build-orchestrator.view', ([arg]) => { showView(decodeURIComponent(arg ?? '').trim().toLowerCase()); }, { label: 'Build orchestrator: show the Sent, Landed or Pending builds (build-orchestrator.view:<sent|landed|pending>)', params: true, effect: 'navigate' });
    // the pipeline's state, read from the builds store's rows (GET pipeline/summary: the same answer as the MCP command
    // pipeline-summary, the console MCP tool pipeline_status and `axf build-orchestrator pipeline-summary`)
    rt.actions.register('build-orchestrator.pipeline-summary', () => {
      void pipeApi.call<Summary>('pipeline/summary')
        .then((s) => rt.toast(`${s.queued ? `Queued: ${s.queued.id}` : 'Nothing queued'} · ${s.running.length ? `running: ${s.running.map((r) => `${r.id}${r.account ? ` on ${r.account}` : ''}`).join(', ')}` : 'nothing running'} · ${s.views.sent} sent, ${s.views.pending} pending, ${s.views.landed} landed`, 'info', 'Pipeline'))
        .catch((e: Error) => rt.toast(e.message, 'danger'));
    }, { label: 'Build orchestrator: what is queued, what is running, how many builds are sent, pending and landed', effect: 'read' });
    // console-control targets: the view picker as one setting (get / set), and each view as a panel to open
    { const reg = controlRegistry(rt);
      reg.register({ address: 'setting:build-orchestrator.view', kind: 'setting', label: 'Build orchestrator: which builds (Sent, Landed, Pending)', keywords: ['orchestrator', 'builds', 'view', 'sent', 'landed', 'pending', 'queued', 'building', 'built'],
        get: () => currentView(), set: (v: unknown) => showView(String(v).trim().toLowerCase()), open: () => { showView(currentView()); } });
      for (const v of VIEWS) reg.register({ address: `panel:build-orchestrator.${v}`, kind: 'panel', label: `Build orchestrator: ${VIEW_LABEL[v]} builds`, keywords: ['orchestrator', 'builds', v, ...VIEW_HINT[v].toLowerCase().split(/[ ,]+/).filter((w) => w.length > 3)], open: () => { showView(v); }, get: () => currentView() === v }); }
    const fill = fillApi(pipeApi);
    const fail = (e: unknown) => rt.toast((e as Error).message, 'danger');
    rt.actions.register('build-orchestrator.pipeline-fill-status', ([arg]) => {
      const build = decodeURIComponent(arg ?? '').trim();
      void open(build || 'active');
      void fill.status(build).then((f) => rt.toast(fillSummary(f), 'info')).catch(fail);
    }, { label: 'Fill every slot: what runs in each agent slot and what starts next (a build adds its steps)', params: true, effect: 'navigate' });
    rt.actions.register('build-orchestrator.settings', ([arg]) => {
      rt.dispatch('settings.open:build-orchestrator');
      if (decodeURIComponent(arg ?? '').replace(/^#/, '') === 'fill') flashWhenReady(() => document.getElementById(FILL_ANCHOR), 5000);
    }, { label: 'Build orchestrator settings (fill = Fill every slot)', params: true, effect: 'navigate' });
    rt.actions.register('build-orchestrator.pipeline-fill-run', () => {
      void fill.run().then((r) => rt.toast(r.ran ? `Round run: ${r.fill?.launched.length ?? 0} parallel step(s) started` : r.note ?? 'Filed: the dispatcher runs a round within a minute', 'success')).catch(fail);
    }, { label: 'Fill the slots now (one dispatcher round)' });
    rt.actions.register('build-orchestrator.pipeline-step-deps', ([arg]) => {
      const d = parseDepsArg(arg ?? '');
      if (!d) { rt.toast('Say it as build-orchestrator.pipeline-step-deps:<build>/<step>/<s1,s2 | none | sequential>', 'warning'); return; }
      void fill.deps(d.build, d.step, d.dependsOn).then((r) => rt.toast(`${r.id} ${r.step}: ${r.explicit === null ? 'sequential' : r.dependsOn.length ? `after ${r.dependsOn.join(', ')}` : 'independent'}`, 'success')).catch(fail);
    }, { label: "Set a step's dependencies (<build>/<step>/<s1,s2 | none | sequential>)", params: true });
    rt.actions.register('build-orchestrator.pipeline-fill-settings', ([arg]) => {
      const patch = parseSettingsArg(arg ?? '');
      if (!Object.keys(patch).length) { rt.toast('Say it as build-orchestrator.pipeline-fill-settings:fillSlots=on|off,maxParallelPerBuild=N,autoQueuePending=on|off', 'warning'); return; }
      void fill.settings(patch).then((r) => rt.toast(r.changed.length ? r.changed.map((c) => `${c.key}: ${String(c.to)}`).join(', ') : 'Nothing changed', 'success')).catch(fail);
    }, { label: 'Fill every slot settings (fill every slot, max parallel steps per build, auto-queue pending builds: Brett only)', params: true });
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
    for (const action of WEB_ACTIONS) {
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
      }, { label: `Build orchestrator: ${ACTION_LABEL[action]} (one build or several, comma separated)`, params: true, ...(action === 'cancel' || action === 'delete' ? { effect: 'destructive' as const } : {}) });
    }
    // Merge together (Brett, Nov 23 2026): the lander combines every build waiting in the merge line into one branch,
    // runs CI once and merges them in one go; the same call as the button on a build's merge line. Named builds only
    // narrow it (comma separated); with none it takes every build the table shows as waiting to merge.
    rt.actions.register('build-orchestrator.merge-together', ([arg]) => {
      const named = decodeURIComponent(arg ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      void loadRows(true)
        .then((all) => { const ids = named.length ? named : waitingToMerge(all).map((r) => r.id); if (ids.length < 2) throw new Error(ids.length ? 'Only one build is waiting to merge: there is nothing to combine.' : 'No build is waiting to merge.'); return mergeTogether(pipeApi, ids).then((r) => rt.toast(mergeTogetherLine(r, ids.length), 'success')); })
        .catch((e: Error) => rt.toast(e.message, 'warning'));
    }, { label: 'Build orchestrator: merge the waiting builds together (one branch, CI once, one merge)', params: true });
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
      address: `row:${r.id}`, kind: 'row' as const, label: r.title, icon: 'layers', detail: `Build · ${numbered(r)}${label(r)}`, keywords: [r.id, r.number, r.status, r.view?.state, r.model, r.account].filter(Boolean),
      open: () => rt.dispatch(`build-orchestrator.focus:${encodeURIComponent(r.id)}`),
    }))]; });
    rt.search.add('build-orchestrator.builds', () => {
      if (Date.now() - loadedAt > 30_000) void loadRows().catch(() => undefined);
      return rows.map((r) => ({
        id: `orch:${r.id}`, kind: 'build', label: r.title, icon: 'layers',
        detail: `Build orchestrator · ${numbered(r)}${label(r)} · ${r.done}/${r.total} steps${r.model ? ` · ${r.model}` : ''}${r.account ? ` · on ${r.account}` : ''}${r.prNumber ? ` · PR #${r.prNumber}` : ''}`,
        keywords: [r.id, r.number, r.status, r.view?.state, r.model, r.account].filter(Boolean), focus: { kind: 'action' as const, spec: `build-orchestrator.open:${encodeURIComponent(r.id)}` },
      }));
    });
    rt.contextExtras.set('*:build-orchestrator', (target, payload) => {
      if (!payload || !['axf-build-item', 'axf-plan-feature', 'axf-orchestrator-build'].includes(target ?? '')) return [];
      const id = String(payload).replace(/^pending:/, '');
      const out = [{ id: 'build-orchestrator.open', label: 'Open in Build orchestrator', icon: 'layers', action: `build-orchestrator.open:${encodeURIComponent(id)}` }];
      const b = rows.find((x) => x.id === id);
      if (b?.status === 'failed') out.push({ id: 'build-orchestrator.retry', label: `Retry (${label(b)})`, icon: 'refresh', action: `build-orchestrator.retry:${encodeURIComponent(id)}` });
      const live = !!b && ['sending', 'building'].includes(b.status);
      for (const a of ['hold', ...(live ? ['cancel'] : []), 'archive', 'delete'] as WebAction[]) out.push({ id: `build-orchestrator.${a}`, label: ACTION_LABEL[a], icon: ACTION_ICON[a], action: `build-orchestrator.${a}:${encodeURIComponent(id)}` });
      return out;
    });
  },
  views: {
    'build-orchestrator': { title: 'Build orchestrator', icon: 'layers', keywords: ['orchestrator', 'builds', 'build manager', 'status', 'pending', 'splitting', 'pulling main', 'assigning models', 'ready', 'sending', 'building', 'build complete', 'merging', 'running ci', 'landed', 'failed', 'attempt', 'timer', 'account', 'slot', 'fable', 'opus', 'steps'], render: () => <OrchestratorPage /> },
  },
  nav: { label: 'Builds', items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', view: 'build-orchestrator' }] },
  // the read-only merge queue: the same table, filtered. The Merge queue view itself (view:merge-queue) belongs to the
  // merge-queue@2 plugin, which renders this slot when it is filled.
  slots: { 'builds.merge-queue': [{ id: 'build-orchestrator.merge-queue', order: 10, render: () => <StatusTable api={pipeApi} mode="queue" /> }] },
  contextMenu: [{ id: 'build-orchestrator.pending', target: 'axf-pending-item', items: [{ id: 'build-orchestrator.open', label: 'Open in Build orchestrator', icon: 'layers', action: 'build-orchestrator.open' }] },
    { id: 'build-orchestrator.default', target: 'default', order: 91, items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', action: 'nav:build-orchestrator' }] }],
  settingsTabs: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', order: 90, parent: 'plugins' }],
  settingsPanels: [
    { id: 'build-orchestrator.fill', tab: 'build-orchestrator', title: 'Fill every slot', icon: 'layers', order: 5, render: () => <FillSettingsPanel api={pipeApi} /> },
    { id: 'build-orchestrator.accounts', tab: 'build-orchestrator', title: 'Accounts', icon: 'user', order: 10, render: () => <AccountsPanel /> },
    { id: 'build-orchestrator.watchdogs', tab: 'build-orchestrator', title: 'Watchdog', icon: 'shield', order: 19, render: () => <WatchdogsPanel /> },
    { id: 'build-orchestrator.watchdog-status', tab: 'build-orchestrator', title: 'Watchdog: build sessions live', icon: 'shield', order: 20, render: () => <WatchdogStatusPanel /> },
    { id: 'build-orchestrator.groups', tab: 'build-orchestrator', title: 'Groups', icon: 'folder', order: 30, render: () => <GroupsPanel /> },
    { id: 'build-orchestrator.approvals', tab: 'build-orchestrator', title: 'Approvals', icon: 'check', order: 40, render: () => <ApprovalsPanel /> },
    { id: 'build-orchestrator.rules', tab: 'build-orchestrator', title: 'Rules', icon: 'settings', order: 50, render: () => <RulesPanel /> },
    { id: 'build-orchestrator.watchdog', tab: 'build-orchestrator', title: 'Watchdog: left-over rows, runs and cleanups log', icon: 'shield', order: 21, render: () => <WatchdogPanel /> },
    { id: 'build-orchestrator.lifecycle', tab: 'build-orchestrator', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

import type { AxfWebLibrary } from '@console/axf/react/library';
import type { AxfRuntime } from '@console/axf/core';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { setPriorityHost, type PriorityHost } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import * as consoleApi from '@console/api';
import { addLoadedSource } from '@console/control/search';
import { FOLDER, OrchestratorPage, TABS, openTab } from './ui';
import { focusBuild } from './focus';
import { WatchdogSettingsPanel, watchdogApi, type WatchdogStatus } from './watchdog';
import { showAttempts } from './attempts';
import { BUILD_ACTIONS, type BuildAction } from '@console/axf/core/build-pipeline.mjs';
import { registerWatchdogActions } from './watchdogActions';
import { WatchdogPanel, registerWatchdogTargets } from './WatchdogPanel';
import voiceDoc from '../voice.json';
import { controlRegistry } from '@console/axf/react';
import { rowExpanded } from './pipeline';

const ACTION_LABEL: Record<BuildAction, string> = { unqueue: 'Back to Pending', hold: 'Hold (stays in the Queue)', release: 'Release from hold', archive: 'Move to the Archive', unarchive: 'Bring back from the Archive', delete: 'Delete (kept in Deleted)', restore: 'Restore' };
const ACTION_ICON: Record<BuildAction, string> = { unqueue: 'arrow-left', hold: 'pause', release: 'play', archive: 'package', unarchive: 'undo', delete: 'trash', restore: 'undo' };

/*
 * Nov 10 2026: the orchestrator took over everything the retired Build manager did. Actions (console API, MCP console
 * actions, voice): build-orchestrator.open[:<build>] (opens the build's tab), build-orchestrator.tab:<pending|queue|
 * active|incomplete|complete|errors|archive|deleted|accounts|builds|approvals|rules>, build-orchestrator.start:<build> (Start
 * = Queue: the dispatcher starts it when its turn comes). Search: every build, by its tab. Context menu: Open / Queue on
 * build rows, plus the actions the build offers.
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

/*
 * split-plan@1 (one-build-time-always-split-to-fill): console actions for split runs, each the same route as its plugin
 * command (MCP), its pipeline.mjs subcommand (CLI) and its AmberX voice phrase (../voice.json):
 *   build-orchestrator.run-status            GET run/active           pipeline-run-status    pipeline.mjs run
 *   build-orchestrator.split-show:<build>    GET split/<build>        pipeline-split-show    pipeline.mjs split <id>
 *   build-orchestrator.split:<build>         POST pipeline/split      pipeline-split         pipeline.mjs split <id> --request
 *   build-orchestrator.resplit:<build>       POST split/<id>/resplit  pipeline-resplit       pipeline.mjs resplit <id>
 *   build-orchestrator.cancel-run:<build>|confirm  POST run/<id>/cancel  pipeline-cancel     pipeline.mjs cancel <id> --confirm
 *   build-orchestrator.split-gate[:on|off]   GET / PUT split-gate     pipeline-split-gate[-set]  pipeline.mjs split-gate [on|off]
 * Cancel is destructive: without `|confirm` it only says how to confirm.
 */
type SplitAnswer = { ok: boolean; id?: string; status?: string; splitId?: string; badge?: { label: string } | null; split?: { parts: { id: string; status: string }[] } | null; why?: string; active?: SplitAnswer | null; rule?: { id: string; enabled: boolean; title: string }; parts?: number; cancelled?: string };
function registerSplitActions(rt: AxfRuntime, open: (arg?: string) => Promise<void>) {
  const arg = (a?: string) => { try { return decodeURIComponent(a ?? '').trim(); } catch { return (a ?? '').trim(); } };
  const say = (t: string, tone: 'info' | 'success' | 'warning' = 'info') => rt.toast(t, tone, 'Split runs');
  const fail = (e: Error) => say(e.message, 'warning');
  const line = (r: SplitAnswer) => `${r.id}: ${r.status}${r.splitId ? ` · ${r.splitId} · ${r.badge?.label ?? ''} · ${(r.split?.parts ?? []).map((p) => `${p.id} ${p.status}`).join(', ')}` : ' · not split yet'}`;
  rt.actions.register('build-orchestrator.run-status', () => { void pipeApi.call<SplitAnswer>('run/active').then((r) => say(r.active ? `Active: ${line(r.active)}` : `No active run. ${r.why ?? ''}`), fail); }, { label: 'Split runs: the active run and the main lock' });
  rt.actions.register('build-orchestrator.split-show', ([a]) => { const id = arg(a); if (!id) return; void open(id); void pipeApi.call<SplitAnswer>(`split/${encodeURIComponent(id)}`).then((r) => say(line(r)), fail); }, { label: 'Split runs: show a build\'s split (<build>)', params: true });
  rt.actions.register('build-orchestrator.split', ([a]) => { const id = arg(a); if (!id) return; void pipeApi.post<SplitAnswer>('pipeline/split', { id }).then(() => say(`${id}: split on the next tick (steps, then parts).`, 'success'), fail); }, { label: 'Split runs: split a build (<build>)', params: true });
  rt.actions.register('build-orchestrator.resplit', ([a]) => { const id = arg(a); if (!id) return; void pipeApi.post<SplitAnswer>(`split/${encodeURIComponent(id)}/resplit`, {}).then((r) => say(r.ok ? `${id}: ${r.splitId}, ${r.parts} part(s).` : `${id}: ${r.why}`, r.ok ? 'success' : 'warning'), fail); }, { label: 'Split runs: plan a build\'s parts again (<build>)', params: true });
  rt.actions.register('build-orchestrator.cancel-run', ([a]) => {
    const [id, c] = arg(a).split('|'); if (!id) return;
    if (c !== 'confirm') { say(`Cancelling ${id}'s run stops every part and lands nothing. Run build-orchestrator.cancel-run:${id}|confirm to do it.`, 'warning'); return; }
    void pipeApi.post<SplitAnswer>(`run/${encodeURIComponent(id)}/cancel`, { confirm: true }).then((r) => say(`${id}: run ${r.cancelled} cancelled, back to Pending.`, 'success'), fail);
  }, { label: 'Split runs: cancel a build\'s run (<build>|confirm)', params: true });
  rt.actions.register('build-orchestrator.split-gate', ([a]) => {
    const v = arg(a);
    const p = v === 'on' || v === 'off' ? pipeApi.put<SplitAnswer>('split-gate', { enabled: v === 'on' }) : pipeApi.call<SplitAnswer>('split-gate');
    void p.then((r) => say(`${r.rule?.title}: ${r.rule?.enabled ? 'on' : 'off'}.`, 'success'), fail);
  }, { label: 'Split runs: the split-ID gate rule [on|off]' });
  // AmberX matches phrases literally, so a {build} phrase is spelled out for every build in Pending, the Queue and Active (its
  // spoken name: the id with spaces), its action carrying the id. Voice never confirms a cancel: it says how to.
  const v = (globalThis as { amberxVoice?: { register(module: string, commands: { id: string; phrases: string[]; action: string; owner?: string }[]): () => void } }).amberxVoice;
  if (!v) return;
  const spoken = (id: string) => id.replace(/-[a-z0-9]{4}$/, '').replace(/-/g, ' ');
  const voice = (builds: TabRow[]) => voiceDoc.commands.flatMap((c) => {
    const fixed = c.phrases.filter((p) => !p.includes('{build}'));
    const slot = c.phrases.filter((p) => p.includes('{build}'));
    return [
      ...(fixed.length ? [{ id: c.id, phrases: fixed, action: c.action, owner: voiceDoc.owner }] : []),
      ...(slot.length ? builds.map((b) => ({ id: `${c.id}.${b.id}`, phrases: slot.map((p) => p.replace('{build}', spoken(b.id))), action: `${c.action}:${b.id}`, owner: voiceDoc.owner })) : []),
    ];
  });
  const refresh = () => void loadRows(true).then((all) => v.register('build-orchestrator.split', voice(all.filter((b) => ['pending', 'queue', 'active'].includes(b.tab)))), () => v.register('build-orchestrator.split', voice([])));
  refresh();
  setInterval(refresh, 5 * 60_000);
}

/*
 * console-control@1 targets for split runs (deep links; console_show / console_open):
 *   view:builds/tab:pending   the Pending tab (builds being split read Splitting there)
 *   row:<build>               a Pending, Queued or Active build's row: open expands it (the Queue's rolled-up split row
 *                             with its parts); state is its status, run, roll-up badge and whether it is expanded
 *   row:<build>/part:<pN>     one part of a split build: open expands the row; state is the part (slot, branch, status)
 * Rendered rows carry the same addresses through data-axf-target (split.tsx), so a row on screen and a deep link agree.
 */
type SplitTargetRow = TabRow & { split?: { run: string; badge: { label: string }; parts: { id: string; status: string; slot: string; branch: string; account: string }[] } | null };
function registerSplitTargets(rt: AxfRuntime, open: (arg?: string) => Promise<void>) {
  const reg = controlRegistry(rt);
  reg.register({ address: 'view:builds/tab:pending', kind: 'tab', label: 'Pending builds (Splitting)', keywords: ['pending', 'splitting', 'split', 'builds'], open: () => void open('pending'), get: () => ({ tab: 'pending', builds: rows.filter((b) => b.tab === 'pending').map((b) => ({ id: b.id, status: b.status })) }) });
  let removers: (() => void)[] = [];
  const sync = (all: SplitTargetRow[]) => {
    removers.forEach((f) => f()); removers = [];
    for (const b of all.filter((x) => ['pending', 'queue', 'active'].includes(x.tab))) {
      removers.push(reg.register({ address: `row:${b.id}`, kind: 'row', label: b.title || b.id, keywords: [b.id, 'build', b.tab], open: () => void open(b.id),
        get: () => ({ id: b.id, tab: b.tab, status: b.status, run: b.split?.run ?? null, badge: b.split?.badge?.label ?? null, parts: b.split?.parts.length ?? 0, expanded: rowExpanded(b.id) }) }));
      for (const p of b.split?.parts ?? []) {
        removers.push(reg.register({ address: `row:${b.id}/part:${p.id}`, kind: 'part', label: `${b.id} part ${p.id}`, keywords: [b.id, p.id, 'part', p.status], open: () => void open(b.id),
          get: () => ({ build: b.id, id: p.id, status: p.status, slot: p.slot, branch: p.branch, account: p.account }) }));
      }
    }
  };
  const refresh = () => void loadRows(true).then((all) => sync(all as SplitTargetRow[]), () => { /* the server part may be off */ });
  refresh();
  setInterval(refresh, 60_000);
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.build-orchestrator',
  label: 'Build orchestrator',
  version: '0.5.0',
  appMenu,
  register(rt) {
    /** A tab by id or label ("pending", "Pending", "all builds"), or ''. */
    const tabOf = (s: string) => { const low = s.trim().toLowerCase(); if (/^group:[a-z0-9-]{1,48}$/.test(low)) return low; return TABS.find((t) => t.id === low || t.label.toLowerCase() === low)?.id ?? ''; };
    const open = async (arg = '') => {
      rt.navigate('build-orchestrator');
      let id = '';
      try { id = decodeURIComponent(arg).trim(); } catch { id = arg.trim(); }
      id = id.replace(/^#?\/?build-orchestrator\/?/, '');
      if (!id) return;
      // the Watchdog tab (deep link build-orchestrator/watchdog, optionally ?build=<id>: that build's row and its fixes)
      const wd = /^watchdog(?:(?:\?build=|\/|:)([a-z0-9][a-z0-9._-]{0,79}))?$/i.exec(id);
      if (wd) { consoleApi.writeLocal('orch-watchdog-build', wd[1] ?? ''); openTab('watchdog'); return; }
      const tab = tabOf(id);
      if (tab) { openTab(tab); return; }
      // the build: its tab opens and the row there scrolls into view, expands and stays highlighted
      focusBuild(id);
      try { const b = (await loadRows(true)).find((x) => x.id === id); openTab(b?.tab || 'builds'); if (!b) rt.toast(`No open build "${id}" in the tabs: showing All builds.`, 'warning'); }
      catch { openTab('builds'); }
    };
    registerWatchdogActions(rt);
    registerWatchdogTargets(rt);
    registerSplitActions(rt, open);
    registerSplitTargets(rt, open);
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
    rt.actions.register('build-orchestrator.tab', ([arg]) => { rt.navigate('build-orchestrator'); openTab(tabOf(decodeURIComponent(arg ?? 'queue')) || 'queue'); }, { label: 'Build orchestrator: open a tab', effect: 'navigate' });
    // custom groups (groups.tsx, groups.mjs): group:<id> is a custom tab; group-add / group-remove put builds in or out,
    // group-action runs queue | land | archive | priority:<P> on every build of a group (the same POST groups calls)
    const groupCall = (path: string, body: Record<string, unknown>, done: string) => void pipeApi.post<{ ok: boolean; error?: string }>(path, body)
      .then((r) => { if (!r.ok) throw new Error(r.error); rt.toast(done, 'success'); }).catch((e: Error) => rt.toast(e.message, 'danger'));
    const splitArg = (arg?: string) => { const [g = '', rest = ''] = decodeURIComponent(arg ?? '').split('|'); return { group: g.trim(), list: rest.split(',').map((x) => x.trim()).filter(Boolean) }; };
    rt.actions.register('build-orchestrator.groups', ([arg]) => { rt.navigate('build-orchestrator'); const g = decodeURIComponent(arg ?? '').trim().toLowerCase(); openTab(g ? `group:${g}` : 'groups'); }, { label: 'Build orchestrator: the Groups board, or one group\'s tab', effect: 'navigate' });
    rt.actions.register('build-orchestrator.group-add', ([arg]) => { const a = splitArg(arg); groupCall('groups', { op: 'assign', groups: [a.group], builds: a.list, mode: 'add' }, `${a.list.join(', ')} → ${a.group}`); }, { label: 'Build orchestrator: put builds in a group (<group>|<build>,<build>)' });
    rt.actions.register('build-orchestrator.group-remove', ([arg]) => { const a = splitArg(arg); groupCall('groups', { op: 'assign', groups: [a.group], builds: a.list, mode: 'remove' }, `${a.list.join(', ')} out of ${a.group}`); }, { label: 'Build orchestrator: take builds out of a group (<group>|<build>,<build>)' });
    rt.actions.register('build-orchestrator.group-action', ([arg]) => { const a = splitArg(arg); const [action = '', priority = ''] = (a.list[0] ?? '').split(':'); groupCall(`groups/${encodeURIComponent(a.group)}/action`, { action, priority }, `${a.group}: ${action}`); }, { label: 'Build orchestrator: a group action (<group>|queue, land, archive or priority:P0)' });
    rt.actions.register('build-orchestrator.start', ([arg]) => {
      const id = decodeURIComponent(arg ?? '');
      if (!id) { void open('pending'); return; }
      void pipeApi.post<{ ok: boolean; error?: string }>('pipeline/queue', { id })
        .then((r) => { if (!r.ok) throw new Error(r.error); rt.toast(`${id} is in the Queue: the dispatcher starts it when its turn comes.`, 'success'); void open('queue'); })
        .catch((e: Error) => rt.toast(e.message, 'danger'));
    }, { label: 'Start a build (put it in the Queue)' });
    rt.actions.register('build-orchestrator.requeue-stuck', ([arg]) => {
      const apply = decodeURIComponent(arg ?? '') === 'apply';
      void pipeApi.post<{ ok: boolean; error?: string; found?: { id: string }[]; moved?: string[] }>('pipeline/requeue-stuck', { apply })
        .then((r) => {
          if (!r.ok) throw new Error(r.error);
          const found = r.found?.length ?? 0;
          rt.toast(apply ? `${r.moved?.length ?? 0} build(s) back in the Queue: their next phase starts when a slot frees.` : found ? `${found} build(s) parked after a finished phase: build-orchestrator.requeue-stuck:apply moves them.` : 'No build is parked after a finished phase.', found || apply ? 'success' : 'info');
          void open(apply ? 'queue' : 'pending');
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
            if (done[0]?.tab) void open(done[0].tab);
          })
          .catch((e: Error) => rt.toast(e.message, 'danger'));
      }, { label: `Build orchestrator: ${ACTION_LABEL[action]} (one build or several, comma separated)` });
    }
    // done-means-merged@1: a build's Attempts tab (deep link row:<build>/tab:attempts) and Retry, the same calls as
    // REST GET attempts/<id> + POST retry/<id>, the MCP commands attempts / retry and orchestrator.mjs attempts | retry.
    // Voice: "what's wrong with <build>", "why did <build> stop" → attempts; "retry <build> [in a fresh session]" → retry.
    const attempts = (arg = '') => { let id = ''; try { id = decodeURIComponent(arg).trim(); } catch { id = arg.trim(); } if (!id) { void open('errors'); return; } showAttempts(id); void open(id); };
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
      address: `row:${r.id}/tab:attempts`, kind: 'tab' as const, label: `${r.title}: attempts`, icon: 'refresh', detail: `Build attempts · ${r.status}`, keywords: [r.id, 'attempts', 'retry', 'failed', r.status].filter(Boolean),
      open: () => rt.dispatch(`build-orchestrator.attempts:${encodeURIComponent(r.id)}`),
    })), ...rows.map((r) => ({
      address: `row:${r.id}`, kind: 'row' as const, label: r.title, icon: 'layers', detail: `Build · ${TAB_NAME[r.tab] ?? r.status}`, keywords: [r.id, r.status, r.tab, r.nextModel].filter(Boolean),
      open: () => rt.dispatch(`build-orchestrator.focus:${encodeURIComponent(r.id)}`),
    }))]; });
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
  views: { 'build-orchestrator': { title: 'Build orchestrator', icon: 'layers', keywords: ['orchestrator', 'builds', 'build manager', 'pending', 'queue', 'active', 'incomplete', 'complete', 'errors', 'archive', 'deleted', 'hold', 'on hold', 'restore', 'groups', 'custom groups', 'custom tabs', 'accounts', 'health', 'fable', 'opus', 'steps', 'phases', 'approve model'], render: () => <OrchestratorPage /> } },
  nav: { label: 'Builds', items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', view: 'build-orchestrator' }] },
  contextMenu: [{ id: 'build-orchestrator.pending', target: 'axf-pending-item', items: [{ id: 'build-orchestrator.open', label: 'Open in Build orchestrator', icon: 'layers', action: 'build-orchestrator.open' }] },
    { id: 'build-orchestrator.default', target: 'default', order: 91, items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', action: 'nav:build-orchestrator' }] }],
  settingsTabs: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', order: 90, parent: 'plugins' }],
  settingsPanels: [{ id: 'build-orchestrator.recovery-watchdog', tab: 'build-orchestrator', title: 'Recovery watchdog', icon: 'shield', order: 21, render: () => <WatchdogSettingsPanel /> },
    { id: 'build-orchestrator.watchdog', tab: 'build-orchestrator', title: 'Watchdog', icon: 'shield', order: 20, render: () => <WatchdogPanel /> },
    { id: 'build-orchestrator.lifecycle', tab: 'build-orchestrator', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

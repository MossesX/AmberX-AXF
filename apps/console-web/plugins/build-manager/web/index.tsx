/**
 * Build manager console plugin (ai.amberx.axf.console.build-manager).
 *
 * Nav → Builds → Build manager: everything still to build in one list (pending items not complete, build-queue steps
 * not done, plan features nothing else covers; one row per build, linked by planId), with time left, steps progress,
 * "needs split" (builds over 30 min without steps), filters, sort and time left per model. A live tracker on top shows
 * what's building right now (activity feed axf.activity@1 + builds marked in progress) with elapsed vs estimate; a
 * compact banner (after the Activity banner) shows while a build from the list runs or just finished.
 *
 * Hooks: action build-manager.open[:<row key or id>], search provider (every build), default context menu, context
 * target axf-build-item on rows, and "Open in Build manager" on Pending builds rows (axf-pending-item).
 * Settings → Plugins → Build manager: banner on/off, default sort, which sources.
 */
import type { AxfRuntime } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { SORT_LABEL, SORTS, SOURCE_LABEL, SOURCES } from './merge.mjs';
import { FOLDER, ID, KEYS, VERSION, fmt, getStore, loadList, requestStart, setFocus, start } from './store';
import { builtRows, liveFromChanges, money } from './history.mjs';
import { BuildBanner, SettingsSummary } from './ui';
import { FLOW_TAB_EVENT, FLOW_TAB_KEY, FlowView, type FlowTab } from './flow';
import './build-manager.css';
import { appMenu, REMAINING } from './menu';

const VIEW = 'build-manager';

/** A row key (`pending:<id>`), or a bare id matched against every source. */
function resolveKey(arg: string): string {
  const rows = getStore().rows;
  if (rows.some((r) => r.key === arg)) return arg;
  return rows.find((r) => r.id === arg || r.planId === arg)?.key ?? '';
}
/** Open the page on Pending or Complete (the deep link every surface uses: console_open, voice, MCP actions). */
function openTab(rt: AxfRuntime, t: FlowTab) {
  try { localStorage.setItem(FLOW_TAB_KEY, t); } catch { /* private window */ }
  globalThis.dispatchEvent?.(new CustomEvent(FLOW_TAB_EVENT, { detail: t }));
  rt.navigate(VIEW);
}
function open(rt: AxfRuntime, arg = '') {
  if (arg === 'pending' || arg === 'complete') { openTab(rt, arg); return; }
  const key = arg ? resolveKey(arg) : '';
  if (key) setFocus(key);
  rt.navigate(VIEW);
  if (arg && !key) void loadList().then(() => { const k = resolveKey(arg); if (k) setFocus(k); });
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Build manager',
  version: VERSION,
  appMenu,
  appMenuProviders: {
    [REMAINING]: {
      max: 12, moreAction: 'build-manager.pending', moreLabel: 'The whole Build manager…',
      items: async () => {
        if (!getStore().loaded) await loadList();
        return getStore().rows.map((r) => ({ id: `build:${r.key}`, label: `${r.title} · ${r.model}${r.left == null ? '' : ` · ${fmt(r.left)} left`}`, icon: r.needsSplit ? 'alert' : 'play', action: `build-manager.open:${encodeURIComponent(r.key)}` }));
      },
    },
  },
  provides: ['axf.build-manager'],
  register(rt) {
    start(rt);
    rt.actions.register('build-manager.open', ([arg]) => open(rt, decodeURIComponent(arg ?? '')), { label: 'Open the Build manager' });
    rt.actions.register('build-manager.refresh', () => void loadList(), { label: 'Refresh the Build manager' });
    // Start build now: opens the row (in the Remaining tab) with its Start panel: plan, approval, launch.
    rt.actions.register('build-manager.start', ([arg]) => {
      const key = resolveKey(decodeURIComponent(arg ?? ''));
      if (!key) { rt.toast('That build isn’t on the remaining list.', 'warning'); return; }
      try { localStorage.setItem('axp-build-manager:tab', 'remaining'); } catch { /* private window */ }
      open(rt, key);
      setTimeout(() => requestStart(key), 60);
    }, { label: 'Start build now' });
    // Split pages (Brett, Nov 9 2026): Pending + Complete here; Live = the orchestrator's Active, Built = Complete
    rt.actions.register('build-manager.pending', () => openTab(rt, 'pending'), { label: 'Build manager: Pending builds' });
    rt.actions.register('build-manager.complete', () => openTab(rt, 'complete'), { label: 'Build manager: Complete builds (account, model, cost, PR)' });
    rt.actions.register('builds.pending', () => openTab(rt, 'pending'), { label: 'Pending builds' });
    rt.actions.register('builds.complete', () => openTab(rt, 'complete'), { label: 'Complete builds' });
    rt.actions.register('build-manager.built', () => openTab(rt, 'complete'), { label: 'Build manager: Complete builds' });
    rt.actions.register('build-manager.live', () => { if (rt.actions.get('builds.active')) rt.dispatch('builds.active'); else openTab(rt, 'pending'); }, { label: 'What’s building now (the orchestrator’s Active tab)' });
    rt.search.add('build-manager.log', () => [
      ...liveFromChanges(getStore().changes, getStore().rows).map((e) => ({
        id: `live:${e.changeId}`, kind: 'build', label: `Building: ${e.title}`, icon: 'refresh',
        detail: `Build manager · Live · ${e.model} · ${e.source}${e.host ? ` · ${e.host}` : ''}${e.costEstimate != null ? ` · ~${money(e.costEstimate)}` : ''}`,
        keywords: [e.changeId, e.model, e.branch, e.surface, e.host].filter(Boolean), focus: { kind: 'action' as const, spec: 'build-manager.live' },
      })),
      ...builtRows(getStore().changes).slice(0, 300).map((r) => ({
        id: `built:${r.id}`, kind: 'build', label: r.title, icon: 'check-circle',
        detail: `Build manager · Built ${r.day} · ${r.model}${r.minutes != null ? ` · ${r.minutesEstimated ? '~' : ''}${fmt(r.minutes)}` : ''}${r.cost != null ? ` · ${r.costEstimated ? '~' : ''}${money(r.cost)}` : ''}`,
        keywords: [r.id, r.model, r.branch, r.surface, ...(r.ref ? [r.ref.id] : [])].filter(Boolean), focus: { kind: 'action' as const, spec: 'build-manager.built' },
      })),
    ]);
    rt.search.add('build-manager.items', () => getStore().rows.map((r) => ({
      id: `build:${r.key}`, kind: 'build', label: r.title, icon: 'play',
      detail: `Build manager · ${SOURCE_LABEL[r.source]} · ${r.model} · ${r.left == null ? 'no estimate' : `${fmt(r.left)} left`}${r.needsSplit ? ' · needs split' : ''}`,
      keywords: [r.id, r.model, r.status, r.source, ...(r.planId ? [r.planId] : []), ...(r.needsSplit ? ['split'] : [])],
      focus: { kind: 'action', spec: `build-manager.open:${encodeURIComponent(r.key)}` },
    })));
    const startItem = (key: string) => ({ id: 'build-manager.start', label: 'Start build now', icon: 'play', action: `build-manager.start:${encodeURIComponent(key)}` });
    rt.contextExtras.set('*:build-manager', (target, payload) => {
      if (!payload) return [];
      if (target === 'axf-build-item' && getStore().rows.some((r) => r.key === payload)) return [startItem(payload)];
      if (target === 'axf-pending-item' && getStore().rows.some((r) => r.key === `pending:${payload}`)) {
        return [{ id: 'build-manager.open', label: 'Open in Build manager', icon: 'play', action: `build-manager.open:${encodeURIComponent(`pending:${payload}`)}` }, startItem(`pending:${payload}`)];
      }
      if (target === 'axf-plan-feature') {
        const r = getStore().rows.find((x) => x.id === payload || x.planId === payload);
        return r ? [{ id: 'build-manager.open', label: 'Open in Build manager', icon: 'play', action: `build-manager.open:${encodeURIComponent(r.key)}` }, startItem(r.key)] : [];
      }
      return [];
    });
  },
  views: { [VIEW]: { title: 'Build manager', icon: 'play', keywords: ['build', 'builds', 'manager', 'pending', 'complete', 'built', 'send to orchestrator', 'cost', 'pr'], render: () => <FlowView /> } },
  nav: { label: 'Builds', items: [{ id: VIEW, label: 'Build manager', icon: 'play', view: VIEW }] },
  contextMenu: [{ id: 'build-manager.default', target: 'default', order: 91, items: [{ id: 'build-manager', label: 'Build manager', icon: 'play', action: 'build-manager.open' }] }],
  // After the Activity banner (order 4), before the approvals banner (5).
  banners: [{ id: 'build-manager', label: 'Builds', icon: 'play', settingsTab: 'build-manager', order: 4.5, render: () => <BuildBanner /> }],
  settingsTabs: [{ id: 'build-manager', label: 'Build manager', icon: 'play', parent: 'plugins', order: 43, description: 'Everything still to build, live tracker and banner.' }],
  settings: [{
    id: 'build-manager.prefs', label: 'Build manager', icon: 'play', tab: 'build-manager', order: 10,
    settings: [
      { key: KEYS.banner, label: 'Banner while a build runs', kind: 'toggle', default: true, description: 'A compact banner at the top while something from the build list is in progress or just finished.' },
      { key: KEYS.sort, label: 'Default sort', kind: 'choice', default: 'order', options: SORTS.map((k) => ({ value: k, label: SORT_LABEL[k] })) },
      { key: KEYS.sources, label: 'Sources', kind: 'multi_choice', default: [...SOURCES], options: SOURCES.map((k) => ({ value: k, label: SOURCE_LABEL[k] })), description: 'Which lists the Build manager reads.' },
    ],
  }],
  settingsPanels: [
    { id: 'build-manager.about', tab: 'build-manager', title: 'About', icon: 'info', order: 5, render: () => <SettingsSummary /> },
    { id: 'build-manager.lifecycle', tab: 'build-manager', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

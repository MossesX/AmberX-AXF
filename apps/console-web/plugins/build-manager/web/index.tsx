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
import { FOLDER, ID, KEYS, VERSION, fmt, getStore, loadList, setFocus, start } from './store';
import { BuildBanner, BuildManagerView, SettingsSummary } from './ui';
import './build-manager.css';

const VIEW = 'build-manager';

/** A row key (`pending:<id>`), or a bare id matched against every source. */
function resolveKey(arg: string): string {
  const rows = getStore().rows;
  if (rows.some((r) => r.key === arg)) return arg;
  return rows.find((r) => r.id === arg || r.planId === arg)?.key ?? '';
}
function open(rt: AxfRuntime, arg = '') {
  const key = arg ? resolveKey(arg) : '';
  if (key) setFocus(key);
  rt.navigate(VIEW);
  if (arg && !key) void loadList().then(() => { const k = resolveKey(arg); if (k) setFocus(k); });
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Build manager',
  version: VERSION,
  provides: ['axf.build-manager'],
  register(rt) {
    start(rt);
    rt.actions.register('build-manager.open', ([arg]) => open(rt, decodeURIComponent(arg ?? '')), { label: 'Open the Build manager' });
    rt.actions.register('build-manager.refresh', () => void loadList(), { label: 'Refresh the Build manager' });
    rt.search.add('build-manager.items', () => getStore().rows.map((r) => ({
      id: `build:${r.key}`, kind: 'build', label: r.title, icon: 'play',
      detail: `Build manager · ${SOURCE_LABEL[r.source]} · ${r.model} · ${r.left == null ? 'no estimate' : `${fmt(r.left)} left`}${r.needsSplit ? ' · needs split' : ''}`,
      keywords: [r.id, r.model, r.status, r.source, ...(r.planId ? [r.planId] : []), ...(r.needsSplit ? ['split'] : [])],
      focus: { kind: 'action', spec: `build-manager.open:${encodeURIComponent(r.key)}` },
    })));
    rt.contextExtras.set('*:build-manager', (target, payload) => {
      if (!payload) return [];
      if (target === 'axf-pending-item' && getStore().rows.some((r) => r.key === `pending:${payload}`)) {
        return [{ id: 'build-manager.open', label: 'Open in Build manager', icon: 'play', action: `build-manager.open:${encodeURIComponent(`pending:${payload}`)}` }];
      }
      if (target === 'axf-plan-feature') {
        const r = getStore().rows.find((x) => x.id === payload || x.planId === payload);
        return r ? [{ id: 'build-manager.open', label: 'Open in Build manager', icon: 'play', action: `build-manager.open:${encodeURIComponent(r.key)}` }] : [];
      }
      return [];
    });
  },
  views: { [VIEW]: { title: 'Build manager', icon: 'play', keywords: ['build', 'builds', 'manager', 'pending', 'queue', 'estimate', 'time left', 'split', 'tracker'], render: () => <BuildManagerView /> } },
  nav: { label: 'Builds', items: [{ id: VIEW, label: 'Build manager', icon: 'play', view: VIEW }] },
  contextMenu: [{ id: 'build-manager.default', target: 'default', order: 91, items: [{ id: 'build-manager', label: 'Build manager', icon: 'play', action: 'build-manager.open' }] }],
  // After the Activity banner (order 4), before the approvals banner (5).
  banners: [{ id: 'build-manager', order: 4.5, render: () => <BuildBanner /> }],
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

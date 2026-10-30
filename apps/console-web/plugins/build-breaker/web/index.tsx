/**
 * Build Breaker console plugin (ai.amberx.axf.console.build-breaker): everything Brett asked for, one line each, by
 * app, by plugin and on a timeline (build-asks@1, data/asks.jsonl + the data folder's live copy). Adds the permanent
 * "Build" item to every context menu (a submenu of every build page) and a Build Breaker button to the Builds pages.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import * as bb from './bb-core.mjs';
import { appMenu } from './menu';
import { buildMenu, CORE_VIEWS } from './buildMenu';
import { BuildBreakerPage, FOLDER, KEYS, OpenBreakerButton, VIEW } from './ui';

const ID = 'ai.amberx.axf.console.build-breaker';

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Build Breaker',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('build-breaker.open', () => rt.navigate(VIEW), { label: 'Open Build Breaker' });
    // the permanent Build item on every context menu (every target)
    const hasView = (v: string) => CORE_VIEWS.includes(v) || rt.libraries.some((l) => l.ui?.views.some((x) => x.id === v));
    rt.contextExtras.set('*:build-breaker', () => buildMenu({ view: hasView, action: (a) => !!rt.actions.get(a) }));
  },
  slots: { 'builds.toolbar': [{ id: 'build-breaker', order: 15, render: () => <OpenBreakerButton /> }] },
  views: { [VIEW]: { title: 'Build Breaker', icon: 'hammer', keywords: ['build breaker', 'asks', 'requests', 'history', 'what I asked', 'built', 'pending', 'cost', 'timeline', 'apps', 'plugins'], render: () => <BuildBreakerPage /> } },
  nav: { label: 'Builds', items: [{ id: 'build-breaker', label: 'Build Breaker', icon: 'hammer', view: 'build-breaker' }] },
  settingsTabs: [{ id: FOLDER, label: 'Build Breaker', icon: 'hammer', parent: 'plugins', order: 43, description: 'Everything you asked for, one line each.' }],
  settings: [{
    id: 'build-breaker.prefs', label: 'Build Breaker', icon: 'hammer', tab: FOLDER, order: 10,
    settings: [
      { key: KEYS.tab, label: 'Opens on', kind: 'choice', default: 'all', options: [{ value: 'all', label: 'All' }, { value: 'apps', label: 'Apps' }, { value: 'plugins', label: 'Plugins' }, { value: 'timeline', label: 'Timeline' }] },
      { key: KEYS.sort, label: 'Default order', kind: 'choice', default: 'newest', options: bb.SORTS.map((s) => ({ value: s.id, label: s.label })) },
      { key: KEYS.range, label: 'Default dates', kind: 'choice', default: 'all', options: bb.RANGES.map((r) => ({ value: r.id, label: r.id === 'all' ? 'All time' : `Last ${r.label}` })) },
    ],
  }],
  settingsPanels: [{ id: 'build-breaker.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

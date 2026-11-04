/**
 * Build Breaker console plugin (ai.amberx.axf.console.build-breaker): the requests ledger (request@1) — every single
 * thing Brett asked for, live, one line each, opening into his exact words, status, place in line, agent, PR, cost and
 * hooks — plus the older asks list by app, by plugin and on a timeline (build-asks@1). A banner badge counts the open
 * requests; the Home card suggestion "What you asked for" reads requests/summary. Adds the permanent "Build" item to
 * every context menu (a submenu of every build page) and a Build Breaker button to the Builds pages.
 */
import type { AxfRuntime } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import * as bb from './bb-core.mjs';
import { appMenu } from './menu';
import { buildMenu, CORE_VIEWS } from './buildMenu';
import { bannerText } from './ledger';
import { BuildBreakerPage, FOLDER, KEYS, OpenBreakerButton, VIEW } from './ui';

const ID = 'ai.amberx.axf.console.build-breaker';
const BADGE_ID = 'build-breaker-requests';
const BANNER_KEY = 'build-breaker.banner';
const BADGE_MS = 60_000;

/** The banner badge: how many requests are still open (queued, running, paused, built awaiting merge…). */
let badgeTimer: ReturnType<typeof setInterval> | null = null;
let lastOpen: number | null = null;
function badge(rt: AxfRuntime, s: { open: number; running: number; queued: number; awaitingMerge: number } | null) {
  const on = rt.settings.get(BANNER_KEY) !== false;
  rt.registry.register({
    $axf: 'asset@1', type: 'badge', id: BADGE_ID, name: 'Requests', version: '0.2.0', author: 'Build Breaker plugin',
    description: 'How many of the things Brett asked for are still open (Build Breaker → Requests).', tags: ['builds', 'requests'],
    data: {
      icon: 'mic', label: s ? bannerText(s.open) : 'Requests', shape: 'pill', tone: s && s.open ? 'accent' : 'muted',
      tooltip: s ? `${s.running} running · ${s.queued} queued · ${s.awaitingMerge} awaiting merge. Tap for the list.` : 'Loading what you asked for…',
      link: `nav:${VIEW}`,
    },
  }, 'app', ID);
  if (on) rt.attachToBanner({ type: 'badge', id: BADGE_ID, at: 'right', order: 40, origin: ID });
  else rt.detachFromBanner(ID);
}
async function tickBadge(rt: AxfRuntime) {
  try {
    const r = await pluginFetch(FOLDER, 'requests/summary');
    const j = await r.json() as { ok?: boolean; open: number; running: number; queued: number; awaitingMerge: number };
    if (j.ok && j.open !== lastOpen) { lastOpen = j.open; badge(rt, j); }
  } catch { /* server part down: keep the last count */ }
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Build Breaker',
  version: '0.2.0',
  appMenu,
  register(rt) {
    rt.actions.register('build-breaker.open', () => rt.navigate(VIEW), { label: 'Open Build Breaker' });
    // the permanent Build item on every context menu (every target)
    const hasView = (v: string) => CORE_VIEWS.includes(v) || rt.libraries.some((l) => l.ui?.views.some((x) => x.id === v));
    rt.contextExtras.set('*:build-breaker', () => buildMenu({ view: hasView, action: (a) => !!rt.actions.get(a) }));
    badge(rt, null);
    void tickBadge(rt);
    if (!badgeTimer) badgeTimer = setInterval(() => { if (document.visibilityState === 'visible') void tickBadge(rt); }, BADGE_MS);
    rt.settings.onChange(BANNER_KEY, () => { lastOpen = null; void tickBadge(rt); badge(rt, null); });
  },
  slots: { 'builds.toolbar': [{ id: 'build-breaker', order: 15, render: () => <OpenBreakerButton /> }] },
  views: { [VIEW]: { title: 'Build Breaker', icon: 'hammer', keywords: ['build breaker', 'asks', 'requests', 'requests ledger', 'what I said', 'verbatim', 'where is it', 'queue position', 'history', 'what I asked', 'built', 'pending', 'cost', 'timeline', 'apps', 'plugins'], render: () => <BuildBreakerPage /> } },
  nav: { label: 'Builds', items: [{ id: 'build-breaker', label: 'Build Breaker', icon: 'hammer', view: 'build-breaker' }] },
  settingsTabs: [{ id: FOLDER, label: 'Build Breaker', icon: 'hammer', parent: 'plugins', order: 43, description: 'Everything you asked for, one line each: the requests ledger and the older asks list.' }],
  settings: [{
    id: 'build-breaker.prefs', label: 'Build Breaker', icon: 'hammer', tab: FOLDER, order: 10,
    settings: [
      { key: BANNER_KEY, label: 'Open requests on the banner', kind: 'toggle', default: true },
      { key: KEYS.tab, label: 'Opens on', kind: 'choice', default: 'requests', options: [{ value: 'requests', label: 'Requests' }, { value: 'all', label: 'Asks' }, { value: 'apps', label: 'Apps' }, { value: 'plugins', label: 'Plugins' }, { value: 'timeline', label: 'Timeline' }] },
      { key: KEYS.sort, label: 'Default order', kind: 'choice', default: 'newest', options: bb.SORTS.map((s) => ({ value: s.id, label: s.label })) },
      { key: KEYS.range, label: 'Default dates', kind: 'choice', default: 'all', options: bb.RANGES.map((r) => ({ value: r.id, label: r.id === 'all' ? 'All time' : `Last ${r.label}` })) },
    ],
  }],
  settingsPanels: [{ id: 'build-breaker.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

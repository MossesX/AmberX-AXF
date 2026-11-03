/**
 * Builds console plugin (ai.amberx.axf.console.builds): the one Builds page over the one builds store (builds@1).
 * Views Pending · Queue · Plan · Tracker · Orchestrator · Steps (see ui.tsx; keys 1–6, `builds.open:<view>[:<query>]`,
 * axf://builds?view=… links, "Open in view…" on build rows); live progress bars per build, step and profile; the banner shows the active
 * profile's percentage (the framework's counter widget), its number animated while a build runs. Targets AmberX too.
 */
import type { AxfRuntime } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { BuildsPage, FOLDER, KEYS, StorePanel, VIEWS, VIEW_OF, api, openBuilds, parseBuildsLink, peekBuilds, type Want } from './ui';

const ID = 'ai.amberx.axf.console.builds-page';
const BANNER_ASSET = 'builds-progress';
const COUNTER = 'builds.pct';
const POLL_MS = 15_000;

/** The banner number: the framework counter widget bound to builds.pct; its label tells the stylesheet to animate it. */
function paint(rt: AxfRuntime, pct: number | null, active: boolean, name: string) {
  rt.setBadge(COUNTER, pct ?? 0);
  rt.registry.register({
    $axf: 'asset@1', type: 'counter', id: BANNER_ASSET, name: 'Builds progress', version: '0.1.0', author: 'Builds plugin',
    description: 'The active build profile\'s progress in percent (steps done of all steps), animated while a build runs.', tags: ['builds', 'progress'],
    data: { counter: COUNTER, tone: active ? 'accent' : 'neutral', hideAtZero: false, max: 100, label: active ? '% building' : '%', link: 'builds.open:orchestrator:filter=open', icon: 'chart' },
  }, 'app', ID);
  if (rt.settings.get(KEYS.banner) !== false && pct != null) rt.attachToBanner({ type: 'counter', id: BANNER_ASSET, at: 'right', order: 24, origin: ID });
  else rt.detachFromBanner(`counter:${BANNER_ASSET}`);
  void name;
}

/** `builds.open:<view>[:<query>]`: open the page on a view, e.g. `builds.open:pending:filter=open&q=grid`. */
function openAction(rt: AxfRuntime, [v, query]: (string | undefined)[]) {
  const w: Want = { ...parseBuildsLink(decodeURIComponent(query ?? '')), ...(v && VIEW_OF[v] ? { view: VIEW_OF[v] } : {}) };
  openBuilds(rt, w);
}
/** A deep link in the address (`#builds?view=…` or `?axf=axf://builds?view=…`) opens the page once at start. */
function openFromAddress(rt: AxfRuntime) {
  if (typeof location === 'undefined') return;
  const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
  const q = new URLSearchParams(location.search).get('axf') ?? '';
  const href = /^\/?builds\b/.test(hash) ? hash : /^axf:\/\/builds\b/.test(q) ? q : '';
  if (href) openBuilds(rt, parseBuildsLink(href));
}

let started = false;
function start(rt: AxfRuntime) {
  if (started) return; started = true;
  const tick = async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    try { const r = await api.call<{ ok: boolean; profile: string; progress: { pct: number; active: boolean } }>('progress'); if (r.ok) paint(rt, r.progress.pct, r.progress.active, r.profile); }
    catch { paint(rt, null, false, ''); }
  };
  void tick();
  setInterval(() => void tick(), POLL_MS);
  globalThis.addEventListener?.('focus', () => void tick());
  rt.settings.onChange(KEYS.banner, () => void tick());
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Builds',
  version: '0.1.0',
  appMenu,
  builtWith: { model: 'opus', builtAt: '2026-10-31' },
  register(rt) {
    rt.actions.register('builds.open', (p) => openAction(rt, p), { label: 'Open the Builds page', params: true });
    rt.actions.register('builds.view', ([v]) => openAction(rt, [v ?? '']), { label: 'Builds page view', params: true, searchable: false });
    rt.actions.register('builds.link', ([href]) => openBuilds(rt, parseBuildsLink(decodeURIComponent(href ?? ''))), { label: 'Open an axf://builds link', params: true, searchable: false });
    for (const v of VIEWS) rt.actions.register(`builds.view.${v.value}`, () => openBuilds(rt, { view: v.value }), { label: `Builds: ${v.label} view` });
    // "Open in view…" on any build row, pending card or plan feature (payload = the build / item / feature id)
    rt.contextExtras.set('*:builds-page', (target, payload = '') => {
      const id = target === 'axf-grid-row' ? (payload.startsWith('build:') ? payload.slice(6) : '') : ['axf-pending-item', 'axf-plan-feature', 'axf-build-item'].includes(target ?? '') ? payload.replace(/^pending:/, '') : '';
      if (!id) return [];
      return [{ id: 'builds.open-in', label: 'Open in view…', icon: 'external', items: VIEWS.map((v) => ({ id: `builds.open-in.${v.value}`, label: v.label, icon: v.icon, action: `builds.open:${v.value}:${encodeURIComponent(`build=${id}`)}` })) }];
    });
    // search: every build of the profile shown, straight to its row
    rt.search.add('builds-page.builds', () => (peekBuilds()?.builds ?? []).map((b) => ({
      id: `builds:${b.id}`, kind: 'build', label: b.title, icon: 'list', detail: `Builds · ${b.status} · ${b.progress.done}/${b.progress.total} steps`,
      keywords: [b.id, b.status, b.category, b.model], focus: { kind: 'action', spec: `builds.open:pending:${encodeURIComponent(`build=${b.id}`)}` },
    })));
    start(rt);
    openFromAddress(rt);
  },
  views: { builds: { title: 'Builds', icon: 'list', keywords: ['builds', 'steps', 'harvest', 'progress', 'pending', 'queue', 'build queue', 'plan', 'tracker', 'orchestrator', 'rename', 'restore default', 'archive', 'hide'], render: () => <BuildsPage /> } },
  nav: { label: 'Builds', items: [{ id: 'builds', label: 'Builds', icon: 'list', view: 'builds' }] }, // literal ids: scripts/menu-reach.mts reads them (= VIEW); the old pages' nav ids redirect to their view
  settingsTabs: [{ id: FOLDER, label: 'Builds', icon: 'list', order: 88, parent: 'plugins', description: 'The one Builds page: views, selection, the banner number.' }],
  settings: [{
    id: 'builds.look', label: 'Builds page', icon: 'list', tab: FOLDER, order: 5,
    settings: [
      { key: KEYS.banner, label: 'Show the build profile\'s percentage on the banner', kind: 'toggle', default: true, scope: 'device' },
      { key: KEYS.view, label: 'View the page opens on', kind: 'choice', default: 'pending', options: VIEWS.map((v) => ({ value: v.value, label: v.label })) },
      { key: KEYS.select, label: 'Steps view: also show a selection control on every row', kind: 'choice', default: 'off', options: [{ value: 'off', label: 'No (Ctrl+click / long-press)' }, { value: 'checkboxes', label: 'Checkboxes' }, { value: 'switches', label: 'Switches' }] },
    ],
  }],
  settingsPanels: [
    { id: 'builds.store', tab: FOLDER, title: 'Builds store', icon: 'box', order: 10, render: () => <StorePanel /> },
    { id: 'builds.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

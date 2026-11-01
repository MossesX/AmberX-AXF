/**
 * Builds console plugin (ai.amberx.axf.console.builds): the one Builds page over the one builds store (builds@1).
 * Views Builds and Steps (see ui.tsx); live progress bars per build, step and profile; the banner shows the active
 * profile's percentage (the framework's counter widget), its number animated while a build runs. Targets AmberX too.
 */
import type { AxfRuntime } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { BuildsPage, FOLDER, KEYS, StorePanel, VIEW, api } from './ui';

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
    data: { counter: COUNTER, tone: active ? 'accent' : 'neutral', hideAtZero: false, max: 100, label: active ? '% building' : '%', link: `nav:${VIEW}`, icon: 'chart' },
  }, 'app', ID);
  if (rt.settings.get(KEYS.banner) !== false && pct != null) rt.attachToBanner({ type: 'counter', id: BANNER_ASSET, at: 'right', order: 24, origin: ID });
  else rt.detachFromBanner(`counter:${BANNER_ASSET}`);
  void name;
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
    rt.actions.register('builds.open', () => rt.navigate(VIEW), { label: 'Open the Builds page' });
    start(rt);
  },
  views: { builds: { title: 'Builds', icon: 'list', keywords: ['builds', 'steps', 'harvest', 'progress', 'pending', 'queue', 'orchestrator', 'rename', 'restore default'], render: () => <BuildsPage /> } },
  nav: { label: 'Builds', items: [{ id: 'builds', label: 'Builds', icon: 'list', view: 'builds' }] }, // literal ids: scripts/menu-reach.mts reads them (= VIEW)
  settingsTabs: [{ id: FOLDER, label: 'Builds', icon: 'list', order: 88, parent: 'plugins', description: 'The one Builds page: views, selection, the banner number.' }],
  settings: [{
    id: 'builds.look', label: 'Builds page', icon: 'list', tab: FOLDER, order: 5,
    settings: [
      { key: KEYS.banner, label: 'Show the build profile\'s percentage on the banner', kind: 'toggle', default: true, scope: 'device' },
      { key: KEYS.select, label: 'Steps view: also show a selection control on every row', kind: 'choice', default: 'off', options: [{ value: 'off', label: 'No (Ctrl+click / long-press)' }, { value: 'checkboxes', label: 'Checkboxes' }, { value: 'switches', label: 'Switches' }] },
    ],
  }],
  settingsPanels: [
    { id: 'builds.store', tab: FOLDER, title: 'Builds store', icon: 'box', order: 10, render: () => <StorePanel /> },
    { id: 'builds.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

/**
 * Push banner console plugin (ai.amberx.axf.console.push-banner).
 *
 * A banner (order 4.8, after Codebase changes) whenever any watched repo (default AmberX-AXF, axHub) has a
 * branch ahead of its default branch: repo, branch, commits ahead/behind, age, last commit, its open PR and that PR's CI.
 * Open PR opens one into main (auto-merge opens one for every branch); Merge (twice, to confirm) merges it once it is up to date with main and CI has passed; ✕ hides a branch on every device.
 * main is never pushed to directly.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { BANNER_KEY, FOLDER, ID, VERSION, load, start } from './store';
import { PushBanner, PushSettings } from './ui';
import { MergeQueueView } from './queue';
import { focusConfirm, loadConfirms, recheck, unconfirmedIds } from './confirm';
import { appMenu } from './menu';
import './push-banner.css';

export const plugin: AxfWebLibrary = {
  appMenu,
  id: ID, // equals plugin.json "id"
  label: 'Push banner',
  version: VERSION,
  register(rt) {
    start();
    rt.actions.register('push-banner.queue', () => rt.dispatch('settings.open:push-banner'), { label: 'Merge queue' });
    // Deep link (console_show / console_open target push-banner/merge-confirm/<owner/repo>#<pr>): push-banner.focus:<focus> opens
    // Settings → Plugins → Push banner with that merge confirmation highlighted; 'queue' opens the merge queue.
    rt.actions.register('push-banner.focus', ([enc = '']) => {
      const f = decodeURIComponent(String(enc)).replace(/^push-banner\//, '');
      rt.dispatch('settings.open:push-banner');
      if (f.startsWith('merge-confirm')) focusConfirm(f.replace(/^merge-confirm\/?/, ''));
    }, { label: 'Open a merge confirmation (deep link)', params: true, effect: 'navigate' });
    // Voice (AmberX) and console action: merge.recheck[:<owner/repo>#<pr>] reads the PR back from GitHub now (never merges);
    // with no PR, every merge GitHub hasn't confirmed. Same as REST POST merge-confirm/recheck, MCP push_banner_mergeconfirm_recheck.
    rt.actions.register('merge.recheck', async ([enc = '']) => {
      const one = decodeURIComponent(String(enc)).trim().toLowerCase();
      if (!one) await loadConfirms();
      const ids = one ? [one] : unconfirmedIds();
      if (!ids.length) { rt.toast('Every merge is confirmed by GitHub.', 'info', 'Merge confirmations'); return; }
      const out: string[] = [];
      for (const id of ids.slice(0, 10)) { const r = await recheck(id); out.push(`${id}: ${r?.label || r?.state || 'no answer'}`); }
      rt.toast(out.join('; '), 'info', 'Merge confirmations');
    }, { label: 'Recheck a merge with GitHub', params: true });
    rt.actions.register('push-banner.check', () => { void load(true); rt.toast('Checking every branch against main…', 'info', 'Push banner'); }, { label: 'Check branches not on main' });
  },
  // After Codebase changes (4.7), before the approvals banner (5).
  banners: [{ id: 'push-banner', label: 'Branches not on main', icon: 'branch', workIcon: 'upload', workAnim: 'bounce', settingsTab: 'push-banner', order: 4.8, render: () => <PushBanner /> }],
  settingsTabs: [{ id: 'push-banner', label: 'Push banner', icon: 'branch', parent: 'plugins', order: 45, description: 'Branches not on main, with Open PR and Merge.' }],
  settings: [{
    id: 'push-banner.prefs', label: 'Push banner', icon: 'branch', tab: 'push-banner', order: 10,
    settings: [
      { key: BANNER_KEY, label: 'Banner on every load', kind: 'toggle', default: true, description: 'Show the banner while any watched repo has a branch that isn’t on main (this browser).' },
    ],
  }],
  settingsPanels: [
    { id: 'push-banner.queue', tab: 'push-banner', title: 'Merge queue', icon: 'branch', order: 3, render: () => <MergeQueueView /> },
    { id: 'push-banner.branches', tab: 'push-banner', title: 'Branches', icon: 'branch', order: 5, render: () => <PushSettings /> },
    { id: 'push-banner.lifecycle', tab: 'push-banner', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

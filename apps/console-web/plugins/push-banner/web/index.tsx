/**
 * Push banner console plugin (ai.amberx.axf.console.push-banner).
 *
 * A banner (order 4.8, after Codebase changes) whenever any watched repo (default AmberX-AXF, axHub, Build-Pilot) has a
 * branch ahead of its default branch: repo, branch, commits ahead/behind, age, last commit, its open PR and that PR's CI.
 * Open PR opens one into main; Merge (twice, to confirm) merges it once CI has passed; ✕ hides a branch on every device.
 * main is never pushed to directly. Shown above every tab in Patches through the console's banner strip.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { BANNER_KEY, FOLDER, ID, VERSION, load, start } from './store';
import { PushBanner, PushSettings } from './ui';
import { appMenu } from './menu';
import './push-banner.css';

export const plugin: AxfWebLibrary = {
  appMenu,
  id: ID, // equals plugin.json "id"
  label: 'Push banner',
  version: VERSION,
  register(rt) {
    start();
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
    { id: 'push-banner.branches', tab: 'push-banner', title: 'Branches', icon: 'branch', order: 5, render: () => <PushSettings /> },
    { id: 'push-banner.lifecycle', tab: 'push-banner', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

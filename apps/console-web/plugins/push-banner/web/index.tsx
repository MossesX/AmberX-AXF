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
import { LOCAL_COMMANDS, LOG_TARGET, LOG_VIEW, MergeLogPage, ROW_COMMANDS, gateCommand, gateDoc, loadGate, runLocal, selectionFor } from './gate';
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
    rt.actions.register('push-banner.check', () => { void load(true); rt.toast('Checking every branch against main…', 'info', 'Push banner'); }, { label: 'Check branches not on main' });
    // merge gate (Nov 11 2026): the Merge log page and every row command as a console action (voice, palette, right-click).
    // push-banner.gate.<cmd>:<build|pr>[,<build|pr>…]; with no argument, retry / clear act on every red one.
    rt.actions.register('push-banner.merge-log', () => rt.navigate(LOG_VIEW), { label: 'Open the merge log (failed merges, auto-fixes, rebuilds)' });
    for (const c of ROW_COMMANDS) {
      rt.actions.register(`push-banner.gate.${c.cmd}`, ([arg]) => {
        const ids = String(arg ?? '').split(',').map((x) => decodeURIComponent(x).trim()).filter(Boolean);
        const body = ids.length ? { ids } : ['retry', 'clear', 'archive'].includes(c.cmd) ? { group: 'failed' } : null;
        if (!body) { rt.toast(`${c.label}: say which build`, 'warning', 'Merge log'); return; }
        gateCommand(c.cmd, body).then((n) => rt.toast(`${c.label}: ${ids.length ? ids.join(', ') : 'every red one'}. ${n}`, 'info', 'Merge log'), (e: Error) => rt.toast(e.message, 'danger', 'Merge log'));
      }, { label: `Merge gate: ${c.label.toLowerCase()}${c.cmd === 'retry' ? ' (retry the failed merges)' : c.cmd === 'rebuild' ? ' (rebuild X)' : c.cmd === 'clear' ? ' (clear the reds)' : ''}`, params: true });
    }
    rt.contextExtras.set('*:push-banner-gate', (target, payload) => {
      if (target !== LOG_TARGET || !payload) return [];
      const ids = selectionFor(String(payload));
      const arg = ids.map(encodeURIComponent).join(',');
      return [
        ...ROW_COMMANDS.map((c) => ({ id: `push-banner.gate.${c.cmd}`, label: ids.length > 1 ? `${c.label} (${ids.length})` : c.label, icon: c.icon, action: `push-banner.gate.${c.cmd}:${arg}` })),
        ...LOCAL_COMMANDS.map((c) => ({ id: `push-banner.gate.${c.id}`, label: c.label, icon: c.icon, action: `push-banner.gate-local.${c.id}:${encodeURIComponent(String(payload))}` })),
      ];
    });
    for (const c of LOCAL_COMMANDS) {
      rt.actions.register(`push-banner.gate-local.${c.id}`, async ([arg]) => {
        if (!gateDoc()) await loadGate();
        runLocal(rt, c.id, gateDoc()?.entries.find((e) => e.id === decodeURIComponent(String(arg ?? ''))));
      }, { label: `Merge log: ${c.label.toLowerCase()}`, params: true, searchable: false });
    }
  },
  // After Codebase changes (4.7), before the approvals banner (5).
  banners: [{ id: 'push-banner', label: 'Branches not on main', icon: 'branch', workIcon: 'upload', workAnim: 'bounce', settingsTab: 'push-banner', order: 4.8, render: () => <PushBanner /> }],
  views: { [LOG_VIEW]: { title: 'Merge log', icon: 'branch', keywords: ['merge log', 'merge gate', 'failed merges', 'auto-fix', 'rebuild', 'rebuilt', 'retry', 'clear reds', 'blocked', 'conflict', 'red', 'landing'], render: () => <MergeLogPage /> } },
  nav: { label: 'Builds', items: [{ id: 'merge-log', label: 'Merge log', icon: 'branch', view: LOG_VIEW }] },
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

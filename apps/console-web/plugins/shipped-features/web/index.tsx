import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginApi } from '@console/plugins';
import { ACTIVE_BADGE, appMenu } from './menu';
import * as L from '@console/axf/core/feature-ledger.mjs';
import { FOLDER, KEYS, ShippedFeaturesPage, VIEW, focusShipped } from './ui';

const api = pluginApi(FOLDER, 'Shipped features');
let timer = 0;
let offs: (() => void)[] = [];

/** Shipped features: every feature from planned to live, with its edits (feature-ledger@1). */
export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.shipped-features', // = plugin.json "id"
  label: 'Shipped features',
  version: '0.1.0',
  appMenu,
  views: { [VIEW]: { title: 'Shipped features', icon: 'check-circle', render: () => <ShippedFeaturesPage /> } },
  nav: { label: 'Builds', items: [{ id: VIEW, label: 'Shipped features', icon: 'check-circle', view: VIEW }] },
  settingsTabs: [{ id: FOLDER, label: 'Shipped features', icon: 'check-circle', order: 90, parent: 'plugins' }],
  settings: [{
    id: 'shipped-features.prefs', label: 'Shipped features', icon: 'check-circle', tab: FOLDER, order: 10,
    settings: [
      { key: KEYS.groupBy, label: 'Group by (on a device that has no view of its own yet)', kind: 'choice', default: 'pr', options: L.GROUPINGS.map((g) => ({ value: g, label: L.GROUPING_LABEL[g as keyof typeof L.GROUPING_LABEL] })) },
      { key: KEYS.badge, label: 'Count features being worked on in the nav', kind: 'toggle', default: true },
      { key: KEYS.badgeMinutes, label: 'Refresh that count every (minutes)', kind: 'number', default: 2, min: 1, max: 60 },
    ],
  }],
  register(rt) {
    // the nav badge (features being worked on): on / off and how often it refreshes are options (KEYS.badge, KEYS.badgeMinutes)
    const tick = () => {
      if (rt.settings.get(KEYS.badge) === false) { rt.setBadge(ACTIVE_BADGE, 0); return; }
      api.call<{ active?: number }>('summary').then((r) => rt.setBadge(ACTIVE_BADGE, Number(r.active) || 0), () => rt.setBadge(ACTIVE_BADGE, 0));
    };
    const every = () => Math.max(1, Number(rt.settings.get(KEYS.badgeMinutes)) || 2) * 60_000;
    const restart = () => { window.clearInterval(timer); tick(); timer = window.setInterval(tick, every()); };
    restart();
    offs.forEach((off) => off()); // register runs again when the plugin list changes
    offs = [rt.settings.onChange(KEYS.badge, restart), rt.settings.onChange(KEYS.badgeMinutes, restart)];
    rt.actions.register('shipped-features.open', () => rt.navigate(VIEW), { label: 'Open Shipped features' });
    rt.actions.register('shipped-features.show', (args, ctx) => { const id = (args.length ? args.join(':') : ctx.payload ?? '').trim(); if (!id) { rt.toast('Say which build or feature, e.g. orchestrator-only-launcher.', 'warning', 'Shipped features'); return; } rt.navigate(VIEW); focusShipped(id); }, { label: 'Show a build or feature in Shipped features', params: true });
    rt.actions.register('shipped-features.sync', () => { void api.post('sync', {}).then(() => rt.toast('Syncing builds, PRs and deploys…', 'info', 'Shipped features'), (e: Error) => rt.toast(e.message, 'danger', 'Shipped features')); }, { label: 'Sync Shipped features now' });
  },
  settingsPanels: [{ id: `${FOLDER}.lifecycle`, tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

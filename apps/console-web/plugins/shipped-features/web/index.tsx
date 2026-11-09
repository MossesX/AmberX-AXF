import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginApi } from '@console/plugins';
import { ACTIVE_BADGE, appMenu } from './menu';
import { FOLDER, ShippedFeaturesPage, VIEW, focusShipped } from './ui';

const api = pluginApi(FOLDER, 'Shipped features');
let timer = 0;

/** Shipped features: every feature from planned to live, with its edits (feature-ledger@1). */
export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.shipped-features', // = plugin.json "id"
  label: 'Shipped features',
  version: '0.1.0',
  appMenu,
  views: { [VIEW]: { title: 'Shipped features', icon: 'check-circle', render: () => <ShippedFeaturesPage /> } },
  nav: { label: 'Builds', items: [{ id: VIEW, label: 'Shipped features', icon: 'check-circle', view: VIEW }] },
  settingsTabs: [{ id: FOLDER, label: 'Shipped features', icon: 'check-circle', order: 90, parent: 'plugins' }],
  register(rt) {
    const tick = () => { api.call<{ active?: number }>('summary').then((r) => rt.setBadge(ACTIVE_BADGE, Number(r.active) || 0), () => rt.setBadge(ACTIVE_BADGE, 0)); };
    tick(); window.clearInterval(timer); timer = window.setInterval(tick, 120_000);
    rt.actions.register('shipped-features.open', () => rt.navigate(VIEW), { label: 'Open Shipped features' });
    rt.actions.register('shipped-features.show', (args, ctx) => { const id = (args.length ? args.join(':') : ctx.payload ?? '').trim(); if (!id) { rt.toast('Say which build or feature, e.g. orchestrator-only-launcher.', 'warning', 'Shipped features'); return; } rt.navigate(VIEW); focusShipped(id); }, { label: 'Show a build or feature in Shipped features', params: true });
    rt.actions.register('shipped-features.sync', () => { void api.post('sync', {}).then(() => rt.toast('Syncing builds, PRs and deploys…', 'info', 'Shipped features'), (e: Error) => rt.toast(e.message, 'danger', 'Shipped features')); }, { label: 'Sync Shipped features now' });
  },
  settingsPanels: [{ id: `${FOLDER}.lifecycle`, tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

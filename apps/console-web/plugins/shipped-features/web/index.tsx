import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginApi } from '@console/plugins';
import { ACTIVE_BADGE, appMenu } from './menu';
import { CELL_TARGET, FOLDER, ROW_TARGET, ShippedFeaturesPage, VIEW, applyShippedView, focusShipped, rowLink, shownRows } from './ui';
import * as T from '../ledger/table.mjs';

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
    // the table's view from outside the UI (MCP console actions, voice, CLI via the console): JSON or by=… sort=col:dir,… pairs
    rt.actions.register('shipped-features.view', (args, ctx) => {
      const raw = (args.length ? args.join(':') : ctx.payload ?? '').trim();
      let v: Partial<T.TableView> = {};
      try { v = raw.startsWith('{') ? JSON.parse(raw) : Object.fromEntries(raw.split(/[;&]/).filter(Boolean).map((kv) => { const [k0, x = ''] = kv.split('='); const k = (k0 ?? '').trim(); return [k, k === 'sort' ? x.split(',').map((c) => { const [col = '', dir] = c.split(/[: ]/); return { col, dir: dir === 'asc' ? 'asc' : 'desc' }; }) : ['statuses', 'plugins', 'hidden', 'order'].includes(k) ? x.split(',').filter(Boolean) : x === 'true' ? true : x === 'false' ? false : x]; }).map(([k, x]) => [k === 'sort' ? 'sorts' : k, x])); } catch { rt.toast('That view is not JSON or key=value pairs.', 'warning', 'Shipped features'); return; }
      rt.navigate(VIEW); applyShippedView(v);
    }, { label: 'Shipped features: group, sort, filter or pick columns (JSON view or by=area;sort=shipped:desc;statuses=live)', params: true });
    rt.actions.register('shipped-features.row', ([what = '', id = '', col = '']) => {
      const r = shownRows.get(decodeURIComponent(id)); if (!r) return;
      const copy = (text: string, what: string) => { void globalThis.navigator?.clipboard?.writeText(text).then(() => rt.toast(`${what} copied.`, 'info'), () => rt.toast(text, 'info', `Copy this ${what.toLowerCase()}`)); };
      if (what === 'open') { rt.navigate(VIEW); focusShipped(r.id); }
      else if (what === 'build' && r.build) { rt.navigate(VIEW); focusShipped(r.build); }
      else if (what === 'pr' && r.prUrl) window.open(r.prUrl, '_blank', 'noopener');
      else if (what === 'link') copy(rowLink(r), 'Link');
      else if (what === 'cell') copy(T.cellText(r, decodeURIComponent(col)), 'Value');
      else if (what === 'remove') void api.post<{ ok: boolean }>('remove', { feature: r.id, by: 'console' }).then(() => rt.toast(`${r.name} marked removed.`, 'info', 'Shipped features'), (e: Error) => rt.toast(e.message, 'danger', 'Shipped features'));
    }, { label: 'Shipped features row: open, open build, open PR, copy link, copy value, mark removed', params: true });
    const rowMenu = (id: string, col = '') => {
      const r = shownRows.get(id); if (!r) return [];
      const a = (what: string) => `shipped-features.row:${what}:${encodeURIComponent(id)}${col ? `:${encodeURIComponent(col)}` : ''}`;
      return [
        { id: 'sf-open', label: 'Open feature', icon: 'chevron-down', action: a('open') },
        ...(r.build ? [{ id: 'sf-build', label: `Open build ${r.build}`, icon: 'layers', action: a('build') }] : []),
        ...(r.prUrl ? [{ id: 'sf-pr', label: `Open PR #${r.pr}`, icon: 'github', action: a('pr') }] : []),
        { id: 'sf-link', label: 'Copy link', icon: 'copy', action: a('link') },
        ...(col ? [{ id: 'sf-cell', label: `Copy ${T.COLUMNS.find((c) => c.id === col)?.label ?? col}`, icon: 'copy', action: a('cell') }] : []),
        ...(r.status !== 'removed' ? [{ id: 'sf-remove', label: 'Mark removed', icon: 'trash', action: a('remove') }] : []),
      ];
    };
    rt.contextExtras.set(ROW_TARGET, (_t, payload = '') => rowMenu(payload));
    rt.contextExtras.set(CELL_TARGET, (_t, payload = '') => { const [id, col] = payload.split('|'); return rowMenu(id ?? '', col ?? ''); });
    rt.actions.register('shipped-features.sync', () => { void api.post('sync', {}).then(() => rt.toast('Syncing builds, PRs and deploys…', 'info', 'Shipped features'), (e: Error) => rt.toast(e.message, 'danger', 'Shipped features')); }, { label: 'Sync Shipped features now' });
  },
  settingsPanels: [{ id: `${FOLDER}.lifecycle`, tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

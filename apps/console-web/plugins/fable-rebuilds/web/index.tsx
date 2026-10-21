import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, ID, getData, refresh, setFocus, park } from './api';
import { FableChip, FableView, OpusNow, ReportDialog } from './ui';
import './fable-rebuilds.css';
import { appMenu } from './menu';

/*
 * Fable rebuilds: every build parked for Fable, in one view, with hooks wherever a rebuild comes up:
 *  - nav (Builds → Fable rebuilds), action fable-rebuilds.open[:<id>], search
 *  - the default context menu (right-click / long-press anywhere)
 *  - Plugin Manager rows (target plugin-manager.row): open its Fable rebuild, or park one
 *  - Plan features (target axf-plan-feature + slot plan.feature): open or "Rebuild on Fable"
 *  - Pending builds rows (target axf-pending-item + slot pending.item): open a Fable item here
 *  - Settings → Plugins → Fable rebuilds
 */
const open = (rt: { navigate(v: string): void }, id = '') => { if (id) setFocus(id); rt.navigate('fable-rebuilds'); };

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Fable rebuilds',
  version: '0.1.0',
  appMenu,
  provides: ['axf.fable-rebuilds'],
  register(rt) {
    void refresh();
    rt.actions.register('fable-rebuilds.open', ([id]) => open(rt, decodeURIComponent(id ?? '')), { label: 'Open Fable rebuilds', keywords: ['fable', 'rebuild', 'pending'] } as never);
    rt.actions.register('fable-rebuilds.park-plugin', ([folder]) => {
      void park({ plugin: decodeURIComponent(folder ?? '') }).then((it) => { rt.toast(`Parked for Fable: ${it.title}`, 'success'); open(rt, it.id); }, (e) => rt.toast((e as Error).message, 'danger'));
    }, { label: 'Park a Fable rebuild of a plugin', params: true, searchable: false });
    rt.actions.register('fable-rebuilds.park-feature', ([fid]) => {
      void park({ planId: decodeURIComponent(fid ?? '') }).then((it) => { rt.toast(`Parked for Fable: ${it.title}`, 'success'); open(rt, it.id); }, (e) => rt.toast((e as Error).message, 'danger'));
    }, { label: 'Park a Fable rebuild of a plan feature', params: true, searchable: false });
    rt.contextExtras.set('*:fable-rebuilds', (target, payload) => {
      const d = getData();
      if (!d || !payload) return [];
      if (target === 'plugin-manager.row') {
        const rid = d.byPlugin[payload];
        return rid ? [{ id: 'fable-rebuilds.open', label: 'Fable rebuild', icon: 'sparkles', action: `fable-rebuilds.open:${encodeURIComponent(rid)}` }]
          : [{ id: 'fable-rebuilds.park', label: 'Rebuild on Fable…', icon: 'sparkles', action: `fable-rebuilds.park-plugin:${encodeURIComponent(payload)}` }];
      }
      if (target === 'axf-plan-feature') {
        const rid = d.byPlan[payload];
        return rid ? [{ id: 'fable-rebuilds.open', label: 'Fable rebuild', icon: 'sparkles', action: `fable-rebuilds.open:${encodeURIComponent(rid)}` }]
          : [{ id: 'fable-rebuilds.park', label: 'Rebuild on Fable', icon: 'sparkles', action: `fable-rebuilds.park-feature:${encodeURIComponent(payload)}` }];
      }
      if (target === 'axf-pending-item' && d.items.some((i) => i.id === payload)) {
        return [{ id: 'fable-rebuilds.open', label: 'Open in Fable rebuilds', icon: 'sparkles', action: `fable-rebuilds.open:${encodeURIComponent(payload)}` }];
      }
      return [];
    });
    window.addEventListener('axf:pending-changed', () => void refresh());
    window.addEventListener('axf:plan-changed', () => void refresh());
  },
  views: { 'fable-rebuilds': { title: 'Fable rebuilds', icon: 'sparkles', keywords: ['fable', 'rebuild', 'pending', 'opus'], render: () => <FableView /> } },
  nav: { label: 'Builds', items: [{ id: 'fable-rebuilds', label: 'Fable rebuilds', icon: 'sparkles', view: 'fable-rebuilds' }] },
  contextMenu: [
    { id: 'fable-rebuilds.default', target: 'default', order: 92, items: [{ id: 'fable-rebuilds', label: 'Fable rebuilds', icon: 'sparkles', action: 'fable-rebuilds.open' }] },
  ],
  slots: {
    'plan.feature': [{ id: 'fable-rebuilds.feature', order: 30, render: (p) => {
      const f = p.feature as { id: string; title?: string } | undefined;
      if (!f) return null;
      return <FableChip rebuildId={getData()?.byPlan[f.id]} park={{ planId: f.id, title: f.title }} />;
    } }],
    'pending.item': [{ id: 'fable-rebuilds.pending', order: 30, render: (p) => {
      const it = p.item as { id: string; model: string } | undefined;
      return it?.model === 'Fable' ? <><FableChip rebuildId={it.id} label="Open in Fable rebuilds" /><OpusNow id={it.id} /></> : null;
    } }],
  },
  dialogs: {
    'fable-rebuilds.report': { title: 'Differences report', icon: 'file', render: (props) => <ReportDialog id={String(props.id ?? '')} /> },
  },
  settingsTabs: [{ id: 'fable-rebuilds', label: 'Fable rebuilds', icon: 'sparkles', parent: 'plugins', order: 44, description: 'Builds parked for Fable: what they replace, briefs, reports and screenshots.' }],
  settingsPanels: [
    { id: 'fable-rebuilds.about', tab: 'fable-rebuilds', title: 'Fable rebuilds', icon: 'sparkles', order: 10, render: () => <p className="fx-small" style={{ margin: 0 }}>Open it from the nav (Builds → Fable rebuilds), the default context menu, a Plugin Manager row, a Plan feature or a Pending builds row. Parking a rebuild adds a Fable item to the pending list.</p> },
    { id: 'fable-rebuilds.lifecycle', tab: 'fable-rebuilds', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

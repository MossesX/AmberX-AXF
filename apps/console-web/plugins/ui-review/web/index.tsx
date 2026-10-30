/**
 * UI Review console plugin (ai.amberx.axf.console.ui-review): every UI a build makes waits here for Brett's approval,
 * one section per kind (open registry), five views with multi-select and bulk decisions. Design packs (formerly their
 * own plugin) are its first section; View → Design packs opens straight onto it.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import * as core from './review-core.mjs';
import { appMenu } from './menu';
import { FOLDER, GROUP_BYS, ID, KEYS, PACKS_VIEW, VIEW, VIEWS } from './keys';
import { UiReviewPage } from './ui';

const KEYWORDS = ['ui review', 'review', 'approve', 'approval', 'screenshots', 'design', 'ui', 'reject', 'changes', 'waiting'];

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'UI Review',
  version: '0.2.0',
  appMenu,
  register(rt) {
    rt.actions.register('ui-review.open', () => rt.navigate(VIEW), { label: 'Open UI Review' });
    rt.actions.register('ui-review.design-packs', () => rt.navigate(PACKS_VIEW), { label: 'Open Design packs' });
  },
  views: {
    [VIEW]: { title: 'UI Review', icon: 'eye', keywords: KEYWORDS, render: () => <UiReviewPage /> },
    [PACKS_VIEW]: { title: 'Design packs', icon: 'palette', keywords: ['design', 'packs', 'look', 'theme', 'refactor', 'pick'], render: () => <UiReviewPage section={core.DESIGN_KIND} /> },
  },
  nav: { label: 'Plugins', items: [{ id: 'ui-review', label: 'UI Review', icon: 'eye', view: 'ui-review' }, { id: 'design-packs', label: 'Design packs', icon: 'palette', view: 'design-packs' }] },
  settingsTabs: [{ id: FOLDER, label: 'UI Review', icon: 'eye', parent: 'plugins', order: 46, description: 'Every UI a build makes, waiting for your approval.' }],
  settings: [{
    id: 'ui-review.prefs', label: 'UI Review', icon: 'eye', tab: FOLDER, order: 10,
    settings: [
      { key: KEYS.view, label: 'View', kind: 'choice', default: 'grid', options: VIEWS.map((v) => ({ value: v.id, label: v.label })) },
      { key: KEYS.sort, label: 'Order', kind: 'choice', default: 'waiting', options: core.SORTS.map((s) => ({ value: s.id, label: s.label })) },
      { key: KEYS.groupBy, label: 'Sub-grids group by', kind: 'choice', default: 'kind', options: GROUP_BYS.map((g) => ({ value: g.id, label: g.label })) },
      { key: KEYS.thumbs, label: 'Show the screens list', kind: 'toggle', default: true, description: 'The list of screens beside (on a phone: above) the preview.' },
    ],
  }],
  settingsPanels: [{ id: 'ui-review.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

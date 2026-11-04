/**
 * Bugs board plugin (bugs@1): the confirmed bugs list. The board itself is lazy-loaded (ui.tsx) so the console only
 * pays for it when it opens; the banner chip (open bugs, and the ones waiting on Brett), the context-menu entries on a
 * bug and the settings tab stay light.
 */
import { lazy, Suspense } from 'react';
import { Icon, openRef, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { act, current, FOLDER, useBoard } from './data';
import { appMenu } from './menu';
import './bugs-board.css';

const VIEW = 'bugs-board';
const Board = lazy(() => import('./ui').then((m) => ({ default: m.BugsBoard })));
const Settings = lazy(() => import('./ui').then((m) => ({ default: m.BugsSettings })));
const loading = <p className="axp-bb-muted">Loading the bugs board…</p>;

function BugsBanner() {
  const rt = useRuntime();
  const { board } = useBoard();
  const b = board?.banner;
  if (!b?.open) return null;
  return (
    <div className="axp-bb-banner" role="status" aria-live="polite">
      <button type="button" data-fx-row className="axp-bb-banner__main" onClick={() => rt.navigate(VIEW)}>
        <Icon name="alert" size={16} />
        <strong>{b.open} open bug{b.open === 1 ? '' : 's'}</strong>
        <span className="axp-bb-muted">{b.unassigned} unassigned{b.needsBrett ? ` · ${b.needsBrett} need you` : ''}</span>
      </button>
    </div>
  );
}

const withBug = (rt: ReturnType<typeof useRuntime>, id: string, focus: 'edit' | 'move') => {
  rt.navigate(VIEW);
  void import('./ui').then((m) => m.requestOpen(id, focus));
};

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.bugs-board',
  label: 'Bugs board',
  version: '0.1.0',
  appMenu,
  views: { [VIEW]: { title: 'Bugs', icon: 'alert', render: () => <Suspense fallback={loading}><Board /></Suspense> } },
  nav: { label: 'Builds', items: [{ id: VIEW, label: 'Bugs', icon: 'alert', view: VIEW }] },
  banners: [{ id: 'bugs-board', label: 'Open bugs', icon: 'alert', settingsTab: VIEW, order: 5.2, render: () => <BugsBanner /> }],
  settingsTabs: [{ id: VIEW, label: 'Bugs', icon: 'alert', order: 47, parent: 'plugins', description: 'The confirmed bugs board: auto-optimize, the per-build cap and the crew chat handoffs.' }],
  settingsPanels: [
    { id: 'bugs-board.settings', tab: VIEW, title: 'Bugs board', icon: 'alert', order: 10, render: () => <Suspense fallback={loading}><Settings /></Suspense> },
    { id: 'bugs-board.lifecycle', tab: VIEW, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  register: (rt) => {
    rt.actions.register('bugs.open', () => rt.navigate(VIEW), { label: 'Open the bugs board' });
    rt.actions.register('bugs.edit', ([id]) => withBug(rt, id ?? '', 'edit'), { label: 'Edit bug', params: true, searchable: false });
    rt.actions.register('bugs.move', ([id]) => withBug(rt, id ?? '', 'move'), { label: 'Move bug to build', params: true, searchable: false });
    rt.actions.register('bugs.fix', ([id]) => void act({ action: 'fix', id }), { label: 'Mark bug fixed', params: true, searchable: false });
    rt.actions.register('bugs.new-build', ([id]) => void act({ action: 'new-build', ids: [id] }), { label: 'New build from bug', params: true, searchable: false });
    rt.actions.register('bugs.open-build', ([id]) => { const b = current()?.bugs.find((x) => x.id === id)?.build; if (b) openRef(rt, b); else rt.toast('This bug is not in a build yet.', 'info'); }, { label: 'Open build', params: true, searchable: false });
    rt.contextExtras.set('axf-bug', (_t, id) => (id ? [
      { id: 'bugs.move', label: 'Move to build…', icon: 'move', action: `bugs.move:${id}` },
      { id: 'bugs.new-build', label: 'New build from bug', icon: 'plus', action: `bugs.new-build:${id}` },
      { id: 'bugs.open-build', label: 'Open build', icon: 'external', action: `bugs.open-build:${id}` },
      { id: 'bugs.fix', label: 'Mark fixed', icon: 'check', action: `bugs.fix:${id}` },
      { id: 'bugs.edit', label: 'Edit', icon: 'edit', action: `bugs.edit:${id}` },
    ] : []));
  },
};

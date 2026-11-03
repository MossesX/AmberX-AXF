/**
 * Menus console plugin (ai.amberx.axf.console.smart-menus, smart-menu@1).
 *
 * Every context menu and every application-menu dropdown in the console gets dynamic sections above its fixed items:
 * Talking about (what Amber says we're discussing, console_context), Pinned, Suggested (learned from picks, plain
 * arithmetic), and items for this target (`when` conditions). The menus' own items never move. Settings: Settings →
 * Plugins → Menus, the Menus page (View → Menus), and **Menu settings** at the bottom of every context menu. Turned off
 * or removed: every menu is its plain static menu. Engine: framework/core/engines/smartmenu.ts.
 */
import { useSyncExternalStore } from 'react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, focusMenu, menusState, MODULE, start, subscribe, VIEW } from './core';
import { appMenu } from './menu';
import { BehaviourPanel, LearningPanel, LookPanel, MenusPage, PerMenuPanel, SectionsPanel, TopicsPanel } from './ui';
import './smart-menus.css';

const TAB = 'smart-menus';

function Page() {
  const s = useSyncExternalStore(subscribe, menusState, menusState);
  return <MenusPage focus={s.focus} />;
}

export const plugin: AxfWebLibrary = {
  id: MODULE,
  label: 'Menus',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-03' },
  register(rt) {
    start(rt);
    rt.actions.register('smart-menus.open', () => rt.navigate(VIEW), { label: 'Open Menus settings' });
    // Menu settings (the hook at the bottom of every context menu): the page, on that menu's own settings
    rt.actions.register('smart-menus.settings', (args) => { focusMenu(args.join(':') || undefined); rt.navigate(VIEW); }, { label: 'Menu settings', params: true });
    // Talking-about rows that need more than a navigation
    rt.actions.register('smart-menus.topic', ([kind, ...rest]) => {
      const id = rest.join(':');
      if (kind === 'pr') { const repo = menusState().repo || 'MossesX/AmberX-AXF'; globalThis.open?.(`https://github.com/${repo}/pull/${encodeURIComponent(id)}`, '_blank', 'noopener'); return; }
      if (kind === 'build') { rt.dispatch('builds.open'); return; }
      if (kind === 'note') { rt.dispatch('nav:notes-browser'); return; }
    }, { label: 'Open a Talking-about topic', params: true });
    // the Menu settings hook, last in every context menu
    rt.contextExtras.set('*:smart-menus', (target) => [{ id: 'smart-menus.settings', label: 'Menu settings', icon: 'sliders', action: `smart-menus.settings:ctx:${target || 'default'}` }]);
  },
  appMenu,
  views: { [VIEW]: { title: 'Menus', icon: 'menu', keywords: ['menus', 'context menu', 'right click', 'suggested', 'pinned', 'talking about', 'menu look', 'menu settings'], render: () => <Page /> } },
  nav: { label: 'Plugins', items: [{ id: 'smart-menus', label: 'Menus', icon: 'menu', view: 'smart-menus' }] },
  settingsTabs: [{ id: TAB, label: 'Menus', icon: 'menu', order: 40, parent: 'plugins', description: 'Smart sections in every menu, and how every menu looks.' }],
  settingsPanels: [
    { id: 'smart-menus.sections', tab: TAB, title: 'Sections', icon: 'layers', order: 10, render: () => <SectionsPanel /> },
    { id: 'smart-menus.behaviour', tab: TAB, title: 'Behaviour', icon: 'sliders', order: 20, render: () => <BehaviourPanel /> },
    { id: 'smart-menus.look', tab: TAB, title: 'Look', icon: 'palette', order: 30, render: () => <LookPanel /> },
    { id: 'smart-menus.per-menu', tab: TAB, title: 'Per menu', icon: 'menu', order: 40, render: () => <PerMenuPanel /> },
    { id: 'smart-menus.topics', tab: TAB, title: 'Talking about', icon: 'mic', order: 50, render: () => <TopicsPanel /> },
    { id: 'smart-menus.learning', tab: TAB, title: 'Learning', icon: 'chart', order: 60, render: () => <LearningPanel /> },
    { id: 'smart-menus.lifecycle', tab: TAB, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

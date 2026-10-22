/**
 * Codebase changes console plugin (ai.amberx.axf.console.codebase-changes).
 *
 * Every request to Claude to build, edit, remove or fix something is an entry (change-log@1): opened by a Claude Code
 * hook (changes.mjs hook), filled in by Claude step by step, closed out with its result. Stored on axHub, one file per
 * entry (server part, /projects/amberx-axf/_data/changes).
 *
 *  - Banner on every console load while any entry isn't closed (order 4.7: after Activity 4 and Build manager 4.5):
 *    count + newest titles; the drop-down lists each with kind, state, time, steps and result, ✕ per entry (closed on
 *    every device) and Close all; tap an entry to open it in the log.
 *  - Builds → Codebase changes: the permanent log with filters, steps timeline, result, tests, links, pagination.
 *  - Hooks: action codebase-changes.open[:<id>], search provider (every entry seen), default context menu link.
 *  - Settings → Plugins → Codebase changes: banner on/off, where the log lives, the hook install command.
 */
import type { AxfRuntime } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, ID, KEYS, STATE_LABEL, VERSION, VIEW, getStore, kindLabel, setFocus, start } from './store';
import { ChangesBanner, ChangesView, SettingsSummary } from './ui';
import './codebase-changes.css';
import { appMenu } from './menu';

function open(rt: AxfRuntime, arg = '') {
  if (arg) setFocus(arg);
  rt.navigate(VIEW);
}

export const plugin: AxfWebLibrary = {
  appMenu,
  id: ID, // equals plugin.json "id"
  label: 'Codebase changes',
  version: VERSION,
  provides: ['axf.codebase-changes'],
  register(rt) {
    start(rt);
    rt.actions.register('codebase-changes.open', ([arg]) => open(rt, decodeURIComponent(arg ?? '')), { label: 'Open the Codebase changes log' });
    rt.search.add('codebase-changes.entries', () => [...getStore().known.values()].map((e) => ({
      id: `change:${e.id}`, kind: 'change', label: e.title, icon: 'branch',
      detail: `Codebase changes · ${kindLabel(e.kind)} · ${STATE_LABEL[e.state] ?? e.state}${e.closed ? '' : ' · in banner'}`,
      keywords: [e.id, e.kind, e.state, ...e.repos, ...(e.result?.summary ? [e.result.summary.slice(0, 80)] : [])],
      focus: { kind: 'action', spec: `codebase-changes.open:${encodeURIComponent(e.id)}` },
    })));
  },
  views: { [VIEW]: { title: 'Codebase changes', icon: 'branch', keywords: ['changes', 'codebase', 'log', 'history', 'builds', 'edits', 'removals', 'fixes', 'results', 'commits'], render: () => <ChangesView /> } },
  nav: { label: 'Builds', items: [{ id: VIEW, label: 'Codebase changes', icon: 'branch', view: VIEW }] },
  contextMenu: [{ id: 'codebase-changes.default', target: 'default', order: 92, items: [{ id: 'codebase-changes', label: 'Codebase changes', icon: 'branch', action: 'codebase-changes.open' }] }],
  // After Activity (4) and the Build manager (4.5), before the approvals banner (5).
  banners: [{ id: 'codebase-changes', label: 'Codebase changes', icon: 'branch', settingsTab: 'codebase-changes', order: 4.7, render: () => <ChangesBanner /> }],
  settingsTabs: [{ id: 'codebase-changes', label: 'Codebase changes', icon: 'branch', parent: 'plugins', order: 44, description: 'The changes log, its banner and the Claude Code hook.' }],
  settings: [{
    id: 'codebase-changes.prefs', label: 'Codebase changes', icon: 'branch', tab: 'codebase-changes', order: 10,
    settings: [
      { key: KEYS.banner, label: 'Banner on every load', kind: 'toggle', default: true, description: 'Show the Codebase changes banner while any entry isn’t closed. Off hides it in this browser only; entries stay open everywhere else.' },
    ],
  }],
  settingsPanels: [
    { id: 'codebase-changes.about', tab: 'codebase-changes', title: 'About', icon: 'info', order: 5, render: () => <SettingsSummary /> },
    { id: 'codebase-changes.lifecycle', tab: 'codebase-changes', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

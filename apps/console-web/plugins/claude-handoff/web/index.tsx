/**
 * Claude handoff console plugin (ai.amberx.axf.console.claude-handoff): moves AmberX AXF to a new Claude account.
 *
 *  - Tools → Claude handoff: **Assemble prompt** (publishes the kit when it is out of date, then copies the one prompt
 *    a new account needs), kit status (what changed since it was published), the claude.ai-side items (Project,
 *    artifacts, connectors, memory) with how to recreate each, every machine's ~/.claude files, a kit preview.
 *  - The kit is `_claude/handoff/` in the repo (handoff-core.mjs builds it, handoff.mjs publishes it to GitHub).
 *  - Reminder every 6 hours (server thread): one banner here and one developer alert with a fixed key, so a repeat
 *    overwrites it and it never shows twice; cleared by Publish or the banner's ✕.
 *  - Hooks: the console's new **Tools** menu (application menu) and nav section, actions claude-handoff.open /
 *    .assemble / .publish, search, the default context menu, Settings → Plugins → Claude handoff.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import './claude-handoff.css';
import { appMenu } from './menu';
import { InstallerDialog } from './installer';
import { FOLDER, ID, VERSION, VIEW, publish, start } from './store';
import { HandoffBanner, HandoffSettings, HandoffView } from './ui';

const INSTALLER = 'claude-handoff.installer';

export const plugin: AxfWebLibrary = {
  appMenu,
  id: ID, // equals plugin.json "id"
  label: 'Claude handoff',
  version: VERSION,
  register(rt) {
    start(rt);
    rt.actions.register('claude-handoff.open', () => rt.navigate(VIEW), { label: 'Open Claude handoff' });
    rt.actions.register('claude-handoff.assemble', () => rt.openDialog(INSTALLER), { label: 'Assemble the Claude handoff prompt' });
    rt.actions.register('claude-handoff.publish', () => { void publish(); }, { label: 'Publish the Claude handoff kit' });
  },
  views: { [VIEW]: { title: 'Claude handoff', icon: 'rocket', keywords: ['handoff', 'claude', 'account', 'clone', 'prompt', 'memory', 'instructions', 'migrate', 'move', 'tools'], render: () => <HandoffView /> } },
  nav: { label: 'Tools', items: [{ id: 'claude-handoff', label: 'Claude handoff', icon: 'rocket', view: 'claude-handoff' }] },
  // the installer window Assemble prompt opens (searchable: false, it starts the real work)
  dialogs: { [INSTALLER]: { title: 'Claude handoff installer', icon: 'rocket', searchable: false, render: (_p, close) => <InstallerDialog close={close} /> } },
  contextMenu: [{ id: 'claude-handoff.default', target: 'default', order: 93, items: [{ id: 'claude-handoff', label: 'Claude handoff', icon: 'rocket', action: 'claude-handoff.open' }] }],
  // After Codebase changes (4.7) and the push banner (4.8), before approvals (5).
  banners: [{ id: 'claude-handoff', label: 'Claude handoff reminder', icon: 'rocket', settingsTab: 'claude-handoff', order: 4.9, render: () => <HandoffBanner /> }],
  settingsTabs: [{ id: 'claude-handoff', label: 'Claude handoff', icon: 'rocket', parent: 'plugins', order: 46, description: 'The handoff kit for a new Claude account and its reminder.' }],
  settingsPanels: [
    { id: 'claude-handoff.prefs', tab: 'claude-handoff', title: 'Kit and reminder', icon: 'rocket', order: 10, render: () => <HandoffSettings /> },
    { id: 'claude-handoff.lifecycle', tab: 'claude-handoff', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

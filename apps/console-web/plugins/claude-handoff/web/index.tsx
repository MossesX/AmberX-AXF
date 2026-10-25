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
import { InstallerDialog, LastAssemblyDialog } from './installer';
import { FILES_DIALOG, FILE_TAB_KIND, FileTab, FilesDialog } from './files';
import { loadLook } from './look';
import { LookDialog } from './lookDialog';
import { FOLDER, ID, VERSION, VIEW, handoffSession, publish, start } from './store';
import { HandoffBanner, HandoffSettings, HandoffView, PreviewView } from './ui';

const INSTALLER = 'claude-handoff.installer';
const LOOK = 'claude-handoff.look';
const LAST = 'claude-handoff.last';

export const plugin: AxfWebLibrary = {
  appMenu,
  id: ID, // equals plugin.json "id"
  label: 'Claude handoff',
  version: VERSION,
  register(rt) {
    start(rt);
    void loadLook(rt); // the installer look (layout, rolled themes) from axHub's data server
    rt.actions.register('claude-handoff.look', () => rt.openDialog(LOOK), { label: 'Installer look: layouts, gauges, meters, themes, roll' });
    rt.actions.register('claude-handoff.files', () => rt.openDialog(FILES_DIALOG), { label: 'Files the Claude handoff plugin makes or edits' });
    rt.actions.register('claude-handoff.preview', () => rt.navigate('claude-handoff-preview'), { label: 'Watch the Claude handoff installer run (preview)' });
    rt.actions.register('claude-handoff.open', () => rt.navigate(VIEW), { label: 'Open Claude handoff' });
    rt.actions.register('claude-handoff.assemble', () => rt.openDialog(INSTALLER), { label: 'Assemble the Claude handoff prompt' });
    rt.actions.register('claude-handoff.last', () => rt.openDialog(LAST), { label: 'Open the results of the last Claude handoff assembly' });
    rt.actions.register('claude-handoff.session', () => { rt.navigate(VIEW); void handoffSession(); }, { label: 'Handoff Session: summary of open work for the other account' });
    rt.actions.register('claude-handoff.publish', () => { void publish(); }, { label: 'Publish the Claude handoff kit' });
  },
  views: {
    'claude-handoff-preview': { title: 'Installer preview', icon: 'play', keywords: ['installer', 'preview', 'demo', 'handoff', 'gauges', 'progress'], render: () => <PreviewView /> },
    [VIEW]: { title: 'Claude handoff', icon: 'rocket', keywords: ['handoff', 'claude', 'account', 'prompt', 'memory', 'instructions', 'migrate', 'move', 'tools'], render: () => <HandoffView /> } },
  nav: { label: 'Tools', items: [{ id: 'claude-handoff', label: 'Claude handoff', icon: 'rocket', view: 'claude-handoff' }, { id: 'claude-handoff-preview', label: 'Installer preview', icon: 'play', view: 'claude-handoff-preview' }] },
  // the installer window Assemble prompt opens (searchable: false, it starts the real work)
  dialogs: {
    [INSTALLER]: { title: 'Claude handoff installer', icon: 'rocket', searchable: false, render: (_p, close) => <InstallerDialog close={close} /> },
    [LAST]: { title: 'Last assembly', icon: 'clock', render: (_p, close) => <LastAssemblyDialog close={close} /> },
    [LOOK]: { title: 'Installer look', icon: 'palette', render: () => <LookDialog /> },
    [FILES_DIALOG]: { title: 'Claude handoff files', icon: 'file', render: () => <FilesDialog /> },
  },
  // the file window's tabs (one floating window, a tab per file)
  tabs: { [FILE_TAB_KIND]: (t) => <FileTab tab={t} /> },
  contextMenu: [{ id: 'claude-handoff.default', target: 'default', order: 93, items: [
    { id: 'claude-handoff', label: 'Claude handoff', icon: 'rocket', action: 'claude-handoff.open' },
    { id: 'claude-handoff-files', label: 'Claude handoff files…', icon: 'file', action: 'claude-handoff.files' },
  ] }],
  // After Codebase changes (4.7) and the push banner (4.8), before approvals (5).
  banners: [{ id: 'claude-handoff', label: 'Claude handoff reminder', icon: 'rocket', settingsTab: 'claude-handoff', order: 4.9, render: () => <HandoffBanner /> }],
  settingsTabs: [{ id: 'claude-handoff', label: 'Claude handoff', icon: 'rocket', parent: 'plugins', order: 46, description: 'The handoff kit for a new Claude account and its reminder.' }],
  settingsPanels: [
    { id: 'claude-handoff.prefs', tab: 'claude-handoff', title: 'Kit and reminder', icon: 'rocket', order: 10, render: () => <HandoffSettings /> },
    { id: 'claude-handoff.lifecycle', tab: 'claude-handoff', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

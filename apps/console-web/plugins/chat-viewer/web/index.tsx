import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { ChatViewer, ChatViewerSettings, FOLDER } from './ui';
import './chat-viewer.css';

/** Chat viewer: every session (claude.ai, Claude Code, headless builds, hub drop) stored, searchable, exportable as audio. */
export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.chat-viewer', // = plugin.json "id"
  label: 'Chat viewer',
  version: '0.1.0',
  appMenu,
  views: { 'chat-viewer': { title: 'Chats', icon: 'list', render: () => <ChatViewer /> } },
  nav: { label: 'Plugins', items: [{ id: 'chat-viewer', label: 'Chats', icon: 'list', view: 'chat-viewer' }] },
  settingsTabs: [{ id: 'chat-viewer', label: 'Chat viewer', icon: 'list', order: 90, parent: 'plugins' }],
  settingsPanels: [
    { id: 'chat-viewer.settings', tab: 'chat-viewer', title: 'Sources and voices', icon: 'settings', order: 10, render: () => <ChatViewerSettings /> },
    { id: 'chat-viewer.lifecycle', tab: 'chat-viewer', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

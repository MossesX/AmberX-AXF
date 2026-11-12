import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { ChatViewer, ChatViewerSettings, FOLDER, OPEN_EVENT, sessionsApi } from './ui';
import { registerRowKind } from '@console/axf/libs/datagrid';
import type { Row } from './core';
import './chat-viewer.css';

/** Chat viewer: every session (claude.ai, Claude Code, headless builds, hub drop) stored, searchable, exportable as audio. */
export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.chat-viewer', // = plugin.json "id"
  label: 'Chat viewer',
  version: '0.1.0',
  appMenu,
  register(rt) {
    // grid-row@1: a session (Chats, a build's session, an agent's run) expands into every field, Related and these commands
    const open = (id: string) => { rt.navigate('chat-viewer'); setTimeout(() => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id })), 0); };
    registerRowKind({
      kind: 'session', label: 'Session', icon: 'list', owner: FOLDER, aliases: ['session-log', 'chat'],
      title: (r) => String((r as Partial<Row>).title ?? ''), open,
      load: async (id) => (await sessionsApi().call<{ sessions: Row[] }>('sessions')).sessions.find((s) => s.id === id) ?? null,
      commands: [
        { id: 'open', label: 'Open the transcript', icon: 'eye', button: true, effect: 'navigate', order: 1, run: ({ ids }) => open(ids[0]!) },
        { id: 'copy-id', label: 'Copy session id', icon: 'copy', effect: 'read', order: 5, run: async ({ ids }) => { await navigator.clipboard?.writeText(ids.join(' ')); rt.toast('Copied.', 'success'); } },
      ],
    });
  },
  views: { 'chat-viewer': { title: 'Chats', icon: 'list', render: () => <ChatViewer /> } },
  nav: { label: 'Plugins', items: [{ id: 'chat-viewer', label: 'Chats', icon: 'list', view: 'chat-viewer' }] },
  settingsTabs: [{ id: 'chat-viewer', label: 'Chat viewer', icon: 'list', order: 90, parent: 'plugins' }],
  settingsPanels: [
    { id: 'chat-viewer.settings', tab: 'chat-viewer', title: 'Sources and voices', icon: 'settings', order: 10, render: () => <ChatViewerSettings /> },
    { id: 'chat-viewer.lifecycle', tab: 'chat-viewer', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

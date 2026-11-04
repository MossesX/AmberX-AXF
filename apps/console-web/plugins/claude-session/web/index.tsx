/**
 * Claude sessions console plugin (ai.amberx.axf.console.claude-session, agent-pick@1): every Claude session works as a crew agent Brett
 * assigns. The picker dialog (`claude.picker`), the ask watcher that pops it when a session starts (slot
 * `app.frame.cover`), "Assign to Claude" on the crew cards (slot `swarm.agent.actions`), the agent right-click menu
 * (context target `agent`) and "Choose Claude's agent…" everywhere (target `*`), and Settings → Plugins → Claude sessions.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { AskWatcher, AssignButton, FOLDER, PICKER, PickerView, SettingsPanel, api, loadPicker, type SessionView } from './ui';
import { appMenu } from './menu';
import './claude-session.css';

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.claude-session',
  label: 'Claude sessions',
  version: '0.1.0',
  register(rt) {
    rt.actions.register('claude.pick', () => rt.openDialog(PICKER, {}), { label: "Choose Claude's agent…" });
    rt.actions.register('claude.assign', ([agent = '']) => {
      if (!agent) return;
      void api.post<{ name: string }>('assign', { agent }).then((r) => { rt.toast(`${r.name} is Claude's agent now`, 'success'); void loadPicker(); }, (e: Error) => rt.toast(e.message, 'danger'));
    }, { label: 'Assign an agent to Claude', params: true, searchable: false });
  },
  dialogs: {
    [PICKER]: { title: "Choose Claude's agent", icon: 'user', searchable: true, render: (props, close) => <PickerView ask={(props.ask as SessionView | undefined) ?? null} close={close} /> },
  },
  appMenu,
  slots: {
    'app.frame.cover': [{ id: 'claude.asks', order: 98, render: () => <AskWatcher /> }],
    'swarm.agent.actions': [{ id: 'claude.assign', order: 10, render: (p) => <AssignButton agentId={String(p?.agentId ?? '')} name={String(p?.name ?? '')} /> }],
  },
  contextMenu: [
    { id: 'claude.agent', target: 'agent', order: 5, items: [{ id: 'claude.assign', label: 'Assign to Claude', icon: 'sparkles', action: 'claude.assign:{payload}' }] },
    { id: 'claude.everywhere', target: '*', order: 61, items: [{ id: 'claude.pick', label: "Choose Claude's agent…", icon: 'user', action: 'claude.pick' }] },
  ],
  settingsTabs: [{ id: FOLDER, label: 'Claude sessions', icon: 'sparkles', order: 30, parent: 'plugins', description: "Claude's agent: who every Claude session works as, and whether you're asked each time." }],
  settingsPanels: [
    { id: 'claude.agent', tab: FOLDER, title: 'Claude agent', icon: 'user', order: 10, render: () => <SettingsPanel /> },
    { id: 'claude-session.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

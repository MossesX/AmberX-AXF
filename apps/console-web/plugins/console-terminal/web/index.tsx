import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, ID } from './api';
import { attachTmux, focusSession, openFromContext } from './open';
import { ClaudePanel, GeneralPanel, MoshiPanel, SessionsPanel, VpsPanel } from './panels';
import { TerminalTab } from './TerminalTab';
import './terminal.css';
import { appMenu } from './menu';

/*
 * Terminal plugin (web part):
 *  - tab kind `terminal` (floating window, tabs: container / console / VPS / Claude Code, + for more)
 *  - "Open terminal" on every right-click / long-press (runtime contextExtras key `*:terminal`); on a container or a
 *    folder the console marks (data-fx-ctx-target axf-container / axf-container-path) it opens right there
 *  - actions terminal.open[:<target>:<payload>], terminal.new, terminal.attach:<tmux session> (VPS tab attached to it),
 *    terminal.focus:<session id> (bring that tab forward); the Build manager's open-session icon uses the last two
 *  - Settings → Plugins → Terminal
 */
export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Terminal',
  version: '0.1.0',
  appMenu,
  provides: ['axf.terminal'],
  register(rt) {
    rt.actions.register('terminal.open', ([target, payload]) => openFromContext(rt, target, payload), { label: 'Open terminal', params: true });
    rt.actions.register('terminal.new', () => openFromContext(rt), { label: 'Open a terminal' });
    rt.actions.register('terminal.attach', ([name]) => { attachTmux(rt, name); }, { label: 'Open a tmux session on the VPS', params: true });
    rt.actions.register('terminal.focus', ([sid]) => { focusSession(rt, sid); }, { label: 'Show a terminal session', params: true });
    rt.contextExtras.set('*:terminal', (target, payload) => [{ id: 'terminal.open', label: 'Open terminal', icon: 'terminal', action: `terminal.open:${encodeURIComponent(target ?? '')}:${encodeURIComponent(payload ?? '')}` }]);
  },
  tabs: { terminal: (t) => <TerminalTab tab={t} /> },
  settingsTabs: [{ id: 'terminal', label: 'Terminal', icon: 'terminal', parent: 'plugins', order: 42, description: 'Terminal windows: options, the VPS host key, Claude Code, Mosh / Moshi, open sessions and the session log.' }],
  settingsPanels: [
    { id: 'terminal.general', tab: 'terminal', title: 'Terminal', icon: 'terminal', order: 10, render: () => <div className="axp-terminal-settings"><GeneralPanel /></div> },
    { id: 'terminal.vps', tab: 'terminal', title: 'VPS host', icon: 'monitor', order: 20, render: () => <div className="axp-terminal-settings"><VpsPanel /></div> },
    { id: 'terminal.claude', tab: 'terminal', title: 'Claude Code', icon: 'sparkles', order: 30, render: () => <div className="axp-terminal-settings"><ClaudePanel /></div> },
    { id: 'terminal.moshi', tab: 'terminal', title: 'Mosh & Moshi', icon: 'zap', order: 40, render: () => <div className="axp-terminal-settings"><MoshiPanel /></div> },
    { id: 'terminal.sessions', tab: 'terminal', title: 'Sessions & log', icon: 'list', order: 50, render: () => <div className="axp-terminal-settings"><SessionsPanel /></div> },
    { id: 'terminal.lifecycle', tab: 'terminal', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

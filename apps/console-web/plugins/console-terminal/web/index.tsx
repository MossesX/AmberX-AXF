import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, ID } from './api';
import { openFromContext } from './open';
import { ClaudePanel, GeneralPanel, MoshiPanel, SessionsPanel, VpsPanel } from './panels';
import { TerminalHost } from './TerminalHost';
import { RunOutputTab, watchHubRuns } from './RunOutputTab';
import { watchHeadless } from './headless';
import './terminal.css';
import { appMenu } from './menu';

/*
 * Terminal plugin (web part):
 *  - tab kind `terminal-host` (TerminalHost.tsx): a Windows Terminal-style window with its own tab strip, toolbar and
 *    sessions (container / console / VPS / Claude Code); legacy `terminal` tabs open as a host with one session
 *  - "Open terminal" on every right-click / long-press (runtime contextExtras key `*:terminal`); on a container or a
 *    folder the console marks (data-fx-ctx-target axf-container / axf-container-path) it opens right there
 *  - actions terminal.open[:<target>:<payload>], terminal.new
 *  - approved VPS / shell commands (axf.hub-runs@1) open in a read-only output tab once they've run (RunOutputTab.tsx)
 *  - headless Claude Code sessions on the VPS (tmux axf-…, deploy/claude-headless.sh) open in a VPS tab attached to
 *    them, with the terminal window restored, focused and brought to the front (headless.ts)
 *  - Settings → Plugins → Terminal
 */
export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Terminal',
  version: '0.3.0',
  appMenu,
  provides: ['axf.terminal'],
  register(rt) {
    rt.actions.register('terminal.open', ([target, payload]) => openFromContext(rt, target, payload), { label: 'Open terminal', params: true });
    rt.actions.register('terminal.new', () => openFromContext(rt), { label: 'Open a terminal' });
    watchHubRuns(rt); // approved VPS / shell commands open here once they've run (setting showHubRuns)
    watchHeadless(rt); // headless Claude Code sessions on the VPS open here, window to the front (setting showHeadless)
    rt.contextExtras.set('*:terminal', (target, payload) => [{ id: 'terminal.open', label: 'Open terminal', icon: 'terminal', action: `terminal.open:${encodeURIComponent(target ?? '')}:${encodeURIComponent(payload ?? '')}` }]);
  },
  tabs: { 'terminal-host': (t) => <TerminalHost tab={t} />, terminal: (t) => <TerminalHost tab={t} />, 'terminal-output': (t) => <RunOutputTab tab={t} /> },
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

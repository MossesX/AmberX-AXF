import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, ID } from './api';
import { findHost, newTab, openFromContext, showApiTab, dropApiTab } from './open';
import { ConnectDialog, ConnectionDialog } from './connections';
import { getSettings } from './api';
import { applyProfile } from './profiles';
import { AppearancePanel, BehaviourPanel, HeadlessPanel, ProfilesPanel } from './look';
import { ClaudePanel, GeneralPanel, MoshiPanel, SessionsPanel, VpsPanel } from './panels';
import { TerminalHost } from './TerminalHost';
import { RunOutputTab, watchHubRuns } from './RunOutputTab';
import { openHeadless, openUnseen, watchHeadless } from './headless';
import { openByName } from './nav';
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
 *    them, in the background with a count on the Terminal toolbar icon by default (setting newSession; headless.ts); the tab shows the agent,
 *    model, live cost and status (meters.ts) and splits into the session and its context chain (SplitView, ChainPane)
 *  - VPS and console tabs live in tmux sessions (axt-…): reload, sleep or a console restart re-attaches with the
 *    scrollback replayed; Open in Moshi copies the attach command; Kill session ends one
 *  - sessions nav (nav.tsx): the left rail; actions terminal.mirror / terminal.jump [name, where], terminal.sessions
 *  - Settings → Plugins → Terminal
 */
export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Terminal',
  version: '0.5.0',
  appMenu,
  provides: ['axf.terminal'],
  register(rt) {
    rt.actions.register('terminal.open', ([target, payload]) => openFromContext(rt, target, payload), { label: 'Open terminal', params: true });
    // New terminal follows Settings → Startup: a Claude Code tab on the default profile's connection, the console,
    // or the connection picker
    rt.actions.register('terminal.new', () => void getSettings().then((s) => {
      if (s.startup === 'picker') return rt.openDialog('terminal.connect', { hostId: '', mode: 'claude' });
      if (s.startup === 'claude') {
        const p = s.claudeProfiles.find((x) => x.id === s.defaultClaudeProfile) ?? s.claudeProfiles[0];
        const c = p?.connection ?? 'console';
        const via = c.startsWith('container:') ? { via: 'container' as const, container: c.slice(10) } : { via: (c === 'vps' || c === 'axhub' ? c : 'console') as 'console' };
        return newTab(rt, { ...applyProfile(p ?? null), kind: 'claude', ...via });
      }
      return openFromContext(rt);
    }, () => openFromContext(rt)), { label: 'Open a terminal' });
    // a headless run's own tab (the Crew, avatars' right-click "Open Terminal tab"): terminal.attach:<axf-… session>[:<title>]
    rt.actions.register('terminal.attach', ([name = '', title = '']) => { if (/^axf-[A-Za-z0-9._-]{1,64}$/.test(name)) openHeadless(rt, { name, createdAt: 0, agent: decodeURIComponent(title) }); }, { label: 'Open a headless run in a Terminal tab', params: true, searchable: false });
    // the Terminal toolbar icon (terminal-no-focus): with a count on it, open the oldest new headless session; else a terminal
    // screen 'terminal': "open the terminal" names it like any page (console.screens), though it is a window
    rt.actions.register('terminal.toolbar', () => { if (!openUnseen(rt)) openFromContext(rt); }, { label: 'Terminal (new sessions first)', screen: 'terminal', effect: 'navigate' });
    rt.actions.register('terminal.claude', () => rt.openDialog('terminal.connect', { hostId: '', mode: 'claude' }), { label: 'New Claude Code tab (pick a connection)' });
    // sessions nav (Nov 3 2026): mirror a session read-only, or jump in (writable; a chat opens claude.ai); args [name, where]
    rt.actions.register('terminal.mirror', ([name, where]) => void openByName(rt, String(name ?? ''), String(where ?? ''), false), { label: 'Mirror a session (read-only)', params: true });
    rt.actions.register('terminal.jump', ([name, where]) => void openByName(rt, String(name ?? ''), String(where ?? ''), true), { label: 'Jump into a session', params: true });
    rt.actions.register('terminal.sessions', () => { if (!findHost(rt)) openFromContext(rt); else rt.toast('The sessions list is on the left of the terminal window', 'info'); }, { label: 'Terminal sessions' });
    // full-api-control (Nov 7 2026): the API opened a session (drive/open) and the console shows it here, so Brett watches
    // every character it types; terminal.drop takes it away again when the API closes it
    rt.actions.register('terminal.show', (args) => { showApiTab(rt, args.map((a) => decodeURIComponent(String(a ?? '')))); }, { label: 'Show a terminal tab the API opened', params: true, searchable: false, effect: 'navigate' });
    rt.actions.register('terminal.drop', ([sid = '']) => { dropApiTab(decodeURIComponent(String(sid))); }, { label: 'Take away a terminal tab the API closed', params: true, searchable: false, effect: 'navigate' });
    watchHubRuns(rt); // approved VPS / shell commands open here once they've run (setting showHubRuns)
    watchHeadless(rt); // headless Claude Code sessions on the VPS get a tab here, quietly by default (settings showHeadless, newSession)
    rt.contextExtras.set('*:terminal', (target, payload) => [{ id: 'terminal.open', label: 'Open terminal', icon: 'terminal', action: `terminal.open:${encodeURIComponent(target ?? '')}:${encodeURIComponent(payload ?? '')}` }]);
  },
  dialogs: {
    'terminal.connect': { title: 'Open a tab', icon: 'terminal', render: (props, close) => <ConnectDialog props={props} close={close} /> },
    'terminal.connection': { title: 'Connection', icon: 'shuffle', searchable: false, render: (props, close) => <ConnectionDialog props={props} close={close} /> },
  },
  tabs: { 'terminal-host': (t) => <TerminalHost tab={t} />, terminal: (t) => <TerminalHost tab={t} />, 'terminal-output': (t) => <RunOutputTab tab={t} /> },
  settingsTabs: [{ id: 'terminal', label: 'Terminal', icon: 'terminal', parent: 'plugins', order: 42, description: 'Windows-style terminal: appearance, tabs, Claude Code profiles and connections, the VPS host key, Mosh / Moshi, open sessions and the session log.' }],
  settingsPanels: [
    { id: 'terminal.appearance', tab: 'terminal', title: 'Appearance', icon: 'palette', order: 4, render: () => <AppearancePanel /> },
    { id: 'terminal.behaviour', tab: 'terminal', title: 'Tabs & behaviour', icon: 'layout', order: 6, render: () => <BehaviourPanel /> },
    { id: 'terminal.headless', tab: 'terminal', title: 'Headless tabs', icon: 'sparkles', order: 7, render: () => <HeadlessPanel /> },
    { id: 'terminal.profiles', tab: 'terminal', title: 'Claude Code profiles', icon: 'sparkles', order: 8, render: () => <ProfilesPanel /> },
    { id: 'terminal.general', tab: 'terminal', title: 'Sessions & shells', icon: 'terminal', order: 10, render: () => <div className="axp-terminal-settings"><GeneralPanel /></div> },
    { id: 'terminal.vps', tab: 'terminal', title: 'VPS host', icon: 'monitor', order: 20, render: () => <div className="axp-terminal-settings"><VpsPanel /></div> },
    { id: 'terminal.claude', tab: 'terminal', title: 'Claude Code', icon: 'sparkles', order: 30, render: () => <div className="axp-terminal-settings"><ClaudePanel /></div> },
    { id: 'terminal.moshi', tab: 'terminal', title: 'Mosh & Moshi', icon: 'zap', order: 40, render: () => <div className="axp-terminal-settings"><MoshiPanel /></div> },
    { id: 'terminal.sessions', tab: 'terminal', title: 'Sessions & log', icon: 'list', order: 50, render: () => <div className="axp-terminal-settings"><SessionsPanel /></div> },
    { id: 'terminal.lifecycle', tab: 'terminal', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

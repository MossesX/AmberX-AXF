/**
 * Live sessions console plugin (ai.amberx.axf.console.live-sessions): every Claude session going on, human and headless,
 * with the agent running it; Watch live (text for all, voice only on human sessions, Brett only, logged, the watched
 * human is told); every human session recorded and played back in real time; recording storage targets.
 *
 * The banner widget is a framework `status` asset ('2 human · 4 headless', tap = the grid) kept current from the one
 * live feed, with counters `live.sessions.human`, `live.sessions.headless`, `live.sessions.watched` for other widgets.
 * No model is ever called.
 */
import { useEffect } from 'react';
import type { AxfRuntime } from '@console/axf/core/runtime';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, ID, RECORDINGS_VIEW, VIEW, paintWidget, type Counts } from './core';
import { RecordingSettings, RecordingsView, SessionsView, StorageSettings, WatchLog, WatchPanel, onCounts, refresh } from './ui';
import { appMenu } from './menu';
import './live-sessions.css';

const SHOW_KEY = 'live-sessions.widget';
const WATCH = 'live-sessions.watch';
const POLL_MS = 30_000;
let runtime: AxfRuntime | null = null;
let counts: Counts | null = null;

const shown = (rt: AxfRuntime) => rt.settings.get(SHOW_KEY) !== false;
const paint = () => { if (runtime) paintWidget(runtime, counts, shown(runtime)); };
onCounts.add((c) => { counts = c; paint(); });

/** Keeps the widget's count current while no grid is open (a cheap read every 30 s, and on focus). */
function WidgetFeed() {
  useEffect(() => {
    const load = () => { if (document.visibilityState === 'visible') void refresh(); };
    load();
    const t = setInterval(load, POLL_MS);
    const watch = (e: Event) => runtime?.openDialog(WATCH, { id: String((e as CustomEvent).detail ?? '') });
    window.addEventListener('focus', load);
    window.addEventListener('axf-live:watch', watch);
    return () => { clearInterval(t); window.removeEventListener('focus', load); window.removeEventListener('axf-live:watch', watch); };
  }, []);
  return null;
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Live sessions',
  version: '0.1.0',
  appMenu,
  provides: ['widget:status:live-sessions'],
  register(rt) {
    runtime = rt;
    paint();
    rt.settings.onChange(SHOW_KEY, paint);
    rt.actions.register('live-sessions.open', () => rt.navigate(VIEW), { label: 'Live sessions: every Claude session going on' });
    rt.actions.register('live-sessions.recordings', ([id = '']) => {
      rt.navigate(RECORDINGS_VIEW);
      if (id) setTimeout(() => window.dispatchEvent(new CustomEvent('axf-live:play', { detail: decodeURIComponent(id) })), 60);
    }, { label: 'Session recordings (browse and play back)', params: true });
    rt.actions.register('live-sessions.watch', ([id = '']) => { if (id) rt.openDialog(WATCH, { id: decodeURIComponent(id) }); }, { label: 'Watch a session live', params: true, searchable: false });
  },
  views: {
    [VIEW]: { title: 'Live sessions', icon: 'eye', keywords: ['sessions', 'live', 'watch', 'claude', 'human', 'headless', 'voice', 'helper', 'accounts'], render: () => <SessionsView /> },
    [RECORDINGS_VIEW]: { title: 'Session recordings', icon: 'play', keywords: ['recordings', 'playback', 'session browser', 'transcript', 'replay', 'audio'], render: () => <RecordingsView /> },
  },
  dialogs: {
    [WATCH]: { title: 'Watch live', icon: 'eye', searchable: false, render: (p, close) => <WatchPanel id={String(p.id ?? '')} close={close} /> },
  },
  nav: { label: 'Builds', items: [{ id: 'live-sessions', label: 'Live sessions', icon: 'eye', view: 'live-sessions' }, { id: 'session-recordings', label: 'Session recordings', icon: 'play', view: 'session-recordings' }] }, // literal ids: scripts/menu-reach.mts reads this line
  slots: { 'app.frame.cover': [{ id: 'live-sessions.feed', order: 97, render: () => <WidgetFeed /> }] },
  settingsTabs: [{ id: FOLDER, label: 'Live sessions', icon: 'eye', parent: 'plugins', order: 47, description: 'Every Claude session, watching, recording and where recordings are kept.' }],
  settings: [{ id: 'live-sessions.widget', label: 'Widget', icon: 'eye', tab: FOLDER, order: 5, settings: [{ key: SHOW_KEY, label: 'Show the sessions count on the banner', kind: 'toggle', default: true, scope: 'device' }] }],
  settingsPanels: [
    { id: 'live-sessions.recording', tab: FOLDER, title: 'Recordings', icon: 'save', order: 10, render: () => <RecordingSettings /> },
    { id: 'live-sessions.storage', tab: FOLDER, title: 'Recordings › Storage', icon: 'box', order: 20, render: () => <StorageSettings /> },
    { id: 'live-sessions.audit', tab: FOLDER, title: 'Watch log', icon: 'list', order: 30, render: () => <WatchLog /> },
    { id: 'live-sessions.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { MonitorView, MonitorWidget, RulesPane } from './Monitor';
import { DisplayPanel, ShowPanel } from './Settings';
import { exportLog, FOLDER, installCapture, setView, startPolling, VIEW } from './store';
import './activity-monitor.css';

/**
 * Activity Monitor: a live plain-English log of everything the console, axHub and every app does.
 *  - page "activity-monitor" (Plugins → Activity Monitor, View → Activity log)
 *  - actions (also on MCP / REST / CLI as console actions): activity-monitor.open, .tab:<tab>, .search:<words>,
 *    .event:<id>, .pause, .resume, .follow:<on|off>, .layout:<tree|flat>, .export:<jsonl|csv|md|txt>, .settings
 *  - widget (live count + last error) in the activity banner's summary line and the Builds toolbar
 *  - the server routes (plugin-commands@1) read, search, write, retry, export and edit rules without the UI
 */
const ONCE = '__axpActivityMonitorCapture';

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.activity-monitor',
  label: 'Activity Monitor',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-10' },
  appMenu,
  register(rt) {
    const g = globalThis as unknown as Record<string, (() => void) | undefined>;
    g[ONCE]?.(); // a hot reload replaces the old hooks instead of stacking them
    const offCapture = installCapture(rt);
    const offPoll = startPolling(rt);
    g[ONCE] = () => { offCapture(); offPoll(); };
    const open = (patch: Parameters<typeof setView>[0] = {}) => { setView(patch); rt.navigate(VIEW); };
    rt.actions.register('activity-monitor.open', () => open(), { label: 'Open the activity log', effect: 'navigate' });
    rt.actions.register('activity-monitor.tab', ([tab = 'all']) => open({ tab: decodeURIComponent(tab), selected: '' }), { label: 'Open the activity log on a tab', params: true, effect: 'navigate' });
    rt.actions.register('activity-monitor.search', (args) => open({ q: decodeURIComponent(args.join(':')) }), { label: 'Search the activity log', params: true, effect: 'navigate' });
    rt.actions.register('activity-monitor.event', (args) => open({ selected: decodeURIComponent(args.join(':')), tab: 'all', q: '' }), { label: 'Open one event in the activity log', params: true, effect: 'navigate' });
    rt.actions.register('activity-monitor.pause', () => setView({ paused: true }), { label: 'Pause the activity log' });
    rt.actions.register('activity-monitor.resume', () => setView({ paused: false }), { label: 'Resume the activity log' });
    rt.actions.register('activity-monitor.follow', ([on = 'on']) => setView({ follow: on !== 'off' }), { label: 'Live follow on or off', params: true });
    rt.actions.register('activity-monitor.layout', ([v = 'tree']) => setView({ view: v === 'flat' ? 'flat' : 'tree' }), { label: 'Show chains or lines', params: true });
    rt.actions.register('activity-monitor.export', ([fmt = 'jsonl']) => void exportLog(fmt), { label: 'Export the activity log', params: true });
    rt.actions.register('activity-monitor.settings', () => rt.dispatch(`settings.open:${FOLDER}`), { label: 'Activity log settings', effect: 'navigate' });
  },
  views: { 'activity-monitor': { title: 'Activity Monitor', icon: 'monitor', render: () => <MonitorView /> } },
  nav: { label: 'Plugins', items: [{ id: 'activity-monitor', label: 'Activity Monitor', icon: 'monitor', view: 'activity-monitor' }] },
  settingsTabs: [{ id: FOLDER, label: 'Activity Monitor', icon: 'monitor', order: 47, parent: 'plugins' }],
  settingsPanels: [
    { id: 'activity-monitor.display', tab: FOLDER, title: 'Look', icon: 'palette', order: 10, render: () => <DisplayPanel /> },
    { id: 'activity-monitor.show', tab: FOLDER, title: 'What to show and record', icon: 'eye', order: 20, render: () => <ShowPanel /> },
    { id: 'activity-monitor.rules', tab: FOLDER, title: 'Rules', icon: 'sliders', order: 30, render: () => <RulesPane /> },
    { id: 'activity-monitor.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  slots: {
    'activity.summary': [{ id: 'activity-monitor.summary', order: 40, render: () => <MonitorWidget compact /> }],
    'builds.toolbar': [{ id: 'activity-monitor.toolbar', order: 60, render: () => <MonitorWidget compact /> }],
  },
};

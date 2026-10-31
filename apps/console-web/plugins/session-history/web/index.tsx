/**
 * Session browser console plugin (ai.amberx.axf.console.session-history): every Claude Code session and headless agent
 * run, live. The run store is the server part (server/runs.py); this page grows step by step (grid, detail, tabs).
 */
import { useEffect, useState } from 'react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';

const FOLDER = 'session-history';
const ID = 'ai.amberx.axf.console.session-history';
const VIEW = 'session-history';

function BrowserView() {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => { void pluginFetch(FOLDER, 'runs').then((r) => r.json()).then((j: { runs?: unknown[] }) => setN(j.runs?.length ?? 0), () => setN(0)); }, []);
  return <div className="fx-stack"><h1>Session browser</h1><p className="fx-muted">{n == null ? 'Loading…' : `${n} runs`}</p></div>;
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Session browser',
  version: '0.1.0',
  appMenu,
  views: { [VIEW]: { title: 'Session browser', icon: 'terminal', keywords: ['sessions', 'runs', 'agents', 'headless', 'history', 'tokens', 'cost'], render: () => <BrowserView /> } },
  nav: { label: 'Builds', items: [{ id: VIEW, label: 'Session browser', icon: 'terminal', view: VIEW }] },
  settingsTabs: [{ id: 'session-history', label: 'Session browser', icon: 'terminal', parent: 'plugins', order: 46, description: 'Every Claude session and agent run, live.' }],
  settingsPanels: [{ id: 'session-history.lifecycle', tab: 'session-history', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

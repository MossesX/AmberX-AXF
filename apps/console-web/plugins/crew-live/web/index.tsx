/**
 * Crew console plugin (ai.amberx.axf.console.crew): every agent working right now and exactly what each is doing, live.
 *
 * The view is ui.tsx (one live feed per console, framework DataGrid). The plugin also gives every agent avatar in the
 * console its right-click / long-press menu (context target `agent`, payload = the agent id; AgentAvatar sets it):
 * employee card, current task, history, Session browser, Terminal tab, group chat, assign a job, stop. Items run
 * through the action bus, so a plugin that isn't installed just leaves its item out of reach (the bus says so).
 * Zero tokens: nothing here or in the server part calls a model.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import type { AxfRuntime } from '@console/axf/core/runtime';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { pluginFetch } from '@console/plugins';
import { useEffect } from 'react';
import { CrewView, FOCUS_EVENT, FOLDER, VIEW, publish } from './ui';
import { appMenu } from './menu';
import { isSnapshot, type Run } from './core';
import './crew.css';

const ID = 'ai.amberx.axf.console.crew-live';
const DIRECTORY_EVERY_MS = 5 * 60_000;

/** The agent's run that isn't finished (else their newest), from the live feed or a fresh read. */
async function runOf(agent: string): Promise<Run | null> {
  const j = await pluginFetch(FOLDER, 'agents').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!isSnapshot(j)) return null;
  return j.runs.find((r) => (r.agent.id === agent || r.id === agent) && r.status !== 'idle') ?? j.runs.find((r) => r.agent.id === agent) ?? null;
}

function focus(rt: AxfRuntime, agent: string) {
  rt.navigate(VIEW);
  setTimeout(() => window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: agent })), 50);
}

const run = (rt: AxfRuntime, spec: string) => rt.actions.dispatch(spec, { runtime: rt });

/**
 * Fills the agent directory for avatars across the console: one read at start and every few minutes (the crew changes
 * rarely). The live feed itself only runs while a Crew view is open.
 */
function DirectoryFeed() {
  useEffect(() => {
    const load = () => void pluginFetch(FOLDER, 'agents').then((r) => (r.ok ? r.json() : null)).then((j) => { if (isSnapshot(j)) publish(j); }).catch(() => undefined);
    load();
    const t = setInterval(load, DIRECTORY_EVERY_MS);
    return () => clearInterval(t);
  }, []);
  return null;
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Crew',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('crew.open', () => rt.navigate(VIEW), { label: 'Open the Crew (who is working)' });
    rt.actions.register('crew.agent', ([agent = '']) => { if (agent) focus(rt, agent); }, { label: 'Show an agent\'s current task in the Crew', params: true, searchable: false });
    rt.actions.register('crew.history', ([agent = '']) => { if (agent) run(rt, `agent-swarm.profile:${agent}`); }, { label: 'An agent\'s history and past runs', params: true, searchable: false });
    rt.actions.register('crew.terminal', ([agent = '']) => void runOf(agent).then((r) => {
      if (r && r.status !== 'idle') run(rt, `terminal.attach:${r.session}:${encodeURIComponent(r.agent.name)}`);
      else rt.toast(`${agent} has no run going.`, 'info', 'Crew');
    }), { label: 'Open an agent\'s run in the Terminal', params: true, searchable: false });
    rt.actions.register('crew.session', ([agent = '']) => void runOf(agent).then((r) => {
      if (r?.sessionId && rt.actions.get('session-history.open')) run(rt, `session-history.open:${r.sessionId}`);
      else rt.toast(r ? 'The Session browser isn\'t installed.' : `${agent} has no run on record.`, 'info', 'Crew');
    }), { label: 'Open an agent\'s run in the Session browser', params: true, searchable: false });
    rt.actions.register('crew.chat', () => { run(rt, 'agent-swarm.open'); }, { label: 'Open the group chat', searchable: false });
    rt.actions.register('crew.assign', () => { run(rt, 'agent-swarm.open'); }, { label: 'Assign a job (Breakroom → Jobs)', searchable: false });
    rt.actions.register('crew.stop', ([agent = '']) => void runOf(agent).then(async (r) => {
      if (!r || r.status === 'idle') { rt.toast(`${agent} has nothing running.`, 'info', 'Crew'); return; }
      if (!globalThis.confirm?.(`Stop ${r.agent.name}? The run ${r.name} ends now; work already committed stays.`)) return;
      const res = await pluginFetch(FOLDER, `agents/${encodeURIComponent(r.id)}/stop`, { method: 'POST' });
      rt.toast(res.ok ? `${r.agent.name} stopped.` : 'Stop failed', res.ok ? 'success' : 'danger', 'Crew');
    }), { label: 'Stop an agent\'s current job', params: true, searchable: false });
  },
  views: { [VIEW]: { title: 'Crew', icon: 'user', keywords: ['crew', 'agents', 'employees', 'working', 'live', 'cost', 'who', 'diff', 'headless'], render: () => <CrewView /> } },
  nav: { label: 'Builds', items: [{ id: 'crew', label: 'Crew', icon: 'user', view: 'crew' }] }, // literal ids: scripts/menu-reach.mts reads this line
  slots: { 'app.frame.cover': [{ id: 'crew.directory', order: 99, render: () => <DirectoryFeed /> }] },
  contextMenu: [{
    id: 'crew.agent', target: 'agent', order: 10, items: [
      { id: 'crew.card', label: 'Open employee card', icon: 'user', action: 'agent-swarm.profile:{payload}' },
      { id: 'crew.task', label: 'Their current task', icon: 'play', action: 'crew.agent:{payload}' },
      { id: 'crew.history', label: 'Their history / past runs', icon: 'clock', action: 'crew.history:{payload}' },
      { id: 'crew.session', label: 'Open in Session browser', icon: 'list', action: 'crew.session:{payload}' },
      { id: 'crew.terminal', label: 'Open Terminal tab', icon: 'terminal', action: 'crew.terminal:{payload}' },
      { id: 'crew.chat', label: 'Open group chat', icon: 'bell', action: 'crew.chat' },
      { id: 'crew.assign', label: 'Assign a job', icon: 'plus', action: 'crew.assign' },
      { id: 'crew.stop', label: 'Stop current job', icon: 'x', action: 'crew.stop:{payload}' },
    ],
  }],
  settingsTabs: [{ id: 'crew-live', label: 'Crew', icon: 'user', parent: 'plugins', order: 46, description: 'Who is working right now, live.' }],
  settingsPanels: [{ id: 'crew.lifecycle', section: 'plugin', tab: 'crew-live', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

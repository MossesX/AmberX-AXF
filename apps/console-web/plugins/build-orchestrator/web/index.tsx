import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { setPriorityHost, type PriorityHost } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { FOLDER, OrchestratorPage } from './ui';
import { TAB_IDS, collapseAll, describe, setQuery, setSection, setTab, type Scope, type Tab } from './view-state';

const VIEW = 'build-orchestrator';
/** Every argument after the action id, decoded (`build-orchestrator.search:skins%20r2` → "skins r2"). */
const argOf = (args: readonly string[]) => decodeURIComponent(args.join(':')).trim();
const scopeOf = (a: string): Scope => (a === 'rows' || a === 'sections' ? a : 'all');

// the tags on every build screen read through this plugin; with it removed they simply draw nothing
const priorityApi = pluginApi(FOLDER, 'Build priority', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
setPriorityHost({
  load: async () => (await priorityApi.call<{ map: Awaited<ReturnType<PriorityHost['load']>> }>('priority')).map,
  waiting: (build) => priorityApi.call(`priority/${encodeURIComponent(build)}`),
  set: async (builds, priority) => { await priorityApi.post('priority', { builds, priority }); },
});

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.build-orchestrator',
  label: 'Build orchestrator',
  version: '0.2.0',
  appMenu,
  // Everything comes with an API (Brett, Nov 8 2026): the search bar and Collapse all / Expand all are console actions,
  // so REST (POST /api/console/command), MCP (console_action), the CLI and voice drive them the same as the page.
  register(rt) {
    const go = () => rt.navigate(VIEW);
    rt.actions.register('build-orchestrator.open', ([t]) => { const tab = argOf(t ? [t] : []) as Tab; if (TAB_IDS.includes(tab)) setTab(tab); go(); }, { label: 'Open the Build orchestrator (pipeline, builds, approvals or rules tab)', params: true });
    rt.actions.register('build-orchestrator.search', (args) => { setQuery(argOf(args)); go(); }, { label: 'Search the Build orchestrator (title, id, branch, account, words)', params: true });
    rt.actions.register('build-orchestrator.clear-search', () => { setQuery(''); go(); }, { label: 'Clear the Build orchestrator search' });
    rt.actions.register('build-orchestrator.collapse-all', ([a]) => { collapseAll('collapse', scopeOf(argOf(a ? [a] : []))); go(); }, { label: 'Build orchestrator: collapse all rows and sections' });
    rt.actions.register('build-orchestrator.expand-all', ([a]) => { collapseAll('expand', scopeOf(argOf(a ? [a] : []))); go(); }, { label: 'Build orchestrator: expand all rows and sections' });
    rt.actions.register('build-orchestrator.section', (args) => { const [id = '', op = 'toggle'] = argOf(args).split(/\s+/); if (id) setSection(id, op === 'collapse' || op === 'expand' ? op : 'toggle'); go(); }, { label: 'Build orchestrator: collapse, expand or toggle one section (pl:accounts, pl:pending, pl:queued, pl:building, cat:<category>)', params: true });
    rt.actions.register('build-orchestrator.view-state', () => rt.toast(describe(), 'info', 'Build orchestrator'), { label: 'Build orchestrator: what the page shows (tab, search, collapsed sections and rows)' });
  },
  views: { 'build-orchestrator': { title: 'Build orchestrator', icon: 'layers', keywords: ['orchestrator', 'fable', 'opus', 'steps', 'phases', 'approve model'], render: () => <OrchestratorPage /> } },
  nav: { label: 'Builds', items: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', view: 'build-orchestrator' }] },
  contextMenu: [{ id: 'build-orchestrator.pending', target: 'axf-pending-item', items: [{ id: 'build-orchestrator.open', label: 'Open in Build orchestrator', icon: 'layers', action: 'nav:build-orchestrator' }] }],
  settingsTabs: [{ id: 'build-orchestrator', label: 'Build orchestrator', icon: 'layers', order: 90, parent: 'plugins' }],
  settingsPanels: [{ id: 'build-orchestrator.lifecycle', tab: 'build-orchestrator', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};

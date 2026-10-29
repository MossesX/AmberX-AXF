import { Button, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { Designer } from './Designer';
import { FOLDER, ID, loadDesigns } from './store';
import { appMenu } from './menu';
import { ACTIONS_TAB_KIND, ActionsTab, FILTER_DIALOG, FilterDialog, openActionsWindow } from './ActionsWindow';
import './context-menu-designer.css';

/*
 * Context menu designer (web part): nav → Plugins → Context menu designer. Build context menus and "chunks" (reusable
 * pieces you insert into menus by name), style them, watch the floating live preview, save. On start every saved menu
 * is registered as a context-menu asset (`ctxd-<id>`, pick it in Appearance or with "Use as the context menu") and its
 * styles go into one stylesheet scoped to the real context menu. The Actions window (floating) lists every action
 * the app can run with search + a Filter dialog (Plugins / Framework / Application); "This app's menus" loads the
 * app's current context menus for editing. Actions: context-menu-designer.open | .actions | .filter.
 */
export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Context menu designer',
  version: '0.2.0',
  appMenu,
  register(rt) {
    void loadDesigns(rt);
    rt.actions.register('context-menu-designer.open', () => rt.navigate('context-menu-designer'), { label: 'Open the context menu designer' });
    rt.actions.register('context-menu-designer.actions', () => openActionsWindow(rt), { label: 'Open the Actions window (context menu designer)' });
    rt.actions.register('context-menu-designer.filter', () => rt.openDialog(FILTER_DIALOG), { label: 'Filter the Actions window' });
  },
  // the Actions window (one floating window) and its Filter dialog
  tabs: { [ACTIONS_TAB_KIND]: () => <ActionsTab /> },
  dialogs: {
    [FILTER_DIALOG]: { title: 'Filter actions', icon: 'sliders', render: (_p, close) => <FilterDialog close={close} /> },
  },
  views: {
    'context-menu-designer': {
      title: 'Context menu designer',
      icon: 'menu',
      keywords: ['context menu', 'right-click', 'chunk', 'menu designer'],
      render: () => (
        <div className="fx-stack fx-stack--lg">
          <header className="fx-pagehead"><div><p className="fx-eyebrow">Design &amp; branding</p><h1>Context menu designer</h1><p className="fx-muted">Design right-click menus from reusable chunks, preview them live, and save them as context-menu assets.</p></div></header>
          <Designer />
        </div>
      ),
    },
  },
  nav: { label: 'Plugins', items: [{ id: 'context-menu-designer', label: 'Context menu designer', icon: 'menu', view: 'context-menu-designer' }] },
  contextMenu: [
    { id: 'context-menu-designer.default', target: 'default', order: 93, items: [{ id: 'context-menu-designer', label: 'Design this menu…', icon: 'menu', action: 'context-menu-designer.open' }] },
  ],
  settingsTabs: [{ id: 'context-menu-designer', label: 'Context menu designer', icon: 'menu', order: 90, parent: 'plugins' }],
  settingsPanels: [
    { id: 'context-menu-designer.open', tab: 'context-menu-designer', title: 'Designer', icon: 'menu', order: 10, render: () => <OpenPanel /> },
    { id: 'context-menu-designer.lifecycle', tab: 'context-menu-designer', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

function OpenPanel() {
  const rt = useRuntime();
  return (
    <div className="fx-stack">
      <p style={{ marginTop: 0 }}>Menus and chunks you design are saved on the console server and follow you to every browser.</p>
      <Button icon="menu" onClick={() => rt.dispatch('context-menu-designer.open')}>Open the designer</Button>
    </div>
  );
}

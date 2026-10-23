/**
 * Todo manager (console plugin): lists, groups, notes, to-dos and tasks. Ported from xGallery's developer task manager.
 * Tabable (plugin.json → "tabable"): a host such as Patches can show its page as a tab of its own; the console shows
 * that page alone (embed@1 page `view:todo-manager`), so `TodoView` drops its page heading there.
 */
import { useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { ENTRY_DIALOG, EntryEditor, TodoView, TypesPanel } from './ui';
import { FOLDER, deleteEntry, loadAll, saveEntry, todoState } from './store';
import './todo-manager.css';

function Page() {
  const rt = useRuntime();
  return <TodoView embedded={!!rt.embedded?.page} />;
}

const entryOf = (payload: unknown) => todoState().open?.entries.find((e) => e.id === Number(payload)) ?? null;

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.todo-manager',
  label: 'Todo manager',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('todo-manager.open', () => rt.navigate('todo-manager'), { label: 'Todos' });
    rt.actions.register('todo-manager.new', ([kind]) => {
      rt.navigate('todo-manager');
      const listId = todoState().openId;
      if (listId == null) return rt.toast('Make a list first.', 'info', 'Todos');
      rt.openDialog(ENTRY_DIALOG, { kind: kind || 'task', listId });
    }, { label: 'New task', params: true });
    rt.actions.register('todo-manager.edit', (_a, ctx) => { const e = entryOf(ctx?.payload); if (e) rt.openDialog(ENTRY_DIALOG, { id: e.id }); }, { label: 'Edit entry', searchable: false });
    rt.actions.register('todo-manager.done', (_a, ctx) => { const e = entryOf(ctx?.payload); if (e) void saveEntry(e.id, { status: e.status === 'done' ? 'open' : 'done' }); }, { label: 'Done / not done', searchable: false });
    rt.actions.register('todo-manager.subtask', (_a, ctx) => { const e = entryOf(ctx?.payload); if (e) rt.openDialog(ENTRY_DIALOG, { kind: 'task', listId: e.listId, parentId: e.id }); }, { label: 'Add a subtask', searchable: false });
    rt.actions.register('todo-manager.delete', (_a, ctx) => { const e = entryOf(ctx?.payload); if (e && window.confirm(`Delete “${e.title}” and its subtasks?`)) void deleteEntry(e.id); }, { label: 'Delete entry', searchable: false });
    rt.actions.register('todo-manager.reload', () => void loadAll(), { label: 'Reload todos' });
  },
  views: { 'todo-manager': { title: 'Todos', icon: 'list', keywords: ['todo', 'tasks', 'notes', 'checklist', 'lists'], render: () => <Page /> } },
  nav: { label: 'Plugins', items: [{ id: 'todo-manager', label: 'Todos', icon: 'list', view: 'todo-manager' }] },
  dialogs: { [ENTRY_DIALOG]: { title: 'Entry', icon: 'edit', searchable: false, render: (props, close) => <EntryEditor props={props} close={close} /> } },
  contextMenu: [{
    id: 'todo-manager.ctx', target: 'axf-todo-entry', order: 1, items: [
      { id: 'todo-manager.edit', label: 'Edit', icon: 'edit', action: 'todo-manager.edit' },
      { id: 'todo-manager.done', label: 'Done / not done', icon: 'check', action: 'todo-manager.done' },
      { id: 'todo-manager.subtask', label: 'Add a subtask', icon: 'plus', action: 'todo-manager.subtask' },
      { id: 'todo-manager.delete', label: 'Delete', icon: 'trash', action: 'todo-manager.delete' },
    ],
  }],
  settingsTabs: [{ id: 'todo-manager', label: 'Todo manager', icon: 'list', order: 90, parent: 'plugins' }],
  settingsPanels: [
    { id: 'todo-manager.types', tab: 'todo-manager', title: 'Kinds of entries', icon: 'sliders', order: 10, render: () => <TypesPanel /> },
    { id: 'todo-manager.lifecycle', tab: 'todo-manager', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

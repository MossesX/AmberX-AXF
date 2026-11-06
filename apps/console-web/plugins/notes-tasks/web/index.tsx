/**
 * Notes and tasks: the one plugin for notes, to-dos and tasks. The console and AmberX both load this folder (plugin.json
 * `targets`) and both read and write the one store on axHub (`notes/store.ts`), so every screen shows the same rows.
 *
 * What differs between the apps is `@console/notesHost`, nothing else. Hooks other plugins use are listed in
 * `notes/library.tsx`; the Claude files come from this plugin's server through `axf.notes@1`.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { NAV_GROUP } from '@console/notesHost';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { notesLibrary } from './notes/library';
import { NOTES_ID } from './notes/store';
import { tasksLibrary } from './tasks/library';

export const plugin: AxfWebLibrary = {
  id: NOTES_ID,
  label: 'Notes and tasks',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-06' },
  provides: ['amberx.notes', 'amberx.tasks'],
  appMenu,
  views: { ...notesLibrary.views, ...tasksLibrary.views },
  nav: { label: NAV_GROUP, items: [
    { id: 'notes', label: 'Notes', icon: 'file', view: 'notes' },
    { id: 'tasks', label: 'Tasks', icon: 'check-circle', view: 'tasks', badge: 'tasks.today' },
  ] },
  dialogs: { ...notesLibrary.dialogs, ...tasksLibrary.dialogs },
  contextMenu: [...(notesLibrary.contextMenu ?? []), ...(tasksLibrary.contextMenu ?? [])],
  settingsTabs: [{ id: 'notes-tasks', label: 'Notes and tasks', icon: 'check-circle', order: 30, parent: 'plugins' }],
  settings: tasksLibrary.settings,
  settingsPanels: [{ id: 'notes-tasks.lifecycle', tab: 'notes-tasks', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder="notes-tasks" /> }],
  register(rt) {
    notesLibrary.register?.(rt);
    tasksLibrary.register?.(rt);
  },
};

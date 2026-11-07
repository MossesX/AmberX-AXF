/** Application-menu entries (pure data: read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'notes-tasks.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [
    { id: 'notes', label: 'Notes', icon: 'file', action: 'nav:notes' },
    { id: 'tasks', label: 'Tasks', icon: 'check-circle', action: 'nav:tasks', badge: 'tasks.today' },
    { id: 'calendar', label: 'Calendar', icon: 'clock', action: 'nav:calendar' },
    { id: 'calendar.window', label: 'Calendar window', icon: 'layout', action: 'calendar.window' },
    { id: 'notes.add', label: 'New note', icon: 'plus', action: 'notes.add' },
    { id: 'tasks.add', label: 'New task', icon: 'plus', action: 'tasks.add' },
    { id: 'notes.search', label: 'Search notes', icon: 'search', action: 'notes.search' },
    { id: 'notes.lists', label: 'Manage note lists', icon: 'folder', action: 'dialog:notes.lists' },
    { id: 'notes.export', label: 'Export notes', icon: 'download', action: 'dialog:notes.export' },
  ] },
  { id: 'notes-tasks.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 80, items: [{ id: 'notes-builds', label: 'Notes', icon: 'file', action: 'nav:notes' }] },
];

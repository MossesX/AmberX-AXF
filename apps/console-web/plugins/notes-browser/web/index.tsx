/**
 * Notes vault (service only): the hub's shared Claude files under /projects/_shared/_claude/notes (handoffs, session
 * logs, plans, install notes, saved commands), served as the capability axf.notes@1 (server/) for MD Studio's Notes
 * scope, which is where they are read and edited. It has no screen of its own any more (Nov 12 2026): the console's
 * Notes screen is AmberX's notes and to-do manager, never a second notes manager. Settings → Plugins → Claude notes.
 */
import { Note } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';

const FOLDER = 'notes-browser';

function SettingsPanel() {
  return <Note tone="info">Claude's shared files are kept in the hub's <code>/projects/_shared/_claude/notes</code>, so every project and Claude session sees them (axHub memory: project <code>shared</code>, area <code>claude</code>). Read and edit them in MD Studio (Notes scope). Deleting or replacing one keeps its old text in the hub's history. Your own notes and to-dos are in Notes (AmberX's).</Note>;
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.notes-browser',
  label: 'Claude notes',
  version: '0.2.0',
  settingsTabs: [{ id: 'notes-browser', label: 'Claude notes', icon: 'file', order: 90, parent: 'plugins' }],
  settingsPanels: [
    { id: 'notes-browser.where', tab: 'notes-browser', title: 'Where they live', icon: 'folder', order: 10, render: () => <SettingsPanel /> },
    { id: 'notes-browser.lifecycle', tab: 'notes-browser', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

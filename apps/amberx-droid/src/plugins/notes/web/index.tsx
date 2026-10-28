/**
 * Notes: notes, todos and tasks in a tree of lists, kept on axHub (store.ts) and shared by every signed-in device.
 * Inbox, Plugins (one list per installed AmberX plugin, made by itself) and Voice notes (the console's Voice notes and
 * Voice Vault, read-only) are built in.
 *
 * HOOKS other plugins use (keep these names):
 *   action `notes.open`              open the Notes page (where it was)
 *   action `notes.open:<listId>`     open the Notes page on that list (Lists tab)
 *   action `notes.search:<text>`     open the Search tab with that text (`notes.search` alone = an empty search)
 *   action `notes.add`               open the quick add box and focus it
 *   dialogs `notes.item {id}`, `notes.lists {id?}`, `notes.export {id?}`  (rt.openDialog)
 *   data: `useNotes`, `mutate`, `runIntent`, `adoptShared` from `./store`; pure rules in `./core`
 * The page shows a Dictate button when action `dictation.start` is registered (another plugin); it dispatches
 * `dictation.start:<listId>` while a list is open, else `dictation.start`. With the AI connected (plugins/ai
 * `aiReady`), the item editor has Summarize.
 */
import type { AxfRuntime } from '../../../axf/core';
import type { AxfWebLibrary } from '../../../axf/react';
import { Export } from './Export';
import { ItemEditor } from './ItemEditor';
import { ListsManager } from './ListsManager';
import { NotesView } from './NotesView';
import { NOTES_ID, snapshot, startSync, subscribe, syncPlugins } from './store';
import { getUi, setUi } from './ui';
import './notes.css';

const VERSION = '0.1.0';

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function open(rt: AxfRuntime, list?: string) {
  setUi(list ? { tab: 'lists', list } : {});
  rt.navigate('notes');
}

/** Once the hub has answered, make one list per installed plugin (plugins.ts globs this module: read it lazily). */
function watchPlugins() {
  let done = false;
  const run = () => {
    if (done || snapshot().status !== 'ready') return;
    done = true;
    void import('../../../plugins').then(({ loadPlugins }) => syncPlugins(loadPlugins().map((p) => ({ id: p.id, name: p.name })))).catch(() => { done = false; });
  };
  subscribe(run);
  run();
}

export const library: AxfWebLibrary = {
  id: NOTES_ID,
  label: 'Notes',
  version: VERSION,
  builtWith: { model: 'opus', builtAt: '2026-10-27' },
  provides: ['amberx.notes'],
  views: { notes: { title: 'Notes', icon: 'file', keywords: ['notes', 'note', 'todo', 'task', 'list', 'inbox', 'memo'], render: () => <NotesView /> } },
  nav: { label: 'Notes', items: [{ id: 'notes', label: 'Notes', icon: 'file', view: 'notes' }] },
  dialogs: {
    'notes.item': { title: 'Note', icon: 'edit', searchable: false, render: (p, close) => <ItemEditor id={str(p.id)} close={close} /> },
    'notes.lists': { title: 'Manage lists', icon: 'folder', render: (p, close) => <ListsManager start={str(p.id) || undefined} close={close} /> },
    'notes.export': { title: 'Export notes', icon: 'download', render: (p, close) => <Export start={str(p.id) || undefined} close={close} /> },
  },
  contextMenu: [{ id: 'amberx.notes', items: [{ id: 'notes.add', label: 'New note', icon: 'plus', action: 'notes.add' }] }],
  appMenu: [{
    id: 'amberx.notes', menu: 'axhub', items: [
      { id: 'notes.open', label: 'Notes', icon: 'file', action: 'notes.open' },
      { id: 'notes.add', label: 'New note', icon: 'plus', action: 'notes.add' },
      { id: 'notes.search', label: 'Search notes', icon: 'search', action: 'notes.search' },
      { id: 'notes.lists', label: 'Manage note lists', icon: 'folder', action: 'dialog:notes.lists' },
      { id: 'notes.export', label: 'Export notes', icon: 'download', action: 'dialog:notes.export' },
    ],
  }],
  register(rt) {
    rt.actions.register('notes.open', ([list]) => open(rt, list || undefined), { label: 'Open notes' });
    rt.actions.register('notes.search', (args) => { setUi({ tab: 'search', q: args.join(':') }); rt.navigate('notes'); }, { label: 'Search notes' });
    rt.actions.register('notes.add', () => {
      const ui = getUi();
      setUi({ quickAdd: ui.quickAdd + 1, ...(ui.tab === 'pinned' || ui.tab === 'search' || (ui.tab === 'lists' && !ui.list) ? { tab: 'inbox' } : {}) });
      rt.navigate('notes');
    }, { label: 'New note' });
    startSync();
    watchPlugins();
  },
};

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
import type { AxfRuntime } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react';
import { listedPlugins } from '@console/notesHost';
import { Export } from './Export';
import { ItemEditor } from './ItemEditor';
import { ListsManager } from './ListsManager';
import { NotesView } from './NotesView';
import { snapshot, startSync, subscribe, syncPlugins } from './store';
import { getUi, setUi } from './ui';
import './notes.css';

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function open(rt: AxfRuntime, list?: string) {
  setUi(list ? { tab: 'lists', list } : {});
  rt.navigate('notes');
}

/** Once the hub has answered, make one list per installed plugin (where the host keeps one). */
function watchPlugins() {
  let done = false;
  const run = () => {
    if (done || snapshot().status !== 'ready') return;
    done = true;
    void listedPlugins().then((plugins) => { if (plugins) syncPlugins(plugins); }).catch(() => { done = false; });
  };
  subscribe(run);
  run();
}

export const notesLibrary: Pick<AxfWebLibrary, 'views' | 'dialogs' | 'contextMenu' | 'register'> = {
  views: { notes: { title: 'Notes', icon: 'file', keywords: ['notes', 'note', 'todo', 'task', 'list', 'inbox', 'memo'], render: () => <NotesView /> } },
  dialogs: {
    'notes.item': { title: 'Note', icon: 'edit', searchable: false, render: (p, close) => <ItemEditor id={str(p.id)} close={close} /> },
    'notes.lists': { title: 'Manage lists', icon: 'folder', render: (p, close) => <ListsManager start={str(p.id) || undefined} close={close} /> },
    'notes.export': { title: 'Export notes', icon: 'download', render: (p, close) => <Export start={str(p.id) || undefined} close={close} /> },
  },
  contextMenu: [{ id: 'amberx.notes', items: [{ id: 'notes.add', label: 'New note', icon: 'plus', action: 'notes.add' }] }],
  register(rt: AxfRuntime) {
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

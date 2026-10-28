/**
 * Lists manager (dialog `notes.lists`, props `{ id? }` = the list to start on): create lists and sub-lists, rename,
 * move under another list (canMoveList decides), reorder among siblings, delete (asking where its items go). System
 * lists (Inbox, Plugins, Voice notes) refuse rename/remove in core; the message shows as a toast.
 */
import { useState } from 'react';
import { Button, Icon, Note, SelectField, TextField, useRuntime } from '../../../axf/react';
import { SYS, addList, canMoveList, childrenOf, flatTree, isShared, itemsIn, moveList, pathOf, removeList, renameList, reorderLists, type Store } from './core';
import { useNotes } from './store';
import { tryDo } from './NotesView';
import { setUi } from './ui';

export function ListsManager({ start, close }: { start?: string; close: () => void }) {
  const rt = useRuntime();
  const n = useNotes();
  const s = n.own;
  const tree = flatTree(s).filter((t) => !isShared(t.list.id));
  const [sel, setSel] = useState<string>(start && s.lists[start] ? start : SYS.inbox);
  const [name, setName] = useState('');
  const [rename, setRename] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const [itemsTo, setItemsTo] = useState('');
  const l = s.lists[sel];
  const system = !!l?.system && l.system !== 'plugin';
  // a plugin's list follows its plugin: its name comes back on the next sync and it's made again if removed
  const pluginList = l?.system === 'plugin';

  const create = (parent: string | null) => {
    const made = tryDo(rt, (st) => addList(st, name, parent));
    if (made) { setName(''); setSel(made.id); rt.toast(`Made ${made.name}.`, 'success', 'Notes'); }
  };
  const shift = (dir: -1 | 1) => {
    if (!l) return;
    const sibs = childrenOf(s, l.parent).map((x) => x.id);
    const i = sibs.indexOf(l.id);
    const j = i + dir;
    if (j < 0 || j >= sibs.length) return;
    [sibs[i], sibs[j]] = [sibs[j]!, sibs[i]!];
    tryDo(rt, (st) => reorderLists(st, sibs));
  };
  const parents = (st: Store) => [
    { value: '', label: 'Top level' },
    ...flatTree(st).filter((t) => !isShared(t.list.id) && l && canMoveList(st, l.id, t.list.id) === null).map((t) => ({ value: t.list.id, label: t.path })),
  ];

  return (
    <div className="fx-stack axp-notes-manager">
      <div className="fx-card axp-notes-pad axp-notes-tree axp-notes-scroll">
        {tree.map((t) => (
          <button key={t.list.id} type="button" data-fx-row aria-pressed={t.list.id === sel} className={`axp-notes-tree__name${t.list.id === sel ? ' is-on' : ''}`} onClick={() => { setSel(t.list.id); setRename(''); setMoveTo(''); setItemsTo(''); }}>
            <span className="axp-notes-indent" aria-hidden>{Array.from({ length: t.depth }, (_, i) => <span key={i} className="axp-notes-indent__step" />)}</span>
            <Icon name={t.list.id === sel ? 'check' : t.list.icon || 'list'} size={14} />
            <span className="axp-notes-clip">{t.list.name}</span>
            <span className="fx-muted fx-small">{itemsIn(s, t.list.id).length}</span>
          </button>
        ))}
      </div>

      <div className="axp-notes-bar">
        <TextField label="New list" value={name} onChange={setName} placeholder="e.g. Shopping" className="axp-notes-grow" />
        <Button icon="plus" disabled={!name.trim()} onClick={() => create(null)}>At the top</Button>
        <Button icon="plus" disabled={!name.trim() || !l} onClick={() => create(sel)}>Inside {l?.name ?? '…'}</Button>
      </div>

      {l && (
        <div className="fx-card axp-notes-pad fx-stack">
          <p><strong>{pathOf(s, l.id)}</strong> <span className="fx-muted fx-small">{itemsIn(s, l.id).length} items · {childrenOf(s, l.id).length} lists</span></p>
          {system && <Note tone="info">{l.name} is built in: it can't be renamed, moved or removed (you can still add lists inside it).</Note>}
          {pluginList && <Note tone="info">This list belongs to a plugin: it keeps the plugin's name and comes back if removed. You can move it and add lists inside it.</Note>}
          <div className="axp-notes-bar">
            <Button size="sm" icon="chevron-up" onClick={() => shift(-1)}>Up</Button>
            <Button size="sm" icon="chevron-down" onClick={() => shift(1)}>Down</Button>
            <Button size="sm" icon="external" onClick={() => { setUi({ tab: 'lists', list: l.id }); rt.navigate('notes'); close(); }}>Open</Button>
          </div>
          {!system && (
            <>
              {!pluginList && <div className="axp-notes-bar">
                <TextField label="Rename" value={rename} onChange={setRename} placeholder={l.name} className="axp-notes-grow" />
                <Button size="sm" icon="edit" disabled={!rename.trim()} onClick={() => { if (tryDo(rt, (st) => renameList(st, l.id, rename)) !== undefined) setRename(''); }}>Rename</Button>
              </div>}
              <div className="axp-notes-bar">
                <SelectField label="Move under" value={moveTo} options={parents(s)} onChange={setMoveTo} className="axp-notes-grow" />
                <Button size="sm" icon="move" onClick={() => tryDo(rt, (st) => moveList(st, l.id, moveTo || null), 'Moved.')}>Move</Button>
              </div>
              {!pluginList && <div className="axp-notes-bar">
                <SelectField label="Delete it; its items go to" value={itemsTo || (l.parent ?? SYS.inbox)} onChange={setItemsTo}
                  options={tree.filter((t) => t.list.id !== l.id).map((t) => ({ value: t.list.id, label: t.path }))} className="axp-notes-grow" />
                <Button size="sm" tone="danger" icon="trash" confirm={`Delete the list ${l.name}? Its lists move up a level and its items go to ${s.lists[itemsTo || (l.parent ?? SYS.inbox)]?.name ?? 'Inbox'}.`}
                  onClick={() => { const to = itemsTo || (l.parent ?? SYS.inbox); if (tryDo(rt, (st) => removeList(st, l.id, to), `Deleted ${l.name}.`) !== undefined) setSel(to); }}>Delete</Button>
              </div>}
            </>
          )}
        </div>
      )}
      <div className="axp-notes-bar"><Button tone="ghost" onClick={close}>Close</Button></div>
    </div>
  );
}

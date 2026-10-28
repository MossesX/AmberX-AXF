/**
 * The Notes page: tabs Inbox · Lists · Notes · Pinned · Search, a hub status line, quick add, item cards with
 * multi-select (move, merge, tag, delete). Everything changes the store through `mutate` (store.ts) with the pure
 * functions of core.ts; nothing here touches the hub directly.
 */
import { useEffect, useMemo, useState } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { Button, Checkbox, Icon, IconButton, Note, Section, SelectField, Segmented, TextField, useRuntime } from '../../../axf/react';
import { loginUrl } from '../../../axf/libs/hub';
import { HUB } from '../../../hub/useHub';
import { native } from '../../../native';
import {
  SYS, addItem, allTags, ancestors, childrenOf, descendants, flatTree, isShared, itemsIn, mergeItems, moveItems, pathOf, removeItems,
  search, tagList, updateItem, type Item, type ItemKind, type Store,
} from './core';
import { adoptShared, mutate, useNotes, type Snapshot } from './store';
import { TABS, setUi, useUi, type NotesTab } from './ui';

/** Runs a change; a refusal from core (system lists, limits) becomes a toast. */
export function tryDo<T>(rt: AxfRuntime, fn: (s: Store) => T, done?: string): T | undefined {
  try {
    const out = mutate(fn);
    if (done) rt.toast(done, 'success', 'Notes');
    return out;
  } catch (e) {
    rt.toast(e instanceof Error ? e.message : String(e), 'danger', 'Notes');
    return undefined;
  }
}

/** List choices for pickers (every list as its path), optionally without the shared Voice notes ones. */
export function listOptions(s: Store, own = true) {
  return flatTree(s)
    .filter((t) => !own || !isShared(t.list.id))
    .map((t) => ({ value: t.list.id, label: `${'  '.repeat(t.depth)}${t.path.split(' › ').pop()}${t.depth ? `  (${t.path})` : ''}` }));
}

const when = (iso: string) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
};

/* ---------------------------------------------------------------- hub status line */

function HubLine({ n }: { n: Snapshot }) {
  const { status, queued, lastSync, error } = n;
  if (status === 'signed-out') {
    return (
      <Note tone="warning">
        Signed out of axHub: your notes live there. <Button size="sm" icon="external" onClick={() => void native.hubOpen({ url: loginUrl(HUB) })}>Sign in to axHub</Button>
      </Note>
    );
  }
  if (status === 'offline') return <Note tone="warning">axHub can't be reached{queued ? `: ${queued} change${queued === 1 ? '' : 's'} waiting to be saved` : ''}.{error ? ` (${error})` : ''}</Note>;
  return (
    <p className="fx-muted fx-small axp-notes-status">
      <Icon name={status === 'ready' ? 'cloud' : 'refresh'} size={12} />{' '}
      {status === 'loading' || status === 'idle' ? 'Loading from axHub…' : `Synced with axHub${lastSync ? ` at ${when(lastSync)}` : ''}`}
      {queued ? ` · ${queued} waiting` : ''}
    </p>
  );
}

/* ---------------------------------------------------------------- quick add */

function QuickAdd({ s, list, nonce }: { s: Store; list: string | null; nonce: number }) {
  const rt = useRuntime();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<ItemKind>('note');
  const [to, setTo] = useState(list && !isShared(list) ? list : SYS.inbox);
  useEffect(() => { if (list && !isShared(list)) setTo(list); }, [list]);
  const add = () => {
    if (!text.trim()) return;
    const it = tryDo(rt, (st) => addItem(st, { kind, list: to, text, source: 'typed' }));
    if (it) { setText(''); rt.toast(`Saved to ${s.lists[it.list]?.name ?? 'Inbox'}.`, 'success', 'Notes'); }
  };
  return (
    <div className="fx-stack axp-notes-quick" key={nonce}>
      <TextField label="Quick add" value={text} onChange={setText} rows={2} placeholder="Type a note…" autoFocus={nonce > 0} />
      <div className="axp-notes-bar">
        <Segmented size="sm" label="Kind" value={kind} onChange={setKind} options={[{ value: 'note', label: 'Note' }, { value: 'todo', label: 'Todo' }, { value: 'task', label: 'Task' }]} />
        <SelectField label="List" value={to} options={listOptions(s)} onChange={setTo} className="axp-notes-grow" />
        <Button tone="primary" icon="plus" disabled={!text.trim()} onClick={add}>Add</Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- cards + multi-select */

function ItemCard({ s, it, selecting, selected, onSelect }: { s: Store; it: Item; selecting: boolean; selected: boolean; onSelect: (v: boolean) => void }) {
  const rt = useRuntime();
  const shared = isShared(it.id);
  const snip = (it.summary || it.text).split('\n').filter(Boolean).slice(0, 2).join(' · ');
  const subtasks = Object.values(s.items).filter((x) => x.parent === it.id).length;
  const boxes = it.checklist.length ? `${it.checklist.filter((c) => c.done).length}/${it.checklist.length} ticked` : '';
  return (
    <div className="fx-card axp-notes-card">
      {selecting
        ? <Checkbox label="" title="Select" checked={selected} onChange={onSelect} />
        : it.kind !== 'note' && !shared
          ? <Checkbox label="" title={it.status === 'done' ? 'Mark not done' : 'Mark done'} checked={it.status === 'done'} onChange={(v) => void tryDo(rt, (st) => updateItem(st, it.id, { status: v ? 'done' : 'open' }))} />
          : <Icon name={shared ? 'mic' : 'file'} size={14} />}
      <button type="button" data-fx-row className="axp-notes-card__main" onClick={() => (selecting ? onSelect(!selected) : rt.openDialog('notes.item', { id: it.id }))}>
        <strong className="axp-notes-clip">{it.status === 'done' ? <s>{it.title}</s> : it.title}</strong>
        {snip && snip !== it.title && <span className="fx-muted axp-notes-clip">{snip}</span>}
        <span className="fx-muted fx-small axp-notes-clip">
          {pathOf(s, it.list)}{it.kind !== 'note' ? ` · ${it.kind}` : ''}{it.due ? ` · due ${it.due.slice(0, 10)}` : ''}{boxes ? ` · ${boxes}` : ''}
          {subtasks ? ` · ${subtasks} subtask${subtasks === 1 ? '' : 's'}` : ''}{it.updatedAt ? ` · ${when(it.updatedAt)}` : ''}
        </span>
        {(it.tags.length > 0 || it.pinned || it.starred || shared) && (
          <span className="axp-notes-tags">
            {shared && <span className="fx-chip">shared</span>}
            {it.pinned && <span className="fx-chip fx-chip--accent">pinned</span>}
            {it.starred && <span className="fx-chip fx-chip--warning">starred</span>}
            {it.tags.map((t) => <span key={t} className="fx-chip">#{t}</span>)}
          </span>
        )}
      </button>
      {!shared && !selecting && (
        <span className="axp-notes-card__tools">
          <IconButton icon="chevron-up" label={it.pinned ? 'Unpin' : 'Pin to the top'} aria-pressed={it.pinned} onClick={() => void tryDo(rt, (st) => updateItem(st, it.id, { pinned: !it.pinned }))} />
          <IconButton icon="star" label={it.starred ? 'Unstar' : 'Star'} aria-pressed={it.starred} onClick={() => void tryDo(rt, (st) => updateItem(st, it.id, { starred: !it.starred }))} />
        </span>
      )}
    </div>
  );
}

function SelectionBar({ s, ids, clear }: { s: Store; ids: string[]; clear: () => void }) {
  const rt = useRuntime();
  const own = ids.filter((id) => !isShared(id));
  const sharedOnes = ids.length - own.length;
  const [to, setTo] = useState<string>(SYS.inbox);
  const [tag, setTag] = useState('');
  const n = ids.length;
  return (
    <div className="fx-card axp-notes-pad fx-stack">
      <p className="fx-small"><strong>{n} selected</strong>{sharedOnes ? <span className="fx-muted"> · {sharedOnes} shared Voice note{sharedOnes === 1 ? '' : 's'}: Move copies {sharedOnes === 1 ? 'it' : 'them'}</span> : null}</p>
      <div className="axp-notes-bar">
        <SelectField label="Move to list" value={to} options={listOptions(s)} onChange={setTo} className="axp-notes-grow" />
        <Button icon="move" disabled={!n} onClick={() => {
          const moved = tryDo(rt, (st) => moveItems(st, own, to));
          if (sharedOnes) adoptShared(ids.filter(isShared), to);
          if (moved !== undefined) { rt.toast(`Moved to ${s.lists[to]?.name}.`, 'success', 'Notes'); clear(); }
        }}>Move</Button>
      </div>
      <div className="axp-notes-bar">
        <TextField label="Tag" value={tag} onChange={setTag} placeholder="e.g. work" className="axp-notes-grow" />
        <Button icon="plus" disabled={!own.length || !tagList(tag).length} onClick={() => {
          if (tryDo(rt, (st) => { for (const id of own) updateItem(st, id, { tags: tagList([...(st.items[id]?.tags ?? []), ...tagList(tag)]) }); }) !== undefined) setTag('');
        }}>Tag</Button>
      </div>
      <div className="axp-notes-bar">
        <Button icon="layers" disabled={own.length < 2} onClick={() => { if (tryDo(rt, (st) => mergeItems(st, own), `Merged ${own.length} into one.`)) clear(); }}>Merge</Button>
        <Button tone="danger" icon="trash" disabled={!own.length} confirm={`Delete ${own.length} item${own.length === 1 ? '' : 's'}?`}
          onClick={() => { if (tryDo(rt, (st) => removeItems(st, own), `Deleted ${own.length}.`) !== undefined) clear(); }}>Delete</Button>
        <Button tone="ghost" onClick={clear}>Cancel</Button>
      </div>
    </div>
  );
}

function ItemList({ s, items, empty }: { s: Store; items: Item[]; empty: string }) {
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const top = items.filter((i) => !i.parent || !s.items[i.parent]);
  const [limit, setLimit] = useState(60);
  const clear = () => { setSel([]); setSelecting(false); };
  if (!top.length) return <p className="fx-muted">{empty}</p>;
  return (
    <div className="fx-stack">
      <div className="axp-notes-bar">
        <span className="fx-muted fx-small axp-notes-grow">{top.length} item{top.length === 1 ? '' : 's'}</span>
        <Button size="sm" tone={selecting ? 'primary' : 'ghost'} icon="check" onClick={() => (selecting ? clear() : setSelecting(true))}>{selecting ? 'Done selecting' : 'Select'}</Button>
        {selecting && <Button size="sm" tone="ghost" onClick={() => setSel(sel.length === top.length ? [] : top.map((i) => i.id))}>{sel.length === top.length ? 'None' : 'All'}</Button>}
      </div>
      {selecting && sel.length > 0 && <SelectionBar s={s} ids={sel} clear={clear} />}
      {top.slice(0, limit).map((it) => (
        <ItemCard key={it.id} s={s} it={it} selecting={selecting} selected={sel.includes(it.id)}
          onSelect={(v) => setSel((cur) => (v ? [...new Set([...cur, it.id])] : cur.filter((x) => x !== it.id)))} />
      ))}
      {top.length > limit && <Button tone="ghost" onClick={() => setLimit(limit + 60)}>Show more ({top.length - limit} left)</Button>}
    </div>
  );
}

/* ---------------------------------------------------------------- lists tab */

function ListTree({ s }: { s: Store }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const count = (id: string) => itemsIn(s, id, true).filter((i) => !i.parent).length;
  const rows: JSX.Element[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const l of childrenOf(s, parent)) {
      const kids = childrenOf(s, l.id).length;
      rows.push(
        <div key={l.id} className="axp-notes-tree__row" data-depth={depth}>
          <span className="axp-notes-indent" aria-hidden>{Array.from({ length: depth }, (_, i) => <span key={i} className="axp-notes-indent__step" />)}</span>
          {kids
            ? <IconButton icon={open[l.id] ? 'chevron-down' : 'chevron-right'} label={open[l.id] ? 'Fold' : 'Unfold'} onClick={() => setOpen({ ...open, [l.id]: !open[l.id] })} />
            : <span className="axp-notes-indent__step" />}
          <button type="button" data-fx-row className="axp-notes-tree__name" onClick={() => setUi({ list: l.id })}>
            <Icon name={l.icon || (kids ? 'folder' : 'list')} size={14} />
            <span className="axp-notes-clip">{l.name}</span>
            <span className="fx-muted fx-small">{count(l.id)}{kids ? ` · ${kids} list${kids === 1 ? '' : 's'}` : ''}</span>
          </button>
        </div>,
      );
      if (kids && open[l.id]) walk(l.id, depth + 1);
    }
  };
  walk(null, 0);
  return <div className="fx-card axp-notes-pad axp-notes-tree">{rows}</div>;
}

function ListDetail({ s, id, ui }: { s: Store; id: string; ui: { quickAdd: number } }) {
  const rt = useRuntime();
  const l = s.lists[id];
  if (!l) return <Note tone="warning">That list is gone. <Button size="sm" onClick={() => setUi({ list: null })}>Back to lists</Button></Note>;
  const crumbs = ancestors(s, id);
  const subs = childrenOf(s, id);
  const shared = isShared(id) || id === SYS.voiceNotes;
  return (
    <div className="fx-stack">
      <div className="axp-notes-tags">
        <button type="button" className="fx-chip" onClick={() => setUi({ list: null })}><Icon name="arrow-left" size={11} /> All lists</button>
        {crumbs.map((c) => <button key={c.id} type="button" className="fx-chip" onClick={() => setUi({ list: c.id })}>{c.name}</button>)}
        <span className="fx-chip fx-chip--accent">{l.name}</span>
      </div>
      {shared && <Note tone="info">Voice notes come from the console's Voice notes and Voice Vault. They're read-only here; open one to copy it into a list.</Note>}
      {subs.length > 0 && (
        <Section title={`Lists in ${l.name}`}>
          <div className="fx-card axp-notes-pad axp-notes-tree">
            {subs.map((c) => (
              <button key={c.id} type="button" data-fx-row className="axp-notes-tree__name" onClick={() => setUi({ list: c.id })}>
                <Icon name={c.icon || 'list'} size={14} /><span className="axp-notes-clip">{c.name}</span>
                <span className="fx-muted fx-small">{itemsIn(s, c.id, true).length}</span>
              </button>
            ))}
          </div>
        </Section>
      )}
      <div className="axp-notes-bar">
        <Button size="sm" icon="sliders" onClick={() => rt.openDialog('notes.lists', { id })}>Manage lists</Button>
        <Button size="sm" icon="download" onClick={() => rt.openDialog('notes.export', { id })}>Export this list</Button>
      </div>
      {!shared && <QuickAdd s={s} list={id} nonce={ui.quickAdd} />}
      <ItemList s={s} items={itemsIn(s, id)} empty={`Nothing in ${l.name} yet.`} />
    </div>
  );
}

/* ---------------------------------------------------------------- search tab */

function SearchTab({ s, q }: { s: Store; q: string }) {
  const [kind, setKind] = useState<'' | ItemKind>('');
  const [status, setStatus] = useState<'' | 'not-done' | 'done'>('');
  const [tag, setTag] = useState('');
  const [list, setList] = useState('');
  const tags = useMemo(() => allTags(s), [s]);
  const found = useMemo(() => search(s, { q, kind, status, tag, list: list || undefined, deep: true }), [s, q, kind, status, tag, list]);
  const busy = q.trim() || kind || status || tag || list;
  return (
    <div className="fx-stack">
      <TextField label="Search notes" type="search" value={q} onChange={(v) => setUi({ q: v })} placeholder="Words in a title, text, tag or list" autoFocus />
      <div className="axp-notes-bar">
        <SelectField label="Kind" value={kind} onChange={(v) => setKind(v as '' | ItemKind)} options={[{ value: '', label: 'Any' }, { value: 'note', label: 'Notes' }, { value: 'todo', label: 'Todos' }, { value: 'task', label: 'Tasks' }]} />
        <SelectField label="Status" value={status} onChange={(v) => setStatus(v as '' | 'not-done' | 'done')} options={[{ value: '', label: 'Any' }, { value: 'not-done', label: 'Not done' }, { value: 'done', label: 'Done' }]} />
        <SelectField label="In list" value={list} onChange={setList} options={[{ value: '', label: 'Everywhere' }, ...listOptions(s, false)]} className="axp-notes-grow" />
      </div>
      {tags.length > 0 && (
        <div className="axp-notes-tags">
          {tags.map((t) => <button key={t} type="button" className={`fx-chip${tag === t ? ' is-on' : ''}`} aria-pressed={tag === t} onClick={() => setTag(tag === t ? '' : t)}>#{t}</button>)}
        </div>
      )}
      {busy ? <ItemList s={s} items={found} empty="Nothing found." /> : <p className="fx-muted">Type a word, or pick a kind, status, list or tag.</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- the page */

export function NotesView() {
  const rt = useRuntime();
  const n = useNotes();
  const ui = useUi();
  const s = n.view;
  const [, setTick] = useState(0);
  // the Dictate button shows once the dictation plugin has registered its action
  useEffect(() => { const t = window.setTimeout(() => setTick((x) => x + 1), 500); return () => window.clearTimeout(t); }, []);
  const canDictate = !!rt.actions.get('dictation.start');
  const openList = ui.tab === 'lists' && ui.list && !isShared(ui.list) ? ui.list : null;
  const countOf = (tab: NotesTab) => {
    if (tab === 'inbox') return itemsIn(s, SYS.inbox).length;
    if (tab === 'pinned') return Object.values(s.items).filter((i) => i.pinned || i.starred).length;
    if (tab === 'notes') return Object.keys(s.items).length;
    return 0;
  };
  const listCount = Object.keys(s.lists).length;
  return (
    <div className="fx-stack fx-stack--lg axp-notes">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Notes</p>
          <h1>{ui.tab === 'lists' && ui.list && s.lists[ui.list] ? s.lists[ui.list]!.name : TABS.find((t) => t.id === ui.tab)!.label}</h1>
          <HubLine n={n} />
        </div>
        <div className="axp-notes-bar">
          {canDictate && <Button tone="primary" icon="mic" onClick={() => rt.dispatch(openList ? `dictation.start:${openList}` : 'dictation.start')}>Dictate</Button>}
          <Button icon="download" onClick={() => rt.openDialog('notes.export', ui.tab === 'lists' && ui.list ? { id: ui.list } : {})}>Export</Button>
        </div>
      </header>
      <div className="fx-tabs" role="tablist">
        {TABS.map((t) => {
          const c = t.id === 'lists' ? listCount : countOf(t.id);
          return (
            <button key={t.id} type="button" role="tab" aria-selected={ui.tab === t.id} className={`fx-tab${ui.tab === t.id ? ' is-active' : ''}`}
              onClick={() => setUi({ tab: t.id, ...(t.id === 'lists' && ui.tab === 'lists' ? { list: null } : {}) })}>
              <Icon name={t.icon} size={13} /> {t.label}{c ? <span className="fx-muted"> {c}</span> : null}
            </button>
          );
        })}
      </div>
      {!n.loaded && n.status !== 'signed-out' && n.status !== 'offline' ? <p className="fx-muted">Loading your notes…</p> : (
        <>
          {ui.tab === 'inbox' && (
            <>
              <QuickAdd s={s} list={SYS.inbox} nonce={ui.quickAdd} />
              <ItemList s={s} items={itemsIn(s, SYS.inbox)} empty="The inbox is empty. Notes with no list land here." />
            </>
          )}
          {ui.tab === 'lists' && (ui.list ? <ListDetail s={s} id={ui.list} ui={ui} /> : (
            <div className="fx-stack">
              <div className="axp-notes-bar">
                <Button size="sm" icon="sliders" onClick={() => rt.openDialog('notes.lists', {})}>Manage lists</Button>
                <span className="fx-muted fx-small">Tap a list to open it. Plugins get a list each under Plugins.</span>
              </div>
              <ListTree s={s} />
            </div>
          ))}
          {ui.tab === 'notes' && (
            <>
              <QuickAdd s={s} list={null} nonce={ui.quickAdd} />
              <ItemList s={s} items={Object.values(s.items).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))} empty="No notes yet." />
            </>
          )}
          {ui.tab === 'pinned' && <ItemList s={s} items={Object.values(s.items).filter((i) => i.pinned || i.starred).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))} empty="Nothing pinned or starred yet." />}
          {ui.tab === 'search' && <SearchTab s={s} q={ui.q} />}
        </>
      )}
      {descendants(s, SYS.plugins).length === 0 && n.status === 'ready' && ui.tab === 'lists' && !ui.list && <p className="fx-muted fx-small">Plugin lists appear once the plugins are read.</p>}
    </div>
  );
}

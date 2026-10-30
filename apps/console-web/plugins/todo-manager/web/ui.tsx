/**
 * Todo manager — the page, the entry editor and the types editor. Ported from xGallery's task workspace
 * (src/pages/dev/tasks/*): lists with nested groups on the left, the open list as a tree (by structure, kind, status,
 * priority, tag or due date) or a grid, a selection bar for group actions, and an editor that follows each kind's rules.
 * Framework controls only (they follow the app's button, style theme and spacing); plugin CSS lays things out.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Container, Field, Icon, IconButton, Note, Section, Segmented, SelectField, Switch, TextField, useAxfState, useRuntime } from '@console/axf/react';
import {
  CORE_PARTS, DEFAULT_VIEW, FIELD_TYPES, KINDS, TONES, checklistText, childLists, dateInput, fromDateInput, groupEntries, listPaths, progress, readView, sortEntries, visible, words,
  type CorePart, type CoreRule, type Entry, type EntryKind, type FieldDef, type GroupBy, type ListView, type SortBy, type TodoList, type Tone, type TypeDef, type TypeSchema,
} from './core';
import { bulk, createList, deleteEntry, deleteList, exportList, loadAll, openList, saveEntry, saveTypes, toggleCheck, toggleDone, todoState, updateList, useTodo, type EntryDraft } from './store';
import { LoadingSkeleton } from '@console/emptyState';
import { MoreMenu } from './MoreMenu';

export const ENTRY_DIALOG = 'todo-manager.entry';
const VIEW_KEY = 'todo-manager.view';

const toneChip = (t: Tone | ''): 'accent' | 'success' | 'warning' | 'danger' | undefined => (t === 'accent' || t === 'success' || t === 'warning' || t === 'danger' ? t : t === 'info' ? 'accent' : undefined);

function useView(): [ListView, (p: Partial<ListView>) => void] {
  const rt = useRuntime();
  useAxfState();
  const v = readView(rt.settings.get(VIEW_KEY) ?? DEFAULT_VIEW);
  // settings hold plain values: the view is kept as JSON text
  return [v, (p) => { try { rt.settings.set(VIEW_KEY, JSON.stringify({ ...v, ...p })); } catch { /* storage off */ } }];
}

/* ---------------- the page ---------------- */

export function TodoView({ embedded = false }: { embedded?: boolean }) {
  const s = useTodo();
  useEffect(() => { if (!s.types && !s.loading) void loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`axp-todo ${embedded ? 'is-embedded' : ''}`}>
      {!embedded && <header className="fx-pagehead"><div><p className="fx-eyebrow">Work</p><h1>Todos</h1><p className="fx-muted" title="Lists of notes, to-dos and tasks with subtasks, checklists, tags and due dates — as a tree or a grid.">Notes, to-dos and tasks, as a tree or a grid.</p></div></header>}
      {s.error && <Note tone="danger">{s.error}</Note>}
      <div className="axp-todo__body">
        <ListsColumn />
        <main className="axp-todo__main">{s.open && s.types ? <OpenList /> : <Empty />}</main>
      </div>
    </div>
  );
}

function Empty() {
  const s = useTodo();
  if (s.loading) return <LoadingSkeleton />;
  return (
    <div className="axp-todo__empty">
      <Icon name="list" size={28} />
      <p>{s.lists.length ? 'Pick a list.' : 'No lists yet.'}</p>
      <Button tone="primary" icon="plus" onClick={() => void createList('My list')}>New list</Button>
    </div>
  );
}

function ListsColumn() {
  const s = useTodo();
  const [adding, setAdding] = useState('');
  const paths = listPaths(s.lists);
  const add = async () => { const t = adding.trim(); if (!t) return; setAdding(''); await createList(t); };
  return (
    <aside className="axp-todo__lists" aria-label="Lists">
      {/* phones: a drop-down instead of the column */}
      <div className="axp-todo__listpick">
        <select className="fx-input" aria-label="List" value={String(s.openId ?? '')} onChange={(e) => void openList(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Pick a list</option>
          {paths.map((p) => <option key={p.id} value={String(p.id)}>{p.path}</option>)}
        </select>
        <IconButton icon="plus" label="New list" onClick={() => { const t = window.prompt('List name'); if (t?.trim()) void createList(t.trim()); }} />
      </div>
      <ul className="axp-todo__tree" role="tree">
        {childLists(s.lists, null).map((l) => <ListRow key={l.id} l={l} depth={0} />)}
      </ul>
      <form className="axp-todo__addlist" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <TextField label="New list" value={adding} onChange={setAdding} placeholder="List name" />
        <Button size="sm" icon="plus" type="submit" disabled={!adding.trim()}>Add</Button>
      </form>
    </aside>
  );
}

function ListRow({ l, depth }: { l: TodoList; depth: number }) {
  const s = useTodo();
  const kids = childLists(s.lists, l.id);
  const on = s.openId === l.id;
  const open = on || (s.open?.lists.some((x) => x.id === l.id) ?? false);
  return (
    <li role="treeitem" aria-selected={on} aria-expanded={kids.length ? open : undefined}>
      <button type="button" data-fx-row="" className={`axp-todo__listrow ${on ? 'is-on' : ''}`} style={{ ['--axp-todo-depth' as string]: depth }} onClick={() => void openList(l.id)}>
        <Icon name={l.icon || (depth ? 'folder' : 'list')} size={14} />
        <span className="axp-todo__listname">{l.title}</span>
        {l.counts.entries > 0 && <span className="axp-todo__count">{l.counts.done}/{l.counts.entries}</span>}
      </button>
      {kids.length > 0 && open && <ul role="group">{kids.map((k) => <ListRow key={k.id} l={k} depth={depth + 1} />)}</ul>}
    </li>
  );
}

/* ---------------- the open list ---------------- */

function OpenList() {
  const rt = useRuntime();
  const s = useTodo();
  const [v, setView] = useView();
  const [sel, setSel] = useState<number[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const open = s.open!;
  const types = s.types!;
  useEffect(() => setSel([]), [open.list.id]);
  const shown = useMemo(() => sortEntries(visible(open.entries, v), v.sort, types), [open.entries, v, types]);
  const p = progress(open.entries);
  const filtersOn = v.groupBy !== DEFAULT_VIEW.groupBy || v.sort !== DEFAULT_VIEW.sort || !!v.kind || v.showDone !== DEFAULT_VIEW.showDone;
  const newEntry = (kind: EntryKind, listId = open.list.id, parentId: number | null = null) => rt.openDialog(ENTRY_DIALOG, { kind, listId, parentId });
  const toggle = (id: number) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  return (
    <div className="fx-stack">
      <div className="axp-todo__head">
        <ListTitle l={open.list} />
        <span className="axp-todo__progress">{p.total ? `${p.done} of ${p.total} done` : `${open.entries.length} entr${open.entries.length === 1 ? 'y' : 'ies'}`}</span>
      </div>
      {/* one bar: add (first kind up front, the rest behind ⋯), search, tree / grid, and the filters behind one toggle (compact pages, Oct 30 2026) */}
      <div className="axp-todo__bar">
        <Button size="sm" tone="primary" icon={types.task.icon} onClick={() => newEntry('task')}>{types.task.label}</Button>
        <MoreMenu label="Add something else" items={[
          ...KINDS.filter((k) => k !== 'task').map((k) => ({ id: k, label: `New ${types[k].label.toLowerCase()}`, icon: types[k].icon, onSelect: () => newEntry(k) })),
          { id: 'group', label: 'New group…', icon: 'folder', onSelect: () => { const t = window.prompt('Group name'); if (t?.trim()) void createList(t.trim(), open.list.id); } },
        ]} />
        <input className="fx-input axp-todo__search" type="search" aria-label="Search" value={v.q} onChange={(e) => setView({ q: e.target.value })} placeholder="Search title, text or tag" />
        <Segmented size="sm" label="View" value={v.mode} onChange={(mode) => setView({ mode })} options={[{ value: 'tree', label: '', icon: 'list', title: 'Tree' }, { value: 'grid', label: '', icon: 'grid', title: 'Grid' }]} />
        <IconButton icon="sliders" label={showFilters ? 'Hide filters' : 'Filters'} aria-pressed={showFilters} className={filtersOn ? 'is-on' : ''} onClick={() => setShowFilters(!showFilters)} />
      </div>
      {showFilters && (
        <div className="axp-todo__filters">
          {v.mode === 'tree' && <SelectField label="Group by" value={v.groupBy} onChange={(g) => setView({ groupBy: g as GroupBy })} options={(['structure', 'kind', 'status', 'priority', 'tag', 'due'] as const).map((g) => ({ value: g, label: g === 'structure' ? 'Lists and groups' : g === 'due' ? 'Due date' : words(g) }))} />}
          <SelectField label="Sort" value={v.sort} onChange={(x) => setView({ sort: x as SortBy })} options={(['manual', 'title', 'due', 'priority', 'updated'] as const).map((x) => ({ value: x, label: x === 'manual' ? 'My order' : x === 'updated' ? 'Last changed' : words(x) }))} />
          <SelectField label="Kind" value={v.kind} empty="Every kind" onChange={(k) => setView({ kind: k as ListView['kind'] })} options={KINDS.map((k) => ({ value: k, label: types[k].label }))} />
          <Switch label="Show done" checked={v.showDone} onChange={(showDone) => setView({ showDone })} />
        </div>
      )}
      {sel.length > 0 && <SelectionBar ids={sel} clear={() => setSel([])} />}
      {v.mode === 'grid'
        ? <Grid entries={shown} sel={sel} toggle={toggle} />
        : v.groupBy === 'structure'
          ? <Structure listId={open.list.id} entries={shown} sel={sel} toggle={toggle} onAdd={newEntry} />
          : groupEntries(shown, v.groupBy, types).map((g) => (
            <Container key={g.key || '_'} title={`${g.label} · ${g.entries.length}`}>
              <ul className="axp-todo__entries">{g.entries.map((e) => <EntryRow key={e.id} e={e} sel={sel} toggle={toggle} />)}</ul>
            </Container>
          ))}
      {!shown.length && <p className="fx-muted">{open.entries.length ? 'Nothing matches.' : 'Nothing here yet: add a task, a to-do or a note.'}</p>}
    </div>
  );
}

function ListTitle({ l }: { l: TodoList }) {
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState(l.title);
  useEffect(() => setTitle(l.title), [l.title]);
  if (edit) {
    return (
      <form className="axp-todo__rename" onSubmit={(e) => { e.preventDefault(); setEdit(false); if (title.trim() && title !== l.title) void updateList(l.id, { title: title.trim() }); }}>
        <TextField label="List name" value={title} onChange={setTitle} autoFocus />
        <Button size="sm" tone="primary" type="submit">Save</Button>
        <Button size="sm" onClick={() => { setEdit(false); setTitle(l.title); }}>Cancel</Button>
      </form>
    );
  }
  return (
    <div className="axp-todo__title">
      <h2>{l.title}</h2>
      <IconButton icon="edit" label="Rename" onClick={() => setEdit(true)} />
      <ToneMenu l={l} />
      <MoreMenu label="More for this list" items={[
        { id: 'export', label: 'Export as Markdown', icon: 'download', onSelect: () => void exportList(l.id) },
        { id: 'delete', label: 'Delete this list…', icon: 'trash', onSelect: () => { if (window.confirm(`Delete “${l.title}” with its groups and every entry in it?`)) void deleteList(l.id); } },
      ]} />
    </div>
  );
}

function ToneMenu({ l }: { l: TodoList }) {
  return (
    <select className="fx-input axp-todo__tone" aria-label="List colour" value={l.tone} onChange={(e) => void updateList(l.id, { tone: e.target.value as Tone | '' })}>
      <option value="">No colour</option>
      {TONES.map((t) => <option key={t} value={t}>{words(t)}</option>)}
    </select>
  );
}

/** By structure: the list's own entries, then each group with its entries; subtasks nested under their parent. */
function Structure({ listId, entries, sel, toggle, onAdd }: { listId: number; entries: Entry[]; sel: number[]; toggle: (id: number) => void; onAdd: (k: EntryKind, listId: number) => void }) {
  const s = useTodo();
  const groups = childLists(s.open!.lists, listId);
  const ids = new Set(entries.map((e) => e.id));
  // a subtask whose parent is filtered out still shows, at the top level
  const top = entries.filter((e) => e.listId === listId && (e.parentId == null || !ids.has(e.parentId)));
  return (
    <>
      {top.length > 0 && <ul className="axp-todo__entries">{top.map((e) => <EntryTree key={e.id} e={e} all={entries} sel={sel} toggle={toggle} />)}</ul>}
      {groups.map((g) => (
        <Container key={g.id} title={g.title} icon="folder" actions={<GroupActions g={g} onAdd={onAdd} />}>
          <Structure listId={g.id} entries={entries} sel={sel} toggle={toggle} onAdd={onAdd} />
        </Container>
      ))}
    </>
  );
}

function GroupActions({ g, onAdd }: { g: TodoList; onAdd: (k: EntryKind, listId: number) => void }) {
  return (
    <span className="axp-todo__groupacts">
      <IconButton icon="plus" label={`Add a task to ${g.title}`} onClick={() => onAdd('task', g.id)} />
      <IconButton icon="edit" label="Rename group" onClick={() => { const t = window.prompt('Group name', g.title); if (t?.trim()) void updateList(g.id, { title: t.trim() }); }} />
      <IconButton icon="trash" label="Delete group" onClick={() => { if (window.confirm(`Delete the group “${g.title}” and everything in it?`)) void deleteList(g.id); }} />
    </span>
  );
}

function EntryTree({ e, all, sel, toggle }: { e: Entry; all: Entry[]; sel: number[]; toggle: (id: number) => void }) {
  const kids = all.filter((x) => x.parentId === e.id);
  return (
    <EntryRow e={e} sel={sel} toggle={toggle}>
      {kids.length > 0 && <ul className="axp-todo__entries axp-todo__entries--sub">{kids.map((k) => <EntryTree key={k.id} e={k} all={all} sel={sel} toggle={toggle} />)}</ul>}
    </EntryRow>
  );
}

function EntryRow({ e, sel, toggle, children }: { e: Entry; sel: number[]; toggle: (id: number) => void; children?: React.ReactNode }) {
  const rt = useRuntime();
  const types = useTodo().types!;
  const t = types[e.kind];
  const done = e.status === 'done';
  const ck = checklistText(e);
  return (
    <li className={`axp-todo__entry ${done ? 'is-done' : ''}`}>
      <div className="axp-todo__entryline" data-fx-ctx-target="axf-todo-entry" data-fx-ctx-payload={String(e.id)}>
        <input type="checkbox" className="axp-todo__pick" aria-label={`Select ${e.title}`} checked={sel.includes(e.id)} onChange={() => toggle(e.id)} />
        {e.kind !== 'note'
          ? <IconButton icon={done ? 'check-circle' : 'check'} label={done ? 'Mark not done' : 'Mark done'} className={done ? 'is-on' : ''} onClick={() => void toggleDone(e)} />
          : <span className="axp-todo__kindicon"><Icon name={t.icon} size={14} /></span>}
        <button type="button" data-fx-row="" className="axp-todo__entrymain" onClick={() => rt.openDialog(ENTRY_DIALOG, { id: e.id })}>
          <span className="axp-todo__entrytitle">{e.title}</span>
          <span className="axp-todo__meta">
            <Chip tone={toneChip(t.tone)}>{t.label}</Chip>
            {t.core.status !== 'hidden' && !done && <span>{words(e.status)}</span>}
            {t.core.priority !== 'hidden' && (e.priority === 'high' || e.priority === 'urgent') && <Chip tone={e.priority === 'urgent' ? 'danger' : 'warning'}>{words(e.priority)}</Chip>}
            {e.dueAt != null && <span className={e.dueAt < Date.now() && !done ? 'is-late' : ''}><Icon name="clock" size={11} /> {new Date(e.dueAt).toLocaleDateString()}</span>}
            {ck && <span><Icon name="check" size={11} /> {ck}</span>}
            {e.tags.map((tag) => <span key={tag} className="axp-todo__tag">#{tag}</span>)}
          </span>
        </button>
      </div>
      {e.kind === 'todo' && e.checklist.length > 0 && !done && (
        <ul className="axp-todo__checks">
          {e.checklist.filter((c) => c.text.trim()).map((c) => (
            <li key={c.id}><label className={c.done ? 'is-done' : ''}><input type="checkbox" checked={c.done} onChange={() => void toggleCheck(e, c.id)} /> {c.text}</label></li>
          ))}
        </ul>
      )}
      {children}
    </li>
  );
}

function Grid({ entries, sel, toggle }: { entries: Entry[]; sel: number[]; toggle: (id: number) => void }) {
  const rt = useRuntime();
  const types = useTodo().types!;
  const extra = useMemo(() => {
    const seen = new Map<string, FieldDef>();
    for (const k of KINDS) for (const f of types[k].fields) if (f.showInGrid && !seen.has(f.key)) seen.set(f.key, f);
    return [...seen.values()];
  }, [types]);
  const cell = (v: unknown, f: FieldDef) => (v == null || v === '' ? '' : f.type === 'checkbox' ? (v ? '✓' : '') : f.type === 'date' ? new Date(Number(v)).toLocaleDateString() : Array.isArray(v) ? v.join(', ') : String(v));
  return (
    <div className="axp-todo__gridwrap">
      <table className="fx-table axp-todo__grid">
        <thead><tr><th aria-label="Select" /><th>Title</th><th>Kind</th><th>Status</th><th>Priority</th><th>Due</th><th>Tags</th>{extra.map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className={e.status === 'done' ? 'is-done' : ''} data-fx-ctx-target="axf-todo-entry" data-fx-ctx-payload={String(e.id)}>
              <td><input type="checkbox" aria-label={`Select ${e.title}`} checked={sel.includes(e.id)} onChange={() => toggle(e.id)} /></td>
              <td><button type="button" data-fx-row="" className="axp-todo__cellbtn" onClick={() => rt.openDialog(ENTRY_DIALOG, { id: e.id })}>{e.title}</button></td>
              <td>{types[e.kind].label}</td>
              <td>{types[e.kind].core.status === 'hidden' ? '' : words(e.status)}</td>
              <td>{types[e.kind].core.priority === 'hidden' ? '' : words(e.priority)}</td>
              <td>{e.dueAt != null ? new Date(e.dueAt).toLocaleDateString() : ''}</td>
              <td>{e.tags.join(', ')}</td>
              {extra.map((f) => <td key={f.key}>{cell(e.fields[f.key], f)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SelectionBar({ ids, clear }: { ids: number[]; clear: () => void }) {
  const s = useTodo();
  const [moveTo, setMoveTo] = useState('');
  const [note, setNote] = useState('');
  const statuses = [...new Set(KINDS.flatMap((k) => s.types![k].statuses))];
  const after = (r: { ok: boolean; count: number; errors?: string[] } | null, what: string) => {
    if (!r) return;
    setNote(r.errors?.length ? `${r.count} ${what}; not changed: ${r.errors.join('; ')}` : `${r.count} ${what}`);
    clear();
  };
  return (
    <div className="axp-todo__selbar" role="toolbar" aria-label="Selected entries">
      <strong>{ids.length} selected</strong>
      <Button size="sm" icon="check" onClick={async () => after(await bulk(ids, { action: 'patch', patch: { status: 'done' } }), 'marked done')}>Done</Button>
      <select className="fx-input" aria-label="Set status" value="" onChange={async (e) => { if (e.target.value) after(await bulk(ids, { action: 'patch', patch: { status: e.target.value } }), 'changed'); }}>
        <option value="">Status…</option>
        {statuses.map((x) => <option key={x} value={x}>{words(x)}</option>)}
      </select>
      <select className="fx-input" aria-label="Move to" value={moveTo} onChange={async (e) => { setMoveTo(''); if (e.target.value) after(await bulk(ids, { action: 'move', listId: Number(e.target.value) }), 'moved'); }}>
        <option value="">Move to…</option>
        {listPaths(s.lists).map((p) => <option key={p.id} value={p.id}>{p.path}</option>)}
      </select>
      <MoreMenu label="More for the selection" items={[
        { id: 'dup', label: 'Duplicate', icon: 'copy', onSelect: async () => after(await bulk(ids, { action: 'duplicate' }), 'duplicated') },
        { id: 'delete', label: 'Delete…', icon: 'trash', onSelect: async () => { if (window.confirm(`Delete ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'} (and their subtasks)?`)) after(await bulk(ids, { action: 'delete' }), 'deleted'); } },
      ]} />
      <IconButton icon="x" label="Clear the selection" onClick={clear} />
      {note && <span className="fx-muted">{note}</span>}
    </div>
  );
}

/* ---------------- the entry editor (dialog) ---------------- */

export function EntryEditor({ props, close }: { props: Record<string, unknown>; close: () => void }) {
  const rt = useRuntime();
  const s = useTodo();
  const id = typeof props.id === 'number' ? props.id : null;
  const existing = id != null ? s.open?.entries.find((e) => e.id === id) ?? null : null;
  const [d, setD] = useState<EntryDraft>(() => existing
    ? { ...existing, checklist: existing.checklist.map((c) => ({ ...c })), fields: { ...existing.fields } }
    : { kind: (KINDS.includes(props.kind as EntryKind) ? props.kind : 'task') as EntryKind, listId: Number(props.listId) || (todoState().openId ?? 0), parentId: typeof props.parentId === 'number' ? props.parentId : null, title: '', body: '', tags: [], checklist: [], fields: {} });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const types = s.types;
  if (!types) return <LoadingSkeleton />;
  if (id != null && !existing) return <Note tone="warning">That entry isn’t in the open list any more.</Note>;
  const kind = (d.kind ?? 'task') as EntryKind;
  const t = types[kind];
  const show = (p: CorePart) => t.core[p] !== 'hidden';
  const req = (p: CorePart) => t.core[p] === 'required';
  const up = (p: Partial<EntryDraft>) => setD((x) => ({ ...x, ...p }));
  const save = async (draft = false) => {
    setBusy(true);
    const r = await saveEntry(id, { ...d, ...(draft ? { draft: true } : {}) });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    if (r.warnings.length) rt.toast(r.warnings.join('. '), 'warning', 'Saved as a draft');
    close();
  };
  const parents = (s.open?.entries ?? []).filter((e) => e.id !== id && e.listId === d.listId && types[e.kind].core.subtasks !== 'hidden');
  return (
    <form className="fx-stack axp-todo__editor" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <Segmented label="Kind" value={kind} onChange={(k) => up({ kind: k, status: types[k].defaultStatus, priority: types[k].defaultPriority })} options={KINDS.map((k) => ({ value: k, label: types[k].label, icon: types[k].icon }))} />
      <TextField label="Title" value={d.title ?? ''} onChange={(title) => up({ title })} required autoFocus />
      {show('body') && <TextField label={kind === 'note' ? 'Note' : 'Details'} rows={kind === 'note' ? 8 : 4} value={d.body ?? ''} onChange={(body) => up({ body })} required={req('body')} />}
      <div className="axp-todo__editrow">
        {show('status') && <SelectField label="Status" value={d.status ?? t.defaultStatus} onChange={(status) => up({ status })} options={t.statuses.map((x) => ({ value: x, label: words(x) }))} required={req('status')} />}
        {show('priority') && <SelectField label="Priority" value={d.priority ?? t.defaultPriority} onChange={(priority) => up({ priority })} options={t.priorities.map((x) => ({ value: x, label: words(x) }))} required={req('priority')} />}
        {show('due') && <Field label="Due" required={req('due')}>{(fid) => <input id={fid} type="date" className="fx-input fx-field__input" value={dateInput(d.dueAt ?? null)} onChange={(e) => up({ dueAt: fromDateInput(e.target.value) })} />}</Field>}
      </div>
      {show('tags') && <TextField label="Tags" hint="Separate with commas" value={(d.tags ?? []).join(', ')} onChange={(x) => up({ tags: x.split(',').map((y) => y.trim()).filter(Boolean) })} required={req('tags')} />}
      {show('checklist') && <ChecklistEditor items={d.checklist ?? []} onChange={(checklist) => up({ checklist })} required={req('checklist')} />}
      {t.fields.map((f) => <CustomField key={f.key} f={f} value={(d.fields ?? {})[f.key]} onChange={(v) => up({ fields: { ...(d.fields ?? {}), [f.key]: v } })} />)}
      <div className="axp-todo__editrow">
        <SelectField label="List" value={String(d.listId ?? '')} onChange={(v) => up({ listId: Number(v), parentId: null })} options={listPaths(s.lists).map((p) => ({ value: String(p.id), label: p.path }))} />
        {show('subtasks') || d.parentId != null ? <SelectField label="Subtask of" value={String(d.parentId ?? '')} empty="Nothing (top level)" onChange={(v) => up({ parentId: v ? Number(v) : null })} options={parents.map((e) => ({ value: String(e.id), label: e.title }))} /> : null}
      </div>
      {error && <Note tone="danger">{error}</Note>}
      <div className="fx-row fx-row--end axp-todo__editacts">
        {id != null && <Button tone="danger" icon="trash" onClick={async () => { if (window.confirm('Delete this entry and its subtasks?')) { await deleteEntry(id); close(); } }}>Delete</Button>}
        {id != null && t.core.subtasks !== 'hidden' && <Button icon="plus" onClick={() => { close(); rt.openDialog(ENTRY_DIALOG, { kind: 'task', listId: d.listId, parentId: id }); }}>Subtask</Button>}
        {error && <Button onClick={() => void save(true)} disabled={busy}>Save as draft</Button>}
        <Button onClick={close}>Cancel</Button>
        <Button tone="primary" icon="save" type="submit" disabled={busy || !(d.title ?? '').trim()}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  );
}

function ChecklistEditor({ items, onChange, required }: { items: { id: string; text: string; done: boolean }[]; onChange: (v: { id: string; text: string; done: boolean }[]) => void; required: boolean }) {
  const set = (i: number, p: Partial<{ text: string; done: boolean }>) => onChange(items.map((c, j) => (j === i ? { ...c, ...p } : c)));
  return (
    <Field label="Checklist" required={required}>
      {() => (
        <div className="axp-todo__checkedit">
          {items.map((c, i) => (
            <div key={c.id} className="axp-todo__checkline">
              <input type="checkbox" aria-label="Done" checked={c.done} onChange={(e) => set(i, { done: e.target.checked })} />
              <input className="fx-input" aria-label={`Item ${i + 1}`} value={c.text} onChange={(e) => set(i, { text: e.target.value })} />
              <IconButton icon="x" label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="sm" icon="plus" onClick={() => onChange([...items, { id: `c${Date.now().toString(36)}`, text: '', done: false }])}>Add item</Button>
        </div>
      )}
    </Field>
  );
}

function CustomField({ f, value, onChange }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const str = value == null ? '' : String(value);
  switch (f.type) {
    case 'checkbox': return <Switch label={f.label} checked={value === true} onChange={onChange} />;
    case 'select': return <SelectField label={f.label} value={str} empty="—" required={f.required} onChange={onChange} options={f.options.map((o) => ({ value: o, label: o }))} />;
    case 'textarea': return <TextField label={f.label} rows={4} value={str} placeholder={f.placeholder} required={f.required} onChange={onChange} />;
    case 'number': return <TextField label={f.label} type="number" value={str} placeholder={f.placeholder} required={f.required} onChange={(v) => onChange(v === '' ? null : Number(v))} />;
    case 'url': return <TextField label={f.label} type="url" value={str} placeholder={f.placeholder} required={f.required} onChange={onChange} />;
    case 'tags': return <TextField label={f.label} hint="Separate with commas" value={Array.isArray(value) ? value.join(', ') : str} required={f.required} onChange={(v) => onChange(v.split(',').map((x) => x.trim()).filter(Boolean))} />;
    case 'date': return <Field label={f.label} required={f.required}>{(fid) => <input id={fid} type="date" className="fx-input fx-field__input" value={dateInput(typeof value === 'number' ? value : null)} onChange={(e) => onChange(fromDateInput(e.target.value))} />}</Field>;
    default: return <TextField label={f.label} value={str} placeholder={f.placeholder} required={f.required} onChange={onChange} />;
  }
}

/* ---------------- Settings → Plugins → Todo manager: what each kind holds ---------------- */

export function TypesPanel() {
  const s = useTodo();
  const [draft, setDraft] = useState<TypeSchema | null>(null);
  const [kind, setKind] = useState<EntryKind>('task');
  const [saved, setSaved] = useState('');
  useEffect(() => { if (!s.types) void loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (s.types) setDraft(structuredClone(s.types)); }, [s.types]);
  if (!draft) return <p className="fx-muted">{s.error || 'Loading…'}</p>;
  const t = draft[kind];
  const up = (p: Partial<TypeDef>) => { setSaved(''); setDraft({ ...draft, [kind]: { ...t, ...p } }); };
  const upField = (i: number, p: Partial<FieldDef>) => up({ fields: t.fields.map((f, j) => (j === i ? { ...f, ...p } : f)) });
  const csv = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
  return (
    <div className="fx-stack">
      <p className="fx-muted" style={{ margin: 0 }}>What each kind of entry must, may or never holds. Changes apply to new edits; existing entries keep their values until they’re saved again.</p>
      <Segmented label="Kind" value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: draft[k].label, icon: draft[k].icon }))} />
      <div className="axp-todo__editrow">
        <TextField label="Name" value={t.label} onChange={(label) => up({ label })} />
        <SelectField label="Colour" value={t.tone} onChange={(tone) => up({ tone: tone as Tone })} options={TONES.map((x) => ({ value: x, label: words(x) }))} />
      </div>
      <Section title="Parts">
        <div className="axp-todo__rules">
          {CORE_PARTS.map((p) => (
            <SelectField key={p} label={p === 'due' ? 'Due date' : words(p)} value={t.core[p]} onChange={(r) => up({ core: { ...t.core, [p]: r as CoreRule } })} options={(['required', 'optional', 'hidden'] as const).map((r) => ({ value: r, label: words(r) }))} />
          ))}
        </div>
      </Section>
      <div className="axp-todo__editrow">
        <TextField label="Statuses" hint="Comma separated, in order" value={t.statuses.join(', ')} onChange={(v) => up({ statuses: csv(v) })} />
        <SelectField label="New ones start as" value={t.defaultStatus} onChange={(defaultStatus) => up({ defaultStatus })} options={t.statuses.map((x) => ({ value: x, label: words(x) }))} />
      </div>
      <div className="axp-todo__editrow">
        <TextField label="Priorities" hint="Comma separated, least urgent first" value={t.priorities.join(', ')} onChange={(v) => up({ priorities: csv(v) })} />
        <SelectField label="Default priority" value={t.defaultPriority} onChange={(defaultPriority) => up({ defaultPriority })} options={t.priorities.map((x) => ({ value: x, label: words(x) }))} />
      </div>
      <Section title="Custom fields" aside={<Button size="sm" icon="plus" disabled={t.fields.length >= 24} onClick={() => up({ fields: [...t.fields, { key: '', label: 'New field', type: 'text', required: false, options: [], placeholder: '', showInGrid: false }] })}>Add field</Button>}>
        {!t.fields.length && <p className="fx-muted" style={{ margin: 0 }}>None.</p>}
        {t.fields.map((f, i) => (
          <div key={i} className="axp-todo__fielddef">
            <TextField label="Label" value={f.label} onChange={(label) => upField(i, { label })} />
            <SelectField label="Type" value={f.type} onChange={(type) => upField(i, { type: type as FieldDef['type'] })} options={FIELD_TYPES.map((x) => ({ value: x, label: words(x) }))} />
            {f.type === 'select' && <TextField label="Options" hint="Comma separated" value={f.options.join(', ')} onChange={(v) => upField(i, { options: csv(v) })} />}
            <Switch label="Required" checked={f.required} onChange={(required) => upField(i, { required })} />
            <Switch label="Column in the grid" checked={f.showInGrid} onChange={(showInGrid) => upField(i, { showInGrid })} />
            <IconButton icon="trash" label="Remove field" onClick={() => up({ fields: t.fields.filter((_, j) => j !== i) })} />
          </div>
        ))}
      </Section>
      <div className="fx-row">
        <Button tone="primary" icon="save" onClick={async () => { const r = await saveTypes(draft); setSaved(r ? 'Saved.' : ''); }}>Save</Button>
        <Button icon="undo" onClick={() => { setDraft(structuredClone(s.types!)); setSaved(''); }}>Undo changes</Button>
        {saved && <span className="fx-muted">{saved}</span>}
      </div>
      {s.error && <Note tone="danger">{s.error}</Note>}
    </div>
  );
}

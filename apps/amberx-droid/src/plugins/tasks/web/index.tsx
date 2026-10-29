/**
 * Tasks: the todos and tasks of the shared AmberX notes store (`plugins/notes/web/store.ts`, kept on axHub), shown by
 * when they're due. Tabs Today (overdue + today) · Upcoming (7 days) · Todo · All · Done, a filter row, Grid or Tree,
 * quick add, an editor (checklist, subtasks), bulk changes. Every change goes through the notes store's `mutate`.
 * Counter `tasks.today` (overdue + today, not done) is on the nav item.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type MouseEvent as RMouseEvent, type ReactNode } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import {
  Button, Checkbox, Chip, Container, Icon, IconButton, Note, Segmented, SelectField, TextField, useRuntime, type AxfWebLibrary,
} from '../../../axf/react';
import { DataGrid, type GridColumn, type GridSort } from '../../../axf/libs/datagrid';
import {
  allTags, flatTree, moveItems, pathOf, removeItems, updateItem, PRIORITY_LABEL, SYS,
  type Item, type Priority, type Status, type Store,
} from '../../notes/web/core';
import { load, mutate, snapshot, subscribe, useNotes } from '../../notes/web/store';
import { registerVoiceCommands } from '../../voice/web/index';
import {
  addCheck, byDue, checklistProgress, cyclePriority, cycleStatus, dueLabel, filterTasks, isTab, moveCheck, parseDue,
  PRIORITY_SHORT, priorityTone, quickAdd, removeCheck, setDone, setDoneMany, setDueMany, STATUS_LABEL, statusTone,
  subtaskProgress, subtasksOf, TABS, tabCounts, tabItems, tagsFromText, todayCount, todaySummary, toggleCheck, type TaskFilter, type TasksTab,
} from './core';
import './tasks.css';

const ID = 'ai.amberx.amberx.tasks';
const BADGE = 'tasks.today';
const K = { tab: 'amberx.tasks.tab', mode: 'amberx.tasks.mode' } as const;
const EDIT = 'tasks.edit';
const ADD = 'tasks.add';

/* ---------------------------------------------------------------- page state (shared by actions and the view) */

type Mode = 'grid' | 'tree';
let ui: { tab: TasksTab | null } = { tab: null };
const uiSubs = new Set<() => void>();
const setUi = (p: Partial<typeof ui>) => { ui = { ...ui, ...p }; uiSubs.forEach((f) => f()); };
const useUi = () => useSyncExternalStore((f) => { uiSubs.add(f); return () => { uiSubs.delete(f); }; }, () => ui);

function tryMutate<T>(rt: AxfRuntime, fn: (s: Store) => T): T | undefined {
  try { return mutate(fn); } catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'warning', 'Tasks'); return undefined; }
}

const listOptions = (s: Store) => flatTree(s).filter((t) => t.list.id !== SYS.voiceNotes).map((t) => ({ value: t.list.id, label: `${'  '.repeat(t.depth)}${t.path}` }));
const PRIORITY_OPTIONS = PRIORITY_LABEL.map((l, i) => ({ value: String(i), label: l }));

/* ---------------------------------------------------------------- small pieces */

function DueChip({ item }: { item: Item }) {
  const d = dueLabel(item.due, new Date(), item.status === 'done');
  if (!d.text) return null;
  return <span title={item.due.slice(0, 10)}><Chip tone={d.tone}>{d.overdue ? '⚠ ' : ''}{d.text}</Chip></span>;
}

function StatusChip({ item }: { item: Item }) {
  const rt = useRuntime();
  if (item.kind !== 'task') return null;
  return (
    <button type="button" className={`fx-chip ${statusTone(item.status) ? `fx-chip--${statusTone(item.status)}` : ''}`} title="Tap: open → doing → done"
      onClick={(e) => { e.stopPropagation(); tryMutate(rt, (s) => cycleStatus(s, item.id)); }}>{STATUS_LABEL[item.status]}</button>
  );
}

function PriorityChip({ item }: { item: Item }) {
  const rt = useRuntime();
  const tone = priorityTone(item.priority);
  return (
    <button type="button" className={`fx-chip ${tone ? `fx-chip--${tone}` : ''}`} title={`Priority: ${PRIORITY_LABEL[item.priority]} (tap to change)`}
      onClick={(e) => { e.stopPropagation(); tryMutate(rt, (s) => cyclePriority(s, item.id)); }}>{PRIORITY_SHORT[item.priority]}</button>
  );
}

function DoneBox({ item }: { item: Item }) {
  const rt = useRuntime();
  return (
    <span className="axp-tasks-box" onClick={(e) => e.stopPropagation()}>
      <Checkbox label={<span className="axp-tasks-sr">{item.status === 'done' ? 'Reopen' : 'Done'}</span>} checked={item.status === 'done'}
        onChange={(v) => tryMutate(rt, (s) => setDone(s, item.id, v))} />
    </span>
  );
}

function Progress({ s, item }: { s: Store; item: Item }) {
  const sub = subtaskProgress(s, item.id);
  const cl = checklistProgress(item);
  const parts = [sub.total ? `${sub.done}/${sub.total} sub` : '', cl.total ? `☑ ${cl.done}/${cl.total}` : ''].filter(Boolean);
  return parts.length ? <span className="fx-muted fx-small axp-tasks-meta">{parts.join(' · ')}</span> : null;
}

/** Empty state (design language §11): an icon, one sentence, one action. */
function Empty({ icon, text, action }: { icon: string; text: string; action?: ReactNode }) {
  return (
    <div className="fx-empty axp-tasks-empty">
      <Icon name={icon} size={24} />
      <p className="fx-muted">{text}</p>
      {action}
    </div>
  );
}

/** One line: tick, title (opens the editor), chips. `select` = tap toggles selection instead. */
function TaskRow({ s, item, depth = 0, selecting, selected, onSelect }: { s: Store; item: Item; depth?: number; selecting: boolean; selected: boolean; onSelect: (id: string) => void }) {
  const rt = useRuntime();
  return (
    <div className={`axp-tasks-row${item.status === 'done' ? ' is-done' : ''}${selected ? ' is-selected' : ''}`} style={{ '--axp-depth': depth } as React.CSSProperties}>
      {selecting
        ? <span className="axp-tasks-box"><Checkbox label={<span className="axp-tasks-sr">Select</span>} checked={selected} onChange={() => onSelect(item.id)} /></span>
        : <DoneBox item={item} />}
      <button type="button" data-fx-row className="axp-tasks-title" onClick={() => (selecting ? onSelect(item.id) : rt.openDialog(EDIT, { id: item.id }))}>
        <span className="axp-tasks-titletext">{item.title}</span>
        <Progress s={s} item={item} />
      </button>
      <span className="axp-tasks-chips">
        <DueChip item={item} />
        <StatusChip item={item} />
        <PriorityChip item={item} />
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- quick add */

function QuickAddForm({ defaultList, parent, onDone, autoFocus }: { defaultList?: string; parent?: string; onDone?: () => void; autoFocus?: boolean }) {
  const rt = useRuntime();
  const { own } = useNotes();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'todo' | 'task'>(parent ? 'task' : 'todo');
  const [list, setList] = useState(defaultList && own.lists[defaultList] ? defaultList : SYS.inbox);
  const [dueText, setDueText] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<Priority>(0);
  const typed = dueText.trim() ? parseDue(dueText) : '';
  const due = typed || dueDate;
  const add = () => {
    if (dueText.trim() && !typed) { rt.toast(`I don't know the date “${dueText}”.`, 'warning', 'Tasks'); return; }
    const it = tryMutate(rt, (s) => quickAdd(s, { title, kind, list, due, priority, ...(parent ? { parent } : {}) }));
    if (it) { setTitle(''); setDueText(''); setDueDate(''); setPriority(0); onDone?.(); }
  };
  return (
    <form className="axp-tasks-add fx-stack" onSubmit={(e) => { e.preventDefault(); add(); }}>
      <div className="axp-tasks-addline">
        <TextField label={parent ? 'New subtask' : 'Add'} value={title} onChange={setTitle} placeholder={parent ? 'Subtask…' : 'What needs doing?'} autoFocus={autoFocus} />
        <Button tone="primary" icon="plus" type="submit" disabled={!title.trim()}>Add</Button>
      </div>
      {!parent && (
        <div className="axp-tasks-filters">
          <Segmented label="Kind" size="sm" value={kind} onChange={setKind} options={[{ value: 'todo', label: 'Todo', icon: 'check' }, { value: 'task', label: 'Task', icon: 'list' }]} />
          <SelectField label="List" value={list} onChange={setList} options={listOptions(own)} />
          <TextField label="Due" value={dueText} onChange={setDueText} placeholder="friday, in 3 days…" hint={dueText.trim() ? (typed ? dueLabel(typed).text || typed : 'Not a date I know') : undefined} />
          <TextField label="or pick" type="date" value={dueDate} onChange={setDueDate} />
          <SelectField label="Priority" value={String(priority)} onChange={(v) => setPriority(Number(v) as Priority)} options={PRIORITY_OPTIONS} />
        </div>
      )}
    </form>
  );
}

/* ---------------------------------------------------------------- editor */

function Editor({ id, close }: { id: string; close: () => void }) {
  const rt = useRuntime();
  const { own } = useNotes();
  const item = own.items[id];
  const [draft, setDraft] = useState(() => item ? { title: item.title, text: item.text, tags: item.tags.join(', '), due: item.due.slice(0, 10) } : null);
  const [check, setCheck] = useState('');
  if (!item || !draft) return <Note tone="warning">That task is gone (removed on another device?).</Note>;
  const patch = (p: Partial<Item>) => tryMutate(rt, (s) => updateItem(s, id, p));
  const subs = subtasksOf(own, id);
  const saveText = () => {
    const due = draft.due ? parseDue(draft.due) : '';
    if (draft.due && !due) { rt.toast(`I don't know the date “${draft.due}”.`, 'warning', 'Tasks'); return; }
    patch({ title: draft.title.trim() || item.title, text: draft.text, tags: tagsFromText(draft.tags), due });
  };
  const changed = draft.title !== item.title || draft.text !== item.text || draft.tags !== item.tags.join(', ') || draft.due !== item.due.slice(0, 10);
  return (
    <div className="fx-stack axp-tasks-editor">
      <TextField label="Title" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
      <TextField label="Notes" rows={4} value={draft.text} onChange={(v) => setDraft({ ...draft, text: v })} />
      <div className="axp-tasks-filters">
        <TextField label="Due" value={draft.due} onChange={(v) => setDraft({ ...draft, due: v })} placeholder="YYYY-MM-DD, friday…" hint={draft.due ? dueLabel(parseDue(draft.due)).text || 'Not a date I know' : undefined} />
        <TextField label="Tags" value={draft.tags} onChange={(v) => setDraft({ ...draft, tags: v })} placeholder="home, urgent" />
      </div>
      {changed && <Button tone="primary" icon="save" onClick={saveText}>Save changes</Button>}
      <div className="axp-tasks-filters">
        <SelectField label="Kind" value={item.kind} onChange={(v) => patch({ kind: v as Item['kind'] })} options={[{ value: 'todo', label: 'Todo' }, { value: 'task', label: 'Task' }, { value: 'note', label: 'Note (leaves Tasks)' }]} />
        <SelectField label="Status" value={item.status} onChange={(v) => patch({ status: v as Status })} options={(['open', 'doing', 'done'] as Status[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
        <SelectField label="Priority" value={String(item.priority)} onChange={(v) => patch({ priority: Number(v) as Priority })} options={PRIORITY_OPTIONS} />
        <SelectField label="List" value={item.list} onChange={(v) => tryMutate(rt, (s) => moveItems(s, [id], v))} options={listOptions(own)} />
      </div>
      {item.parent && own.items[item.parent] && (
        <p className="fx-muted">Subtask of <button type="button" data-fx-row className="axp-tasks-link" onClick={() => rt.openDialog(EDIT, { id: item.parent })}>{own.items[item.parent]!.title}</button></p>
      )}
      <Container title={`Checklist (${checklistProgress(item).done}/${item.checklist.length})`} icon="check">
        <div className="fx-stack">
          {item.checklist.map((c, i) => (
            <div key={c.id} className="axp-tasks-check">
              <Checkbox label={c.text} checked={c.done} onChange={() => patch({ checklist: toggleCheck(item.checklist, c.id) })} />
              <span className="axp-tasks-chips">
                <IconButton icon="chevron-up" label="Up" disabled={i === 0} onClick={() => patch({ checklist: moveCheck(item.checklist, c.id, -1) })} />
                <IconButton icon="chevron-down" label="Down" disabled={i === item.checklist.length - 1} onClick={() => patch({ checklist: moveCheck(item.checklist, c.id, 1) })} />
                <IconButton icon="x" label="Remove" onClick={() => patch({ checklist: removeCheck(item.checklist, c.id) })} />
              </span>
            </div>
          ))}
          <form className="axp-tasks-addline" onSubmit={(e) => { e.preventDefault(); if (check.trim()) { patch({ checklist: addCheck(item.checklist, check) }); setCheck(''); } }}>
            <TextField label="Add a step" value={check} onChange={setCheck} placeholder="Step…" />
            <Button icon="plus" type="submit" disabled={!check.trim()}>Add</Button>
          </form>
        </div>
      </Container>
      <Container title={`Subtasks (${subtaskProgress(own, id).done}/${subs.length})`} icon="list">
        <div className="fx-stack">
          {subs.map((sub) => <TaskRow key={sub.id} s={own} item={sub} selecting={false} selected={false} onSelect={() => undefined} />)}
          <QuickAddForm parent={id} />
        </div>
      </Container>
      <div className="axp-tasks-addline">
        <Button tone="danger" icon="trash" confirm={`Delete “${item.title}”${subs.length ? ` and its ${subs.length} subtasks` : ''}?`}
          onClick={() => { tryMutate(rt, (s) => removeItems(s, [id])); close(); }}>Delete</Button>
        <span className="axp-tasks-grow" />
        <Button tone="primary" onClick={() => { if (changed) saveText(); close(); }}>Done</Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- grid + tree */

function columns(s: Store, now: Date): GridColumn<Item>[] {
  return [
    { id: 'done', label: '✓', width: 'calc(var(--fx-space) * 4)', fixed: true, render: (r) => <DoneBox item={r} /> },
    { id: 'title', label: 'Title', width: 'minmax(calc(var(--fx-space) * 16), 3fr)', fixed: true, sortable: true, sortValue: (r) => r.title.toLowerCase(), render: (r) => <span className="axp-tasks-titletext">{r.title} <Progress s={s} item={r} /></span> },
    { id: 'list', label: 'List', width: 'minmax(calc(var(--fx-space) * 10), 1.5fr)', sortable: true, sortValue: (r) => pathOf(s, r.list), render: (r) => <span className="fx-muted">{pathOf(s, r.list)}</span> },
    { id: 'status', label: 'Status', width: 'calc(var(--fx-space) * 9)', sortable: true, sortValue: (r) => ['open', 'doing', 'done'].indexOf(r.status), render: (r) => (r.kind === 'task' ? <StatusChip item={r} /> : <span className="fx-muted">todo</span>) },
    { id: 'priority', label: 'Priority', width: 'calc(var(--fx-space) * 8)', sortable: true, sortValue: (r) => r.priority, render: (r) => <PriorityChip item={r} /> },
    { id: 'due', label: 'Due', width: 'calc(var(--fx-space) * 12)', sortable: true, sortValue: (r) => r.due || '9999', render: (r) => <DueChip item={r} /> },
    { id: 'updated', label: 'Updated', width: 'calc(var(--fx-space) * 10)', sortable: true, sortValue: (r) => r.updatedAt, render: (r) => <span className="fx-muted">{dueLabel(r.updatedAt, now, true).text}</span> },
  ];
}

/** Lists in tree order holding the shown items; each task with its subtasks under it. */
function TreeMode({ s, items, selecting, selected, onSelect }: { s: Store; items: Item[]; selecting: boolean; selected: Set<string>; onSelect: (id: string) => void }) {
  const shown = new Set(items.map((i) => i.id));
  const byList = new Map<string, Item[]>();
  for (const i of items) if (!i.parent || !shown.has(i.parent)) byList.set(i.list, [...(byList.get(i.list) ?? []), i]);
  const lines: ReactNode[] = [];
  const walk = (it: Item, depth: number, seen: Set<string>) => {
    lines.push(<TaskRow key={it.id} s={s} item={it} depth={depth} selecting={selecting} selected={selected.has(it.id)} onSelect={onSelect} />);
    if (depth > 5) return;
    for (const sub of subtasksOf(s, it.id)) if (shown.has(sub.id) && !seen.has(sub.id)) { seen.add(sub.id); walk(sub, depth + 1, seen); }
  };
  const tree = flatTree(s);
  const out: ReactNode[] = [];
  for (const t of tree) {
    const here = byList.get(t.list.id);
    if (!here?.length) continue;
    lines.length = 0;
    const seen = new Set<string>();
    for (const it of here.sort(byDue)) walk(it, 0, seen);
    out.push(
      <Container key={t.list.id} title={t.path} icon="list" actions={<span className="fx-muted">{here.length}</span>}>
        <div className="axp-tasks-rows">{[...lines]}</div>
      </Container>,
    );
  }
  return <div className="fx-stack">{out}</div>;
}

/* ---------------------------------------------------------------- the page */

function TasksView() {
  const rt = useRuntime();
  const snap = useNotes();
  const u = useUi();
  const s = snap.own;
  const now = new Date();
  const savedTab = rt.settings.get(K.tab);
  const tab: TasksTab = u.tab ?? (isTab(savedTab) ? savedTab : 'today');
  const [mode, setModeState] = useState<Mode>(rt.settings.get(K.mode) === 'grid' ? 'grid' : 'tree');
  const setMode = (m: Mode) => { setModeState(m); rt.settings.set(K.mode, m); };
  const [f, setF] = useState<TaskFilter>({ priority: -1 });
  const [sort, setSort] = useState<GridSort>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkList, setBulkList] = useState('');
  const [bulkDue, setBulkDue] = useState('');
  useEffect(() => { void load(); }, []);

  const counts = useMemo(() => tabCounts(s, now), [s, now.toDateString()]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => filterTasks(s, tabItems(s, tab, now), f), [s, tab, f, now.toDateString()]); // eslint-disable-line react-hooks/exhaustive-deps
  const tags = allTags(s);
  const pick = (t: TasksTab) => { setUi({ tab: t }); rt.settings.set(K.tab, t); setSelected(new Set()); };
  const toggle = (id: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ids = [...selected].filter((id) => s.items[id]);
  const bulk = (fn: (st: Store) => number, what: string) => {
    const n = tryMutate(rt, fn);
    if (n !== undefined) { rt.toast(`${what}: ${n}.`, 'success', 'Tasks'); setSelected(new Set()); }
  };

  const sorted = useMemo(() => {
    if (!sort) return items;
    const c = columns(s, now).find((x) => x.id === sort.col);
    if (!c?.sortValue) return items;
    return [...items].sort((a, b) => { const x = c.sortValue!(a); const y = c.sortValue!(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [items, sort, s]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fx-stack fx-stack--lg axp-tasks">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Tasks</p>
          <h1>{TABS.find((t) => t.id === tab)!.label}</h1>
          <p className="fx-muted">{counts.today ? `${counts.today} due today or overdue` : 'Nothing due today'}{snap.queued ? `, ${snap.queued} change${snap.queued === 1 ? '' : 's'} waiting for axHub` : ''}.</p>
        </div>
        <Button icon="refresh" onClick={() => void load()}>Sync</Button>
      </header>
      {snap.status === 'signed-out' && <Note tone="warning">Sign in to axHub to see your tasks on every device.</Note>}
      {snap.status === 'offline' && snap.error && <Note tone="warning">axHub can't be reached ({snap.error}). Changes are kept here and sent when it's back.</Note>}

      <div className="fx-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`fx-tab${tab === t.id ? ' is-active' : ''}`} onClick={() => pick(t.id)}>
            {t.label}{counts[t.id] ? <span className="fx-muted"> {counts[t.id]}</span> : null}
          </button>
        ))}
      </div>

      <Container title="Add a task" icon="plus">
        <QuickAddForm defaultList={f.list} />
      </Container>

      <Container title="Filter and show" icon="sliders" collapsible
        actions={<Button size="sm" tone={selecting ? 'primary' : 'neutral'} icon="check" onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>{selecting ? 'Stop selecting' : 'Select'}</Button>}>
        <div className="fx-stack">
          <div className="axp-tasks-filters">
            <SelectField label="List" value={f.list ?? ''} empty="Every list" onChange={(v) => setF({ ...f, list: v || undefined })} options={listOptions(s)} />
            <SelectField label="Priority" value={String(f.priority ?? -1)} onChange={(v) => setF({ ...f, priority: Number(v) as Priority | -1 })} options={[{ value: '-1', label: 'Any' }, ...PRIORITY_OPTIONS]} />
            <SelectField label="Tag" value={f.tag ?? ''} empty="Any tag" onChange={(v) => setF({ ...f, tag: v || undefined })} options={tags.map((t) => ({ value: t, label: `#${t}` }))} />
            <TextField label="Search" type="search" value={f.q ?? ''} onChange={(v) => setF({ ...f, q: v })} placeholder="Find…" />
          </div>
          <Segmented label="Show as" size="sm" value={mode} onChange={setMode} options={[{ value: 'tree', label: 'Tree', icon: 'list' }, { value: 'grid', label: 'Grid', icon: 'grid' }]} />
        </div>
      </Container>

      {selecting && (
        <Container title={`${ids.length} selected`} icon="check"
          actions={<Button size="sm" tone="quiet" onClick={() => setSelected(new Set(items.map((i) => i.id)))}>Select all {items.length}</Button>}>
          <div className="axp-tasks-filters">
            <Button size="sm" icon="check-circle" disabled={!ids.length} onClick={() => bulk((st) => setDoneMany(st, ids, tab !== 'done'), tab === 'done' ? 'Reopened' : 'Done')}>{tab === 'done' ? 'Reopen' : 'Done'}</Button>
            <SelectField label="Move to" value={bulkList} empty="Pick a list" onChange={setBulkList} options={listOptions(s)} />
            <Button size="sm" icon="move" disabled={!ids.length || !bulkList} onClick={() => bulk((st) => moveItems(st, ids, bulkList), 'Moved')}>Move</Button>
            <TextField label="Set due" value={bulkDue} onChange={setBulkDue} placeholder="friday, 2026-11-02, empty = none" />
            <Button size="sm" icon="clock" disabled={!ids.length} onClick={() => bulk((st) => setDueMany(st, ids, bulkDue), bulkDue ? 'Due set' : 'Due cleared')}>Set due</Button>
            <Button size="sm" tone="danger" icon="trash" disabled={!ids.length} confirm={`Delete ${ids.length} (and their subtasks)?`} onClick={() => bulk((st) => removeItems(st, ids), 'Deleted')}>Delete</Button>
          </div>
        </Container>
      )}

      {!snap.loaded && snap.status === 'loading' ? <p className="fx-muted">Loading from axHub…</p>
        : items.length === 0 ? (
          <Empty icon="check-circle" text={tab === 'done' ? 'Nothing finished yet.' : tab === 'today' ? 'Nothing due today.' : 'Nothing here yet.'}
            action={<Button tone="primary" icon="plus" onClick={() => rt.openDialog(ADD)}>New task</Button>} />
        )
          : mode === 'tree' ? <TreeMode s={s} items={items} selecting={selecting} selected={selected} onSelect={toggle} />
            : (
              <Container title={TABS.find((t) => t.id === tab)!.label} icon="grid">
                <DataGrid<Item>
                  id="amberx-tasks"
                  label="Tasks"
                  groups={[{ id: tab, title: `${items.length} item${items.length === 1 ? '' : 's'}`, rows: sorted, groups: [], fixed: true }]}
                  columns={columns(s, now)}
                  rowId={(r) => r.id}
                  rowLabel={(r) => r.title}
                  hidden={[]}
                  sort={sort}
                  onSort={(col) => setSort((cur) => (!col ? null : cur?.col === col ? (cur.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }))}
                  rowTone={(r) => (r.status === 'done' ? 'muted' : dueLabel(r.due, now).overdue ? 'danger' : r.status === 'doing' ? 'accent' : '')}
                  multi={selecting ? ids : []}
                  onRowClick={(r: Item, _e: RMouseEvent) => (selecting ? toggle(r.id) : rt.openDialog(EDIT, { id: r.id }))}
                  empty={<Empty icon="check-circle" text="Nothing here yet." />}
                />
              </Container>
            )}
    </div>
  );
}

/* ---------------------------------------------------------------- library */

function openTab(rt: AxfRuntime, arg?: string) {
  if (isTab(arg)) { setUi({ tab: arg }); rt.settings.set(K.tab, arg); }
  rt.navigate('tasks');
  if (arg === 'today') rt.toast(todaySummary(snapshot().own), 'info', 'Today');
}

export const library: AxfWebLibrary = {
  id: ID,
  label: 'Tasks',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-10-27' },
  provides: ['amberx.tasks'],
  views: { tasks: { title: 'Tasks', icon: 'check-circle', keywords: ['tasks', 'todo', 'todos', 'due', 'today', 'upcoming', 'checklist'], render: () => <TasksView /> } },
  nav: { label: 'Work', items: [{ id: 'tasks', label: 'Tasks', icon: 'check-circle', view: 'tasks', badge: BADGE }] },
  dialogs: {
    [EDIT]: { title: 'Task', icon: 'edit', searchable: false, render: (p, close) => <Editor key={String(p.id ?? '')} id={String(p.id ?? '')} close={close} /> },
    [ADD]: { title: 'New task', icon: 'plus', render: (_p, close) => <QuickAddForm autoFocus onDone={close} /> },
  },
  settingsTabs: [{ id: 'tasks', label: 'Tasks', icon: 'check-circle', order: 30, parent: 'plugins' }],
  settings: [
    {
      id: 'amberx.tasks', label: 'Tasks', icon: 'check-circle', tab: 'tasks', settings: [
        { key: K.tab, label: 'Open on', kind: 'choice', default: 'today', options: TABS.map((t) => ({ value: t.id, label: t.label })) },
        { key: K.mode, label: 'Show as', kind: 'choice', default: 'tree', options: [{ value: 'tree', label: 'Tree' }, { value: 'grid', label: 'Grid' }] },
      ],
    },
  ],
  contextMenu: [{ id: 'amberx.tasks', items: [{ id: 'tasks.add', label: 'New task', icon: 'plus', action: 'tasks.add' }] }],
  appMenu: [{
    id: 'amberx.tasks', menu: 'axhub', items: [
      { id: 'tasks.open', label: 'Tasks', icon: 'check-circle', action: 'tasks.open', badge: BADGE },
      { id: 'tasks.add', label: 'New task', icon: 'plus', action: 'tasks.add' },
    ],
  }],
  register(rt) {
    rt.actions.register('tasks.open', ([tab]) => openTab(rt, tab), { label: 'Open tasks' });
    rt.actions.register('tasks.add', () => rt.openDialog(ADD), { label: 'New task' });
    const count = () => rt.setBadge(BADGE, todayCount(snapshot().own));
    subscribe(count);
    count();
    // the day turns over with nothing changing in the store
    window.setInterval(count, 60_000);
    void load();
    registerVoiceCommands(ID, [
      { id: 'tasks.today', phrases: ['whats due today', 'what is due today', 'whats due', 'show today', 'tasks for today', 'todays tasks'], action: 'tasks.open:today' },
      { id: 'tasks.upcoming', phrases: ['whats coming up', 'show upcoming', 'upcoming tasks', 'this week'], action: 'tasks.open:upcoming' },
      { id: 'tasks.todo', phrases: ['show todos', 'open todos', 'my todos', 'todo list'], action: 'tasks.open:todo' },
      { id: 'tasks.done', phrases: ['show done', 'finished tasks', 'done tasks'], action: 'tasks.open:done' },
      { id: 'tasks.all', phrases: ['open tasks', 'show tasks', 'all tasks', 'my tasks'], action: 'tasks.open:all' },
    ]);
  },
};

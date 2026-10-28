/**
 * Tasks core, pure: no DOM, no runtime, no network. Tasks and todos are items of the shared notes store
 * (`plugins/notes/web/core.ts`, amberx-notes@1); this file only picks, sorts, labels and changes them through the notes
 * core's own functions, so every device and plugin reads the same rows. Checked by `apps/amberx-droid/test.mjs`.
 */
import {
  addItem, descendants, dueBucket, localDay, normalizeDue, spokenDate, tagList, updateItem, MAX_CHECKLIST,
  type ChecklistItem, type Item, type ItemKind, type Priority, type Status, type Store,
} from '../../notes/web/core';

export type TasksTab = 'today' | 'upcoming' | 'todo' | 'all' | 'done';
export const TABS: { id: TasksTab; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: 'sun' },
  { id: 'upcoming', label: 'Upcoming', icon: 'clock' },
  { id: 'todo', label: 'Todo', icon: 'check' },
  { id: 'all', label: 'All', icon: 'list' },
  { id: 'done', label: 'Done', icon: 'check-circle' },
];
export const isTab = (v: unknown): v is TasksTab => TABS.some((t) => t.id === v);

export const isTaskish = (i: Item) => i.kind === 'task' || i.kind === 'todo';

export interface TaskFilter { list?: string; deep?: boolean; priority?: Priority | -1; tag?: string; q?: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Items for a tab (todos + tasks only). Subtasks show on their own only when their task isn't shown with them. */
export function tabItems(s: Store, tab: TasksTab, now = new Date()): Item[] {
  const all = Object.values(s.items).filter(isTaskish);
  let pick: Item[];
  switch (tab) {
    case 'today': pick = all.filter((i) => i.status !== 'done' && ['overdue', 'today'].includes(dueBucket(i.due, now))); break;
    case 'upcoming': pick = all.filter((i) => i.status !== 'done' && dueBucket(i.due, now) === 'upcoming'); break;
    case 'todo': pick = all.filter((i) => i.kind === 'todo' && i.status !== 'done'); break;
    case 'all': pick = all.filter((i) => i.status !== 'done'); break;
    case 'done': pick = all.filter((i) => i.status === 'done'); break;
  }
  const ids = new Set(pick.map((i) => i.id));
  // in All / Todo a subtask sits under its task; in date tabs every due item shows
  if (tab === 'all' || tab === 'todo') pick = pick.filter((i) => !i.parent || !ids.has(i.parent) || !s.items[i.parent]);
  return pick.sort(tab === 'done' ? byDone : byDue);
}

/** Due first (overdue on top), then priority (high first), then newest. */
export function byDue(a: Item, b: Item): number {
  const da = a.due ? a.due.slice(0, 10) : '9999';
  const db = b.due ? b.due.slice(0, 10) : '9999';
  return da.localeCompare(db) || b.priority - a.priority || b.createdAt.localeCompare(a.createdAt);
}
export const byDone = (a: Item, b: Item) => (b.doneAt || b.updatedAt).localeCompare(a.doneAt || a.updatedAt);

export function filterTasks(s: Store, items: Item[], f: TaskFilter): Item[] {
  const lists = f.list ? new Set([f.list, ...(f.deep === false ? [] : descendants(s, f.list))]) : null;
  const words = norm(f.q ?? '').split(' ').filter(Boolean);
  return items.filter((i) => {
    if (lists && !lists.has(i.list)) return false;
    if (f.priority !== undefined && f.priority !== -1 && i.priority !== f.priority) return false;
    if (f.tag && !i.tags.includes(f.tag)) return false;
    if (!words.length) return true;
    const hay = norm(`${i.title} ${i.text} ${i.tags.join(' ')} ${i.checklist.map((c) => c.text).join(' ')}`);
    return words.every((w) => hay.includes(w));
  });
}

/** The badge: overdue + due today, not done. */
export const todayCount = (s: Store, now = new Date()) => tabItems(s, 'today', now).length;

/** What "what's due today" answers. */
export function todaySummary(s: Store, now = new Date()): string {
  const n = todayCount(s, now);
  return n ? `${n} due today or overdue.` : 'Nothing due today.';
}

export const tabCounts = (s: Store, now = new Date()): Record<TasksTab, number> =>
  Object.fromEntries(TABS.map((t) => [t.id, tabItems(s, t.id, now).length])) as Record<TasksTab, number>;

export const nextStatus = (st: Status): Status => (st === 'open' ? 'doing' : st === 'doing' ? 'done' : 'open');
export const nextPriority = (p: Priority): Priority => ((p + 1) % 4) as Priority;
export const STATUS_LABEL: Record<Status, string> = { open: 'Open', doing: 'Doing', done: 'Done' };
export const PRIORITY_SHORT = ['–', 'Low', 'Med', 'High'] as const;
export type Tone = 'accent' | 'success' | 'warning' | 'danger' | undefined;
export const statusTone = (st: Status): Tone => (st === 'done' ? 'success' : st === 'doing' ? 'accent' : undefined);
export const priorityTone = (p: Priority): Tone => (p === 3 ? 'danger' : p === 2 ? 'warning' : p === 1 ? 'accent' : undefined);

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayDiff = (day: string, now: Date) => {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round((new Date(y!, m! - 1, d!).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 864e5);
};

/** "Overdue 2 d", "Today", "Tomorrow", "Fri", "Mon 9 Nov"; tone danger when overdue, warning today. */
export function dueLabel(due: string, now = new Date(), done = false): { text: string; tone: Tone; overdue: boolean } {
  if (!due) return { text: '', tone: undefined, overdue: false };
  const day = due.length > 10 ? localDay(new Date(due)) : due.slice(0, 10);
  const n = dayDiff(day, now);
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  const short = `${WD[date.getDay()]} ${date.getDate()} ${MO[date.getMonth()]}${date.getFullYear() !== now.getFullYear() ? ` ${date.getFullYear()}` : ''}`;
  if (done) return { text: short, tone: undefined, overdue: false };
  if (n < 0) return { text: n === -1 ? 'Yesterday' : `Overdue ${-n} d`, tone: 'danger', overdue: true };
  if (n === 0) return { text: 'Today', tone: 'warning', overdue: false };
  if (n === 1) return { text: 'Tomorrow', tone: 'accent', overdue: false };
  if (n < 7) return { text: WD[date.getDay()]!, tone: undefined, overdue: false };
  return { text: short, tone: undefined, overdue: false };
}

/** A due field: a date input's YYYY-MM-DD, any ISO date, or spoken-style text ("friday", "in 3 days"). '' = none or not understood. */
export function parseDue(input: string, now = new Date()): string {
  const t = input.trim();
  if (!t) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return normalizeDue(t.slice(0, 10)) || normalizeDue(t);
  return spokenDate(t, now);
}

export const subtasksOf = (s: Store, id: string): Item[] =>
  Object.values(s.items).filter((i) => i.parent === id).sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));

export function subtaskProgress(s: Store, id: string): { done: number; total: number } {
  const subs = subtasksOf(s, id);
  return { done: subs.filter((x) => x.status === 'done').length, total: subs.length };
}
export const checklistProgress = (i: Item) => ({ done: i.checklist.filter((c) => c.done).length, total: i.checklist.length });

/* ---------------------------------------------------------------- changes (on a store copy, inside mutate) */

export interface QuickAdd { title: string; kind: Extract<ItemKind, 'todo' | 'task'>; list?: string; due?: string; priority?: Priority; parent?: string; tags?: string[] }

export function quickAdd(s: Store, q: QuickAdd, now = new Date()): Item {
  const title = q.title.trim();
  if (!title) throw new Error('Type what to do first.');
  const parent = q.parent && s.items[q.parent] ? s.items[q.parent]! : null;
  return addItem(s, {
    kind: parent ? 'task' : q.kind,
    title,
    list: parent ? parent.list : q.list,
    due: q.due ? parseDue(q.due, now) : '',
    priority: q.priority ?? 0,
    parent: parent ? parent.id : '',
    tags: q.tags ?? [],
    source: 'typed',
  }, now.toISOString());
}

export const setDone = (s: Store, id: string, done: boolean, now = new Date()) =>
  updateItem(s, id, { status: done ? 'done' : 'open' }, now.toISOString());

export const cycleStatus = (s: Store, id: string, now = new Date()) => {
  const it = s.items[id];
  if (!it) throw new Error('That item is gone.');
  return updateItem(s, id, { status: it.kind === 'todo' ? (it.status === 'done' ? 'open' : 'done') : nextStatus(it.status) }, now.toISOString());
};

export const cyclePriority = (s: Store, id: string, now = new Date()) => {
  const it = s.items[id];
  if (!it) throw new Error('That item is gone.');
  return updateItem(s, id, { priority: nextPriority(it.priority) }, now.toISOString());
};

export function setDoneMany(s: Store, ids: string[], done: boolean, now = new Date()): number {
  let n = 0;
  for (const id of ids) if (s.items[id] && (s.items[id]!.status === 'done') !== done) { setDone(s, id, done, now); n++; }
  return n;
}

export function setDueMany(s: Store, ids: string[], due: string, now = new Date()): number {
  const d = due ? parseDue(due, now) : '';
  if (due && !d) throw new Error(`I don't know the date “${due}”.`);
  let n = 0;
  for (const id of ids) if (s.items[id]) { updateItem(s, id, { due: d }, now.toISOString()); n++; }
  return n;
}

/* checklist (pure array helpers; the editor saves the result with updateItem) */
let cseq = 0;
export function addCheck(list: ChecklistItem[], text: string): ChecklistItem[] {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!t || list.length >= MAX_CHECKLIST) return list;
  const used = new Set(list.map((c) => c.id));
  let id = `c${list.length + 1}`;
  while (used.has(id)) id = `c${list.length + 1}-${(cseq++).toString(36)}`;
  return [...list, { id, text: t, done: false }];
}
export const toggleCheck = (list: ChecklistItem[], id: string) => list.map((c) => (c.id === id ? { ...c, done: !c.done } : c));
export const removeCheck = (list: ChecklistItem[], id: string) => list.filter((c) => c.id !== id);
export function moveCheck(list: ChecklistItem[], id: string, by: -1 | 1): ChecklistItem[] {
  const i = list.findIndex((c) => c.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

export const tagsFromText = (v: string) => tagList(v);

/**
 * Todo manager — pure part (no React, no CSS): the data shapes the server answers with and the rules the views use to
 * group, sort and filter entries. Ported from xGallery's task workspace (src/pages/dev/tasks/views.tsx + store.ts).
 */

export type EntryKind = 'note' | 'todo' | 'task';
export type CoreRule = 'required' | 'optional' | 'hidden';
export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'url' | 'tags';
export type Tone = 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';
export const KINDS: EntryKind[] = ['note', 'todo', 'task'];
export const TONES: Tone[] = ['accent', 'info', 'success', 'warning', 'danger', 'neutral'];
export const CORE_PARTS = ['body', 'status', 'priority', 'due', 'tags', 'checklist', 'subtasks'] as const;
export type CorePart = (typeof CORE_PARTS)[number];
export const FIELD_TYPES: FieldType[] = ['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'url', 'tags'];

export interface FieldDef { key: string; label: string; type: FieldType; required: boolean; options: string[]; placeholder: string; showInGrid: boolean }
export interface TypeDef {
  label: string; icon: string; tone: Tone;
  core: Record<CorePart, CoreRule>;
  statuses: string[]; priorities: string[]; defaultStatus: string; defaultPriority: string;
  fields: FieldDef[];
}
export type TypeSchema = Record<EntryKind, TypeDef>;

export interface TodoList {
  id: number; parentId: number | null; title: string; tone: Tone | ''; icon: string; sortOrder: number;
  createdAt: number; updatedAt: number; counts: { entries: number; done: number };
}
export interface ChecklistItem { id: string; text: string; done: boolean }
export interface Entry {
  id: number; listId: number; parentId: number | null; kind: EntryKind; title: string; body: string;
  status: string; priority: string; dueAt: number | null; tags: string[]; checklist: ChecklistItem[];
  fields: Record<string, unknown>; sortOrder: number; createdAt: number; updatedAt: number; completedAt: number | null;
}

export type ViewMode = 'tree' | 'grid';
export type GroupBy = 'structure' | 'kind' | 'status' | 'priority' | 'tag' | 'due';
export type SortBy = 'manual' | 'title' | 'due' | 'priority' | 'updated';
export interface ListView { mode: ViewMode; groupBy: GroupBy; showDone: boolean; sort: SortBy; kind: '' | EntryKind; q: string }
export const DEFAULT_VIEW: ListView = { mode: 'tree', groupBy: 'structure', showDone: true, sort: 'manual', kind: '', q: '' };

/** A saved view setting, checked (anything unknown = the default). */
export function readView(raw: unknown): ListView {
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
  return {
    mode: pick(o.mode, ['tree', 'grid'] as const, DEFAULT_VIEW.mode),
    groupBy: pick(o.groupBy, ['structure', 'kind', 'status', 'priority', 'tag', 'due'] as const, DEFAULT_VIEW.groupBy),
    showDone: o.showDone !== false,
    sort: pick(o.sort, ['manual', 'title', 'due', 'priority', 'updated'] as const, DEFAULT_VIEW.sort),
    kind: pick(o.kind, ['', 'note', 'todo', 'task'] as const, ''),
    q: typeof o.q === 'string' ? o.q.slice(0, 120) : '',
  };
}

/** "in_progress" → "In progress". */
export function words(s: string): string {
  const t = s.replace(/_/g, ' ').trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : '';
}

/** The entries a view shows (kind filter, done hidden, text search over title, body and tags). */
export function visible(entries: readonly Entry[], v: ListView): Entry[] {
  const q = v.q.trim().toLowerCase();
  return entries.filter((e) => (!v.kind || e.kind === v.kind)
    && (v.showDone || e.status !== 'done' || e.kind === 'note')
    && (!q || e.title.toLowerCase().includes(q) || e.body.toLowerCase().includes(q) || e.tags.some((t) => t.includes(q))));
}

/** Rank of a priority in its type's list (later = more urgent); unknown = -1. */
function prio(e: Entry, types: TypeSchema): number { return types[e.kind]?.priorities.indexOf(e.priority) ?? -1; }

export function sortEntries(entries: readonly Entry[], sort: SortBy, types: TypeSchema): Entry[] {
  const out = [...entries];
  const by: Record<SortBy, (a: Entry, b: Entry) => number> = {
    manual: (a, b) => a.sortOrder - b.sortOrder || a.id - b.id,
    title: (a, b) => a.title.localeCompare(b.title),
    due: (a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.id - b.id,
    priority: (a, b) => prio(b, types) - prio(a, types) || a.id - b.id,
    updated: (a, b) => b.updatedAt - a.updatedAt,
  };
  return out.sort(by[sort]);
}

/** Due buckets: Overdue, Today, This week, Later, No date (relative to `now`). */
export function dueBucket(dueAt: number | null, now: number): string {
  if (dueAt == null) return 'No date';
  const day = 86_400_000;
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  if (dueAt < t0) return 'Overdue';
  if (dueAt < t0 + day) return 'Today';
  if (dueAt < t0 + 7 * day) return 'This week';
  return 'Later';
}
const DUE_ORDER = ['Overdue', 'Today', 'This week', 'Later', 'No date'];

export interface Group { key: string; label: string; entries: Entry[] }

/**
 * Entries grouped for the tree's flat groupings (kind, status, priority, tag, due). `structure` is drawn from the lists
 * themselves (groups + subtasks), not here. An entry with several tags shows under each.
 */
export function groupEntries(entries: readonly Entry[], by: Exclude<GroupBy, 'structure'>, types: TypeSchema, now = Date.now()): Group[] {
  const map = new Map<string, Group>();
  const add = (key: string, label: string, e: Entry) => {
    const g = map.get(key) ?? { key, label, entries: [] };
    g.entries.push(e);
    map.set(key, g);
  };
  for (const e of entries) {
    if (by === 'kind') add(e.kind, types[e.kind]?.label ?? e.kind, e);
    else if (by === 'status') add(e.status, words(e.status), e);
    else if (by === 'priority') add(e.priority, words(e.priority), e);
    else if (by === 'due') { const b = dueBucket(e.dueAt, now); add(b, b, e); }
    else if (e.tags.length) for (const t of e.tags) add(`#${t}`, `#${t}`, e);
    else add('', 'No tags', e);
  }
  const groups = [...map.values()];
  const rank = (g: Group): number => {
    if (by === 'kind') return KINDS.indexOf(g.key as EntryKind);
    if (by === 'due') return DUE_ORDER.indexOf(g.key);
    if (by === 'status') return Math.max(...KINDS.map((k) => types[k].statuses.indexOf(g.key)));
    if (by === 'priority') return -Math.max(...KINDS.map((k) => types[k].priorities.indexOf(g.key)));
    return g.key === '' ? Infinity : 0;
  };
  return groups.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

/** Children of a list (groups) or of an entry (subtasks), in manual order. */
export function childLists(lists: readonly TodoList[], parentId: number | null): TodoList[] {
  return lists.filter((l) => l.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

/** Every list as "Work › Backend" paths, depth-first (for the Move / List pickers). */
export function listPaths(lists: readonly TodoList[]): { id: number; path: string; depth: number }[] {
  const out: { id: number; path: string; depth: number }[] = [];
  const walk = (parent: number | null, prefix: string, depth: number) => {
    for (const l of childLists(lists, parent)) {
      const path = prefix ? `${prefix} › ${l.title}` : l.title;
      out.push({ id: l.id, path, depth });
      walk(l.id, path, depth + 1);
    }
  };
  walk(null, '', 0);
  return out;
}

/** Checklist progress "2/5", or '' with none. */
export function checklistText(e: Entry): string {
  const items = e.checklist.filter((c) => c.text.trim());
  return items.length ? `${items.filter((c) => c.done).length}/${items.length}` : '';
}

/** A due date as yyyy-mm-dd for a date input (local), and back. */
export function dateInput(ms: number | null): string {
  if (ms == null) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function fromDateInput(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null;
}

/** Done/total for a set of entries (notes don't count). */
export function progress(entries: readonly Entry[]): { done: number; total: number } {
  const work = entries.filter((e) => e.kind !== 'note');
  return { done: work.filter((e) => e.status === 'done').length, total: work.length };
}

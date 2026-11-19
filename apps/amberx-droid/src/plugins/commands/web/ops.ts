/**
 * Notes and tasks operations the voice commands run (`{do: 'op'}` steps), pure: they change a notes `Store` copy and say
 * what happened. The notes intents (core.ts `applyIntent`) cover add / move / rename / done / read / search; these cover
 * everything else a voice user needs: pin, star, tag, priority, due dates, checklists, subtasks, bulk changes, counts,
 * read-backs, list management, export. Tested by test.mjs.
 *
 * Item and list arguments are spoken names: `last` / `that` / `it` = the newest item (of the kind asked for), anything
 * else goes through the notes core's `findItem` / `findList`.
 */
import {
  addItem, addList, childrenOf, dueBucket, findItem, findList, flatTree, itemsIn, latest, localDay, mergeItems, moveItems,
  moveList, norm, pathOf, PRIORITY_LABEL, removeItems, removeList, renameList, search, spokenDate, spokenPriority, SYS, tagList,
  titleCase, toMarkdown, updateItem, type Item, type ItemKind, type NoteList, type Priority, type Store,
} from '../../notes/web/core';

export interface OpResult { ok: boolean; say: string; changed: boolean; open?: string; copy?: string }
export type OpArgs = Record<string, string>;
type Op = (s: Store, a: OpArgs, now: Date) => OpResult;

const iso = (d: Date) => d.toISOString();
const done = (say: string, extra: Partial<OpResult> = {}): OpResult => ({ ok: true, say, changed: true, ...extra });
const told = (say: string, extra: Partial<OpResult> = {}): OpResult => ({ ok: true, say, changed: false, ...extra });
const fail = (say: string): OpResult => ({ ok: false, say, changed: false });
const kindOf = (k?: string): ItemKind | undefined => (k === 'note' || k === 'todo' || k === 'task' ? k : k === 'tasks' || k === 'todos' ? 'task' : undefined);
const isLast = (x?: string) => !x || /^(last|latest|that|it|this|the last one|newest)$/.test(norm(x));

function item(s: Store, spoken: string | undefined, kind?: string): Item | null {
  const k = kindOf(kind);
  if (isLast(spoken)) return k === 'task' ? latestTask(s) : latest(s, k);
  return findItem(s, spoken!, k === 'task' ? {} : { kind: k });
}
const latestTask = (s: Store) => Object.values(s.items).filter((i) => i.kind !== 'note').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;

function list(s: Store, spoken: string | undefined): NoteList | null {
  if (!spoken || /^(inbox|my inbox)$/.test(norm(spoken))) return s.lists[SYS.inbox] ?? null;
  return findList(s, spoken);
}

const names = (items: Item[], max = 7) => items.slice(0, max).map((i) => i.title).join('; ') + (items.length > max ? `; and ${items.length - max} more` : '');
const plural = (n: number, w: string) => `${n === 0 ? 'No' : n === 1 ? 'One' : n} ${w}${n === 1 ? '' : 's'}`;
const open = (i: Item) => (i.kind === 'note' ? `notes.open:${i.list}` : 'tasks.open:all');

function dueOf(spoken: string, now: Date): string {
  const d = spokenDate(spoken, now);
  if (d) return d;
  const p = norm(spoken);
  if (/^(no|none|nothing|clear|remove|no date)$/.test(p)) return '';
  return '';
}

function priorityOf(spoken: string): Priority | null {
  const p = norm(spoken);
  const named = spokenPriority(p);
  if (named !== null) return named;
  if (/^(high|top|urgent|important|three|3)$/.test(p)) return 3;
  if (/^(medium|normal|mid|two|2)$/.test(p)) return 2;
  if (/^(low|one|1)$/.test(p)) return 1;
  if (/^(none|no|zero|0|clear)$/.test(p)) return 0;
  return null;
}

const openTasks = (s: Store) => Object.values(s.items).filter((i) => i.kind !== 'note' && i.status !== 'done');

export const OPS: Record<string, Op> = {
  /* ---------------- single items */
  pin: (s, a) => { const i = item(s, a.item, a.kind); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`); updateItem(s, i.id, { pinned: true }); return done(`Pinned ${i.title}.`); },
  unpin: (s, a) => { const i = item(s, a.item, a.kind); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`); updateItem(s, i.id, { pinned: false }); return done(`Unpinned ${i.title}.`); },
  star: (s, a) => { const i = item(s, a.item, a.kind); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`); updateItem(s, i.id, { starred: true }); return done(`Starred ${i.title}.`); },
  unstar: (s, a) => { const i = item(s, a.item, a.kind); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`); updateItem(s, i.id, { starred: false }); return done(`Unstarred ${i.title}.`); },
  tag: (s, a) => {
    const i = item(s, a.item, a.kind); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`);
    const t = tagList(a.tag ?? ''); if (!t.length) return fail('Which tag?');
    updateItem(s, i.id, { tags: tagList([...i.tags, ...t]) }); return done(`Tagged ${i.title} ${t.map((x) => `#${x}`).join(' ')}.`);
  },
  untag: (s, a) => {
    const i = item(s, a.item, a.kind); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`);
    const t = tagList(a.tag ?? ''); updateItem(s, i.id, { tags: t.length ? i.tags.filter((x) => !t.includes(x)) : [] });
    return done(t.length ? `Took ${t.map((x) => `#${x}`).join(' ')} off ${i.title}.` : `Cleared the tags on ${i.title}.`);
  },
  priority: (s, a) => {
    const i = item(s, a.item, a.kind ?? 'task'); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`);
    const p = priorityOf(a.priority ?? ''); if (p === null) return fail('High, medium, low or none?');
    updateItem(s, i.id, { priority: p, kind: i.kind === 'note' ? 'task' : i.kind }); return done(`${i.title}: ${PRIORITY_LABEL[p].toLowerCase()} priority.`);
  },
  due: (s, a, now) => {
    const i = item(s, a.item, a.kind ?? 'task'); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`);
    const d = dueOf(a.due ?? '', now);
    if (!d && !/^(no|none|nothing|clear|remove|no date)$/.test(norm(a.due ?? ''))) return fail(`I didn't get a date from “${a.due ?? ''}”.`);
    updateItem(s, i.id, { due: d, kind: i.kind === 'note' ? 'todo' : i.kind }); return done(d ? `${i.title} is due ${d}.` : `${i.title} has no due date now.`);
  },
  status: (s, a) => {
    const i = item(s, a.item, a.kind ?? 'task'); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`);
    const st = /doing|start|progress|working/.test(norm(a.status ?? '')) ? 'doing' : /done|finish|complete/.test(norm(a.status ?? '')) ? 'done' : 'open';
    updateItem(s, i.id, { status: st, kind: i.kind === 'note' ? 'task' : i.kind }); return done(`${i.title}: ${st === 'doing' ? 'in progress' : st}.`);
  },
  convert: (s, a) => {
    const i = item(s, a.item, a.from); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`);
    const k = kindOf(a.to) ?? 'task'; updateItem(s, i.id, { kind: k }); return done(`${i.title} is a ${k} now.`);
  },
  append: (s, a) => {
    const i = item(s, a.item, a.kind); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`);
    if (!a.text?.trim()) return fail('Add what?');
    updateItem(s, i.id, { text: [i.text, a.text.trim()].filter(Boolean).join('\n') }); return done(`Added to ${i.title}.`);
  },
  rename: (s, a) => {
    const i = item(s, a.item, a.kind); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`);
    if (!a.to?.trim()) return fail('Rename it to what?');
    updateItem(s, i.id, { title: a.to.trim() }); return done(`Renamed to ${a.to.trim()}.`);
  },
  duplicate: (s, a, now) => {
    const i = item(s, a.item, a.kind); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`);
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = i;
    const n = addItem(s, { ...rest, title: `${i.title} (copy)`, status: i.kind === 'note' ? 'open' : rest.status }, iso(now)); return done(`Made a copy: ${n.title}.`);
  },
  remove: (s, a) => { const i = item(s, a.item, a.kind); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`); removeItems(s, [i.id]); return done(`Removed ${i.title}.`); },
  check: (s, a, now) => {
    const i = item(s, a.item, a.kind ?? 'task'); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`);
    if (!a.text?.trim()) return fail('Add what to the checklist?');
    updateItem(s, i.id, { checklist: [...i.checklist, { id: `c${now.getTime().toString(36)}`, text: a.text.trim(), done: false }] }); return done(`Added “${a.text.trim()}” to ${i.title}'s checklist.`);
  },
  tick: (s, a) => {
    const i = item(s, a.item, a.kind ?? 'task'); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`);
    const w = norm(a.text ?? '');
    const c = i.checklist.find((x) => !x.done && (!w || norm(x.text).includes(w)));
    if (!c) return fail(w ? `No open checklist line like “${a.text}”.` : 'Its checklist is all done.');
    updateItem(s, i.id, { checklist: i.checklist.map((x) => (x.id === c.id ? { ...x, done: true } : x)) }); return done(`Ticked ${c.text}.`);
  },
  subtask: (s, a, now) => {
    const i = item(s, a.item, a.kind ?? 'task'); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`);
    if (!a.text?.trim()) return fail('What is the subtask?');
    addItem(s, { kind: 'task', title: a.text.trim(), list: i.list, parent: i.id, source: 'voice' }, iso(now)); return done(`Subtask added under ${i.title}.`);
  },
  read: (s, a) => {
    const i = item(s, a.item, a.kind); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`);
    const bits = [i.title, i.summary || i.text.slice(0, 400), i.due && `Due ${i.due.slice(0, 10)}.`, i.priority && `${PRIORITY_LABEL[i.priority]} priority.`, i.checklist.length && `${i.checklist.filter((c) => c.done).length} of ${i.checklist.length} ticked.`];
    return told(bits.filter(Boolean).join('. '), { open: open(i) });
  },
  copy: (s, a) => { const i = item(s, a.item, a.kind); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`); return told(`Copied ${i.title}.`, { copy: `${i.title}\n\n${i.text}`.trim() }); },
  move: (s, a) => {
    const i = item(s, a.item, a.kind); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`);
    const l = list(s, a.list); if (!l) return fail(`There's no list called ${a.list}.`);
    moveItems(s, [i.id], l.id); return done(`Moved ${i.title} to ${l.name}.`);
  },
  'merge-last': (s, a, now) => {
    const n = Math.max(2, Math.min(10, Number(a.count) || wordNumber(a.count) || 2));
    const k = kindOf(a.kind) ?? 'note';
    const ids = Object.values(s.items).filter((i) => i.kind === k).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, n).map((i) => i.id).reverse();
    if (ids.length < 2) return fail('There aren’t two to merge.');
    const m = mergeItems(s, ids, iso(now)); return done(`Merged ${ids.length} into ${m.title}.`);
  },

  /* ---------------- lists */
  'list-new': (s, a, now) => {
    if (!a.name?.trim()) return fail('What should the list be called?');
    const parent = a.parent ? list(s, a.parent) : null;
    if (a.parent && !parent) return fail(`There's no list called ${a.parent}.`);
    const l = addList(s, titleCase(a.name), parent?.id ?? null, iso(now)); return done(`Made ${pathOf(s, l.id)}.`, { open: `notes.open:${l.id}` });
  },
  'list-rename': (s, a, now) => { const l = list(s, a.list); if (!l) return fail(`There's no list called ${a.list}.`); if (!a.to?.trim()) return fail('Rename it to what?'); const old = l.name; renameList(s, l.id, titleCase(a.to), iso(now)); return done(`Renamed ${old} to ${l.name}.`); },
  'list-move': (s, a, now) => {
    const l = list(s, a.list); if (!l) return fail(`There's no list called ${a.list}.`);
    const top = /^(top|the top|top level|root)$/.test(norm(a.parent ?? ''));
    const p = top ? null : list(s, a.parent); if (!top && !p) return fail(`There's no list called ${a.parent}.`);
    try { moveList(s, l.id, p?.id ?? null, iso(now)); } catch (e) { return fail((e as Error).message); }
    return done(`Moved ${l.name} ${p ? `under ${p.name}` : 'to the top'}.`);
  },
  'list-delete': (s, a, now) => {
    const l = list(s, a.list); if (!l) return fail(`There's no list called ${a.list}.`);
    try { removeList(s, l.id, undefined, iso(now)); } catch (e) { return fail((e as Error).message); }
    return done(`Deleted ${l.name}; its notes moved up.`);
  },
  'list-read': (s, a) => {
    const l = list(s, a.list); if (!l) return fail(`There's no list called ${a.list}.`);
    const items = itemsIn(s, l.id).filter((i) => i.status !== 'done');
    const subs = childrenOf(s, l.id).map((c) => c.name);
    return told(`${l.name}: ${items.length ? names(items) : 'nothing in it'}${subs.length ? `. Lists inside: ${subs.join(', ')}` : ''}.`, { open: `notes.open:${l.id}` });
  },
  'list-count': (s, a) => { const l = list(s, a.list); if (!l) return fail(`There's no list called ${a.list}.`); const n = itemsIn(s, l.id, true).length; return told(`${plural(n, 'item')} in ${l.name}.`); },
  'list-export': (s, a) => {
    const l = a.list ? list(s, a.list) : null; if (a.list && !l) return fail(`There's no list called ${a.list}.`);
    return told(`Copied ${l ? l.name : 'everything'} as Markdown.`, { copy: toMarkdown(s, l?.id) });
  },
  'list-clear-done': (s, a) => {
    const l = list(s, a.list); if (!l) return fail(`There's no list called ${a.list}.`);
    const ids = itemsIn(s, l.id, true).filter((i) => i.status === 'done').map((i) => i.id);
    const n = removeItems(s, ids); return n ? done(`Cleared ${plural(n, 'finished item')} from ${l.name}.`) : told(`Nothing finished in ${l.name}.`);
  },
  'list-done-all': (s, a, now) => {
    const l = list(s, a.list); if (!l) return fail(`There's no list called ${a.list}.`);
    const open = itemsIn(s, l.id, true).filter((i) => i.kind !== 'note' && i.status !== 'done');
    for (const i of open) updateItem(s, i.id, { status: 'done' }, iso(now));
    return open.length ? done(`Marked ${plural(open.length, 'task')} done in ${l.name}.`) : told(`Nothing open in ${l.name}.`);
  },
  'lists-read': (s) => told(`Your lists: ${flatTree(s).filter((t) => t.depth === 0).map((t) => t.list.name).join(', ')}.`, { open: 'notes.open' }),
  'list-open': (s, a) => { const l = list(s, a.list); if (!l) return fail(`There's no list called ${a.list}.`); return told(`${l.name}.`, { open: `notes.open:${l.id}` }); },

  /* ---------------- reading back + counts */
  'read-latest': (s, a) => {
    const k = kindOf(a.kind); const n = Math.max(1, Math.min(10, Number(a.count) || wordNumber(a.count) || 3));
    const items = Object.values(s.items).filter((i) => !k || i.kind === k || (k === 'task' && i.kind === 'todo')).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, n);
    return items.length ? told(`Latest: ${names(items)}.`) : told('Nothing yet.');
  },
  'read-pinned': (s) => { const items = search(s, { pinned: true }); return told(items.length ? `Pinned: ${names(items)}.` : 'Nothing pinned.', { open: 'notes.open' }); },
  'read-starred': (s) => { const items = search(s, { starred: true }); return told(items.length ? `Starred: ${names(items)}.` : 'Nothing starred.'); },
  'read-tag': (s, a) => { const t = tagList(a.tag ?? '')[0]; if (!t) return fail('Which tag?'); const items = search(s, { tag: t }); return told(items.length ? `#${t}: ${names(items)}.` : `Nothing tagged #${t}.`, { open: `notes.search:${t}` }); },
  'read-tags': (s) => { const t = [...new Set(Object.values(s.items).flatMap((i) => i.tags))].sort(); return told(t.length ? `Tags: ${t.slice(0, 20).join(', ')}.` : 'No tags yet.'); },
  'read-due': (s, a, now) => {
    const when = norm(a.when ?? 'today');
    const pick = (i: Item) => {
      const b = dueBucket(i.due, now);
      if (/overdue|late|behind/.test(when)) return b === 'overdue';
      if (/week|upcoming|soon|next/.test(when)) return b === 'today' || b === 'upcoming' || b === 'overdue';
      if (/tomorrow/.test(when)) return i.due.slice(0, 10) === localDay(new Date(now.getTime() + 864e5));
      return b === 'today' || b === 'overdue';
    };
    const items = openTasks(s).filter((i) => i.due && pick(i)).sort((x, y) => x.due.localeCompare(y.due));
    return told(items.length ? `${plural(items.length, 'task')} ${/overdue|late/.test(when) ? 'overdue' : `due ${/week|upcoming|soon/.test(when) ? 'this week' : /tomorrow/.test(when) ? 'tomorrow' : 'today'}`}: ${names(items)}.` : `Nothing ${/overdue|late/.test(when) ? 'overdue' : 'due'}.`, { open: /week|upcoming/.test(when) ? 'tasks.open:upcoming' : 'tasks.open:today' });
  },
  'read-priority': (s, a) => {
    const p = priorityOf(a.priority ?? 'high') ?? 3;
    const items = openTasks(s).filter((i) => i.priority >= p).sort((x, y) => y.priority - x.priority);
    return told(items.length ? `${PRIORITY_LABEL[p]} and up: ${names(items)}.` : `No ${PRIORITY_LABEL[p].toLowerCase()} priority tasks open.`);
  },
  'read-doing': (s) => { const items = openTasks(s).filter((i) => i.status === 'doing'); return told(items.length ? `In progress: ${names(items)}.` : 'Nothing in progress.'); },
  count: (s, a, now) => {
    const w = norm(a.what ?? 'tasks');
    const all = Object.values(s.items);
    const n = /overdue/.test(w) ? openTasks(s).filter((i) => dueBucket(i.due, now) === 'overdue').length
      : /done|finished/.test(w) ? all.filter((i) => i.status === 'done').length
        : /note/.test(w) ? all.filter((i) => i.kind === 'note').length
          : /list/.test(w) ? Object.keys(s.lists).length
            : openTasks(s).length;
    return told(`${n} ${/overdue/.test(w) ? 'overdue' : /done|finished/.test(w) ? 'done' : /note/.test(w) ? 'notes' : /list/.test(w) ? 'lists' : 'open tasks'}.`);
  },
  'find-read': (s, a) => { const items = search(s, { q: a.text ?? '' }); return told(items.length ? `Found ${items.length}: ${names(items, 5)}.` : `Nothing about ${a.text}.`, { open: `notes.search:${a.text ?? ''}` }); },

  /* ---------------- bulk task moves */
  'overdue-to-today': (s, _a, now) => {
    const items = openTasks(s).filter((i) => dueBucket(i.due, now) === 'overdue');
    for (const i of items) updateItem(s, i.id, { due: localDay(now) }, iso(now));
    return items.length ? done(`Moved ${plural(items.length, 'overdue task')} to today.`) : told('Nothing overdue.');
  },
  'today-to-tomorrow': (s, _a, now) => {
    const tomorrow = localDay(new Date(now.getTime() + 864e5));
    const items = openTasks(s).filter((i) => dueBucket(i.due, now) === 'today' || dueBucket(i.due, now) === 'overdue');
    for (const i of items) updateItem(s, i.id, { due: tomorrow }, iso(now));
    return items.length ? done(`Pushed ${plural(items.length, 'task')} to tomorrow.`) : told('Nothing due today.');
  },
  'clear-done': (s) => { const ids = Object.values(s.items).filter((i) => i.kind !== 'note' && i.status === 'done').map((i) => i.id); const n = removeItems(s, ids); return n ? done(`Cleared ${plural(n, 'finished task')}.`) : told('Nothing finished to clear.'); },
  'inbox-to': (s, a) => {
    const l = list(s, a.list); if (!l) return fail(`There's no list called ${a.list}.`);
    const ids = itemsIn(s, SYS.inbox).map((i) => i.id); const n = moveItems(s, ids, l.id);
    return n ? done(`Moved ${plural(n, 'item')} from the inbox to ${l.name}.`) : told('The inbox is empty.');
  },
  'list-merge': (s, a) => {
    const from = list(s, a.from); if (!from) return fail(`There's no list called ${a.from}.`);
    const to = list(s, a.to); if (!to) return fail(`There's no list called ${a.to}.`);
    if (from.id === to.id) return fail('That is the same list.');
    const n = moveItems(s, itemsIn(s, from.id).map((i) => i.id), to.id);
    return n ? done(`Moved ${plural(n, 'item')} from ${from.name} to ${to.name}.`) : told(`${from.name} is empty.`);
  },
  'tasks-from-note': (s, a, now) => {
    const i = item(s, a.item, 'note'); if (!i) return fail(`I can't find ${a.item ?? 'it'}.`);
    const lines = i.text.split('\n').map((l) => l.replace(/^\s*[-*\d.)\]]+\s*(\[ ?\]\s*)?/, '').trim()).filter((l) => l.length > 2).slice(0, 30);
    for (const t of lines) addItem(s, { kind: 'task', title: t, list: i.list, source: 'voice' }, iso(now));
    return lines.length ? done(`Made ${plural(lines.length, 'task')} from ${i.title}.`, { open: 'tasks.open:all' }) : fail(`${i.title} has no lines to turn into tasks.`);
  },
};

function wordNumber(w?: string): number {
  const n = norm(w ?? '');
  return ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 } as Record<string, number>)[n] ?? 0;
}

/** Runs one op on the store (in place). Unknown ops and throwing ops are a failed result, never an exception. */
export function runOp(s: Store, op: string, args: OpArgs = {}, now = new Date()): OpResult {
  const fn = OPS[op];
  if (!fn) return fail(`I don't know how to ${op.replace(/-/g, ' ')}.`);
  try { return fn(s, args, now); } catch (e) { return fail((e as Error).message); }
}

export const OP_NAMES = Object.keys(OPS);


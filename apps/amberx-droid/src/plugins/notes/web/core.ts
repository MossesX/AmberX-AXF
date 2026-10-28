/**
 * AmberX notes core (amberx-notes@1), pure: no DOM, no runtime, no network. Every notes, tasks, voice and AI piece of
 * AmberX builds on these shapes and functions, and `apps/amberx-droid/test.mjs` checks them.
 *
 * - **Lists** form one tree. A list holds items and sub-lists; a list with sub-lists reads as a category. System lists:
 *   `inbox` (where unplaced notes land), `plugins` (root of one list per plugin, made automatically), `voice-notes`
 *   (the console Voice notes + Voice Vault notes, shared on axHub).
 * - **Items** are notes, todos (a quick tick) or tasks (status, priority, due, checklist, subtasks).
 * - **Intents** are what a voice sentence or the AI asks for, as data. The local parser (`parseIntent`) and the AI router
 *   produce the same shape; `validateIntent` checks both; `applyIntent` carries it out. Nothing else changes the store.
 */

export const FORMAT = 'amberx-notes@1';
export const HUB_PROJECT = 'amberx-axf';
export const DATA_FOLDER = 'amberx-notes';
export const LISTS_TABLE = 'lists';
export const ITEMS_TABLE = 'items';

export const MAX_LISTS = 500;
export const MAX_ITEMS = 5000;
export const MAX_DEPTH = 6;
export const MAX_NAME = 80;
export const MAX_TITLE = 160;
export const MAX_TEXT = 20_000;
export const MAX_TAGS = 20;
export const MAX_CHECKLIST = 100;

export const SYS = { inbox: 'inbox', plugins: 'plugins', voiceNotes: 'voice-notes' } as const;
export type SystemList = (typeof SYS)[keyof typeof SYS] | 'plugin';

export interface NoteList {
  id: string;
  name: string;
  parent: string | null;
  order: number;
  system?: SystemList;
  /** for `system: 'plugin'`: the plugin it belongs to */
  pluginId?: string;
  icon?: string;
  /** spoken shortcuts ("groceries" for "Shopping › Groceries") */
  aliases?: string[];
  createdAt: string;
  updatedAt: string;
}

export type ItemKind = 'note' | 'todo' | 'task';
export const KINDS: ItemKind[] = ['note', 'todo', 'task'];
export type Status = 'open' | 'doing' | 'done';
export const STATUSES: Status[] = ['open', 'doing', 'done'];
/** 0 none · 1 low · 2 medium · 3 high */
export type Priority = 0 | 1 | 2 | 3;
export const PRIORITY_LABEL = ['None', 'Low', 'Medium', 'High'] as const;
export type Source = 'voice' | 'typed' | 'ai' | 'web' | 'import';

export interface ChecklistItem { id: string; text: string; done: boolean }

export interface Item {
  id: string;
  kind: ItemKind;
  list: string;
  title: string;
  text: string;
  /** AI or hand summary */
  summary: string;
  /** what was heard, kept as said */
  transcript: string;
  tags: string[];
  pinned: boolean;
  starred: boolean;
  status: Status;
  priority: Priority;
  /** ISO date (YYYY-MM-DD) or date-time; '' = none */
  due: string;
  checklist: ChecklistItem[];
  /** id of the task this is a subtask of; '' = top level */
  parent: string;
  order: number;
  source: Source;
  /** page address for web clips */
  url: string;
  createdAt: string;
  updatedAt: string;
  doneAt: string;
  by: string;
  device: string;
}

export interface Store { lists: Record<string, NoteList>; items: Record<string, Item> }

/* ---------------------------------------------------------------- small helpers */

let seq = 0;
export const newId = (prefix: string, now = Date.now()) => `${prefix}-${now.toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const bool = (v: unknown) => v === true;
const iso = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : '');

/** Lower case, letters/digits/spaces only, single spaces (same as the voice plugin). */
export function norm(s: unknown): string {
  return typeof s === 'string'
    ? s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

export function tagList(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,#]+/) : [];
  const out: string[] = [];
  for (const t of raw) {
    const n = norm(t).replace(/ /g, '-').slice(0, 30);
    if (n && !out.includes(n) && out.length < MAX_TAGS) out.push(n);
  }
  return out;
}

/* ---------------------------------------------------------------- normalise (rows from the hub are untrusted) */

export function normalizeList(raw: unknown, id: string, now = new Date().toISOString()): NoteList | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name, MAX_NAME);
  if (!name || !id) return null;
  const sys = ['inbox', 'plugins', 'voice-notes', 'plugin'].includes(r.system as string) ? (r.system as SystemList) : undefined;
  return {
    id, name,
    parent: typeof r.parent === 'string' && r.parent && r.parent !== id ? r.parent : null,
    order: Number.isFinite(r.order) ? Number(r.order) : 0,
    ...(sys ? { system: sys } : {}),
    ...(typeof r.pluginId === 'string' && r.pluginId ? { pluginId: str(r.pluginId, 120) } : {}),
    ...(typeof r.icon === 'string' && r.icon ? { icon: str(r.icon, 40) } : {}),
    ...(Array.isArray(r.aliases) ? { aliases: r.aliases.map((a) => norm(a)).filter(Boolean).slice(0, 10) } : {}),
    createdAt: iso(r.createdAt) || now,
    updatedAt: iso(r.updatedAt) || now,
  };
}

export function normalizeItem(raw: unknown, id: string, now = new Date().toISOString()): Item | null {
  if (!raw || typeof raw !== 'object' || !id) return null;
  const r = raw as Record<string, unknown>;
  const kind = KINDS.includes(r.kind as ItemKind) ? (r.kind as ItemKind) : 'note';
  const body = text(r.text, MAX_TEXT);
  const title = str(r.title, MAX_TITLE) || titleFrom(body || text(r.transcript, MAX_TEXT));
  if (!title && !body) return null;
  const status = STATUSES.includes(r.status as Status) ? (r.status as Status) : 'open';
  const pr = Number(r.priority);
  return {
    id, kind,
    list: str(r.list, 120) || SYS.inbox,
    title: title || 'Untitled',
    text: body,
    summary: text(r.summary, 2000),
    transcript: text(r.transcript, MAX_TEXT),
    tags: tagList(r.tags),
    pinned: bool(r.pinned),
    starred: bool(r.starred),
    status,
    priority: (pr >= 0 && pr <= 3 ? Math.round(pr) : 0) as Priority,
    due: normalizeDue(r.due),
    checklist: Array.isArray(r.checklist)
      ? r.checklist.slice(0, MAX_CHECKLIST).map((c, i) => {
        const o = (c ?? {}) as Record<string, unknown>;
        return { id: str(o.id, 40) || `c${i + 1}`, text: str(o.text, 300), done: bool(o.done) };
      }).filter((c) => c.text)
      : [],
    parent: typeof r.parent === 'string' && r.parent !== id ? r.parent : '',
    order: Number.isFinite(r.order) ? Number(r.order) : 0,
    source: (['voice', 'typed', 'ai', 'web', 'import'] as Source[]).includes(r.source as Source) ? (r.source as Source) : 'typed',
    url: typeof r.url === 'string' && /^https?:\/\//.test(r.url) ? r.url.slice(0, 2000) : '',
    createdAt: iso(r.createdAt) || now,
    updatedAt: iso(r.updatedAt) || now,
    doneAt: status === 'done' ? iso(r.doneAt) || now : '',
    by: str(r.by, 80),
    device: str(r.device, 80),
  };
}

export function normalizeDue(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) return '';
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

/** A title from the first sentence (≤ 60 chars, on a word). */
export function titleFrom(body: string): string {
  const first = body.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? '';
  if (first.length <= 60) return first.replace(/[.!?]+$/, '');
  const cut = first.slice(0, 60);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 30))}…`;
}

/* ---------------------------------------------------------------- the tree */

export function emptyStore(now = new Date().toISOString()): Store {
  const s: Store = { lists: {}, items: {} };
  ensureSystemLists(s, now);
  return s;
}

/** Inbox, Plugins and Voice notes always exist (put back if a row went missing). */
export function ensureSystemLists(s: Store, now = new Date().toISOString()): boolean {
  let changed = false;
  const want: [string, string, string, number][] = [[SYS.inbox, 'Inbox', 'inbox', 0], [SYS.plugins, 'Plugins', 'puzzle', 90], [SYS.voiceNotes, 'Voice notes', 'mic', 95]];
  for (const [id, name, icon, order] of want) {
    if (!s.lists[id]) { s.lists[id] = { id, name, parent: null, order, system: id as SystemList, icon, createdAt: now, updatedAt: now }; changed = true; }
  }
  return changed;
}

export const childrenOf = (s: Store, parent: string | null): NoteList[] =>
  Object.values(s.lists).filter((l) => l.parent === parent).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

export function ancestors(s: Store, id: string): NoteList[] {
  const out: NoteList[] = [];
  let cur = s.lists[id];
  const seen = new Set<string>();
  while (cur && cur.parent && !seen.has(cur.parent)) { seen.add(cur.parent); cur = s.lists[cur.parent]; if (cur) out.unshift(cur); }
  return out;
}

export const depthOf = (s: Store, id: string) => ancestors(s, id).length;
export const pathOf = (s: Store, id: string) => [...ancestors(s, id), s.lists[id]].filter(Boolean).map((l) => l!.name).join(' › ');

/** Every list in tree order with its depth and path (for pickers). */
export function flatTree(s: Store): { list: NoteList; depth: number; path: string }[] {
  const out: { list: NoteList; depth: number; path: string }[] = [];
  const walk = (parent: string | null, depth: number, prefix: string) => {
    for (const l of childrenOf(s, parent)) {
      const path = prefix ? `${prefix} › ${l.name}` : l.name;
      out.push({ list: l, depth, path });
      if (depth < MAX_DEPTH) walk(l.id, depth + 1, path);
    }
  };
  walk(null, 0, '');
  return out;
}

export function descendants(s: Store, id: string): string[] {
  const out: string[] = [];
  const walk = (p: string) => { for (const c of childrenOf(s, p)) { out.push(c.id); walk(c.id); } };
  walk(id);
  return out;
}

export const itemsIn = (s: Store, list: string, deep = false): Item[] => {
  const ids = new Set([list, ...(deep ? descendants(s, list) : [])]);
  return Object.values(s.items).filter((i) => ids.has(i.list)).sort(byOrder);
};

export const byOrder = (a: Item, b: Item) => Number(b.pinned) - Number(a.pinned) || a.order - b.order || b.createdAt.localeCompare(a.createdAt);

/** Plugins root: one list per plugin, made when missing, renamed when the plugin's name changed. Never deletes (notes stay). */
export function syncPluginLists(s: Store, plugins: readonly { id: string; name: string }[], now = new Date().toISOString()): string[] {
  ensureSystemLists(s, now);
  const added: string[] = [];
  const have = new Map(Object.values(s.lists).filter((l) => l.system === 'plugin' && l.pluginId).map((l) => [l.pluginId!, l]));
  plugins.forEach((p, i) => {
    const name = str(p.name, MAX_NAME) || p.id;
    const l = have.get(p.id);
    if (!l) {
      const id = `plugin-${norm(p.id).replace(/ /g, '-').slice(0, 60) || newId('p')}`;
      s.lists[id] = { id, name, parent: SYS.plugins, order: i, system: 'plugin', pluginId: p.id, icon: 'puzzle', createdAt: now, updatedAt: now };
      added.push(id);
    } else if (l.name !== name) { l.name = name; l.updatedAt = now; }
  });
  return added;
}

/* ---------------------------------------------------------------- list operations */

export function canMoveList(s: Store, id: string, parent: string | null): string | null {
  const l = s.lists[id];
  if (!l) return 'That list is gone.';
  if (l.system && l.system !== 'plugin') return `${l.name} can't be moved.`;
  if (parent === id || (parent && descendants(s, id).includes(parent))) return "A list can't go inside itself.";
  if (parent && !s.lists[parent]) return 'That place is gone.';
  const height = Math.max(0, ...descendants(s, id).map((d) => depthOf(s, d) - depthOf(s, id)));
  if ((parent ? depthOf(s, parent) + 1 : 0) + height > MAX_DEPTH) return `Lists go ${MAX_DEPTH + 1} levels deep at most.`;
  return null;
}

export function addList(s: Store, name: string, parent: string | null = null, now = new Date().toISOString()): NoteList {
  const n = str(name, MAX_NAME);
  if (!n) throw new Error('A list needs a name.');
  if (Object.keys(s.lists).length >= MAX_LISTS) throw new Error(`${MAX_LISTS} lists at most.`);
  if (parent && !s.lists[parent]) throw new Error('That place is gone.');
  if (parent && depthOf(s, parent) + 1 > MAX_DEPTH) throw new Error(`Lists go ${MAX_DEPTH + 1} levels deep at most.`);
  const l: NoteList = { id: newId('l'), name: n, parent, order: childrenOf(s, parent).length, createdAt: now, updatedAt: now };
  s.lists[l.id] = l;
  return l;
}

export function renameList(s: Store, id: string, name: string, now = new Date().toISOString()) {
  const l = s.lists[id];
  const n = str(name, MAX_NAME);
  if (!l) throw new Error('That list is gone.');
  if (!n) throw new Error('A list needs a name.');
  l.name = n; l.updatedAt = now;
}

export function moveList(s: Store, id: string, parent: string | null, now = new Date().toISOString()) {
  const why = canMoveList(s, id, parent);
  if (why) throw new Error(why);
  const l = s.lists[id]!;
  l.parent = parent; l.order = childrenOf(s, parent).filter((x) => x.id !== id).length; l.updatedAt = now;
}

/** Reorder siblings: `ids` in the new order. */
export function reorderLists(s: Store, ids: string[], now = new Date().toISOString()) {
  ids.forEach((id, i) => { const l = s.lists[id]; if (l) { l.order = i; l.updatedAt = now; } });
}

/** Removes a list: its sub-lists move up to its parent, its items go to `itemsTo` (default the parent, or Inbox). */
export function removeList(s: Store, id: string, itemsTo?: string, now = new Date().toISOString()) {
  const l = s.lists[id];
  if (!l) return;
  if (l.system && l.system !== 'plugin') throw new Error(`${l.name} can't be removed.`);
  const to = itemsTo && s.lists[itemsTo] && itemsTo !== id ? itemsTo : l.parent ?? SYS.inbox;
  for (const c of childrenOf(s, id)) { c.parent = l.parent; c.updatedAt = now; }
  for (const i of Object.values(s.items)) if (i.list === id) { i.list = to; i.updatedAt = now; }
  delete s.lists[id];
}

/* ---------------------------------------------------------------- item operations */

export type NewItem = Partial<Omit<Item, 'id' | 'createdAt' | 'updatedAt'>> & { title?: string; text?: string };

export function addItem(s: Store, input: NewItem, now = new Date().toISOString()): Item {
  if (Object.keys(s.items).length >= MAX_ITEMS) throw new Error(`${MAX_ITEMS} items at most.`);
  const id = newId(input.kind === 'task' ? 't' : input.kind === 'todo' ? 'd' : 'n');
  const list = input.list && s.lists[input.list] ? input.list : SYS.inbox;
  const it = normalizeItem({ ...input, list, order: itemsIn(s, list).length, createdAt: now, updatedAt: now }, id, now);
  if (!it) throw new Error('A note needs some text.');
  s.items[id] = it;
  return it;
}

export function updateItem(s: Store, id: string, patch: Partial<Item>, now = new Date().toISOString()): Item {
  const cur = s.items[id];
  if (!cur) throw new Error('That item is gone.');
  const wasDone = cur.status === 'done';
  const next = normalizeItem({ ...cur, ...patch, id, updatedAt: now }, id, now)!;
  if (next.status === 'done' && !wasDone) next.doneAt = now;
  if (next.status !== 'done') next.doneAt = '';
  if (patch.list && !s.lists[patch.list]) next.list = cur.list;
  s.items[id] = next;
  return next;
}

export function moveItems(s: Store, ids: string[], list: string, now = new Date().toISOString()): number {
  if (!s.lists[list]) throw new Error('That list is gone.');
  let n = itemsIn(s, list).length;
  let moved = 0;
  for (const id of ids) {
    const it = s.items[id];
    if (!it || it.list === list) continue;
    it.list = list; it.order = n++; it.updatedAt = now; moved++;
    // subtasks travel with their task
    for (const sub of Object.values(s.items)) if (sub.parent === id) { sub.list = list; sub.updatedAt = now; }
  }
  return moved;
}

export function removeItems(s: Store, ids: string[]): number {
  let n = 0;
  for (const id of ids) {
    if (!s.items[id]) continue;
    delete s.items[id]; n++;
    for (const sub of Object.values(s.items)) if (sub.parent === id) { delete s.items[sub.id]; n++; }
  }
  return n;
}

/** Merges notes into the first: texts joined (with their titles), tags and checklists united, the rest removed. */
export function mergeItems(s: Store, ids: string[], now = new Date().toISOString()): Item {
  const items = ids.map((id) => s.items[id]).filter((i): i is Item => !!i);
  if (items.length < 2) throw new Error('Pick two or more to merge.');
  const [first, ...rest] = items;
  const body = [first!.text || first!.title, ...rest.map((r) => `${r.title}\n${r.text}`.trim())].join('\n\n');
  const merged = updateItem(s, first!.id, {
    text: body.slice(0, MAX_TEXT),
    tags: tagList([...first!.tags, ...rest.flatMap((r) => r.tags)]),
    checklist: [...first!.checklist, ...rest.flatMap((r) => r.checklist)].slice(0, MAX_CHECKLIST),
    transcript: [first!.transcript, ...rest.map((r) => r.transcript)].filter(Boolean).join('\n'),
    pinned: items.some((i) => i.pinned), starred: items.some((i) => i.starred),
  }, now);
  for (const r of rest) for (const sub of Object.values(s.items)) if (sub.parent === r.id) sub.parent = first!.id;
  for (const r of rest) delete s.items[r.id];
  return merged;
}

/** Turns a note's "- [ ]" lines into a checklist (or todos when `asTodos`). */
export function extractCheckboxes(body: string): { rest: string; boxes: { text: string; done: boolean }[] } {
  const boxes: { text: string; done: boolean }[] = [];
  const rest = body.split('\n').filter((line) => {
    const m = /^\s*[-*]\s*\[( |x|X)\]\s+(.+)$/.exec(line);
    if (!m) return true;
    boxes.push({ text: m[2]!.trim().slice(0, 300), done: m[1] !== ' ' });
    return false;
  }).join('\n').trim();
  return { rest, boxes };
}

/* ---------------------------------------------------------------- finding things */

export interface Filter { q?: string; list?: string; deep?: boolean; kind?: ItemKind | ''; status?: Status | '' | 'not-done'; tag?: string; pinned?: boolean; starred?: boolean }

export function search(s: Store, f: Filter): Item[] {
  const words = norm(f.q ?? '').split(' ').filter(Boolean);
  const lists = f.list ? new Set([f.list, ...(f.deep ? descendants(s, f.list) : [])]) : null;
  return Object.values(s.items).filter((i) => {
    if (lists && !lists.has(i.list)) return false;
    if (f.kind && i.kind !== f.kind) return false;
    if (f.status === 'not-done' ? i.status === 'done' : f.status && i.status !== f.status) return false;
    if (f.tag && !i.tags.includes(f.tag)) return false;
    if (f.pinned && !i.pinned) return false;
    if (f.starred && !i.starred) return false;
    if (!words.length) return true;
    const hay = norm(`${i.title} ${i.text} ${i.summary} ${i.tags.join(' ')} ${s.lists[i.list]?.name ?? ''}`);
    return words.every((w) => hay.includes(w));
  }).sort(byOrder);
}

export const allTags = (s: Store) => [...new Set(Object.values(s.items).flatMap((i) => i.tags))].sort();

/** The list a spoken name means: exact name, alias, path end ("work bugs" → Work › Bugs), then the closest start. */
export function findList(s: Store, spoken: string): NoteList | null {
  const q = norm(spoken).replace(/^(the|my) /, '').replace(/ (list|folder|category)$/, '');
  if (!q) return null;
  const tree = flatTree(s);
  const exact = tree.find((t) => norm(t.list.name) === q || (t.list.aliases ?? []).includes(q));
  if (exact) return exact.list;
  const byPath = tree.find((t) => norm(t.path.replace(/›/g, ' ')) === q || norm(t.path.replace(/›/g, ' ')).endsWith(` ${q}`));
  if (byPath) return byPath.list;
  const starts = tree.filter((t) => norm(t.list.name).startsWith(q) || q.startsWith(norm(t.list.name)));
  return starts.sort((a, b) => b.list.name.length - a.list.name.length)[0]?.list ?? null;
}

/** An item a spoken title means (best word overlap, not done first). */
export function findItem(s: Store, spoken: string, opts: { kind?: ItemKind; list?: string } = {}): Item | null {
  const words = norm(spoken).split(' ').filter((w) => w.length > 1 && !STOP.has(w));
  if (!words.length) return null;
  let best: { it: Item; score: number } | null = null;
  for (const it of Object.values(s.items)) {
    if (opts.kind && it.kind !== opts.kind) continue;
    if (opts.list && it.list !== opts.list) continue;
    const hay = new Set(norm(`${it.title} ${it.text.slice(0, 300)}`).split(' '));
    const score = words.filter((w) => hay.has(w)).length / words.length - (it.status === 'done' ? 0.25 : 0);
    if (score > 0.49 && (!best || score > best.score || (score === best.score && it.updatedAt > best.it.updatedAt))) best = { it, score };
  }
  return best?.it ?? null;
}
const STOP = new Set(['the', 'a', 'an', 'to', 'my', 'of', 'and', 'for', 'in', 'on', 'it', 'is']);

export const latest = (s: Store, kind?: ItemKind) =>
  Object.values(s.items).filter((i) => !kind || i.kind === kind).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;

/* ---------------------------------------------------------------- tasks */

export function dueBucket(due: string, now = new Date()): 'overdue' | 'today' | 'upcoming' | 'later' | 'none' {
  if (!due) return 'none';
  const day = due.slice(0, 10);
  const today = localDay(now);
  if (day < today) return 'overdue';
  if (day === today) return 'today';
  const week = localDay(new Date(now.getTime() + 7 * 864e5));
  return day <= week ? 'upcoming' : 'later';
}
export const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Spoken dates: today, tomorrow, monday…sunday (next one), next week, in N days, end of day/week, ISO. */
export function spokenDate(phrase: string, now = new Date()): string {
  const p = norm(phrase);
  if (!p) return '';
  if (/\d{4} \d{2} \d{2}/.test(p)) return p.replace(/ /g, '-').slice(0, 10);
  const add = (n: number) => localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
  if (/\b(today|tonight|end of (the )?day)\b/.test(p)) return add(0);
  if (/\btomorrow\b/.test(p)) return add(1);
  const inN = /\bin (\d+|one|two|three|four|five|six|seven|ten) days?\b/.exec(p);
  if (inN) return add(NUM[inN[1]!] ?? Number(inN[1]));
  if (/\bnext week\b/.test(p)) return add(7);
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const d = days.findIndex((x) => new RegExp(`\\b${x}\\b`).test(p));
  if (d >= 0) { const diff = (d - now.getDay() + 7) % 7 || 7; return add(/\bend of (the )?week\b/.test(p) ? diff : diff); }
  if (/\bend of (the )?week\b/.test(p)) return add((5 - now.getDay() + 7) % 7);
  return '';
}
const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 };

export function spokenPriority(phrase: string): Priority | null {
  const p = norm(phrase);
  if (/\b(urgent|high priority|important|asap|critical)\b/.test(p)) return 3;
  if (/\bmedium priority\b/.test(p)) return 2;
  if (/\blow priority\b/.test(p)) return 1;
  return null;
}

/* ---------------------------------------------------------------- intents (voice + AI share this) */

export type IntentAction =
  | 'add' | 'move' | 'rename-list' | 'rename-item' | 'create-list' | 'done' | 'undone' | 'remove' | 'read' | 'search' | 'open';
export const INTENT_ACTIONS: IntentAction[] = ['add', 'move', 'rename-list', 'rename-item', 'create-list', 'done', 'undone', 'remove', 'read', 'search', 'open'];

export interface Intent {
  action: IntentAction;
  kind?: ItemKind;
  title?: string;
  text?: string;
  summary?: string;
  /** spoken name of a list (resolved by findList) */
  list?: string;
  /** spoken sub-list under `list` ("Work" › "Bugs"), made when `create` */
  sublist?: string;
  /** for rename/move: what it is now */
  target?: string;
  /** for rename: the new name */
  to?: string;
  tasks?: { content: string; due?: string; priority?: Priority }[];
  tags?: string[];
  due?: string;
  priority?: Priority;
  /** make missing lists instead of falling back to Inbox */
  create?: boolean;
}

/** Checks an intent from anywhere (AI output is untrusted). Returns the cleaned intent or the reasons it's refused. */
export function validateIntent(raw: unknown): { ok: true; intent: Intent } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['not an object'] };
  const r = raw as Record<string, unknown>;
  const action = r.action as IntentAction;
  if (!INTENT_ACTIONS.includes(action)) errors.push(`unknown action ${JSON.stringify(r.action)}`);
  const kind = r.kind === undefined ? undefined : KINDS.includes(r.kind as ItemKind) ? (r.kind as ItemKind) : (errors.push('bad kind'), undefined);
  const pr = r.priority === undefined || r.priority === null ? undefined : [0, 1, 2, 3].includes(Number(r.priority)) ? (Number(r.priority) as Priority) : (errors.push('bad priority'), undefined);
  const tasks = Array.isArray(r.tasks)
    ? r.tasks.slice(0, 50).map((t) => {
      const o = (t ?? {}) as Record<string, unknown>;
      const p = Number(o.priority);
      return { content: str(o.content, 300), ...(o.due ? { due: normalizeDue(o.due) || spokenDate(String(o.due)) } : {}), ...([1, 2, 3].includes(p) ? { priority: p as Priority } : {}) };
    }).filter((t) => t.content)
    : r.tasks === undefined ? undefined : (errors.push('tasks must be a list'), undefined);
  const intent: Intent = {
    action,
    ...(kind ? { kind } : {}),
    ...(r.title ? { title: str(r.title, MAX_TITLE) } : {}),
    ...(r.text ? { text: text(r.text, MAX_TEXT) } : {}),
    ...(r.summary ? { summary: text(r.summary, 2000) } : {}),
    ...(r.list ? { list: str(r.list, MAX_NAME) } : {}),
    ...(r.sublist ? { sublist: str(r.sublist, MAX_NAME) } : {}),
    ...(r.target ? { target: str(r.target, MAX_TITLE) } : {}),
    ...(r.to ? { to: str(r.to, MAX_NAME) } : {}),
    ...(tasks?.length ? { tasks } : {}),
    ...(r.tags ? { tags: tagList(r.tags) } : {}),
    ...(r.due ? { due: normalizeDue(r.due) || spokenDate(String(r.due)) } : {}),
    ...(pr !== undefined ? { priority: pr } : {}),
    ...(r.create === true ? { create: true } : {}),
  };
  if (action === 'add' && !intent.text && !intent.title && !intent.tasks?.length) errors.push('add needs text, a title or tasks');
  if ((action === 'rename-list' || action === 'rename-item') && (!intent.target || !intent.to)) errors.push('rename needs target and to');
  if (action === 'create-list' && !intent.list) errors.push('create-list needs list');
  if (action === 'move' && !intent.list) errors.push('move needs list');
  return errors.length ? { ok: false, errors } : { ok: true, intent };
}

/** The JSON shape the AI is asked for (also shown in Settings so a person can read it). */
export const INTENT_SCHEMA = {
  type: 'object', required: ['action'],
  properties: {
    action: { enum: INTENT_ACTIONS },
    kind: { enum: KINDS }, title: { type: 'string' }, text: { type: 'string' }, summary: { type: 'string' },
    list: { type: 'string' }, sublist: { type: 'string' }, target: { type: 'string' }, to: { type: 'string' },
    tasks: { type: 'array', items: { type: 'object', required: ['content'], properties: { content: { type: 'string' }, due: { type: 'string' }, priority: { enum: [1, 2, 3] } } } },
    tags: { type: 'array', items: { type: 'string' } }, due: { type: 'string' }, priority: { enum: [0, 1, 2, 3] }, create: { type: 'boolean' },
  },
} as const;

/**
 * The local parser: understands the common sentences with no AI. Returns null when it isn't sure (the AI, when
 * connected, gets those). Order matters: the most specific patterns first.
 */
export function parseIntent(heard: string, now = new Date()): Intent | null {
  const raw = heard.trim();
  const p = norm(raw);
  if (!p) return null;
  let m: RegExpExecArray | null;
  const rest = (re: RegExp) => { const x = new RegExp(re.source, 'i').exec(raw); return x ? x : null; };

  if ((m = /^rename (?:the )?list (.+?) to (.+)$/.exec(p))) return { action: 'rename-list', target: m[1]!, to: m[2]! };
  if ((m = /^rename (?:the )?(?:note|task|todo) (.+?) to (.+)$/.exec(p))) return { action: 'rename-item', target: m[1]!, to: m[2]! };
  if ((m = /^(?:create|make|new|add) (?:a )?(?:new )?(?:list|folder|category) (?:called |named )?(.+?)(?: (?:under|in|inside) (.+))?$/.exec(p))) {
    return { action: 'create-list', list: m[2] ? m[2] : m[1]!, ...(m[2] ? { sublist: m[1]! } : {}), create: true };
  }
  if ((m = /^move (?:the )?(last|latest|that) (note|task|todo)? ?(?:to|into) (?:the )?(.+)$/.exec(p))) {
    return { action: 'move', target: m[1]!, ...(m[2] ? { kind: m[2] as ItemKind } : {}), list: m[3]! };
  }
  if ((m = /^move (?:the )?(?:note|task|todo )?(.+?) (?:to|into) (?:the )?(.+)$/.exec(p))) return { action: 'move', target: m[1]!, list: m[2]! };
  if ((m = /^(?:mark|tick|check off|complete|finish)(?: off)? (?:the )?(?:task |todo )?(.+?)(?: as)?(?: done| complete| finished)?$/.exec(p)) && !/^(it|that)$/.test(m[1]!)) return { action: 'done', target: m[1]! };
  if ((m = /^(?:mark|tick|check off|complete) (?:it|that)(?: as)?(?: done)?$/.exec(p))) return { action: 'done', target: 'last' };
  if ((m = /^(?:reopen|undo|uncheck|mark) (?:the )?(?:task |todo )?(.+?)(?: as)? (?:not done|open)$/.exec(p))) return { action: 'undone', target: m[1]! };
  if ((m = /^(?:delete|remove) (?:the )?(last|latest) (note|task|todo)$/.exec(p))) return { action: 'remove', target: 'last', kind: m[2] as ItemKind };
  if (/^(?:read|what are|whats on|list|tell me) (?:me )?(?:my )?(?:tasks|todos|to dos|to do list)(?: for today| today)?$/.test(p)) return { action: 'read', kind: 'task', ...(/today/.test(p) ? { due: localDay(now) } : {}) };
  if ((m = /^(?:read|what is in|whats in|show) (?:me )?(?:my |the )?(.+?) (?:list|notes)$/.exec(p))) return { action: 'read', list: m[1]! };
  if ((m = /^(?:find|search|search for|look for) (?:notes? )?(?:about |for )?(.+)$/.exec(p))) return { action: 'search', text: m[1]! };
  if ((m = /^(?:open|show|go to) (?:the |my )?(.+?) (?:list|folder)$/.exec(p))) return { action: 'open', list: m[1]! };

  // add todo/task … [to|in|on <list>] [by|due <date>]
  if ((m = /^(?:add|new|create)(?: a)? (todo|to do|task|reminder)(?: to| for)? (.+)$/.exec(p)) || (m = /^(?:remind me to|i need to|todo) (.+)$/.exec(p))) {
    const kind: ItemKind = m.length > 2 && m[1] === 'task' ? 'task' : 'todo';
    const tail = rest(m.length > 2 ? /^(?:add|new|create)(?: a)? (?:todo|to do|task|reminder)(?: to| for)? (.+)$/ : /^(?:remind me to|i need to|todo) (.+)$/)?.[1] ?? m[m.length - 1]!;
    return withPlace({ action: 'add', kind }, tail, now);
  }
  // note … / new note in <list>: …
  if ((m = /^(?:new |add a |add |take a |make a )?note(?: in| to| for| on)? (.+)$/.exec(p))) {
    const tail = rest(/^(?:new |add a |add |take a |make a )?note(?: in| to| for| on)? (.+)$/)?.[1] ?? m[1]!;
    // "note in work: fix login" → list work, text fix login
    const colon = /^([^:]{1,60}):\s*(.+)$/s.exec(tail);
    if (colon) return { action: 'add', kind: 'note', list: norm(colon[1]!), text: colon[2]!.trim() };
    return withPlace({ action: 'add', kind: 'note' }, tail, now);
  }
  return null;
}

/** Pulls "to/in/on <list>", "by/due <date>" and a priority off the end of a sentence. */
function withPlace(base: Intent, tail: string, now: Date): Intent {
  let t = tail.trim();
  const out: Intent = { ...base };
  const pr = spokenPriority(t);
  if (pr !== null) { out.priority = pr; t = t.replace(/[, ]*\b(urgent|high priority|medium priority|low priority|important|asap|critical)\b/i, '').trim(); }
  const due = /[, ]+(?:by|due|on|for|before)? ?((?:next week|tomorrow|today|tonight|end of (?:the )?(?:day|week)|in \w+ days?|(?:next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)))\s*$/i.exec(t);
  if (due) { const d = spokenDate(due[1]!, now); if (d) { out.due = d; t = t.slice(0, due.index).trim(); } }
  const place = /\s+(?:to|in|on|into|under) (?:the |my )?([\w ]{1,40}?) (?:list|folder|category)\s*$/i.exec(t) ?? /\s+(?:to|in|into) (?:the |my )?([\w-]{2,30})\s*$/i.exec(t);
  if (place) { out.list = norm(place[1]!); t = t.slice(0, place.index).trim(); }
  out.text = t.replace(/^[,:;\s]+|[,;\s]+$/g, '');
  if (out.kind !== 'note') out.title = titleFrom(out.text);
  return out;
}

export interface ApplyResult { ok: boolean; say: string; changed: boolean; items?: Item[]; list?: NoteList; open?: { list?: string; q?: string; item?: string } }

/** Carries an intent out on the store. `say` is what AmberX answers. Never throws. */
export function applyIntent(s: Store, intent: Intent, ctx: { by?: string; device?: string; source?: Source; transcript?: string; now?: string } = {}): ApplyResult {
  const now = ctx.now ?? new Date().toISOString();
  try {
    const resolve = (create: boolean): NoteList | null => {
      if (!intent.list) return null;
      let parent = findList(s, intent.list);
      if (!parent && create) parent = addList(s, titleCase(intent.list), null, now);
      if (!parent) return null;
      if (!intent.sublist) return parent;
      const sub = childrenOf(s, parent.id).find((c) => norm(c.name) === norm(intent.sublist!)) ?? null;
      return sub ?? (create ? addList(s, titleCase(intent.sublist), parent.id, now) : parent);
    };
    const pick = (): Item | null => intent.target && /^(last|latest|that|it)$/.test(norm(intent.target)) ? latest(s, intent.kind) : findItem(s, intent.target ?? '', { kind: intent.kind });

    switch (intent.action) {
      case 'add': {
        const list = resolve(intent.create === true) ?? s.lists[SYS.inbox]!;
        const missed = intent.list && !findList(s, intent.list) && list.id === SYS.inbox;
        const made: Item[] = [];
        const base = { by: ctx.by ?? '', device: ctx.device ?? '', source: ctx.source ?? 'voice', transcript: ctx.transcript ?? '' } as const;
        if (intent.text || intent.title) {
          const body = intent.text ?? '';
          const { rest, boxes } = extractCheckboxes(body);
          made.push(addItem(s, {
            ...base, kind: intent.kind ?? 'note', list: list.id, title: intent.title ?? titleFrom(rest || body), text: intent.kind === 'note' || !intent.kind ? rest : '',
            summary: intent.summary ?? '', tags: intent.tags ?? [], due: intent.due ?? '', priority: intent.priority ?? 0,
            checklist: boxes.map((b, i) => ({ id: `c${i + 1}`, ...b })),
          }, now));
        }
        for (const t of intent.tasks ?? []) made.push(addItem(s, { ...base, kind: 'task', list: list.id, title: t.content, due: t.due ?? '', priority: t.priority ?? 0, tags: intent.tags ?? [] }, now));
        const what = made.length === 1 ? (made[0]!.kind === 'note' ? 'Note' : made[0]!.kind === 'task' ? 'Task' : 'Todo') : `${made.length} items`;
        return { ok: true, changed: true, items: made, list, say: `${what} saved to ${list.name}${missed ? ` (no list called ${intent.list})` : ''}.` };
      }
      case 'create-list': {
        const existing = intent.sublist ? null : findList(s, intent.list!);
        if (existing && norm(existing.name) === norm(intent.list!)) return { ok: false, changed: false, list: existing, say: `${existing.name} is already there.` };
        const l = resolve(true)!;
        return { ok: true, changed: true, list: l, say: `Made ${pathOf(s, l.id)}.` };
      }
      case 'move': {
        const it = pick();
        if (!it) return { ok: false, changed: false, say: `I can't find ${intent.target ?? 'that'}.` };
        const to = resolve(intent.create === true);
        if (!to) return { ok: false, changed: false, say: `There's no list called ${intent.list}.` };
        moveItems(s, [it.id], to.id, now);
        return { ok: true, changed: true, items: [it], list: to, say: `Moved “${it.title}” to ${to.name}.` };
      }
      case 'rename-list': {
        const l = findList(s, intent.target!);
        if (!l) return { ok: false, changed: false, say: `There's no list called ${intent.target}.` };
        const old = l.name; renameList(s, l.id, titleCase(intent.to!), now);
        return { ok: true, changed: true, list: l, say: `Renamed ${old} to ${l.name}.` };
      }
      case 'rename-item': {
        const it = pick();
        if (!it) return { ok: false, changed: false, say: `I can't find ${intent.target}.` };
        const n = updateItem(s, it.id, { title: intent.to! }, now);
        return { ok: true, changed: true, items: [n], say: `Renamed to “${n.title}”.` };
      }
      case 'done': case 'undone': {
        const it = pick();
        if (!it) return { ok: false, changed: false, say: `I can't find ${intent.target ?? 'that'}.` };
        const n = updateItem(s, it.id, { status: intent.action === 'done' ? 'done' : 'open' }, now);
        return { ok: true, changed: true, items: [n], say: intent.action === 'done' ? `Done: ${n.title}.` : `Reopened ${n.title}.` };
      }
      case 'remove': {
        const it = pick();
        if (!it) return { ok: false, changed: false, say: "There's nothing to remove." };
        removeItems(s, [it.id]);
        return { ok: true, changed: true, items: [it], say: `Removed “${it.title}”.` };
      }
      case 'read': {
        const list = intent.list ? findList(s, intent.list) : null;
        if (intent.list && !list) return { ok: false, changed: false, say: `There's no list called ${intent.list}.` };
        let items = list ? itemsIn(s, list.id) : search(s, { kind: intent.kind === 'note' ? 'note' : '', status: 'not-done' });
        if (intent.due) items = items.filter((i) => i.due && i.due.slice(0, 10) <= intent.due!);
        if (!list && intent.kind === 'task') items = items.filter((i) => i.kind !== 'note');
        const top = items.filter((i) => i.status !== 'done').slice(0, 7);
        const where = list ? list.name : intent.due ? 'today' : 'open';
        return { ok: true, changed: false, items: top, list: list ?? undefined, open: { list: list?.id },
          say: top.length ? `${top.length === 1 ? 'One' : top.length} ${where}: ${top.map((i) => i.title).join('; ')}.` : `Nothing ${list ? `in ${list.name}` : where}.` };
      }
      case 'search': {
        const found = search(s, { q: intent.text ?? '' });
        return { ok: true, changed: false, items: found.slice(0, 20), open: { q: intent.text }, say: found.length ? `Found ${found.length}.` : 'Nothing found.' };
      }
      case 'open': {
        const l = intent.list ? findList(s, intent.list) : null;
        return l ? { ok: true, changed: false, list: l, open: { list: l.id }, say: `${l.name}.` } : { ok: false, changed: false, say: `There's no list called ${intent.list}.` };
      }
    }
  } catch (e) {
    return { ok: false, changed: false, say: e instanceof Error ? e.message : String(e) };
  }
  return { ok: false, changed: false, say: "I can't do that yet." };
}

export const titleCase = (s: string) => str(s, MAX_NAME).replace(/\b\w/g, (c) => c.toUpperCase());

/* ---------------------------------------------------------------- shared Voice notes (console plugin + Voice Vault) */

/**
 * The console's Voice notes plugin and Voice Vault save to hub folder `voice-notes/` (tables `lists`: numbered lists
 * with subcategories; `notes`: `{list, subcategory, text, answers, at, by, device}`). AmberX shows them under the
 * Voice notes list, one sub-list each, read through this mapping; they're never rewritten in place (moving one into an
 * AmberX list copies it as an AmberX note).
 */
export const VOICE_NOTES_FOLDER = 'voice-notes';
export function fromVoiceNotes(lists: Record<string, unknown>, notes: Record<string, unknown>): { lists: NoteList[]; items: Item[] } {
  const outLists: NoteList[] = [];
  const outItems: Item[] = [];
  const nameOf = new Map<string, string>();
  for (const [id, raw] of Object.entries(lists)) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const name = str(r.name, MAX_NAME);
    if (!name) continue;
    nameOf.set(id, name);
    outLists.push({ id: `vn-${id}`, name, parent: SYS.voiceNotes, order: Number(r.number) || 0, icon: 'mic', createdAt: '', updatedAt: '' });
  }
  for (const [id, raw] of Object.entries(notes)) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const body = text(r.text, MAX_TEXT);
    if (!body) continue;
    const listId = typeof r.list === 'string' && nameOf.has(r.list) ? `vn-${r.list}` : SYS.voiceNotes;
    const answers = r.answers && typeof r.answers === 'object' ? Object.entries(r.answers as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`).join('\n') : '';
    const at = iso(r.at) || '';
    outItems.push({
      id: `vn-${id}`, kind: 'note', list: listId, title: titleFrom(body) || 'Voice note', text: answers ? `${body}\n\n${answers}` : body,
      summary: '', transcript: body, tags: typeof r.subcategory === 'string' && r.subcategory ? tagList([r.subcategory]) : [],
      pinned: false, starred: false, status: 'open', priority: 0, due: '', checklist: [], parent: '', order: 0, source: 'import', url: '',
      createdAt: at, updatedAt: at, doneAt: '', by: str(r.by, 80), device: str(r.device, 80),
    });
  }
  return { lists: outLists, items: outItems };
}
export const isShared = (id: string) => id.startsWith('vn-');

/* ---------------------------------------------------------------- export */

export function toMarkdown(s: Store, listId?: string): string {
  const lines: string[] = [];
  const box = (i: Item) => (i.kind === 'note' ? '-' : `- [${i.status === 'done' ? 'x' : ' '}]`);
  const writeList = (l: NoteList, depth: number) => {
    lines.push(`${'#'.repeat(Math.min(depth + 1, 6))} ${l.name}`, '');
    for (const i of itemsIn(s, l.id).filter((x) => !x.parent)) {
      const meta = [i.due && `due ${i.due.slice(0, 10)}`, i.priority && PRIORITY_LABEL[i.priority], ...i.tags.map((t) => `#${t}`)].filter(Boolean).join(' · ');
      lines.push(`${box(i)} **${i.title}**${meta ? ` _(${meta})_` : ''}`);
      if (i.text && i.text !== i.title) lines.push(...i.text.split('\n').map((t) => `  ${t}`));
      for (const c of i.checklist) lines.push(`  - [${c.done ? 'x' : ' '}] ${c.text}`);
      for (const sub of Object.values(s.items).filter((x) => x.parent === i.id)) lines.push(`  ${box(sub)} ${sub.title}`);
    }
    lines.push('');
    for (const c of childrenOf(s, l.id)) writeList(c, depth + 1);
  };
  const roots = listId && s.lists[listId] ? [s.lists[listId]!] : childrenOf(s, null);
  for (const l of roots) writeList(l, 0);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function toJson(s: Store): string {
  return JSON.stringify({ $axf: FORMAT, exportedAt: new Date().toISOString(), lists: Object.values(s.lists), items: Object.values(s.items) }, null, 2);
}

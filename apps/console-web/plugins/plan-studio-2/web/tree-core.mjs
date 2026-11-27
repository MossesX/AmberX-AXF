/**
 * Plan Studio 2.0 core (plan-tree@1): one tree of items nested to any depth. Pure functions on a plain state object, shared
 * by the console page (web), the CLI and server (tree.mjs), the plugin commands, MCP and voice, so every surface keeps
 * the same rules.
 *
 *   state = { $axf: 'plan-tree@1', rev, items: Item[], trash: TrashEntry[] }
 *   Item  = { id, parent (id | null), order, kind, title, body, status, done, priority, tags[], model, minutes,
 *             links: Link[], collapsed, createdAt, updatedAt, by }
 *   Link  = { type: 'todo' | 'build' | 'note' | 'shipped' | 'plan' | 'url', ref, label }
 *
 * View fields (never stored; the server lays them on from the builds store, live-core.mjs liveView): `live` (the state
 * of a sent plan or step), `locked` (sent, not landed: no edits) and `origin: 'orchestrator'` (a step the orchestrator
 * filed, listed under the plan it was sent from). `stored()` drops them before a save.
 *
 * Any kind holds any other kind (plan, section, step, note, list, item): there is no fixed shape. Nothing is synced into
 * the tree: other parts of the console are reached only through links a person (or a command) adds on purpose.
 * Deleting moves the item and everything under it to the trash; undo puts it back in the same place.
 */

export const SCHEMA = 'plan-tree@1';
export const KINDS = Object.freeze(['plan', 'section', 'step', 'note', 'list', 'item']);
export const STATUSES = Object.freeze(['idea', 'draft', 'active', 'parked', 'done']);
export const PRIORITIES = Object.freeze(['', 'P0', 'P1', 'P2', 'P3']);
export const MODELS = Object.freeze(['', 'Fable', 'Opus', 'Sonnet']);
export const LINK_TYPES = Object.freeze(['todo', 'build', 'note', 'shipped', 'plan', 'url']);
export const KIND_LABEL = Object.freeze({ plan: 'Plan', section: 'Section', step: 'Step', note: 'Note', list: 'List', item: 'List item' });
export const KIND_ICON = Object.freeze({ plan: 'layers', section: 'folder', step: 'check', note: 'file', list: 'list', item: 'minus' });
/** What a new child of each kind is by default (the "+" on a row). */
export const CHILD_KIND = Object.freeze({ plan: 'section', section: 'step', step: 'step', note: 'note', list: 'item', item: 'item' });
/** Kinds that carry a done checkbox. */
export const CHECKABLE = Object.freeze(new Set(['step', 'item']));
export const TRASH_MAX = 50;

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const str = (v, max = 4000) => String(v ?? '').slice(0, max);
const nowIso = () => new Date().toISOString();

export class TreeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function rid(n = 6) {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
export const slug = (t) => str(t, 200).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';
export const newId = (title, taken) => { let id; do id = `${slug(title).slice(0, 32)}-${rid(4)}`; while (taken?.has(id)); return id; };

export function emptyState() { return { $axf: SCHEMA, rev: 0, items: [], trash: [] }; }

export function normLink(l) {
  if (!l || typeof l !== 'object') return null;
  const type = LINK_TYPES.includes(l.type) ? l.type : null;
  const ref = str(l.ref, 500).trim();
  if (!type || !ref) return null;
  return { type, ref, label: str(l.label, 200) };
}

export function normItem(raw, at = nowIso()) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const kind = KINDS.includes(r.kind) ? r.kind : 'note';
  return {
    id: ID_RE.test(r.id ?? '') ? r.id : newId(r.title ?? kind),
    parent: typeof r.parent === 'string' && r.parent ? r.parent : null,
    order: Number.isFinite(r.order) ? r.order : 0,
    kind,
    title: str(r.title, 300).trim() || KIND_LABEL[kind],
    body: str(r.body, 100_000),
    status: STATUSES.includes(r.status) ? r.status : (kind === 'plan' ? 'draft' : ''),
    done: !!r.done,
    priority: PRIORITIES.includes(r.priority) ? r.priority : '',
    tags: Array.isArray(r.tags) ? [...new Set(r.tags.map((t) => str(t, 60).trim()).filter(Boolean))].slice(0, 30) : [],
    model: MODELS.includes(r.model) ? r.model : '',
    minutes: Number.isFinite(Number(r.minutes)) && Number(r.minutes) > 0 ? Math.round(Number(r.minutes)) : 0,
    links: (Array.isArray(r.links) ? r.links : []).map(normLink).filter(Boolean).slice(0, 100),
    collapsed: !!r.collapsed,
    createdAt: str(r.createdAt, 40) || at,
    updatedAt: str(r.updatedAt, 40) || at,
    by: str(r.by, 80),
    ...(r.origin === 'orchestrator' ? { origin: r.origin } : {}),
    ...(r.locked === true ? { locked: true } : {}),
    ...(r.live && typeof r.live === 'object' && !Array.isArray(r.live) ? { live: r.live } : {}),
    // shipped-manifest@1 the plan received when its build shipped (shipped.mjs), or the refusal of an invalid one
    ...(isObj(r.shipped) ? { shipped: r.shipped } : {}),
    ...(isObj(r.shippedProblem) ? { shippedProblem: r.shippedProblem } : {}),
  };
}
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** A copy (duplicate, import) is a new plan: the manifest stays with the plan its build was sent from. */
const unshipped = ({ shipped: _s, shippedProblem: _p, ...it }) => it;

/** The state as it is saved: no orchestrator rows and no view fields (they are read from the builds store each time). */
export function stored(state) {
  return { ...state, items: (state?.items ?? []).filter((i) => i.origin !== 'orchestrator').map(({ origin: _o, locked: _l, live: _v, ...i }) => i) };
}

/** A well-formed state: unknown parents become roots, cycles are broken, orders are made contiguous. */
export function normalize(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const items = [];
  for (const x of Array.isArray(s.items) ? s.items : []) {
    const it = normItem(x);
    if (seen.has(it.id)) continue;
    seen.add(it.id); items.push(it);
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const it of items) {
    if (it.parent && !byId.has(it.parent)) it.parent = null;
    // a cycle (a → b → a): the item that closes it becomes a root
    const path = new Set([it.id]);
    for (let p = it.parent; p; p = byId.get(p)?.parent ?? null) { if (path.has(p)) { it.parent = null; break; } path.add(p); }
  }
  const out = { $axf: SCHEMA, rev: Number.isFinite(s.rev) ? s.rev : 0, items, trash: (Array.isArray(s.trash) ? s.trash : []).filter((t) => t && Array.isArray(t.items)).slice(-TRASH_MAX) };
  renumber(out);
  return out;
}

/* ------------------------------------------------------------------ reads */

export const byId = (s, id) => s.items.find((i) => i.id === id) ?? null;
export const children = (s, parent) => s.items.filter((i) => i.parent === (parent ?? null)).sort((a, b) => a.order - b.order);
export const roots = (s) => children(s, null);

export function descendants(s, id) {
  const out = [];
  const walk = (p) => { for (const c of children(s, p)) { out.push(c); walk(c.id); } };
  walk(id);
  return out;
}
export function ancestors(s, id) {
  const out = [];
  for (let p = byId(s, id)?.parent ?? null; p; p = byId(s, p)?.parent ?? null) { const it = byId(s, p); if (!it) break; out.unshift(it); }
  return out;
}
export const pathOf = (s, id) => [...ancestors(s, id), byId(s, id)].filter(Boolean).map((i) => i.title).join(' › ');
export const depthOf = (s, id) => ancestors(s, id).length;

/** Steps and list items under an item, done of total (the progress shown on rows and plans). */
export function progress(s, id) {
  const all = id ? descendants(s, id) : s.items;
  const ck = all.filter((i) => CHECKABLE.has(i.kind));
  const minutes = all.reduce((m, i) => m + (i.minutes || 0), 0);
  return { done: ck.filter((i) => i.done).length, total: ck.length, minutes };
}

/** The tree as nested rows (the page, `tree` reads and Markdown export). */
export function tree(s, parent = null) {
  return children(s, parent).map((i) => ({ ...i, children: tree(s, i.id) }));
}

/** Rows in display order with their depth; `collapsed` (a Set of ids) hides what is under them. */
export function flatten(s, { collapsed = null, parent = null, depth = 0, out = [] } = {}) {
  for (const it of children(s, parent)) {
    const kids = children(s, it.id).length;
    out.push({ item: it, depth, kids });
    const shut = collapsed ? collapsed.has(it.id) : it.collapsed;
    if (kids && !shut) flatten(s, { collapsed, parent: it.id, depth: depth + 1, out });
  }
  return out;
}

/** Words → matching items, best first (title hits over body hits; every word must appear somewhere). */
export function find(s, q, { kind = '', limit = 20, under = '' } = {}) {
  const words = str(q, 400).toLowerCase().split(/\s+/).filter(Boolean);
  let pool = under ? descendants(s, under) : s.items;
  if (kind) pool = pool.filter((i) => i.kind === kind);
  if (!words.length) return pool.slice(0, limit).map((i) => hit(s, i, 0));
  const hits = [];
  for (const i of pool) {
    const t = i.title.toLowerCase();
    const all = `${t} ${i.body.toLowerCase()} ${i.tags.join(' ').toLowerCase()}`;
    if (!words.every((w) => all.includes(w))) continue;
    const score = (t === words.join(' ') ? 100 : 0) + words.filter((w) => t.includes(w)).length * 10 + (i.kind === 'plan' ? 2 : 0);
    hits.push(hit(s, i, score));
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
const hit = (s, i, score) => ({ id: i.id, kind: i.kind, title: i.title, path: pathOf(s, i.id), score, focus: `plan-studio-2.focus:${i.id}` });

/** An item by id, else by its title or words in it (voice: "the step about deploy"). */
export function resolve(s, ref) {
  const r = str(ref, 400).trim();
  if (!r) return null;
  const direct = byId(s, r);
  if (direct) return direct;
  const low = r.toLowerCase().replace(/^(the|a|an)\s+/, '');
  const exact = s.items.find((i) => i.title.toLowerCase() === low);
  if (exact) return exact;
  const kindWord = KINDS.find((k) => low.startsWith(`${k} `));
  const rest = kindWord ? low.slice(kindWord.length + 1).replace(/^(called|named|about|for|on)\s+/, '') : low;
  const h = find(s, rest, { kind: kindWord ?? '', limit: 1 })[0];
  return h ? byId(s, h.id) : null;
}
function need(s, ref, what = 'item') {
  const it = resolve(s, ref);
  if (!it) throw new TreeError('not_found', `no ${what} "${ref}"`);
  return it;
}

/* ------------------------------------------------------------------ writes (each returns { state, … }; state is a new object) */

const clone = (s) => ({ ...s, items: s.items.map((i) => ({ ...i, tags: [...i.tags], links: i.links.map((l) => ({ ...l })) })), trash: [...s.trash] });
const bump = (s) => { s.rev = (s.rev || 0) + 1; return s; };

function renumber(s, parent) {
  const groups = new Map();
  for (const i of s.items) if (parent === undefined || i.parent === parent) { const k = i.parent ?? ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
  for (const g of groups.values()) g.sort((a, b) => a.order - b.order).forEach((i, n) => { i.order = n; });
}
function place(s, it, parent, index) {
  const sibs = children(s, parent).filter((x) => x.id !== it.id);
  const at = index == null || index < 0 || index > sibs.length ? sibs.length : index;
  sibs.splice(at, 0, it);
  it.parent = parent;
  sibs.forEach((x, n) => { x.order = n; });
}

/** Add an item inside `parent` (null = top level) at `index` (end when absent). */
export function add(state, { parent = null, kind, title, body = '', index, by = '', ...rest } = {}) {
  const s = clone(state);
  const par = parent ? need(s, parent, 'parent') : null;
  const k = KINDS.includes(kind) ? kind : par ? CHILD_KIND[par.kind] : 'plan';
  const at = nowIso();
  const it = normItem({ ...rest, kind: k, title, body, by, createdAt: at, updatedAt: at, id: newId(title || k, new Set(s.items.map((i) => i.id))) }, at);
  s.items.push(it);
  place(s, it, par?.id ?? null, index);
  return { state: bump(s), item: it };
}

const EDITABLE = ['title', 'body', 'status', 'done', 'priority', 'tags', 'model', 'minutes', 'kind', 'collapsed'];

/** Change fields of one item (title, body, status, done, priority, tags, model, minutes, kind, collapsed). */
export function edit(state, ref, patch = {}, by = '') {
  const s = clone(state);
  const it = need(s, ref);
  const next = normItem({ ...it, ...Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => EDITABLE.includes(k))), id: it.id, parent: it.parent, order: it.order, links: it.links });
  const changed = EDITABLE.some((k) => JSON.stringify(next[k]) !== JSON.stringify(it[k]));
  if (!changed) return { state, item: it, changed: false };
  Object.assign(it, next, { updatedAt: nowIso(), by: str(by, 80) || it.by });
  return { state: bump(s), item: it, changed: true };
}
export const rename = (state, ref, title, by = '') => {
  if (!str(title).trim()) throw new TreeError('validation', 'a new name is needed');
  return edit(state, ref, { title }, by);
};

/** Move an item (and everything under it) into `parent` (null = top level) at `index`. Never into itself. */
export function move(state, ref, { parent = null, index } = {}) {
  const s = clone(state);
  const it = need(s, ref);
  const par = parent ? need(s, parent, 'parent') : null;
  if (par && (par.id === it.id || ancestors(s, par.id).some((a) => a.id === it.id))) throw new TreeError('validation', `"${it.title}" can't go inside itself`);
  const from = it.parent;
  place(s, it, par?.id ?? null, index);
  if (from !== it.parent) renumber(s, from);
  it.updatedAt = nowIso();
  return { state: bump(s), item: it };
}
/** One place up or down among its siblings (keyboard and voice: "move it up"). */
export function nudge(state, ref, delta) {
  const it = need(state, ref);
  const sibs = children(state, it.parent);
  const at = sibs.findIndex((x) => x.id === it.id);
  return move(state, it.id, { parent: it.parent, index: Math.max(0, Math.min(sibs.length - 1, at + delta)) });
}
/** Indent (into the sibling above, at its end) or outdent (after its parent). */
export function indent(state, ref) {
  const it = need(state, ref);
  const sibs = children(state, it.parent);
  const at = sibs.findIndex((x) => x.id === it.id);
  if (at <= 0) return { state, item: it, changed: false };
  return move(state, it.id, { parent: sibs[at - 1].id });
}
export function outdent(state, ref) {
  const it = need(state, ref);
  if (!it.parent) return { state, item: it, changed: false };
  const par = byId(state, it.parent);
  return move(state, it.id, { parent: par.parent, index: par.order + 1 });
}

/** A copy of an item and everything under it, placed right after it. */
export function duplicate(state, ref, by = '') {
  const s = clone(state);
  const it = need(s, ref);
  const taken = new Set(s.items.map((i) => i.id));
  const map = new Map();
  const at = nowIso();
  const copyOf = (src, parent) => {
    const id = newId(src.title, taken); taken.add(id); map.set(src.id, id);
    const c = { ...unshipped(src), id, parent, tags: [...src.tags], links: src.links.map((l) => ({ ...l })), createdAt: at, updatedAt: at, by: str(by, 80) || src.by };
    s.items.push(c);
    for (const k of children(state, src.id)) copyOf(k, id);
    return c;
  };
  const top = copyOf(it, it.parent);
  top.title = `${it.title} (copy)`;
  place(s, top, it.parent, it.order + 1);
  return { state: bump(s), item: top, count: map.size };
}

/** Delete = to the trash with everything under it; `undo` brings the newest (or one by id) back where it was. */
export function remove(state, ref, by = '') {
  const s = clone(state);
  const it = need(s, ref);
  const gone = [it, ...descendants(s, it.id)];
  const ids = new Set(gone.map((g) => g.id));
  s.items = s.items.filter((i) => !ids.has(i.id));
  renumber(s, it.parent);
  const entry = { id: `t-${Date.now().toString(36)}-${rid(3)}`, at: nowIso(), by: str(by, 80), title: it.title, root: it.id, parent: it.parent, index: it.order, items: gone };
  s.trash = [...s.trash, entry].slice(-TRASH_MAX);
  return { state: bump(s), trashId: entry.id, removed: gone.length, item: it };
}
export function undo(state, trashId = '') {
  const s = clone(state);
  const entry = trashId ? s.trash.find((t) => t.id === trashId) : s.trash[s.trash.length - 1];
  if (!entry) throw new TreeError('not_found', trashId ? `nothing in the trash called ${trashId}` : 'nothing to undo');
  s.trash = s.trash.filter((t) => t !== entry);
  const taken = new Set(s.items.map((i) => i.id));
  const back = entry.items.filter((i) => !taken.has(i.id)).map((i) => normItem(i));
  s.items.push(...back);
  const root = back.find((i) => i.id === entry.root);
  if (root) place(s, root, entry.parent && byId(s, entry.parent) ? entry.parent : null, entry.index);
  return { state: bump(s), restored: back.length, item: root ?? null };
}

/** Explicit links only (never a sync): one item ↔ a to-do, build, note, Shipped feature, another plan item or a URL. */
export function link(state, ref, l) {
  const s = clone(state);
  const it = need(s, ref);
  const n = normLink(l);
  if (!n) throw new TreeError('validation', `a link needs a type (${LINK_TYPES.join(', ')}) and a ref`);
  if (n.type === 'plan' && !byId(s, n.ref)) throw new TreeError('not_found', `no plan item ${n.ref}`);
  if (it.links.some((x) => x.type === n.type && x.ref === n.ref)) return { state, item: it, changed: false };
  it.links.push(n); it.updatedAt = nowIso();
  return { state: bump(s), item: it, changed: true };
}
export function unlink(state, ref, { type, ref: target }) {
  const s = clone(state);
  const it = need(s, ref);
  const before = it.links.length;
  it.links = it.links.filter((x) => !(x.type === type && x.ref === target));
  if (it.links.length === before) return { state, item: it, changed: false };
  it.updatedAt = nowIso();
  return { state: bump(s), item: it, changed: true };
}

/** Collapse / expand one item, or every item (ids = null) at once. */
export function setCollapsed(state, ids, collapsed) {
  const s = clone(state);
  const want = ids ? new Set(ids) : null;
  let n = 0;
  for (const i of s.items) if ((!want || want.has(i.id)) && children(s, i.id).length && i.collapsed !== !!collapsed) { i.collapsed = !!collapsed; n++; }
  return n ? { state: bump(s), changed: n } : { state, changed: 0 };
}

/** Everything gone (the trash too): the store starts empty. */
export function clearAll(state) { return { state: { ...emptyState(), rev: (state?.rev || 0) + 1 }, removed: state?.items?.length ?? 0 }; }

/* ------------------------------------------------------------------ export */

export function toMarkdown(s, ref = null) {
  const lines = [];
  const write = (it, depth) => {
    const pad = '  '.repeat(Math.max(0, depth - 1));
    if (depth === 0) lines.push(`# ${it.title}`, '');
    else if (CHECKABLE.has(it.kind)) lines.push(`${pad}- [${it.done ? 'x' : ' '}] ${it.title}${it.model ? ` (${it.model}${it.minutes ? `, ${it.minutes} min` : ''})` : ''}`);
    else if (it.kind === 'section' && depth < 6) lines.push('', `${'#'.repeat(depth + 1)} ${it.title}`, '');
    else lines.push(`${pad}- **${it.title}**`);
    if (it.body.trim()) lines.push(...it.body.trim().split('\n').map((l) => (depth === 0 || it.kind === 'section' ? l : `${pad}  ${l}`)), '');
    for (const l of it.links) lines.push(`${pad}  ↳ ${l.type}: ${l.label || l.ref}`);
    for (const c of children(s, it.id)) write(c, depth + 1);
  };
  const tops = ref ? [need(s, ref)] : roots(s);
  for (const t of tops) { write(t, 0); lines.push(''); }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
export function toJson(s, ref = null) {
  const it = ref ? need(s, ref) : null;
  const items = it ? [it, ...descendants(s, it.id)] : s.items;
  return { $axf: 'plan-tree-export@1', exportedAt: nowIso(), root: it?.id ?? null, items };
}
/** Import a plan-tree export (or a list of items) under `parent`: every id is new, the shape is kept. */
export function importItems(state, data, { parent = null, by = '' } = {}) {
  const src = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  if (!src.length) throw new TreeError('validation', 'nothing to import');
  const s = clone(state);
  const par = parent ? need(s, parent, 'parent') : null;
  const taken = new Set(s.items.map((i) => i.id));
  const ids = new Map();
  for (const r of src) { const id = newId(r.title ?? 'item', taken); taken.add(id); ids.set(r.id, id); }
  const at = nowIso();
  const made = src.map((r) => normItem({ ...unshipped(r), id: ids.get(r.id), parent: ids.get(r.parent) ?? '__top__', createdAt: at, updatedAt: at, by }, at));
  for (const m of made) {
    if (m.parent === '__top__') { m.parent = null; s.items.push(m); place(s, m, par?.id ?? null); } else s.items.push(m);
  }
  renumber(s);
  return { state: bump(s), imported: made.length };
}

/* ------------------------------------------------------------------ the build orchestrator (explicit: "send to build") */

/**
 * The plan an item sends to the orchestrator: its title, its body (with the notes under it) and its open steps (any
 * depth) as planning steps. The orchestrator's splitting stage designs the build steps; a step's model and minutes go
 * along only as hints, when they were set.
 */
export function toBuild(s, ref, { said = '' } = {}) {
  const it = need(s, ref);
  const under = descendants(s, it.id);
  let steps = under.filter((i) => i.kind === 'step' && !i.done);
  if (!steps.length) steps = under.filter((i) => CHECKABLE.has(i.kind) && !i.done);
  if (!steps.length && CHECKABLE.has(it.kind)) steps = [it];
  const detail = [it.body.trim(), ...children(s, it.id).filter((c) => c.kind === 'note' && c.body.trim()).map((c) => `${c.title}: ${c.body.trim()}`)].filter(Boolean).join('\n\n');
  return {
    action: 'add', title: it.title, detail: detail.slice(0, 8000), source: 'plan-studio-2',
    ...(said ? { said } : {}),
    steps: steps.map((x) => ({ text: x.title, model: x.model ? x.model.toLowerCase() : '', estimate: x.minutes ? `${x.minutes} min` : '' })),
  };
}

/* ------------------------------------------------------------------ voice: one spoken sentence → one command */

const KIND_WORDS = { plan: 'plan', plans: 'plan', section: 'section', sections: 'section', step: 'step', steps: 'step', task: 'step', note: 'note', notes: 'note', list: 'list', lists: 'list', item: 'item', 'list item': 'item', checklist: 'list' };
const kindOf = (w) => KIND_WORDS[String(w ?? '').toLowerCase()] ?? null;
const clean = (t) => String(t ?? '').trim().replace(/^["'“]|["'”.]$/g, '').replace(/[.?!]+$/, '').trim();

/**
 * Plain spoken commands (AmberX voice, the page's mic, `tree.mjs say`): returns { op, … } for `api`, or null.
 *   new plan <title> · add a step <title> to <item> · add a note <title> under <item>
 *   rename <item> to <title> · delete <item> · undo · duplicate <item> · mark <item> done / not done
 *   move <item> into <item> | to the top · move <item> up / down · collapse all · expand all
 *   open <item> · find <words> · send <item> to the build orchestrator · export <item>
 */
export function parseVoice(text) {
  const t = clean(text).replace(/\s+/g, ' ');
  const low = t.toLowerCase();
  let m;
  if (/^(undo|undo that|bring it back|restore( it)?)$/.test(low)) return { op: 'undo' };
  if (/^(collapse|fold|close) (all|everything)$/.test(low)) return { op: 'collapse', all: true, collapsed: true };
  if (/^(expand|unfold|open) (all|everything)$/.test(low)) return { op: 'collapse', all: true, collapsed: false };
  if ((m = /^(?:new|create|start|add) (?:a |an )?(plan|section|step|task|note|list|list item|item|checklist)(?: (?:called|named|titled))? (.+?)(?: (?:to|in|into|under|inside|on) (?:the )?(.+))?$/i.exec(t))) {
    const kind = kindOf(m[1]);
    return { op: 'add', kind, title: clean(m[2]), parent: m[3] ? clean(m[3]) : null };
  }
  if ((m = /^rename (.+?) (?:to|as) (.+)$/i.exec(t))) return { op: 'rename', id: clean(m[1]), title: clean(m[2]) };
  if ((m = /^(?:delete|remove|trash|get rid of) (.+)$/i.exec(t))) return { op: 'delete', id: clean(m[1]) };
  if ((m = /^(?:duplicate|copy|clone) (.+)$/i.exec(t))) return { op: 'duplicate', id: clean(m[1]) };
  if ((m = /^(?:mark|untick|uncheck) (.+?) (?:as )?(?:not done|undone|open|todo)$/i.exec(t)) || (m = /^(?:untick|uncheck|reopen) (.+)$/i.exec(t))) return { op: 'edit', id: clean(m[1]), patch: { done: false } };
  if ((m = /^(?:mark|tick|check) (.+?) (?:as )?(done|complete|finished)$/i.exec(t)) || (m = /^(?:tick off|check off|tick|check|finish|complete) (.+)$/i.exec(t))) return { op: 'edit', id: clean(m[1]), patch: { done: true } };
  if ((m = /^move (.+?) (up|down)$/i.exec(t))) return { op: 'nudge', id: clean(m[1]), delta: m[2].toLowerCase() === 'up' ? -1 : 1 };
  if ((m = /^move (.+?) (?:to the top( level)?|out)$/i.exec(t))) return { op: 'move', id: clean(m[1]), parent: null };
  if ((m = /^move (.+?) (?:into|to|under|inside) (?:the )?(.+)$/i.exec(t))) return { op: 'move', id: clean(m[1]), parent: clean(m[2]) };
  if ((m = /^(?:send|turn) (.+?) (?:to|into) (?:the )?(?:build orchestrator|orchestrator|a build|build)$/i.exec(t))) return { op: 'send-to-build', id: clean(m[1]) };
  if ((m = /^export (.+)$/i.exec(t))) return { op: 'export', id: clean(m[1]), format: 'md' };
  if ((m = /^(?:collapse|fold) (.+)$/i.exec(t))) return { op: 'collapse', id: clean(m[1]), collapsed: true };
  if ((m = /^(?:expand|unfold) (.+)$/i.exec(t))) return { op: 'collapse', id: clean(m[1]), collapsed: false };
  if ((m = /^(?:find|search(?: for)?|where is) (.+)$/i.exec(t))) return { op: 'find', q: clean(m[1]) };
  if ((m = /^(?:open|show|go to) (.+)$/i.exec(t))) return { op: 'open', id: clean(m[1]) };
  return null;
}

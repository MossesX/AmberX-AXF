/**
 * todo-tree@1 engine: one tree of nodes (list, note, todo, task, or any later kind), any kind inside any kind, no depth
 * limit. Pure functions, no IO: every operation takes a document and returns a new one. The server, the CLI, the MCP
 * tools, voice and the web UI all run this one module. Contract: ../SPEC.md, schema ../schema/todo-tree.json.
 *
 * Part 1 (s3): document load / validate, navigation (children, ancestors, breadcrumbs, descendants), title paths
 * ("Groceries > Weekend") and fractional order keys.
 */

export const FORMAT = 'todo-tree@1';
export const KINDS = ['list', 'note', 'todo', 'task'];
/** Kinds with a tick box; they count towards progress. Anything else behaves like a note. */
export const CHECKABLE = new Set(['todo', 'task']);
export const STATUSES = ['open', 'doing', 'blocked', 'done'];
export const PRIORITIES = ['none', 'low', 'normal', 'high', 'urgent'];
export const TONES = ['accent', 'info', 'success', 'warning', 'danger', 'neutral'];
export const SOURCES = ['voice', 'typed', 'ai', 'import', 'console', 'api'];
export const LIMITS = Object.freeze({ nodes: 50_000, title: 200, body: 50_000, tags: 20, tag: 30, trash: 200, ops: 1000, depth: 10_000, orderKey: 200 });

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const KIND_RE = /^[a-z][a-z0-9-]{0,23}$/;
const ICON_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DUE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;
const PATH_SEP_RE = /\s*(?:>|\/|›|»|\bthen\b)\s*/i;

/** A refused call. `status` is HTTP-shaped (400 / 404 / 409) so the server passes it through. */
export class TodoError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message);
    this.name = 'TodoError';
    this.code = code;
    this.status = status;
    Object.assign(this, extra);
  }
}

export const isCheckable = (node) => !!node && CHECKABLE.has(node.kind);

// ------------------------------------------------------------------------------------------------ text helpers

/** Control characters out, length capped. */
export function text(v, max) {
  const s = v == null ? '' : String(v);
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, max);
}

const foldTitle = (s) => text(s, LIMITS.title).trim().replace(/\s+/g, ' ').toLowerCase();

export function cleanTags(v) {
  const src = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const out = [];
  for (const t of src) {
    const s = text(t, LIMITS.tag).trim().toLowerCase();
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= LIMITS.tags) break;
  }
  return out;
}

/** A due value: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm' (local), a Date, or ms → canonical string; anything else null. */
export function cleanDue(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || v instanceof Date) return dueFromMs(v instanceof Date ? v.getTime() : v);
  const m = DUE_RE.exec(String(v).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
  if (h != null && (+h > 23 || +mi > 59)) return null;
  return `${y}-${mo}-${d}${h != null ? `T${h}:${mi}` : ''}`;
}

/** ms → local 'YYYY-MM-DD', with 'THH:mm' when the time is not midnight. */
export function dueFromMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return d.getHours() || d.getMinutes() ? `${day}T${p(d.getHours())}:${p(d.getMinutes())}` : day;
}

/** A due string → local ms (start of the day when no time). */
export function dueToMs(due) {
  const m = DUE_RE.exec(due || '');
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime();
}

let idCounter = 0;
/** A new node id: 'n-' + base-36 time + counter + random. Never collides with migrated integer ids. */
export function newId(now = Date.now()) {
  idCounter = (idCounter + 1) % 1296;
  const rnd = Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');
  return `n-${now.toString(36)}${idCounter.toString(36).padStart(2, '0')}${rnd}`;
}

/** A token for ops and trash entries. */
export function newToken(now = Date.now()) {
  return `t-${now.toString(36)}${Math.floor(Math.random() * 46_656).toString(36).padStart(3, '0')}`;
}

// ------------------------------------------------------------------------------------------------ order keys

/*
 * Order keys are fractional indices (the scheme of Figma's and rocicorp's fractional-indexing, base 62): a key is an
 * integer part whose first letter says how long it is ('a' + 1 digit … 'z' + 26 digits for positive ranks, 'Z' + 1 …
 * 'A' + 26 for negative) followed by an optional fraction with no trailing '0'. Plain string comparison is the order.
 * Appending increments the integer ('a0', 'a1', … 'az', 'b00', …), so keys stay short; a fraction only grows when a key
 * is squeezed between two neighbours.
 */
export const ORDER_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = ORDER_DIGITS[0];
const LAST = ORDER_DIGITS[ORDER_DIGITS.length - 1];
const SMALLEST_INTEGER = 'A' + ZERO.repeat(26);

function integerLength(head) {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2;
  if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2;
  return 0;
}
function integerPart(key) {
  const n = integerLength(key[0]);
  if (!n || n > key.length) return null;
  return key.slice(0, n);
}
function isOrderKey(k) {
  if (typeof k !== 'string' || !k || k.length > LIMITS.orderKey || k === SMALLEST_INTEGER) return false;
  if (![...k].every((c) => ORDER_DIGITS.includes(c))) return false;
  const i = integerPart(k);
  return i != null && !k.slice(i.length).endsWith(ZERO);
}
function incrementInteger(x) {
  const digs = x.slice(1).split('');
  let head = x[0];
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = ORDER_DIGITS.indexOf(digs[i]) + 1;
    if (d === ORDER_DIGITS.length) digs[i] = ZERO;
    else { digs[i] = ORDER_DIGITS[d]; carry = false; }
  }
  if (carry) {
    if (head === 'Z') return 'a' + ZERO;
    if (head === 'z') return null;
    head = String.fromCharCode(head.charCodeAt(0) + 1);
    if (head > 'a') digs.push(ZERO); else digs.pop();
  }
  return head + digs.join('');
}
function decrementInteger(x) {
  const digs = x.slice(1).split('');
  let head = x[0];
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = ORDER_DIGITS.indexOf(digs[i]) - 1;
    if (d === -1) digs[i] = LAST;
    else { digs[i] = ORDER_DIGITS[d]; borrow = false; }
  }
  if (borrow) {
    if (head === 'a') return 'Z' + LAST;
    if (head === 'A') return null;
    head = String.fromCharCode(head.charCodeAt(0) - 1);
    if (head < 'Z') digs.push(LAST); else digs.pop();
  }
  return head + digs.join('');
}
function midpoint(a, b) {
  if (b != null) {
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? ORDER_DIGITS.indexOf(a[0]) : 0;
  const db = b != null ? ORDER_DIGITS.indexOf(b[0]) : ORDER_DIGITS.length;
  if (db - da > 1) return ORDER_DIGITS[Math.round((da + db) / 2)];
  if (b != null && b.length > 1) return b.slice(0, 1);
  return ORDER_DIGITS[da] + midpoint(a.slice(1), null);
}

/** Plain string comparison is the sort order; ties (impossible after validate) fall back to the caller. */
export function compareOrder(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/** A key strictly between `a` and `b`; `a === null` means the start, `b === null` the end. */
export function orderBetween(a, b) {
  if (a != null && !isOrderKey(a)) throw new TodoError('bad-order', `Not an order key: ${a}`);
  if (b != null && !isOrderKey(b)) throw new TodoError('bad-order', `Not an order key: ${b}`);
  if (a != null && b != null && a >= b) throw new TodoError('bad-order', `Order keys out of order: ${a} >= ${b}`);
  if (a == null) {
    if (b == null) return 'a' + ZERO;
    const ib = integerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint('', fb);
    if (ib < b) return ib;
    const res = decrementInteger(ib);
    if (res == null) throw new TodoError('bad-order', 'No room before the first key');
    return res;
  }
  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  if (b == null) {
    const i = incrementInteger(ia);
    return i == null ? ia + midpoint(fa, null) : i;
  }
  const ib = integerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = incrementInteger(ia);
  if (i == null) throw new TodoError('bad-order', 'No room after the last key');
  return i < b ? i : ia + midpoint(fa, null);
}

/** `n` short keys in order, starting from `after` (renumbering, migration ranks). */
export function orderKeys(n, after = null) {
  const out = [];
  let last = after;
  for (let i = 0; i < n; i++) { last = orderBetween(last, null); out.push(last); }
  return out;
}

// ------------------------------------------------------------------------------------------------ document

export function emptyDoc(project = '', now = Date.now()) {
  const doc = { $axf: FORMAT, nodes: {}, trash: [], ops: [], seq: 0, meta: { createdAt: now } };
  if (project) doc.project = project;
  return doc;
}

/** One raw record → a node with every default filled and every value within the schema; null when it has no usable id. */
export function normalizeNode(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'number' ? String(raw.id) : typeof raw.id === 'string' ? raw.id : '';
  if (!ID_RE.test(id)) return null;
  const kind = typeof raw.kind === 'string' && KIND_RE.test(raw.kind) ? raw.kind : 'note';
  const parentId = raw.parentId == null || raw.parentId === '' ? null : String(raw.parentId);
  const status = STATUSES.includes(raw.status) ? raw.status : undefined;
  const done = typeof raw.done === 'boolean' ? raw.done : status === 'done';
  const createdAt = Number.isFinite(raw.createdAt) ? Math.max(0, Math.trunc(raw.createdAt)) : now;
  const n = {
    id,
    kind,
    parentId: parentId != null && ID_RE.test(parentId) ? parentId : null,
    order: isOrderKey(raw.order) ? raw.order : '',
    title: text(raw.title, LIMITS.title).trim() || `Untitled ${kind}`,
    body: text(raw.body, LIMITS.body),
    done,
    doneAt: done ? (Number.isFinite(raw.doneAt) ? Math.trunc(raw.doneAt) : createdAt) : null,
    status: done ? 'done' : status && status !== 'done' ? status : 'open',
    due: cleanDue(raw.due),
    priority: PRIORITIES.includes(raw.priority) ? raw.priority : 'normal',
    collapsed: raw.collapsed === true,
    createdAt,
    updatedAt: Number.isFinite(raw.updatedAt) ? Math.max(0, Math.trunc(raw.updatedAt)) : createdAt,
  };
  const tags = cleanTags(raw.tags);
  if (tags.length) n.tags = tags;
  if (TONES.includes(raw.tone)) n.tone = raw.tone;
  if (typeof raw.icon === 'string' && ICON_RE.test(raw.icon)) n.icon = raw.icon;
  if (raw.fields && typeof raw.fields === 'object' && !Array.isArray(raw.fields) && Object.keys(raw.fields).length) n.fields = { ...raw.fields };
  if (SOURCES.includes(raw.source)) n.source = raw.source;
  return n;
}

/**
 * Whatever came off disk → a valid todo-tree@1 document plus the repairs made (`warnings`). Orphans go to the root,
 * cycles are broken at the node that closes them, missing or duplicate order keys are re-keyed, done/status are
 * brought in step. Nothing is deleted. A string is parsed as JSON; a todo-store@1 file is refused (run the migration).
 */
export function load(raw, now = Date.now()) {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  const src = raw && typeof raw === 'object' ? raw : {};
  if (src.$axf === 'todo-store@1') throw new TodoError('needs-migration', 'This is a todo-store@1 file: run the migration first', 409);
  const warnings = [];
  const doc = emptyDoc(typeof src.project === 'string' ? src.project : '', now);
  if (src.meta && typeof src.meta === 'object') doc.meta = { ...src.meta, createdAt: Number.isFinite(src.meta.createdAt) ? src.meta.createdAt : now };
  const rawNodes = Array.isArray(src.nodes) ? src.nodes : src.nodes && typeof src.nodes === 'object' ? Object.values(src.nodes) : [];
  let skipped = 0;
  for (const r of rawNodes) {
    const n = normalizeNode(r, now);
    if (!n) { skipped++; continue; }
    if (doc.nodes[n.id]) { warnings.push(`duplicate id ${n.id}: the later record was dropped`); continue; }
    if (Object.keys(doc.nodes).length >= LIMITS.nodes) { warnings.push(`more than ${LIMITS.nodes} nodes: the rest were dropped`); break; }
    doc.nodes[n.id] = n;
  }
  if (skipped) warnings.push(`${skipped} record(s) without a usable id were dropped`);
  repair(doc, warnings);
  doc.trash = (Array.isArray(src.trash) ? src.trash : []).map((t) => normalizeTrash(t, now)).filter(Boolean).slice(-LIMITS.trash);
  doc.ops = (Array.isArray(src.ops) ? src.ops : []).filter((o) => o && typeof o === 'object' && Number.isFinite(o.seq) && typeof o.token === 'string').slice(-LIMITS.ops);
  doc.seq = Math.max(Number.isFinite(src.seq) ? Math.trunc(src.seq) : 0, ...doc.ops.map((o) => o.seq));
  return { doc, warnings };
}

function normalizeTrash(t, now) {
  if (!t || typeof t !== 'object' || typeof t.token !== 'string' || !Array.isArray(t.nodes)) return null;
  const nodes = t.nodes.map((n) => normalizeNode(n, now)).filter(Boolean);
  if (!nodes.length) return null;
  const rootId = typeof t.rootId === 'string' && nodes.some((n) => n.id === t.rootId) ? t.rootId : nodes[0].id;
  return { token: t.token, at: Number.isFinite(t.at) ? t.at : now, rootId, parentId: t.parentId == null ? null : String(t.parentId), nodes };
}

/** In place: orphans → root, cycles broken, order keys unique and present, done/status in step. */
function repair(doc, warnings) {
  const nodes = doc.nodes;
  for (const n of Object.values(nodes)) {
    if (n.parentId != null && !nodes[n.parentId]) { warnings.push(`${n.id} ("${n.title}"): parent ${n.parentId} is missing, moved to the root`); n.parentId = null; }
  }
  // cycles: walk up from every node; a node seen twice closes a loop → it goes to the root
  const safe = new Set();
  for (const start of Object.values(nodes)) {
    if (safe.has(start.id)) continue;
    const seen = [];
    const onPath = new Set();
    let cur = start;
    let steps = 0;
    while (cur && cur.parentId != null && !safe.has(cur.id)) {
      if (onPath.has(cur.id)) { warnings.push(`${cur.id} ("${cur.title}"): its ancestors loop back to it, moved to the root`); cur.parentId = null; break; }
      if (++steps > LIMITS.depth) { warnings.push(`${cur.id}: deeper than ${LIMITS.depth} levels, moved to the root`); cur.parentId = null; break; }
      onPath.add(cur.id);
      seen.push(cur.id);
      cur = nodes[cur.parentId];
    }
    for (const id of seen) safe.add(id);
    safe.add(start.id);
  }
  // order keys
  const byParent = new Map();
  for (const n of Object.values(nodes)) {
    const k = n.parentId ?? '';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(n);
  }
  for (const sibs of byParent.values()) {
    sibs.sort((a, b) => compareOrder(a.order, b.order) || (a.id < b.id ? -1 : 1));
    const used = new Set();
    let prev = null;
    for (const n of sibs) {
      if (!n.order || used.has(n.order)) {
        const next = sibs.find((s) => s.order && s.order > (prev ?? '') && !used.has(s.order) && s !== n)?.order ?? null;
        n.order = orderBetween(prev, next);
        warnings.push(`${n.id} ("${n.title}"): order key ${n.order ? 'repaired' : 'missing'}`);
      }
      used.add(n.order);
      prev = n.order;
    }
  }
}

/** Pure check (no repair): { ok, errors, warnings }. `errors` would be repaired by load; `warnings` are advisory. */
export function validate(doc) {
  const errors = [];
  const warnings = [];
  if (!doc || typeof doc !== 'object') return { ok: false, errors: ['not an object'], warnings };
  if (doc.$axf !== FORMAT) errors.push(`$axf is ${JSON.stringify(doc.$axf)}, expected ${FORMAT}`);
  const nodes = doc.nodes && typeof doc.nodes === 'object' ? doc.nodes : {};
  const byParent = new Map();
  for (const [key, n] of Object.entries(nodes)) {
    if (!n || n.id !== key) { errors.push(`node ${key}: id does not match its key`); continue; }
    if (!ID_RE.test(n.id)) errors.push(`node ${key}: bad id`);
    if (!KIND_RE.test(n.kind || '')) errors.push(`node ${key}: bad kind`);
    else if (!KINDS.includes(n.kind)) warnings.push(`node ${key}: kind "${n.kind}" is not built in (treated as a note)`);
    if (n.parentId != null && !nodes[n.parentId]) errors.push(`node ${key}: parent ${n.parentId} is missing`);
    if (!isOrderKey(n.order)) errors.push(`node ${key}: bad order key`);
    if (typeof n.title !== 'string' || !n.title.trim() || n.title.length > LIMITS.title) errors.push(`node ${key}: bad title`);
    if (n.body != null && (typeof n.body !== 'string' || n.body.length > LIMITS.body)) errors.push(`node ${key}: bad body`);
    if (typeof n.done !== 'boolean') errors.push(`node ${key}: done must be a boolean`);
    if (n.status != null && !STATUSES.includes(n.status)) errors.push(`node ${key}: bad status`);
    if (n.done !== ((n.status ?? 'open') === 'done')) errors.push(`node ${key}: done and status disagree`);
    if (n.due != null && cleanDue(n.due) !== n.due) errors.push(`node ${key}: bad due`);
    if (n.priority != null && !PRIORITIES.includes(n.priority)) errors.push(`node ${key}: bad priority`);
    if (typeof n.collapsed !== 'boolean') errors.push(`node ${key}: collapsed must be a boolean`);
    if (!Number.isFinite(n.createdAt) || !Number.isFinite(n.updatedAt)) errors.push(`node ${key}: bad timestamps`);
    const pk = n.parentId ?? '';
    if (!byParent.has(pk)) byParent.set(pk, new Map());
    const sibs = byParent.get(pk);
    if (sibs.has(n.order)) errors.push(`node ${key}: order key ${n.order} is also used by ${sibs.get(n.order)}`);
    sibs.set(n.order, n.id);
  }
  for (const n of Object.values(nodes)) {
    const seen = new Set();
    let cur = n;
    while (cur && cur.parentId != null) {
      if (seen.has(cur.id)) { errors.push(`node ${n.id}: its ancestors loop`); break; }
      seen.add(cur.id);
      if (seen.size > LIMITS.depth) { errors.push(`node ${n.id}: deeper than ${LIMITS.depth}`); break; }
      cur = nodes[cur.parentId];
    }
  }
  if (Object.keys(nodes).length > LIMITS.nodes) errors.push(`more than ${LIMITS.nodes} nodes`);
  if (Array.isArray(doc.trash) && doc.trash.length > LIMITS.trash) warnings.push('trash over its limit');
  if (Array.isArray(doc.ops) && doc.ops.length > LIMITS.ops) warnings.push('op log over its limit');
  return { ok: errors.length === 0, errors, warnings };
}

// ------------------------------------------------------------------------------------------------ navigation

export function getNode(doc, id) { return id == null ? undefined : doc.nodes[String(id)]; }

/** The node, or a 404 TodoError. */
export function node(doc, id) {
  const n = getNode(doc, id);
  if (!n) throw new TodoError('not-found', `No node ${id}`, 404);
  return n;
}

const bySibling = (a, b) => compareOrder(a.order, b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Children of a node (or of the root with null), in order. */
export function children(doc, parentId = null) {
  const p = parentId == null ? null : String(parentId);
  const out = [];
  for (const n of Object.values(doc.nodes)) if (n.parentId === p) out.push(n);
  return out.sort(bySibling);
}

/** Every parent's children in order, in one pass (for tree, rollups, flat). Key '' = the root. */
export function childrenIndex(doc) {
  const map = new Map();
  for (const n of Object.values(doc.nodes)) {
    const k = n.parentId ?? '';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(n);
  }
  for (const list of map.values()) list.sort(bySibling);
  return map;
}

/** Ids below `id` (not `id` itself), depth-first in display order. Iterative: any depth. */
export function descendants(doc, id, index = childrenIndex(doc)) {
  const out = [];
  const stack = [...(index.get(String(id)) ?? [])].reverse();
  while (stack.length) {
    const n = stack.pop();
    out.push(n.id);
    const kids = index.get(n.id);
    if (kids) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return out;
}

/** True when `maybeAncestorId` is `id` or above it. */
export function isSelfOrAncestor(doc, id, maybeAncestorId) {
  let cur = getNode(doc, id);
  let steps = 0;
  while (cur) {
    if (cur.id === String(maybeAncestorId)) return true;
    if (++steps > LIMITS.depth) return false;
    cur = cur.parentId == null ? null : doc.nodes[cur.parentId];
  }
  return false;
}

/** Ancestors of `id`, root first, not including `id`. */
export function ancestors(doc, id) {
  const out = [];
  let cur = getNode(doc, id);
  let steps = 0;
  while (cur && cur.parentId != null && ++steps <= LIMITS.depth) {
    cur = doc.nodes[cur.parentId];
    if (cur) out.push(cur);
  }
  return out.reverse();
}

export function depth(doc, id) { return ancestors(doc, id).length; }

/** [{ id, title, kind }] root first, ending with the node itself. */
export function breadcrumbs(doc, id) {
  const n = node(doc, id);
  return [...ancestors(doc, id), n].map((x) => ({ id: x.id, title: x.title, kind: x.kind }));
}

/** "Trip to Lisbon > Packing > Chargers" */
export function pathOf(doc, id, sep = ' > ') {
  return breadcrumbs(doc, id).map((b) => b.title).join(sep);
}

// ------------------------------------------------------------------------------------------------ paths

/** 'Groceries > Weekend', 'groceries / weekend', 'groceries then weekend' → ['Groceries', 'Weekend']. */
export function parsePath(path) {
  if (Array.isArray(path)) return path.map((s) => text(s, LIMITS.title).trim()).filter(Boolean);
  return text(path, 4000).split(PATH_SEP_RE).map((s) => s.trim()).filter(Boolean);
}

function matchTitle(cands, segment) {
  const want = foldTitle(segment);
  if (!want) return [];
  const exact = cands.filter((n) => foldTitle(n.title) === want);
  if (exact.length) return exact;
  const prefix = cands.filter((n) => foldTitle(n.title).startsWith(want));
  if (prefix.length) return prefix;
  return cands.filter((n) => foldTitle(n.title).includes(want));
}

/**
 * A title path → { id } | { ambiguous: [{ id, path }] } | { notFound: segment, at: id|null }.
 * An id that exists is accepted as a path of one segment. The first segment is looked up under `from` (the node the
 * user is looking at) when given, else the root; with no match there, the whole tree is searched for a unique title.
 */
export function resolvePath(doc, path, { from = null } = {}) {
  if (typeof path === 'string' && doc.nodes[path]) return { id: path };
  const segs = parsePath(path);
  if (!segs.length) return { notFound: '', at: from ?? null };
  const index = childrenIndex(doc);
  let starts = [];
  const first = segs[0];
  if (from != null && doc.nodes[String(from)]) starts = matchTitle(index.get(String(from)) ?? [], first);
  if (!starts.length) starts = matchTitle(index.get('') ?? [], first);
  if (!starts.length) starts = matchTitle(Object.values(doc.nodes), first);
  if (!starts.length) return { notFound: first, at: from ?? null };
  let frontier = starts;
  for (let i = 1; i < segs.length; i++) {
    const next = [];
    for (const n of frontier) next.push(...matchTitle(index.get(n.id) ?? [], segs[i]));
    if (!next.length) {
      const miss = { notFound: segs[i], at: frontier.length === 1 ? frontier[0].id : null };
      if (frontier.length > 1) miss.ambiguousAt = frontier.map((n) => n.id);
      return miss;
    }
    frontier = next;
  }
  if (frontier.length === 1) return { id: frontier[0].id };
  return { ambiguous: frontier.map((n) => ({ id: n.id, path: pathOf(doc, n.id), kind: n.kind })) };
}

/** A parent given as an id, a path, or null → the parent id (null = root). 404 / 409 TodoErrors otherwise. */
export function resolveParent(doc, parent, opts = {}) {
  if (parent == null || parent === '' || parent === '/') return null;
  const r = resolvePath(doc, parent, opts);
  if (r.id) return r.id;
  if (r.ambiguous) throw new TodoError('ambiguous', `"${parent}" matches ${r.ambiguous.length} nodes`, 409, { candidates: r.ambiguous });
  throw new TodoError('not-found', `No node "${r.notFound}" under ${r.at ?? 'the root'}`, 404, { notFound: r.notFound, at: r.at });
}

// ------------------------------------------------------------------------------------------------ views

/**
 * Roll-ups for every node in one post-order pass: count (descendants), checkable / checked (checkable descendants and
 * how many are done), overdue (open checkable descendants due before `today`). Map id → rollup.
 */
export function rollups(doc, { now = Date.now(), index = childrenIndex(doc) } = {}) {
  const today = dueFromMs(new Date(now).setHours(0, 0, 0, 0)).slice(0, 10);
  const out = new Map();
  const order = [];
  const stack = [...(index.get('') ?? [])];
  while (stack.length) {
    const n = stack.pop();
    order.push(n);
    const kids = index.get(n.id);
    if (kids) stack.push(...kids);
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i];
    const r = { count: 0, checkable: 0, checked: 0, overdue: 0 };
    for (const k of index.get(n.id) ?? []) {
      const kr = out.get(k.id);
      r.count += 1 + kr.count;
      r.checkable += kr.checkable + (isCheckable(k) ? 1 : 0);
      r.checked += kr.checked + (isCheckable(k) && k.done ? 1 : 0);
      r.overdue += kr.overdue + (isCheckable(k) && !k.done && k.due && k.due.slice(0, 10) < today ? 1 : 0);
    }
    out.set(n.id, r);
  }
  return out;
}

/**
 * Nested view from `root` (null = the whole tree) down to `depth` levels (null = all), each node as
 * { ...node, depth, rollup, children: [...] }. `showDone: false` hides done checkable nodes (and their subtrees).
 */
export function tree(doc, { root = null, depth: maxDepth = null, showDone = true, now = Date.now() } = {}) {
  const index = childrenIndex(doc);
  const roll = rollups(doc, { now, index });
  if (root != null) node(doc, root);
  const build = (parentId, d) => {
    if (maxDepth != null && d > maxDepth) return [];
    const out = [];
    for (const n of index.get(parentId ?? '') ?? []) {
      if (!showDone && isCheckable(n) && n.done) continue;
      out.push({ ...n, depth: d, rollup: roll.get(n.id), children: build(n.id, d + 1) });
    }
    return out;
  };
  // iterative depth guard is in load(); the view recursion is bounded by the data's actual depth
  const items = build(root, root == null ? 0 : depth(doc, root) + 1);
  return { root: root == null ? null : { ...doc.nodes[root], rollup: roll.get(root), breadcrumbs: breadcrumbs(doc, root) }, items };
}

/** What a tree view draws: nodes in display order with depth, honouring `collapsed` when asked. */
export function flat(doc, { root = null, respectCollapsed = true, showDone = true, now = Date.now() } = {}) {
  const index = childrenIndex(doc);
  const roll = rollups(doc, { now, index });
  const out = [];
  const base = root == null ? 0 : depth(doc, root) + 1;
  const stack = [...(index.get(root == null ? '' : String(root)) ?? [])].reverse().map((n) => [n, base]);
  while (stack.length) {
    const [n, d] = stack.pop();
    if (!showDone && isCheckable(n) && n.done) continue;
    const kids = index.get(n.id) ?? [];
    out.push({ ...n, depth: d, rollup: roll.get(n.id), hasChildren: kids.length > 0 });
    if (respectCollapsed && n.collapsed) continue;
    for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], d + 1]);
  }
  return out;
}

/** Nodes matching the filters wherever they sit, with their path. `due`: 'overdue' | 'today' | 'week' | 'none' | 'any'. */
export function search(doc, { q = '', kind = '', done = null, tag = '', due = '', under = null, limit = 300, now = Date.now() } = {}) {
  const ql = foldTitle(q);
  const todayMs = new Date(now).setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const scope = under == null ? null : new Set(descendants(doc, under));
  const out = [];
  for (const n of Object.values(doc.nodes)) {
    if (scope && !scope.has(n.id)) continue;
    if (kind && n.kind !== kind) continue;
    if (done != null && n.done !== done) continue;
    if (tag && !(n.tags ?? []).includes(tag.toLowerCase())) continue;
    if (ql && !(foldTitle(n.title).includes(ql) || (n.body || '').toLowerCase().includes(ql) || (n.tags ?? []).some((t) => t.includes(ql)))) continue;
    if (due && due !== 'any') {
      const ms = n.due ? dueToMs(n.due) : null;
      if (due === 'none' ? ms != null : ms == null) continue;
      if (due === 'overdue' && !(ms < todayMs && !n.done)) continue;
      if (due === 'today' && !(ms >= todayMs && ms < todayMs + day)) continue;
      if (due === 'week' && !(ms >= todayMs && ms < todayMs + 7 * day)) continue;
    }
    out.push(n);
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out.slice(0, Math.max(1, Math.min(limit, 5000))).map((n) => ({ ...n, path: pathOf(doc, n.id), depth: depth(doc, n.id) }));
}

/** Counts for the log and the status line. */
export function stats(doc) {
  const byKind = {};
  let maxDepth = 0;
  let done = 0;
  for (const n of Object.values(doc.nodes)) {
    byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
    if (isCheckable(n) && n.done) done++;
    const d = depth(doc, n.id);
    if (d > maxDepth) maxDepth = d;
  }
  return { nodes: Object.keys(doc.nodes).length, byKind, done, maxDepth, trash: doc.trash.length, ops: doc.ops.length, seq: doc.seq };
}

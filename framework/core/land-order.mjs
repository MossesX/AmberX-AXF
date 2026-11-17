/**
 * Land order (land-order@1). Brett, Nov 17 2026: "I want to reorder the order that they're gonna be merged in." The
 * auto-lander lands finished builds / PRs one at a time (landing-line@1); which one goes next was the line's own order,
 * closest-to-main first. This record is the one order the lander follows: Brett drags rows in the Auto-lander tab (or
 * says it, or calls it) and the lander takes the first one that is not blocked. Pure: no IO, no git, no model.
 *
 * Record (the `order` block of lander-state@1):
 *   { $axf: 'land-order@1', rev, source: default | brett, updatedAt, updatedBy, items: [{ id, pr, build, behind? }], migratedFrom? }
 *   id       the landing-line entry id: `pr-<n>` when the PR exists, else `build-<id>` (landing-line.mjs entryId)
 *   pr       the PR number, 0 while there is none yet
 *   build    the build id ('' for a PR that has no build)
 *   behind   commits the branch is behind main when known (the default sort key: closest-to-main first)
 *   source   default = the engine's sort (behind ascending, then line position); brett = a hand set it, kept as is
 *
 * Rules the core (reconcile / move / next, below the records) keeps:
 *   default order   closest-to-main first (behind ascending); unknown behind last; ties keep the line's position
 *   new PRs         append at the bottom (never re-sorted into a hand order)
 *   merged / closed drop out; the rest keep their relative order
 *   a hand move     turns source to brett; the lander follows the list from then on
 *   next            the first item in the list that is open and not blocked / held / in another state than waiting
 */

export const ORDER_FRAME = 'land-order@1';
/** Who set the order: the engine's default sort, or a hand (Brett, through any transport). */
export const SOURCES = Object.freeze(['default', 'brett']);
/** The moves a hand can make on one or several rows. `index` takes a target position (0 = top). */
export const MOVES = Object.freeze(['top', 'up', 'down', 'bottom', 'index']);
export const ITEMS_MAX = 200;

const str = (v, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const num = (v) => (Number.isInteger(v) && v > 0 ? v : 0);
const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : '');
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** The id an item is known by: its PR number when it has one, else its build id (the same as landing-line entryId). */
export const itemId = (x) => (num(x?.pr) ? `pr-${x.pr}` : x?.build ? `build-${str(x.build, 80)}` : '');

/** An empty order: the default sort, nothing in it yet. */
export function emptyOrder(at = new Date().toISOString()) {
  return { $axf: ORDER_FRAME, rev: 0, source: 'default', updatedAt: at, updatedBy: '', items: [] };
}

/** One well-formed item, or null when it names neither a PR nor a build. */
export function normItem(x) {
  const y = obj(x);
  const pr = num(y.pr) || num(Number(String(y.pr || '').replace(/^#/, '')));
  const build = str(y.build, 80);
  const id = str(y.id, 100) || itemId({ pr, build });
  if (!id) return null;
  const out = { id, pr, build };
  if (Number.isInteger(y.behind) && y.behind >= 0) out.behind = y.behind;
  return out;
}

/** A land-order@1 record, normalised: ids unique, at most ITEMS_MAX, source and dates well-formed. */
export function normOrder(o, at = new Date().toISOString()) {
  const x = obj(o);
  const seen = new Set();
  const items = [];
  for (const it of Array.isArray(x.items) ? x.items : []) {
    const n = normItem(it);
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    items.push(n);
    if (items.length >= ITEMS_MAX) break;
  }
  const out = {
    $axf: ORDER_FRAME, rev: Number.isInteger(x.rev) && x.rev >= 0 ? x.rev : 0, source: SOURCES.includes(x.source) ? x.source : 'default',
    updatedAt: iso(x.updatedAt) || at, updatedBy: str(x.updatedBy, 80), items,
  };
  if (x.migratedFrom && typeof x.migratedFrom === 'object') out.migratedFrom = { frame: str(x.migratedFrom.frame, 40), at: iso(x.migratedFrom.at) || at };
  return out;
}

/** Errors in a land-order@1 record (empty = valid). */
export function orderErrors(o) {
  const out = [];
  const x = obj(o);
  if (x.$axf !== ORDER_FRAME) out.push(`$axf is ${ORDER_FRAME}`);
  if (!(Number.isInteger(x.rev) && x.rev >= 0)) out.push('rev is an integer ≥ 0');
  if (!SOURCES.includes(x.source)) out.push(`source is one of ${SOURCES.join(', ')}`);
  if (!iso(x.updatedAt)) out.push('updatedAt is an ISO date-time');
  if (typeof x.updatedBy !== 'string') out.push('updatedBy is a string');
  if (!Array.isArray(x.items)) out.push('items is a list');
  else {
    if (x.items.length > ITEMS_MAX) out.push(`items holds at most ${ITEMS_MAX}`);
    const ids = new Set();
    x.items.forEach((it, i) => {
      const y = obj(it);
      if (!str(y.id)) out.push(`items[${i}].id names the entry`);
      else if (ids.has(y.id)) out.push(`items[${i}].id ${y.id} appears twice`);
      ids.add(y.id);
      if (!num(y.pr) && !str(y.build)) out.push(`items[${i}] names a PR or a build`);
      if (y.behind !== undefined && !(Number.isInteger(y.behind) && y.behind >= 0)) out.push(`items[${i}].behind is an integer ≥ 0`);
    });
  }
  return out;
}

// ------------------------------------------------------------------ the core: reconcile / move / next / migrate

const changed = (a, b) => JSON.stringify(a.items) !== JSON.stringify(b.items) || a.source !== b.source;
const stamp = (o, at, by, extra = {}) => ({ ...o, ...extra, rev: (o.rev || 0) + 1, updatedAt: at, updatedBy: str(by, 80) });
const BEHIND_UNKNOWN = Number.MAX_SAFE_INTEGER;

/** The ids a hand may name a row by: 'pr-5', 5, '5', '#5', a build id, 'build-<id>'. Returns the item or null. */
export function findItem(order, ref) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (ref && typeof ref === 'object') return items.find((it) => it.id === normItem(ref)?.id) || null;
  const s = str(String(ref ?? ''), 100);
  const n = num(Number(s.replace(/^#/, '')));
  return items.find((it) => it.id === s || (n && it.pr === n) || (s && it.build === s) || it.id === `build-${s}`) || null;
}

/**
 * The default sort: closest to main first (`behind` ascending), items with no `behind` last, ties keep their place.
 * Pure on a list of items.
 */
export function defaultSort(items) {
  return items.map((it, i) => ({ it, i })).sort((a, b) => ((a.it.behind ?? BEHIND_UNKNOWN) - (b.it.behind ?? BEHIND_UNKNOWN)) || a.i - b.i).map((x) => x.it);
}

/**
 * Bring the order in line with what is open now. `open` is the list of open entries (landing-line entries, PR
 * snapshots, or plain { pr, build, behind }): kept items keep their order (and take the fresh `behind`), entries the
 * order does not know append at the bottom in the given sequence, items that are no longer open drop out. While
 * `source` is `default` the result is re-sorted (closest-to-main first); Brett's order is never re-sorted. Returns the
 * same record when nothing changed, else a new one with `rev` + 1.
 */
export function reconcile(order, open, { at = new Date().toISOString(), by = '' } = {}) {
  const o = normOrder(order, at);
  const fresh = new Map();
  for (const e of Array.isArray(open) ? open : []) { const n = normItem(e); if (n && !fresh.has(n.id)) fresh.set(n.id, n); }
  const kept = o.items.filter((it) => fresh.has(it.id)).map((it) => ({ ...it, ...fresh.get(it.id), id: it.id }));
  const known = new Set(kept.map((it) => it.id));
  const added = [...fresh.values()].filter((it) => !known.has(it.id));
  let items = [...kept, ...added].slice(0, ITEMS_MAX);
  if (o.source === 'default') items = defaultSort(items);
  const out = { ...o, items };
  return changed(o, out) ? stamp(out, at, by) : o;
}

/**
 * Move one or several rows (`ids`: an id, a PR number, a build id, or a list of them) to `to`: 'top' | 'up' | 'down' |
 * 'bottom' | 'index' (with `index`, 0 = top) or a number (an index). The selected rows move together in their current
 * relative order; `up` / `down` move the block one place past the next unselected row. The entry in flight (`inFlight`,
 * an id) keeps the top: nothing moves ahead of what is being landed right now. Sets `source: brett` and bumps `rev`;
 * a move that changes nothing returns the record as it was. Throws on an unknown row or place.
 */
export function move(order, ids, to, { index, by = 'brett', at = new Date().toISOString(), inFlight = '' } = {}) {
  const o = normOrder(order, at);
  const refs = (Array.isArray(ids) ? ids : [ids]).filter((r) => r !== undefined && r !== null && r !== '');
  if (!refs.length) throw new Error('name at least one row to move');
  const selected = new Set();
  for (const r of refs) { const it = findItem(o, r); if (!it) throw new Error(`no row ${typeof r === 'object' ? JSON.stringify(r) : r} in the order`); selected.add(it.id); }
  let place = to; let at0 = index;
  if (Number.isInteger(to)) { place = 'index'; at0 = to; }
  if (!MOVES.includes(place)) throw new Error(`to is one of ${MOVES.join(', ')} or an index (0 = top)`);
  if (place === 'index' && !(Number.isInteger(at0) && at0 >= 0)) throw new Error('index is an integer, 0 = top');
  const pinned = inFlight ? findItem(o, inFlight) : null;
  const all = o.items.filter((it) => it !== pinned);
  const block = all.filter((it) => selected.has(it.id));
  const rest = all.filter((it) => !selected.has(it.id));
  if (!block.length) return o; // only the one in flight was named: it keeps the top
  const first = all.findIndex((it) => selected.has(it.id));
  const where = place === 'top' ? 0 : place === 'bottom' ? rest.length : place === 'up' ? Math.max(0, first - 1) : place === 'down' ? Math.min(rest.length, first + 1) : Math.min(at0, rest.length);
  const items = [...(pinned ? [pinned] : []), ...rest.slice(0, where), ...block, ...rest.slice(where)];
  const out = { ...o, items, source: 'brett' };
  return changed(o, out) ? stamp(out, at, by) : o;
}

/**
 * Set the whole order at once: the named rows (ids, PR numbers or build ids) top first in the given sequence, rows left
 * out after them in their current order; the entry in flight keeps the top. Sets `source: brett`. Throws on an unknown
 * row; a list that changes nothing returns the record as it was.
 */
export function setOrder(order, ids, { by = 'brett', at = new Date().toISOString(), inFlight = '' } = {}) {
  const o = normOrder(order, at);
  const named = [];
  const seen = new Set();
  for (const r of Array.isArray(ids) ? ids : [ids]) { const it = findItem(o, r); if (!it) throw new Error(`no row ${typeof r === 'object' ? JSON.stringify(r) : r} in the order`); if (!seen.has(it.id)) { seen.add(it.id); named.push(it); } }
  const pinned = inFlight ? findItem(o, inFlight) : null;
  const rest = o.items.filter((it) => !seen.has(it.id) && it !== pinned);
  const items = [...(pinned ? [pinned] : []), ...named.filter((it) => it !== pinned), ...rest];
  const out = { ...o, items, source: 'brett' };
  return changed(o, out) ? stamp(out, at, by) : o;
}

/** Back to the default order: `source: default`, rev + 1; the next reconcile re-sorts the rows. */
export function reset(order, { by = 'brett', at = new Date().toISOString() } = {}) {
  const o = normOrder(order, at);
  if (o.source === 'default') return o;
  return stamp({ ...o, source: 'default' }, at, by);
}

/** The states that hold the one landing slot (landing-line@1 IN_FLIGHT): while an entry is in one, nothing starts. */
const IN_FLIGHT = Object.freeze(['merging-main', 'regenerating', 'checking', 'landing']);

/** An entry is ready when it is waiting (or has no state), is not held or blocked, and is not paused / red / skipped. */
export const isReady = (e) => !!e && !e.blocked && !e.hold && !e.held && (!e.state || e.state === 'waiting');

/**
 * The entry the lander should take now, or null: the first row of the order whose entry is ready; entries the order
 * does not know yet come after the listed ones, in the given sequence. Null while one entry is in flight (the line's
 * one-at-a-time rule) or when nothing is ready. `ready` is the list of open entries (landing-line entries or PR
 * snapshots with `state` / `hold` / `blocked`); `isReady` is the default test, `opts.test` replaces it.
 */
export function next(order, ready, { test = isReady, inFlight = '' } = {}) {
  const entries = Array.isArray(ready) ? ready : [];
  const byId = new Map();
  for (const e of entries) { const n = normItem(e); if (n && !byId.has(n.id)) byId.set(n.id, e); }
  if (inFlight || entries.some((e) => IN_FLIGHT.includes(e?.state))) return null;
  for (const it of sortBy(order, [...byId.values()])) if (test(it)) return it;
  return null;
}

/**
 * Any list of entries (waiting rows, line entries, snapshots) in the order's sequence: listed ones first in order,
 * unknown ones after in their given sequence. `idOf` maps an entry to its id (default: pr / build / id as normItem).
 */
export function sortBy(order, list, idOf = (e) => normItem(e)?.id || '') {
  const pos = new Map((Array.isArray(order?.items) ? order.items : []).map((it, i) => [it.id, i]));
  const n = pos.size;
  return (Array.isArray(list) ? list : []).map((e, i) => ({ e, k: pos.has(idOf(e)) ? pos.get(idOf(e)) : n + i })).sort((a, b) => a.k - b.k).map((x) => x.e);
}

/**
 * The first order, from what the lander had before this contract. A landing line (`line`, landing-line@1) gives its
 * entries in line order; a merge queue (`queue` merge-queue@1 + `control` merge-queue-control@1) gives the control
 * document's manual order first, then the queue's items and its held `waiting` list. `source` is `brett` only when the
 * control document carried a manual order (then `updatedBy: migration`), else `default`. Idempotent: the same input
 * gives the same record.
 */
export function migrate({ line = null, queue = null, control = null } = {}, { at = new Date().toISOString() } = {}) {
  const items = [];
  const seen = new Set();
  const push = (x) => { const n = normItem(x); if (n && !seen.has(n.id)) { seen.add(n.id); items.push(n); } };
  let frame = ''; let manual = false;
  if (line && typeof line === 'object' && Array.isArray(line.entries)) {
    frame = 'landing-line@1';
    for (const e of line.entries) push({ pr: e.pr, build: e.build });
  } else if ((queue && typeof queue === 'object') || (control && typeof control === 'object')) {
    frame = 'merge-queue@1';
    const q = obj(queue); const c = obj(control);
    const all = [...(Array.isArray(q.items) ? q.items : []), ...(Array.isArray(q.waiting) ? q.waiting : [])];
    const byPr = new Map(all.filter((x) => num(x?.pr)).map((x) => [x.pr, x]));
    const order = (Array.isArray(c.order) ? c.order : []).map((p) => num(Number(p))).filter(Boolean);
    manual = order.length > 0;
    for (const p of order) if (byPr.has(p)) push({ pr: p, build: byPr.get(p).build });
    for (const x of all) push({ pr: x.pr, build: x.build });
  }
  const out = { ...emptyOrder(at), rev: 1, items: items.slice(0, ITEMS_MAX), source: manual ? 'brett' : 'default', updatedBy: manual ? 'migration' : '' };
  if (frame) out.migratedFrom = { frame, at };
  return out;
}

/** The commands, declared once: the CLI, the REST routes, MCP (plugin-commands@1) and voice say the same words. */
export const ORDER_COMMANDS = Object.freeze([
  { id: 'lander-order', method: 'GET', path: '/lander/order', cli: 'order', title: 'Land order: the order', description: 'The order the auto-lander lands finished builds / PRs in: top lands first; default = closest to main first, or the order Brett set.', effect: 'read' },
  { id: 'lander-order-move', method: 'POST', path: '/lander/order/move', cli: 'move', title: 'Land order: move rows', description: 'Move one or several rows to the top, up one, down one, to the bottom or to an index (0 = top). Nothing moves ahead of the one being landed right now. Sets the order to Brett\'s.', effect: 'write', input: { ids: 'PR numbers or build ids, one or several', to: 'top | up | down | bottom | index', index: 'the index when to = index' } },
  { id: 'lander-order-set', method: 'PUT', path: '/lander/order', cli: 'order set', title: 'Land order: set the whole order', description: 'Set the whole order at once (every open PR, top first). Rows left out keep their place after the named ones.', effect: 'write', input: { ids: 'PR numbers or build ids, top first' } },
  { id: 'lander-order-reset', method: 'POST', path: '/lander/order/reset', cli: 'order reset', title: 'Land order: back to default', description: 'Back to the default order (closest to main first). Confirms first.', effect: 'confirm' },
]);

/** The JSON Schema of the block (written as schemas/json/land-order.schema.json and embedded in lander-state@1). */
export function jsonSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://amberx.ai/axf/schemas/land-order.schema.json', title: `${ORDER_FRAME} (gate-rules@1)`,
    description: 'The order the auto-lander lands finished builds / PRs in. default = closest-to-main first; brett = a hand set it and it is kept as is. New PRs append at the bottom, merged / closed ones drop out.',
    type: 'object', required: ['$axf', 'rev', 'source', 'updatedAt', 'items'], additionalProperties: true,
    properties: {
      $axf: { const: ORDER_FRAME }, rev: { type: 'integer', minimum: 0, description: '+1 on every change, by hand or by reconcile' },
      source: { enum: [...SOURCES], description: "default = the engine's sort (behind main ascending, then line position); brett = a hand set it" },
      updatedAt: { type: 'string', format: 'date-time' }, updatedBy: { type: 'string', maxLength: 80, description: 'who last changed it: brett, a session name, or empty for the engine' },
      items: {
        type: 'array', maxItems: ITEMS_MAX, description: 'top = lands first; ids unique',
        items: {
          type: 'object', required: ['id', 'pr', 'build'], properties: {
            id: { type: 'string', maxLength: 100, description: 'pr-<n> when the PR exists, else build-<id> (landing-line@1 entry id)' },
            pr: { type: 'integer', minimum: 0, description: 'the PR number, 0 while there is none yet' }, build: { type: 'string', maxLength: 80 },
            behind: { type: 'integer', minimum: 0, description: 'commits behind main when known: the default sort key' },
          },
        },
      },
      migratedFrom: { type: 'object', properties: { frame: { enum: ['merge-queue@1', 'landing-line@1'] }, at: { type: 'string', format: 'date-time' } }, description: 'set once when the order was first built from the merge queue or the landing line' },
    },
  };
}

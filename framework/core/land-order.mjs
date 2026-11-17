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

#!/usr/bin/env node
/**
 * todo-tree@1 engine tests: `node apps/console-web/plugins/todo-manager/test/tree.test.mjs`.
 * Depth-50 nesting, every kind inside every kind, cycle moves refused, duplicate, delete + undo, path resolution,
 * export, order keys, load repair, cascade rule, reorder, bulk, stale undo; every document the engine produces is
 * checked against schema/todo-tree.json by the small validator below (it implements exactly the keywords the schema
 * uses and refuses any other, so a keyword added later can never be skipped silently).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '../core/todo-tree.mjs';
import * as X from '../core/export.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, '../schema/todo-tree.json'), 'utf8'));

// ------------------------------------------------------------------ a small JSON Schema 2020-12 validator
const KNOWN = new Set(['$schema', '$id', 'title', 'description', 'type', 'const', 'enum', 'pattern', 'minLength', 'maxLength', 'minimum', 'maxItems', 'minItems', 'required', 'properties', 'additionalProperties', 'oneOf', '$ref', 'items', '$defs']);
function resolve(ref) {
  assert.ok(ref.startsWith('#/'), `only local refs: ${ref}`);
  return ref.slice(2).split('/').reduce((o, k) => o[k], schema);
}
function check(value, sch, path, errors) {
  for (const k of Object.keys(sch)) assert.ok(KNOWN.has(k), `schema keyword ${k} at ${path} is not implemented by this test`);
  if (sch.$ref) return check(value, resolve(sch.$ref), path, errors);
  if (sch.oneOf) {
    const hits = sch.oneOf.filter((s) => { const e = []; check(value, s, path, e); return e.length === 0; }).length;
    if (hits !== 1) errors.push(`${path}: matches ${hits} of oneOf`);
    return;
  }
  if (sch.const !== undefined && value !== sch.const) errors.push(`${path}: expected ${JSON.stringify(sch.const)}`);
  if (sch.enum && !sch.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
  if (sch.type) {
    const t = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' && Number.isInteger(value) && sch.type === 'integer' ? 'integer' : typeof value;
    if (t !== sch.type) { errors.push(`${path}: expected ${sch.type}, got ${t}`); return; }
  }
  if (typeof value === 'string') {
    if (sch.pattern && !new RegExp(sch.pattern).test(value)) errors.push(`${path}: "${value.slice(0, 30)}" fails ${sch.pattern}`);
    if (sch.minLength != null && value.length < sch.minLength) errors.push(`${path}: too short`);
    if (sch.maxLength != null && value.length > sch.maxLength) errors.push(`${path}: too long`);
  }
  if (typeof value === 'number' && sch.minimum != null && value < sch.minimum) errors.push(`${path}: below minimum`);
  if (Array.isArray(value)) {
    if (sch.maxItems != null && value.length > sch.maxItems) errors.push(`${path}: too many items`);
    if (sch.minItems != null && value.length < sch.minItems) errors.push(`${path}: too few items`);
    if (sch.items) value.forEach((v, i) => check(v, sch.items, `${path}[${i}]`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const r of sch.required ?? []) if (!(r in value)) errors.push(`${path}: missing ${r}`);
    for (const [k, v] of Object.entries(value)) {
      if (sch.properties && k in sch.properties) check(v, sch.properties[k], `${path}.${k}`, errors);
      else if (sch.additionalProperties === false) errors.push(`${path}: unknown property ${k}`);
      else if (sch.additionalProperties && typeof sch.additionalProperties === 'object') check(v, sch.additionalProperties, `${path}.${k}`, errors);
    }
  }
}
function conforms(doc, label) {
  const errors = [];
  check(JSON.parse(JSON.stringify(doc)), schema, '$', errors);
  assert.deepEqual(errors, [], `${label}: schema errors`);
  const v = T.validate(doc);
  assert.deepEqual(v.errors, [], `${label}: validate errors`);
}

// ------------------------------------------------------------------ runner
let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}
const ctx = { now: 1_700_000_000_000, by: 'test' };
const C = (doc, input) => T.create(doc, input, ctx);

/** A mixed tree: note > list > todo > note > list > todo … 50 deep, plus the Lisbon sample. */
function sample() {
  let doc = T.emptyDoc('amberx-axf', ctx.now);
  let r;
  const ids = {};
  r = C(doc, { kind: 'note', title: 'Trip to Lisbon', body: 'Flights booked' }); doc = r.doc; ids.trip = r.node.id;
  r = C(doc, { kind: 'list', title: 'Packing', parent: ids.trip }); doc = r.doc; ids.packing = r.node.id;
  r = C(doc, { kind: 'todo', title: 'Passport', parentId: ids.packing, done: true }); doc = r.doc; ids.passport = r.node.id;
  r = C(doc, { kind: 'todo', title: 'Chargers', parentId: ids.packing }); doc = r.doc; ids.chargers = r.node.id;
  r = C(doc, { kind: 'note', title: 'Which cables', parentId: ids.chargers, body: 'USB-C x2' }); doc = r.doc; ids.cables = r.node.id;
  r = C(doc, { kind: 'list', title: 'Inside the note', parentId: ids.cables }); doc = r.doc; ids.deepList = r.node.id;
  r = C(doc, { kind: 'todo', title: 'Pena palace', parentId: ids.deepList }); doc = r.doc; ids.pena = r.node.id;
  r = C(doc, { kind: 'task', title: 'Bookings', parent: ids.trip, due: '2026-11-20', priority: 'high', status: 'doing', tags: ['Travel', 'travel'] }); doc = r.doc; ids.bookings = r.node.id;
  r = C(doc, { kind: 'list', title: 'Groceries' }); doc = r.doc; ids.groceries = r.node.id;
  r = C(doc, { kind: 'list', title: 'Weekend', parent: 'Groceries' }); doc = r.doc; ids.weekend = r.node.id;
  r = C(doc, { kind: 'todo', title: 'Milk', parent: 'Groceries > Weekend' }); doc = r.doc; ids.milk = r.node.id;
  r = C(doc, { kind: 'todo', title: 'Milk', parent: 'Groceries' }); doc = r.doc; ids.milk2 = r.node.id;
  return { doc, ids };
}

// ------------------------------------------------------------------ order keys
test('order keys: append stays short and sorted', () => {
  const keys = T.orderKeys(5000);
  assert.equal(keys[0], 'a0');
  assert.ok(keys.every((k, i) => i === 0 || keys[i - 1] < k));
  assert.ok(Math.max(...keys.map((k) => k.length)) <= 4);
});
test('order keys: between, before the first, after the last', () => {
  const mid = T.orderBetween('a0', 'a1');
  assert.ok(mid > 'a0' && mid < 'a1');
  let b = null;
  const sq = [];
  for (let i = 0; i < 60; i++) { b = T.orderBetween('a0', b); sq.push(b); }
  assert.ok(sq.every((k, i) => k > 'a0' && (i === 0 || k < sq[i - 1])));
  let p = null;
  const pre = [];
  for (let i = 0; i < 300; i++) { p = T.orderBetween(null, p); pre.push(p); }
  assert.ok(pre.every((k, i) => i === 0 || k < pre[i - 1]));
  assert.throws(() => T.orderBetween('a1', 'a0'), /out of order/);
  assert.throws(() => T.orderBetween('a0', 'bad key'), /Not an order key/);
});

// ------------------------------------------------------------------ depth and kinds
test('depth 50 nesting: every kind inside every kind, paths and breadcrumbs hold', () => {
  let doc = T.emptyDoc('', ctx.now);
  const kinds = ['list', 'note', 'todo', 'task'];
  let parent = null;
  const chain = [];
  for (let d = 0; d < 50; d++) {
    const r = C(doc, { kind: kinds[d % 4], title: `L${d}`, parentId: parent });
    doc = r.doc; parent = r.node.id; chain.push(parent);
  }
  assert.equal(T.depth(doc, chain[49]), 49);
  assert.equal(T.ancestors(doc, chain[49]).length, 49);
  assert.equal(T.breadcrumbs(doc, chain[49]).map((b) => b.title).join('>'), chain.map((_, i) => `L${i}`).join('>'));
  assert.equal(T.descendants(doc, chain[0]).length, 49);
  assert.equal(T.resolvePath(doc, chain.map((_, i) => `L${i}`).join(' > ')).id, chain[49]);
  assert.equal(T.flat(doc).at(-1).depth, 49);
  assert.equal(T.tree(doc).items[0].rollup.count, 49);
  assert.equal(T.stats(doc).maxDepth, 49);
  const md = X.toMarkdown(doc);
  assert.ok(md.includes('L49'));
  conforms(doc, 'depth 50');
});
test('every kind holds every kind directly', () => {
  let doc = T.emptyDoc('', ctx.now);
  for (const outer of T.KINDS) {
    const o = C(doc, { kind: outer, title: `outer ${outer}` }); doc = o.doc;
    for (const inner of T.KINDS) {
      const i = C(doc, { kind: inner, title: `${inner} in ${outer}`, parentId: o.node.id }); doc = i.doc;
      assert.equal(T.node(doc, i.node.id).parentId, o.node.id);
    }
    assert.equal(T.children(doc, o.node.id).length, 4);
  }
  assert.equal(Object.keys(doc.nodes).length, 20);
  conforms(doc, 'kinds');
});
test('an unknown kind is kept (open slot) and treated like a note', () => {
  let doc = T.emptyDoc('', ctx.now);
  const r = C(doc, { kind: 'idea', title: 'Later kind' }); doc = r.doc;
  assert.equal(r.node.kind, 'idea');
  assert.equal(T.isCheckable(r.node), false);
  assert.deepEqual(T.validate(doc).errors, []);
  assert.ok(T.validate(doc).warnings[0].includes('idea'));
  conforms(doc, 'unknown kind');
});

// ------------------------------------------------------------------ load / repair
test('load repairs orphans, cycles, missing and duplicate order keys, done/status', () => {
  const mk = (id, parentId, extra = {}) => ({ id, kind: 'todo', parentId, order: 'a0', title: id, done: false, collapsed: false, createdAt: 1, updatedAt: 1, ...extra });
  const { doc, warnings } = T.load({ $axf: 'todo-tree@1', nodes: { a: mk('a', null), b: mk('b', 'a'), c: mk('c', 'a', { status: 'done', done: undefined }), d: mk('d', 'zzz'), e: mk('e', 'f'), f: mk('f', 'e'), g: { id: 'g', kind: 'note', parentId: null, title: 'no order' } } });
  assert.deepEqual(T.validate(doc).errors, []);
  assert.equal(doc.nodes.d.parentId, null);
  assert.ok(doc.nodes.e.parentId === null || doc.nodes.f.parentId === null);
  assert.equal(doc.nodes.c.done, true);
  assert.equal(doc.nodes.c.status, 'done');
  assert.notEqual(doc.nodes.b.order, doc.nodes.c.order);
  assert.ok(warnings.some((w) => w.includes('loop')) && warnings.some((w) => w.includes('missing')));
  assert.equal(T.load(JSON.stringify(doc)).warnings.length, 0, 'a repaired document loads clean');
  conforms(doc, 'repaired');
});
test('load refuses a todo-store@1 file', () => {
  assert.throws(() => T.load({ $axf: 'todo-store@1', lists: [], entries: [] }), (e) => e.code === 'needs-migration' && e.status === 409);
});
test('validate finds what load would repair', () => {
  const v = T.validate({ $axf: 'todo-tree@1', nodes: { a: { id: 'a', kind: 'todo', parentId: 'nope', order: 'a0', title: 'x', done: true, status: 'open', collapsed: false, createdAt: 1, updatedAt: 1 } } });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('missing')) && v.errors.some((e) => e.includes('disagree')));
});

// ------------------------------------------------------------------ paths
test('path resolution: exact, prefix, contains, ambiguity, not found, from', () => {
  const { doc, ids } = sample();
  assert.equal(T.resolvePath(doc, 'Groceries > Weekend > Milk').id, ids.milk);
  assert.equal(T.resolvePath(doc, 'groceries / week / mil').id, ids.milk);
  assert.equal(T.resolvePath(doc, 'trip then packing then charg').id, ids.chargers);
  assert.equal(T.resolvePath(doc, 'Weekend').id, ids.weekend, 'a unique title anywhere');
  const amb = T.resolvePath(doc, 'Milk');
  assert.equal(amb.ambiguous?.length, 2);
  assert.equal(T.resolvePath(doc, 'Milk', { from: ids.weekend }).id, ids.milk, 'from the node in view');
  assert.deepEqual(T.resolvePath(doc, 'Groceries > Nope'), { notFound: 'Nope', at: ids.groceries });
  assert.equal(T.resolvePath(doc, ids.pena).id, ids.pena, 'an id is a path of one');
  assert.equal(T.pathOf(doc, ids.pena), 'Trip to Lisbon > Packing > Chargers > Which cables > Inside the note > Pena palace');
  assert.throws(() => T.resolveParent(doc, 'Milk'), (e) => e.code === 'ambiguous' && e.candidates.length === 2);
  assert.throws(() => T.resolveParent(doc, 'Nowhere'), (e) => e.status === 404);
  assert.equal(T.resolveParent(doc, null), null);
});

// ------------------------------------------------------------------ operations
test('create: placement before / after, defaults, title fallback, limits', () => {
  let { doc, ids } = sample();
  let r = C(doc, { kind: 'todo', title: 'First', parentId: ids.packing, before: ids.passport }); doc = r.doc;
  assert.equal(T.children(doc, ids.packing)[0].id, r.node.id);
  r = C(doc, { kind: 'todo', title: 'Between', parentId: ids.packing, after: ids.passport }); doc = r.doc;
  assert.deepEqual(T.children(doc, ids.packing).map((n) => n.title), ['First', 'Passport', 'Between', 'Chargers']);
  r = C(doc, { parentId: ids.packing }); doc = r.doc;
  assert.equal(r.node.kind, 'todo');
  assert.equal(r.node.title, 'Untitled todo');
  assert.equal(r.node.priority, 'normal');
  assert.equal(r.node.status, 'open');
  assert.deepEqual(T.node(doc, ids.bookings).tags, ['travel']);
  assert.throws(() => C(doc, { title: 'x', parentId: 'missing' }), (e) => e.status === 404);
  assert.throws(() => C(doc, { title: 'x', parentId: ids.packing, before: ids.milk }), (e) => e.code === 'bad-sibling');
  conforms(doc, 'create');
});
test('rename and edit keep the rules; a kind change keeps every field', () => {
  let { doc, ids } = sample();
  doc = T.rename(doc, ids.passport, '  Passports  ', ctx).doc;
  assert.equal(T.node(doc, ids.passport).title, 'Passports');
  assert.throws(() => T.rename(doc, ids.passport, '   ', ctx), (e) => e.code === 'empty-title');
  let r = T.edit(doc, ids.bookings, { status: 'done' }, ctx); doc = r.doc;
  assert.equal(r.node.done, true); assert.equal(r.node.doneAt, ctx.now);
  r = T.edit(doc, ids.bookings, { done: false }, ctx); doc = r.doc;
  assert.equal(r.node.status, 'open'); assert.equal(r.node.doneAt, null);
  r = T.edit(doc, ids.bookings, { status: 'blocked' }, ctx); doc = r.doc;
  assert.equal(r.node.status, 'blocked'); assert.equal(r.node.done, false);
  r = T.edit(doc, ids.bookings, { kind: 'note', body: 'b', due: '2026-12-01T09:30', tags: 'x, y,X' }, ctx); doc = r.doc;
  assert.equal(r.node.kind, 'note'); assert.equal(r.node.due, '2026-12-01T09:30'); assert.equal(r.node.priority, 'high'); assert.deepEqual(r.node.tags, ['x', 'y']);
  r = T.edit(doc, ids.bookings, { due: 'garbage', parentId: 'zzz', id: 'hack' }, ctx); doc = r.doc;
  assert.equal(r.node.due, null); assert.equal(r.node.parentId, ids.trip); assert.equal(r.node.id, ids.bookings);
  conforms(doc, 'edit');
});
test('move: whole subtree, cycles refused, into itself refused, placement', () => {
  let { doc, ids } = sample();
  assert.throws(() => T.move(doc, ids.packing, { parentId: ids.deepList }, ctx), (e) => e.code === 'cycle' && e.status === 409);
  assert.throws(() => T.move(doc, ids.packing, { parentId: ids.packing }, ctx), (e) => e.code === 'cycle');
  assert.throws(() => T.move(doc, ids.trip, { parentId: ids.pena }, ctx), (e) => e.code === 'cycle');
  let r = T.move(doc, ids.cables, { parent: 'Groceries' }, ctx); doc = r.doc;
  assert.equal(T.pathOf(doc, ids.pena), 'Groceries > Which cables > Inside the note > Pena palace');
  r = T.move(doc, ids.cables, { parentId: null, before: ids.trip }, ctx); doc = r.doc;
  assert.equal(T.children(doc, null)[0].id, ids.cables);
  r = T.move(doc, ids.cables, { parentId: ids.chargers }, ctx); doc = r.doc;
  assert.equal(T.node(doc, ids.cables).parentId, ids.chargers);
  conforms(doc, 'move');
});
test('reorder and renumber', () => {
  let { doc, ids } = sample();
  let r = T.reorder(doc, ids.packing, [ids.chargers], ctx); doc = r.doc;
  assert.deepEqual(T.children(doc, ids.packing).map((n) => n.id), [ids.chargers, ids.passport]);
  assert.throws(() => T.reorder(doc, ids.packing, [ids.milk], ctx), (e) => e.code === 'bad-sibling');
  r = T.renumber(doc, ids.packing, ctx); doc = r.doc;
  assert.deepEqual(T.children(doc, ids.packing).map((n) => n.order), ['a0', 'a1']);
  conforms(doc, 'reorder');
});
test('duplicate: new ids for the whole subtree, placed after the original', () => {
  let { doc, ids } = sample();
  const before = Object.keys(doc.nodes).length;
  const r = T.duplicate(doc, ids.packing, {}, ctx); doc = r.doc;
  assert.equal(r.node.title, 'Packing (copy)');
  assert.equal(r.ids.length, 6);
  assert.equal(Object.keys(doc.nodes).length, before + 6);
  assert.ok(r.ids.every((id) => !Object.values(ids).includes(id)));
  const kids = T.children(doc, ids.trip).map((n) => n.id);
  assert.equal(kids[kids.indexOf(ids.packing) + 1], r.node.id);
  assert.equal(T.descendants(doc, r.node.id).length, 5);
  assert.equal(T.node(doc, T.children(doc, r.node.id)[0].id).done, true, 'done kept');
  const r2 = T.duplicate(doc, ids.milk, { parent: 'Trip to Lisbon' }, ctx);
  assert.equal(r2.node.parentId, ids.trip);
  conforms(doc, 'duplicate');
});
test('complete: cascade none / down / up / both', () => {
  let { doc, ids } = sample();
  let r = T.complete(doc, ids.packing, true, { ...ctx, cascade: 'down' }); doc = r.doc;
  assert.ok(T.node(doc, ids.chargers).done && T.node(doc, ids.pena).done);
  assert.equal(T.node(doc, ids.cables).done, false, 'notes are not ticked by a cascade');
  assert.equal(r.changed.length, 3);
  r = T.complete(doc, ids.chargers, false, { ...ctx, cascade: 'none' }); doc = r.doc;
  assert.equal(T.node(doc, ids.pena).done, true, 'none leaves descendants alone');
  let t = C(doc, { kind: 'task', title: 'Parent' }); doc = t.doc; const parent = t.node.id;
  t = C(doc, { kind: 'task', title: 'C1', parentId: parent }); doc = t.doc; const c1 = t.node.id;
  t = C(doc, { kind: 'task', title: 'C2', parentId: parent }); doc = t.doc; const c2 = t.node.id;
  doc = T.complete(doc, c1, true, { ...ctx, cascade: 'up' }).doc;
  assert.equal(T.node(doc, parent).done, false);
  doc = T.complete(doc, c2, true, { ...ctx, cascade: 'up' }).doc;
  assert.equal(T.node(doc, parent).done, true, 'all children done → parent done');
  doc = T.complete(doc, c2, false, { ...ctx, cascade: 'up' }).doc;
  assert.equal(T.node(doc, parent).done, false, 'a child reopened → parent reopened');
  doc = T.complete(doc, parent, true, { ...ctx, cascade: 'both' }).doc;
  assert.ok(T.node(doc, c2).done);
  assert.equal(T.rollups(doc).get(parent).checked, 2);
  conforms(doc, 'complete');
});
test('delete to the trash, restore, restore with the parent gone, undo by token', () => {
  let { doc, ids } = sample();
  const before = Object.keys(doc.nodes).length;
  let r = T.deleteNode(doc, ids.packing, ctx); doc = r.doc;
  assert.equal(r.count, 6); assert.equal(Object.keys(doc.nodes).length, before - 6);
  assert.equal(T.trashList(doc)[0].title, 'Packing');
  assert.throws(() => T.node(doc, ids.pena), (e) => e.status === 404);
  const token = r.token;
  r = T.restore(doc, token, ctx); doc = r.doc;
  assert.equal(Object.keys(doc.nodes).length, before); assert.equal(doc.trash.length, 0);
  assert.equal(T.pathOf(doc, ids.pena), 'Trip to Lisbon > Packing > Chargers > Which cables > Inside the note > Pena palace');
  assert.throws(() => T.restore(doc, token), (e) => e.code === 'unknown-token' && e.status === 404);
  r = T.deleteNode(doc, ids.cables, ctx); doc = r.doc; const t2 = r.token;
  doc = T.deleteNode(doc, ids.chargers, ctx).doc;
  r = T.restore(doc, t2, ctx); doc = r.doc;
  assert.equal(r.restored[0].movedToRoot, true); assert.equal(T.node(doc, ids.cables).parentId, null);
  r = T.deleteNode(doc, ids.groceries, ctx); doc = r.doc;
  r = T.undo(doc, r.token, ctx); doc = r.doc;
  assert.ok(T.node(doc, ids.milk)); assert.equal(doc.trash.filter((t) => t.token === r.undone.token).length, 0, 'undoing a delete drops its trash entry');
  conforms(doc, 'delete');
});
test('undo is generic: rename, cascade, move; redo by undoing the undo; stale refused', () => {
  let { doc, ids } = sample();
  let r = T.rename(doc, ids.passport, 'Passports', ctx); doc = r.doc;
  doc = T.undo(doc, null, ctx).doc;
  assert.equal(T.node(doc, ids.passport).title, 'Passport');
  doc = T.undo(doc, null, ctx).doc;
  assert.equal(T.node(doc, ids.passport).title, 'Passports', 'redo');
  r = T.complete(doc, ids.trip, true, { ...ctx, cascade: 'down' }); doc = r.doc;
  assert.equal(r.changed.length, 4, 'trip, chargers, pena, bookings (passport was done already)');
  doc = T.undo(doc, null, ctx).doc;
  assert.equal(Object.values(doc.nodes).filter((n) => n.done).length, 1, 'one undo reverts the whole cascade');
  r = T.move(doc, ids.cables, { parentId: null }, ctx); doc = r.doc;
  doc = T.undo(doc, r.op.token, ctx).doc;
  assert.equal(T.node(doc, ids.cables).parentId, ids.chargers);
  r = T.rename(doc, ids.bookings, 'B2', ctx); doc = r.doc; const tok = r.op.token;
  doc = T.edit(doc, ids.bookings, { body: 'later' }, { now: ctx.now + 5 }).doc;
  assert.throws(() => T.undo(doc, tok, ctx), (e) => e.code === 'stale' && e.status === 409);
  assert.equal(T.undoable(doc, tok).reason, 'stale');
  assert.throws(() => T.undo(doc, 'nope', ctx), (e) => e.status === 404);
  r = T.deleteNode(doc, ids.weekend, ctx); doc = r.doc;
  doc = T.undo(doc, null, ctx).doc; assert.ok(T.node(doc, ids.milk)); assert.equal(doc.trash.length, 0);
  doc = T.undo(doc, null, ctx).doc; assert.throws(() => T.node(doc, ids.milk)); assert.equal(doc.trash.length, 1, 'redo of a delete puts the trash entry back');
  doc = T.restore(doc, r.token, ctx).doc; assert.ok(T.node(doc, ids.milk)); assert.equal(doc.trash.length, 0);
  doc = T.undo(doc, null, ctx).doc; assert.equal(doc.trash.length, 1, 'undoing a restore re-trashes');
  r = T.emptyTrash(doc, ctx); doc = r.doc;
  assert.equal(r.count, 1); assert.equal(T.undoable(doc).reason, 'not-undoable');
  assert.ok(T.opLog(doc, { limit: 3 }).length === 3 && T.opLog(doc, { nodeId: ids.bookings }).every((o) => o.op !== 'create' || o.nodeId === ids.bookings));
  assert.equal(doc.seq, doc.ops.at(-1).seq);
  conforms(doc, 'undo');
});
test('collapse, collapseAll, flat honours it, tree hides done', () => {
  let { doc, ids } = sample();
  doc = T.collapse(doc, ids.trip, true, ctx).doc;
  assert.deepEqual(T.flat(doc).map((n) => n.title), ['Trip to Lisbon', 'Groceries', 'Weekend', 'Milk', 'Milk']);
  assert.equal(T.flat(doc, { respectCollapsed: false }).length, Object.keys(doc.nodes).length);
  let r = T.collapseAll(doc, true, ctx); doc = r.doc;
  assert.equal(T.flat(doc).length, 2);
  r = T.collapseAll(doc, false, { ...ctx, under: ids.trip }); doc = r.doc;
  assert.equal(T.node(doc, ids.groceries).collapsed, true);
  assert.equal(T.node(doc, ids.packing).collapsed, false);
  const t = T.tree(doc, { root: ids.packing, showDone: false });
  assert.deepEqual(t.items.map((n) => n.title), ['Chargers']);
  assert.equal(t.root.breadcrumbs.length, 2);
  conforms(doc, 'collapse');
});
test('bulk: roots only, one op, one token, one undo', () => {
  let { doc, ids } = sample();
  const n0 = Object.keys(doc.nodes).length;
  let r = T.bulk(doc, [ids.packing, ids.pena, ids.groceries], 'delete', {}, ctx); doc = r.doc;
  assert.equal(r.count, 2, 'pena is below packing and skipped');
  assert.equal(doc.trash.length, 2); assert.ok(doc.trash.every((t) => t.token === r.token));
  doc = T.restore(doc, r.token, ctx).doc;
  assert.equal(Object.keys(doc.nodes).length, n0);
  r = T.bulk(doc, [ids.milk, ids.milk2], 'complete', { done: true }, ctx); doc = r.doc;
  assert.ok(T.node(doc, ids.milk).done && T.node(doc, ids.milk2).done);
  doc = T.undo(doc, null, ctx).doc;
  assert.ok(!T.node(doc, ids.milk).done && !T.node(doc, ids.milk2).done);
  r = T.bulk(doc, [ids.milk, ids.weekend], 'move', { parent: 'Trip to Lisbon' }, ctx); doc = r.doc;
  assert.equal(T.node(doc, ids.weekend).parentId, ids.trip);
  assert.throws(() => T.bulk(doc, [ids.trip], 'move', { parentId: ids.pena }, ctx), (e) => e.code === 'cycle');
  assert.throws(() => T.bulk(doc, [ids.trip], 'explode', {}, ctx), (e) => e.code === 'bad-action');
  conforms(doc, 'bulk');
});
test('search: text, kind, done, tag, due, under', () => {
  const { doc, ids } = sample();
  assert.equal(T.search(doc, { q: 'milk' }).length, 2);
  assert.equal(T.search(doc, { q: 'milk', under: ids.weekend }).length, 1);
  assert.equal(T.search(doc, { kind: 'list' }).length, 4);
  assert.equal(T.search(doc, { done: true })[0].id, ids.passport);
  assert.equal(T.search(doc, { tag: 'travel' })[0].path, 'Trip to Lisbon > Bookings');
  assert.equal(T.search(doc, { due: 'any' }).length, 1);
  assert.equal(T.search(doc, { due: 'overdue', now: Date.UTC(2027, 0, 1) }).length, 1);
  assert.equal(T.search(doc, { q: 'usb' })[0].id, ids.cables, 'body text counts');
});

// ------------------------------------------------------------------ export
test('export: Markdown checklist with headings, nesting to any depth, hide done; JSON subtree', () => {
  const { doc, ids } = sample();
  const md = X.toMarkdown(doc, ids.trip);
  assert.ok(md.startsWith('# Trip to Lisbon\n\nFlights booked\n'));
  assert.ok(md.includes('## Packing'));
  assert.ok(md.includes('- [x] Passport'));
  assert.ok(md.includes('- [ ] Chargers\n  - • Which cables\n    USB-C x2\n    - **Inside the note**\n      - [ ] Pena palace'));
  assert.ok(md.includes('- [ ] Bookings _(due 2026-11-20, high, doing)_ #travel'));
  assert.ok(!X.toMarkdown(doc, ids.trip, { showDone: false }).includes('Passport'));
  const all = X.toMarkdown(doc);
  assert.ok(all.startsWith('# Todos · amberx-axf') && all.includes('## Groceries') && all.includes('### Weekend'));
  const deep = X.toMarkdown(doc, ids.pena);
  assert.ok(deep.includes('_Trip to Lisbon > Packing > Chargers > Which cables > Inside the note > Pena palace_'));
  const j = X.toJSON(doc, ids.packing, ctx.now);
  assert.equal(j.$axf, 'todo-tree@1'); assert.equal(j.count, 6); assert.equal(j.nodes[0].id, ids.packing); assert.equal(j.path, 'Trip to Lisbon > Packing');
  assert.equal(X.toJSON(doc, null).count, Object.keys(doc.nodes).length);
  assert.equal(X.exportFilename(doc, ids.trip), 'trip-to-lisbon.md');
  assert.equal(X.exportFilename(doc, null, 'json'), 'amberx-axf.json');
});

// ------------------------------------------------------------------ helpers
test('due helpers and tags', () => {
  assert.equal(T.cleanDue('2026-11-20'), '2026-11-20');
  assert.equal(T.cleanDue('2026-11-20T08:05'), '2026-11-20T08:05');
  assert.equal(T.cleanDue('2026-13-01'), null);
  assert.equal(T.cleanDue(new Date(2026, 10, 20, 0, 0).getTime()), '2026-11-20');
  assert.equal(T.cleanDue(new Date(2026, 10, 20, 9, 30).getTime()), '2026-11-20T09:30');
  assert.equal(T.dueToMs('2026-11-20'), new Date(2026, 10, 20).getTime());
  assert.deepEqual(T.cleanTags(' A, b ,a'), ['a', 'b']);
  assert.equal(T.cleanTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 20);
  assert.ok(T.newId() !== T.newId());
});

console.log(`todo-tree: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.error(`  ✗ ${f}`);
process.exit(failures.length ? 1 : 0);

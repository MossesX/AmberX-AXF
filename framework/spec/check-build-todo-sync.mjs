#!/usr/bin/env node
/**
 * build-todo-sync@1 — build names, categories and the to-do mirror of a build (Nov 4 2026). Pure core against the
 * fixture, an in-memory to-do manager that replays the plan's control@1 commands, and the store's own normaliser.
 *
 *   node framework/spec/check-build-todo-sync.mjs            check
 *   node framework/spec/check-build-todo-sync.mjs --update   rewrite spec/fixtures/build-todo-sync.json from the core
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as t from '../core/build-todo-sync.mjs';
import * as c from '../plan/builds-store-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'build-todo-sync.json');
const update = process.argv.includes('--update');
let n = 0; const test = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const NOW = '2026-11-04T18:00:00.000Z';

/* ------------------------------------------------------------------ an in-memory to-do manager (control@1 amberx.*) */
function todoManager(seedLists = [], seedItems = []) {
  const lists = new Map(seedLists.map((l) => [l.id, { ...l }]));
  const items = new Map(seedItems.map((i) => [i.id, { ...i }]));
  let seq = 0; const id = (p) => `${p}${++seq}`;
  const run = (op) => {
    if (op.target === 'amberx.lists') {
      if (op.op === 'add') { if (op.value.parent && !lists.has(op.value.parent)) throw new Error('parent gone'); const l = { id: id('l'), name: op.value.name, parent: op.value.parent ?? null, order: 0 }; lists.set(l.id, l); return { item: l }; }
      if (op.op === 'set') { const l = lists.get(op.path); if (!l) throw new Error('no list'); Object.assign(l, op.value); return { item: l }; }
      if (op.op === 'remove') { const l = lists.get(op.path); if (!l) throw new Error('no list'); for (const i of items.values()) if (i.list === op.path) i.list = l.parent ?? 'inbox'; lists.delete(op.path); return { removed: 1 }; }
    }
    if (op.target === 'amberx.items') {
      if (op.op === 'add') { if (!lists.has(op.value.list)) throw new Error('list gone'); const i = { status: 'open', tags: [], order: 0, url: '', text: '', updatedAt: NOW, doneAt: '', ...op.value, id: id('i') }; items.set(i.id, i); return { item: i }; }
      if (op.op === 'set') { const i = items.get(op.path); if (!i) throw new Error('no item'); Object.assign(i, op.value, { updatedAt: NOW }); if (op.value.status === 'done') i.doneAt = NOW; if (op.value.status && op.value.status !== 'done') i.doneAt = ''; return { item: i }; }
      if (op.op === 'remove') { if (!items.delete(op.path)) throw new Error('no item'); return { removed: 1 }; }
    }
    throw new Error(`unknown op ${JSON.stringify(op)}`);
  };
  const apply = (ops) => { const refs = {}; for (const op of ops) { const r = run(t.resolveOp(op, refs)); if (op.ref) refs[op.ref] = r.item.id; } return refs; };
  return { lists, items, run, apply, snapshot: () => ({ lists: [...lists.values()], items: [...items.values()] }) };
}

/* ------------------------------------------------------------------ a small store */
const step = (id, text, extra = {}) => ({ id, uid: `u-${id}`, text, model: 'Opus', estimate: '20 min', done: false, skip: false, updatedAt: '2026-11-04T10:00:00.000Z', ...extra });
// step uids are unique across the store (validateStore): only todo-sync keeps the short u-<id> form the tests name
let nth = 0;
const build = (id, title, extra = {}) => c.normBuild({ id, title, status: 'pending', profiles: ['main-framework'], order: { 'main-framework': nth++ }, createdAt: '2026-11-04T09:00:00.000Z', updatedAt: '2026-11-04T10:00:00.000Z', ...extra, steps: (extra.steps ?? []).map((s) => ({ ...s, uid: id === 'todo-sync' ? s.uid : `${id}-${s.id}` })) }, { now: NOW });
const STORE = c.normalizeStore({ $axf: 'builds@1', rev: 1, updatedAt: NOW, builds: [
  build('todo-sync', 'Build to-do sync plugin: names, categories, live checklists', { displayName: 'Build to-do sync', category: 'Plugin', nameReview: false, status: 'running', steps: [step('s1', 'Contract build-todo-sync@1', { model: 'Fable', done: true, doneAt: '2026-11-04T11:00:00.000Z' }), step('s2', 'Store fields + migration', { model: 'Fable' }), step('s3', 'Plugin server + sync engine'), step('s4', 'UI Review shots', { skip: true })] }),
  build('menus-engine', 'Framework: menu engine tokens for every port', { category: 'Console > Menus', steps: [step('s1', 'tokens')] }),
  build('old-done', 'Expenses app: grid save fix', { status: 'complete', builtAt: '2026-10-01T00:00:00.000Z', mergedAt: '2026-10-01T00:00:00.000Z', steps: [step('s1', 'fix', { done: true })] }),
  build('fresh-done', 'Molly voice: banners', { status: 'complete', builtAt: '2026-11-03T00:00:00.000Z', mergedAt: '2026-11-03T00:00:00.000Z', steps: [step('s1', 'banners', { done: true })] }),
  build('gone', 'Archived thing', { status: 'archived', steps: [step('s1', 'x')] }),
  build('an-epic', 'Plan epic', { kind: 'epic', steps: [step('s1', 'epic step')] }),
] });

/* ------------------------------------------------------------------ names + categories */
const NAMES = [
  ['Build to-do sync plugin: names, categories, live checklists', 'Build to-do sync plugin'],
  ['Urgent: land the merge queue (Lenny)', 'Land the merge queue'],
  ['Voice commands for every app: land Expenses, voice-command@1 contract, forFramework apps generate voice commands for API/MCP/CLI, Molly runs them', 'Voice commands for every app'],
  ['Todo manager plugin (from xGallery) + tabable plugins + Patches plugin tabs', 'Todo manager plugin'],
  ['fix', 'Fix'],
  ['', ''],
  ['A very long title without any separator that keeps going on and on past the limit of forty eight characters', 'A very long title without any separator that…'],
];
const CATS = [
  [{ title: 'Build to-do sync plugin' }, 'Plugin'],
  [{ title: 'Follow Amber plugin extension: approvals pop-up' }, 'Plugin extension'],
  [{ title: 'Breakroom add-on: jukebox' }, 'Add-on'],
  [{ title: 'menu engine tokens', area: 'Framework > Menus' }, 'Framework'],
  [{ title: 'Expenses app grid fix' }, 'App'],
  [{ title: 'lib-settings module for Android' }, 'Module'],
  [{ title: 'Faster start-up' }, 'Feature'],
  [{ title: 'Watch live targets', steps: [{ files: ['apps/console-web/plugins/watch-live/web/index.tsx'] }] }, 'Plugin'],
  [{ title: 'Profile cards', steps: [{ files: ['framework/core/engines/cards.ts'] }] }, 'Framework'],
  [{ title: 'Something', detail: 'wire the route in the expenses app' }, 'App'],
];
test('normCategory takes any spelling of the seven and nothing else', () => {
  for (const cat of t.CATEGORIES) assert.equal(t.normCategory(cat.toUpperCase()), cat);
  assert.equal(t.normCategory('plugins'), 'Plugin'); assert.equal(t.normCategory('plugin-extension'), 'Plugin extension'); assert.equal(t.normCategory('addon'), 'Add-on'); assert.equal(t.normCategory('apps'), 'App');
  assert.equal(t.normCategory('Console > Terminal'), ''); assert.equal(t.normCategory(''), ''); assert.equal(t.normCategory(null), '');
});
test('suggestDisplayName: short, from the lead-in, never empty, within MAX_NAME', () => {
  for (const [title, want] of NAMES) { const got = t.suggestDisplayName(title, { id: title ? '' : 'some-build-id' }); if (want) assert.equal(got, want, title); assert.ok(got.length <= t.MAX_NAME && got.length > 0, got); }
  assert.equal(t.suggestDisplayName('', { id: 'some-build-id' }), 'Some build id');
});
test('suggestCategory follows the words, then the files, then Feature', () => { for (const [b, want] of CATS) assert.equal(t.suggestCategory(b).category, want, JSON.stringify(b)); assert.ok(t.CATEGORIES.includes(t.suggestCategory({}).category)); });
test('naming fills what is missing and flags it for review; a confirmed name stays', () => {
  const a = t.naming({ title: 'Build to-do sync plugin: x', category: 'Console > Builds' });
  assert.equal(a.displayName, 'Build to-do sync plugin'); assert.equal(a.category, 'Plugin'); assert.equal(a.area, 'Console > Builds'); assert.equal(a.nameReview, true);
  const b = t.naming({ title: 'x', displayName: 'Named', category: 'App', nameReview: false }); assert.deepEqual(b, { displayName: 'Named', category: 'App', area: '', nameReview: false });
  const d = t.naming({ title: 'x', displayName: 'Named', category: 'App' }); assert.equal(d.nameReview, true, 'no explicit confirmation = review');
  const e = t.naming({ title: 'x', displayName: 'Named', category: 'nonsense', nameReview: false }); assert.equal(e.nameReview, true, 'a bad category needs review'); assert.equal(e.area, 'nonsense');
});

/* ------------------------------------------------------------------ the store carries the fields */
test('builds@1 records carry displayName, category (enum), area, nameReview and validate', () => {
  const b = STORE.builds.find((x) => x.id === 'menus-engine');
  assert.equal(b.category, 'Framework'); assert.equal(b.area, 'Console > Menus'); assert.equal(b.displayName, 'Menu engine tokens for every port'); assert.equal(b.nameReview, true);
  const s = STORE.builds.find((x) => x.id === 'todo-sync'); assert.equal(s.nameReview, false); assert.equal(s.displayName, 'Build to-do sync');
  assert.deepEqual(c.validateStore(STORE).errors, []);
  const bad = JSON.parse(JSON.stringify(STORE)); bad.builds[0].category = 'Console'; bad.builds[1].displayName = '';
  const v = c.validateStore(bad); assert.match(v.errors.map((e) => e.path).join('\n'), /\.category$/m); assert.match(v.errors.map((e) => e.path).join('\n'), /\.displayName$/m);
});
test('the orchestrator projection round-trips the new fields', () => {
  const back = c.absorbOrchestrator(STORE, 'main-framework', c.projectOrchestrator(STORE, 'main-framework'), { now: NOW });
  assert.deepEqual(c.diffStores(STORE, back, NOW), []);
  const o = c.projectOrchestrator(STORE, 'main-framework').builds.find((b) => b.id === 'todo-sync'); assert.equal(o.displayName, 'Build to-do sync'); assert.equal(o.nameReview, false); assert.equal(o.area, '');
});
test('a pending item with a name and category becomes a build with them', () => {
  const b = c.buildFromItem({ id: 'p1', title: 'Pending: a plugin thing', model: 'Opus', status: 'pending', displayName: 'Plugin thing', category: 'Plugin', nameReview: false, subPrompts: [], notes: [] }, 'main-framework', { now: NOW });
  assert.equal(b.displayName, 'Plugin thing'); assert.equal(b.category, 'Plugin'); assert.equal(b.nameReview, false);
});

/* ------------------------------------------------------------------ items */
const TS = STORE.builds.find((x) => x.id === 'todo-sync');
test('itemFor: numbered title, details with model and link, status from the step, tags from the state', () => {
  const it = t.itemFor(TS, TS.steps[1], 1, { linkBase: 'https://console.example', nextStepUid: 'u-s2' });
  assert.equal(it.title, '2. Store fields + migration'); assert.equal(it.status, 'doing'); assert.deepEqual(it.tags, ['build', 'fable']);
  assert.match(it.text, /Model: Fable · Estimate: 20 min/); assert.match(it.text, /Build: todo-sync · step s2/); assert.equal(it.url, 'https://console.example/#build-orchestrator/todo-sync/u-s2');
  assert.deepEqual(t.parseLink(it.url), { build: 'todo-sync', step: 'u-s2' });
  assert.equal(t.itemFor(TS, TS.steps[0], 0).status, 'done'); assert.deepEqual(t.itemFor(TS, TS.steps[3], 3).tags, ['build', 'opus', 'skipped']);
  const held = { ...TS, status: 'waiting' }; assert.ok(t.itemFor(held, TS.steps[2], 2).tags.includes('held'));
  const handed = t.itemFor(TS, { ...TS.steps[2], assignee: 'Janitor Joey' }, 2); assert.ok(handed.tags.includes('handed')); assert.match(handed.text, /Handed to: Janitor Joey/);
});
test('placeOf: open builds by category, fresh complete ones in Done, archived in Archive, old complete and epics not at all', () => {
  assert.equal(t.placeOf(STORE.builds.find((x) => x.id === 'todo-sync'), { now: NOW }), 'Plugin');
  assert.equal(t.placeOf(STORE.builds.find((x) => x.id === 'fresh-done'), { now: NOW }), 'Done');
  assert.equal(t.placeOf(STORE.builds.find((x) => x.id === 'old-done'), { now: NOW }), '');
  assert.equal(t.placeOf(STORE.builds.find((x) => x.id === 'gone'), { now: NOW }), 'Archive');
  assert.equal(t.placeOf(STORE.builds.find((x) => x.id === 'an-epic'), { now: NOW }), '');
});

/* ------------------------------------------------------------------ plan: backfill, idempotence, live check-off, drift */
const OPTS = { linkBase: 'https://console.example', statusNote: { title: 'Synced by Build to-do sync', text: 'Last sync 2026-11-04 18:00 UTC' } };
const tm = todoManager();
const p1 = t.plan({ store: STORE, ...tm.snapshot(), links: null, now: NOW, opts: OPTS });
test('backfill: Builds › <group> › <name> lists with one item per step, in order; the sync note on top', () => {
  assert.equal(p1.summary.builds, 4); assert.equal(p1.summary.removes, 0); assert.equal(p1.drift.length, 0);
  const adds = p1.ops.filter((o) => o.op === 'add');
  assert.deepEqual(adds.filter((o) => o.target === 'amberx.lists').map((o) => o.value.name), ['Builds', 'Framework', 'Plugin', 'Archive', 'Done', 'Build to-do sync', 'Menu engine tokens for every port', 'Molly voice', 'Archived thing']);
  const items = adds.filter((o) => o.target === 'amberx.items' && o.value.kind === 'todo');
  assert.equal(items.length, 4 + 1 + 1 + 1);
  assert.deepEqual(items.slice(0, 4).map((o) => [o.value.title, o.value.status, o.value.order]), [['1. Contract build-todo-sync@1', 'done', 0], ['2. Store fields + migration', 'doing', 1], ['3. Plugin server + sync engine', 'open', 2], ['4. UI Review shots', 'open', 3]]);
  assert.equal(items[0].value.list, '$ref:build:todo-sync'); assert.equal(p1.links.lists['build:todo-sync'], '$ref:build:todo-sync');
  assert.ok(adds.some((o) => o.value.kind === 'note' && o.value.pinned && o.value.list === '$ref:root'));
});
let refs = tm.apply(p1.ops);
let links = t.resolveLinks(p1.links, refs);
test('links resolve to real ids after the ops ran', () => { assert.match(links.lists['build:todo-sync'], /^l\d+$/); assert.match(links.items['todo-sync/u-s2'], /^i\d+$/); assert.equal(Object.values(links.items).some((v) => v.startsWith('$ref:')), false); });
test('planning again on the applied result changes nothing (idempotent)', () => { const p = t.plan({ store: STORE, ...tm.snapshot(), links, now: NOW, opts: OPTS }); assert.deepEqual(p.ops, []); assert.deepEqual(p.drift, []); });
test('a list the user deleted comes back and is reported', () => {
  const copy = todoManager(tm.snapshot().lists, tm.snapshot().items); copy.lists.delete(links.lists['build:menus-engine']);
  const p = t.plan({ store: STORE, ...copy.snapshot(), links, now: NOW, opts: OPTS });
  assert.ok(p.drift.some((d) => d.kind === 'list-missing' && d.build === 'menus-engine')); assert.ok(p.ops.some((o) => o.op === 'add' && o.target === 'amberx.lists' && o.value.name === 'Menu engine tokens for every port' && o.ref === 'build:menus-engine'));
});
test('live check-off: a step done in the store ticks its item (and the next step becomes doing)', () => {
  const S2 = JSON.parse(JSON.stringify(STORE)); const b = S2.builds.find((x) => x.id === 'todo-sync'); b.steps[1].done = true; b.steps[1].doneAt = NOW; b.steps[1].updatedAt = NOW; b.updatedAt = NOW;
  const p = t.plan({ store: S2, ...tm.snapshot(), links, now: NOW, opts: OPTS });
  const sets = p.ops.filter((o) => o.op === 'set' && o.target === 'amberx.items');
  assert.equal(sets.find((o) => o.path === links.items['todo-sync/u-s2']).value.status, 'done');
  assert.equal(sets.find((o) => o.path === links.items['todo-sync/u-s3']).value.status, 'doing');
  const copy = todoManager(tm.snapshot().lists, tm.snapshot().items); copy.apply(p.ops);
  assert.deepEqual(t.plan({ store: S2, ...copy.snapshot(), links, now: NOW, opts: OPTS }).ops, []);
});
test('rename, re-category, step added / removed / reordered all mirror', () => {
  const S3 = JSON.parse(JSON.stringify(STORE)); const b = S3.builds.find((x) => x.id === 'todo-sync');
  b.displayName = 'Todo sync'; b.category = 'Plugin extension'; b.steps = [b.steps[2], b.steps[0], { ...step('s5', 'New step'), uid: 'u-s5' }];
  const p = t.plan({ store: S3, ...tm.snapshot(), links, now: NOW, opts: OPTS });
  assert.ok(p.ops.some((o) => o.target === 'amberx.lists' && o.op === 'add' && o.value.name === 'Plugin extension'));
  assert.ok(p.ops.some((o) => o.target === 'amberx.lists' && o.op === 'set' && o.path === links.lists['build:todo-sync'] && o.value.name === 'Todo sync' && o.value.parent === '$ref:group:Plugin extension'));
  assert.ok(p.ops.some((o) => o.op === 'add' && o.value?.title === '3. New step'));
  assert.ok(p.ops.some((o) => o.op === 'remove' && o.path === links.items['todo-sync/u-s2']), 'a removed step removes its item');
  assert.ok(p.ops.some((o) => o.op === 'remove' && o.path === links.items['todo-sync/u-s4']));
  assert.ok(p.ops.some((o) => o.op === 'set' && o.path === links.items['todo-sync/u-s3'] && o.value.order === 0 && o.value.title === '1. Plugin server + sync engine'));
});
test('a step ticked by Brett in the to-do manager is drift, not reverted; an open ask keeps his tick; a stray item is left alone', () => {
  const copy = todoManager(tm.snapshot().lists, tm.snapshot().items);
  const it = copy.items.get(links.items['todo-sync/u-s3']); it.status = 'done'; it.updatedAt = '2026-11-04T17:00:00.000Z'; it.doneAt = it.updatedAt;
  copy.items.set('stray', { id: 'stray', list: links.lists['build:todo-sync'], title: 'my own note', status: 'open', tags: [], order: 9, url: '', updatedAt: NOW });
  const p = t.plan({ store: STORE, ...copy.snapshot(), links, now: NOW, opts: OPTS });
  const d = p.drift.find((x) => x.kind === 'ticked'); assert.equal(d.build, 'todo-sync'); assert.equal(d.step, 'u-s3'); assert.equal(d.stepId, 's3');
  assert.ok(!p.ops.some((o) => o.path === it.id && o.value?.status), 'not reverted');
  assert.ok(p.drift.some((x) => x.kind === 'stray' && x.item === 'stray')); assert.ok(!p.ops.some((o) => o.path === 'stray'));
  const asks = t.asksFrom(p.drift, NOW); assert.equal(asks.length, 1); assert.equal(asks[0].id, 'todo-sync/u-s3/ticked'); assert.match(asks[0].title, /Mark step s3 of todo-sync done\?/);
  const again = t.plan({ store: STORE, ...copy.snapshot(), links, asks, now: NOW, opts: OPTS }); assert.equal(again.drift.filter((x) => x.kind === 'ticked').length, 0); assert.ok(!again.ops.some((o) => o.path === it.id));
  const merged = t.mergeAsks([{ ...asks[0], id: 'other/u/ticked', state: 'open' }], asks, NOW); assert.equal(merged.find((a) => a.id === 'other/u/ticked').state, 'settled'); assert.equal(merged.find((a) => a.id === asks[0].id).state, 'open');
});
test('a stale mirror item (changed before the step) is reverted to the store, no ask', () => {
  const copy = todoManager(tm.snapshot().lists, tm.snapshot().items);
  const it = copy.items.get(links.items['todo-sync/u-s3']); it.status = 'done'; it.updatedAt = '2026-11-04T09:30:00.000Z';
  const p = t.plan({ store: STORE, ...copy.snapshot(), links, now: NOW, opts: OPTS });
  assert.equal(p.drift.length, 0); assert.equal(p.ops.find((o) => o.path === it.id).value.status, 'open');
});
test('a build leaving the mirror (aged out of Done) takes its items and list away', () => {
  const later = '2026-11-20T00:00:00.000Z';
  const p = t.plan({ store: STORE, ...tm.snapshot(), links, now: later, opts: OPTS });
  const lid = links.lists['build:fresh-done'];
  assert.ok(p.ops.some((o) => o.target === 'amberx.lists' && o.op === 'remove' && o.path === lid && o.confirm === true));
  assert.ok(p.ops.some((o) => o.target === 'amberx.items' && o.op === 'remove' && o.path === links.items['fresh-done/fresh-done-s1']));
  const copy = todoManager(tm.snapshot().lists, tm.snapshot().items); const r2 = copy.apply(p.ops); const l2 = t.resolveLinks(p.links, r2);
  assert.deepEqual(t.plan({ store: STORE, ...copy.snapshot(), links: l2, now: later, opts: OPTS }).ops, []);
});
test('Planned & fixes: a fix becomes an item after the steps; a tick in the to-do manager is applied drift, not an ask', () => {
  const S4 = JSON.parse(JSON.stringify(STORE)); const b = S4.builds.find((x) => x.id === 'todo-sync');
  b.fixes = [t.normFix({ id: 'f1', text: 'Tabs forget their size', kind: 'bug', by: 'Brett', at: NOW }, 0, NOW), t.normFix({ id: 'f2', text: 'Voice command for sync', kind: 'planned', at: NOW }, 1, NOW)];
  assert.equal(t.nextFixId(b.fixes), 'f3'); assert.equal(t.findFix(b.fixes, 'f2').kind, 'planned'); assert.ok(b.fixes[0].uid.startsWith('fx-f1-'));
  const copy = todoManager(tm.snapshot().lists, tm.snapshot().items);
  const p = t.plan({ store: S4, ...copy.snapshot(), links, now: NOW, opts: OPTS });
  const adds = p.ops.filter((o) => o.op === 'add' && o.target === 'amberx.items');
  assert.deepEqual(adds.map((o) => [o.value.title, o.value.order, o.value.tags]), [['Bug: Tabs forget their size', 1000, ['build', 'fixes', 'bug']], ['Planned: Voice command for sync', 1001, ['build', 'fixes', 'planned']]]);
  assert.equal(adds[0].value.priority, 2); assert.deepEqual(t.parseLink(adds[0].value.url), { build: 'todo-sync', step: `fix:${b.fixes[0].uid}` });
  const r2 = copy.apply(p.ops); const l2 = t.resolveLinks(p.links, r2);
  assert.deepEqual(t.plan({ store: S4, ...copy.snapshot(), links: l2, now: NOW, opts: OPTS }).ops, []);
  const it = copy.items.get(l2.items[`todo-sync/fix:${b.fixes[0].uid}`]); it.status = 'done'; it.updatedAt = '2026-11-04T19:00:00.000Z'; it.doneAt = it.updatedAt;
  const p3 = t.plan({ store: S4, ...copy.snapshot(), links: l2, now: NOW, opts: OPTS });
  assert.deepEqual(p3.drift.map((d) => [d.kind, d.fixId]), [['fix-ticked', 'f1']]); assert.equal(t.asksFrom(p3.drift).length, 0); assert.ok(!p3.ops.some((o) => o.path === it.id));
  b.fixes[0].done = true; b.fixes[0].doneAt = '2026-11-04T19:00:05.000Z'; b.fixes[0].updatedAt = b.fixes[0].doneAt;
  const p4 = t.plan({ store: S4, ...copy.snapshot(), links: l2, now: NOW, opts: OPTS }); assert.equal(p4.drift.length, 0);
  assert.ok(p4.ops.some((o) => o.path === it.id && o.value.text?.includes('Done: 2026-11-04T19:00:05.000Z')), 'the item text follows the fix');
});
test('resolveOp fills refs and refuses unknown ones', () => {
  assert.deepEqual(t.resolveOp({ target: 'amberx.items', op: 'add', value: { list: '$ref:x', tags: ['$ref:x'] }, ref: 'r', why: 'w' }, { x: 'l9' }), { target: 'amberx.items', op: 'add', value: { list: 'l9', tags: ['l9'] } });
  assert.throws(() => t.resolveOp({ target: 'amberx.items', op: 'add', value: { list: '$ref:nope' } }, {}), /unresolved/);
});
test('store events round-trip', () => {
  const e = t.storeEvent({ rev: 12, at: NOW, by: 'orchestrator', action: 'orchestrator:step', builds: [{ id: 'todo-sync', op: 'change' }] });
  assert.deepEqual(t.parseEvent(JSON.stringify(e)), e); assert.equal(t.parseEvent({ $axf: 'other' }), null); assert.equal(t.parseEvent('nope'), null);
});

/* ------------------------------------------------------------------ fixture */
const fixture = {
  $axf: 'build-todo-sync@1',
  description: 'Golden outputs of framework/core/build-todo-sync.mjs: names, categories, items and the plan for a small store on an empty to-do manager. Regenerate with node framework/spec/check-build-todo-sync.mjs --update.',
  categories: t.CATEGORIES, maxName: t.MAX_NAME,
  names: NAMES.filter(([x]) => x).map(([title, want]) => ({ title, displayName: want })),
  suggestedCategories: CATS.map(([b, want]) => ({ build: b, category: want })),
  items: TS.steps.map((s, i) => t.itemFor(TS, s, i, { linkBase: 'https://console.example', nextStepUid: 'u-s2' })),
  backfill: { ops: p1.ops, links: p1.links, summary: p1.summary },
};
const text = `${JSON.stringify(fixture, null, 1)}\n`;
if (update) { writeFileSync(FIXTURE, text); console.log(`wrote ${FIXTURE}`); }
else test('the fixture matches the core (run with --update after changing the rules)', () => { assert.deepEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')), JSON.parse(text)); });

console.log(`build-todo-sync@1: ${n} checks passed`);

#!/usr/bin/env node
/**
 * todo-store@1 → todo-tree@1 migration tests: `node apps/console-web/plugins/todo-manager/test/migrate.test.mjs`.
 * Ids, dates and done state kept; lists → list nodes, entries → todo / task / note nodes, checklists → child to-dos;
 * orphans to the root; the old type schema kept; backup written first; idempotent; dry-run writes nothing.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '../core/todo-tree.mjs';
import * as M from '../core/migrate.mjs';
import { conforms } from './schema-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const NOW = 1_794_900_000_000;
const DUE = new Date(2026, 10, 20, 0, 0).getTime();
const DUE_T = new Date(2026, 10, 21, 9, 30).getTime();

/** The shape the live VPS stores have (lists with groups, to-dos with checklists, a note, a task with subtasks). */
function oldStore() {
  return {
    $axf: 'todo-store@1',
    types: { note: { label: 'Note' }, todo: { label: 'To-do' }, task: { label: 'Task', fields: [{ key: 'estimate' }] } },
    lists: [
      { id: 1, parentId: null, title: 'Website relaunch', tone: 'accent', icon: 'globe', sortOrder: 2, createdAt: 100, updatedAt: 110 },
      { id: 3, parentId: 1, title: 'Design', tone: 'info', icon: '', sortOrder: 1, createdAt: 101, updatedAt: 101 },
      { id: 5, parentId: 3, title: 'Home page', tone: '', icon: '', sortOrder: 1, createdAt: 102, updatedAt: 102 },
      { id: 9, parentId: null, title: 'My list', tone: '', icon: '', sortOrder: 1, createdAt: 90, updatedAt: 90 },
      { id: 11, parentId: 99, title: 'Lost group', tone: '', icon: '', sortOrder: 1, createdAt: 103, updatedAt: 103 },
    ],
    entries: [
      { id: 2, listId: 1, parentId: null, kind: 'todo', title: 'Book the kickoff call', body: '', status: 'done', priority: 'normal', dueAt: null, tags: ['test-data', 'meeting'],
        checklist: [{ id: 'c1', text: 'Pick a time', done: true }, { id: 'c2', text: 'Send the invite', done: true }], fields: {}, sortOrder: 2, createdAt: 200, updatedAt: 210, completedAt: 205 },
      { id: 4, listId: 3, parentId: null, kind: 'todo', title: 'Pick the colour palette', body: '', status: 'in_progress', priority: 'high', dueAt: DUE, tags: ['design'],
        checklist: [{ id: 'c1', text: 'Three options', done: true }, { id: 'c2', text: 'Choose one', done: false }], fields: {}, sortOrder: 1, createdAt: 201, updatedAt: 201, completedAt: null },
      { id: 6, listId: 1, parentId: null, kind: 'task', title: 'Ship it', body: 'Deploy on Friday', status: 'blocked', priority: 'urgent', dueAt: DUE_T, tags: [],
        checklist: [], fields: { estimate: 4, area: 'deploy' }, sortOrder: 1, createdAt: 202, updatedAt: 203, completedAt: null },
      { id: 7, listId: 1, parentId: 6, kind: 'task', title: 'Run the checks', body: '', status: 'open', priority: 'normal', dueAt: null, tags: [], checklist: [], fields: {}, sortOrder: 1, createdAt: 204, updatedAt: 204, completedAt: null },
      { id: 8, listId: 1, parentId: 7, kind: 'note', title: 'Which checks', body: 'theme, controls', status: 'open', priority: 'normal', dueAt: null, tags: [], checklist: [], fields: { source: '' }, sortOrder: 1, createdAt: 205, updatedAt: 205, completedAt: null },
      { id: 10, listId: 9, parentId: null, kind: 'note', title: 'Build', body: 'Build', status: 'open', priority: 'normal', dueAt: null, tags: [], checklist: [], fields: { source: '' }, sortOrder: 1, createdAt: 206, updatedAt: 206, completedAt: null },
      { id: 12, listId: 77, parentId: null, kind: 'weird', title: 'Lost entry', body: '', status: 'open', priority: 'silly', dueAt: null, tags: [], checklist: [], fields: {}, sortOrder: 1, createdAt: 207, updatedAt: 207, completedAt: null },
    ],
    nextId: 13,
  };
}

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

test('convert keeps ids, maps every list and entry, checklists become child to-dos', () => {
  const { doc, counts, warnings } = M.convert(oldStore(), { now: NOW, project: 'test-sandbox' });
  conforms(doc, 'converted');
  assert.deepEqual(counts, { lists: 5, entries: 7, checklistItems: 4, orphans: 2, nodes: 16 });
  assert.equal(doc.project, 'test-sandbox');
  // lists
  assert.equal(doc.nodes['1'].kind, 'list'); assert.equal(doc.nodes['1'].tone, 'accent'); assert.equal(doc.nodes['1'].icon, 'globe');
  assert.equal(doc.nodes['3'].parentId, '1'); assert.equal(doc.nodes['5'].parentId, '3');
  assert.equal(doc.nodes['9'].tone, undefined, 'an empty tone is not stored');
  assert.equal(doc.nodes['11'].parentId, null, 'a list whose parent is missing goes to the root');
  // entries
  assert.equal(doc.nodes['2'].parentId, '1'); assert.equal(doc.nodes['2'].kind, 'todo');
  assert.equal(doc.nodes['2'].done, true); assert.equal(doc.nodes['2'].status, 'done'); assert.equal(doc.nodes['2'].doneAt, 205);
  assert.deepEqual(doc.nodes['2'].tags, ['test-data', 'meeting']);
  assert.equal(doc.nodes['4'].status, 'doing'); assert.equal(doc.nodes['4'].done, false); assert.equal(doc.nodes['4'].priority, 'high');
  assert.equal(doc.nodes['4'].due, '2026-11-20');
  assert.equal(doc.nodes['6'].due, '2026-11-21T09:30'); assert.equal(doc.nodes['6'].status, 'blocked'); assert.equal(doc.nodes['6'].priority, 'urgent');
  assert.deepEqual(doc.nodes['6'].fields, { estimate: 4, area: 'deploy' });
  assert.equal(doc.nodes['8'].fields, undefined, 'all-empty custom fields are not stored');
  assert.equal(doc.nodes['7'].parentId, '6', 'a subtask hangs under its parent entry');
  assert.equal(doc.nodes['8'].parentId, '7', 'a note under a task under a task');
  assert.equal(T.pathOf(doc, '8'), 'Website relaunch > Ship it > Run the checks > Which checks');
  assert.equal(doc.nodes['12'].parentId, null); assert.equal(doc.nodes['12'].kind, 'note'); assert.equal(doc.nodes['12'].priority, 'normal');
  // dates
  assert.equal(doc.nodes['1'].createdAt, 100); assert.equal(doc.nodes['1'].updatedAt, 110); assert.equal(doc.nodes['2'].createdAt, 200);
  // checklists
  const kids = T.children(doc, '2');
  assert.deepEqual(kids.map((n) => [n.id, n.title, n.done, n.kind]), [['2.c1', 'Pick a time', true, 'todo'], ['2.c2', 'Send the invite', true, 'todo']]);
  assert.deepEqual(T.children(doc, '4').map((n) => n.done), [true, false]);
  assert.equal(T.rollups(doc).get('4').checked, 1);
  // sibling order: entries by sortOrder, then child lists
  assert.deepEqual(T.children(doc, '1').map((n) => n.id), ['6', '2', '3']);
  assert.deepEqual(T.children(doc, null).map((n) => n.id), ['12', '9', '11', '1'], 'entries first, then lists by (sortOrder, id)');
  // legacy types kept, op log has the migrate op
  assert.equal(doc.meta.migratedFrom, 'todo-store@1'); assert.equal(doc.meta.legacyTypes.task.fields[0].key, 'estimate');
  assert.equal(doc.ops[0].op, 'migrate'); assert.equal(doc.ops[0].args.nodes, 16); assert.equal(doc.seq, 1);
  assert.ok(Object.values(doc.nodes).every((n) => n.source === 'import'));
  assert.ok(warnings.some((w) => w.includes('Lost entry')) && warnings.some((w) => w.includes('Lost group')));
  assert.equal(T.stats(doc).maxDepth, 3);
});

test('convert is deterministic and the result works with the engine', () => {
  const a = M.convert(oldStore(), { now: NOW }).doc;
  const b = M.convert(oldStore(), { now: NOW }).doc;
  assert.deepEqual(a, b);
  let doc = a;
  doc = T.move(doc, '5', { parentId: '8' }, { now: NOW + 1 }).doc;
  assert.equal(T.pathOf(doc, '5'), 'Website relaunch > Ship it > Run the checks > Which checks > Home page', 'a list inside a note after migration');
  const r = T.create(doc, { kind: 'todo', title: 'New one', parent: 'Website relaunch > Design' }, { now: NOW + 2 });
  assert.ok(r.node.id.startsWith('n-'), 'new ids never collide with migrated integers');
  conforms(r.doc, 'after ops');
});

test('convert refuses what is not a todo-store@1', () => {
  assert.throws(() => M.convert({ $axf: 'todo-tree@1', nodes: {} }), (e) => e.code === 'not-old-store');
  assert.ok(M.isOldStore({ lists: [], entries: [] }), 'an unlabelled old file still reads');
  const { doc } = M.convert({ lists: [], entries: [] }, { now: NOW });
  assert.equal(Object.keys(doc.nodes).length, 0);
  conforms(doc, 'empty');
});

test('migrateFile: backup first, atomic write, idempotent, dry-run writes nothing, missing and unreadable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'todo-migrate-'));
  try {
    const file = join(dir, 'store.json');
    writeFileSync(file, JSON.stringify(oldStore()), { mode: 0o600 });
    const dry = M.migrateFile(file, { dryRun: true, now: NOW });
    assert.equal(dry.status, 'dry-run'); assert.equal(dry.counts.nodes, 16); assert.equal(dry.backup, '');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).$axf, 'todo-store@1', 'dry run left the file alone');
    assert.deepEqual(readdirSync(dir), ['store.json']);

    const r = M.migrateFile(file, { now: NOW });
    assert.equal(r.status, 'migrated');
    assert.ok(existsSync(r.backup) && r.backup.includes('.todo-store-v1.') && r.backup.endsWith('.bak'));
    assert.equal(statSync(r.backup).mode & 0o777, 0o600);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(r.backup, 'utf8')), oldStore(), 'the backup is the old file byte for byte');
    const written = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(written.$axf, 'todo-tree@1'); assert.equal(written.meta.backup, r.backup.split('/').pop());
    const loaded = T.load(written, NOW);
    assert.deepEqual(loaded.warnings, []); conforms(loaded.doc, 'written');
    assert.ok(!readdirSync(dir).some((f) => f.endsWith('.tmp')));

    const again = M.migrateFile(file, { now: NOW + 1 });
    assert.equal(again.status, 'already'); assert.equal(again.stats.nodes, 16);
    assert.equal(readdirSync(dir).filter((f) => f.endsWith('.bak')).length, 1, 'no second backup');

    assert.equal(M.migrateFile(join(dir, 'nope.json')).status, 'missing');
    writeFileSync(join(dir, 'bad.json'), 'not json');
    assert.equal(M.migrateFile(join(dir, 'bad.json')).status, 'unreadable');
    writeFileSync(join(dir, 'other.json'), JSON.stringify({ $axf: 'something-else@1' }));
    assert.equal(M.migrateFile(join(dir, 'other.json')).status, 'unreadable');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migrateAll walks the base store and every project; the CLI reports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'todo-migrate-all-'));
  try {
    writeFileSync(join(dir, 'store.json'), JSON.stringify(oldStore()));
    mkdirSync(join(dir, 'projects', 'test-sandbox'), { recursive: true });
    writeFileSync(join(dir, 'projects', 'test-sandbox', 'store.json'), JSON.stringify({ ...oldStore(), lists: oldStore().lists.slice(0, 1), entries: [] }));
    mkdirSync(join(dir, 'projects', 'empty'), { recursive: true });
    const files = M.storeFiles(dir);
    assert.deepEqual(files.map((f) => f.project), ['', 'test-sandbox']);
    const results = M.migrateAll(dir, { now: NOW });
    assert.deepEqual(results.map((r) => r.status), ['migrated', 'migrated']);
    assert.equal(JSON.parse(readFileSync(join(dir, 'projects', 'test-sandbox', 'store.json'), 'utf8')).project, 'test-sandbox');
    const out = execFileSync('node', [join(here, '../core/migrate.mjs'), dir, '--dry-run'], { encoding: 'utf8' });
    assert.ok(out.includes('already') && out.split('\n').filter((l) => l.startsWith('already')).length === 2);
    const json = JSON.parse(execFileSync('node', [join(here, '../core/migrate.mjs'), join(dir, 'store.json'), '--json'], { encoding: 'utf8' }));
    assert.equal(json[0].status, 'already');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

console.log(`todo-migrate: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.error(`  ✗ ${f}`);
process.exit(failures.length ? 1 : 0);

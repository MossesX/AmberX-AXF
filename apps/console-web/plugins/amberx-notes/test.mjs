#!/usr/bin/env node
/** Notes (amberx-notes) self-test: migrate.mjs moves a todo-store@1 file into amberx.items through control@1. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan } from './migrate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const AXF = resolve(HERE, '../../../../framework/cli/axf.mjs');
let n = 0;
const ok = (name, cond, got) => { if (!cond) { console.error(`✗ ${name}`, got ?? ''); process.exit(1); } n++; };

const store = {
  $axf: 'todo-store@1',
  lists: [{ id: 1, title: 'Work' }, { id: 2, parentId: 1, title: 'Sub' }, { id: 3, title: 'Empty' }],
  entries: [
    { id: 6, listId: 2, parentId: 5, kind: 'task', title: 'sub' },
    { id: 5, listId: 2, kind: 'task', title: 'Ship it', status: 'in_progress', priority: 'high', checklist: [{ text: 'x', done: true }], tags: ['a'], dueAt: Date.UTC(2026, 10, 20) },
    { id: 7, listId: 1, kind: 'note', title: 'N', body: 'hello' },
  ],
};
const p = plan(store);
ok('empty lists are not copied', p.lists.map((l) => l.name).join() === 'Work,Sub', p.lists);
ok('parents before subtasks', p.items.at(-1).key === 6, p.items);
const ship = p.items.find((i) => i.key === 5).value;
ok('fields mapped', ship.status === 'doing' && ship.priority === 2 && ship.due === '2026-11-20' && ship.checklist.length === 1 && ship.tags[0] === 'a', ship);
ok('nothing to move = nothing planned', plan({ lists: [{ id: 1, title: 'My list' }], entries: [] }).lists.length === 0);

const dir = mkdtempSync(join(tmpdir(), 'amberx-notes-'));
writeFileSync(join(dir, 'store.json'), JSON.stringify(store));
const env = { ...process.env, AXF_AMBERX_NOTES_DIR: join(dir, 'notes') };
const run = spawnSync(process.execPath, [join(HERE, 'migrate.mjs'), join(dir, 'store.json'), '--json'], { encoding: 'utf8', env });
const rep = JSON.parse(run.stdout || '{}');
ok('migrate moved every entry', run.status === 0 && rep.moved === 3, run.stdout + run.stderr);
const list = (kind) => JSON.parse(spawnSync(process.execPath, [AXF, kind, 'list', '--json'], { encoding: 'utf8', env }).stdout).items;
const tasks = list('task');
ok('tasks in AmberX under Console todos', tasks.length === 2 && tasks.every((t) => t.listPath === 'Console todos › Work › Sub'), tasks);
ok('subtask linked to its parent', tasks.find((t) => t.title === 'sub').parent === tasks.find((t) => t.title === 'Ship it').id, tasks);
ok('note kept its text', list('note')[0]?.text === 'hello');
const missing = spawnSync(process.execPath, [join(HERE, 'migrate.mjs'), join(dir, 'nope.json')], { encoding: 'utf8', env });
ok('no file: exit 2', missing.status === 2);
console.log(`✓ amberx-notes: ${n} tests passed`);

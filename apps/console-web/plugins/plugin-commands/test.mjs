#!/usr/bin/env node
/**
 * Plugin commands runner (commands.mjs) on the fixture plugins (fixtures/root): the gate (grants, the command's own
 * effect, confirm tokens), list / get, info and data reads (secrets redacted, private files refused, no way out of the
 * data folder), dispatch plans for routes and actions, finish envelopes, turned-off plugins and other apps' plugins,
 * and the CLI (`axf <plugin> <command>`, `axf plugins`).
 *
 *   node apps/console-web/plugins/plugin-commands/test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures', 'root');
process.env.AXF_ROOT = FIX;
process.env.AXF_PLUGIN_DATA_ROOT = FIX;
process.env.AXF_PLUGIN_COMMANDS_DATA_DIR = mkdtempSync(join(tmpdir(), 'pc-'));
const { plan, finish, registry, redact, main } = await import('./commands.mjs');

let n = 0;
const ok = (v, what) => { assert.ok(v, what); n++; };
const eq = (a, b, what) => { assert.deepEqual(a, b, what); n++; };
const act = (path, input = {}, extra = {}) => ({ op: 'act', target: path.includes('/state') || path.includes('/data') || path.includes('/info') || path.includes('/plans-by') || path.includes('/search') || path.endsWith('/entries') ? 'plugins.reads' : 'plugins.commands', path, action: path.includes('/state') || path.includes('/data') || path.includes('/info') || path.includes('/plans-by') || path.includes('/search') || path.endsWith('/entries') ? 'read' : 'run', input, ...extra });

/* ---- list + get */
let r = plan({ op: 'list', target: 'plugins.reads', select: { plugin: 'fixture-plans' } });
eq(r.items.map((i) => i.command).sort(), ['data', 'data-file', 'info', 'plans-by-pid', 'search', 'state'], 'list the reads of one plugin');
r = plan({ op: 'list', target: 'plugins.commands', select: { effect: 'destructive' } });
ok(r.items.some((i) => i.id === 'fixture-todos/entries-by-eid-delete') && r.items.some((i) => i.id === 'fixture-plans/action-clear'), 'filter by effect');
r = plan({ op: 'list', target: 'plugins.commands', select: { q: 'new plan' } });
eq(r.items.map((i) => i.id), ['fixture-plans/action-capture'], 'search by words');
r = plan({ op: 'get', target: 'plugins.commands', path: 'fixture-todos/entries-by-eid-delete' });
ok(r.item.rest.method === 'DELETE' && r.item.cli.includes('--eid') && r.item.tool === 'fixture_todos_entries_by_eid_delete', 'get: REST, CLI and MCP of one command');

/* ---- local reads */
r = plan(act('fixture-plans/info'));
eq(r.value.name, 'Fixture plans', 'info');
r = plan(act('fixture-plans/data'));
ok(r.items.some((i) => i.file === 'plans/index.json'), 'data lists files');
r = plan(act('fixture-plans/data-file', { file: 'plans/index.json' }));
eq(r.value.value, { plans: 1, apiKey: '[redacted]', nested: { refreshToken: '[redacted]', title: 'kept' } }, 'data-file: JSON, secrets redacted');
eq(plan(act('fixture-plans/data-file', { file: 'salt' })).code, 'denied', 'a secret file is refused');
eq(plan(act('fixture-plans/data-file', { file: '../../../etc/hostname' })).code, 'validation', 'no way out of the data folder');
eq(plan(act('fixture-plans/data-file', {})).code, 'validation', 'file is required');
eq(redact({ password: 'x', list: [{ token: 'y', n: 1 }] }), { password: '[redacted]', list: [{ token: '[redacted]', n: 1 }] }, 'redact walks lists');

/* ---- dispatch plans */
r = plan(act('fixture-plans/plans-by-pid', { pid: 'p1', full: true }));
eq(r.dispatch, { kind: 'route', method: 'GET', path: '/api/plugins/fixture-plans/plans/p1', query: { full: 'true' }, body: null }, 'a read route');
r = plan(act('fixture-todos/entries-run', { listId: 1, title: 'x' }, { by: 'claude' }));
eq([r.dispatch.method, r.dispatch.body, r.command.by], ['POST', { listId: 1, title: 'x' }, 'claude'], 'a command route');
r = plan(act('fixture-plans/action-capture', { to: 'all' }));
eq(r.dispatch, { kind: 'action', action: 'fixture-plans.capture', args: null, to: 'all' }, 'an action goes to the open console');
eq(plan(act('fixture-plans/plans-by-pid', {})).code, 'validation', 'missing input is named');

/* ---- the gate */
eq(plan(act('fixture-todos/entries-run', { listId: 1 }), { grants: ['control.plugins.read'] }).code, 'denied', 'a reader can\'t run');
ok(plan(act('fixture-plans/state'), { grants: ['control.plugins.read'] }).dispatch, 'a reader can read');
eq(plan(act('fixture-todos/entries-by-eid-delete', { eid: 1 }), { grants: ['control.plugins.write'] }).code, 'denied', 'write doesn\'t cover a delete');
r = plan(act('fixture-todos/entries-by-eid-delete', { eid: 1 }));
eq(r.code, 'confirmation_required', 'a delete asks for a confirm token');
ok(plan(act('fixture-todos/entries-by-eid-delete', { eid: 1 }, { confirm: r.confirm })).dispatch, 'the same command with it runs');
eq(plan(act('fixture-todos/entries-by-eid-delete', { eid: 2 }, { confirm: r.confirm })).code, 'confirmation_required', 'not for another record');
eq(plan(act('fixture-plans/nope')).code, 'not_found', 'unknown command');
eq(plan(act('nobody/state')).code, 'not_found', 'unknown plugin');
eq(plan({ op: 'act', target: 'plugins.reads', path: 'fixture-todos/entries-run', action: 'read' }).code, 'not_found', 'a command is not a read');
eq(plan({ op: 'set', target: 'plugins.commands', path: 'x/y', value: 1 }).code, 'invalid', 'plugins targets take no set');

/* ---- off, other apps */
const enabled = { 'fixture-plans': false };
eq(plan(act('fixture-plans/state'), { enabled, reg: registry({ enabled }) }).code, 'not_implemented', 'a turned-off plugin\'s commands answer that it is off');
eq(plan(act('amberx-droid:fixture-notes/action-notes-new')).code, 'not_implemented', 'another app\'s command is listed, run there');

/* ---- finish */
r = finish(act('fixture-todos/entries-run', {}, { by: 'claude' }), { status: 201, result: { entry: { id: 1 } } });
ok(r.ok && r.changed && r.result.entry.id === 1 && r.audit.by === 'claude', 'a command\'s answer');
eq(finish(act('fixture-plans/state'), { status: 200, result: { a: 1 } }).value, { a: 1 }, 'a read\'s answer');
eq(finish(act('fixture-todos/entries-run'), { status: 404, message: 'gone' }).code, 'not_found', 'HTTP codes map to wire codes');
eq(finish(act('fixture-todos/entries-run'), { status: 403 }).code, 'denied', '403 = denied');
eq(finish(act('fixture-todos/entries-run'), { ok: false, code: 'not_implemented', message: 'no console' }).code, 'not_implemented', 'an action that could not be sent');

/* ---- CLI */
const cli = (...args) => spawnSync(process.execPath, [join(HERE, 'commands.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, AXF_CONSOLE_URL: 'http://127.0.0.1:9' } });
let c = cli('plugins');
ok(c.status === 0 && c.stdout.includes('fixture-plans') && c.stdout.includes('amberx-droid:fixture-notes'), 'axf plugins');
c = cli('fixture-plans');
ok(c.stdout.includes('Reads:') && c.stdout.includes('Not commands:') && c.stdout.includes('server-sent events'), 'axf <plugin> = its help');
c = cli('fixture-plans', 'info', '--json');
eq(JSON.parse(c.stdout).value.name, 'Fixture plans', 'axf <plugin> info runs here');
c = cli('fixture-plans', 'data-file', '--file', 'plans/index.json');
ok(c.status === 0 && c.stdout.includes('[redacted]'), 'axf <plugin> data-file --file …');
c = cli('fixture-todos', 'entries-by-eid-delete', '--help');
ok(c.stdout.includes('--eid <eid>') && c.stdout.includes('[--confirm <token>]'), '--help shows what it takes');
c = cli('fixture-plans', 'state');
ok(c.status === 1 && c.stderr.includes("can't reach the console"), 'a route command goes to the console (unreachable here)');
c = cli('fixture-plans', 'nope');
eq(c.status, 2, 'unknown command = usage');
c = cli('check');
ok(c.status === 1 && c.stdout.includes('✗ fixture-quiet') && c.stdout.includes('no reads'), 'check fails a plugin without reads or a block');
eq(await main(['plugins', 'fixture-todos']), 0, 'main() for axf.mjs');

console.log(`✓ plugin commands runner — ${n} checks`);

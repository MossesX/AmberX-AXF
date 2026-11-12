#!/usr/bin/env node
/**
 * AmberX on the console: every moved feature is reached the same four ways (build
 * move-amberx-web-app-into-the-console-amberx-andr s14; Brett, Nov 8 2026: "everything comes with an API").
 *
 *   node apps/console-web/scripts/amberx-parity.test.mjs
 *
 * 1. For each feature's actions and reads, the plugin-commands registry (made from the plugins' own plugin.json and
 *    server routes) gives a REST route (/api/control/<plugin>/<command>, besides the plugin's own route), an MCP tool
 *    (<plugin>_<command>) and a CLI form (axf <plugin> <command>), and a deep-link action is declared.
 * 2. Notes, to-dos and lists are control@1 amberx.items / amberx.lists: the MCP tools, REST routes and CLI aliases exist,
 *    and one write through the CLI is read back through the runner the REST route and MCP tools call (and back).
 * A plugin that has been removed is skipped (plugins are removable), never failed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PLUGINS = join(ROOT, 'apps/console-web/plugins');
const { commandToolName, pluginCommandCli, pluginCommandRoutes, pluginCommandTools } = await import(join(ROOT, 'framework/core/engines/plugin-commands.mjs'));
const { CONTROL_ALIASES, controlRoutes, controlTools } = await import(join(ROOT, 'framework/core/engines/control-rules.mjs'));

let n = 0; let fails = 0;
const ok = (cond, what) => { n++; if (!cond) { fails++; console.log(`FAIL ${what}`); } };

/** feature → plugin folder → the commands it must have (MCP / REST / CLI) and the deep-link action it declares. */
const FEATURES = [
  { step: 's3', feature: 'notes', folder: 'amberx-notes', commands: ['state', 'settings', 'set-settings', 'reset-settings'], deepLink: 'action:amberx-notes.focus' }, // axf-plugin:amberx-notes
  { step: 's4', feature: 'to-dos', folder: 'amberx-tasks', commands: ['state', 'items', 'add', 'complete', 'reorder', 'remove', 'settings', 'set-settings'], deepLink: 'action:amberx-tasks.focus' }, // axf-plugin:amberx-tasks
  { step: 's5', feature: 'lists', folder: 'amberx-lists', commands: ['state', 'list', 'export', 'add-list', 'rename-list', 'move-list', 'remove-list', 'add-item', 'edit-item', 'check-item', 'remove-item', 'set-settings'], deepLink: 'action:amberx-lists.focus' }, // axf-plugin:amberx-lists
  { step: 's6', feature: 'approvals', folder: 'approvals-banner', commands: ['pending', 'approval', 'comments', 'comment', 'settings', 'set-settings'], deepLink: 'action:approvals.focus', never: ['decide'] }, // axf-plugin:approvals-banner
  { step: 's7', feature: 'recorder', folder: 'output-recorder', commands: ['recordings', 'recording', 'remove', 'transcribe', 'act', 'device-status', 'settings', 'set-settings', 'status', 'run'], deepLink: 'action:output-recorder.focus' }, // axf-plugin:output-recorder
  { step: 's8', feature: 'open_url', folder: 'console-commands', commands: ['open-url', 'open-url-list', 'open-url-cancel', 'settings'], deepLink: 'settings-tab:console-commands' }, // axf-plugin:console-commands
  { step: 's9', feature: 'notifications', folder: 'alerts-bell', commands: ['feed', 'history', 'raise', 'read', 'dismiss', 'resolve'], deepLink: 'action:alerts-history.focus' }, // axf-plugin:alerts-bell
  { step: 's10', feature: 'settings', folder: 'amberx-settings', commands: ['list', 'get', 'set', 'reset', 'document'], deepLink: 'action:amberx-settings.focus' }, // axf-plugin:amberx-settings
];

const reg = JSON.parse(execFileSync('node', [join(ROOT, 'framework/cli/plugin-commands.mjs'), 'registry', '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }));
const tools = new Set(pluginCommandTools(reg).map((t) => t.name));
const routes = new Set(pluginCommandRoutes(reg).map((r) => `${r.plugin}/${r.command}`));
const cli = new Set(pluginCommandCli(reg).commands.map((c) => `${c.plugin} ${c.command}`));
const rows = [];
for (const f of FEATURES) {
  if (!existsSync(join(PLUGINS, f.folder, 'plugin.json'))) { console.log(`skip ${f.feature}: ${f.folder} is not installed`); continue; }
  const p = reg.plugins.find((x) => x.folder === f.folder);
  ok(p && p.errors.length === 0, `${f.feature}: ${f.folder} commands block is valid ${JSON.stringify(p?.errors ?? 'missing')}`);
  if (!p) continue;
  const ids = new Set(p.commands.map((c) => c.id));
  for (const id of f.commands) {
    ok(ids.has(id), `${f.feature}: command ${f.folder} ${id}`);
    ok(tools.has(commandToolName(f.folder, id)), `${f.feature}: MCP ${commandToolName(f.folder, id)}`);
    ok(routes.has(`${f.folder}/${id}`), `${f.feature}: REST /api/control/${f.folder}/${id}`);
    ok(cli.has(`${f.folder} ${id}`), `${f.feature}: CLI axf ${f.folder} ${id}`);
  }
  for (const id of f.never ?? []) ok(!ids.has(id) && p.skipped.some((s) => String(s.route ?? '').endsWith(`/${id}`)), `${f.feature}: ${id} stays a person's tap (not a command)`);
  ok((p.provides ?? []).includes(f.deepLink), `${f.feature}: deep link ${f.deepLink}`);
  rows.push(`${f.step} ${f.feature.padEnd(13)} ${f.commands.length} commands · MCP ${f.folder}_* · REST /api/plugins/${f.folder}/… · CLI axf ${f.folder} … · ${f.deepLink}`);
}

// control@1: notes, to-dos and lists
const ctools = new Set(controlTools().map((t) => t.name));
for (const t of ['control_list', 'control_get', 'control_add', 'control_act', 'control_remove']) ok(ctools.has(t), `control@1 MCP ${t}`);
const mcpSrc = readFileSync(join(ROOT, 'apps/console-web/server/mcp_server.py'), 'utf8');
for (const t of ['amberx_find', 'amberx_add', 'amberx_update', 'amberx_done', 'amberx_move', 'amberx_remove']) ok(mcpSrc.includes(`async def ${t}(`), `console MCP ${t}`);
const croutes = controlRoutes().map((r) => r.path);
ok(croutes.some((p) => p.includes('/api/control/') && p.includes('{target}')) || croutes.some((p) => p.includes('amberx.items')), 'control@1 REST routes cover amberx.items');
for (const a of ['note', 'todo', 'task', 'list']) ok(CONTROL_ALIASES[a], `control@1 CLI axf ${a}`);

// one write through the CLI, read back through the runner the REST route and the MCP tools call — and the other way
const dir = mkdtempSync(join(tmpdir(), 'axf-amberx-parity-'));
const env = { ...process.env, AXF_AMBERX_NOTES_DIR: dir, AXF_ACTOR: 'parity-test' };
const CONTROL = join(PLUGINS, 'token-control/control.mjs'); // axf-plugin:token-control
if (existsSync(CONTROL)) {
  const cliAdd = JSON.parse(execFileSync('node', [CONTROL, 'todo', 'add', 'Buy milk', '--json'], { cwd: ROOT, env, encoding: 'utf8' }));
  ok(cliAdd.ok && cliAdd.item?.kind === 'todo', 'CLI axf todo add');
  const run = (command) => JSON.parse(execFileSync('node', [CONTROL, 'run'], { cwd: ROOT, env, input: JSON.stringify({ command, grants: ['*'], by: 'parity' }), encoding: 'utf8' }).trim().split('\n').pop());
  const got = run({ op: 'get', target: 'amberx.items', path: cliAdd.item.id });
  ok(got.ok && got.item.text === 'Buy milk', 'REST / MCP runner reads the CLI write');
  const done = run({ op: 'act', target: 'amberx.items', path: cliAdd.item.id, action: 'done', by: 'parity', reason: 'parity' });
  ok(done.ok && done.item.status === 'done', 'REST / MCP runner ticks it off');
  const back = JSON.parse(execFileSync('node', [CONTROL, 'todo', 'get', cliAdd.item.id, '--json'], { cwd: ROOT, env, encoding: 'utf8' }));
  ok(back.ok && back.item.status === 'done', 'CLI reads the runner write');
  const rm = run({ op: 'remove', target: 'amberx.items', path: cliAdd.item.id });
  ok(!rm.ok && rm.code === 'confirmation_required' && rm.confirm, 'deletes ask for a confirm token on every path');
  rows.push('s3–s5 control@1      CLI write ↔ REST/MCP runner read, two-step delete');
} else console.log('skip control@1 round trip: Token control is not installed');

console.log(rows.join('\n'));
console.log(`amberx parity: ${n - fails}/${n} checks passed`);
process.exit(fails ? 1 : 0);

#!/usr/bin/env node
/**
 * plugin-commands@1 (core/engines/plugin-commands.mjs + cli/plugin-commands.mjs): route and action scanning, the
 * commands block, derivation (ids, effects, inputs, skips, declared overrides), the registry, the projections (MCP tool
 * names and annotations, REST, CLI), route requests, input checks, coverage, and every real plugin in the repo exposing
 * every command and read.
 *
 *   node framework/spec/check-plugin-commands.mjs
 */
import assert from 'node:assert/strict';
import {
  actionEffect, commandSlug, commandToolName, derivePluginCommands, normalizeCommandsBlock, pluginCommandCli, pluginCommandCoverage, pluginCommandRegistry,
  pluginCommandRoutes, pluginCommandTools, pluginInputErrors, pluginRouteRequest, resolvePluginCommand, routeEffect, scanPythonRoutes, scanWebActions, PLUGIN_TOOL_MAX,
} from '../core/engines/plugin-commands.mjs';
import { coverage, registry } from '../cli/plugin-commands.mjs';

let n = 0;
const ok = (v, what) => { assert.ok(v, what); n++; };
const eq = (a, b, what) => { assert.deepEqual(a, b, what); n++; };

/* ---- scanning a Python server */
const PY = `
from fastapi import APIRouter, Request
router = APIRouter()


@router.get("/state")
def state() -> dict:
    """Every plan. More words."""
    return {}


@router.get("/plans/{pid}")
async def plan(pid: str, full: bool = False, limit: int = 20, kind: Literal["a", "b"] = "a") -> dict:
    return {}


@router.post("")
@router.post("/")
async def any_command(request: Request) -> dict:
    body = await request.json()
    return body


@router.post("/back")
@router.post("/home")
async def nav(request: Request) -> dict:
    return {}


@router.delete("/plans/{pid}")
def delete_plan(pid: str) -> dict:
    return {}


@router.get("/events")
def events():
    return StreamingResponse(x)


@router.websocket("/ws")
async def ws(socket: WebSocket):
    pass


@router.get(PATH)
def dynamic():
    return {}


def shots_router():
    r = APIRouter()

    @r.get("/shots/file")
    def file(path: str):
        return FileResponse(path)

    @r.post("/shots/move")
    def move(body: dict):
        return {}
    return r
`;
const { routes, unread } = scanPythonRoutes(PY, 'server/__init__.py');
const by = (m, p) => routes.find((r) => r.method === m && r.path === p);
eq(by('GET', '/state').doc, 'Every plan.', 'the docstring\'s first sentence');
eq(by('GET', '/plans/{pid}').params.map((p) => [p.name, p.in, p.type, p.required]), [['pid', 'path', 'string', true], ['full', 'query', 'boolean', false], ['limit', 'query', 'integer', false], ['kind', 'query', 'string', false]], 'path and query parameters with types');
eq(by('GET', '/plans/{pid}').params.find((p) => p.name === 'kind').enum, ['a', 'b'], 'Literal → enum');
eq(by('GET', '/plans/{pid}').params.find((p) => p.name === 'limit').default, 20, 'defaults');
ok(routes.filter((r) => r.method === 'POST' && r.path === '/' && r.body).length === 2, 'request.json() = a JSON body; stacked decorators ("" and "/") are both seen');
ok(by('POST', '/back') && by('POST', '/home') && by('POST', '/home').fn === 'nav', 'one handler under two paths');
ok(by('GET', '/events').stream && !by('GET', '/shots/file').stream, 'an event stream is a stream, a file download is not');
eq(by('WEBSOCKET', '/ws').method, 'WEBSOCKET', 'websockets are seen');
ok(by('POST', '/shots/move').body, 'routes on a router made inside a function; a dict parameter is the body');
eq(unread.map((u) => u.why), ['route path is not a string literal'], 'a route the scanner can\'t read is reported, not dropped');

/* ---- scanning web actions */
const TS = `
  register(rt) {
    rt.actions.register('demo.open', () => rt.navigate('demo'), { label: 'Open what\\'s new' });
    rt.actions.register('demo.delete', (_a, ctx) => ctx, { label: 'Delete row', searchable: false });
    rt.actions.register("demo.sync", async () => {
      await go();
    }, { label: "Sync now" });
  }`;
const acts = scanWebActions(TS);
eq(acts.map((a) => [a.id, a.label, a.context]), [['demo.open', "Open what's new", false], ['demo.delete', 'Delete row', true], ['demo.sync', 'Sync now', false]], 'actions with labels; a handler reading ctx acts on a row');
eq([actionEffect('demo.open'), actionEffect('demo.delete'), actionEffect('demo.sync')], ['navigate', 'destructive', 'write'], 'action effects by their words');
eq([routeEffect('GET', '/x'), routeEffect('POST', '/x'), routeEffect('DELETE', '/x'), routeEffect('POST', '/snapshots/{id}/restore')], ['read', 'write', 'destructive', 'destructive'], 'route effects');

/* ---- the commands block */
eq(normalizeCommandsBlock(undefined).declared, false, 'no block');
eq(normalizeCommandsBlock({ $axf: 'plugin-commands@1', auto: true }).errors, [], 'the minimal block');
ok(normalizeCommandsBlock({ items: [{ route: 'FETCH /x' }] }).errors[0].includes('route must be'), 'a bad route');
ok(normalizeCommandsBlock({ items: [{ route: 'GET /x', skip: '' }] }).errors.some((e) => e.includes('skip must say why')), 'a skip says why');
ok(normalizeCommandsBlock({ items: [{ id: 'Bad Id', action: 'a' }] }).errors.some((e) => e.includes('lower case')), 'ids are slugs');
ok(normalizeCommandsBlock('x').errors.length === 1, 'not an object');

/* ---- derivation */
const manifest = { name: 'Demo', lifecycle: { dataDir: '.axf-console/plugins/demo' }, commands: { $axf: 'plugin-commands@1', auto: true, items: [
  { route: 'POST /', id: 'run', title: 'Run any', input: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'] } },
  { route: 'GET /events', skip: 'server-sent events' },
  { action: 'demo.sync', readOnly: false, destructive: false, title: 'Sync', confirm: true },
] } };
const d = derivePluginCommands({ folder: 'demo', manifest, routes, unread: [], actions: acts, hasData: true });
const ids = d.commands.map((c) => c.id);
ok(['state', 'plans-by-pid', 'run', 'back', 'home', 'plans-by-pid-delete', 'shots-file', 'shots-move', 'action-open', 'action-delete', 'action-sync', 'info', 'data', 'data-file'].every((i) => ids.includes(i)), `ids (${ids.join(', ')})`);
eq(d.commands.find((c) => c.id === 'run').source, 'declared', 'a declaration wins over the derived command');
eq(d.commands.find((c) => c.id === 'run').input.required, ['op'], 'with its input schema');
eq(d.commands.find((c) => c.id === 'plans-by-pid-delete').confirm, true, 'a delete needs a confirm token');
eq(d.commands.find((c) => c.id === 'action-sync').confirm, true, 'a declared confirm');
eq(d.commands.find((c) => c.id === 'action-open').effect, 'navigate', 'an open action only navigates');
ok(d.skipped.some((s) => s.route === 'GET /events' && s.why === 'server-sent events') && d.skipped.some((s) => s.route === 'WEBSOCKET /ws'), 'skips say why');
eq(d.commands.filter((c) => c.title.startsWith('Nav')).map((c) => c.title), ['Nav: back', 'Nav: home'], 'a shared handler\'s titles name the path');
ok(!d.commands.some((c) => c.id === 'root'), 'the "" / "/" pair is one command (declared as run)');
const stale = derivePluginCommands({ folder: 'demo', manifest: { commands: { items: [{ route: 'GET /gone', id: 'gone' }] } }, routes: [], actions: [] });
ok(stale.errors.some((e) => e.includes('GET /gone is not in the plugin')), 'a declaration naming a gone route is an error');
const off = derivePluginCommands({ folder: 'demo', manifest: { commands: { auto: false, items: [{ route: 'GET /state', id: 'state' }] } }, routes, actions: acts });
eq(off.commands.map((c) => c.id), ['state', 'info'], 'auto: false = only what is declared (and info)');

/* ---- registry, resolve, requests, inputs */
const reg = pluginCommandRegistry([{ folder: 'demo', app: 'console-web', manifest, routes, unread: [], actions: acts, hasData: true }, { folder: 'notes', app: 'amberx-droid', manifest: { name: 'Notes' }, routes: [], actions: [{ id: 'notes.new', label: 'New' }] }]);
eq(reg.plugins.map((p) => `${p.app}:${p.folder}`), ['console-web:demo', 'amberx-droid:notes'], 'the console\'s plugins first, then by app and folder');
eq(resolvePluginCommand(reg, 'demo/state').command.id, 'state', 'resolve <plugin>/<command>');
eq(resolvePluginCommand(reg, 'amberx-droid:notes/action-new').plugin.app, 'amberx-droid', 'app-qualified paths');
eq(resolvePluginCommand(reg, 'demo/nope'), null, 'unknown');
const cmd = resolvePluginCommand(reg, 'demo/plans-by-pid').command;
eq(pluginRouteRequest('demo', cmd, { pid: 'a b', full: true, limit: 5 }), { method: 'GET', path: '/api/plugins/demo/plans/a%20b', query: { full: 'true', limit: '5' }, body: null }, 'a GET with path + query');
eq(pluginRouteRequest('demo', resolvePluginCommand(reg, 'demo/run').command, { op: 'x', body: { y: 1 } }).body, { y: 1, op: 'x' }, 'a POST: input fields + input.body = the JSON body');
eq(pluginInputErrors(cmd, {}), ['input.pid is required'], 'required');
eq(pluginInputErrors(cmd, { pid: 'x', limit: 'many' }), ['input.limit must be a whole number'], 'types');
eq(pluginInputErrors(cmd, { pid: 'x', kind: 'c' }), ['input.kind must be one of: a, b'], 'enums');
ok(pluginInputErrors(cmd, { pid: 'x', other: 1 })[0].includes('not an input'), 'unknown inputs on a closed schema');

/* ---- projections */
const tools = pluginCommandTools(reg);
ok(tools.every((t) => /^[A-Za-z0-9_]+$/.test(t.name) && t.name.length <= PLUGIN_TOOL_MAX), 'tool names are MCP-safe');
ok(!tools.some((t) => t.plugin === 'notes'), 'only console plugins get console tools');
const t = tools.find((x) => x.name === 'demo_plans_by_pid_delete');
ok(t.annotations.destructiveHint && !t.annotations.readOnlyHint && 'confirm' in t.inputSchema.properties, 'a delete tool is destructive and takes confirm');
ok(tools.find((x) => x.name === 'demo_state').annotations.readOnlyHint, 'a read tool is read-only');
eq(commandToolName('a'.repeat(40), 'b'.repeat(40)).length, PLUGIN_TOOL_MAX, 'long names are cut with a hash');
ok(commandToolName('a'.repeat(40), 'b'.repeat(40)) !== commandToolName('a'.repeat(40), `${'b'.repeat(39)}c`), 'and stay distinct');
eq(pluginCommandRoutes(reg).find((r) => r.command === 'state').path, '/api/control/demo/state', 'REST route');
ok(pluginCommandCli(reg).commands.find((c) => c.command === 'plans-by-pid').usage.includes('--pid <pid>'), 'CLI usage names required fields');
eq(commandSlug('/plans/{pid}/steps'), 'plans-by-pid-steps', 'slugs');

/* ---- coverage */
const cov = pluginCommandCoverage(reg.plugins.find((p) => p.folder === 'demo'));
ok(cov.ok, `a declared plugin with reads passes (${cov.errors.join('; ')})`);
const bare = pluginCommandRegistry([{ folder: 'bare', manifest: {}, routes: [], actions: [{ id: 'bare.ping', label: 'Ping' }] }]).plugins[0];
eq(pluginCommandCoverage(bare).errors.length, 2, 'no reads and no block both fail');
ok(pluginCommandCoverage({ ...bare, noReads: 'only a ping', declared: true }).ok, 'noReads with a why passes');
ok(!pluginCommandCoverage({ ...bare, declared: true, unread: [{ file: 'x.py', line: 3, why: 'route path is not a string literal' }], noReads: 'x' }).ok, 'an unreadable route fails');

/* ---- the repo: every plugin exposes every command and read */
const real = coverage();
const bad = real.filter((c) => !c.ok);
ok(real.length >= 40, `the console's plugins (${real.length})`);
eq(bad.map((c) => `${c.folder}: ${c.errors.join('; ')}`), [], 'every console plugin exposes every command and read');
const all = registry();
ok(all.plugins.some((p) => p.app === 'amberx-droid'), 'AmberX\'s plugins are listed too');
ok(all.plugins.every((p) => p.declared), 'every plugin (every app) has a commands block');

console.log(`✓ plugin commands — ${n} checks, ${real.length} console plugins, ${all.plugins.reduce((s, p) => s + p.commands.length, 0)} commands and reads`);

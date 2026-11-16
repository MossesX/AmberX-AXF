/**
 * Fixer `api-parity` (Brett Nov 8 2026: "Everything comes with an API"). Every plugin action or setting is reachable the
 * same four ways: REST (/api/plugins/<folder>/…), MCP (plugin-commands@1 makes a tool of every commands.items entry),
 * the CLI (`axf <folder> <command>`, the same registry) and voice (a console action registered in the plugin's web part).
 *
 * check: per plugin in scope, a commands.items route with no handler in server/routes.py (REST), a plugin with routes
 *   but no commands block (MCP + CLI), a plugin with a view but no console action (voice).
 * fix ctx.add = { plugin, id, route: "POST /thing", title, description, readOnly? } scaffolds one new action or setting:
 *   the commands.items entry (→ MCP tool + CLI), a route stub in server/routes.py answering 501 until it is written, and
 *   a voice action in web/voice-scaffold.ts (`<folder>.<id>` calls the same REST route). Each part is skipped when it is
 *   already there, so a second run changes nothing. Without ctx.add, fix only reports (it cannot invent a handler).
 *
 * CLI: node apps/console-web/plugins/gate/fixers/api-parity.mjs [check|fix] [--dry-run] [--plugin a,b] [--json]
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, commandsOf, jsonText, plugin, pluginFolders, readJson, readText, result, writeIfChanged } from './lib.mjs';

export const id = 'api-parity';
const ROUTE_RE = /^(GET|POST|PUT|PATCH|DELETE)\s+(\/\S*)$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** "POST /rules/{rule_id}" → { method, path } or null. */
export const parseRoute = (r) => { const m = String(r || '').trim().match(ROUTE_RE); return m ? { method: m[1], path: m[2] } : null; };

/** Is the route handled in routes.py? Path params match by position, whatever they are called. */
export function hasHandler(py, route) {
  const r = parseRoute(route);
  if (!r) return true;
  const shape = (p) => p.replace(/\{[^}]+\}/g, '{}').replace(/\/$/, '');
  const re = /@router\.(get|post|put|patch|delete)\(\s*"([^"]*)"/g;
  for (let m; (m = re.exec(py));) if (m[1].toUpperCase() === r.method && shape(m[2]) === shape(r.path)) return true;
  return false;
}

const webText = (dir) => { try { return readdirSync(join(dir, 'web')).filter((f) => /\.tsx?$/.test(f)).map((f) => readText(join(dir, 'web', f))).join('\n'); } catch { return ''; } };

/** One plugin's gaps, each `<folder>: <surface>: <what>`. */
export function gaps(ctx, folder) {
  const p = plugin(ctx, folder);
  const items = commandsOf(p.manifest);
  const py = readText(join(p.dir, 'server', 'routes.py'));
  const out = [];
  if (py && /@router\./.test(py) && !p.manifest.commands) out.push(`${folder}: mcp+cli: routes.py has routes but plugin.json has no commands block`);
  if (py) for (const c of items) if (c.route && !hasHandler(py, c.route)) out.push(`${folder}: rest: ${c.id} (${c.route}) has no handler in server/routes.py`);
  const hasView = (p.manifest.provides || []).includes(`view:${folder}`);
  if (hasView && items.length && !/actions\.register\(/.test(webText(p.dir))) out.push(`${folder}: voice: no console action registered in web/`);
  return out;
}

export function check(ctx = {}) {
  const missing = pluginFolders(ctx).flatMap((f) => gaps(ctx, f));
  return result(id, { ok: !missing.length, missing, detail: missing.length ? `${missing.length} API parity gap(s)` : 'every action has REST, MCP, CLI and voice' });
}

const pyName = (s) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase();
export const routeStub = (folder, add, r) => `

@router.${r.method.toLowerCase()}("${r.path}")
async def ${pyName(`scaffold_${add.id}`)}(request: Request) -> JSONResponse:  # scaffolded by the gate fixer api-parity
    """${String(add.title || add.id).replace(/"/g, "'")}: not written yet (501 until the plugin implements it)."""
    return JSONResponse({"ok": False, "code": "not_implemented", "message": "${folder} ${add.id} is scaffolded but not implemented yet"}, status_code=501)
`;

const VOICE_HEAD = (folder) => `/**
 * Voice and console actions scaffolded by the gate fixer api-parity: each calls the same REST route as MCP and the CLI.
 * Register them from the plugin's web entry: registerScaffoldedActions(rt).
 */
import type { AxfRuntime } from '@console/axf/core';

const call = (method: string, path: string, body?: unknown) => fetch(\`/api/plugins/${folder}\${path}\`, { method, credentials: 'include', headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) }).then((r) => r.json());

export function registerScaffoldedActions(rt: AxfRuntime): void {
  // scaffold:actions
}
`;
export const voiceLine = (folder, add, r) => `  rt.actions.register('${folder}.${add.id}', () => { void call('${r.method}', '${r.path}', { by: 'voice' }).then((x) => rt.toast(x.ok === false ? x.message : '${String(add.title || add.id).replace(/'/g, '')}: done.', x.ok === false ? 'danger' : 'success', '${folder}')); }, { label: '${String(add.title || add.id).replace(/'/g, '')}', effect: '${add.readOnly ? 'read' : 'write'}' });\n`;

export function fix(ctx = {}, { dryRun = false } = {}) {
  const add = ctx.add;
  if (!add) { const c = check(ctx); return result(id, { ...c, detail: `${c.detail} (nothing to scaffold: pass add {plugin, id, route, title, description})` }); }
  const r = parseRoute(add.route);
  if (!SLUG.test(String(add.plugin || '')) || !SLUG.test(String(add.id || '')) || !r) return result(id, { ok: false, unfixable: 'add needs plugin, id (slugs) and route "METHOD /path"' });
  const p = plugin(ctx, add.plugin);
  if (!existsSync(join(p.dir, 'plugin.json'))) return result(id, { ok: false, unfixable: `no plugin ${add.plugin}` });
  const planned = []; const changed = [];
  const base = `apps/console-web/plugins/${add.plugin}`;
  const step = (rel, file, text) => { if (readText(file) === text) return; if (dryRun) planned.push(rel); else if (writeIfChanged(file, text)) changed.push(rel); };
  // 1. plugin.json commands.items → the MCP tool and `axf <plugin> <id>`
  const m = readJson(join(p.dir, 'plugin.json'));
  if (!commandsOf(m).some((c) => c.id === add.id)) {
    m.commands = m.commands || { $axf: 'plugin-commands@1', auto: true, items: [] };
    m.commands.items = [...commandsOf(m), { id: add.id, route: `${r.method} ${r.path}`, title: String(add.title || add.id), ...(add.readOnly ? { readOnly: true } : {}), description: String(add.description || add.title || add.id) }];
    step(`${base}/plugin.json (commands.items ${add.id})`, join(p.dir, 'plugin.json'), jsonText(m));
  }
  // 2. the REST handler stub
  const pyFile = join(p.dir, 'server', 'routes.py');
  const py = readText(pyFile);
  if (py && !hasHandler(py, add.route)) step(`${base}/server/routes.py (${add.route})`, pyFile, py.replace(/\n*$/, '\n') + routeStub(add.plugin, add, r));
  // 3. the voice action stub
  const vFile = join(p.dir, 'web', 'voice-scaffold.ts');
  const v = readText(vFile) || VOICE_HEAD(add.plugin);
  if (!v.includes(`'${add.plugin}.${add.id}'`)) step(`${base}/web/voice-scaffold.ts (${add.plugin}.${add.id})`, vFile, v.replace('  // scaffold:actions\n', `${voiceLine(add.plugin, add, r)}  // scaffold:actions\n`));
  return result(id, { ok: true, dryRun, planned, changed, detail: dryRun ? `would scaffold ${planned.length} part(s)` : `scaffolded ${changed.length} part(s)` });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await cli({ check, fix });

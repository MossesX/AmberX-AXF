/**
 * axf serve — HTTP driver for the build engine (what the Dev Console's build-engine client talks to).
 *
 *   node framework/cli/axf.mjs serve [--port 7080] [--token secret] [--apps apps]
 *
 *   POST /init        { dir?, name, template?, modules?, boilerplate?, applicationId? }
 *   POST /validate    { dir }
 *   POST /new-asset   { dir, type, id, from? }
 *   POST /new-module  { name, label?, capabilities?, dependsOn?, compose? }
 *   POST /new-demo    { library, name?, dir? }
 *   GET  /modules     → Android framework modules
 *   GET  /boilerplates, GET /templates, GET /catalog, GET /tracker, GET /health
 *
 * Every mutating call runs the same functions as the CLI, with `dir` confined to the apps folder.
 * Deploy it next to a clone of the repo on the VPS (Coolify: `node framework/cli/axf.mjs serve --token $AXF_TOKEN`)
 * and set Settings → Developer → Build engine URL in the console. The same functions can also be
 * exposed over MCP (framework/cli/mcp.mjs, planned) for Claude Code.
 */
import { installLibrary, listLibraries } from './libraries.mjs';
import { importUiLibrary, listPortedKits } from './ui-port.mjs';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { FRAMEWORK_DIR, init, listBoilerplates, listModules, listTemplates, newAsset, newDemoApp, newModule, validateApp } from './build-engine.mjs';
import { dataPath } from './persist.mjs';

export function startBuildServer({ port = 7080, token = process.env.AXF_TOKEN ?? '', apps = 'apps', log = console.log } = {}) {
  const ROOT = resolve(FRAMEWORK_DIR, '..');
  const APPS = resolve(ROOT, apps);
  const safeDir = (d) => { const p = resolve(APPS, d ?? ''); if (!p.startsWith(APPS)) throw new Error('dir must be inside the apps folder'); return p; };
  const json = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)); };
  const readBody = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { ok({}); } }); });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') return json(res, {});
    if (token && req.headers.authorization !== `Bearer ${token}` && url.pathname !== '/health') return json(res, { error: 'unauthorized' }, 401);
    try {
      if (req.method === 'GET') {
        switch (url.pathname) {
          case '/health': return json(res, { ok: true, axf: 'build-engine@1' });
          case '/modules': return json(res, { modules: listModules() });
          case '/boilerplates': return json(res, { boilerplates: listBoilerplates() });
          case '/templates': return json(res, { templates: listTemplates() });
          case '/libraries': return json(res, { libraries: listLibraries() });
          case '/ported-kits': return json(res, { kits: listPortedKits() });
          case '/catalog': return json(res, JSON.parse(readFileSync(join(FRAMEWORK_DIR, 'catalog/catalog.json'), 'utf8')));
          case '/tracker': return existsSync(dataPath('tracker.json')) ? json(res, JSON.parse(readFileSync(dataPath('tracker.json'), 'utf8'))) : json(res, { error: 'no tracker' }, 404);
        }
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        const lines = [];
        const logf = (m) => { lines.push(m); log(m); };
        switch (url.pathname) {
          case '/init': { const r = init({ dir: safeDir(b.dir ?? (b.id ?? b.name ?? 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-')), name: b.name, id: b.id, template: b.template ?? 'android-compose', modules: b.modules ?? [], boilerplate: b.boilerplate, libraries: b.libraries ?? [], applicationId: b.applicationId, log: logf }); return json(res, { ok: true, dir: relative(ROOT, r.dir), manifest: r.manifest, report: r.report, log: lines }); }
          case '/import-ui': { const r = importUiLibrary({ name: b.name, kitId: b.kitId, library: b.library, version: b.version, source: b.source, covers: b.covers, dir: b.dir ? safeDir(b.dir) : undefined, overwrite: !!b.overwrite, log: logf }); return json(res, { ok: true, module: r.module, kitId: r.kitId, report: r.report, log: lines }); }
          case '/install': { const r = installLibrary({ dir: safeDir(b.dir), library: b.library, params: b.params ?? {}, log: logf }); return json(res, { ok: true, dir: relative(ROOT, r.dir), library: r.library, config: r.config, changed: r.changed, script: r.script, log: lines }); }
          case '/validate': return json(res, { ok: true, dir: b.dir, report: validateApp(safeDir(b.dir)) });
          case '/new-asset': { const f = newAsset({ dir: safeDir(b.dir), type: b.type, id: b.id, from: b.from, name: b.name }); return json(res, { ok: true, file: relative(ROOT, f) }); }
          case '/new-module': { const r = newModule({ name: b.name, label: b.label, capabilities: b.capabilities ?? [], dependsOn: b.dependsOn ?? [], compose: b.compose !== false, log: logf }); return json(res, { ok: true, ...r, dir: relative(ROOT, r.dir), log: lines }); }
          case '/new-demo': { const r = newDemoApp({ library: b.library, name: b.name, dir: b.dir ? safeDir(b.dir) : undefined, log: logf }); return json(res, { ok: true, dir: relative(ROOT, r.dir), manifest: r.manifest, report: r.report, log: lines }); }
        }
      }
      json(res, { error: 'not found' }, 404);
    } catch (e) { json(res, { ok: false, error: e.message }, 400); }
  });
  server.listen(port, '0.0.0.0', () => log(`AXF build engine on http://0.0.0.0:${port}${token ? ' (token required)' : ' (no token — set --token or AXF_TOKEN before exposing it)'}  apps → ${relative(process.cwd(), APPS)}`));
  return server;
}

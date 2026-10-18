/**
 * axf dev — live-reload server for assets (the Android/web equivalent of HMR for everything that is an asset).
 *
 *   node framework/cli/axf.mjs dev [appDir] [--port 7070] [--framework]
 *
 * Watches the app's assets folder (or framework/assets with --framework) and serves:
 *   GET /                 → { app, rev, assets: <count>, files: [...] }
 *   GET /assets.json      → every asset as one JSON array (what the app loads on connect)
 *   GET /assets/<type>/<id>.json
 *   GET /manifest.json    → axf.manifest.json
 *   GET /events?since=<rev> → long-poll: resolves with { rev, changed: [{type,id,action}] } when a file changes
 *
 * On the device the axf-assets remote source (flag axf.hotReload, setting axf.devServer=http://<pc-ip>:7070)
 * loads /assets.json once, then long-polls /events and re-registers only the changed assets; the runtime
 * recompiles, so a theme edit on the PC lands on the phone in under a second without a rebuild. Code
 * changes still go through Android Studio's Live Edit / Apply Changes — this covers everything in JSON.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, watch } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { appTemplate, FRAMEWORK_DIR, loadAssets, validateAsset } from './build-engine.mjs';
import { requireProject } from './project.mjs';

export function startDevServer({ dir = '.', port = 7070, framework = false, log = console.log } = {}) {
  const root = resolve(dir);
  // The build rule: no project is loaded without a validated manifest (the framework's own is the repo root).
  requireProject(framework ? join(FRAMEWORK_DIR, '..') : root, 'loaded');
  const assetsDir = framework ? join(FRAMEWORK_DIR, 'assets') : join(root, appTemplate(root).assetsDir);
  const manifestPath = join(root, 'axf.manifest.json');
  if (!existsSync(assetsDir)) throw new Error(`No assets folder at ${assetsDir}`);

  let rev = 1;
  let waiters = [];
  let changes = [];
  const snapshot = () => loadAssets(assetsDir).filter((a) => a.result.ok).map((a) => a.raw);

  const notify = (file, action) => {
    const type = basename(dirname(file));
    const id = basename(file, '.json');
    let ok = true;
    if (action !== 'removed') {
      try { ok = validateAsset(JSON.parse(readFileSync(file, 'utf8'))).ok; } catch { ok = false; }
    }
    rev++;
    changes.push({ rev, type, id, action, ok, at: Date.now() });
    changes = changes.slice(-200);
    log(`  ${action.padEnd(8)} ${type}/${id}.json${ok ? '' : '  (invalid, not sent)'}  rev ${rev}`);
    const w = waiters; waiters = [];
    for (const res of w) respond(res, { rev, changed: changes.filter((c) => c.rev > res.since) });
  };

  // fs.watch is recursive on Linux ≥ 20 / macOS / Windows; fall back to per-type dirs otherwise.
  const seen = new Map();
  const onChange = (dirPath) => (_evt, name) => {
    if (!name || !String(name).endsWith('.json')) return;
    const file = join(dirPath, String(name));
    const key = file;
    clearTimeout(seen.get(key));
    seen.set(key, setTimeout(() => notify(file, existsSync(file) ? 'changed' : 'removed'), 80));
  };
  try { watch(assetsDir, { recursive: true }, onChange(assetsDir)); } catch {
    for (const a of loadAssets(assetsDir)) watch(dirname(a.file), onChange(dirname(a.file)));
  }

  const respond = (res, body, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/') return respond(res, { axf: 'dev-server@1', app: existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).app : null, rev, assets: snapshot().length, dir: relative(process.cwd(), assetsDir) });
    if (url.pathname === '/assets.json') return respond(res, { rev, assets: snapshot() });
    if (url.pathname === '/manifest.json') return existsSync(manifestPath) ? respond(res, JSON.parse(readFileSync(manifestPath, 'utf8'))) : respond(res, { error: 'no manifest' }, 404);
    if (url.pathname.startsWith('/assets/')) {
      const file = join(assetsDir, url.pathname.slice('/assets/'.length));
      if (!file.startsWith(assetsDir) || !existsSync(file)) return respond(res, { error: 'not found' }, 404);
      return respond(res, JSON.parse(readFileSync(file, 'utf8')));
    }
    if (url.pathname === '/events') {
      const since = Number(url.searchParams.get('since') ?? 0);
      if (rev > since) return respond(res, { rev, changed: changes.filter((c) => c.rev > since) });
      res.since = since;
      waiters.push(res);
      const t = setTimeout(() => { waiters = waiters.filter((w) => w !== res); respond(res, { rev, changed: [] }); }, 25_000);
      req.on('close', () => { clearTimeout(t); waiters = waiters.filter((w) => w !== res); });
      return;
    }
    respond(res, { error: 'not found' }, 404);
  });
  server.listen(port, '0.0.0.0', () => log(`AXF dev server on http://0.0.0.0:${port}  watching ${relative(process.cwd(), assetsDir)} (${snapshot().length} assets)\n  on the device: Settings → Developer → Dev server URL = http://<this machine's IP>:${port}`));
  return server;
}
